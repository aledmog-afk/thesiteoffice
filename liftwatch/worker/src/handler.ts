/**
 * LiftWatch forecast proxy. Fetches Open-Meteo for a site, rounded to 2 dp, and
 * caches each site's response for 60 minutes so many users share one upstream
 * call. Written against injected dependencies so it can be unit tested in Node.
 */
import {
  buildForecastUrl,
  FORECAST_CACHE_SECONDS,
  isInPilotArea,
  publicEndpoint,
  roundCoord,
  type ForecastEnvelope,
} from '../../src/data/openMeteo';

export interface Env {
  /** Open-Meteo endpoint. Free: https://api.open-meteo.com/v1/forecast (non-commercial). */
  OPEN_METEO_BASE_URL?: string;
  /** Commercial API key. Set with `wrangler secret put OPEN_METEO_API_KEY`. */
  OPEN_METEO_API_KEY?: string;
  /** Origin allowed to call the Worker (the Pages site). "*" if unset. */
  ALLOWED_ORIGIN?: string;
}

/** The parts of the Workers Cache API this handler uses. */
export interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

export interface Deps {
  fetch: typeof fetch;
  cache: CacheLike;
  now: () => Date;
  /** Lets the cache write finish after the response is sent (ctx.waitUntil). */
  waitUntil: (p: Promise<unknown>) => void;
}

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const SOURCE_NAME = 'Open-Meteo';

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, env: Env, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env), ...extra },
  });
}

export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, env);

  const url = new URL(request.url);
  if (url.pathname !== '/forecast') return json({ error: 'Not found' }, 404, env);

  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.get('lat') || !url.searchParams.get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'lat and lon are required numbers' }, 400, env);
  }
  if (!isInPilotArea(lat, lon)) {
    return json({ error: 'The pilot covers UK sites only' }, 400, env);
  }

  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  const baseUrl = env.OPEN_METEO_BASE_URL || DEFAULT_BASE_URL;
  // One cache entry per rounded site and endpoint. The key never contains the API key.
  const cacheKey = new Request(
    `https://liftwatch-cache.invalid/forecast?lat=${rLat.toFixed(2)}&lon=${rLon.toFixed(2)}&ep=${encodeURIComponent(publicEndpoint(baseUrl))}`,
  );

  const hit = await deps.cache.match(cacheKey);
  if (hit) {
    return new Response(hit.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env), 'X-LiftWatch-Cache': 'HIT' },
    });
  }

  const upstreamUrl = buildForecastUrl({ baseUrl, latitude: rLat, longitude: rLon, apiKey: env.OPEN_METEO_API_KEY });
  let upstream: Response;
  try {
    upstream = await deps.fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
  } catch {
    return json({ error: 'Could not reach the forecast provider' }, 502, env);
  }
  if (!upstream.ok) {
    return json({ error: `Forecast provider returned ${upstream.status}` }, 502, env);
  }

  const envelope: ForecastEnvelope = {
    source: SOURCE_NAME,
    endpoint: publicEndpoint(baseUrl),
    fetchedAt: deps.now().toISOString(),
    latitude: rLat,
    longitude: rLon,
    data: await upstream.json(),
  };
  const body = JSON.stringify(envelope);

  deps.waitUntil(
    deps.cache.put(
      cacheKey,
      new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${FORECAST_CACHE_SECONDS}`,
        },
      }),
    ),
  );

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env), 'X-LiftWatch-Cache': 'MISS' },
  });
}

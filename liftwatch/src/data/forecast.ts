import { FORECAST_CONFIG } from '../config';
import {
  buildForecastUrl,
  isInPilotArea,
  parseForecast,
  publicEndpoint,
  roundCoord,
  type Forecast,
  type ForecastEnvelope,
} from './openMeteo';

export class ForecastFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForecastFetchError';
  }
}

/**
 * Gets the 7-day forecast for a site. Goes through the LiftWatch Worker when
 * VITE_FORECAST_PROXY_URL is set (shared 60 min cache). Otherwise calls Open-Meteo
 * directly and stamps the fetch time in the browser.
 */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<Forecast> {
  if (!isInPilotArea(latitude, longitude)) {
    throw new ForecastFetchError('The pilot covers UK sites only. Check the latitude and longitude.');
  }
  const cfg = FORECAST_CONFIG;
  let envelope: ForecastEnvelope;

  try {
    if (cfg.proxyUrl) {
      const url = new URL(cfg.proxyUrl, globalThis.location?.href);
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      const res = await fetchImpl(url.toString());
      if (!res.ok) {
        const msg = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
        throw new ForecastFetchError(msg ?? `Forecast service returned ${res.status}.`);
      }
      envelope = (await res.json()) as ForecastEnvelope;
    } else {
      const res = await fetchImpl(
        buildForecastUrl({ baseUrl: cfg.directBaseUrl, latitude, longitude, apiKey: cfg.directApiKey || undefined }),
      );
      if (!res.ok) throw new ForecastFetchError(`${cfg.sourceName} returned ${res.status}.`);
      envelope = {
        source: cfg.sourceName,
        endpoint: publicEndpoint(cfg.directBaseUrl),
        fetchedAt: now().toISOString(),
        latitude: roundCoord(latitude),
        longitude: roundCoord(longitude),
        data: await res.json(),
      };
    }
  } catch (err) {
    if (err instanceof ForecastFetchError) throw err;
    throw new ForecastFetchError('Could not reach the forecast service. Check the connection and try again.');
  }
  return parseForecast(envelope);
}

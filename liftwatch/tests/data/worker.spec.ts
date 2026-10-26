import { describe, expect, it } from 'vitest';
import { handleRequest, type CacheLike, type Deps } from '../../worker/src/handler';
import { openMeteoResponse } from '../fixtures/openMeteo';

function setup(upstreamStatus = 200) {
  const store = new Map<string, Response>();
  const calls: string[] = [];
  const pending: Promise<unknown>[] = [];
  const cache: CacheLike = {
    async match(key) {
      return store.get(key.url)?.clone();
    },
    async put(key, response) {
      store.set(key.url, response);
    },
  };
  const deps: Deps = {
    fetch: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(openMeteoResponse()), { status: upstreamStatus });
    }) as typeof fetch,
    cache,
    now: () => new Date('2026-10-21T19:00:00Z'),
    waitUntil: (p) => pending.push(p),
  };
  const get = async (path: string) => {
    const res = await handleRequest(new Request(`https://w.example${path}`), {}, deps);
    await Promise.all(pending);
    return res;
  };
  return { get, calls, store };
}

describe('forecast Worker', () => {
  it('fetches Open-Meteo with rounded coordinates and returns the fetch time', async () => {
    const { get, calls } = setup();
    const res = await get('/forecast?lat=51.50735&lon=-0.12776');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-LiftWatch-Cache')).toBe('MISS');
    const body = await res.json();
    expect(body.fetchedAt).toBe('2026-10-21T19:00:00.000Z');
    expect(body.source).toBe('Open-Meteo');
    expect(body.latitude).toBe(51.51);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get('latitude')).toBe('51.51');
  });

  it('serves nearby sites from one cached call', async () => {
    const { get, calls, store } = setup();
    await get('/forecast?lat=51.50735&lon=-0.12776');
    const second = await get('/forecast?lat=51.5098&lon=-0.1301');
    expect(second.headers.get('X-LiftWatch-Cache')).toBe('HIT');
    expect(calls).toHaveLength(1);
    expect(store.size).toBe(1);
    const cached = [...store.values()][0];
    expect(cached.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('rejects missing or out-of-area coordinates', async () => {
    const { get } = setup();
    expect((await get('/forecast?lat=51.5')).status).toBe(400);
    expect((await get('/forecast?lat=abc&lon=0')).status).toBe(400);
    expect((await get('/forecast?lat=40.7&lon=-74')).status).toBe(400);
  });

  it('does not cache upstream errors', async () => {
    const { get, store } = setup(500);
    expect((await get('/forecast?lat=51.5&lon=-0.1')).status).toBe(502);
    expect(store.size).toBe(0);
  });

  it('answers CORS preflight and 404s other paths', async () => {
    const { get } = setup();
    expect((await get('/other')).status).toBe(404);
    // Preflight returns before any dependency is used.
    const pre = await handleRequest(new Request('https://w.example/forecast', { method: 'OPTIONS' }), {}, {} as Deps);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('wrangler.toml', () => {
  const toml = Object.values(import.meta.glob('../../worker/wrangler.toml', { query: '?raw', import: 'default', eager: true }))[0] as string;

  it('allows only the LiftWatch Pages origin, not every site', () => {
    expect(toml).toMatch(/^ALLOWED_ORIGIN = "https:\/\/liftwatch\.pages\.dev"$/m);
    expect(toml).not.toMatch(/^ALLOWED_ORIGIN = "\*"$/m);
  });
});

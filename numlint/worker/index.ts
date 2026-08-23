/**
 * numlint as an HTTP endpoint. Runs on Cloudflare Workers, Deno Deploy, Bun or
 * anything else with a `fetch` handler — the engine has no dependencies and
 * touches no I/O.
 *
 *   POST /lint            {"text": "...", "min_confidence": 0.75}
 *   GET  /lint?text=...
 *   GET  /rules
 */
import { lint, ruleIds, RULES } from '../src/index.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', ...CORS };
const MAX_BYTES = 1_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/rules') {
      return json({ rules: RULES.map((r) => ({ id: r.id, description: r.description })), ids: ruleIds() });
    }

    if (url.pathname === '/lint') {
      let text = '';
      let options: Record<string, unknown> = {};
      if (request.method === 'POST') {
        const raw = await request.text();
        if (raw.length > MAX_BYTES) return json({ error: `document too large (limit ${MAX_BYTES} bytes)` }, 413);
        const ct = request.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          try {
            const body = JSON.parse(raw) as Record<string, unknown>;
            text = typeof body.text === 'string' ? body.text : '';
            options = body;
          } catch {
            return json({ error: 'invalid JSON body' }, 400);
          }
        } else {
          text = raw;
        }
      } else {
        text = url.searchParams.get('text') ?? '';
      }
      if (!text.trim()) return json({ error: 'no text supplied' }, 400);

      const result = lint(text, {
        minConfidence: numberOr(options.min_confidence ?? url.searchParams.get('min_confidence')),
        slack: numberOr(options.slack ?? url.searchParams.get('slack')),
        rules: stringsOr(options.rules ?? url.searchParams.get('rules')),
        disable: stringsOr(options.disable ?? url.searchParams.get('disable')),
      });
      return json(result);
    }

    return json(
      {
        name: 'numlint',
        description: 'Checks whether the numbers in a document agree with each other.',
        endpoints: {
          'POST /lint': 'body: {"text": "..."} or text/plain; returns findings',
          'GET /lint?text=…': 'same, for short documents',
          'GET /rules': 'the available checks',
        },
      },
      url.pathname === '/' ? 200 : 404,
    );
  },
};

function numberOr(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function stringsOr(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim());
  return undefined;
}

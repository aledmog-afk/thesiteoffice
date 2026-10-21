import { handleRequest, type Env } from './handler';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Cloudflare adds `caches.default` to the standard CacheStorage.
declare const caches: CacheStorage & { default: Cache };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      cache: caches.default,
      now: () => new Date(),
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};

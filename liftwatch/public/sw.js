/*
 * LiftWatch service worker: lets the app open with no signal on site.
 * - Pages: network first, so a new deploy is picked up at once; the cached copy
 *   is used only when offline.
 * - /assets/ (content-hashed file names): cache first.
 * - Other sites (forecast, postcodes) are never cached here; the app keeps its own
 *   copy of the last forecast and labels it as offline.
 */
const CACHE = 'liftwatch-shell-v1';

// The page's own files load before this worker takes control on a first visit,
// so cache the start page and every /assets/ file it names when installing.
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-store' });
  const html = await res.clone().text();
  await cache.put('/', res);
  const assets = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) || [])];
  await cache.addAll(['/favicon.svg', ...assets]);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache().catch(() => undefined));
});

// The page also sends the files it has loaded (e.g. chunks loaded on demand).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cache' && Array.isArray(data.urls)) {
    const urls = data.urls.filter((u) => typeof u === 'string' && u.startsWith('/assets/'));
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(urls)).catch(() => undefined));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function put(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => put(request, res))
        .catch(() => caches.match(request, { ignoreVary: true }).then((hit) => hit || caches.match('/', { ignoreVary: true }))),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg') {
    event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request).then((res) => put(request, res))));
  }
});

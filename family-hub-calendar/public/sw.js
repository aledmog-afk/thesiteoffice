// Deliberately caches nothing.
//
// Its only job is to satisfy installability so the tablet can "Add to Home
// Screen" and run fullscreen. Caching app shell JS on a device that stays open
// for weeks is how a kiosk ends up running a stale bundle against a migrated
// schema — the build-id watcher exists precisely to avoid that, and a caching
// service worker would fight it.
//
// skipWaiting + clients.claim mean a new worker never sits waiting behind an
// old one on a tablet nobody ever closes.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for installability on some browsers. Passing
// through keeps the network the single source of truth.
self.addEventListener('fetch', () => {});

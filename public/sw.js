/**
 * Service worker (architecture spec §11): precache the app shell and lazily
 * cache same-origin assets — crucially the model weights under /models/ and the
 * ONNX Runtime WASM under /ort/ — so the app runs fully offline after first load
 * (spec §1, §7 "can be used air-gapped").
 *
 * Strategy: cache-first for hashed build assets + model/runtime files (they are
 * immutable), network-first for navigations so updates are picked up.
 */
const CACHE = 'live-search-v1';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/models/') ||
    url.pathname.startsWith('/ort/') ||
    url.pathname.startsWith('/worklets/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  if (req.mode === 'navigate') {
    // Network-first for navigations, falling back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/index.html'))),
    );
    return;
  }

  if (isImmutableAsset(url) || url.pathname.endsWith('.json')) {
    // Cache-first for big immutable assets and the corpus index.
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

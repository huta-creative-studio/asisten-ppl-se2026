// Service Worker untuk Asisten Petugas SE2026 — offline-first
const CACHE_NAME = 'se2026-v2';
const PRECACHE_URLS = [
  '/se2026-app.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Hanya cache GET
  if (req.method !== 'GET') return;
  // Stale-while-revalidate untuk asset utama, network-first untuk lainnya
  const url = new URL(req.url);
  const isAppShell = PRECACHE_URLS.some(u => req.url.endsWith(u) || url.pathname === u);

  if (isAppShell) {
    // Cache-first untuk app shell
    event.respondWith(
      caches.match(req).then(cached => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  } else {
    // Network-first dengan fallback ke cache
    event.respondWith(
      fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return networkRes;
      }).catch(() => caches.match(req))
    );
  }
});

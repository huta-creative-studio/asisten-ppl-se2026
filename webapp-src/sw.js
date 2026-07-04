// ===== SERVICE WORKER — Asisten Petugas SE2026 =====
// Strategi: cache-first untuk app shell (agar 100% bisa dibuka offline),
// network-first untuk halaman utama (biar update terbaru kepakai saat online),
// dan BYPASS total untuk request ke Apps Script (aktivasi kode) — itu harus
// selalu real-time ke server, tidak boleh di-cache.

const CACHE_VERSION = 'se2026-v7';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.min.css',
  './js/app.min.js',
  './js/lock.min.js',
  './js/pwa.min.js',
  './js/vendor/html2canvas.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Jangan pernah cache request ke luar (Apps Script aktivasi, dsb) —
  // harus selalu langsung ke server.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (req.method !== 'GET') return;

  // Navigasi halaman (mis. buka "/") -> network-first, fallback ke cache saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Aset app shell (css/js/gambar) -> cache-first, lalu update di background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

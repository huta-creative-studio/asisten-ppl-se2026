// ===== SERVICE WORKER — Asisten Petugas SE2026 =====
// PATCH v9: cache-first + stale-while-revalidate untuk SEMUA request GET
// same-origin (termasuk navigasi/index.html). Ini penting untuk aplikasi
// yang dipakai di lapangan dengan sinyal lemah/naik-turun: user tidak lagi
// menunggu network selesai/timeout sebelum app tampil — app langsung
// tampil dari cache, lalu cache diperbarui diam-diam di background kalau
// ada koneksi.
//
// Request ke luar (mis. Apps Script untuk aktivasi/lisensi) TETAP bypass
// total — selalu real-time ke server, tidak pernah di-cache.
//
// html2canvas.min.js SENGAJA tidak di-precache di sini karena sekarang
// di-lazy-load oleh app (lihat lazy-html2canvas.js) — baru diminta browser
// saat fitur "simpan gambar" dipakai. Begitu diminta pertama kali, file
// itu otomatis masuk cache lewat fetch handler di bawah, jadi pemakaian
// berikutnya tetap cepat/offline.

const CACHE_VERSION = 'se2026-v9';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.min.css',
  './js/app.min.js',
  './js/lock.min.js',
  './js/pwa.min.js',
  './js/lazy-html2canvas.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Timeout kecil untuk fetch background-refresh, supaya kalau sinyal
// lemot/lambat (bukan mati total), kita tidak menunggu lama sebelum
// tetap menampilkan versi cache yang sudah ada.
const NETWORK_TIMEOUT_MS = 4000;

function fetchWithTimeout(req, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(req, { signal: controller.signal }).finally(() => clearTimeout(id));
}

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

  // SEMUA request same-origin (termasuk navigasi) -> cache-first,
  // lalu update cache di background kalau ada koneksi (stale-while-revalidate).
  // Ini berlaku juga untuk navigasi ke halaman utama, beda dari sebelumnya
  // yang network-first (nunggu network dulu, cache cuma fallback).
  event.respondWith(
    caches.match(req).then((cached) => {
      const backgroundUpdate = fetchWithTimeout(req, NETWORK_TIMEOUT_MS)
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Ada di cache -> langsung balikin, update jalan diam-diam.
        backgroundUpdate;
        return cached;
      }

      // Belum ada di cache (mis. load pertama kali / aset baru) -> tunggu
      // network, fallback ke index.html kalau ini navigasi dan network gagal.
      return backgroundUpdate.then((res) => {
        if (res) return res;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

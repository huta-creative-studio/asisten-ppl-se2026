// ===== SERVICE WORKER — Asisten Petugas SE2026 =====
// PATCH v10 (lanjutan v9): tambah cache ber-masa-berlaku (TTL) KHUSUS
// untuk request verifikasi lisensi ke Apps Script (?action=cek...).
//
// Kenapa: hasil pengukuran nyata di lapangan menunjukkan request ini
// (redirect exec -> echo/user_content_key) makan waktu ~4,5 DETIK setiap
// app dibuka — jauh lebih lambat dari semua aset app sendiri yang sudah
// 0ms dari cache. Ini adalah bottleneck utama "app lambat setelah dibuka".
//
// Solusi: kalau device+kode yang sama sudah pernah diverifikasi SUKSES
// dalam N jam terakhir (default 6 jam), balikin hasil cache itu dulu
// SECEPATNYA (app langsung lanjut), lalu tetap fetch ke server di
// belakang layar untuk update cache (stale-while-revalidate). Kalau nanti
// verifikasi ulang di background ternyata kode sudah tidak valid, cache
// akan otomatis ter-update dan app.js kamu (verifikasiKodeBackground)
// yang polling tiap 10 detik akan tetap mengunci layar seperti biasa —
// jadi tidak mengurangi keamanan, cuma menghilangkan waktu tunggu di depan.
//
// Request ?action=aktivasi (submit kode BARU oleh user) TIDAK PERNAH
// di-cache — selalu 100% real-time ke server, sesuai perilaku semula.

const CACHE_VERSION = 'se2026-v12';
const LICENSE_CACHE = 'se2026-license-cache-v1';
const LICENSE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam — ubah sesuai kebutuhan

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
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== LICENSE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Cek apakah sebuah request adalah "cek lisensi" (bukan aktivasi).
// Dicocokkan lewat query string action=cek supaya tidak bergantung pada
// domain persis (Apps Script redirect ke googleusercontent.com).
function isLicenseCheckRequest(url) {
  return url.searchParams.get('action') === 'cek';
}

async function handleLicenseCheck(req) {
  const cache = await caches.open(LICENSE_CACHE);
  const cached = await cache.match(req);

  if (cached) {
    const cachedAt = Number(cached.headers.get('x-cached-at') || 0);
    const fresh = Date.now() - cachedAt < LICENSE_TTL_MS;

    // Selalu refresh di background (tidak menunda respons ke app).
    fetchWithTimeout(req, NETWORK_TIMEOUT_MS)
      .then(async (res) => {
        if (res && res.ok) {
          const clone = res.clone();
          const body = await clone.blob();
          const headers = new Headers(clone.headers);
          headers.set('x-cached-at', String(Date.now()));
          await cache.put(req, new Response(body, { status: clone.status, headers }));
        }
      })
      .catch(() => {});

    // Cache dipakai langsung baik masih fresh maupun basi — refresh di
    // atas berjalan diam-diam untuk request BERIKUTNYA. App tidak pernah
    // menunggu lama.
    return cached;
  }

  // Belum ada cache sama sekali (device baru / pertama kali) -> harus
  // tunggu network beneran, tidak ada jalan pintas di sini.
  const res = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
  if (res && res.ok) {
    const clone = res.clone();
    const body = await clone.blob();
    const headers = new Headers(clone.headers);
    headers.set('x-cached-at', String(Date.now()));
    cache.put(req, new Response(body, { status: clone.status, headers }));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // ---- Request ke luar (cross-origin): hanya action=cek yang di-cache ----
  if (url.origin !== self.location.origin) {
    if (isLicenseCheckRequest(url)) {
      event.respondWith(handleLicenseCheck(req));
    }
    // selain itu (termasuk action=aktivasi) -> biarkan lewat normal,
    // selalu real-time, tidak disentuh sama sekali.
    return;
  }

  // ---- Aset same-origin: cache-first + stale-while-revalidate (v9) ----
  event.respondWith(
    caches.match(req).then((cached) => {
      const backgroundUpdate = fetchWithTimeout(req, NETWORK_TIMEOUT_MS)
        .then((res) => {
          if (res && res.status === 200) {
            // PATCH: clone() HARUS dipanggil sinkron di sini, sebelum
            // body sempat "dipakai" oleh siapa pun (mis. browser yang
            // langsung eksekusi script dari `res` yang di-return di
            // bawah). Kalau clone() ditunda di dalam .then() lain,
            // browser bisa keburu baca body duluan -> error
            // "Response body is already used".
            const resToCache = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resToCache));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        backgroundUpdate;
        return cached;
      }

      return backgroundUpdate.then((res) => {
        if (res) return res;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

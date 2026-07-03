// ===== SISTEM AKTIVASI KODE (1 KODE = 1 PERANGKAT) =====
// GANTI URL INI dengan URL Web App dari Google Apps Script Anda
const URL_APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbzUMVTcWHvlpRiWK7runS6kg0tZrdmEzLJvKjCgenKGm3pZkc4hbfaASmP-bd5tb3j6sw/exec';

const LOCK_STORAGE_KEY = 'se2026_kode_aktif_v1';
const DEVICE_ID_KEY = 'se2026_device_uuid_v1';

const lockScreen = document.getElementById('lockScreen');
const lockBox    = document.getElementById('lockBox');
const inputKode  = document.getElementById('kodeAkses');
const lockMsg    = document.getElementById('lockMsg');
const btnAktivasi = document.getElementById('btnAktivasi');

// Flag global: dibaca oleh app.js untuk memblokir aksi simpan/export
// sebelum aplikasi benar-benar diaktivasi (lapisan tambahan, bukan pengganti
// verifikasi server — client-side tidak bisa 100% anti-bypass).
window.__appUnlocked = false;

// ID perangkat PERSISTEN & unik (dibuat sekali, disimpan selamanya) — dipakai
// sebagai fingerprint yang dikirim ke Apps Script supaya penegakan "1 kode =
// 1 perangkat" lebih akurat. Fingerprint lama (User-Agent + ukuran layar)
// terlalu mudah sama di banyak HP dengan merk/model identik, sehingga kode
// bisa dipakai bersamaan di banyak perangkat tanpa terdeteksi.
function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id) return id;
  if (window.crypto && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else {
    id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
  return id;
}

function getDeviceFingerprint() {
  const uuid = getOrCreateDeviceId();
  const ua = navigator.userAgent.substring(0, 60);
  const screenInfo = `${window.screen.width}x${window.screen.height}`;
  const extra = [navigator.platform || '', navigator.language || '', (navigator.hardwareConcurrency || '')].join('|');
  return `${uuid} :: ${ua} | ${screenInfo} | ${extra}`;
}

// Cek apakah HP ini sudah pernah aktivasi sebelumnya
// PATCH PERFORMA: jangan blocking-wait ke server saat startup (Apps Script sering
// lambat 2-6 detik). Percaya localStorage dulu supaya app langsung terbuka,
// lalu verifikasi ke server di BACKGROUND (non-blocking) dengan timeout singkat.
// Kalau server bilang kode tidak valid -> baru dikunci ulang belakangan.
(function initLock() {
  const tersimpan = localStorage.getItem(LOCK_STORAGE_KEY);

  if (!tersimpan) {
    // Belum pernah aktivasi -> tampilkan lock screen
    return;
  }

  // Sudah pernah aktivasi di HP ini -> langsung buka app tanpa menunggu server.
  window.__appUnlocked = true;
  lockScreen.classList.add('hidden');

  // Offline -> cukup percaya localStorage, tidak perlu verifikasi ke server.
  if (!navigator.onLine) return;

  // Verifikasi ulang ke server di background (tidak menahan tampilan app).
  verifikasiKodeBackground(tersimpan);
})();

// Watchdog ringan: kalau seseorang mencoba menyembunyikan lockScreen lewat
// devtools tanpa aktivasi valid (localStorage kosong), kunci ulang otomatis.
// Ini bukan proteksi mutlak (client-side selalu bisa dilewati oleh yang paham
// devtools), tapi cukup untuk mencegah penyalinan/pengoperan kasual.
setInterval(function () {
  if (!window.__appUnlocked) return;
  const tersimpan = localStorage.getItem(LOCK_STORAGE_KEY);
  if (!tersimpan) {
    window.__appUnlocked = false;
    lockScreen.classList.remove('hidden');
  }
}, 4000);

async function verifikasiKodeBackground(tersimpan) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // max 5 detik nunggu server

  try {
    const device = encodeURIComponent(getDeviceFingerprint());
    const url = `${URL_APPS_SCRIPT}?action=cek&kode=${encodeURIComponent(tersimpan)}&device=${device}`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();

    if (data.success && data.status === 'aktif') {
      // Kode ini memang yang mengaktifkan -> tetap terbuka, tidak perlu apa-apa.
      return;
    }

    // Status 'belum', 'aktif_beda_device', atau lainnya -> kode tidak valid lagi,
    // kunci ulang aplikasi dan minta kode baru.
    window.__appUnlocked = false;
    localStorage.removeItem(LOCK_STORAGE_KEY);
    lockScreen.classList.remove('hidden');
    showLockMsg('⚠️ Sesi aktivasi berakhir, silakan masukkan kode lagi.', 'error');
  } catch (err) {
    // Gagal/timeout menghubungi server -> tetap percaya localStorage,
    // jangan kunci user yang sedang bekerja offline/koneksi lemah di lapangan.
  } finally {
    clearTimeout(timeoutId);
  }
}

function showLockMsg(text, type) {
  lockMsg.textContent = text;
  lockMsg.className = 'lock-msg show ' + type;
}

function setLockLoading(loading) {
  btnAktivasi.disabled = loading;
  btnAktivasi.innerHTML = loading
    ? '<span class="lock-spinner"></span>Memeriksa...'
    : 'Buka Aplikasi';
}

async function aktivasiKode() {
  const kode = inputKode.value.trim().toUpperCase();

  if (!kode) {
    showLockMsg('⚠️ Masukkan kode akses terlebih dahulu.', 'error');
    return;
  }

  if (URL_APPS_SCRIPT === 'GANTI_URL_APPS_SCRIPT') {
    showLockMsg('⚠️ Sistem belum dikonfigurasi. Hubungi admin.', 'error');
    return;
  }

  if (!navigator.onLine) {
    showLockMsg('⚠️ Aktivasi pertama kali butuh koneksi internet. Sambungkan ke WiFi/data lalu coba lagi.', 'error');
    return;
  }

  setLockLoading(true);
  lockMsg.classList.remove('show');

  try {
    const device = encodeURIComponent(getDeviceFingerprint());
    const url = `${URL_APPS_SCRIPT}?action=aktivasi&kode=${encodeURIComponent(kode)}&device=${device}`;

    const res = await fetch(url);
    const data = await res.json();

    setLockLoading(false);

    if (data.success) {
      localStorage.setItem(LOCK_STORAGE_KEY, kode);
      window.__appUnlocked = true;
      showLockMsg('✅ Aktivasi berhasil! Membuka aplikasi...', 'info');
      setTimeout(() => {
        lockScreen.classList.add('hidden');
      }, 800);
    } else {
      showLockMsg('⚠️ ' + (data.message || 'Kode tidak valid.'), 'error');
      lockBox.style.animation = 'none';
      setTimeout(() => { lockBox.style.animation = 'shake 0.3s'; }, 10);
    }
  } catch (err) {
    setLockLoading(false);
    showLockMsg('⚠️ Gagal menghubungi server. Periksa koneksi internet dan coba lagi.', 'error');
  }
}

inputKode.addEventListener('keypress', e => { if (e.key === 'Enter') aktivasiKode(); });
window.aktivasiKode = aktivasiKode;

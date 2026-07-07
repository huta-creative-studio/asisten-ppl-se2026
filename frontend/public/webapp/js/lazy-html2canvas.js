// ===== LAZY LOADER html2canvas — Asisten Petugas SE2026 =====
// html2canvas.min.js ukurannya ~196KB (hampir separuh total ukuran app).
// Sebelumnya file ini dimuat di SETIAP kali app dibuka lewat <script defer>
// di index.html, padahal cuma dipakai saat user menekan tombol
// "simpan/ekspor gambar" (screenshotResponden) di tab Riwayat.
//
// File ini menggantikan <script src="./js/vendor/html2canvas.min.js" defer>
// di index.html. Taruh <script src="./js/lazy-html2canvas.js"></script>
// SETELAH app.min.js dimuat (supaya window.screenshotResponden sudah ada).
//
// html2canvas baru benar-benar diunduh browser saat pertama kali dibutuhkan.
// Setelah itu Service Worker otomatis menyimpannya di cache, jadi
// pemakaian berikutnya tetap cepat / bisa offline.

(function () {
  const SCRIPT_SRC = './js/vendor/html2canvas.min.js';
  let loadingPromise = null;

  function loadHtml2Canvas() {
    if (typeof window.html2canvas !== 'undefined') {
      return Promise.resolve();
    }
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.onload = () => resolve();
      s.onerror = () => {
        loadingPromise = null;
        reject(new Error('Gagal memuat html2canvas'));
      };
      document.body.appendChild(s);
    });

    return loadingPromise;
  }

  function wrapScreenshotResponden() {
    const original = window.screenshotResponden;
    if (typeof original !== 'function') {
      // app.min.js belum sempat mendefinisikan fungsinya, coba lagi sebentar.
      setTimeout(wrapScreenshotResponden, 200);
      return;
    }

    window.screenshotResponden = async function (...args) {
      try {
        if (typeof window.showToast === 'function' && typeof window.html2canvas === 'undefined') {
          window.showToast('📦 Menyiapkan fitur simpan gambar…');
        }
        await loadHtml2Canvas();
      } catch (e) {
        if (typeof window.showToast === 'function') {
          window.showToast('⚠️ Gagal memuat fitur simpan gambar, cek koneksi');
        }
        return;
      }
      return original.apply(this, args);
    };
  }

  wrapScreenshotResponden();

  // Opsional: kalau user online dan sempat idle (tidak buru-buru), preload
  // diam-diam di background setelah beberapa detik supaya saat tombol
  // ditekan nanti sudah siap. Tidak menunda apa pun di initial load.
  window.addEventListener('load', () => {
    if (navigator.onLine) {
      setTimeout(() => loadHtml2Canvas().catch(() => {}), 8000);
    }
  });
})();

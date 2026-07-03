# PRD — Asisten Petugas SE2026 (PWA Web App)

## Problem Statement (Asli, dari user)
- perbaiki aplikasi web app ini agar bisa lebih ringan namun tetap bisa digunakan
  secara offline dan semua fungsi bisa tetap digunakan
- buat agar aplikasi web app ini tidak mudah di duplikasi oleh orang lain
- cek kekurangan logika dalam semua perhitungan yang ada dan tanya dulu kepada
  saya mengenai logika perhitungan yang belum benar

Sumber: 1 file HTML tunggal (index.html, ~304KB, inline CSS+JS) diupload user —
aplikasi "Asisten Petugas SE2026", alat bantu petugas sensus ekonomi BPS untuk
mengisi FASIH (omzet usaha, biaya usaha Rincian 26, nilai aset Rincian 28,
pendapatan RT Rincian 18.a, belanja RT, konverter waktu & margin/HPP).

## User Choices (dikonfirmasi via ask_human)
1. Platform: tetap **standalone HTML/CSS/JS PWA** (BUKAN dikonversi ke Expo/RN).
   Di-hosting sebagai static file di dalam repo Expo ini (`/app/frontend/public/webapp/`).
2. Anti-duplikasi: perkuat lock-screen kode akses + minifikasi/obfuscation kode
   (bukan domain-lock).
3. Ringan+offline: pisah CSS/JS ke file terpisah + service worker + minifikasi.
4. Bug kalkulasi yang dikonfirmasi user: "laba usaha yang rugi (minus) di tab
   Pendapatan terlihat seperti pemasukan (+)".

## Arsitektur
- **Source (readable, tidak diserve langsung):** `/app/webapp-src/`
  - `index.html`, `css/styles.css`, `js/app.js`, `js/lock.js`, `js/pwa.js`,
    `js/vendor/html2canvas.min.js`, `manifest.json`, `sw.js`, `icons/*.png`
  - `build.sh` — pipeline minify (terser/clean-css/html-minifier-terser) +
    obfuscate (javascript-obfuscator, hanya untuk lock.js & pwa.js) → output ke dist.
- **Dist (yang benar-benar disajikan ke user):** `/app/frontend/public/webapp/`
  (dihasilkan oleh `bash /app/webapp-src/build.sh`, JANGAN diedit manual —
  edit source lalu build ulang)
- **Entry point:** `/app/frontend/app/index.tsx` — di web, redirect otomatis ke
  `/webapp/index.html`. Expo app itu sendiri tidak dipakai untuk fitur ini.

## Yang Sudah Dikerjakan (2026-02)
1. **Restrukturisasi file** — HTML/CSS/JS inline dipisah jadi file terpisah
   (styles.css, app.js, lock.js, pwa.js) → bisa di-cache browser terpisah.
2. **Service worker + manifest.json dibuat dari nol** — sebelumnya file ini
   DIREFERENSIKAN di HTML tapi tidak pernah ada, jadi PWA offline SEBENARNYA
   TIDAK PERNAH BERFUNGSI di versi asli. Sekarang app-shell (HTML/CSS/JS/icons)
   ter-cache dan terverifikasi bisa full-reload saat offline.
3. **html2canvas dibundel lokal** (sebelumnya load dari CDN cdnjs.cloudflare.com
   — gagal kalau offline). Sekarang 100% lokal.
4. **Dedup kode PWA install banner** — sebelumnya ada 2 listener
   `beforeinstallprompt` terpisah (duplikat/boros), disatukan jadi 1 di pwa.js.
5. **Perkuat lock screen**: fingerprint device sekarang persisten (UUID
   tersimpan permanen di localStorage) + kombinasi signal lain, bukan cuma
   User-Agent+ukuran screen (dulu terlalu mudah sama antar HP model sama).
   Tambah watchdog ringan yang re-lock otomatis kalau localStorage kode
   dihapus manual via devtools.
6. **Minifikasi & obfuscation (trade-off ukuran vs proteksi didokumentasikan)**:
   - `app.js` (business logic besar, ~4300 baris): HANYA diminify (terser).
     javascript-obfuscator diuji tapi JUSTRU MEMBESARKAN file 1.5-3x (nama hex
     lebih panjang dari nama hasil mangle terser + overhead decoder), jadi
     TIDAK dipakai di file ini demi tujuan "ringan".
   - `lock.js` & `pwa.js` (kecil, `lock.js` = logic aktivasi paling sensitif):
     diobfuscate penuh (string-array + control-flow-flattening) — cost ukuran
     kecil, manfaat proteksi besar untuk bagian anti-duplikasi paling kritis.
   - Nama fungsi top-level TETAP tidak diubah (renameGlobals:false) supaya
     ~121 `onclick="..."` inline di HTML tetap berfungsi.
7. **2 bug kalkulasi diperbaiki** (dikonfirmasi user sebelum fix):
   - **Bug A**: `window._lastTahunan` dibaca di 2 tempat (Simpan Semua &
     hitung Surplus/Defisit Pendapatan) tapi yang benar-benar diisi adalah
     `window._lastTahunanByKey[key]`. Akibatnya: (1) data "Belanja RT Tahunan"
     gagal tersimpan total saat klik Simpan Semua, (2) Belanja RT/Bulan di tab
     Pendapatan selalu mengabaikan pengeluaran tahunan÷12 → Surplus terlihat
     lebih besar dari kenyataan. FIXED — user memilih "perbaiki ke depannya
     saja" (tidak perlu backfill riwayat lama).
   - **Bug B**: Di ringkasan tab Pendapatan, laba usaha yang dialokasikan ke
     anggota SELALU tampil dengan tanda "+" hijau walau usaha itu rugi/minus.
     Sekarang sign-aware: rugi → "−" merah, untung → "+" hijau.
8. Hasil ukuran: gzip app-shell (HTML+CSS+3 JS) turun dari ~63KB → ~47KB
   (~25% lebih ringan), PLUS sekarang benar-benar bisa offline (sebelumnya rusak).
9. Testing agent (frontend-only, backend tidak relevan untuk fitur ini):
   SEMUA test PASS — regresi semua tab, 2 bugfix terverifikasi, SW+offline
   reload terverifikasi, tidak ada onclick binding yang rusak akibat
   minifikasi/obfuscation.

## Known Limitation (harus disampaikan ke user)
- Proteksi anti-duplikasi client-side TIDAK PERNAH 100% anti-bypass — orang yang
  paham devtools/JS tetap bisa membaca app.js (hanya diminify, tidak
  diobfuscate, demi ringan) dan secara teori memodifikasi/menghapus lock.js.
  Lapisan paling kuat tetap di server (Google Apps Script) yang memvalidasi
  device fingerprint — itu di luar kendali repo ini.
- Data riwayat yang SUDAH tersimpan SEBELUM fix Bug A (kalau ada) mungkin masih
  kehilangan komponen "Belanja RT Tahunan" — user memilih untuk tidak
  membackfill data lama.

## Next Steps / Backlog
- P1: Jika user mau, tambahkan fitur "cek riwayat lama" untuk deteksi/perbaiki
  data yang terkena Bug A sebelum tanggal fix ini.
- P2: Pertimbangkan minifikasi tambahan pada index.html markup 5x usaha (saat
  ini duplikat manual utk Usaha 1-5 — bisa direfactor jadi template JS-generated
  di masa depan untuk lebih ringan lagi, tapi berisiko tinggi untuk saat ini).
- P2: UX minor — tombol "+ Responden Baru" mereset "Jumlah Usaha" balik ke 0
  (temuan testing agent, non-blocking).

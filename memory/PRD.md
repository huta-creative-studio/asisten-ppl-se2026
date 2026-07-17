# PRD — Halaman Admin OCR KK/KTP (ocrkkktp.html) — asisten-se2026

## Problem Statement (asli)
Menyempurnakan Admin Page pendataan responden `ocrkkktp.html` pada repo
`huta-creative-studio/asisten-se2026` (static PWA, GitHub Pages, backend
Google Apps Script + Gemini/Cloud Vision OCR + Google Drive storage).
Database halaman ini TUNGGAL — terpisah dari Asisten PPL lain di repo.

Requirement:
1. Halaman utama: daftar responden tersimpan, empty state jika kosong,
   tombol + pojok kanan bawah untuk buka form kosong.
2. Form 6 tab (auto-tersembunyi kecuali yang aktif):
   Tab1 Scan KK (kamera/galeri, OCR, simpan ke Drive folder nama responden)
   Tab2 Scan KTP (kamera/galeri, OCR, cocokkan nama/NIK/tgl lahir vs KK)
   Tab3 Pencocokan Pendidikan (KK vs kondisi lapangan)
   Tab4 Nomor Meter PLN (manual)
   Tab5 Foto Rumah (depan + ruang tamu, simpan ke Drive, tanpa OCR)
   Tab6 Geolokasi (deteksi GPS otomatis + tombol salin koordinat)
3. Setelah Simpan → form ditutup, daftar responden muncul lagi dengan data baru.

## Arsitektur
- Frontend: static HTML/CSS/JS, di-deploy via GitHub Pages
  (`frontend/public/webapp/`), tidak ada build step.
- File utama yang diubah: `ocrkkktp.html`, `js/ocr-kk-ktp.min.js`,
  `css/styles.min.css` (+CSS baru untuk FAB/card/tab/geo), `sw.js`
  (cache version bump v22→v23).
- Auth & guard: `js/auth.min.js` (tidak diubah).
- Backend: Google Apps Script (Code.gs) terpisah dari repo ini — user
  kelola manual di script.google.com. OCR: Gemini (lapis 1) → Cloud
  Vision (lapis 2) → Drive OCR legacy (lapis 3). Storage: Google Drive,
  1 folder per nama responden (`SE2026_DokumenKK_KTP/<nama>/`).
- Data device: localStorage key `se2026_ocrRespondenDB`, sync manual ke
  Drive lewat action `simpanmeta`/`ambilmeta`/`daftarresponden` (JSON
  bebas, tidak perlu skema backend baru untuk field baru di frontend).

## Yang sudah diimplementasikan (2026-07-17)
- Rewrite total `ocrkkktp.html` + `js/ocr-kk-ktp.min.js`: 2-view (daftar ↔
  form), 6-tab form, FAB tambah, empty state, kartu responden dengan
  status badge (KK/KTP/Pendidikan/Meteran/Foto Rumah/Geo), hapus dari
  daftar & dari dalam form, edit responden existing (re-buka form terisi).
- Tab1/2: dual input kamera (`capture=environment`) & galeri terpisah.
- Tab2: perbandingan Nama, NIK, DAN Tanggal Lahir vs KK (field baru).
- Tab5: foto rumah diunggah langsung ke Drive via action backend BARU
  `simpanfotoumum` (tanpa OCR, hemat kuota Gemini/Vision).
- Tab6: `navigator.geolocation`, tampil lat/lng+akurasi, tombol salin
  clipboard (dengan fallback `execCommand`).
- CSS baru: `.fab-btn`, `.responden-card`, `.status-badge`,
  `.photo-capture-btn`, `.geo-coord-box`, `.back-btn`.
- Diverifikasi via screenshot lokal (python http.server + Playwright,
  session admin di-mock lewat localStorage): list empty state → form →
  6 tab semua bisa dibuka/tutup → simpan → kartu baru muncul dengan
  badge benar → re-open edit terisi ulang. Alur backend (OCR/Drive
  Vision/Gemini) TIDAK bisa diuji end-to-end di sandbox ini (butuh kode
  aktivasi asli + Apps Script live).

## PENTING — Perubahan Backend (Code.gs) yang WAJIB user tempel manual
Backend Google Apps Script berada di luar repo ini (user kelola sendiri
di script.google.com). Agent TIDAK bisa deploy ke sana. User harus
menempel patch berikut ke `Code.gs` lalu Deploy → Manage deployments →
New version:
1. Fungsi baru `simpanFotoUmum(body)` — simpan foto (foto rumah) ke
   folder Drive responden TANPA OCR.
2. Tambah case `action === 'simpanfotoumum'` di dispatcher `doPost`.
3. Fix `konversiGeminiKeFieldsKK`: field `tanggal_lahir` per anggota
   (sudah ada di skema prompt Gemini, tapi belum di-mapping ke fields).
4. Tambah field `tanggal_lahir` terpisah di prompt & konversi KTP
   (`promptKTP`, `konversiGeminiKeFieldsKTP`) supaya bisa dibandingkan
   dengan tanggal lahir KK di Tab2.
5. `parseTeksKTP` (fallback non-Gemini): best-effort ekstrak tanggal
   lahir dari `tempat_tgl_lahir`.
Patch lengkap sudah diberikan ke user di chat — BELUM ditempel/redeploy
oleh user per akhir sesi ini.

## Yang sudah diimplementasikan (2026-07-17, sesi 2)
- `ocrkkktp.html` + `js/ocr-kk-ktp.min.js`: tambah search bar di atas
  daftar responden (`#searchResponden`), filter live berdasarkan nama,
  empty-state khusus "tidak ada hasil pencarian" (beda dari empty-state
  "belum ada data sama sekali"). Tidak ada perubahan backend.
- `assistencalc.html`/`js/app.min.js`: FIX bug `respondenAktif` basi
  (stale) di `pushOrReplaceRiwayat()` — sebelumnya kalau user ganti nama
  responden di form tanpa klik "+ Responden Baru", data baru bisa
  tertulis ke profil LAMA (karena variabel global `respondenAktif` tidak
  disinkronkan ulang ke nama yang sedang disimpan). Sekarang key
  `respondenAktif` selalu dicocokkan ulang ke `namaToKey(a.nama)` data
  yang sedang disimpan sebelum ditulis ke `respondenDB`. Diverifikasi via
  simulasi langsung (profil A tetap utuh, profil B baru terbentuk benar,
  `respondenAktif` berpindah ke B) — lihat screenshot sesi ini.
- DITUNDA (user minta skip untuk saat ini): fix "hapus responden tidak
  hapus data online" di `assistencalc.html` — root cause & rencana fix
  sudah dianalisis (lihat riwayat chat), tapi belum dikerjakan karena user
  memilih fokus ke search bar + bug respondenAktif dulu.

## Backlog / Next steps
- P0 (ditunda oleh user): Hapus responden di `assistencalc.html` hanya
  hapus lokal, belum hapus data online (Google Apps Script action
  `"upload"` — perlu konfirmasi apakah replace/merge di Code.gs sebelum
  fix, atau tambah action baru `"hapusresponden"`).
- P0: User tempel & redeploy patch Code.gs (sesi sebelumnya) — wajib agar
  Tab5 foto rumah & perbandingan tanggal lahir Tab2 di `ocrkkktp.html`
  berfungsi.
- P1: Uji end-to-end pakai kode aktivasi admin asli & foto KK/KTP nyata.
- P2: Opsional — tambah preview thumbnail foto KK/KTP tersimpan di kartu
  daftar responden (saat ini hanya badge status, belum thumbnail).
- P2: Opsional — validasi format NIK (16 digit) & duplikasi nama
  responden saat simpan.

## Kredensial
Tidak ada akun user/password (auth berbasis kode aktivasi dari Google
Sheet, dikelola lewat halaman admin generate-kode terpisah). Lihat
`test_credentials.md`.

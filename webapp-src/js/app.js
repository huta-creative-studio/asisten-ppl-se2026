// ===== STATE =====
let jenisUsahaMap = {};
let biayaCounter = 0;
let riwayat = JSON.parse(localStorage.getItem('se2026_riwayat') || '[]');

// === Geo-tagging state (per session/responden) ===
let _geoData = null; // {lat, lon, accuracy, waktu}

// === Auto-save draft state ===
let _autoSaveInterval = null;
const DRAFT_KEY = 'se2026_draft_v1';

/* =====================================================================
 * RESPONDEN-BASED DATA MODEL (refactor)
 * - respondenDB[KEY] = full record  (KEY = uppercase nama, trimmed)
 * - respondenAktif   = current KEY  (null saat "Mulai Responden Baru" / awal)
 * - Setiap simpanRiwayat* memerge field-field hasil ke profil aktif
 * - Tab Riwayat menampilkan per-responden (bukan per-entry)
 * ===================================================================== */
// ===== NEW: DATA MODEL UNTUK “1 KELUARGA BANYAK USAHA” (mode awal) =====
// Simpan keluarga dan di dalamnya usaha-usaha.
// Belanja RT & Pendapatan RT akan dipertahankan versi lama dulu (belum di-refactor penuh)
let keluargaDB = JSON.parse(localStorage.getItem('se2026_keluargaDB') || '{}');
let keluargaAktifKey = localStorage.getItem('se2026_keluargaAktifKey') || null;
let usahaAktifId = localStorage.getItem('se2026_usahaAktifId') || null;
let usahaIndexAktif = 1; // Track active inner usaha tab (1-5)

function namaKeluargaToKey(nama) {
  if (!nama) return null;
  const t = String(nama).trim().toUpperCase();
  return t.length ? t : null;
}

function ensureKeluargaAktif(namaKeluargaAsli) {
  if (!keluargaAktifKey) return null;
  if (!keluargaDB[keluargaAktifKey]) {
    keluargaDB[keluargaAktifKey] = {
      _key: keluargaAktifKey,
      namaKeluarga: namaKeluargaAsli || keluargaAktifKey,
      waktuPertama: new Date().toLocaleString('id-ID'),
      waktuUpdate: new Date().toLocaleString('id-ID'),
      usahaDaftar: {}
    };
  }
  return keluargaDB[keluargaAktifKey];
}

function persistKeluargaDB() {
  localStorage.setItem('se2026_keluargaDB', JSON.stringify(keluargaDB));
  if (keluargaAktifKey) localStorage.setItem('se2026_keluargaAktifKey', keluargaAktifKey);
  else localStorage.removeItem('se2026_keluargaAktifKey');
  if (usahaAktifId) localStorage.setItem('se2026_usahaAktifId', usahaAktifId);
  else localStorage.removeItem('se2026_usahaAktifId');
}

function ensureUsahaAktif(namaUsahaAsli) {
  const k = ensureKeluargaAktif((document.getElementById('namaUsaha') || {}).value || '');
  if (!k) return null;
  if (!usahaAktifId) {
    // Buat usaha default
    const defaultId = 'usaha-1';
    usahaAktifId = defaultId;
    k.usahaDaftar[usahaAktifId] = k.usahaDaftar[usahaAktifId] || {
      id: usahaAktifId,
      namaUsaha: namaUsahaAsli || 'Usaha 1'
    };
    persistKeluargaDB();
  } else {
    if (!k.usahaDaftar[usahaAktifId]) {
      k.usahaDaftar[usahaAktifId] = { id: usahaAktifId, namaUsaha: namaUsahaAsli || usahaAktifId };
      persistKeluargaDB();
    }
  }
  return k.usahaDaftar[usahaAktifId];
}

function renderUsahaAktifUI() {
  const sel = document.getElementById('usahaAktifSelect');
  const btnTambah = document.getElementById('btnTambahUsaha');
  if (!sel || !btnTambah) return;

  if (!keluargaAktifKey || !keluargaDB[keluargaAktifKey]) {
    btnTambah.disabled = true;
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— Set keluarga dulu —';
    sel.appendChild(opt);
    usahaAktifId = null;
    return;
  }


  sel.innerHTML = '';
  btnTambah.disabled = false;

  const usahaDaftar = keluargaDB[keluargaAktifKey].usahaDaftar || {};
  const keys = Object.keys(usahaDaftar);
  if (!keys.length) {
    btnTambah.disabled = false;
    const opt = document.createElement('option');
    opt.value = 'usaha-1';
    opt.textContent = 'Usaha 1 (buat dulu)';
    sel.appendChild(opt);
    return;
  }
  keys.forEach(id => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `Usaha: ${(usahaDaftar[id].namaUsaha || id)}`;
    if (id === usahaAktifId) o.selected = true;
    sel.appendChild(o);
  });
}

function setUsahaAktif(id) {
  usahaAktifId = id;
  persistKeluargaDB();
  renderUsahaAktifUI();
  showToast('✅ Usaha aktif: ' + id);
  shotToast('hapusUsaha() untuk hapus usaha ini');
}

function tambahUsahaDalamKeluarga() {
  const namaKeluarga = (document.getElementById('namaUsaha') || {}).value || '';
  const kKey = namaKeluargaToKey(namaKeluarga);
  if (!kKey) { showToast('⚠️ Isi Nama Keluarga dulu'); return; }
  keluargaAktifKey = kKey;
  ensureKeluargaAktif(namaKeluarga);

  const k = keluargaDB[keluargaAktifKey];
  const usahaDaftar = k.usahaDaftar || (k.usahaDaftar = {});
  const nextIndex = Object.keys(usahaDaftar).length + 1;
  const id = 'usaha-' + nextIndex;
  usahaDaftar[id] = { id, namaUsaha: 'Usaha ' + nextIndex };
  usahaAktifId = id;
  persistKeluargaDB();
  renderUsahaAktifUI();
  showToast('➕ Tambah ' + id);
  showToast('✅ Usaha aktif: ' + id);
  shotToast('hapusUsaha() untuk hapus usaha ini');
}

// ===== legacy: respondenDB/respondenAktif dipertahankan agar Belanja RT & Pendapatan masih jalan =====
let respondenDB     = JSON.parse(localStorage.getItem('se2026_respondenDB') || '{}');
let respondenAktif  = localStorage.getItem('se2026_respondenAktif') || null;

function persistRespondenDB() {
  localStorage.setItem('se2026_respondenDB', JSON.stringify(respondenDB));
  if (respondenAktif) localStorage.setItem('se2026_respondenAktif', respondenAktif);
  else                localStorage.removeItem('se2026_respondenAktif');
}

// Normalisasi nama → uppercase trimmed (jadi key). Kosong → null.
function namaToKey(nama) {
  if (!nama) return null;
  const t = String(nama).trim().toUpperCase();
  return t.length ? t : null;
}

// Pastikan profil aktif ada — kalau belum, bikin object kosong dengan nama-nya.
function ensureAktif(namaAsli) {
  if (!respondenAktif) return null;
  if (!respondenDB[respondenAktif]) {
    respondenDB[respondenAktif] = {
      _key: respondenAktif,
      nama: namaAsli || respondenAktif,
      waktuPertama: new Date().toLocaleString('id-ID'),
      waktuUpdate:  new Date().toLocaleString('id-ID')
    };
  }
  return respondenDB[respondenAktif];
}

// Merge updates ke profil aktif (dipakai oleh semua simpanRiwayat*).
function mergeAktif(updates) {
  if (!respondenAktif) {
    // Coba derive dari namaUsaha field
    const n = (document.getElementById('namaUsaha') || {}).value || '';
    const k = namaToKey(n);
    if (!k) { showToast('⚠️ Isi Nama Usaha dulu untuk membuat profil'); return false; }
    respondenAktif = k;
    ensureAktif(n);
  }
  const r = ensureAktif(updates.nama);
  Object.assign(r, updates, { waktuUpdate: new Date().toLocaleString('id-ID') });
  persistRespondenDB();
  renderRespondenAktifBar();
  return true;
}

// Update banner "Responden Aktif"
function renderRespondenAktifBar() {
  const bar = document.getElementById('respondenAktifBar');
  if (!bar) return;
  if (respondenAktif && respondenDB[respondenAktif]) {
    const r = respondenDB[respondenAktif];
    bar.classList.remove('kosong');
    document.getElementById('raNama').textContent = r.nama;
    const partsList = [];
    if (r.kalkulator)  partsList.push('Kalkulator');
    if (r.rincian26)   partsList.push('Biaya Usaha');
    if (r.rincian28)   partsList.push('Aset');
    if (r.belanjaRT)   partsList.push('Belanja RT');
    if (r.pendapatan)  partsList.push('Pendapatan');
    document.getElementById('raInfo').textContent =
      partsList.length ? '✓ ' + partsList.join(', ') + ' tersimpan' : 'Profil siap diisi…';
  } else {
    bar.classList.add('kosong');
    document.getElementById('raNama').textContent = 'Belum ada responden aktif';
    document.getElementById('raInfo').textContent = 'Isi Nama Usaha di bawah untuk memulai';
  }
}

// Saat Nama Usaha diketik
function onNamaUsahaInput() {
  // Live preview di banner (tanpa commit)
  const nama = document.getElementById('namaUsaha').value;
  const key = namaToKey(nama);
  if (!respondenAktif && key) {
    // Belum ada profil aktif → preview saja, baru commit di onBlur
    document.getElementById('raNama').textContent = nama + ' (akan dimulai…)';
  }
}

// Saat field nama kehilangan fokus → commit profil aktif
function onNamaUsahaBlur() {
  // ===== NEW: saat nama keluarga disetel, render dropdown usaha aktif =====
  try { 
    const namaKeluarga = (document.getElementById('namaUsaha') || {}).value || '';
    const kKey = namaKeluargaToKey(namaKeluarga);
    if (kKey) {
      keluargaAktifKey = kKey;
      ensureKeluargaAktif(namaKeluarga);
      renderUsahaAktifUI();
      // pastikan usaha aktif minimal ada
      ensureUsahaAktif(namaKeluarga);
      renderUsahaAktifUI();
    }
  } catch(e){}

  const namaAsli = document.getElementById('namaUsaha').value.trim();
  const newKey = namaToKey(namaAsli);
  if (!newKey) return;

  if (!respondenAktif) {
    // Belum ada profil aktif → langsung jadikan aktif
    respondenAktif = newKey;
    ensureAktif(namaAsli);
    persistRespondenDB();
    renderRespondenAktifBar();
    showToast('👤 Mulai responden: ' + namaAsli);
    return;
  }

  if (respondenAktif === newKey) {
    // Sama, tidak perubahan
    if (respondenDB[respondenAktif]) {
      respondenDB[respondenAktif].nama = namaAsli; // update casing
      persistRespondenDB();
      renderRespondenAktifBar();
    }
    return;
  }

  // Nama berubah ke profil yang BEDA — minta konfirmasi (Choice 4B)
  const namaLama = (respondenDB[respondenAktif] || {}).nama || respondenAktif;
  const punyaProgress = respondenDB[respondenAktif] && Object.keys(respondenDB[respondenAktif]).length > 4;

  if (!punyaProgress) {
    // Belum ada progress → langsung pindah
    delete respondenDB[respondenAktif];
    respondenAktif = newKey;
    ensureAktif(namaAsli);
    persistRespondenDB();
    renderRespondenAktifBar();
    showToast('👤 Berganti ke: ' + namaAsli);
    return;
  }

  const msg = `Profil "${namaLama}" sedang aktif & sudah punya data.\n\n` +
              `Ketik OK untuk SIMPAN profil tersebut & lanjut ke "${namaAsli}".\n` +
              `Ketik Cancel untuk BATAL (nama akan dikembalikan).`;
  if (confirm(msg)) {
    // Simpan profil lama (sudah ada di DB), lalu pindah
    respondenAktif = newKey;
    ensureAktif(namaAsli);
    persistRespondenDB();
    renderRespondenAktifBar();
    showToast('💾 Disimpan. Mulai responden: ' + namaAsli);
  } else {
    // Batal — kembalikan nama
    document.getElementById('namaUsaha').value = namaLama;
  }
}

// Tombol "Mulai Responden Baru"
function mulaiRespondenBaru() {
  const punyaAktif = respondenAktif && respondenDB[respondenAktif] && Object.keys(respondenDB[respondenAktif]).length > 4;
  if (punyaAktif) {
    const namaLama = respondenDB[respondenAktif].nama;
    if (!confirm(`Profil "${namaLama}" akan disimpan otomatis. Mulai responden baru dengan form kosong?`)) return;
  }
  respondenAktif = null;
  persistRespondenDB();
  // Reset SEMUA usaha (1 sd. 5) — bukan cuma usaha #1
  for (let i = 1; i <= 5; i++) {
    try { resetForm(i); } catch(e) { console.warn('resetForm '+i+':', e); }
  }
  // Juga reset semua tab lain
  try { resetMakanan();    } catch(e){}
  try { resetNonMakanan(); } catch(e){}
  try { resetTahunan();    } catch(e){}
  try { resetAset();       } catch(e){}
  try { resetPendapatan(); } catch(e){}
  // Reset geo
  _geoData = null;
  try { renderGeoStatus(); } catch(e){}
  // Reset jumlah usaha ke 0
  try {
    const ju = document.getElementById('jumlahUsaha');
    if (ju) {
      ju.value = '0';
      ju.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch(e){}
  // Hapus draft (karena user explicitly start fresh)
  try { localStorage.removeItem(DRAFT_KEY); } catch(e){}

  // NEW: reset keluarga aktif/usaha aktif (mode awal)
  try {
    keluargaAktifKey = null;
    usahaAktifId = null;
    persistKeluargaDB();
    renderUsahaAktifUI();
  } catch(e){}
  renderRespondenAktifBar();
  showTab('responden');
  showToast('✨ Siap untuk responden baru');
}

// ===== SALIN NOMINAL (tab Biaya Usaha) =====
// Strip semua titik dari teks tampilan & copy ke clipboard. Toast confirm.
function salinNominal(elId, label) {
  const el = document.getElementById(elId);
  if (!el) return;
  // Ambil angka, hilangkan "Rp ", titik, dan spasi
  const raw = el.textContent.replace(/Rp\s*/i, '').replace(/\./g, '').replace(/\s/g, '').trim();
  const num = parseInt(raw, 10);
  if (!num || isNaN(num)) { showToast('⚠️ Belum ada angka untuk disalin'); return; }
  copyToClipboard(String(num));
  showToast(`📋 Nominal ${label} disalin: ${num}`);
}

// ===== SYNC subtotal Kalkulator → Summary di tab Biaya Usaha =====
function syncBiayaUsahaSummary(idx) {
  idx = idx || 1;

  // Pastikan subtotal 26.a-e untuk inner usaha idx ter-update.
  // Kita ambil langsung dari DOM bu26*-subtotal_{idx} (sumber tampilan ringkasan).
  try {
    if (typeof hitungBiayaUsaha === 'function') hitungBiayaUsaha(idx);
  } catch (e) { /* ignore */ }

  const set = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };

  const getValFromDOM = (baseId, i) => {
    // baseId contoh: 'bu26a-subtotal'
    const el = document.getElementById(baseId + '_' + i);
    if (!el) return 0;
    // FIX: prioritaskan data-value (angka mentah per-tahun) yang diisi
    // oleh renderSub()/hitungBiayaUsaha(). textContent elemen ini bisa
    // memuat DUA angka sekaligus, mis. "Rp 42.000.000 (= Rp 3.500.000 /
    // bulan × 12)" — kalau di-parseRp langsung, titik-titik dari kedua
    // angka ikut hilang dan keduanya "menempel" jadi satu angka raksasa
    // (42.000.000 & 3.500.000 -> 420000003500000). Ini penyebab nominal
    // di tab "Biaya Usaha" melonjak ke triliunan.
    if (el.dataset && el.dataset.value !== undefined) {
      const v = parseInt(el.dataset.value, 10);
      return isNaN(v) ? 0 : v;
    }
    const raw = (el.textContent || '').toString();
    return parseRp(raw) || 0;
  };

  // FIX: Ringkasan di tab "Biaya Usaha" harus menjumlahkan SEMUA usaha
  // (1 s.d. jumlahUsaha), bukan cuma usaha yang terakhir disentuh/idx aktif.
  // Sebelumnya fungsi ini hanya mengambil subtotal dari `idx` saja lalu
  // menimpa elemen global sum26a..sum26f, sehingga tampilan ringkasan
  // "berubah-ubah" mengikuti usaha terakhir yang dihitung (terlihat seolah
  // isi Usaha 2..n menjadi sama dengan Usaha 1, atau sebaliknya menimpanya).
  const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 1;

  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (let i = 1; i <= jumlah; i++) {
    a += getValFromDOM('bu26a-subtotal', i);
    b += getValFromDOM('bu26b-subtotal', i);
    c += getValFromDOM('bu26c-subtotal', i);
    d += getValFromDOM('bu26d-subtotal', i);
    e += getValFromDOM('bu26e-subtotal', i);
  }

  const total = a + b + c + d + e;

  set('sum26a', formatRp(a));
  set('sum26b', formatRp(b));
  set('sum26c', formatRp(c));
  set('sum26d', formatRp(d));
  set('sum26e', formatRp(e));
  set('sum26f', formatRp(total));

  set('sum26-terbilang', total > 0 ? terbilang(total) : '');
}



// ===== MIGRASI data lama (array riwayat → respondenDB keyed by nama) =====
function migrateOldRiwayat() {
  if (!riwayat || !riwayat.length) return 0;
  let migrated = 0;
  riwayat.forEach(r => {
    const namaAsli = r.nama || r.nomorKeluarga || 'Tanpa Nama #' + r.id;
    const key = namaToKey(namaAsli);
    if (!key) return;
    if (!respondenDB[key]) {
      respondenDB[key] = { _key: key, nama: namaAsli, waktuPertama: r.waktu, waktuUpdate: r.waktu };
      migrated++;
    }
    const tgt = respondenDB[key];
    if (r.tipe === 'kalkulator' || !r.tipe) {
      tgt.kalkulator = r;
      tgt.pekerjaan  = r.pekerjaan || tgt.pekerjaan;
      tgt.jenis      = r.jenis     || tgt.jenis;
      tgt.kbli       = r.kbli      || tgt.kbli;
    } else if (r.tipe === 'biayausaha') {
      tgt.rincian26 = r;
    } else if (r.tipe === 'nilaiAset') {
      tgt.rincian28 = r;
    } else if (r.tipe === 'makanan' || r.tipe === 'nonmakanan' || r.tipe === 'tahunanrt') {
      tgt.belanjaRT = tgt.belanjaRT || {};
      const k = r.tipe === 'tahunanrt' ? 'tahunan' : r.tipe;
      tgt.belanjaRT[k] = r;
    }
  });
  persistRespondenDB();
  return migrated;
}

// ===== TAB =====
function showTab(tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const normalizedTab = (tab || '').toString().trim();

  // Debug
  try {
    console.log('[SE2026 showTab] tab=', tab, 'normalized=', normalizedTab);
  } catch (e) {}

  // Guard agar tidak crash jika container tab tidak ada
  // Default mapping: tab-${normalizedTab}
  let container = document.getElementById('tab-' + normalizedTab);

  // Fallback mapping khusus yang kadang tidak match karena mismatch id
  if (!container) {
    const candidates = Array.from(document.querySelectorAll('[id^="tab-"]'));
    const pickByKeywords = (keywords) => {
      const kw = (keywords || []).map(s => String(s).toLowerCase());
      return candidates.find(el => kw.some(k => (el.id || '').toLowerCase().includes(k))) || null;
    };

    if (normalizedTab === 'pendapatan') container = pickByKeywords(['pendapatan']);
    else if (normalizedTab === 'belanjart') container = pickByKeywords(['belanjart', 'belanja', 'rt']);
    else if (normalizedTab === 'konverter') container = pickByKeywords(['konverter']);
    else if (normalizedTab === 'riwayat') container = pickByKeywords(['riwayat']);
    else if (normalizedTab === 'nilaiAset') container = pickByKeywords(['nilaiaset', 'aset']);
    else if (normalizedTab === 'biayausaha') container = pickByKeywords(['biayausaha']);
    else if (normalizedTab === 'usaha') container = pickByKeywords(['usaha']);
    else if (normalizedTab === 'responden') container = pickByKeywords(['responden']);
  }

  if (container) container.classList.add('active');

  try {
    console.log('[SE2026 showTab] containerId=', container ? container.id : null);
  } catch (e) {}

  // Pastikan kategori aset tampil (tanpa tergantung cache)
  if (normalizedTab === 'nilaiAset' && typeof hitungAset === 'function') {
    try { hitungAset(); } catch(e) {}
  }

  // Aktifkan tombol tab yang cocok (cari by onclick attr, robust ke pemanggilan via JS)
  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(
    b => b.getAttribute('onclick') === `showTab('${normalizedTab}')`
  );
  if (btn) btn.classList.add('active');

  // Sinkronkan data saat tab dibuka
  if (normalizedTab === 'usaha') {
    const jumlah = parseInt(document.getElementById('jumlahUsaha').value) || 0;
    if (jumlah > 0) renderUsahaTabs();
  } else if (normalizedTab === 'biayausaha') {
    const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;
    if (jumlah > 0) renderUsahaTabs();
    try { syncBiayaUsahaSummary(usahaIndexAktif || 1); } catch (e) {}
    try { renderBiayaUsahaTabs(); } catch (e) {}
  } else if (normalizedTab === 'nilaiAset') {
    try {
      if (typeof hitungAset === 'function') hitungAset();
    } catch (e) {}
  } else if (normalizedTab === 'pendapatan') {
    const hp = window._lastPendapatan;
    if (hp && hp.orang) {
      hp.orang.forEach((org, idx) => {
        const row = document.querySelectorAll('#pendapatanList .rt-row')[idx];
        if (row) {
          const subEl = row.querySelector('.pend-subtotal');
          if (subEl) subEl.textContent = formatRp(org.total);
        }
      });
    }
    try { renderLabaUsahaAlokasi(); } catch (e) { hitungPendapatan(); }
  } else if (normalizedTab === 'belanjart') {
    hitungMakanan();
    hitungNonMakanan();
    hitungTahunan();
  } else if (normalizedTab === 'konverter') {
    konversi();
  } else if (normalizedTab === 'riwayat') {
    renderRiwayat();
  }
}

// ===== JENIS USAHA — data KBLI per jenis =====
const JENIS_KBLI = {
  dagang:       'G — Perdagangan Besar & Eceran (46-47)',
  kuliner:      'I — Penyediaan Makan Minum (56)',
  jasa:         'S — Jasa Lainnya (95-96)',
  produksi:     'C — Industri Pengolahan (10-33)',
  pertanian:    'A — Pertanian, Kehutanan (01-02)',
  peternakan:   'A — Pertanian, Peternakan (01.4-01.5)',
  konstruksi:   'F — Konstruksi (41-43)',
  transportasi: 'H — Transportasi & Pergudangan (49-53)',
  penginapan:   'I — Akomodasi (55)',
  pendidikan:   'P — Jasa Pendidikan (85)',
  kesehatan:    'Q — Jasa Kesehatan (86-88)',
  kerajinan:    'C — Industri Kerajinan (13-15, 31-32)',
  lainnya:      ''
};

// Label singkat jenis usaha (dipakai di badge kalkulator, tab "Biaya Usaha N",
// dan kartu Riwayat) — satu sumber agar konsisten di semua tempat.
const JENIS_LABEL = { dagang:'Dagang', kuliner:'Kuliner', jasa:'Jasa', produksi:'Produksi', pertanian:'Pertanian', peternakan:'Peternakan', konstruksi:'Konstruksi', transportasi:'Transportasi', penginapan:'Penginapan', pendidikan:'Pendidikan', kesehatan:'Kesehatan', kerajinan:'Kerajinan', lainnya:'Lainnya' };

function pilihJenis(el, jenis, idx) {
  idx = idx || 1;
  // Sinkronkan dropdown (kalau dipanggil bukan dari dropdown)
  const sel = document.getElementById('jenisUsahaSelect_' + idx);
  if (sel && sel.value !== jenis) sel.value = jenis;

  jenisUsahaMap[idx] = jenis;

  const tampilkanMusim = jenis === 'pertanian' || jenis === 'peternakan';
  document.getElementById('musimSection_' + idx).style.display = tampilkanMusim ? 'block' : 'none';

  if (jenis === 'peternakan') {
    document.getElementById('labelMusim_' + idx).textContent = 'Jumlah Bulan Ada Panen/Jual Ternak dalam 1 Tahun';
    document.getElementById('hintMusim_' + idx).innerHTML = 'Contoh: ayam broiler dipanen 6x setahun, tiap periode ±1 bulan → isi <b>6</b>. Bukan bulan ke berapa terjadinya, tapi total berapa bulan dalam setahun ada hasil panen/jual.';
  } else if (jenis === 'pertanian') {
    document.getElementById('labelMusim_' + idx).textContent = 'Jumlah Bulan Panen dalam 1 Tahun';
    document.getElementById('hintMusim_' + idx).innerHTML = 'Contoh: jika panen 2x setahun, masing-masing perlu 2 bulan kerja → isi <b>4</b> (bukan bulan ke berapa terjadinya, tapi total berapa bulan ada hasil panen)';
  }

  // KBLI tag — dari JENIS_KBLI map
  const kbliEl = document.getElementById('kbliTag_' + idx);
  if (kbliEl) {
    const kbli = JENIS_KBLI[jenis] || '';
    if (kbli) {
      kbliEl.innerHTML = `<strong>📂 Kategori KBLI:</strong> ${kbli}`;
      kbliEl.style.display = 'block';
    } else {
      kbliEl.style.display = 'none';
    }
  }

  // Sinkronkan label tab "Biaya Usaha N" di tab 📊 Biaya Usaha (kalau sudah
  // pernah dirender) supaya langsung menampilkan jenis usaha begitu dipilih,
  // tanpa perlu re-render struktur penuh.
  try { updateBiayaUsahaTabLabels(); } catch(e) {}

  hitungOtomatis(idx);
}

// ===== HARI KERJA =====
function toggleHari(el, idx) {
  idx = idx || 1;
  el.classList.toggle('active');
  updateHariHint(idx);
  hitungOtomatis(idx);
}

function getHariKerja(idx) {
  idx = idx || 1;
  return document.querySelectorAll('#hariGrid_' + idx + ' .hari-btn.active').length;
}

function updateHariHint(idx) {
  idx = idx || 1;
  const n = getHariKerja(idx);
  const perBulan = Math.round(n * 52 / 12);
  document.getElementById('hariHint_' + idx).textContent = `${n} hari kerja / minggu → ~${perBulan} hari/bulan`;
}

// ===== RENDER USAHA TABS (Inner Tabs) =====
function renderUsahaTabs() {
  const jumlah = parseInt(document.getElementById('jumlahUsaha').value) || 0;
  const nav = document.getElementById('innerUsahaNav');
  if (!nav) return;

  // Jika 0, sembunyikan inner tabs dan semua inner content
  if (jumlah === 0) {
    nav.style.display = 'none';
    document.querySelectorAll('.inner-usaha-content').forEach(el => el.style.display = 'none');
    try { renderBiayaUsahaTabs(); } catch (e) {}
    try { renderLabaUsahaAlokasi(); } catch (e) {}
    return;
  }

  // Build inner tabs buttons
  let btns = '';
  for (let i = 1; i <= jumlah; i++) {
    btns += `<button class="inner-tab-btn${i===1?' active':''}" onclick="showInnerUsahaTab(${i})">Usaha ${i}</button>`;
  }
  nav.innerHTML = btns;
  nav.style.display = 'flex';

  // Tampilkan hanya Usaha 1, sembunyikan yang lain
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('innerUsaha-' + i);
    if (el) el.style.display = (i <= jumlah && i === 1) ? 'block' : 'none';
  }

  // Jaga inner tab "Biaya Usaha N" tetap sinkron dengan jumlah usaha saat ini
  try { renderBiayaUsahaTabs(); } catch (e) {}
  // Jaga card "Alokasi Laba Usaha" di tab Pendapatan tetap sinkron jumlah usahanya
  try { renderLabaUsahaAlokasi(); } catch (e) {}
}

function showInnerUsahaTab(idx) {
  const jumlah = parseInt(document.getElementById('jumlahUsaha').value) || 0;

  // Update active button
  document.querySelectorAll('#innerUsahaNav .inner-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === idx);
  });

  // Show/hide content
  for (let i = 1; i <= jumlah; i++) {
    const el = document.getElementById('innerUsaha-' + i);
    if (el) el.style.display = (i === idx) ? 'block' : 'none';
  }

  // Update active index tracking
  usahaIndexAktif = idx;

  // Hitung subtotal 26.a-e untuk usaha yang aktif saja
  // Optimasi: hanya panggil hitungBiayaUsaha jika elemen subtotal untuk idx tersedia.
  try {
    if (typeof hitungBiayaUsaha === 'function') {
      const el = document.getElementById('bu26a-subtotal_' + idx);
      if (el) hitungBiayaUsaha(idx);
    }
  } catch(e) {}


  // Sync ringkasan hanya bila tab Biaya Usaha sudah terbuka (mengurangi render saat di tab Usaha)
  try {
    const tabBiaya = document.getElementById('tab-biayausaha');
    if (tabBiaya && tabBiaya.classList.contains('active')) {
      syncBiayaUsahaSummary(idx);
    }
  } catch(e) {}

  // Hindari renderBiayaUsahaTabs() di sini, karena berat (mengganti innerHTML besar)
}


// ===== RENDER INNER TABS: BIAYA USAHA 1..n + Σ Total Semua =====
// Membangun tab "Biaya Usaha 1..n" di tab "Biaya Usaha", masing-masing berisi
// ringkasan 26.a-f milik SATU usaha saja (bukan gabungan), plus satu tab
// "Σ Total Semua" yang menampilkan gabungan seluruh usaha (perilaku lama).
// Label satu tombol inner-tab "Biaya Usaha N", menyertakan jenis usaha
// responden untuk usaha ke-N (kalau sudah dipilih di tab "Usaha N").
// Contoh hasil: "Biaya Usaha 1 · Dagang" atau "Biaya Usaha 2" (jika jenis
// usaha ke-2 belum dipilih).
function biayaUsahaTabLabel(i) {
  const jenisKey = jenisUsahaMap[i] || '';
  const jenisLabel = jenisKey ? (JENIS_LABEL[jenisKey] || jenisKey) : '';
  return jenisLabel ? `Biaya Usaha ${i} · ${jenisLabel}` : `Biaya Usaha ${i}`;
}

// Update TEKS tombol tab yang sudah ada tanpa membangun ulang seluruh DOM
// inner tab (dipanggil dari pilihJenis() setiap kali jenis usaha berubah,
// supaya label ikut berubah live tanpa kehilangan state/aktif tab saat ini).
function updateBiayaUsahaTabLabels() {
  const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;
  for (let i = 1; i <= jumlah; i++) {
    const btn = document.getElementById('biayaTabBtn_' + i);
    if (btn) btn.textContent = biayaUsahaTabLabel(i);
  }
}

function renderBiayaUsahaTabs() {
  const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;
  const nav = document.getElementById('innerBiayaUsahaNav');
  const perUsahaContainer = document.getElementById('biayaUsahaPerUsahaContainer');
  const totalContent = document.getElementById('biayaUsahaTotalContent');
  if (!nav || !perUsahaContainer || !totalContent) return;

  if (jumlah <= 1) {
    // Hanya 1 usaha (atau 0) → tidak perlu inner tab, langsung tampilkan Total
    nav.style.display = 'none';
    nav.innerHTML = '';
    perUsahaContainer.innerHTML = '';
    totalContent.style.display = 'block';
    return;
  }

  // Bangun tombol tab: Biaya Usaha 1..n + Σ Total Semua.
  // REQ #1: setiap tombol menampilkan JENIS USAHA responden untuk usaha
  // tsb (diambil dari jenisUsahaMap[i], hasil pilihan di tab "Usaha i"),
  // bukan cuma nomor urut generik "Biaya Usaha i".
  let btns = '';
  for (let i = 1; i <= jumlah; i++) {
    btns += `<button class="inner-tab-btn${i === 1 ? ' active' : ''}" id="biayaTabBtn_${i}" onclick="showBiayaUsahaTab(${i})">${biayaUsahaTabLabel(i)}</button>`;
  }
  btns += `<button class="inner-tab-btn" onclick="showBiayaUsahaTab('total')">Σ Total Semua</button>`;
  nav.innerHTML = btns;
  nav.style.display = 'flex';

  // Bangun konten ringkasan per usaha (jika belum ada / jumlah berubah)
  let html = '';
  for (let i = 1; i <= jumlah; i++) {
    html += `
    <div class="inner-biaya-usaha-content" id="innerBiayaUsaha-${i}" style="display:${i === 1 ? 'block' : 'none'}">
      <div class="r26-summary">
        <div class="r26-row">
          <div class="r26-label"><b>26.a</b> Upah, Gaji &amp; Jaminan Sosial</div>
          <div class="r26-val" id="biaSum26a_${i}">Rp 0</div>
          <button class="copy-num-btn" onclick="salinNominal('biaSum26a_${i}','26.a Usaha ${i}')">📋</button>
        </div>
        <div class="r26-row">
          <div class="r26-label"><b>26.b</b> Biaya Produksi</div>
          <div class="r26-val" id="biaSum26b_${i}">Rp 0</div>
          <button class="copy-num-btn" onclick="salinNominal('biaSum26b_${i}','26.b Usaha ${i}')">📋</button>
        </div>
        <div class="r26-row">
          <div class="r26-label"><b>26.c</b> Sewa &amp; Jasa Lainnya</div>
          <div class="r26-val" id="biaSum26c_${i}">Rp 0</div>
          <button class="copy-num-btn" onclick="salinNominal('biaSum26c_${i}','26.c Usaha ${i}')">📋</button>
        </div>
        <div class="r26-row">
          <div class="r26-label"><b>26.d</b> Biaya Operasional</div>
          <div class="r26-val" id="biaSum26d_${i}">Rp 0</div>
          <button class="copy-num-btn" onclick="salinNominal('biaSum26d_${i}','26.d Usaha ${i}')">📋</button>
        </div>
        <div class="r26-row">
          <div class="r26-label"><b>26.e</b> Biaya Non-Operasional</div>
          <div class="r26-val" id="biaSum26e_${i}">Rp 0</div>
          <button class="copy-num-btn" onclick="salinNominal('biaSum26e_${i}','26.e Usaha ${i}')">📋</button>
        </div>
        <div class="r26-row total">
          <div class="r26-label"><b>26.f</b> TOTAL Pengeluaran Usaha ${i}</div>
          <div class="r26-val" id="biaSum26f_${i}">Rp 0</div>
          <button class="copy-num-btn primary" onclick="salinNominal('biaSum26f_${i}','26.f Usaha ${i}')">📋</button>
        </div>
      </div>
      <p class="r26-terbilang" id="biaSum26-terbilang_${i}" style="margin-top:14px;font-size:12px;font-style:italic;color:var(--muted);text-align:center"></p>
    </div>`;
  }
  perUsahaContainer.innerHTML = html;
  totalContent.style.display = 'none';

  // Hitung ulang & tampilkan nilai untuk setiap usaha
  for (let i = 1; i <= jumlah; i++) {
    try { if (typeof hitungBiayaUsaha === 'function') hitungBiayaUsaha(i); } catch (e) {}
  }
  try { syncBiayaUsahaSummary(); } catch (e) {}
}

// Pindah antar tab "Biaya Usaha N" / "Σ Total Semua"
function showBiayaUsahaTab(idx) {
  const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;
  const nav = document.getElementById('innerBiayaUsahaNav');
  if (nav) {
    Array.from(nav.querySelectorAll('.inner-tab-btn')).forEach((btn, i) => {
      const label = (i < jumlah) ? (i + 1) : 'total';
      btn.classList.toggle('active', label === idx);
    });
  }

  const totalContent = document.getElementById('biayaUsahaTotalContent');
  if (totalContent) totalContent.style.display = (idx === 'total') ? 'block' : 'none';

  for (let i = 1; i <= jumlah; i++) {
    const el = document.getElementById('innerBiayaUsaha-' + i);
    if (el) el.style.display = (i === idx) ? 'block' : 'none';
  }

  if (idx === 'total') {
    try { syncBiayaUsahaSummary(); } catch (e) {}
  } else {
    try { if (typeof hitungBiayaUsaha === 'function') hitungBiayaUsaha(idx); } catch (e) {}
  }
}

// ===== RENDER MULTIPLE USAHA FORMS =====
function renderUsahaForms() {
  const jumlah = parseInt(document.getElementById('jumlahUsaha').value) || 0;
  const container = document.getElementById('multiUsahaContainer');
  if (!container) return;

  // Jika 0, sembunyikan container dan form utama
  if (jumlah === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (let i = 1; i <= jumlah; i++) {
    html += `
<div class="card" style="margin-top:16px;border-left:4px solid var(--bps-light)">
  <div class="card-title"><span class="dot"></span>Usaha #${i}</div>

  <div class="field">
    <label>Jenis Usaha #${i}</label>
    <select class="jenis-select multi-usaha-jenis" data-idx="${i}" onchange="pilihJenisMulti(${i}, this.value)">
      <option value="">— Pilih Jenis Usaha —</option>
      <option value="dagang">🛒 Dagang / Retail</option>
      <option value="kuliner">🍽️ Kuliner / Makanan</option>
      <option value="jasa">🔧 Usaha Jasa</option>
      <option value="produksi">🏭 Produksi / Manufaktur</option>
      <option value="pertanian">🌿 Pertanian / Perkebunan</option>
      <option value="peternakan">🐄 Peternakan</option>
      <option value="konstruksi">🏗️ Konstruksi / Bangunan</option>
      <option value="transportasi">🚚 Transportasi / Logistik</option>
      <option value="penginapan">🛏️ Penginapan / Hotel</option>
      <option value="pendidikan">🎓 Pendidikan / Bimbel</option>
      <option value="kesehatan">🏥 Kesehatan / Praktik</option>
      <option value="kerajinan">🧵 Kerajinan / Konveksi</option>
      <option value="lainnya">📦 Lainnya / Campuran</option>
    </select>
  </div>

  <div class="field">
    <label>Omzet per Bulan #${i}</label>
    <div class="input-wrap">
      <span class="input-prefix">Rp</span>
      <input type="text" class="rp-input multi-usaha-omzet" data-idx="${i}" placeholder="0" oninput="hitungOtomatis()">
    </div>
  </div>

  <div class="field">
    <label>Pengeluaran per Bulan #${i}</label>
    <div class="input-wrap">
      <span class="input-prefix">Rp</span>
      <input type="text" class="rp-input multi-usaha-pengeluaran" data-idx="${i}" placeholder="0" oninput="hitungOtomatis()">
    </div>
  </div>
</div>`;
  }

  container.innerHTML = html;
}

function pilihJenisMulti(idx, jenis) {
  idx = idx || 1;

  // Simpan pilihan jenis per idx (konsisten dengan perbaikan global)
  jenisUsahaMap[idx] = jenis;

  // Musim (hanya ada jika form punya section musim)
  const tampilkanMusim = jenis === 'pertanian' || jenis === 'peternakan';
  const musimEl = document.getElementById('musimSection_' + idx);
  if (musimEl) musimEl.style.display = tampilkanMusim ? 'block' : 'none';

  // KBLI tag (hanya ada jika form punya tag KBLI)
  const kbliEl = document.getElementById('kbliTag_' + idx);
  if (kbliEl) {
    const kbli = JENIS_KBLI[jenis] || '';
    if (kbli) {
      kbliEl.innerHTML = `<strong>📂 Kategori KBLI:</strong> ${kbli}`;
      kbliEl.style.display = 'block';
    } else {
      kbliEl.style.display = 'none';
    }
  }

  hitungOtomatis(idx);
}

// ===== SATUAN WAKTU =====
function updateSatuan(idx) {
  idx = idx || 1;
  const s = document.getElementById('satuanWaktu_' + idx).value;
  const labels = { hari: 'per Hari', minggu: 'per Minggu', bulan: 'per Bulan' };
  const hints = {
    hari: 'Masukkan total penjualan rata-rata per hari',
    minggu: 'Masukkan total penjualan rata-rata per minggu',
    bulan: 'Masukkan total penjualan rata-rata per bulan'
  };
  document.getElementById('labelOmzet_' + idx).textContent = 'Omzet ' + labels[s];
  document.getElementById('hintOmzet_' + idx).textContent = hints[s];
  document.getElementById('hariKerjaSection_' + idx).style.display = s === 'bulan' ? 'none' : 'block';
  hitungOtomatis(idx);
}

// ===== BIAYA =====
function tambahBiaya(nama = '', nilai = '', idx) {
  idx = idx || 1;
  biayaCounter++;
  const id = biayaCounter;
  const div = document.createElement('div');
  div.className = 'biaya-row';
  div.id = 'biaya-' + id;
  div.innerHTML = `
    <div class="input-wrap biaya-nama">
      <input type="text" placeholder="Nama biaya" value="${nama}" oninput="hitungOtomatis()">
    </div>
    <div class="input-wrap biaya-nom">
      <span class="input-prefix">Rp</span>
      <input type="text" inputmode="numeric" class="rp-input" placeholder="0" value="${nilai}" oninput="hitungOtomatis()">
    </div>
    <button class="del-btn" onclick="hapusBiaya(${id})">×</button>
    <span class="yearly-hint empty" data-yearly-for="${id}">= Rp 0 / tahun</span>
  `;
  document.getElementById('biayaList_' + idx).appendChild(div);
  hitungOtomatis();
}

function hapusBiaya(id) {
  const el = document.getElementById('biaya-' + id);
  if (el) el.remove();
  hitungOtomatis();
}

// Update kolom "/tahun" tiap item biaya berdasarkan satuan waktu omzet
function updateBiayaYearly(idx) {
  idx = idx || 1;
  const mult = getMultiplier(idx);
  document.querySelectorAll('#biayaList_' + idx + ' .biaya-row').forEach(row => {
    const nominal = parseRp(row.querySelectorAll('input')[1].value);
    const perBulan = nominal * mult.toBulan;
    const perTahun = perBulan * 12;
    const hint = row.querySelector('.yearly-hint');
    if (hint) {
      if (nominal > 0) {
        hint.textContent = '= ' + formatRp(perTahun) + ' / tahun';
        hint.classList.remove('empty');
      } else {
        hint.classList.add('empty');
      }
    }
  });
}

function getBiayaList(idx) {
  idx = idx || 1;
  const rows = document.querySelectorAll('#biayaList_' + idx + ' .biaya-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    return {
      nama: inputs[0].value || 'Biaya lain',
      nilai: parseRp(inputs[1].value)
    };
  });
}

// ===== KONVERSI WAKTU =====
function getMultiplier(idx) {
  idx = idx || 1;
  const satuan = document.getElementById('satuanWaktu_' + idx).value;
  const hariPerMinggu = getHariKerja(idx) || 5;
  const hariPerBulan = Math.round(hariPerMinggu * 52 / 12);

  if (satuan === 'hari') return { toHari: 1, toBulan: hariPerBulan, toTahun: hariPerBulan * 12 };
  if (satuan === 'minggu') return { toHari: 1 / hariPerMinggu, toBulan: hariPerBulan / hariPerMinggu, toTahun: hariPerBulan * 12 / hariPerMinggu };
  if (satuan === 'bulan') return {
    toHari: 1 / hariPerBulan,
    toBulan: 1,
    toTahun: 12
  };
  return { toHari: 1, toBulan: 30, toTahun: 360 };
}

// ===== HITUNG =====
// Debounce untuk mengurangi beban saat user mengetik
let _debounceHitungOtomatisTimer = null;
function hitungOtomatis(idx, silent) {
  idx = idx || 1;

  // Jika sudah dijadwalkan, reset timer.
  if (_debounceHitungOtomatisTimer) clearTimeout(_debounceHitungOtomatisTimer);

  _debounceHitungOtomatisTimer = setTimeout(() => {
    // auto update hints only
    updateHariHint(idx);
    updateBiayaYearly(idx);
    updateTkSummary(idx);
    try { hitungBiayaUsaha(idx); } catch(e) {} // sync 26.a otomatis dari Tenaga Kerja

    // Sinkron ringkasan hanya jika elemen summary memang ada (tab Biaya Usaha sudah ter-render).
    // Ini mengurangi pekerjaan DOM saat user masih di tab Usaha.
    try {
      const summaryEls = document.getElementById('sum26a');
      if (summaryEls) syncBiayaUsahaSummary(idx);
    } catch(e) {}
  }, 180);
}



// Update ringkasan Tenaga Kerja setahun
function updateTkSummary(idx) {
  idx = idx || 1;
  const elJumlah = document.getElementById('jumlahKaryawan_' + idx);
  const n = parseFloat((elJumlah || {}).value) || 0;
  const gaji   = parseRp((document.getElementById('gajiPerOrang_' + idx)   || {}).value || '');
  const jamsos = parseRp((document.getElementById('jamsosPerOrang_' + idx) || {}).value || '');
  const thr    = parseRp((document.getElementById('thrPerOrang_' + idx)    || {}).value || '');

  const gajiTh   = gaji   * 12 * n;
  const jamsosTh = jamsos * 12 * n;
  const thrTh    = thr         * n;
  const totalTh  = gajiTh + jamsosTh + thrTh;

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = formatRp(v); };
  set('tkGajiTahun_' + idx,   gajiTh);
  set('tkJamsosTahun_' + idx, jamsosTh);
  set('tkThrTahun_' + idx,    thrTh);
  set('tkTotalTahun_' + idx,  totalTh);

  const summary = document.getElementById('tkSummary_' + idx);
  if (summary) summary.style.display = (n > 0 && totalTh > 0) ? 'block' : 'none';
}

function hitung(idx) {
  // legacy: beberapa tombol/handler memanggil hitung(idx, silent)
  // Pastikan variabel silent tidak undefined.
  idx = idx || 1;
  const silent = arguments.length >= 2 ? !!arguments[1] : false;

  const jenisUsaha = jenisUsahaMap[idx] || jenisUsahaMap[1] || '';
  const omzetEl = document.getElementById('omzet_' + idx);

  const omzet = parseRp((omzetEl || {}).value);
  if (!omzet) { showToast('⚠️ Masukkan omzet terlebih dahulu'); return; }

  // Guard: hindari crash saat elemen form belum ter-render (mis. saat simpan semua)
  // (hitung di bawah sudah pakai fallback (|| {}).value, jadi bagian ini cukup untuk mencegah future regressions)



  const mult = getMultiplier(idx);
  const omzetHari = omzet * mult.toHari;
  const omzetBulan = omzet * mult.toBulan;
  const omzetTahun = omzet * mult.toTahun;

  // Biaya operasional
  const biayaItems = getBiayaList(idx);
  const totalBiayaOps = biayaItems.reduce((s, b) => s + b.nilai, 0);
  const biayaOpsHari = totalBiayaOps * mult.toHari;
  const biayaOpsBulan = totalBiayaOps * mult.toBulan;

  // Gaji + Jaminan Sosial + Bonus/THR (selalu per bulan untuk gaji & jamsos; THR tahunan)
  const nKaryawanEl = document.getElementById('jumlahKaryawan_' + idx);
  const nKaryawan    = parseFloat((nKaryawanEl || {}).value) || 0;

  const gajiEl = document.getElementById('gajiPerOrang_' + idx);
  const gajiPerOrang = parseRp((gajiEl || {}).value);

  const jamsosPerOrang = parseRp((document.getElementById('jamsosPerOrang_' + idx) || {}).value || '');
  const thrPerOrang    = parseRp((document.getElementById('thrPerOrang_' + idx)    || {}).value || '');
  // Total per bulan = (gaji + jamsos) × jumlah karyawan, plus THR setahun dibagi 12
  const totalGajiBulan = nKaryawan * (gajiPerOrang + jamsosPerOrang + thrPerOrang / 12);
  const totalGajiHari  = totalGajiBulan / (mult.toBulan || 22);

  // Pertanian/Peternakan: faktor musim
  let faktorMusim = 1;
  if (jenisUsaha === 'pertanian' || jenisUsaha === 'peternakan') {
    const bpEl = document.getElementById('bulanPanen_' + idx);
    const bulanPanen = parseFloat((bpEl || {}).value) || 4;
    faktorMusim = bulanPanen / 12;
  }

  // === BIAYA = Total 26.a-e (per TAHUN) ===
  // Pastikan 26.a-e ter-hitung dulu (dari Tenaga Kerja + sub-items 26.b-e)
  hitungBiayaUsaha(idx);
  const r26       = window._lastBiayaUsaha || {};
  const total26   = r26.total || 0;          // a + b + c + d + e (semua /tahun)
  const totalBiayaTahun = total26;
  const totalBiayaBulan = totalBiayaTahun / 12;
  const totalBiayaHari  = totalBiayaBulan / (mult.toBulan || 22);

  // Laba bersih per ketentuan: omzet/tahun − total 26.a-e (faktor musim diterapkan ke omzet)
  const labaHari  = (omzetHari  - totalBiayaHari)  * faktorMusim;
  const labaBulan = (omzetBulan - totalBiayaBulan) * faktorMusim;
  const labaTahun = (omzetTahun * faktorMusim) - totalBiayaTahun;

  // Render
  document.getElementById('res-omzet-hari_' + idx).textContent = formatRp(omzetHari);
  document.getElementById('res-omzet-bulan_' + idx).textContent = formatRp(omzetBulan);
  document.getElementById('res-omzet-tahun_' + idx).textContent = formatRp(omzetTahun * faktorMusim);
  document.getElementById('res-omzet-terbilang_' + idx).textContent = terbilang(omzetTahun * faktorMusim);

  document.getElementById('res-laba-hari_' + idx).textContent = formatRp(labaHari);
  document.getElementById('res-laba-bulan_' + idx).textContent = formatRp(labaBulan);
  document.getElementById('res-laba-tahun_' + idx).textContent = formatRp(labaTahun);
  document.getElementById('res-laba-terbilang_' + idx).textContent = terbilang(labaTahun);

  // Ringkasan biaya — pakai breakdown 26.a-e per TAHUN
  let ringHTML = '';
  ringHTML += `<div class="ringkasan-row"><span class="rk-label">Omzet / Tahun</span><span class="rk-val plus">${formatRp(omzetTahun * faktorMusim)}</span></div>`;
  if (r26.a > 0) ringHTML += `<div class="ringkasan-row"><span class="rk-label">− 26.a Upah, Gaji & Jaminan Sosial</span><span class="rk-val minus">${formatRp(r26.a)}</span></div>`;
  if (r26.b > 0) ringHTML += `<div class="ringkasan-row"><span class="rk-label">− 26.b Biaya Produksi</span><span class="rk-val minus">${formatRp(r26.b)}</span></div>`;
  if (r26.c > 0) ringHTML += `<div class="ringkasan-row"><span class="rk-label">− 26.c Sewa & Jasa Lainnya</span><span class="rk-val minus">${formatRp(r26.c)}</span></div>`;
  if (r26.d > 0) ringHTML += `<div class="ringkasan-row"><span class="rk-label">− 26.d Biaya Operasional</span><span class="rk-val minus">${formatRp(r26.d)}</span></div>`;
  if (r26.e > 0) ringHTML += `<div class="ringkasan-row"><span class="rk-label">− 26.e Biaya Non-Operasional</span><span class="rk-val minus">${formatRp(r26.e)}</span></div>`;
  ringHTML += `<div class="ringkasan-row"><span class="rk-label" style="font-weight:700;color:var(--text)">26.f Total Biaya / Tahun</span><span class="rk-val minus" style="font-size:14px">${formatRp(totalBiayaTahun)}</span></div>`;
  document.getElementById('ringkasanBiaya_' + idx).innerHTML = ringHTML;

  const labelMap = { dagang:'Dagang', kuliner:'Kuliner', jasa:'Jasa', produksi:'Produksi', pertanian:'Pertanian', peternakan:'Peternakan', konstruksi:'Konstruksi', transportasi:'Transportasi', penginapan:'Penginapan', pendidikan:'Pendidikan', kesehatan:'Kesehatan', kerajinan:'Kerajinan', lainnya:'Lainnya' };
  document.getElementById('badgeJenis_' + idx).textContent = jenisUsaha ? labelMap[jenisUsaha] : 'Umum';

  // Warning rugi jika laba tahunan negatif
  const rugiEl = document.getElementById('rugiWarning_' + idx);
  if (rugiEl) {
    if (labaTahun < 0) {
      rugiEl.textContent = '⚠️ Hasil menunjukkan RUGI — periksa kembali nilai omzet & biaya. Mungkin biaya terlalu besar atau omzet salah satuan waktu.';
      rugiEl.style.display = 'block';
    } else {
      rugiEl.style.display = 'none';
    }
  }

  // Ambil KBLI dari card terpilih
  const sel = document.querySelector('.jenis-card.selected');
  const kbliVal = sel ? (sel.getAttribute('data-kbli') || '') : '';
  const pekVal  = (document.getElementById('pekerjaanResponden') || {}).value || '';

  document.getElementById('hasilSection_' + idx).style.display = 'block';
  if (!silent) {
    document.getElementById('hasilSection_' + idx).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Store for save — termasuk Rincian 26.b-e agar ikut tersimpan & bisa di-edit ulang
  window._lastHasil = {
    tipe: 'kalkulator',
    // NEW: flag untuk mode keluarga-banyak-usaha
    _usahaAktifId: usahaAktifId || null,
    _keluargaAktifKey: keluargaAktifKey || null,
    // NEW: simpan ringkasan per usaha ke keluargaDB (prioritas A)
    // (di bawah, setelah object ini diisi lengkap)

    nomorKeluarga: document.getElementById('nomorKeluarga_' + idx)?.value || '-',
    nomorBangunan: document.getElementById('nomorBangunan_' + idx)?.value || '-',
    bulanPanen: (document.getElementById('bulanPanen_' + idx) || {}).value || 4,
    nama: document.getElementById('namaUsaha_' + idx)?.value || 'Tanpa Nama',
    pekerjaan: pekVal,
    jenis: jenisUsaha || 'lainnya',
    kbli: kbliVal,
    satuan: (document.getElementById('satuanWaktu_' + idx) || {}).value,
    omzet, omzetHari, omzetBulan, omzetTahun: omzetTahun * faktorMusim,
    totalBiayaBulan, labaBulan, labaTahun,
    biayaItems, nKaryawan, gajiPerOrang, jamsosPerOrang, thrPerOrang,
    // === Rincian 26.a-e (per tahun untuk subtotal, raw items per bulan) ===
    r26a: r26.a || 0,
    r26b: r26.b || 0,
    r26c: r26.c || 0,
    r26d: r26.d || 0,
    r26e: r26.e || 0,
    r26total: r26.total || 0,
    items26B: r26.itemsB || [],
    items26C: r26.itemsC || [],
    items26D: r26.itemsD || [],
    items26E: r26.itemsE || [],
    rugi: labaTahun < 0,
    waktu: new Date().toLocaleString('id-ID')
  };
  // commit ringkasan kalkulator usaha aktif ke keluargaDB untuk usaha aktif
  try {
    if (keluargaAktifKey && usahaAktifId && keluargaDB[keluargaAktifKey]) {
      const k = keluargaDB[keluargaAktifKey];
      k.usahaDaftar = k.usahaDaftar || {};
      k.usahaDaftar[usahaAktifId] = k.usahaDaftar[usahaAktifId] || { id: usahaAktifId };
      k.usahaDaftar[usahaAktifId].kalkulator = {
        labaBulan: window._lastHasil.labaBulan,
        labaTahun: window._lastHasil.labaTahun,
        omzetBulan: window._lastHasil.omzetBulan,
        omzetTahun: window._lastHasil.omzetTahun,
        jenis: window._lastHasil.jenis,
        kbli: window._lastHasil.kbli,
        rugi: window._lastHasil.rugi,
        waktu: window._lastHasil.waktu
      };
      k.waktuUpdate = new Date().toLocaleString('id-ID');
      persistKeluargaDB();
    }
  } catch(e) { console.warn('Error in hitung:', e); }
}

// ===== SALIN =====
function salinHasil() {
  if (!window._lastHasil) return;
  const h = window._lastHasil;
  const teks = `=== KALKULATOR USAHA SE2026 ===
Nama Usaha : ${h.nama}
Pekerjaan  : ${h.pekerjaan || '-'}
Jenis      : ${h.jenis}${h.kbli ? '  (' + h.kbli + ')' : ''}
Waktu      : ${h.waktu}

OMZET
  Per Hari   : ${formatRp(h.omzetHari)}
  Per Bulan  : ${formatRp(h.omzetBulan)}
  Per Tahun  : ${formatRp(h.omzetTahun)}

TOTAL BIAYA/BULAN : ${formatRp(h.totalBiayaBulan)}

LABA BERSIH${h.rugi ? '  ⚠ RUGI' : ''}
  Per Bulan  : ${formatRp(h.labaBulan)}
  Per Tahun  : ${formatRp(h.labaTahun)}
  (${terbilang(h.labaTahun)})
================================`;
  copyToClipboard(teks);
}

// ===== SIMPAN RIWAYAT =====
function simpanRiwayat() {
  if (!window._lastHasil) return;
  pushOrReplaceRiwayat({ ...window._lastHasil });

  // Auto-simpan juga Rincian 26 (a-e) ke profil responden — supaya tidak hilang
  // dan CSV export wide-format ikut menyertakan breakdown 26.b-e.
  const h26 = window._lastBiayaUsaha;
  if (h26 && (h26.total > 0 || (h26.itemsB && h26.itemsB.length) || (h26.itemsC && h26.itemsC.length) || (h26.itemsD && h26.itemsD.length) || (h26.itemsE && h26.itemsE.length))) {
    const data26 = {
      tipe: 'biayausaha',
      nama: window._lastHasil.nama,
      ...h26,
      waktu: new Date().toLocaleString('id-ID')
    };
    // Tulis ke respondenDB[key].rincian26 tanpa membuat entri riwayat baru
    const key = namaToKey(window._lastHasil.nama);
    if (key) {
      const r = ensureAktif(window._lastHasil.nama);
      r.rincian26 = data26;
      r.waktuUpdate = data26.waktu;
      persistRespondenDB();
    }
  }

  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

function simpanRiwayatBiayaUsaha() {
  const h = window._lastBiayaUsaha;
  if (!h || !h.total) { showToast('⚠️ Isi dulu rinciannya'); return; }
  const nama = getCurrentNama() || (respondenAktif && respondenDB[respondenAktif] && respondenDB[respondenAktif].nama) || '';
  if (!nama) { showToast('⚠️ Nama usaha kosong. Isi dulu di tab Usaha atau aktifkan profil'); return; }
  pushOrReplaceRiwayat({
    tipe: 'biayausaha',
    nama,
    ...h,
    waktu: new Date().toLocaleString('id-ID')
  });
  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

// ===== HELPER: tambah baru atau ganti yang sedang diedit + merge ke responden aktif =====

// Ambil nama responden aktif dari berbagai sumber (untuk save di tab non-Kalkulator)
function getCurrentNama() {
  // Key utama profil responden sekarang diambil dari:
  // 1) input #namaResponden (tab Responden) 
  // 2) fallback ke respondenDB aktif
  const inputNama = (document.getElementById('namaResponden') || {}).value || '';
  if (inputNama.trim()) return inputNama.trim();

  if (respondenAktif && respondenDB[respondenAktif] && respondenDB[respondenAktif].nama) {
    return respondenDB[respondenAktif].nama;
  }
  return '';
}

// ===== MASTER SAVE: simpan semua tab sekaligus (Kalkulator + Belanja RT + Aset) =====
function simpanSemuaResponden() {

  // Sinkron multi-usaha: akumulasi ringkasan kalkulator (omzet & laba) dan rincian 26.
  // Karena tab Riwayat menampilkan 1 profil responden per nama, maka hasil Usaha 1..n
  // harus dijumlahkan menjadi total agar tidak terlihat hilang.
  const jumlahUsahaVal = parseInt((document.getElementById('jumlahUsaha') || {}).value, 10) || 0;
  let totalOmzetTahun = 0;
  let totalLabaTahun = 0;
  let total26 = { total: 0, a: 0, b: 0, c: 0, d: 0, e: 0, itemsB: [], itemsC: [], itemsD: [], itemsE: [] };

  // NEW: mode awal keluarga banyak usaha
  // Pada tahap ini, simpan keluarga/usaha aktif hanya sebagai placeholder meta.
  // Belanja RT & pendapatan masih pakai legacy respondenDB.
  try {
    // Pastikan dropdown usaha aktif sudah terbentuk
    if (keluargaAktifKey && usahaAktifId) {
      const k = keluargaDB[keluargaAktifKey];
      if (k) {
        k.waktuUpdate = new Date().toLocaleString('id-ID');
        k._lastUsahaAktif = usahaAktifId;
        persistKeluargaDB();
      }
    }
  } catch(e){}

  const nama = getCurrentNama();
  if (!nama) {
    // Fallback: jika respondenAktif sudah ada, gunakan nama profilnya.
    const fallback = (respondenAktif && respondenDB[respondenAktif] && respondenDB[respondenAktif].nama)
      ? respondenDB[respondenAktif].nama
      : '';

    if (fallback) {
      // tulis ke input biar konsisten UI
      try {
        const el = document.getElementById('namaUsaha');
        if (el) el.value = fallback;
      } catch(e) {}
    } else {
      // Hindari toast lama yang memaksa user ke tab lain
      showToast('⚠️ Nama usaha kosong. Isi dulu di tab Usaha atau mulai responden');
      showTab('responden');
      setTimeout(() => {
        const el = document.getElementById('namaUsaha');
        if (el) el.focus();
      }, 400);
      return;
    }
  }

  // Pastikan respondenAktif ter-set
  const key = namaToKey(nama);
  if (!key) {
    showToast('⚠️ Nama Responden/Keluarga kosong');
    showTab('responden');
    return;
  }

  // Sync identitas tab "Responden" ke respondenDB
  // (No. Urut Keluarga, No. Urut Bangunan, Nama Keluarga/Rumah Tangga, Jumlah Usaha, Pekerjaan Utama, geo)
  try {
    if (!respondenAktif) respondenAktif = key;

    // KUNCI BUG: ensureAktif(nama) butuh respondenAktif terset ke key yang sama.
    // Kadang merge sebelum ini membuat ensureAktif memakai profil lama.
    // Jadi paksa pastikan profil aktifnya adalah key.
    respondenAktif = key;

    const r = ensureAktif(nama);
    if (r) {
      const kkInput = ((document.getElementById('nomorKeluargaRes') || {}).value || '').toString();
      const bgInput = ((document.getElementById('nomorBangunanRes') || {}).value || '').toString();
      const jumlahUsahaVal = ((document.getElementById('jumlahUsaha') || {}).value || '').toString();
      const pekerjaanVal = ((document.getElementById('pekerjaanResponden') || {}).value || '').toString();

      r.nomorKeluargaRes = kkInput ? kkInput : '';
      r.nomorBangunanRes = bgInput ? bgInput : '';
      r.jumlahUsaha = jumlahUsahaVal ? parseInt(jumlahUsahaVal, 10) || 0 : 0;
      // Pastikan key konsisten dipakai oleh restore di editResponden
      r.pekerjaanResponden = pekerjaanVal || '';

      // Simpan juga alias yang lebih singkat (untuk kompat legacy/typo)
      r.pekerjaanUtamaResponden = r.pekerjaanResponden;


      // Data geo (kalau ada)
      if (_geoData && _geoData.lat) {
        r.geo = _geoData;
      }

      r.nama = nama;
      r.waktuUpdate = new Date().toLocaleString('id-ID');
      persistRespondenDB();
      renderRespondenAktifBar();
    }
  } catch(e) {
    console.warn('sync identitas responden:', e);
  }


  const sectionsSaved = [];

  // 1. KALKULATOR — cek semua usaha 1-5 (omzet_1 s/d omzet_5)
  try {
    let adaData = false;
    for (let i = 1; i <= 5; i++) {
      const omzetInput = document.getElementById('omzet_' + i);
      if (!omzetInput) continue;
      const omzetVal = parseRp(omzetInput.value || '');
      if (omzetVal > 0) {
        try {
          hitung(i); // hitung untuk usaha index i
        } catch (e) {
          console.warn('Skip hitung usaha', i, e);
        }
        if (window._lastHasil) {

          pushOrReplaceRiwayat({ ...window._lastHasil });

          // NEW: pastikan kalkulator & Rincian 26 tersimpan ke respondenDB
          // agar tab "Usaha" / "Biaya Usaha" saat edit tidak kosong.
          // (editResponden() membaca profil.kalkulator & profil.rincian26)
          let rAktif = ensureAktif(nama);
          if (rAktif) {
            // simpan ringkasan kalkulator (snapshot terakhir yang tersimpan; backward compat)
            rAktif.kalkulator = {
              ...window._lastHasil,
              tipe: 'kalkulator',
              labaBulan: window._lastHasil.labaBulan,
              labaTahun: window._lastHasil.labaTahun,
              omzetBulan: window._lastHasil.omzetBulan,
              omzetTahun: window._lastHasil.omzetTahun,
              rugi: window._lastHasil.labaTahun < 0,
              jenis: window._lastHasil.jenis,
              kbli: window._lastHasil.kbli,
              waktu: window._lastHasil.waktu
            };

            // PATCH #2: simpan snapshot kalkulator PER USAHA (bukan hanya snapshot
            // terakhir yang menimpa usaha sebelumnya) + jenis usaha per index, agar
            // tab "Usaha" & "Biaya Usaha" bisa direstore untuk semua usaha 1..5.
            rAktif.kalkulatorByUsaha = rAktif.kalkulatorByUsaha || {};
            rAktif.kalkulatorByUsaha[i] = { ...rAktif.kalkulator };

            rAktif.jenisUsahaByUsaha = rAktif.jenisUsahaByUsaha || {};
            rAktif.jenisUsahaByUsaha[i] = jenisUsahaMap[i] || window._lastHasil.jenis || '';

            rAktif.waktuUpdate = new Date().toLocaleString('id-ID');
            persistRespondenDB();
          }

          // Sub-merge: rincian26 ke profil responden (per usaha + snapshot)
          // NOTE: simpan juga versi per-usaha untuk mengisi inner tab Biaya Usaha 1..n

          // PATCH #3 (fix race condition): window._lastBiayaUsaha adalah SATU variabel
          // global yang ditimpa tiap kali hitungBiayaUsaha(idx) dipanggil untuk index
          // manapun. Supaya data yang dibaca benar-benar milik usaha ke-i, paksa hitung
          // ulang 26.a-e untuk usaha i tepat sebelum dibaca (ini juga otomatis mengisi
          // itemsB..E dengan lengkap, bukan hanya total).
          try { if (typeof hitungBiayaUsaha === 'function') hitungBiayaUsaha(i); } catch(e) {}
          let h26 = window._lastBiayaUsaha;

          // Fallback: jika window._lastBiayaUsaha masih kosong (elemen DOM usaha i
          // belum ter-render), baca subtotal 26.a-e dari DOM (bu26*-subtotal_i) untuk usaha i.
          // Ini memastikan rincian 26 ikut tersimpan saat "Simpan Semua" dipanggil.
          if (!h26) {
            const readSub = (base, usahaIdx) => {
              const el = document.getElementById(base + '_' + usahaIdx);
              if (!el) return 0;
              // prefer dataset.value bila ada
              if (el.dataset && el.dataset.value !== undefined) {
                const v = parseInt(el.dataset.value, 10);
                return isNaN(v) ? 0 : v;
              }
              return parseRp((el.textContent || '').toString()) || 0;
            };

            const a = readSub('bu26a-subtotal', i);
            const b = readSub('bu26b-subtotal', i);
            const c = readSub('bu26c-subtotal', i);
            const d = readSub('bu26d-subtotal', i);
            const e = readSub('bu26e-subtotal', i);
            const total = a + b + c + d + e;

            h26 = {
              total,
              a, b, c, d, e,
              // Catatan: pada jalur fallback ini item rinci tidak bisa direkonstruksi
              // dari subtotal saja. Jalur normal (hitungBiayaUsaha(i) di atas) akan
              // selalu mengisi itemsB..E dengan lengkap sehingga fallback ini jarang terpakai.
              itemsB: [],
              itemsC: [],
              itemsD: [],
              itemsE: []
            };
          }

          // Simpan per-usaha selama ada angka subtotal DOM atau total (lebih toleran).
          // Ini mencegah kasus di mana h26.total terhitung 0, tapi subtotal 26.a-e (bu26*-subtotal_i) sebenarnya sudah terisi.
          if (h26 && ((h26.total || 0) > 0 || (h26.a || 0) > 0 || (h26.b || 0) > 0 || (h26.c || 0) > 0 || (h26.d || 0) > 0 || (h26.e || 0) > 0 ||
              (h26.itemsB && h26.itemsB.length) || (h26.itemsC && h26.itemsC.length) || (h26.itemsD && h26.itemsD.length) || (h26.itemsE && h26.itemsE.length))) {
            const r = ensureAktif(nama);
            if (r) {
              // snapshot lama (backward compat)
              r.rincian26 = { tipe: 'biayausaha', nama, ...h26, waktu: new Date().toLocaleString('id-ID') };
              r.waktuUpdate = r.rincian26.waktu;

              // NEW: simpan versi per-usaha agar inner tab Biaya Usaha 1..n terisi
              // Format: rincian26ByUsaha[i] = {tipe,nama,...h26,waktu}
              r.rincian26ByUsaha = r.rincian26ByUsaha || {};
              r.rincian26ByUsaha[i] = { tipe: 'biayausaha', nama, ...h26, waktu: new Date().toLocaleString('id-ID') };

              persistRespondenDB();
            }
          }



          adaData = true;
        }
      }
    }
    if (adaData) sectionsSaved.push('Usaha');
  } catch (e) { console.warn('Save Usaha:', e); }

  // 2. BELANJA RT — Makanan
  try {
    if (document.querySelectorAll('#rtMakananList .rt-row').length > 0) {
      hitungMakanan();
      const h = window._lastMakanan;
      if (h && h.items && h.items.length) {
        // Pastikan slot di profil responden (bukan hanya riwayat[])
        const r = ensureAktif(nama);
        if (r) {
          r.belanjaRT = r.belanjaRT || {};
          r.belanjaRT.makanan = { tipe: 'makanan', nama, ...h, waktu: new Date().toLocaleString('id-ID') };
          r.waktuUpdate = r.belanjaRT.makanan.waktu;
          persistRespondenDB();
        }
        pushOrReplaceRiwayat({ tipe: 'makanan', nama, ...h });
        sectionsSaved.push('Makanan');
      }
    }
  } catch (e) { console.warn('Save Makanan:', e); }

  // 3. BELANJA RT — Non-Makanan
  try {
    if (document.querySelectorAll('#rtNonMakananList .rt-row').length > 0) {
      hitungNonMakanan();
      const h = window._lastNonMakanan;
      if (h && h.items && h.items.length) {
        const r = ensureAktif(nama);
        if (r) {
          r.belanjaRT = r.belanjaRT || {};
          r.belanjaRT.nonmakanan = { tipe: 'nonmakanan', nama, ...h, waktu: new Date().toLocaleString('id-ID') };
          r.waktuUpdate = r.belanjaRT.nonmakanan.waktu;
          persistRespondenDB();
        }
        pushOrReplaceRiwayat({ tipe: 'nonmakanan', nama, ...h });
        sectionsSaved.push('Non-Makanan');
      }
    }
  } catch (e) { console.warn('Save NonMakanan:', e); }

  // 4. BELANJA RT — Tahunan
  try {
    if (document.querySelectorAll('#rtTahunanList .rt-row').length > 0) {
      hitungTahunan();
      // BUGFIX: data tahunan disimpan di _lastTahunanByKey[key], bukan _lastTahunan
      // (variabel _lastTahunan tidak pernah diisi sehingga data ini selalu gagal
      // tersimpan & tidak ikut dihitung di Surplus/Defisit Pendapatan).
      const _tahunanKey = getTahunanKey();
      const h = (window._lastTahunanByKey && window._lastTahunanByKey[_tahunanKey]) || window._lastTahunan;
      if (h && h.items && h.items.length) {
        const r = ensureAktif(nama);
        if (r) {
          r.belanjaRT = r.belanjaRT || {};
          r.belanjaRT.tahunan = { tipe: 'tahunanrt', nama, ...h, waktu: new Date().toLocaleString('id-ID') };
          r.waktuUpdate = r.belanjaRT.tahunan.waktu;
          persistRespondenDB();
        }
        pushOrReplaceRiwayat({ tipe: 'tahunanrt', nama, ...h });
        sectionsSaved.push('Tahunan');
      }
    }
  } catch (e) { console.warn('Save Tahunan:', e); }


  // 5. NILAI ASET (Rincian 28)
  try {
    if (typeof hitungAset === 'function') hitungAset();
    const h = window._lastAset;
    if (h && h.total > 0) {
      pushOrReplaceRiwayat({ tipe: 'nilaiAset', nama, ...h });
      sectionsSaved.push('Nilai Aset');
    }
  } catch (e) { console.warn('Save Aset:', e); }

  // 6. PENDAPATAN / GAJI (Rincian 18.a)
  try {
    if (document.querySelectorAll('#pendapatanList .rt-row').length > 0) {
      if (typeof hitungPendapatan === 'function') hitungPendapatan();
      const h = window._lastPendapatan;
      if (h && h.orang && h.orang.length > 0) {
        pushOrReplaceRiwayat({ tipe: 'pendapatan', nama, ...h });
        sectionsSaved.push('Pendapatan');
      }
    }
  } catch (e) { console.warn('Save Pendapatan:', e); }

  // 7. GEO-TAGGING (kalau sudah di-capture)
  try {
    if (_geoData && _geoData.lat) {
      const r = ensureAktif(nama);
      if (r) {
        r.geo = _geoData;
        persistRespondenDB();
        sectionsSaved.push('Geo');
      }
    }
  } catch (e) { console.warn('Save Geo:', e); }

  finishEdit();

  if (sectionsSaved.length === 0) {
    // Minimal: Responden wajib, tab lain optional.
    // Karena profil responden sudah di-ensure di awal function, maka izinkan save tanpa memaksa Omzet/Belanja RT.
    showToast('✅ Data Responden tersimpan (tab lain tidak terisi).');
  } else {
    showToast(`✅ Tersimpan: ${sectionsSaved.join(' • ')}`);
  }
}

function pushOrReplaceRiwayat(data) {
  if (window._editingId) {
    const idx = riwayat.findIndex(x => x.id === window._editingId);
    if (idx >= 0) {
      riwayat[idx] = { ...data, id: window._editingId };
    } else {
      riwayat.unshift({ ...data, id: Date.now() });
    }
  } else {
    riwayat.unshift({ ...data, id: Date.now() });
  }
  if (riwayat.length > 30) riwayat = riwayat.slice(0, 30);
  localStorage.setItem('se2026_riwayat', JSON.stringify(riwayat));

  // === Auto-merge ke profil Responden Aktif (new data model) ===
  // Tentukan slot berdasarkan tipe data
  const tipe = data.tipe || 'kalkulator';
  let slot = 'kalkulator';
  if      (tipe === 'biayausaha')                                       slot = 'rincian26';
  else if (tipe === 'nilaiAset')                                        slot = 'rincian28';
  else if (tipe === 'pendapatan')                                       slot = 'pendapatan';
  else if (tipe === 'makanan' || tipe === 'nonmakanan' || tipe === 'tahunanrt') slot = 'belanjaRT.' + (tipe === 'tahunanrt' ? 'tahunan' : tipe);

  // Pastikan respondenAktif terset — kalau belum, derive dari data.nama
  if (!respondenAktif) {
    const key = namaToKey(data.nama);
    if (key) { respondenAktif = key; ensureAktif(data.nama); }
  }
  if (respondenAktif) {
    const r = ensureAktif(data.nama);
    if (slot.startsWith('belanjaRT.')) {
      r.belanjaRT = r.belanjaRT || {};
      r.belanjaRT[slot.split('.')[1]] = data;
    } else {
      r[slot] = data;
    }
    // Field umum yang berguna untuk tampilan & export
    if (data.nama)     r.nama     = data.nama;
    if (data.pekerjaan)r.pekerjaan= data.pekerjaan;
    if (data.jenis)    r.jenis    = data.jenis;
    if (data.kbli)     r.kbli     = data.kbli;
    if (data.satuan)   r.satuan   = data.satuan;
    r.waktuUpdate = new Date().toLocaleString('id-ID');
    persistRespondenDB();
    renderRespondenAktifBar();
  }
}

function finishEdit() {
  if (window._editingId) {
    window._editingId = null;
    hideEditBanner();
  }
}

// ===== RENDER RIWAYAT =====
function renderRiwayat() {
  const container = document.getElementById('riwayatList');
  const expBar = document.getElementById('exportBar');
  const searchBar = document.getElementById('searchBar');
  const respKeys = Object.keys(respondenDB);
  if (!riwayat.length && !respKeys.length) {
    if (expBar) expBar.style.display = 'none';
    if (searchBar) searchBar.style.display = 'none';
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span>Belum ada data tersimpan.<br>Hitung dan simpan dulu dari tab lainnya.</div>`;
    return;
  }
  if (expBar) expBar.style.display = 'flex';
  if (searchBar) searchBar.style.display = '';

  // Quick search filter
  const searchInp = document.getElementById('searchRiwayat');
  const q = (searchInp ? searchInp.value : '').toLowerCase().trim();

  // ===== Bagian per-Responden (utama) =====
  let respHtml = '';
  if (respKeys.length) {
    // Sort by waktuUpdate desc + apply search
    let sorted = respKeys
      .map(k => respondenDB[k])
      .sort((a, b) => (new Date(b.waktuUpdate || 0).getTime()) - (new Date(a.waktuUpdate || 0).getTime()));
    if (q) {
      sorted = sorted.filter(r => {
        const hay = `${r.nama||''} ${r.jenis||''} ${r.kbli||''} ${r.pekerjaan||''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    respHtml = `<div style="margin-bottom:14px"><div style="font-weight:700;font-size:13px;color:var(--bps-blue);margin-bottom:8px;letter-spacing:0.3px">👥 RESPONDEN TERSIMPAN (${sorted.length}${q?' / '+respKeys.length:''})</div>`;
    if (!sorted.length && q) {
      respHtml += `<div class="empty-state"><span class="empty-icon">🔍</span>Tidak ada responden cocok dengan "<b>${q}</b>"</div></div>`;
      container.innerHTML = respHtml;
      return;
    }
    sorted.forEach(r => {
      const did = 'resp-' + r._key.replace(/[^a-z0-9]/gi,'_');
      const k = r._key;
      const parts = [];
      if (r.kalkulator) parts.push('🧮 Kalk');
      if (r.rincian26ByUsaha && Object.keys(r.rincian26ByUsaha).length > 1) {
        parts.push(`📊 R26 (${Object.keys(r.rincian26ByUsaha).length} usaha)`);
      } else if (r.rincian26 || r.rincian26ByUsaha) {
        parts.push('📊 R26');
      }
      if (r.rincian28)  parts.push('🏠 Aset');
      if (r.belanjaRT)  parts.push('🛍️ RT');
      if (r.pendapatan) parts.push('💵 Pend');
      const status = r.status || 'draft';
      const statusBadge = status === 'final'
        ? '<span style="background:#1d6b2e;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px">✅ FINAL</span>'
        : '<span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px">📝 DRAFT</span>';
      const geoBadge = (r.geo && r.geo.lat)
        ? `<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:4px" title="${r.geo.lat}, ${r.geo.lon}">📍 Geo</span>`
        : '';
      const laba   = r.kalkulator ? formatRp(r.kalkulator.labaTahun || 0) : '-';

      // REQ #2: totalR26 di header kartu = jumlah 26.f SEMUA usaha (rincian26ByUsaha),
      // bukan cuma snapshot terakhir (r.rincian26 lama bisa tertimpa usaha terakhir saja).
      const r26ByUsahaBadge = r.rincian26ByUsaha || null;
      const totalR26Num = r26ByUsahaBadge
        ? Object.keys(r26ByUsahaBadge).reduce((s, i) => s + (r26ByUsahaBadge[i].total || 0), 0)
        : (r.rincian26 ? (r.rincian26.total || 0) : 0);
      const totalR26 = (r26ByUsahaBadge || r.rincian26) ? formatRp(totalR26Num) : '-';

      let detailHtml = '';
      if (r.kalkulator) {
        const k2 = r.kalkulator;
        detailHtml += `<div class="ri-detail-row"><b>Kalkulator</b><span></span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Jenis</span><span>${k2.jenis || '-'}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Omzet/Bulan</span><span>${formatRp(k2.omzetBulan||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Omzet/Tahun</span><span>${formatRp(k2.omzetTahun||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row" style="color:var(--green);font-weight:600"><span>Laba/Tahun</span><span>${formatRp(k2.labaTahun||0)}</span></div>`;
      }

      // REQ #2: tampilkan Rincian 26 (Biaya Usaha) UNTUK SETIAP inner tab
      // "Biaya Usaha 1..n" — satu blok per usaha, diberi label jenis usaha
      // (dari jenisUsahaByUsaha) sama seperti label tab di form input.
      // Fallback ke snapshot lama r.rincian26 untuk data yang tersimpan
      // sebelum fitur per-usaha ini ada (kompatibilitas data lama).
      const jenisByUsahaBadge = r.jenisUsahaByUsaha || {};
      if (r26ByUsahaBadge && Object.keys(r26ByUsahaBadge).length) {
        const idxs = Object.keys(r26ByUsahaBadge).map(n => parseInt(n, 10)).sort((a,b) => a - b);
        idxs.forEach(i => {
          const x = r26ByUsahaBadge[i] || {};
          const jenisKey = jenisByUsahaBadge[i] || '';
          const jenisLabel = jenisKey ? (JENIS_LABEL[jenisKey] || jenisKey) : '';
          const heading = jenisLabel
            ? `Rincian 26 (Biaya Usaha) — Usaha ${i} · ${jenisLabel}`
            : `Rincian 26 (Biaya Usaha) — Usaha ${i}`;
          detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>${heading}</b><span></span></div>`;
          detailHtml += `<div class="ri-detail-row"><span>26.a Upah/Gaji</span><span>${formatRp(x.a||0)}</span></div>`;
          detailHtml += `<div class="ri-detail-row"><span>26.b Produksi</span><span>${formatRp(x.b||0)}</span></div>`;
          detailHtml += `<div class="ri-detail-row"><span>26.c Sewa/Jasa</span><span>${formatRp(x.c||0)}</span></div>`;
          detailHtml += `<div class="ri-detail-row"><span>26.d Operasional</span><span>${formatRp(x.d||0)}</span></div>`;
          detailHtml += `<div class="ri-detail-row"><span>26.e Non-Op</span><span>${formatRp(x.e||0)}</span></div>`;
          detailHtml += `<div class="ri-detail-row" style="color:var(--bps-blue);font-weight:700"><span>26.f TOTAL Usaha ${i}</span><span>${formatRp(x.total||0)}</span></div>`;
          // Item rinci 26.b–26.e (nama & nilai tiap item), kalau ada
          ['itemsB','itemsC','itemsD','itemsE'].forEach((key, k2i) => {
            const items = x[key] || [];
            const kodeMap = ['26.b','26.c','26.d','26.e'];
            items.forEach(it => {
              if (!it || (!it.nama && !it.nilai)) return;
              detailHtml += `<div class="ri-detail-row" style="font-size:12px;color:var(--muted)"><span>↳ ${kodeMap[k2i]} ${it.nama || '(tanpa nama)'}</span><span>${formatRp(it.nilai||0)}</span></div>`;
            });
          });
        });
        if (idxs.length > 1) {
          detailHtml += `<div class="ri-detail-row" style="margin-top:4px;color:var(--bps-blue);font-weight:700"><span>Σ TOTAL Semua Usaha</span><span>${formatRp(totalR26Num)}</span></div>`;
        }
      } else if (r.rincian26) {
        const x = r.rincian26;
        detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>Rincian 26 (Biaya Usaha)</b><span></span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>26.a Upah/Gaji</span><span>${formatRp(x.a||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>26.b Produksi</span><span>${formatRp(x.b||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>26.c Sewa/Jasa</span><span>${formatRp(x.c||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>26.d Operasional</span><span>${formatRp(x.d||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>26.e Non-Op</span><span>${formatRp(x.e||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row" style="color:var(--bps-blue);font-weight:700"><span>26.f TOTAL</span><span>${formatRp(x.total||0)}</span></div>`;
      }
      if (r.rincian28) {
        const x = r.rincian28;
        detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>Rincian 28 (Nilai Aset)</b><span></span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>28.a-e Total</span><span style="color:var(--bps-blue);font-weight:700">${formatRp(x.total||0)}</span></div>`;
      }
      if (r.belanjaRT) {
        detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>Belanja RT</b><span></span></div>`;
        if (r.belanjaRT.makanan)    detailHtml += `<div class="ri-detail-row"><span>Makanan/Minggu</span><span>${formatRp(r.belanjaRT.makanan.totalMinggu||0)}</span></div>`;
        if (r.belanjaRT.nonmakanan) detailHtml += `<div class="ri-detail-row"><span>Non-Makanan/Bulan</span><span>${formatRp(r.belanjaRT.nonmakanan.totalBulan||0)}</span></div>`;
        if (r.belanjaRT.tahunan)    detailHtml += `<div class="ri-detail-row"><span>Tahunan</span><span>${formatRp(r.belanjaRT.tahunan.totalTahun||0)}</span></div>`;
      }
      if (r.pendapatan) {
        const p = r.pendapatan;
        detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>Pendapatan (Rincian 18.a)</b><span></span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Jumlah Anggota</span><span>${(p.orang||[]).length} orang</span></div>`;
        (p.orang || []).forEach(o => {
          const tag = o.isPemilikUsaha ? '👤 ' : '';
          detailHtml += `<div class="ri-detail-row" style="font-size:12px;color:#555"><span>↳ ${tag}${o.nama||'(?)'} <i>(${o.relasi||''})</i></span><span>${formatRp(o.total||0)}/bln</span></div>`;
        });
        detailHtml += `<div class="ri-detail-row"><span>Total Anggota/Bulan</span><span>${formatRp(p.totalAnggotaBulan||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>+ Laba Usaha/Bulan</span><span>${formatRp(p.labaUsahaBulan||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row" style="color:var(--bps-blue);font-weight:700"><span>Total Pendapatan/Bulan</span><span>${formatRp(p.totalBulan||0)}</span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Total Pendapatan/Tahun</span><span>${formatRp(p.totalTahun||0)}</span></div>`;
        const surplus = p.surplus || 0;
        const surColor = surplus >= 0 ? '#1d6b2e' : '#b22';
        detailHtml += `<div class="ri-detail-row" style="color:${surColor};font-weight:700"><span>${surplus>=0?'Surplus':'Defisit'}/Bulan</span><span>${formatRp(Math.abs(surplus))}</span></div>`;
      }
      if (r.geo && r.geo.lat) {
        detailHtml += `<div class="ri-detail-row" style="margin-top:6px"><b>📍 Geo-tagging</b><span></span></div>`;
        detailHtml += `<div class="ri-detail-row"><span>Koordinat</span><span><a href="https://www.google.com/maps?q=${r.geo.lat},${r.geo.lon}" target="_blank" style="color:#1565c0">${r.geo.lat}, ${r.geo.lon}</a> (±${r.geo.accuracy||'?'}m)</span></div>`;
        if (r.geo.waktu) detailHtml += `<div class="ri-detail-row"><span>Waktu</span><span>${r.geo.waktu}</span></div>`;
      }

      respHtml += `
        <div class="riwayat-item" id="ri-card-${k.replace(/[^a-zA-Z0-9]/g,'-')}" style="border-left:4px solid var(--bps-blue);background:var(--green-bg)">
          <div class="ri-header" onclick="toggleDetail('${did}')" style="cursor:pointer">
            <div>
              <div class="ri-nama">👤 ${r.nama}${statusBadge}${geoBadge}</div>
              <div class="ri-waktu">${r.waktuUpdate || r.waktuPertama || '-'}</div>
              <div class="ri-jenis" style="margin-top:4px">${parts.join(' · ') || '<i>Profil kosong</i>'} · Laba/Th: <b>${laba}</b> · R26: <b>${totalR26}</b></div>
            </div>
            <span id="arr-${did}" style="color:var(--muted);font-size:18px;transition:transform 0.2s">▼</span>
          </div>
          <div id="${did}" class="ri-detail-body" style="display:none">${detailHtml || '<i>Belum ada data</i>'}</div>
          <div class="ri-footer" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
            <button class="ri-btn edit" onclick='editResponden("${k.replace(/"/g,'\\"')}")'>✏️ Buka</button>
            <button class="ri-btn" style="background:${status==='final'?'#fff3e0':'#e8f5e9'};color:${status==='final'?'#e65100':'#1d6b2e'};border:1px solid ${status==='final'?'#e65100':'#1d6b2e'}" onclick='toggleStatusResponden("${k.replace(/"/g,'\\"')}")'>${status==='final'?'📝 Ubah ke Draft':'✅ Tandai Final'}</button>
            <button class="ri-btn" style="background:#e3f2fd;color:#1565c0;border:1px solid #1565c0" onclick='salinDataResponden("${k.replace(/"/g,'\\"')}")'>📋 Salin Data</button>
            <button class="ri-btn" style="background:#fff3e0;color:#e65100;border:1px solid #e65100" onclick='screenshotResponden("${k.replace(/"/g,'\\"')}", "ri-card-${k.replace(/[^a-zA-Z0-9]/g,'-')}")'>📸 Simpan Gambar</button>
            <button class="ri-btn del" onclick='hapusResponden("${k.replace(/"/g,'\\"')}")'>🗑️ Hapus</button>
          </div>
        </div>`;
    });
    respHtml += `</div>`;
  }
  container.innerHTML = respHtml;
  return; // Skip old per-entry list (data lama otomatis ter-migrasi ke responden)
}

// Tambah handler untuk responden card
function editResponden(key) {
  try {
    // Debug guard agar tombol "Buka" tidak silent gagal
    console.log('[editResponden] key=', key, 'ada?', !!(respondenDB && respondenDB[key]));

    if (!respondenDB || !respondenDB[key]) {
      showToast('⚠️ Profil tidak ditemukan di respondenDB.');
      return;
    }

    respondenAktif = key;
    persistRespondenDB();
    renderRespondenAktifBar();

    // Normalisasi key untuk semua restore
    const r = respondenDB[key];
    if (!r) {
      showToast('⚠️ Profil kosong saat restore.');
      return;
    }

    // Restore tab Responden (identitas utama)
    try {
      const elKK = document.getElementById('nomorKeluargaRes');
      if (elKK) elKK.value = (r.nomorKeluargaRes ?? r.nomorKeluarga ?? '') || '';

      const elBG = document.getElementById('nomorBangunanRes');
      if (elBG) elBG.value = (r.nomorBangunanRes ?? r.nomorBangunan ?? '') || '';

      const elNamaRes = document.getElementById('namaResponden');
      if (elNamaRes) elNamaRes.value = r.nama || key;

      // Catatan PATCH #1: elemen id="namaUsaha" (tanpa suffix) sudah tidak ada lagi
      // di markup versi multi-usaha ini (sudah digantikan namaResponden). Baris lama
      // yang menulis ke elemen tersebut dihapus karena hanya melempar error tersembunyi
      // dan tidak berpengaruh pada UI manapun.

      const elPekerjaan = document.getElementById('pekerjaanResponden');
      if (elPekerjaan) {
        const val = r.pekerjaanResponden || r.pekerjaanUtamaResponden || r.pekerjaan;
        if (val) {
          elPekerjaan.value = val;
          // Pastikan render dropdown stabil
          elPekerjaan.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }


      // Jumlah usaha (inner tab)
      const elJu = document.getElementById('jumlahUsaha');
      if (elJu) {
        const juVal = (r.jumlahUsaha ?? r.jumlahUsahaAktif ?? 0) || 0;
        elJu.value = String(juVal);
        elJu.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Trigger render dropdown usaha & inner form (agar field turunan ikut ke-load)
      try {
        if (typeof renderUsahaTabs === 'function') renderUsahaTabs();
      } catch(e) {}

    } catch(e) {}

      // Pastikan #jumlahUsaha sesuai profil

    if (typeof r.jumlahUsaha !== 'undefined') {
      const elJu = document.getElementById('jumlahUsaha');
      if (elJu) {
        elJu.value = String(r.jumlahUsaha || 0);
        elJu.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }


  // === Restore SEMUA tab dari profil responden ===
  // Kalkulator
  if (r.kalkulatorByUsaha && typeof r.kalkulatorByUsaha === 'object') {
    // Format baru (pasca-patch): restore penuh untuk usaha 1..5 ditangani oleh
    // blok PATCH #3 di bawah (id bersuffix yang benar). Di sini cukup bersihkan
    // form usaha 1 dulu supaya tidak ada sisa data dari profil sebelumnya.
    try { resetForm(); } catch(e){}
  } else if (r.kalkulator) {
    // Fallback untuk profil lama (tersimpan sebelum patch ini, belum punya
    // kalkulatorByUsaha) — pakai jalur legacy sebisa mungkin.
    try { populateKalkulator(r.kalkulator); } catch(e) { console.warn('populateKalkulator', e); }
  } else {
    try { resetForm(); } catch(e){}
  }

  // Belanja RT (3 sub-kategori) — utamakan slot DB, fallback ke riwayat[]
  try { resetMakanan();    } catch(e){}
  try { resetNonMakanan(); } catch(e){}
  try { resetTahunan();    } catch(e){}
  const rt = r.belanjaRT || {};
  const findInRiwayat = (tipe) => {
    const targets = riwayat.filter(x => x.tipe === tipe && x.nama && namaToKey(x.nama) === key);
    return targets[0] || null;
  };
  const makanan    = rt.makanan    || findInRiwayat('makanan');
  const nonmakanan = rt.nonmakanan || findInRiwayat('nonmakanan');
  const tahunan    = rt.tahunan    || findInRiwayat('tahunanrt');
  if (makanan)    { try { populateRT(makanan,    'makanan');    } catch(e){ console.warn('populateRT makanan', e); } }
  if (nonmakanan) { try { populateRT(nonmakanan, 'nonmakanan'); } catch(e){ console.warn('populateRT nonmakanan', e); } }
  if (tahunan)    { try { populateRT(tahunan,    'tahunan');    } catch(e){ console.warn('populateRT tahunan', e); } }

  // Nilai Aset (Rincian 28) — utamakan slot DB, fallback ke riwayat[]
  try { resetAset(); } catch(e){}
  const aset = r.rincian28 || findInRiwayat('nilaiAset');
  if (aset) { try { populateAset(aset); } catch(e){ console.warn('populateAset', e); } }

  // Pendapatan (Rincian 18.a)
  try { resetPendapatan(); } catch(e){}
  const pend = r.pendapatan || findInRiwayat('pendapatan');
  if (pend) { try { populatePendapatan(pend); } catch(e){ console.warn('populatePendapatan', e); } }

  // PATCH #2: Restore "Jenis Usaha Responden" per usaha 1..5 — set dropdown
  // jenisUsahaSelect_i DAN jenisUsahaMap[i] (in-memory, dipakai untuk kalkulasi
  // faktor musim, tag KBLI, dsb.) via pilihJenis(). Sebelumnya jenisUsahaMap
  // hanya variabel in-memory yang tidak pernah dipulihkan setelah reload/buka profil.
  const jumlahUsahaProfil = parseInt((document.getElementById('jumlahUsaha') || {}).value, 10) || (r.jumlahUsaha || 0) || 0;
  if (r.jenisUsahaByUsaha && typeof r.jenisUsahaByUsaha === 'object') {
    for (let i = 1; i <= 5; i++) {
      if (jumlahUsahaProfil && i > jumlahUsahaProfil) break;
      const jenis = r.jenisUsahaByUsaha[i];
      if (!jenis) continue;
      try {
        const sel = document.getElementById('jenisUsahaSelect_' + i);
        if (sel) sel.value = jenis;
        pilihJenis(null, jenis, i); // set jenisUsahaMap[i] + KBLI tag + section musim
      } catch(e) { console.warn('restore jenisUsahaByUsaha idx', i, e); }
    }
  }

  // PATCH #3: Restore kalkulator per usaha (omzet, satuan waktu, tenaga kerja,
  // jumlah bulan panen) untuk SEMUA usaha 1..5 dengan id bersuffix yang benar.
  // Sebelumnya populateKalkulator(r.kalkulator) memakai id legacy tanpa suffix
  // yang tidak ada di DOM sehingga tidak pernah benar-benar mengisi usaha manapun,
  // dan hanya usaha TERAKHIR yang omzetnya tersimpan (menimpa usaha sebelumnya).
  if (r.kalkulatorByUsaha && typeof r.kalkulatorByUsaha === 'object') {
    for (let i = 1; i <= 5; i++) {
      if (jumlahUsahaProfil && i > jumlahUsahaProfil) break;
      // Fallback ke snapshot lama r.kalkulator untuk usaha 1 (kompatibilitas data
      // yang tersimpan sebelum patch ini, sebelum ada kalkulatorByUsaha).
      const k = r.kalkulatorByUsaha[i] || (i === 1 ? r.kalkulator : null);
      if (!k) continue;
      try {
        const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
        if (k.satuan) { setVal('satuanWaktu_' + i, k.satuan); try { updateSatuan(i); } catch(e){} }
        if (k.omzet != null) setVal('omzet_' + i, formatNumberId(k.omzet));
        if (k.nKaryawan != null) setVal('jumlahKaryawan_' + i, k.nKaryawan);
        if (k.gajiPerOrang) setVal('gajiPerOrang_' + i, formatNumberId(k.gajiPerOrang));
        if (k.jamsosPerOrang) setVal('jamsosPerOrang_' + i, formatNumberId(k.jamsosPerOrang));
        if (k.thrPerOrang) setVal('thrPerOrang_' + i, formatNumberId(k.thrPerOrang));
        if (k.bulanPanen) setVal('bulanPanen_' + i, k.bulanPanen);
      } catch(e) { console.warn('restore kalkulatorByUsaha idx', i, e); }
    }
  }

  // Rincian 26 (Biaya Usaha) — kalau ada
  // Jika ada data per-usaha, isi inner tab "Usaha N" (item rinci 26.b-e) DAN
  // inner tab "Biaya Usaha N" (ringkasan). Backward compat: tetap gunakan
  // r.rincian26 sebagai fallback snapshot.
  const r26ByUsaha = r.rincian26ByUsaha || null;
  if (r26ByUsaha && typeof r26ByUsaha === 'object') {
    try {
      // Pastikan tab Biaya Usaha inner tabs sudah ter-render dulu
      const jumlah = jumlahUsahaProfil;
      if (jumlah > 1 && typeof renderBiayaUsahaTabs === 'function') {
        renderBiayaUsahaTabs();
      }

      // Isi setiap usaha
      for (let i = 1; i <= 5; i++) {
        if (jumlah && i > jumlah) break;
        const per = r26ByUsaha[i];
        if (!per) continue;

        // PATCH #3: isi ULANG item rinci 26.b-e di tab "Usaha N" (bu26{k}List_i)
        // dari itemsB/C/D/E yang tersimpan, bukan hanya angka total.
        try {
          ['b','c','d','e'].forEach(k => {
            const list = document.getElementById('bu26' + k + 'List_' + i);
            if (!list) return;
            list.innerHTML = '';
            const items = per['items' + k.toUpperCase()] || [];
            items.forEach(it => {
              tambahItemBiaya(k, i);
              const rows = list.querySelectorAll('.rt-row');
              const last = rows[rows.length - 1];
              const inputs = last.querySelectorAll('input');
              inputs[0].value = it.nama || '';
              inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
            });
          });
          // Restore Tenaga Kerja (26.a) jika belum diisi oleh PATCH #3 kalkulatorByUsaha di atas
          const setValTK = (id, v) => { const el = document.getElementById(id); const cur = el ? el.value : null; if (el && (!cur || cur === '0') && v != null) el.value = v; };
          if (per.nKaryawan != null) setValTK('jumlahKaryawan_' + i, per.nKaryawan);
          if (per.gajiPerOrang) setValTK('gajiPerOrang_' + i, formatNumberId(per.gajiPerOrang));
          if (per.jamsosPerOrang) setValTK('jamsosPerOrang_' + i, formatNumberId(per.jamsosPerOrang));
          if (per.thrPerOrang) setValTK('thrPerOrang_' + i, formatNumberId(per.thrPerOrang));

          // Hitung ulang dari data yang baru dipulihkan (lebih akurat daripada
          // menimpa manual angka ringkasan, karena juga menyinkronkan tab "Biaya Usaha").
          if (typeof hitungBiayaUsaha === 'function') hitungBiayaUsaha(i);
        } catch(e) {
          console.warn('restore item rincian26ByUsaha idx', i, e);
          // Fallback terakhir: minimal isi angka ringkasan di tab "Biaya Usaha"
          const setNum = (id, v) => {
            const el = document.getElementById(id);
            if (el) { el.textContent = formatRp(v || 0); if (el.dataset) el.dataset.value = String(v || 0); }
          };
          setNum('biaSum26a_' + i, per.a);
          setNum('biaSum26b_' + i, per.b);
          setNum('biaSum26c_' + i, per.c);
          setNum('biaSum26d_' + i, per.d);
          setNum('biaSum26e_' + i, per.e);
          const total = per.total || (per.a||0)+(per.b||0)+(per.c||0)+(per.d||0)+(per.e||0);
          setNum('biaSum26f_' + i, total);
          const ter = document.getElementById('biaSum26-terbilang_' + i);
          if (ter) ter.textContent = total > 0 ? terbilang(total) : '';
        }
      }

      // Setelah isi per-usaha, tampilkan Σ Total Semua konsisten
      try { syncBiayaUsahaSummary(); } catch(e){}

    } catch(e) { console.warn('populate rincian26ByUsaha:', e); }
  }

  const r26 = r.rincian26 || findInRiwayat('biayausaha');
  if (r26 && !r26ByUsaha) { try { populateBiayaUsaha(r26); } catch(e){} }


  // Restore geo-tagging (kalau pernah ditandai)
  if (r.geo && r.geo.lat) { _geoData = r.geo; }
  else { _geoData = null; }
  try { renderGeoStatus(); } catch(e){}

  // PATCH #1: re-apply Pekerjaan Utama Responden sebagai langkah TERAKHIR yang
  // defensif. Akar masalahnya: populateKalkulator() di atas memanggil resetForm(),
  // yang me-reset dropdown #pekerjaanResponden ke indeks 0 (kosong) — dan snapshot
  // r.kalkulator tidak membawa field pekerjaan untuk mengembalikannya. Dengan
  // menerapkannya lagi di sini (setelah semua populate/reset selesai), nilai yang
  // benar dijamin bertahan terlepas dari efek samping fungsi-fungsi restore lain.
  try {
    const elPekerjaanFinal = document.getElementById('pekerjaanResponden');
    const pekerjaanValFinal = r.pekerjaanResponden || r.pekerjaanUtamaResponden || r.pekerjaan || '';
    if (elPekerjaanFinal && pekerjaanValFinal) {
      elPekerjaanFinal.value = pekerjaanValFinal;
      elPekerjaanFinal.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch(e) { console.warn('re-apply pekerjaanResponden', e); }

  // Karena tab yang benar untuk membuka profil adalah tab "Responden"
  // (kalkulator/isi usaha biasanya akan ikut ter-restore oleh populateKalkulator)
  showTab('responden');
  showToast('✏️ Buka profil: ' + r.nama);
  } catch (e) {
    console.error('[editResponden] error', e);
    showToast('❌ Gagal buka profil. Cek console.');
  }
}
function hapusResponden(key) {
  if (!respondenDB[key]) return;
  const nama = respondenDB[key].nama;
  if (!confirm(`Hapus profil responden "${nama}"? (Tidak bisa dibatalkan)`)) return;
  delete respondenDB[key];
  if (respondenAktif === key) respondenAktif = null;
  persistRespondenDB();
  renderRiwayat();
  renderRespondenAktifBar();
  showToast('🗑️ Profil "' + nama + '" dihapus');
}

// ===== SALIN DATA RESPONDEN sebagai TEKS =====
function salinDataResponden(key) {
  const r = respondenDB[key];
  if (!r) { showToast('⚠️ Data tidak ditemukan'); return; }
  const lines = [];
  lines.push('═══ RESPONDEN SE2026 ═══');
  lines.push(`Nama Usaha     : ${r.nama}`);
  lines.push(`Status         : ${(r.status||'draft').toUpperCase()}`);
  if (r.pekerjaan) lines.push(`Pekerjaan      : ${r.pekerjaan}`);
  if (r.jenis)     lines.push(`Jenis Usaha    : ${r.jenis}`);
  if (r.kbli)      lines.push(`KBLI           : ${r.kbli}`);
  if (r.geo && r.geo.lat) lines.push(`Geo-tagging    : ${r.geo.lat}, ${r.geo.lon} (±${r.geo.accuracy||'?'}m)`);
  lines.push(`Waktu Update   : ${r.waktuUpdate || r.waktuPertama || '-'}`);
  lines.push('');

  // KALKULATOR
  if (r.kalkulator) {
    const k = r.kalkulator;
    lines.push('── KALKULATOR ──');
    if (k.nomorKeluarga && k.nomorKeluarga !== '-') lines.push(`No. Keluarga   : ${k.nomorKeluarga}`);
    if (k.nomorBangunan && k.nomorBangunan !== '-') lines.push(`No. Bangunan   : ${k.nomorBangunan}`);
    lines.push(`Omzet/Tahun    : ${formatRp(k.omzetTahun||0)}`);
    lines.push(`Biaya/Bulan    : ${formatRp(k.totalBiayaBulan||0)}`);
    lines.push(`Laba/Tahun     : ${formatRp(k.labaTahun||0)}`);
    lines.push('');
  }

  // RINCIAN 26
  if (r.rincian26) {
    const x = r.rincian26;
    lines.push('── RINCIAN 26 (BIAYA USAHA / TAHUN) ──');
    lines.push(`26.a Pengeluaran Tenaga Kerja : ${formatRp(x.a||0)}`);
    lines.push(`26.b Bahan Baku/Produksi      : ${formatRp(x.b||0)}`);
    lines.push(`26.c Sewa/Jasa                 : ${formatRp(x.c||0)}`);
    lines.push(`26.d Energi/Bahan Bakar        : ${formatRp(x.d||0)}`);
    lines.push(`26.e Pengeluaran Lain          : ${formatRp(x.e||0)}`);
    lines.push(`26.f TOTAL Biaya Usaha         : ${formatRp(x.total||0)}`);
    lines.push('');
  }

  // RINCIAN 28
  if (r.rincian28) {
    const x = r.rincian28;
    lines.push('── RINCIAN 28 (NILAI ASET) ──');
    lines.push(`28.a Tanah          : ${formatRp(x.a||0)}`);
    lines.push(`28.b Bangunan       : ${formatRp(x.b||0)}`);
    lines.push(`28.c Mesin/Alat     : ${formatRp(x.c||0)}`);
    lines.push(`28.d Kendaraan      : ${formatRp(x.d||0)}`);
    lines.push(`28.e Aset Lainnya   : ${formatRp(x.e||0)}`);
    lines.push(`28.f TOTAL Aset     : ${formatRp(x.total||0)}`);
    lines.push('');
  }

  // BELANJA RT
  if (r.belanjaRT) {
    lines.push('── BELANJA RUMAH TANGGA ──');
    if (r.belanjaRT.makanan)    lines.push(`Makanan / Minggu      : ${formatRp(r.belanjaRT.makanan.totalMinggu||0)}`);
    if (r.belanjaRT.makanan)    lines.push(`Makanan / Bulan       : ${formatRp(r.belanjaRT.makanan.totalBulan||0)}`);
    if (r.belanjaRT.nonmakanan) lines.push(`Non-Makanan / Bulan   : ${formatRp(r.belanjaRT.nonmakanan.totalBulan||0)}`);
    if (r.belanjaRT.tahunan)    lines.push(`Tahunan               : ${formatRp(r.belanjaRT.tahunan.totalTahun||0)}`);
    lines.push('');
  }

  // PENDAPATAN
  if (r.pendapatan) {
    const p = r.pendapatan;
    lines.push('── PENDAPATAN (RINCIAN 18.a) ──');
    lines.push(`Jumlah Anggota   : ${(p.orang||[]).length} orang`);
    (p.orang||[]).forEach(o => {
      const tag = o.isPemilikUsaha ? '[OWNER] ' : '';
      lines.push(`  ${tag}${o.nama||'(?)'} (${o.relasi||''}) : ${formatRp(o.total||0)}/bln`);
    });
    lines.push(`Total Anggota/Bulan : ${formatRp(p.totalAnggotaBulan||0)}`);
    lines.push(`+ Laba Usaha/Bulan  : ${formatRp(p.labaUsahaBulan||0)}`);
    lines.push(`= Total/Bulan       : ${formatRp(p.totalBulan||0)}`);
    lines.push(`Total/Tahun         : ${formatRp(p.totalTahun||0)}`);
    lines.push(`Belanja RT/Bulan    : ${formatRp(p.belanjaBulan||0)}`);
    lines.push(`${(p.surplus||0)>=0?'Surplus':'Defisit'}/Bulan       : ${formatRp(Math.abs(p.surplus||0))}`);
    lines.push('');
  }

  lines.push('— Asisten Petugas SE2026 —');
  const teks = lines.join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(teks).then(() => showToast('📋 Data tersalin!'))
      .catch(() => fallbackCopy(teks));
  } else {
    fallbackCopy(teks);
  }
}

// (duplikasi) fallbackCopy dihapus; gunakan versi fallbackCopy(teks) di bawah.


// ===== SCREENSHOT CARD RESPONDEN -> PNG =====
async function screenshotResponden(key, cardId) {
  const r = respondenDB[key];
  if (!r) { showToast('⚠️ Data tidak ditemukan'); return; }
  if (typeof html2canvas === 'undefined') {
    showToast('⚠️ Library belum siap, coba lagi sebentar');
    return;
  }
  const card = document.getElementById(cardId);
  if (!card) { showToast('⚠️ Card tidak ditemukan'); return; }

  // Buka detail dulu agar screenshot meliputi seluruh isi
  const detailBody = card.querySelector('.ri-detail-body');
  const arrow = card.querySelector('[id^="arr-"]');
  const wasHidden = detailBody && detailBody.style.display === 'none';
  if (wasHidden) {
    detailBody.style.display = 'block';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }

  // Sembunyikan tombol-tombol footer sementara saat capture
  const footer = card.querySelector('.ri-footer');
  const footerDisplay = footer ? footer.style.display : null;
  if (footer) footer.style.display = 'none';

  showToast('📸 Memproses gambar…');

  try {
    const canvas = await html2canvas(card, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false
    });
    canvas.toBlob(async (blob) => {
      const safeName = (r.nama || 'responden').replace(/[^a-zA-Z0-9]+/g, '_');
      const filename = `SE2026_${safeName}_${Date.now()}.png`;

      // Coba Web Share API (mobile) — bisa langsung ke galeri/WhatsApp
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Data Responden SE2026',
            text: `Data responden: ${r.nama}`
          });
          showToast('✅ Gambar siap dibagikan');
          return;
        } catch (e) {
          if (e.name === 'AbortError') { return; }
          // Fallback ke download biasa
        }
      }

      // Fallback: trigger download (di mobile Chrome → masuk Downloads → user bisa pindah ke galeri)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('✅ Gambar tersimpan: ' + filename);
    }, 'image/png');
  } catch (e) {
    console.error(e);
    showToast('❌ Gagal screenshot: ' + e.message);
  } finally {
    if (footer) footer.style.display = footerDisplay || '';
    if (wasHidden && detailBody) {
      detailBody.style.display = 'none';
      if (arrow) arrow.style.transform = '';
    }
  }
}

function _renderRiwayatLegacy_unused() {
  // (kode lama disimpan untuk referensi)

  let html = '';
  riwayat.forEach(r => {
    const tipe = r.tipe || 'kalkulator';
    const did = `detail-${r.id}`;

    let judul = '', ringkas = '', detail = '';

    if (tipe === 'biayausaha') {
      judul = '📊 Biaya Usaha (Rincian 26)';
      ringkas = `Total Pengeluaran: <b>${formatRp(r.total)}</b>`;
      const rincianDetail = (label, items, nilai) => {
        let out = `<div class="ri-detail-row"><span>${label}</span><span>${formatRp(nilai)}</span></div>`;
        if (items && items.length) {
          items.forEach(it => {
            if (it.nilai > 0) out += `<div class="ri-detail-row" style="padding-left:12px;font-size:11px"><span>↳ ${it.nama}</span><span>${formatRp(it.nilai)}</span></div>`;
          });
        }
        return out;
      };
      detail = rincianDetail('26.a Upah & Gaji', r.itemsA, r.a)
             + rincianDetail('26.b Biaya Produksi', r.itemsB || r.itemsProduksi, r.b)
             + rincianDetail('26.c Sewa & Jasa', r.itemsC, r.c)
             + rincianDetail('26.d Biaya Operasional', r.itemsD, r.d)
             + rincianDetail('26.e Non-Operasional', r.itemsE, r.e)
             + `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue)"><span>Total</span><span>${formatRp(r.total)}</span></div>`;

    } else if (tipe === 'nilaiAset') {
      judul = '🏠 Nilai Aset Usaha (Rincian 28)';
      ringkas = `Total Aset: <b>${formatRp(r.total)}</b>`;
      const rincianAset = (label, items, nilai) => {
        let out = `<div class="ri-detail-row"><span>${label}</span><span>${formatRp(nilai)}</span></div>`;
        if (items && items.length) {
          items.forEach(it => {
            if (it.nilai > 0) out += `<div class="ri-detail-row" style="padding-left:12px;font-size:11px"><span>↳ ${it.nama}</span><span>${formatRp(it.nilai)}</span></div>`;
          });
        }
        return out;
      };
      detail = rincianAset('28.a Tanah', r.itemsA, r.a)
             + rincianAset('28.b Bangunan', r.itemsB, r.b)
             + rincianAset('28.c Mesin & Peralatan', r.itemsC, r.c)
             + rincianAset('28.d Kendaraan', r.itemsD, r.d)
             + rincianAset('28.e Aset Lainnya', r.itemsE, r.e)
             + `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue)"><span>Total</span><span>${formatRp(r.total)}</span></div>`;

    } else if (tipe === 'makanan') {
      judul = '🍽️ Belanja Makanan & Minuman';
      ringkas = `Total/Minggu: <b>${formatRp(r.totalMinggu)}</b>`;
      (r.items||[]).forEach(it => detail += `<div class="ri-detail-row"><span>↳ ${it.nama}</span><span>${formatRp(it.nilai)}/${it.satuan}</span></div>`);
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue);margin-top:6px"><span>Total/Minggu</span><span>${formatRp(r.totalMinggu)}</span></div>`;
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue)"><span>Total/Bulan</span><span>${formatRp(r.totalBulan)}</span></div>`;

    } else if (tipe === 'nonmakanan') {
      judul = '🏠 Belanja Non-Makanan (Bulanan)';
      ringkas = `Total/Bulan: <b>${formatRp(r.totalBulan)}</b>`;
      (r.items||[]).forEach(it => detail += `<div class="ri-detail-row"><span>↳ ${it.nama}</span><span>${formatRp(it.nilai)}/${it.satuan}</span></div>`);
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue);margin-top:6px"><span>Total/Bulan</span><span>${formatRp(r.totalBulan)}</span></div>`;
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue)"><span>Total/Tahun</span><span>${formatRp(r.totalTahun)}</span></div>`;

    } else if (tipe === 'tahunanrt') {
      judul = '📅 Pengeluaran Tahunan Non-Makanan';
      ringkas = `Total/Tahun: <b>${formatRp(r.totalTahun)}</b>`;
      (r.items||[]).forEach(it => detail += `<div class="ri-detail-row"><span>↳ ${it.nama}</span><span>${formatRp(it.nilai)}/tahun</span></div>`);
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue);margin-top:6px"><span>Total/Tahun</span><span>${formatRp(r.totalTahun)}</span></div>`;

    } else if (tipe === 'pendapatan') {
      judul = '💵 Pendapatan Rumah Tangga (Rincian 18.a)';
      ringkas = `Total/Bln: <b>${formatRp(r.totalBulan)}</b> · ${(r.orang||[]).length} anggota`;
      (r.orang||[]).forEach(o => {
        detail += `<div class="ri-detail-row"><span>${o.isPemilikUsaha?'👤 ':''}${o.nama||'(?)'} (${o.relasi})</span><span>${formatRp(o.total)}/bln</span></div>`;
      });
      detail += `<div class="ri-detail-row"><span>+ Laba Usaha/Bln</span><span>${formatRp(r.labaUsahaBulan||0)}</span></div>`;
      detail += `<div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue);margin-top:6px"><span>Total Pendapatan/Bulan</span><span>${formatRp(r.totalBulan)}</span></div>`;
      detail += `<div class="ri-detail-row"><span>Total Pendapatan/Tahun</span><span>${formatRp(r.totalTahun)}</span></div>`;
      const surplusColor = (r.surplus||0) >= 0 ? '#1d6b2e' : '#b22';
      detail += `<div class="ri-detail-row" style="font-weight:700;color:${surplusColor}"><span>${(r.surplus||0)>=0?'Surplus':'Defisit'}/Bln</span><span>${formatRp(Math.abs(r.surplus||0))}</span></div>`;

    } else {
      // kalkulator
      const ikon = ikonJenis[r.jenis]||'📦';
      const kk = r.nomorKeluarga && r.nomorKeluarga !== '-' ? `KK-${r.nomorKeluarga}` : '';
      const bg = r.nomorBangunan && r.nomorBangunan !== '-' ? `BG-${r.nomorBangunan}` : '';
      const noUrut = [kk, bg].filter(Boolean).join(' · ');
      judul = `${ikon} ${r.nama}`;
      ringkas = `${noUrut ? noUrut + ' · ' : ''}Laba/Bln: <b>${formatRp(r.labaBulan)}</b>`;
      detail = `
        <div class="ri-detail-row"><span>Jenis Usaha</span><span>${r.jenis}</span></div>
        <div class="ri-detail-row"><span>Omzet/${r.satuan}</span><span>${formatRp(r.omzet)}</span></div>
        <div class="ri-detail-row"><span>Omzet/Bulan</span><span>${formatRp(r.omzetBulan)}</span></div>
        <div class="ri-detail-row"><span>Omzet/Tahun</span><span>${formatRp(r.omzetTahun)}</span></div>
        <div class="ri-detail-row"><span>Total Biaya/Bln</span><span>${formatRp(r.totalBiayaBulan)}</span></div>`;
      if (r.biayaItems && r.biayaItems.length) {
        r.biayaItems.forEach(b => {
          if (b.nilai > 0) detail += `<div class="ri-detail-row" style="padding-left:12px;font-size:11px"><span>↳ ${b.nama}</span><span>${formatRp(b.nilai)}/${r.satuan}</span></div>`;
        });
      }
      detail += `
        <div class="ri-detail-row" style="font-weight:700;color:var(--green)"><span>Laba/Bulan</span><span>${formatRp(r.labaBulan)}</span></div>
        <div class="ri-detail-row" style="font-weight:700;color:var(--bps-blue)"><span>Laba/Tahun</span><span>${formatRp(r.labaTahun)}</span></div>`;
    }

    html += `
    <div class="riwayat-item" id="ri-${r.id}">
      <div class="ri-header" onclick="toggleDetail('${did}')" style="cursor:pointer">
        <div>
          <div class="ri-nama">${judul}</div>
          <div class="ri-waktu">${r.waktu}</div>
          <div class="ri-jenis" style="margin-top:4px">${ringkas}</div>
        </div>
        <span id="arr-${did}" style="color:var(--muted);font-size:18px;transition:transform 0.2s">▼</span>
      </div>
      <div id="${did}" class="ri-detail-body" style="display:none">
        ${detail}
      </div>
      <div class="ri-footer" style="margin-top:10px">
        <button class="ri-btn edit" onclick='editRiwayat(${r.id})'>✏️ Edit</button>
        <button class="ri-btn copy" onclick='salinRiwayat(${r.id})'>📋 Salin</button>
        <button class="ri-btn del" onclick='hapusRiwayat(${r.id})'>🗑️ Hapus</button>
      </div>
    </div>`;
  });

  html += `<button class="clear-all-btn" onclick="hapusSemua()">🗑️ Hapus Semua Riwayat</button>`;
  container.innerHTML = html;
}

function toggleDetail(did) {
  const el = document.getElementById(did);
  const arr = document.getElementById('arr-' + did);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (arr) arr.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
}

function salinRiwayat(id) {
  const r = riwayat.find(x => x.id === id);
  if (!r) return;
  const tipe = r.tipe || 'kalkulator';
  let teks = '';

  if (tipe === 'biayausaha') {
    teks = `=== RINCIAN 26. PENGELUARAN USAHA ===
26.a Upah, Gaji & Jaminan Sosial : ${formatRp(r.a)}
26.b Biaya Produksi              : ${formatRp(r.b)}
26.c Biaya Sewa & Jasa Lainnya    : ${formatRp(r.c)}
26.d Biaya Operasional            : ${formatRp(r.d)}
26.e Biaya Non-Operasional        : ${formatRp(r.e)}
------------------------------------
26.f TOTAL PENGELUARAN             : ${formatRp(r.total)}
======================================`;
  } else if (tipe === 'nilaiAset') {
    teks = `=== RINCIAN 28. NILAI ASET USAHA ===
28.a Tanah                  : ${formatRp(r.a)}
28.b Bangunan               : ${formatRp(r.b)}
28.c Mesin & Peralatan      : ${formatRp(r.c)}
28.d Kendaraan Usaha        : ${formatRp(r.d)}
28.e Aset Lainnya           : ${formatRp(r.e)}
------------------------------------
28.f TOTAL NILAI ASET        : ${formatRp(r.total)}
====================================`;
  } else if (tipe === 'makanan') {
    teks = `=== PENGELUARAN MAKANAN & MINUMAN ===\n\n`;
    (r.items||[]).forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /${it.satuan}\n`);
    teks += `\n------------------------------------\n`;
    teks += `TOTAL / MINGGU : ${formatRp(r.totalMinggu)}\n`;
    teks += `TOTAL / BULAN  : ${formatRp(r.totalBulan)}\n`;
    teks += `====================================`;
  } else if (tipe === 'nonmakanan') {
    teks = `=== PENGELUARAN NON-MAKANAN (BULANAN) ===\n\n`;
    (r.items||[]).forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /${it.satuan}\n`);
    teks += `\n------------------------------------\n`;
    teks += `TOTAL / BULAN : ${formatRp(r.totalBulan)}\n`;
    teks += `TOTAL / TAHUN : ${formatRp(r.totalTahun)}\n`;
    teks += `====================================`;
  } else if (tipe === 'tahunanrt') {
    teks = `=== PENGELUARAN TAHUNAN NON-MAKANAN ===\n\n`;
    (r.items||[]).forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /tahun\n`);
    teks += `\n------------------------------------\n`;
    teks += `TOTAL / TAHUN : ${formatRp(r.totalTahun)}\n`;
    teks += `====================================`;
  } else {
    const kk = r.nomorKeluarga && r.nomorKeluarga !== '-' ? `No. KK: ${r.nomorKeluarga}\n` : '';
    const bg = r.nomorBangunan && r.nomorBangunan !== '-' ? `No. Bangunan: ${r.nomorBangunan}\n` : '';
    teks = `=== SE2026 ===\n${kk}${bg}${r.nama} (${r.jenis})\nOmzet/Bln: ${formatRp(r.omzetBulan)}\nBiaya/Bln: ${formatRp(r.totalBiayaBulan)}\nLaba/Bln: ${formatRp(r.labaBulan)}\nLaba/Thn: ${formatRp(r.labaTahun)}`;
  }

  copyToClipboard(teks);
}

function hapusRiwayat(id) {
  // Kalau yang dihapus sedang diedit, batalkan dulu mode edit
  if (window._editingId === id) finishEdit();
  riwayat = riwayat.filter(x => x.id !== id);
  localStorage.setItem('se2026_riwayat', JSON.stringify(riwayat));
  renderRiwayat();
}

// ===== EDIT RIWAYAT =====
// Muat data dari riwayat kembali ke tab asal, agar bisa diubah dan disimpan ulang.
window._editingId = null;

function editRiwayat(id) {
  const r = riwayat.find(x => x.id === id);
  if (!r) { showToast('⚠️ Data tidak ditemukan'); return; }

  window._editingId = id;
  const tipe = r.tipe || 'kalkulator';

  // === Pre-populate SEMUA tab dari profil responden ===
  // Supaya saat user pindah tab, data Belanja RT / Aset / dll ikut tampil.
  const key = namaToKey(r.nama);
  const profil = key ? respondenDB[key] : null;
  // Simpan pekerjaanVal agar setelah resetForm defaultnya (Pemilik Usaha)
  // kita bisa paksa balik ke nilai tersimpan.
  const pekerjaanVal = profil ? (profil.pekerjaanResponden || profil.pekerjaanUtamaResponden || profil.pekerjaan) : null;
  if (profil) {
    respondenAktif = key;
    renderRespondenAktifBar();


    // Kalkulator
    if (profil.kalkulator) {
      try { populateKalkulator(profil.kalkulator); } catch(e){ console.warn('populateKalkulator', e); }
    } else {
      try { resetForm(); } catch(e){}
    }

    // Belanja RT (3 sub-kategori) — utamakan profil DB, fallback ke riwayat[] (data lama)
    try { resetMakanan();    } catch(e){}
    try { resetNonMakanan(); } catch(e){}
    try { resetTahunan();    } catch(e){}
    const rt = (profil && profil.belanjaRT) ? profil.belanjaRT : {};
    // Fallback: cari entri di riwayat[] berdasarkan nama (untuk data legacy tanpa belanjaRT slot)
    const findInRiwayat = (tipe) => {
      if (!key) return null;
      // Hanya match entri yang nama-nya cocok dengan responden yang sedang diedit
      const targets = riwayat.filter(x => x.tipe === tipe && x.nama && namaToKey(x.nama) === key);
      return targets[0] || null;
    };
    const makanan    = rt.makanan    || findInRiwayat('makanan');
    const nonmakanan = rt.nonmakanan || findInRiwayat('nonmakanan');
    const tahunan    = rt.tahunan    || findInRiwayat('tahunanrt');
    if (makanan)    { try { populateRT(makanan,    'makanan');    } catch(e){ console.warn('populateRT makanan', e); } }
    if (nonmakanan) { try { populateRT(nonmakanan, 'nonmakanan'); } catch(e){ console.warn('populateRT nonmakanan', e); } }
    if (tahunan)    { try { populateRT(tahunan,    'tahunan');    } catch(e){ console.warn('populateRT tahunan', e); } }

    // Nilai Aset (Rincian 28) — fallback ke riwayat[] juga
    try { resetAset(); } catch(e){}
    const aset = (profil && profil.rincian28) || findInRiwayat('nilaiAset');
    if (aset) { try { populateAset(aset); } catch(e){ console.warn('populateAset', e); } }

    // Pendapatan (Rincian 18.a)
    try { resetPendapatan(); } catch(e){}
    const pend = (profil && profil.pendapatan) || findInRiwayat('pendapatan');
    if (pend) { try { populatePendapatan(pend); } catch(e){ console.warn('populatePendapatan', e); } }

    // Rincian 26 (Biaya Usaha) — kompat tab lama
    const r26 = (profil && profil.rincian26) || findInRiwayat('biayausaha');
    if (r26) { try { populateBiayaUsaha(r26); } catch(e){} }
  }

  // Paksa pilihan dropdown pekerjaan utama agar sesuai data tersimpan.
  // resetForm() memaksa default "Pemilik Usaha", jadi perlu override setelah restore.
  try {
    const elPekerjaan = document.getElementById('pekerjaanResponden');
    if (elPekerjaan && pekerjaanVal) {
      elPekerjaan.value = pekerjaanVal;
      elPekerjaan.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (e) {}

  // Pastikan window._editingId tidak ter-reset oleh resetForm di atas
  window._editingId = id;


  // Pindah ke tab yang sesuai dengan entry yang user klik
  if      (tipe === 'kalkulator')  { showTab('kalkulator'); }
  else if (tipe === 'biayausaha')  { showTab('biayausaha'); }
  else if (tipe === 'nilaiAset')   { showTab('nilaiAset');  }
  else if (tipe === 'makanan')     { showTab('belanjart');  }
  else if (tipe === 'nonmakanan')  { showTab('belanjart');  }
  else if (tipe === 'tahunanrt')   { showTab('belanjart');  }
  else if (tipe === 'pendapatan')  { showTab('pendapatan'); }
  else { showToast('⚠️ Tipe tidak dikenal'); window._editingId = null; return; }

  showEditBanner(tipe, r);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showEditBanner(tipe, r) {
  const labels = {
    kalkulator: 'Kalkulator Usaha',
    biayausaha: 'Rincian 26 — Biaya Usaha',
    nilaiAset:  'Rincian 28 — Nilai Aset',
    makanan:    'Belanja RT — Makanan & Minuman',
    nonmakanan: 'Belanja RT — Non-Makanan',
    tahunanrt:  'Belanja RT — Tahunan'
  };
  const banner = document.getElementById('editBanner');
  document.getElementById('editBannerInfo').textContent =
    `${labels[tipe] || tipe} • ${r.nama || ''} • ${r.waktu || ''}`;
  banner.classList.add('show');
}

function hideEditBanner() {
  const banner = document.getElementById('editBanner');
  if (banner) banner.classList.remove('show');
}

function batalEdit() {
  finishEdit();
  showTab('riwayat');
  showToast('Edit dibatalkan');
}

// ===== POPULATE: KALKULATOR =====
function populateKalkulator(r) {
  // PATCH #1 (fix): fungsi ini adalah peninggalan versi single-usaha lama dan
  // menargetkan elemen tanpa suffix (namaUsaha, nomorKeluarga, bulanPanen,
  // jenisUsahaSelect, satuanWaktu, omzet) yang SUDAH TIDAK ADA di markup
  // multi-usaha saat ini (id sekarang selalu bersuffix _1.._5, mis. omzet_1).
  // Sebelumnya baris document.getElementById('namaUsaha').value = ... di bawah
  // ini melempar TypeError (getElementById mengembalikan null) yang membatalkan
  // SISA fungsi ini secara diam-diam — termasuk merusak restore Pekerjaan Utama
  // karena resetForm() di atas sempat mengosongkannya tanpa sempat dipulihkan.
  // Fungsi ini sekarang dibuat null-safe sepenuhnya. Restore data aktual per-usaha
  // (jenis usaha, omzet, tenaga kerja, rincian 26) kini ditangani oleh blok
  // PATCH #2 / #3 di editResponden() yang bekerja dengan id bersuffix yang benar.
  const setValSafe = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };

  // Reset dulu agar tidak menumpuk
  resetForm();
  window._editingId = r.id; // resetForm tidak menyentuh _editingId tapi pastikan
  if (r.nama && r.nama !== 'Tanpa Nama') setValSafe('namaUsaha', r.nama);
  setValSafe('nomorKeluarga', (r.nomorKeluarga && r.nomorKeluarga !== '-') ? r.nomorKeluarga : '');
  setValSafe('nomorBangunan', (r.nomorBangunan && r.nomorBangunan !== '-') ? r.nomorBangunan : '');
  // Restore Jumlah Bulan Panen (untuk usaha musiman: pertanian/peternakan)
  const bp = document.getElementById('bulanPanen');
  if (bp && r.bulanPanen) bp.value = r.bulanPanen;
  const pek = document.getElementById('pekerjaanResponden');
  if (pek && r.pekerjaan) pek.value = r.pekerjaan;

  // Pilih jenis usaha (set dropdown value)
  if (r.jenis) {
    const sel = document.getElementById('jenisUsahaSelect');
    if (sel) {
      sel.value = r.jenis;
      pilihJenis(null, r.jenis);
    }
  }

  // Satuan waktu + omzet (raw input value)
  setValSafe('satuanWaktu', r.satuan || 'hari');
  try { updateSatuan(); } catch(e) {}
  if (r.omzet != null) setValSafe('omzet', formatNumberId(r.omzet));

  // Karyawan
  if (r.nKaryawan != null) setValSafe('jumlahKaryawan', r.nKaryawan);
  if (r.gajiPerOrang) setValSafe('gajiPerOrang', formatNumberId(r.gajiPerOrang));
  const js = document.getElementById('jamsosPerOrang');
  if (js && r.jamsosPerOrang) js.value = formatNumberId(r.jamsosPerOrang);
  const th = document.getElementById('thrPerOrang');
  if (th && r.thrPerOrang) th.value = formatNumberId(r.thrPerOrang);

  // Biaya items (legacy single list)
  const biayaListEl = document.getElementById('biayaList');
  if (biayaListEl) biayaListEl.innerHTML = '';
  biayaCounter = 0;
  if (biayaListEl && Array.isArray(r.biayaItems)) {
    r.biayaItems.forEach(it => tambahBiaya(it.nama || '', it.nilai ? formatNumberId(it.nilai) : '', 1));
  }

  // Restore Rincian 26.b-e (sub-items per kategori) jika tersimpan (skema legacy tanpa suffix)
  const itemsByKat = {
    b: r.items26B || [],
    c: r.items26C || [],
    d: r.items26D || [],
    e: r.items26E || []
  };
  ['b','c','d','e'].forEach(k => {
    const list = document.getElementById('bu26' + k + 'List');
    if (!list) return; // elemen legacy tanpa suffix tidak ada di markup saat ini — lewati
    list.innerHTML = '';
    (itemsByKat[k] || []).forEach(it => {
      tambahItemBiaya(k);
      const rows = document.querySelectorAll('#bu26' + k + 'List .rt-row');
      const last = rows[rows.length - 1];
      const inputs = last.querySelectorAll('input');
      inputs[0].value = it.nama || '';
      inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
    });
  });
  hitungBiayaUsaha();

  // Hitung ulang & tampilkan hasil
  hitung();
}

// ===== POPULATE: BIAYA USAHA (Rincian 26) =====
function populateBiayaUsaha(r) {
  ['a','b','c','d','e'].forEach(k => {
    document.getElementById('bu26' + k + 'List').innerHTML = '';
    const items = r['items' + k.toUpperCase()] || [];
    items.forEach(it => {
      tambahItemBiaya(k);
      const rows = document.querySelectorAll('#bu26' + k + 'List .rt-row');
      const last = rows[rows.length - 1];
      const inputs = last.querySelectorAll('input');
      inputs[0].value = it.nama || '';
      inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
    });
  });
  hitungBiayaUsaha();
}

// ===== POPULATE: NILAI ASET (Rincian 28) =====
function populateAset(r) {
  ['a','b','c','d','e'].forEach(k => {
    document.getElementById('aset28' + k + 'List').innerHTML = '';
    const items = r['items' + k.toUpperCase()] || [];
    items.forEach(it => {
      tambahItemAset(k);
      const rows = document.querySelectorAll('#aset28' + k + 'List .rt-row');
      const last = rows[rows.length - 1];
      const inputs = last.querySelectorAll('input');
      inputs[0].value = it.nama || '';
      inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
    });
  });
  hitungAset();
}

// ===== POPULATE: BELANJA RT (makanan / nonmakanan / tahunan) =====
function populateRT(r, kategori) {
  const items = r.items || [];
  if (kategori === 'tahunan') {
    document.getElementById('rtTahunanList').innerHTML = '';
    items.forEach(it => {
      tambahItemRTTahunan();
      const rows = document.querySelectorAll('#rtTahunanList .rt-row');
      const last = rows[rows.length - 1];
      const inputs = last.querySelectorAll('input');
      inputs[0].value = it.nama || '';
      inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
    });
    hitungTahunan();
  } else {
    const listId = kategori === 'makanan' ? 'rtMakananList' : 'rtNonMakananList';
    document.getElementById(listId).innerHTML = '';
    items.forEach(it => {
      tambahItemRT(listId, kategori);
      const rows = document.querySelectorAll('#' + listId + ' .rt-row');
      const last = rows[rows.length - 1];
      const inputs = last.querySelectorAll('input');
      inputs[0].value = it.nama || '';
      inputs[1].value = it.nilai ? formatNumberId(it.nilai) : '';
      const sel = last.querySelector('select');
      if (sel && it.satuan) sel.value = it.satuan;
    });
    if (kategori === 'makanan') hitungMakanan();
    else hitungNonMakanan();
  }
  // Auto-scroll ke section yang dipilih
  const anchor = kategori === 'makanan' ? 'rtMakananList'
              : kategori === 'nonmakanan' ? 'rtNonMakananList'
              : 'rtTahunanList';
  const el = document.getElementById(anchor);
  if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
}

// Helper format angka ID (1234567 → "1.234.567")
function formatNumberId(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('id-ID');
}

function hapusSemua() {
  if (!confirm('Hapus semua riwayat?')) return;
  riwayat = [];
  localStorage.setItem('se2026_riwayat', JSON.stringify(riwayat));
  renderRiwayat();
}

// ===== EXPORT RIWAYAT — wide format (1 baris per responden) =====
function exportRiwayat(format) {
  const respKeys = Object.keys(respondenDB);
  if (!respKeys.length) { showToast('⚠️ Belum ada responden untuk diekspor'); return; }
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  let blob, filename;

  // Flatten satu responden ke object kolom-kolom
  const flatten = (r) => {
    const k = r.kalkulator || {};
    const r26 = r.rincian26 || {};
    const r28 = r.rincian28 || {};
    const rt  = r.belanjaRT || {};
    const mak = rt.makanan || {};
    const non = rt.nonmakanan || {};
    const tah = rt.tahunan  || {};
    return {
      nama:        r.nama || '',
      pekerjaan:   r.pekerjaan || k.pekerjaan || '',
      jenis:       r.jenis || k.jenis || '',
      kbli:        r.kbli  || k.kbli  || '',
      nomorKK:     k.nomorKeluarga || '',
      nomorBangunan: k.nomorBangunan || '',
      satuan:      k.satuan || '',
      omzet_input: k.omzet || '',
      omzetBulan:  k.omzetBulan || '',
      omzetTahun:  k.omzetTahun || '',
      totalBiayaBulan: k.totalBiayaBulan || '',
      labaBulan:   k.labaBulan || '',
      labaTahun:   k.labaTahun || '',
      rugi:        k.rugi ? 'YA' : '',
      nKaryawan:   k.nKaryawan || '',
      gajiPerOrang:k.gajiPerOrang || '',
      jamsosPerOrang: k.jamsosPerOrang || '',
      thrPerOrang: k.thrPerOrang || '',
      r26a_upahGaji:        r26.a || '',
      r26b_produksi:        r26.b || '',
      r26c_sewaJasa:        r26.c || '',
      r26d_operasional:     r26.d || '',
      r26e_nonOperasional:  r26.e || '',
      r26f_TOTAL:           r26.total || '',
      r28a_tanah:           r28.a || '',
      r28b_bangunan:        r28.b || '',
      r28c_mesinPeralatan:  r28.c || '',
      r28d_kendaraan:       r28.d || '',
      r28e_lainnya:         r28.e || '',
      r28_TOTAL:            r28.total || '',
      rt_makanan_minggu:    mak.totalMinggu || '',
      rt_makanan_bulan:     mak.totalBulan  || '',
      rt_nonmakanan_bulan:  non.totalBulan  || '',
      rt_nonmakanan_tahun:  non.totalTahun  || '',
      rt_tahunan_tahun:     tah.totalTahun  || '',
      // ===== Pendapatan/Gaji (Rincian 18.a) =====
      pend_jumlah_anggota:  (r.pendapatan && r.pendapatan.orang) ? r.pendapatan.orang.length : '',
      pend_nama_owner:      (r.pendapatan && r.pendapatan.orang) ? ((r.pendapatan.orang.find(o => o.isPemilikUsaha) || {}).nama || '') : '',
      pend_total_anggota_bulan: (r.pendapatan && r.pendapatan.totalAnggotaBulan) || '',
      pend_laba_usaha_bulan:    (r.pendapatan && r.pendapatan.labaUsahaBulan)    || '',
      pend_total_bulan:         (r.pendapatan && r.pendapatan.totalBulan)        || '',
      pend_total_tahun:         (r.pendapatan && r.pendapatan.totalTahun)        || '',
      pend_belanja_bulan:       (r.pendapatan && r.pendapatan.belanjaBulan)      || '',
      pend_surplus_bulan:       (r.pendapatan && r.pendapatan.surplus)           || '',
      // ===== Geo & Status =====
      geo_lat:      r.geo?.lat || '',
      geo_lon:      r.geo?.lon || '',
      geo_accuracy: r.geo?.accuracy || '',
      geo_waktu:    r.geo?.waktu || '',
      status:       r.status || 'draft',
      waktuPertama: r.waktuPertama || '',
      waktuUpdate:  r.waktuUpdate || ''
    };
  };

  if (format === 'json') {
    // Format v2: object lengkap dengan respondenDB + riwayat + metadata
    // (Import otomatis backward-compat dengan array format lama)
    const data = {
      _meta: {
        app: 'Asisten Petugas SE2026',
        exportedAt: new Date().toISOString(),
        version: 2,
        respondenCount: respKeys.length,
        riwayatCount: riwayat.length
      },
      respondenDB: respKeys.reduce((acc, k) => { acc[k] = respondenDB[k]; return acc; }, {}),
      riwayat: riwayat
    };
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    filename = `responden-se2026-${stamp}.json`;
  } else {
    // CSV wide format
    const rows = respKeys.map(k => flatten(respondenDB[k]));
    if (!rows.length) { showToast('⚠️ Tidak ada data'); return; }
    const headers = Object.keys(rows[0]);
    const csvLines = [headers.join(',')];
    rows.forEach(r => {
      csvLines.push(headers.map(h => {
        const v = r[h];
        if (v == null || v === '') return '';
        // Quote kalau ada koma/quote/newline
        const s = String(v);
        if (/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
        return s;
      }).join(','));
    });
    blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
    filename = `responden-se2026-${stamp}.csv`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ File berhasil diunduh!');
}

// ===== RESET =====
function resetForm(idx) {
  idx = idx || 1;
  const suffix = '_' + idx;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  // Per-usaha fields (ID dengan suffix _${idx}). Coba pakai suffix dulu, fallback ke ID polos kalau ada.
  setVal('namaUsaha' + suffix, '');
  setVal('omzet' + suffix, '');
  setVal('jumlahKaryawan' + suffix, '0');
  setVal('gajiPerOrang' + suffix, '');
  setVal('jamsosPerOrang' + suffix, '');
  setVal('thrPerOrang' + suffix, '');

  // Field shared (di tab Responden, single instance) — null-safe
  setVal('nomorKeluarga', '');
  setVal('nomorBangunan', '');
  setVal('bulanPanen', '4');
  const pek = document.getElementById('pekerjaanResponden');
  if (pek) pek.selectedIndex = 0;

  // List & subtotal Rincian 26 per usaha
  setHtml('biayaList' + suffix, '');
  ['a','b','c','d','e'].forEach(k => {
    setHtml('bu26' + k + 'List' + suffix, '');
    setText('bu26' + k + '-subtotal' + suffix, 'Rp 0');
    // Fallback ke versi tanpa suffix (legacy)
    setHtml('bu26' + k + 'List', '');
    setText('bu26' + k + '-subtotal', 'Rp 0');
  });
  setText('bu26f' + suffix, 'Rp 0');
  setText('bu26f', 'Rp 0');

  // Hasil & warning per usaha
  setDisplay('hasilSection' + suffix, 'none');
  setDisplay('rugiWarning' + suffix, 'none');
  setDisplay('musimSection' + suffix, 'none');

  // Element shared (single instance di seluruh app)
  const kbliEl = document.getElementById('kbliTag' + suffix) || document.getElementById('kbliTag');
  if (kbliEl) kbliEl.style.display = 'none';

  // Reset dropdown jenis usaha
  const sel = document.getElementById('jenisUsahaSelect' + suffix) || document.getElementById('jenisUsahaSelect');
  if (sel) sel.value = '';
  try { jenisUsaha = ''; } catch(e) {}

  try { biayaCounter = 0; } catch(e) {}
  try { window._lastHasil = null; } catch(e) {}
  try { window._lastBiayaUsaha = null; } catch(e) {}

  try { updateTkSummary && updateTkSummary(idx); } catch(e) {}
  try { syncBiayaUsahaSummary && syncBiayaUsahaSummary(idx); } catch(e) {}

  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) {}
}

// ===== KONVERTER =====
function toggleKonvHari(el) {
  el.classList.toggle('active');
  const n = document.querySelectorAll('#konvHariGrid .hari-btn.active').length;
  document.getElementById('konvHariHint').textContent = `${n} hari/minggu`;
  konversi();
}

function konversi() {
  const val = parseRp(document.getElementById('konvInput').value);
  const dari = document.getElementById('konvDari').value;
  const nHari = document.querySelectorAll('#konvHariGrid .hari-btn.active').length || 5;
  const hariPerBulan = Math.round(nHari * 52 / 12);

  if (!val) { document.getElementById('konvResult').style.display = 'none'; return; }

  let perHari, perMinggu, perBulan, perTahun;
  if (dari === 'hari') {
    perHari = val;
    perMinggu = Math.round(val * nHari);
    perBulan = Math.round(val * hariPerBulan);
    perTahun = Math.round(perBulan * 12);
  } else if (dari === 'minggu') {
    perMinggu = val;
    perHari = Math.round(val / nHari);
    perBulan = Math.round(val * (52/12));
    perTahun = Math.round(perBulan * 12);
  } else if (dari === 'bulan') {
    perBulan = val;
    perHari = Math.round(val / hariPerBulan);
    perMinggu = Math.round(val / (52/12));
    perTahun = Math.round(val * 12);
  } else {
    perTahun = val;
    perBulan = Math.round(val / 12);
    perHari = Math.round(perBulan / hariPerBulan);
    perMinggu = Math.round(perBulan / (52/12));
  }

  const results = [
    { label: 'Per Hari', val: perHari, key: 'hari' },
    { label: 'Per Minggu', val: perMinggu, key: 'minggu' },
    { label: 'Per Bulan', val: perBulan, key: 'bulan' },
    { label: 'Per Tahun', val: perTahun, key: 'tahun' },
  ];

  let html = '';
  results.forEach(r => {
    const isActive = r.key === dari;
    html += `<div class="konv-row ${isActive ? 'konv-active' : ''}">
      <span class="konv-label">${r.label}${isActive ? ' ★' : ''}</span>
      <span class="konv-nilai">${formatRp(r.val)}</span>
    </div>`;
  });
  html += `<p style="font-size:10px;color:var(--muted);margin-top:10px;font-style:italic">${terbilang(perTahun)} per tahun</p>`;
  document.getElementById('konvRows').innerHTML = html;
  document.getElementById('konvResult').style.display = 'block';
}

// ===== MARGIN =====
function hitungMargin() {
  const jual = parseRp(document.getElementById('hargaJual').value);
  const modal = parseRp(document.getElementById('hargaModal').value);
  if (!jual || !modal) { document.getElementById('marginResult').style.display = 'none'; return; }

  const laba = jual - modal;
  const marginPct = ((laba / jual) * 100).toFixed(1);
  const markupPct = ((laba / modal) * 100).toFixed(1);

  document.getElementById('marginRows').innerHTML = `
    <div class="konv-row"><span class="konv-label">Laba Kotor</span><span class="konv-nilai" style="color:${laba >= 0 ? 'var(--green)' : 'var(--red)'}">${formatRp(laba)}</span></div>
    <div class="konv-row"><span class="konv-label">Margin Laba (%)</span><span class="konv-nilai">${marginPct}%</span></div>
    <div class="konv-row konv-active"><span class="konv-label">Markup (%)</span><span class="konv-nilai">${markupPct}%</span></div>
  `;
  document.getElementById('marginResult').style.display = 'block';
}

// ===== BIAYA USAHA (Rincian 26 FASIH) =====
let produksiCounter = 0;

const PLACEHOLDER_BIAYA = {
  a: 'Contoh: Gaji pokok, Lembur, THR',
  b: 'Contoh: Bahan baku, Kemasan',
  c: 'Contoh: Sewa tempat, Sewa alat',
  d: 'Contoh: Listrik, Internet, Pulsa',
  e: 'Contoh: Bunga pinjaman, Pajak usaha'
};

function tambahItemBiaya(kategori, idx) {
  idx = idx || 1;
  produksiCounter++;
  const id = produksiCounter;
  const div = document.createElement('div');
  div.className = 'rt-row';
  div.id = 'biaya' + kategori + '-' + id;
  div.innerHTML = `
    <div class="rt-row-line1">
      <div class="input-wrap biaya-nama">
        <input type="text" placeholder="${PLACEHOLDER_BIAYA[kategori]}" oninput="hitungBiayaUsaha(${idx})">
      </div>
      <button class="del-btn" onclick="hapusItemBiaya('${kategori}', ${id}, ${idx})">×</button>
    </div>
    <div class="rt-row-line2">
      <div class="input-wrap" style="flex:1">
        <span class="input-prefix">Rp</span>
        <input type="text" inputmode="numeric" class="rp-input" placeholder="0" oninput="hitungBiayaUsaha(${idx})">
      </div>
    </div>
  `;
  document.getElementById('bu26' + kategori + 'List_' + idx).appendChild(div);
  hitungBiayaUsaha(idx);
}

function hapusItemBiaya(kategori, id, idx) {
  idx = idx || 1;
  const el = document.getElementById('biaya' + kategori + '-' + id);
  if (el) el.remove();
  hitungBiayaUsaha(idx);
}

function getItemsBiaya(kategori, idx) {
  idx = idx || 1;
  const rows = document.querySelectorAll('#bu26' + kategori + 'List_' + idx + ' .rt-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const nama = inputs[0].value || 'Item';
    const nilai = parseRp(inputs[1].value);
    return { nama, nilai };
  });
}

// Alias agar kompatibel dengan kode lama (26.b biaya produksi)
function tambahItemProduksi(idx) { tambahItemBiaya('b', idx); }
function hapusItemProduksi(id, idx) { hapusItemBiaya('b', id, idx); }
function getItemsProduksi(idx) { return getItemsBiaya('b', idx); }

function hitungBiayaUsaha(idx) {
  idx = idx || 1;
  // 26.a OTOMATIS dari Tenaga Kerja (Choice 1A): (gaji + jamsos) × 12 × jumlah + THR × jumlah
  const n      = parseFloat((document.getElementById('jumlahKaryawan_' + idx) || {}).value || '0') || 0;
  const gaji   = parseRp((document.getElementById('gajiPerOrang_' + idx)   || {}).value || '');
  const jamsos = parseRp((document.getElementById('jamsosPerOrang_' + idx) || {}).value || '');
  const thr    = parseRp((document.getElementById('thrPerOrang_' + idx)    || {}).value || '');
  const a = n * ((gaji + jamsos) * 12 + thr);
  // 26.b-e dari sub-items — input diasumsi PER BULAN, subtotal × 12 = per TAHUN
  const itemsA = [];  // tidak dipakai (Choice 1A)
  const itemsB = getItemsBiaya('b', idx);
  const itemsC = getItemsBiaya('c', idx);
  const itemsD = getItemsBiaya('d', idx);
  const itemsE = getItemsBiaya('e', idx);
  const b_bulan = itemsB.reduce((s, it) => s + it.nilai, 0);
  const c_bulan = itemsC.reduce((s, it) => s + it.nilai, 0);
  const d_bulan = itemsD.reduce((s, it) => s + it.nilai, 0);
  const e_bulan = itemsE.reduce((s, it) => s + it.nilai, 0);
  const b = b_bulan * 12;
  const c = c_bulan * 12;
  const d = d_bulan * 12;
  const e = e_bulan * 12;
  const total = a + b + c + d + e;

  // Helper: tampilkan subtotal/tahun + breakdown /bulan
  const renderSub = (id, perTahun, perBulan) => {
    const el = document.getElementById(id);
    if (!el) return;
    // FIX: simpan angka mentah di data-value agar tidak ikut ter-parse
    // bersama teks keterangan "(= Rp X / bulan × 12)" saat dibaca ulang
    // oleh syncBiayaUsahaSummary() -> getValFromDOM(). Sebelumnya kedua
    // angka (per tahun & per bulan) ikut terbaca dan "menempel" jadi satu
    // angka raksasa (mis. 42.000.000 + 3.500.000 -> 420000003500000).
    el.dataset.value = String(Math.round(perTahun) || 0);
    if (perBulan > 0) {
      el.innerHTML = formatRp(perTahun) + ` <span style="font-size:11px;font-weight:500;color:var(--muted)">(= ${formatRp(perBulan)} / bulan × 12)</span>`;
    } else {
      el.textContent = formatRp(perTahun);
    }
  };
  const a26aEl = document.getElementById('bu26a-subtotal_' + idx);
  if (a26aEl) { a26aEl.textContent = formatRp(a); a26aEl.dataset.value = String(Math.round(a) || 0); }
  renderSub('bu26b-subtotal_' + idx, b, b_bulan);
  renderSub('bu26c-subtotal_' + idx, c, c_bulan);
  renderSub('bu26d-subtotal_' + idx, d, d_bulan);
  renderSub('bu26e-subtotal_' + idx, e, e_bulan);
  const f = document.getElementById('bu26f_' + idx); if (f) f.textContent = formatRp(total);
  const ft = document.getElementById('bu26f-terbilang_' + idx); if (ft) ft.textContent = total > 0 ? terbilang(total) : '';

  // Isi juga ringkasan per-usaha di tab "Biaya Usaha" (inner tab "Biaya Usaha N"),
  // jika elemen-elemennya sudah dibangun oleh renderBiayaUsahaTabs().
  const setBia = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setBia('biaSum26a_' + idx, formatRp(a));
  setBia('biaSum26b_' + idx, formatRp(b));
  setBia('biaSum26c_' + idx, formatRp(c));
  setBia('biaSum26d_' + idx, formatRp(d));
  setBia('biaSum26e_' + idx, formatRp(e));
  setBia('biaSum26f_' + idx, formatRp(total));
  setBia('biaSum26-terbilang_' + idx, total > 0 ? terbilang(total) : '');

  // Auto-sync ke tab Biaya Usaha (summary)
  syncBiayaUsahaSummary(idx);

  window._lastBiayaUsaha = {
    a, b, c, d, e, total,
    b_bulan, c_bulan, d_bulan, e_bulan,  // raw per-bulan input (untuk edit/restore)
    itemsA, itemsB, itemsC, itemsD, itemsE,
    itemsProduksi: itemsB,
    nKaryawan: n, gajiPerOrang: gaji, jamsosPerOrang: jamsos, thrPerOrang: thr
  };
}

function salinBiayaUsaha() {
  const h = window._lastBiayaUsaha;
  if (!h || !h.total) { showToast('⚠️ Isi dulu rinciannya'); return; }

  const rincian = (items) => items.filter(it => it.nilai > 0).map(it => `    ↳ ${it.nama}: ${formatRp(it.nilai)}\n`).join('');

  const teks = `=== RINCIAN 26. PENGELUARAN USAHA ===
26.a Upah, Gaji & Jaminan Sosial : ${formatRp(h.a)}
${rincian(h.itemsA)}26.b Biaya Produksi              : ${formatRp(h.b)}
${rincian(h.itemsB)}26.c Biaya Sewa & Jasa Lainnya    : ${formatRp(h.c)}
${rincian(h.itemsC)}26.d Biaya Operasional            : ${formatRp(h.d)}
${rincian(h.itemsD)}26.e Biaya Non-Operasional        : ${formatRp(h.e)}
${rincian(h.itemsE)}------------------------------------
26.f TOTAL PENGELUARAN             : ${formatRp(h.total)}
(${terbilang(h.total)})
======================================`;
  copyToClipboard(teks);
}

function resetBiayaUsaha(idx) {
  idx = idx || 1;
  ['a','b','c','d','e'].forEach(k => {
    document.getElementById('bu26' + k + 'List_' + idx).innerHTML = '';
    document.getElementById('bu26' + k + '-subtotal_' + idx).textContent = 'Rp 0';
  });
  document.getElementById('bu26f').textContent = 'Rp 0';
  document.getElementById('bu26f-terbilang').textContent = '';
  window._lastBiayaUsaha = null;
}

// ===== BELANJA RT (Pengeluaran Rumah Tangga, rinci per item) =====
let rtCounter = 0;

function tambahItemRT(containerId, kategori) {
  rtCounter++;
  const id = rtCounter;
  const div = document.createElement('div');
  div.className = 'rt-row';
  div.id = 'rt-' + id;
  div.dataset.kategori = kategori;
  const fnHitung = kategori === 'makanan' ? 'hitungMakanan' : 'hitungNonMakanan';
  div.innerHTML = `
    <div class="rt-row-line1">
      <div class="input-wrap biaya-nama">
        <input type="text" placeholder="Nama item" oninput="${fnHitung}()">
      </div>
      <button class="del-btn" onclick="hapusItemRT(${id}, '${fnHitung}')">×</button>
    </div>
    <div class="rt-row-line2">
      <div class="input-wrap" style="flex:1.4">
        <span class="input-prefix">Rp</span>
        <input type="text" inputmode="numeric" class="rp-input" placeholder="0" oninput="${fnHitung}()">
      </div>
      <div class="input-wrap" style="flex:1">
        <select onchange="${fnHitung}()">
          <option value="hari">/hari</option>
          <option value="minggu">/minggu</option>
          <option value="bulan" selected>/bulan</option>
          <option value="tahun">/tahun</option>
        </select>
      </div>
    </div>
  `;
  document.getElementById(containerId).appendChild(div);
}

function tambahItemRTTahunan() {
  rtCounter++;
  const id = rtCounter;
  const div = document.createElement('div');
  div.className = 'rt-row';
  div.id = 'rt-' + id;
  div.dataset.kategori = 'tahunan';
  div.innerHTML = `
    <div class="rt-row-line1">
      <div class="input-wrap biaya-nama">
        <input type="text" placeholder="Contoh: Perbaikan rumah, Pajak motor" oninput="hitungTahunan()">
      </div>
      <button class="del-btn" onclick="hapusItemRT(${id}, 'hitungTahunan')">×</button>
    </div>
    <div class="rt-row-line2">
      <div class="input-wrap" style="flex:1">
        <span class="input-prefix">Rp</span>
        <input type="text" inputmode="numeric" class="rp-input" placeholder="0" oninput="hitungTahunan()">
      </div>
      <span class="hint" style="display:flex;align-items:center;padding-left:8px;flex:0.6">/tahun</span>
    </div>
  `;
  document.getElementById('rtTahunanList').appendChild(div);
}

function hapusItemRT(id, fnHitung) {
  const el = document.getElementById('rt-' + id);
  if (el) el.remove();
  if (fnHitung === 'hitungMakanan') hitungMakanan();
  else if (fnHitung === 'hitungTahunan') hitungTahunan();
  else hitungNonMakanan();
}

function bacaItemRows(rows, satuanTetap) {
  const hariPerBulan = 30;
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const select = row.querySelector('select');
    const nama = inputs[0].value || 'Item';
    const nilai = parseRp(inputs[1].value);
    const satuan = satuanTetap || (select ? select.value : 'bulan');

    let bulanan = 0;
    if (satuan === 'hari') bulanan = nilai * hariPerBulan;
    else if (satuan === 'minggu') bulanan = nilai * (52/12);
    else if (satuan === 'bulan') bulanan = nilai;
    else if (satuan === 'tahun') bulanan = nilai / 12;

    return { nama, nilai, satuan, bulanan };
  });
}

// ===== BAGIAN 1: MAKANAN & MINUMAN (hasil mingguan) =====
function hitungMakanan() {
  const rows = document.querySelectorAll('#rtMakananList .rt-row');
  const items = bacaItemRows(rows);
  const totalBulan = items.reduce((s, it) => s + it.bulanan, 0);
  const totalMinggu = totalBulan * 12 / 52;

  let html = '';
  items.forEach(it => {
    html += `<div class="ringkasan-row"><span class="rk-label">${it.nama}</span><span class="rk-val">${formatRp(it.nilai)}/${it.satuan}</span></div>`;
  });
  document.getElementById('ringkasanMakanan').innerHTML = html || '<p class="hint">Belum ada item ditambahkan</p>';
  document.getElementById('rt-total-minggu').textContent = formatRp(totalMinggu);

  window._lastMakanan = { items, totalBulan, totalMinggu, waktu: new Date().toLocaleString('id-ID') };
}

function salinMakanan() {
  const h = window._lastMakanan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  let teks = `=== PENGELUARAN MAKANAN & MINUMAN ===\n\n`;
  h.items.forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /${it.satuan}\n`);
  teks += `\n------------------------------------\n`;
  teks += `TOTAL / MINGGU : ${formatRp(h.totalMinggu)}\n`;
  teks += `TOTAL / BULAN  : ${formatRp(h.totalBulan)}\n`;
  teks += `====================================`;
  copyToClipboard(teks);
}

function simpanRiwayatMakanan() {
  hitungMakanan();
  const h = window._lastMakanan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  const nama = getCurrentNama();
  if (!nama) { showToast('⚠️ Isi Nama Usaha di tab Usaha dulu'); return; }
  pushOrReplaceRiwayat({ tipe: 'makanan', nama, ...h });
  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

function resetMakanan() {
  document.getElementById('rtMakananList').innerHTML = '';
  document.getElementById('ringkasanMakanan').innerHTML = '';
  document.getElementById('rt-total-minggu').textContent = 'Rp 0';
  window._lastMakanan = null;
}

// ===== BAGIAN 2: NON-MAKANAN BULANAN =====
function hitungNonMakanan() {
  const rows = document.querySelectorAll('#rtNonMakananList .rt-row');
  const items = bacaItemRows(rows);
  const totalBulan = items.reduce((s, it) => s + it.bulanan, 0);

  let html = '';
  items.forEach(it => {
    html += `<div class="ringkasan-row"><span class="rk-label">${it.nama}</span><span class="rk-val">${formatRp(it.nilai)}/${it.satuan}</span></div>`;
  });
  document.getElementById('ringkasanNonMakanan').innerHTML = html || '<p class="hint">Belum ada item ditambahkan</p>';
  document.getElementById('rt-nonmakanan-bulan').textContent = formatRp(totalBulan);

  window._lastNonMakanan = { items, totalBulan, totalTahun: totalBulan * 12, waktu: new Date().toLocaleString('id-ID') };
}

function salinNonMakanan() {
  const h = window._lastNonMakanan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  let teks = `=== PENGELUARAN NON-MAKANAN (BULANAN) ===\n\n`;
  h.items.forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /${it.satuan}\n`);
  teks += `\n------------------------------------\n`;
  teks += `TOTAL / BULAN : ${formatRp(h.totalBulan)}\n`;
  teks += `TOTAL / TAHUN : ${formatRp(h.totalTahun)}\n`;
  teks += `====================================`;
  copyToClipboard(teks);
}

function simpanRiwayatNonMakanan() {
  hitungNonMakanan();
  const h = window._lastNonMakanan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  const nama = getCurrentNama();
  if (!nama) { showToast('⚠️ Isi Nama Usaha di tab Usaha dulu'); return; }
  pushOrReplaceRiwayat({ tipe: 'nonmakanan', nama, ...h });
  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

function resetNonMakanan() {
  document.getElementById('rtNonMakananList').innerHTML = '';
  document.getElementById('ringkasanNonMakanan').innerHTML = '';
  document.getElementById('rt-nonmakanan-bulan').textContent = 'Rp 0';
  window._lastNonMakanan = null;
}

// ===== BAGIAN 3: TAHUNAN NON-MAKANAN =====
function getTahunanKey() {
  const base = (typeof respondenAktif !== 'undefined' && respondenAktif) ? respondenAktif : (usahaIndexAktif || 1);
  return `tahunan|${base}`;
}

function hitungTahunan() {
  const rows = document.querySelectorAll('#rtTahunanList .rt-row');
  const items = bacaItemRows(rows, 'tahun');
  const totalTahun = items.reduce((s, it) => s + it.nilai, 0);

  let html = '';
  items.forEach(it => {
    html += `<div class="ringkasan-row"><span class="rk-label">${it.nama}</span><span class="rk-val">${formatRp(it.nilai)}/tahun</span></div>`;
  });
  document.getElementById('ringkasanTahunan').innerHTML = html || '<p class="hint">Belum ada item ditambahkan</p>';
  document.getElementById('rt-tahunan-tahun').textContent = formatRp(totalTahun);

  const key = getTahunanKey();
  window._lastTahunanByKey = window._lastTahunanByKey || {};
  window._lastTahunanByKey[key] = { items, totalTahun, totalBulan: totalTahun / 12, waktu: new Date().toLocaleString('id-ID') };
}

function salinTahunan() {
  const key = getTahunanKey();
  const h = window._lastTahunanByKey ? window._lastTahunanByKey[key] : window._lastTahunan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  let teks = `=== PENGELUARAN TAHUNAN NON-MAKANAN ===\n\n`;
  h.items.forEach(it => teks += `${it.nama}: ${formatRp(it.nilai)} /tahun\n`);
  teks += `\n------------------------------------\n`;
  teks += `TOTAL / TAHUN : ${formatRp(h.totalTahun)}\n`;
  teks += `(≈ ${formatRp(h.totalBulan)} /bulan)\n`;
  teks += `====================================`;
  copyToClipboard(teks);
}

function simpanRiwayatTahunan() {
  hitungTahunan();
  const key = getTahunanKey();
  const h = window._lastTahunanByKey ? window._lastTahunanByKey[key] : window._lastTahunan;
  if (!h || !h.items.length) { showToast('⚠️ Tambah item dulu'); return; }
  const nama = getCurrentNama();
  if (!nama) { showToast('⚠️ Isi Nama Usaha di tab Usaha dulu'); return; }
  pushOrReplaceRiwayat({ tipe: 'tahunanrt', nama, ...h });
  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

function resetTahunan() {
  document.getElementById('rtTahunanList').innerHTML = '';
  document.getElementById('ringkasanTahunan').innerHTML = '';
  document.getElementById('rt-tahunan-tahun').textContent = 'Rp 0';
  const key = getTahunanKey();
  window._lastTahunanByKey = window._lastTahunanByKey || {};
  window._lastTahunanByKey[key] = null;
}

// ===== PENDAPATAN / GAJI (FASIH Rincian 18.a) =====
const PENDAPATAN_ITEMS = [
  { key: 'upah',       label: 'a. Upah/Gaji' },
  { key: 'tunjangan',  label: 'b. Tunjangan' },
  { key: 'uangMakan',  label: 'c. Uang Makan' },
  { key: 'honor',      label: 'd. Honor' },
  { key: 'lembur',     label: 'e. Lembur' },
  { key: 'lainnya',    label: 'f. Lainnya' }
];
const RELASI_OPTIONS = ['Kepala RT', 'Suami/Istri', 'Anak', 'Orang Tua/Mertua', 'Famili Lain', 'Lainnya'];
let pendapatanCounter = 0;

function tambahAnggotaPendapatan(prefill) {
  const data = prefill || {};
  let id;
  if (data.anggotaId) {
    // Pertahankan anggotaId asli saat restore data tersimpan, supaya pemetaan
    // alokasi laba usaha (window._labaUsahaOwnerMap) tetap valid setelah reload.
    id = parseInt(data.anggotaId, 10) || (++pendapatanCounter);
    if (id > pendapatanCounter) pendapatanCounter = id;
  } else {
    pendapatanCounter++;
    id = pendapatanCounter;
  }
  const div = document.createElement('div');
  div.className = 'rt-row';
  div.dataset.anggotaId = id;
  div.style.cssText = 'border:1px solid #d0e3cf;background:#f7faf7;padding:12px;border-radius:10px;margin-bottom:12px;display:block';

  const relasiOpts = RELASI_OPTIONS.map(r => `<option value="${r}" ${data.relasi===r?'selected':''}>${r}</option>`).join('');
  const itemsHtml = PENDAPATAN_ITEMS.map(it => `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <label style="flex:1;font-size:13px;color:#444">${it.label}</label>
      <span style="color:#999;font-size:13px">Rp</span>
      <input type="text" inputmode="numeric" class="rp-input pend-nominal" data-item="${it.key}"
        placeholder="0" value="${data[it.key] ? formatNumberId(data[it.key]) : ''}"
        oninput="hitungPendapatan()" style="width:140px;text-align:right" />
    </div>
  `).join('');

  div.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input type="text" placeholder="Nama anggota" value="${(data.nama||'').replace(/"/g,'&quot;')}"
        oninput="hitungPendapatan()" class="pend-nama" style="flex:2;min-width:140px;padding:8px;border:1px solid #ccc;border-radius:6px" />
      <select class="pend-relasi" oninput="hitungPendapatan()"
        style="flex:1;min-width:120px;padding:8px;border:1px solid #ccc;border-radius:6px">${relasiOpts}</select>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;background:#fff5e6;padding:6px 10px;border-radius:6px;cursor:pointer">
        <input type="checkbox" class="pend-owner" ${data.isPemilikUsaha?'checked':''} onchange="hitungPendapatan()" />
        <b>Pemilik Usaha</b>
      </label>
      <button class="remove-btn" onclick="hapusAnggotaPendapatan(this, ${id})" style="background:#fee;color:#c00;border:none;border-radius:6px;padding:6px 10px;cursor:pointer">×</button>
    </div>
    <div class="pend-items">${itemsHtml}</div>
    <div style="text-align:right;font-size:13px;margin-top:6px;padding-top:6px;border-top:1px dashed #ddd">
      <span style="color:#666">Subtotal / Bulan: </span><b class="pend-subtotal" style="color:var(--bps-blue)">Rp 0</b>
    </div>
  `;
  document.getElementById('pendapatanList').appendChild(div);
  try { renderLabaUsahaAlokasi(); } catch (e) { hitungPendapatan(); }
}

// Hapus 1 baris anggota, sekaligus bersihkan alokasi laba usaha yang mengarah ke anggota ini
function hapusAnggotaPendapatan(btnEl, anggotaId) {
  const row = btnEl.closest('.rt-row');
  if (row) row.remove();
  const map = window._labaUsahaOwnerMap || {};
  Object.keys(map).forEach(k => {
    if (String(map[k]) === String(anggotaId)) delete map[k];
  });
  try { renderLabaUsahaAlokasi(); } catch (e) { hitungPendapatan(); }
}

// ===== ALOKASI LABA USAHA KE ANGGOTA (tab Pendapatan) =====
// window._labaUsahaOwnerMap: { [usahaIdx]: anggotaId } — anggotaId cocok dengan
// row.dataset.anggotaId di #pendapatanList (stabil walau baris ditambah/dihapus/diurutkan ulang).
window._labaUsahaOwnerMap = window._labaUsahaOwnerMap || {};

function renderLabaUsahaAlokasi() {
  const container = document.getElementById('labaUsahaAlokasiList');
  if (!container) return;
  const jumlah = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;

  if (jumlah === 0) {
    container.innerHTML = '<p class="hint">Belum ada usaha untuk dialokasikan. Isi dulu minimal 1 usaha di tab Usaha.</p>';
    try { hitungPendapatan(); } catch (e) {}
    return;
  }

  // Refresh laba tiap usaha secara diam-diam (tanpa auto-scroll) agar nominalnya terkini
  for (let i = 1; i <= jumlah; i++) {
    try { if (typeof hitungOtomatis === 'function') hitungOtomatis(i, true); } catch (e) {}
  }
  // Pulihkan window._lastHasil ke usaha yang sedang aktif di tab Usaha (bukan
  // usaha terakhir dalam loop di atas), supaya fitur "Salin Catatan" di tab
  // Usaha tetap merujuk ke usaha yang sedang dilihat pengguna.
  try {
    if (typeof usahaIndexAktif !== 'undefined' && usahaIndexAktif) {
      hitungOtomatis(usahaIndexAktif, true);
    }
  } catch (e) {}

  // Daftar anggota yang bisa dipilih sebagai penerima laba
  const rows = Array.from(document.querySelectorAll('#pendapatanList .rt-row'));
  const anggotaOptions = rows.map(r => {
    const nama = (r.querySelector('.pend-nama') || {}).value || '';
    const relasi = (r.querySelector('.pend-relasi') || {}).value || '';
    return { id: r.dataset.anggotaId, label: (nama || ('Anggota #' + r.dataset.anggotaId)) + (relasi ? ` (${relasi})` : '') };
  });

  let html = '';
  if (anggotaOptions.length === 0) {
    html += '<p class="hint" style="margin-bottom:10px">Belum ada anggota di atas — tambahkan anggota dulu supaya bisa dipilih sebagai penerima laba. Sementara ini semua laba usaha masuk ke Total RT tanpa nama pemilik.</p>';
  }

  for (let i = 1; i <= jumlah; i++) {
    const labaEl = document.getElementById('res-laba-bulan_' + i);
    const labaVal = labaEl ? parseRpSigned(labaEl.textContent) : 0;
    const labaText = labaEl ? labaEl.textContent : 'Rp 0';
    const labaColor = labaVal < 0 ? '#b22' : '#1d6b2e';
    const selectedId = window._labaUsahaOwnerMap[i] || '';
    const opts = ['<option value="">— Belum dialokasikan (tetap masuk Total RT) —</option>']
      .concat(anggotaOptions.map(o => `<option value="${o.id}" ${String(o.id) === String(selectedId) ? 'selected' : ''}>${o.label}</option>`))
      .join('');

    html += `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;border:1px solid #d0e3cf;background:#f7faf7;padding:10px 12px;border-radius:10px;margin-bottom:10px">
      <div style="min-width:160px">
        <b>Usaha ${i}</b>
        <div style="font-size:13px;color:${labaColor}">Laba Bersih/Bulan: <b>${labaText}</b></div>
      </div>
      <select onchange="setLabaOwner(${i}, this.value)" style="flex:1;min-width:200px;padding:8px;border:1px solid #ccc;border-radius:6px" ${anggotaOptions.length === 0 ? 'disabled' : ''}>
        ${opts}
      </select>
    </div>`;
  }
  container.innerHTML = html;

  try { hitungPendapatan(); } catch (e) {}
}

// Simpan pilihan penerima laba untuk 1 usaha, lalu hitung ulang ringkasan
function setLabaOwner(usahaIdx, anggotaId) {
  window._labaUsahaOwnerMap = window._labaUsahaOwnerMap || {};
  if (anggotaId) {
    window._labaUsahaOwnerMap[usahaIdx] = anggotaId;
  } else {
    delete window._labaUsahaOwnerMap[usahaIdx];
  }
  hitungPendapatan();
}

function hitungPendapatan() {
  const list = document.getElementById('pendapatanList');
  if (!list) return;
  const rows = list.querySelectorAll('.rt-row');
  const orang = [];
  let totalAnggotaBulan = 0;

  // === Laba usaha per bulan, per usaha (sign-aware: bisa rugi/negatif) ===
  // Dibaca dari tab Usaha (res-laba-bulan_i), lalu dialokasikan sesuai pilihan
  // di card "Alokasi Laba Usaha ke Anggota" (window._labaUsahaOwnerMap).
  const jumlahUsahaN = parseInt((document.getElementById('jumlahUsaha') || {}).value) || 0;
  const ownerMap = window._labaUsahaOwnerMap || {};
  const labaPerUsaha = {};
  let labaBulan = 0;
  for (let i = 1; i <= jumlahUsahaN; i++) {
    const el = document.getElementById('res-laba-bulan_' + i);
    const v = el ? parseRpSigned(el.textContent) : 0;
    labaPerUsaha[i] = v;
    labaBulan += v;
  }
  const labaAlokasiPerAnggota = {}; // anggotaId -> nominal
  let labaTeralokasikan = 0;
  for (let i = 1; i <= jumlahUsahaN; i++) {
    const ownerId = ownerMap[i];
    if (ownerId) {
      labaAlokasiPerAnggota[ownerId] = (labaAlokasiPerAnggota[ownerId] || 0) + labaPerUsaha[i];
      labaTeralokasikan += labaPerUsaha[i];
    }
  }
  const labaBelumDialokasikan = labaBulan - labaTeralokasikan;

  rows.forEach(row => {
    const anggotaId = row.dataset.anggotaId;
    const nama = (row.querySelector('.pend-nama')||{}).value || '';
    const relasi = (row.querySelector('.pend-relasi')||{}).value || '';
    const isPemilikUsaha = !!(row.querySelector('.pend-owner')||{}).checked;
    const perOrang = { nama, relasi, isPemilikUsaha, anggotaId };
    let sub = 0;
    row.querySelectorAll('.pend-nominal').forEach(inp => {
      const k = inp.dataset.item;
      const v = parseRp(inp.value);
      perOrang[k] = v;
      sub += v;
    });
    const labaAlokasi = labaAlokasiPerAnggota[anggotaId] || 0;
    perOrang.labaUsahaAlokasi = labaAlokasi;
    perOrang.total = sub + labaAlokasi;
    // Catatan: labaAlokasi TIDAK ditambahkan ke totalAnggotaBulan di sini —
    // sudah terhitung lewat labaBulan (jumlah semua usaha) di bawah, supaya
    // tidak dobel hitung pada Total Pendapatan RT.
    totalAnggotaBulan += sub;
    const subEl = row.querySelector('.pend-subtotal');
    if (subEl) {
      subEl.textContent = formatRp(perOrang.total) +
        (labaAlokasi ? ` (termasuk Laba Usaha: ${formatRp(labaAlokasi)})` : '');
    }
    orang.push(perOrang);
  });

  const totalBulan = totalAnggotaBulan + labaBulan;
  const totalTahun = totalBulan * 12;

  // Belanja RT total bulanan = Makanan + NonMakanan + (Tahunan/12)
  // BUGFIX: baca dari _lastTahunanByKey[key] (sumber data yang benar-benar diisi
  // oleh hitungTahunan()), bukan _lastTahunan yang selalu undefined. Sebelumnya
  // ini membuat pengeluaran tahunan RT tidak pernah ikut dihitung ke Belanja RT/Bulan,
  // sehingga Surplus terlihat lebih besar (atau Defisit lebih kecil) dari kenyataan.
  const makananBulan    = (window._lastMakanan    && window._lastMakanan.totalBulan)    || 0;
  const nonMakananBulan = (window._lastNonMakanan && window._lastNonMakanan.totalBulan) || 0;
  const _tahunanDataPend = (window._lastTahunanByKey && window._lastTahunanByKey[getTahunanKey()]) || window._lastTahunan;
  const tahunanTahun    = (_tahunanDataPend && _tahunanDataPend.totalTahun) || 0;
  const belanjaBulan    = makananBulan + nonMakananBulan + (tahunanTahun / 12);

  const surplus = totalBulan - belanjaBulan;
  const rasio = belanjaBulan > 0 ? (totalBulan / belanjaBulan) : 0;

  document.getElementById('pend-anggota-bulan').textContent = formatRp(totalAnggotaBulan);
  document.getElementById('pend-laba-bulan').textContent = formatRp(labaBulan);
  document.getElementById('pend-total-bulan').textContent = formatRp(totalBulan);
  document.getElementById('pend-total-tahun').textContent = formatRp(totalTahun);
  document.getElementById('pend-belanja-bulan').textContent = formatRp(belanjaBulan);
  document.getElementById('pend-surplus').textContent = formatRp(surplus);

  const surplusBox = document.getElementById('pend-surplus-box');
  if (surplus >= 0) {
    surplusBox.style.background = '#e6f4ea';
    document.getElementById('pend-surplus').style.color = '#1d6b2e';
    document.getElementById('pend-rasio').textContent = belanjaBulan > 0
      ? `Pendapatan ${rasio.toFixed(2)}× dari belanja RT (Surplus)`
      : 'Belum ada data belanja RT';
  } else {
    surplusBox.style.background = '#fbeaea';
    document.getElementById('pend-surplus').style.color = '#b22';
    document.getElementById('pend-rasio').textContent = `Defisit Rp ${formatNumberId(Math.abs(surplus))}/bulan — pendapatan kurang dari belanja`;
  }

  // Ringkasan list
  const ringkasan = document.getElementById('ringkasanPendapatan');
  if (orang.length === 0) {
    ringkasan.innerHTML = '<p class="hint">Belum ada anggota berpendapatan.</p>';
  } else {
    ringkasan.innerHTML = orang.map(o => {
      // BUGFIX: label & warna laba usaha alokasi harus sadar tanda (rugi = merah & "−",
      // untung = hijau & "+"). Sebelumnya SELALU ditampilkan "+" hijau walau usaha rugi,
      // sehingga terlihat seolah rugi dianggap sebagai pemasukan.
      let labaTag = '';
      if (o.labaUsahaAlokasi) {
        const rugi = o.labaUsahaAlokasi < 0;
        const tanda = rugi ? '−' : '+';
        const warna = rugi ? '#c0392b' : '#1d6b2e';
        labaTag = `<span style="color:${warna}"> ${tanda} Laba Usaha ${formatRp(Math.abs(o.labaUsahaAlokasi))}</span>`;
      }
      return `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px dashed #eee">
        <span>${o.isPemilikUsaha ? '👤' : ''} <b>${o.nama || '(Tanpa nama)'}</b> <span style="color:#888">— ${o.relasi}</span>${labaTag}</span>
        <b>${formatRp(o.total)}</b>
      </div>`;
    }).join('');
  }
  if (labaBelumDialokasikan) {
    const rugiSisa = labaBelumDialokasikan < 0;
    ringkasan.innerHTML += `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#888">
        <span>💼 Laba usaha belum dialokasikan ke anggota${rugiSisa ? ' (rugi)' : ''}</span>
        <b style="color:${rugiSisa ? '#c0392b' : 'inherit'}">${formatRp(labaBelumDialokasikan)}</b>
      </div>`;
  }

  window._lastPendapatan = {
    orang, totalAnggotaBulan, labaUsahaBulan: labaBulan, labaBelumDialokasikan,
    labaUsahaOwnerMap: Object.assign({}, window._labaUsahaOwnerMap || {}),
    totalBulan, totalTahun, belanjaBulan, surplus, rasio,
    waktu: new Date().toLocaleString('id-ID')
  };
}

function resetPendapatan() {
  const list = document.getElementById('pendapatanList');
  if (list) list.innerHTML = '';
  ['pend-anggota-bulan','pend-laba-bulan','pend-total-bulan','pend-total-tahun','pend-belanja-bulan','pend-surplus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = 'Rp 0';
  });
  const ring = document.getElementById('ringkasanPendapatan');
  if (ring) ring.innerHTML = '<p class="hint">Belum ada anggota berpendapatan.</p>';
  const rasio = document.getElementById('pend-rasio');
  if (rasio) rasio.textContent = '—';
  window._lastPendapatan = null;
  window._labaUsahaOwnerMap = {};
  try { renderLabaUsahaAlokasi(); } catch (e) {}
}

function populatePendapatan(r) {
  resetPendapatan();
  if (!r) return;
  // Pulihkan pemetaan alokasi laba usaha SEBELUM baris anggota dibangun ulang,
  // supaya select "penerima laba" langsung terisi sesuai data tersimpan.
  window._labaUsahaOwnerMap = Object.assign({}, r.labaUsahaOwnerMap || {});
  const orang = r.orang || [];
  orang.forEach(o => tambahAnggotaPendapatan(o));
  hitungPendapatan();
}

function salinPendapatan() {
  hitungPendapatan();
  const h = window._lastPendapatan;
  if (!h) { showToast('⚠️ Belum ada data'); return; }
  const lines = [
    '=== PENDAPATAN RUMAH TANGGA ===',
    ...h.orang.map(o => `${o.isPemilikUsaha?'[OWNER] ':''}${o.nama||'(?)'} (${o.relasi}): ${formatRp(o.total)}/bln`),
    `Total Anggota/Bulan: ${formatRp(h.totalAnggotaBulan)}`,
    `+ Laba Usaha/Bulan: ${formatRp(h.labaUsahaBulan)}`,
    `= Total Pendapatan/Bulan: ${formatRp(h.totalBulan)}`,
    `Total Pendapatan/Tahun: ${formatRp(h.totalTahun)}`,
    `Belanja RT/Bulan: ${formatRp(h.belanjaBulan)}`,
    `${h.surplus>=0?'Surplus':'Defisit'}/Bulan: ${formatRp(Math.abs(h.surplus))}`,
  ].join('\n');
  navigator.clipboard.writeText(lines).then(() => showToast('📋 Tersalin!'));
}

// ===== NILAI ASET (Rincian 28) =====
const ASET_LABELS = {
  a: '28.a Tanah',
  b: '28.b Bangunan',
  c: '28.c Mesin & Peralatan',
  d: '28.d Kendaraan Usaha',
  e: '28.e Aset Lainnya'
};

const PLACEHOLDER_ASET = {
  a: 'Contoh: Tanah lokasi usaha',
  b: 'Contoh: Bangunan utama, Gudang',
  c: 'Contoh: Mesin produksi, Peralatan',
  d: 'Contoh: Motor, Mobil, Truk',
  e: 'Contoh: Stok barang, Piutang'
};

function tambahItemAset(kategori) {
  produksiCounter++;
  const id = produksiCounter;
  const div = document.createElement('div');
  div.className = 'rt-row';
  div.id = 'aset' + kategori + '-' + id;
  div.innerHTML = `
    <div class="rt-row-line1">
      <div class="input-wrap biaya-nama">
        <input type="text" placeholder="${PLACEHOLDER_ASET[kategori]}" oninput="hitungAset()">
      </div>
      <button class="del-btn" onclick="hapusItemAset('${kategori}', ${id})">×</button>
    </div>
    <div class="rt-row-line2">
      <div class="input-wrap" style="flex:1">
        <span class="input-prefix">Rp</span>
        <input type="text" inputmode="numeric" class="rp-input" placeholder="0" oninput="hitungAset()">
      </div>
    </div>
  `;
  document.getElementById('aset28' + kategori + 'List').appendChild(div);
  hitungAset();
}

function hapusItemAset(kategori, id) {
  const el = document.getElementById('aset' + kategori + '-' + id);
  if (el) el.remove();
  hitungAset();
}

function getItemsAset(kategori) {
  const rows = document.querySelectorAll('#aset28' + kategori + 'List .rt-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const nama = inputs[0].value || 'Item';
    const nilai = parseRp(inputs[1].value);
    return { nama, nilai };
  });
}

function hitungAset() {
  const itemsA = getItemsAset('a');
  const itemsB = getItemsAset('b');
  const itemsC = getItemsAset('c');
  const itemsD = getItemsAset('d');
  const itemsE = getItemsAset('e');

  const a = itemsA.reduce((s, it) => s + it.nilai, 0);
  const b = itemsB.reduce((s, it) => s + it.nilai, 0);
  const c = itemsC.reduce((s, it) => s + it.nilai, 0);
  const d = itemsD.reduce((s, it) => s + it.nilai, 0);
  const e = itemsE.reduce((s, it) => s + it.nilai, 0);
  const total = a + b + c + d + e;

  document.getElementById('aset28a-subtotal').textContent = formatRp(a);
  document.getElementById('aset28b-subtotal').textContent = formatRp(b);
  document.getElementById('aset28c-subtotal').textContent = formatRp(c);
  document.getElementById('aset28d-subtotal').textContent = formatRp(d);
  document.getElementById('aset28e-subtotal').textContent = formatRp(e);

  const vals = { a, b, c, d, e };
  let html = '';
  Object.entries(vals).forEach(([k, v]) => {
    if (v > 0) {
      html += `<div class="ringkasan-row"><span class="rk-label">${ASET_LABELS[k]}</span><span class="rk-val plus">${formatRp(v)}</span></div>`;
    }
  });
  document.getElementById('ringkasanAset').innerHTML = html || '<p class="hint">Belum ada nilai diisi</p>';
  document.getElementById('aset-total').textContent = formatRp(total);
  document.getElementById('aset-terbilang').textContent = total > 0 ? terbilang(total) : '';

  window._lastAset = {
    a, b, c, d, e, total,
    itemsA, itemsB, itemsC, itemsD, itemsE,
    waktu: new Date().toLocaleString('id-ID')
  };
}

function salinAset() {
  const h = window._lastAset;
  if (!h || !h.total) { showToast('⚠️ Isi dulu nilai asetnya'); return; }

  const rincian = (items) => items.filter(it => it.nilai > 0).map(it => `    ↳ ${it.nama}: ${formatRp(it.nilai)}\n`).join('');

  const teks = `=== RINCIAN 28. NILAI ASET USAHA ===
28.a Tanah                  : ${formatRp(h.a)}
${rincian(h.itemsA)}28.b Bangunan               : ${formatRp(h.b)}
${rincian(h.itemsB)}28.c Mesin & Peralatan      : ${formatRp(h.c)}
${rincian(h.itemsC)}28.d Kendaraan Usaha        : ${formatRp(h.d)}
${rincian(h.itemsD)}28.e Aset Lainnya           : ${formatRp(h.e)}
${rincian(h.itemsE)}------------------------------------
28.f TOTAL NILAI ASET        : ${formatRp(h.total)}
(${terbilang(h.total)})
====================================`;
  copyToClipboard(teks);
}

function simpanRiwayatAset() {
  hitungAset();
  const h = window._lastAset;
  if (!h || !h.total) { showToast('⚠️ Isi dulu nilai asetnya'); return; }
  const nama = getCurrentNama();
  if (!nama) { showToast('⚠️ Isi Nama Usaha di tab Usaha dulu'); return; }
  pushOrReplaceRiwayat({ tipe: 'nilaiAset', nama, ...h });
  showToast(window._editingId ? '✅ Riwayat diperbarui!' : '💾 Tersimpan ke riwayat!');
  finishEdit();
}

function resetAset() {
  ['a','b','c','d','e'].forEach(k => {
    document.getElementById('aset28' + k + 'List').innerHTML = '';
    document.getElementById('aset28' + k + '-subtotal').textContent = 'Rp 0';
  });
  document.getElementById('ringkasanAset').innerHTML = '';
  document.getElementById('aset-total').textContent = 'Rp 0';
  document.getElementById('aset-terbilang').textContent = '';
  window._lastAset = null;
}

// ===== UTILS =====
function formatRp(n) {
  if (isNaN(n)) return 'Rp 0';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

// Mengambil angka bersih dari input rp-input (menghapus titik pemisah ribuan)
function parseRp(value) {
  if (!value) return 0;
  const bersih = String(value).replace(/\./g, '').replace(/[^0-9]/g, '');
  return bersih ? parseInt(bersih, 10) : 0;
}

// Sama seperti parseRp, tapi MEMPERTAHANKAN tanda minus — dipakai untuk membaca
// nominal laba bersih usaha di DOM (mis. "Rp -566.667" saat usaha rugi), karena
// parseRp biasa akan membuang tanda "-" sehingga rugi terbaca sebagai untung.
function parseRpSigned(value) {
  if (!value) return 0;
  const str = String(value);
  const negatif = /-/.test(str);
  const bersih = str.replace(/\./g, '').replace(/[^0-9]/g, '');
  const num = bersih ? parseInt(bersih, 10) : 0;
  return negatif ? -num : num;
}

// Format otomatis saat mengetik di semua input bertanda class "rp-input"
// (termasuk yang dibuat dinamis lewat JS), menggunakan event delegation.
document.addEventListener('input', function(e) {
  if (!e.target.classList || !e.target.classList.contains('rp-input')) return;

  const input = e.target;
  const cursorFromEnd = input.value.length - input.selectionStart;
  const angka = parseRp(input.value);

  input.value = angka ? angka.toLocaleString('id-ID') : '';

  const newPos = Math.max(input.value.length - cursorFromEnd, 0);
  input.setSelectionRange(newPos, newPos);
});

function terbilang(n) {
  n = Math.abs(Math.round(n));
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace('.', ',') + ' triliun';
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace('.', ',') + ' miliar';
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace('.', ',') + ' juta';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + ' ribu';
  return n.toString();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== SALIN KE CLIPBOARD (dengan fallback untuk WebView/HTTP) =====
function copyToClipboard(teks) {
  // Cara 1: Clipboard API modern (butuh HTTPS/localhost + permission)
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(teks).then(() => {
      showToast('📋 Disalin!');
    }).catch(() => {
      fallbackCopy(teks);
    });
  } else {
    fallbackCopy(teks);
  }
}

function fallbackCopy(teks) {
  // Cara 2: textarea sementara + execCommand (kompatibel WebView lama / file:// / HTTP)
  try {
    const ta = document.createElement('textarea');
    ta.value = teks;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, teks.length);
    } else {
      ta.select();
    }

    const success = document.execCommand('copy');
    document.body.removeChild(ta);

    if (success) {
      showToast('📋 Disalin!');
    } else {
      showToast('⚠️ Gagal salin otomatis, salin manual ya');
    }
  } catch (err) {
    showToast('⚠️ Gagal salin otomatis, salin manual ya');
  }
}

// Init
updateHariHint();
// Jalankan migrasi data lama → schema responden (sekali, idempotent)
try {
  const n = migrateOldRiwayat();
  if (n > 0) console.log('[Migrasi] ' + n + ' responden baru dari riwayat lama');
} catch(e) { console.warn('Migrasi gagal:', e); }
// Render banner responden aktif
renderRespondenAktifBar();
  // Jika ada keluarga aktif (mode 1 keluarga banyak usaha), render dropdown usaha aktif
  renderUsahaAktifUI();

  // Jika ada responden aktif (legacy mode), restore nama-nya ke input
  if (respondenAktif && respondenDB[respondenAktif]) {
    const inp = document.getElementById('namaUsaha');
    if (inp && !inp.value) inp.value = respondenDB[respondenAktif].nama;
  }


// ===== P1: IMPORT JSON =====
function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      // Support multi-format:
      //  1) Array of responden objects (export terbaru) — punya _key/kalkulator/belanjaRT
      //  2) Array of riwayat entries — punya tipe + id
      //  3) {respondenDB, riwayat}
      //  4) {riwayat:[]} polos
      let importedDB = {};
      let importedRiwayat = [];

      if (Array.isArray(data)) {
        // Deteksi: kalau item-itemnya punya _key atau salah satu slot rincian → ini RESPONDEN array
        const isRespondenArray = data.length === 0 || data.some(x =>
          x && (x._key || x.kalkulator || x.rincian26 || x.rincian28 || x.belanjaRT || x.pendapatan)
        );
        if (isRespondenArray) {
          data.forEach(r => {
            const key = r._key || (r.nama ? namaToKey(r.nama) : null);
            if (key) {
              // Pastikan _key set di object yg di-import
              if (!r._key) r._key = key;
              importedDB[key] = r;
            }
          });
        } else {
          importedRiwayat = data;
        }
      } else if (data.respondenDB && data.riwayat) {
        importedDB = data.respondenDB;
        importedRiwayat = data.riwayat;
      } else if (data.respondenDB) {
        importedDB = data.respondenDB;
      } else if (data.riwayat) {
        importedRiwayat = data.riwayat;
      } else if (typeof data === 'object') {
        // Asumsikan ini object respondenDB langsung (key→responden)
        // Hanya kalau values-nya punya nama atau slot rincian
        const vals = Object.values(data);
        if (vals.length && vals.every(v => v && (v.nama || v.kalkulator || v.belanjaRT))) {
          importedDB = data;
        } else {
          showToast('⚠️ Format JSON tidak dikenali');
          return;
        }
      }

      const importedRespCount = Object.keys(importedDB).length;
      const importedRiwayatCount = importedRiwayat.length;
      if (importedRespCount === 0 && importedRiwayatCount === 0) {
        showToast('⚠️ File JSON tidak mengandung data responden/riwayat');
        return;
      }

      const action = confirm(
        `Ditemukan ${importedRespCount} profil responden dan ${importedRiwayatCount} entri riwayat.\n\n` +
        `OK = Gabung dengan data yang ada (data lama tetap)\n` +
        `Cancel = Batalkan import`
      );
      if (!action) return;

      // Merge respondenDB (skip duplicate by key, prefer existing)
      let mergedResp = 0;
      Object.keys(importedDB).forEach(k => {
        if (!respondenDB[k]) {
          respondenDB[k] = importedDB[k];
          mergedResp++;
        }
      });

      // Merge riwayat — skip if same id exists
      const existingIds = new Set(riwayat.map(x => x.id));
      let mergedRiwayat = 0;
      importedRiwayat.forEach(x => {
        if (!existingIds.has(x.id)) {
          riwayat.push(x);
          mergedRiwayat++;
        }
      });

      persistRespondenDB();
      localStorage.setItem('se2026_riwayat', JSON.stringify(riwayat));
      renderRiwayat();
      renderRespondenAktifBar();
      showToast(`✅ Import: ${mergedResp} profil + ${mergedRiwayat} entri`);
    } catch (err) {
      console.error(err);
      alert('❌ File JSON tidak valid:\n' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = ''; // reset agar bisa import file sama lagi
}

// ===== P2: GEO-TAGGING =====
function captureGeoLocation() {
  const status = document.getElementById('geoStatus');
  if (!navigator.geolocation) {
    status.textContent = '❌ Browser tidak support geolokasi';
    status.style.color = '#c00';
    return;
  }
  status.textContent = '⏳ Mengambil lokasi…';
  status.style.color = '#888';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      _geoData = {
        lat: +pos.coords.latitude.toFixed(6),
        lon: +pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy),
        waktu: new Date().toLocaleString('id-ID')
      };
      renderGeoStatus();
      // Auto-attach ke respondenAktif kalau ada
      if (respondenAktif && respondenDB[respondenAktif]) {
        respondenDB[respondenAktif].geo = _geoData;
        persistRespondenDB();
      }
      showToast(`📍 Lokasi tersimpan (±${_geoData.accuracy}m)`);
    },
    (err) => {
      status.textContent = '❌ Gagal: ' + err.message;
      status.style.color = '#c00';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}
function renderGeoStatus() {
  const status = document.getElementById('geoStatus');
  const btnClear = document.getElementById('btnClearGeo');
  if (!status) return;
  if (_geoData && _geoData.lat) {
    status.innerHTML = `✓ <b>${_geoData.lat}, ${_geoData.lon}</b> (±${_geoData.accuracy}m)
      <a href="https://www.google.com/maps?q=${_geoData.lat},${_geoData.lon}" target="_blank" style="color:#1565c0;margin-left:4px">🗺️ Lihat</a>`;
    status.style.color = '#1d6b2e';
    if (btnClear) btnClear.style.display = '';
  } else {
    status.textContent = 'Belum ada koordinat';
    status.style.color = '#666';
    if (btnClear) btnClear.style.display = 'none';
  }
}
function clearGeoLocation() {
  _geoData = null;
  if (respondenAktif && respondenDB[respondenAktif]) {
    delete respondenDB[respondenAktif].geo;
    persistRespondenDB();
  }
  renderGeoStatus();
  showToast('Lokasi dihapus');
}

// ===== P2: STATUS DRAFT/FINAL =====
function toggleStatusResponden(key) {
  const r = respondenDB[key];
  if (!r) return;
  const cur = r.status || 'draft';
  r.status = cur === 'final' ? 'draft' : 'final';
  persistRespondenDB();
  renderRiwayat();
  showToast(`Status: ${r.status === 'final' ? '✅ Final' : '📝 Draft'}`);
}

// ===== P2: AUTO-SAVE DRAFT =====
function captureDraftSnapshot() {
  // Capture state minimal dari form aktif (Kalkulator + nama)
  const snap = {
    namaUsaha: (document.getElementById('namaUsaha') || {}).value || '',
    omzet: (document.getElementById('omzet') || {}).value || '',
    nomorKeluarga: (document.getElementById('nomorKeluarga') || {}).value || '',
    nomorBangunan: (document.getElementById('nomorBangunan') || {}).value || '',
    pekerjaan: (document.getElementById('pekerjaanResponden') || {}).value || '',
    jenisUsahaSelect: (document.getElementById('jenisUsahaSelect_1') || {}).value || '',
    kbliManual: (document.getElementById('kbliManual') || {}).value || '',
    satuanWaktu: (document.getElementById('satuanWaktu_1') || {}).value || '',
    geo: _geoData,
    waktu: new Date().toISOString()
  };
  // Hanya simpan kalau ada minimal isi nama atau omzet
  if (snap.namaUsaha.trim() || snap.omzet.trim()) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(snap));
  }
}
function checkAndRestoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft.namaUsaha && !draft.omzet) return;
    // Cek kalau responden ini sudah disimpan ke DB → drop draft
    const key = draft.namaUsaha ? namaToKey(draft.namaUsaha) : null;
    if (key && respondenDB[key]) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const usia = (Date.now() - new Date(draft.waktu).getTime()) / 1000 / 60; // minutes
    const restore = confirm(
      `📝 Ditemukan draft yang belum disimpan:\n\n` +
      `• Nama: ${draft.namaUsaha || '(kosong)'}\n` +
      `• Omzet: ${draft.omzet || '(kosong)'}\n` +
      `• Waktu: ${Math.round(usia)} menit lalu\n\n` +
      `OK = Pulihkan draft\nCancel = Buang draft`
    );
    if (restore) {
      ['namaUsaha','omzet','nomorKeluarga','nomorBangunan','kbliManual'].forEach(id => {
        const el = document.getElementById(id);
        if (el && draft[id]) el.value = draft[id];
      });
      ['pekerjaanResponden','jenisUsahaSelect_1','satuanWaktu_1'].forEach(id => {
        const el = document.getElementById(id);
        const v =
          id === 'pekerjaanResponden' ? draft.pekerjaan :
          id === 'jenisUsahaSelect_1' ? draft.jenisUsahaSelect :
          id === 'satuanWaktu_1' ? draft.satuanWaktu :
          draft[id];
        if (el && v) { el.value = v; el.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      if (draft.geo) { _geoData = draft.geo; renderGeoStatus(); }
      showToast('📝 Draft dipulihkan');
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch (e) { console.warn('restore draft', e); }
}
function startAutoSaveDraft() {
  if (_autoSaveInterval) clearInterval(_autoSaveInterval);
  _autoSaveInterval = setInterval(captureDraftSnapshot, 10000); // setiap 10 detik
}

// Init: auto-restore draft & start auto-save
setTimeout(() => { checkAndRestoreDraft(); startAutoSaveDraft(); }, 1500);

// Saat Simpan Semua selesai → hapus draft (data sudah commit ke DB)
const _origSimpanSemua = window.simpanSemuaResponden;
window.simpanSemuaResponden = function() {
  const result = (typeof _origSimpanSemua === 'function')
    ? _origSimpanSemua.apply(this, arguments)
    : undefined;

  localStorage.removeItem(DRAFT_KEY);
  return result;
};

// ===== MULTI-USAHA: duplikasi blok Biaya Usaha (Rincian 26 b-e) agar ID sesuai idx =====
function duplicateRincian26BlocksForMultiUsaha() {
  const jumlahEl = document.getElementById('jumlahUsaha');
  const jumlah = parseInt(jumlahEl && jumlahEl.value, 10) || 0;
  if (jumlah < 2) return;

  for (let i = 2; i <= jumlah; i++) {
    const rootFrom = document.getElementById('innerUsaha-1');
    const rootTo = document.getElementById('innerUsaha-' + i);
    if (!rootFrom || !rootTo) continue;

    // Target node: seluruh card "Rincian Pengeluaran (Rincian 26 FASIH)" di dalam innerUsaha-1
    const fromCards = rootFrom.querySelectorAll('.card');
    const targetFrom = Array.from(fromCards).find(card => {
      const title = card.querySelector('.card-title');
      return title && /Rincian Pengeluaran \(Rincian 26 FASIH\)/i.test(title.textContent);
    });

    if (!targetFrom) continue;

    // Jika container sudah ada, hapus card lama di rootTo yang bertipe sama agar tidak dobel
    const toCards = rootTo.querySelectorAll('.card');
    Array.from(toCards).forEach(card => {
      const title = card.querySelector('.card-title');
      if (title && /Rincian Pengeluaran \(Rincian 26 FASIH\)/i.test(title.textContent)) {
        card.remove();
      }
    });

    const clone = targetFrom.cloneNode(true);

    // Replace id: _1 -> _i (khusus postfix)
    clone.querySelectorAll('[id]').forEach(el => {
      el.id = el.id.replace(/_1\b/g, '_' + i);
    });

    // Replace id pada atribut lain yang mereferensikan _1 (opsional minimal)
    clone.querySelectorAll('*').forEach(el => {
      if (el.hasAttribute('for')) {
        const v = el.getAttribute('for');
        if (v) el.setAttribute('for', v.replace(/_1\b/g, '_' + i));
      }
    });

    // Replace inline onclick parameter terakhir: (...,1) -> (...,i)
    clone.querySelectorAll('*[onclick]').forEach(el => {
      const onclick = el.getAttribute('onclick') || '';
      el.setAttribute('onclick', onclick.replace(/,(?=\s*1\s*\))\s*1\b/g, ',' + i));
      // fallback yang lebih sederhana jika pola di atas tidak match:
      el.setAttribute('onclick', onclick.replace(/\b,\s*1\s*\)/g, ', ' + i + ')'));
    });

    // Masukkan clone ke rootTo dengan urutan yang sama: taruh sebelum tombol hitung (jika ada)
    const hitungBtn = rootTo.querySelector('button.hitung-btn');
    if (hitungBtn && hitungBtn.parentNode) {
      hitungBtn.parentNode.insertBefore(clone, hitungBtn);
    } else {
      rootTo.appendChild(clone);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // FIX: duplicateRincian26BlocksForMultiUsaha() SENGAJA TIDAK dipanggil lagi.
  // Fungsi ini dulu jalan setiap kali dropdown "Jumlah Usaha" mengirim event
  // input/change: dia meng-clone kartu "Rincian Pengeluaran 26" milik Usaha 1
  // PADA SAAT ITU JUGA (termasuk item-item yang sudah diisi user), lalu
  // MENGHAPUS kartu Rincian 26 milik Usaha 2..n dan MENGGANTINYA dengan
  // kloningan Usaha 1 tsb. Akibatnya, begitu jumlahUsaha ter-trigger ulang
  // setelah Usaha 1 sudah diisi, seluruh item 26.b-26.e milik Usaha 2..n
  // hilang dan digantikan salinan item Usaha 1 (bug: "tambah item di Usaha
  // 2..n jadi sama dengan Usaha 1").
  //
  // Ini tidak diperlukan karena HTML setiap Usaha 1-5 SUDAH punya elemen
  // Rincian 26 sendiri-sendiri dengan id unik (bu26bList_1..5, dst) dan
  // tombol "+ Tambah Item" yang sudah benar menunjuk ke idx masing-masing.
});

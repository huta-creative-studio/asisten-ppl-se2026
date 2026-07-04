#!/bin/bash
# Build script: minify + obfuscate source di /app/webapp-src menjadi
# distribusi siap-pakai di /app/frontend/public/webapp.
# Source (readable) TIDAK ikut ter-deploy — hanya hasil build (obfuscated) yang disajikan.
set -e

SRC="/app/webapp-src"
DIST="/app/frontend/public/webapp"

rm -rf "$DIST"
mkdir -p "$DIST/css" "$DIST/js/vendor" "$DIST/icons"

echo "== Minify CSS =="
npx --yes clean-css-cli -o "$DIST/css/styles.min.css" "$SRC/css/styles.css"

echo "== Minify JS (app.js) — terser only, tanpa obfuscator =="
# Catatan penting soal trade-off ukuran vs obfuscation:
# javascript-obfuscator (string-array/control-flow/hex-naming) TERBUKTI justru
# MEMBESARKAN file ini 1.5-2x (nama variabel hex lebih panjang dari nama
# 1-2 huruf hasil terser, plus overhead dekoder). Karena "ringan" adalah
# prioritas utama untuk file besar ini, app.js HANYA diminify (terser: hapus
# komentar/spasi + mangle nama variabel LOKAL ke huruf pendek). Nama fungsi
# top-level TETAP dipertahankan (toplevel=false) karena ratusan onclick="..."
# di HTML memanggilnya langsung. Proteksi anti-duplikasi utama ada di lock.js
# (gerbang aktivasi) yang diobfuscate penuh di bawah — cost ukurannya kecil
# karena filenya kecil, tapi manfaat proteksinya besar.
npx --yes terser "$SRC/js/app.js" -c -m toplevel=false --comments false -o "$DIST/js/app.min.js"

echo "== Minify + Obfuscate JS (lock.js) =="
npx --yes terser "$SRC/js/lock.js" -c -m toplevel=false --comments false -o /tmp/lock.min.tmp.js
npx --yes javascript-obfuscator /tmp/lock.min.tmp.js \
  --output "$DIST/js/lock.min.js" \
  --compact true \
  --control-flow-flattening true \
  --control-flow-flattening-threshold 0.6 \
  --dead-code-injection false \
  --string-array true \
  --string-array-encoding base64 \
  --string-array-threshold 0.9 \
  --rename-globals false \
  --identifier-names-generator hexadecimal \
  --self-defending false \
  --disable-console-output false

echo "== Minify + Obfuscate JS (pwa.js) =="
npx --yes terser "$SRC/js/pwa.js" -c -m toplevel=false --comments false -o /tmp/pwa.min.tmp.js
npx --yes javascript-obfuscator /tmp/pwa.min.tmp.js \
  --output "$DIST/js/pwa.min.js" \
  --compact true \
  --control-flow-flattening false \
  --string-array true \
  --string-array-encoding base64 \
  --rename-globals false \
  --identifier-names-generator hexadecimal \
  --self-defending false \
  --disable-console-output false

echo "== Copy vendor (html2canvas, sudah minified upstream) =="
cp "$SRC/js/vendor/html2canvas.min.js" "$DIST/js/vendor/html2canvas.min.js"

echo "== Copy static assets =="
cp "$SRC/manifest.json" "$DIST/manifest.json"
cp "$SRC/sw.js" "$DIST/sw.js"
cp "$SRC/icons/"*.png "$DIST/icons/"
echo "== Minify HTML =="
npx --yes html-minifier-terser "$SRC/index.html" \
  --collapse-whitespace --remove-comments \
  --remove-script-type-attributes \
  --use-short-doctype \
  -o "$DIST/index.html"

echo "== DONE =="
du -sh "$DIST"
find "$DIST" -type f | sort

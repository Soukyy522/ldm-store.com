# Tahap 2 - GitHub Pages

## Tujuan
Menjalankan frontend LocDailyMar melalui HTTPS GitHub Pages tanpa mengubah penyimpanan bisnis yang masih menggunakan localStorage.

## Publishing
- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

`index.html` harus berada di root.

## Setelah deployment
Buka `pages-health-check.html` lalu periksa HTTPS, Secure Context, localStorage, Camera API, dan seluruh halaman HTML utama.

## Penting
- Tahap 2 belum live sync.
- localStorage dari `file://` atau domain lama tidak otomatis pindah ke `github.io`.
- Shift Management tetap tidak digunakan.
- Jangan commit credential privat.

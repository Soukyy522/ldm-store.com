# Tahap 1 - GitHub Repository

## Tujuan
Menyiapkan LocDailyMar untuk repository GitHub tanpa mengubah logika bisnis.

## Sudah dilakukan
- Semua HTML tetap di root.
- `index.html` tetap sebagai entry point.
- Folder `js/`, `css/`, `assets/`, `docs/` disiapkan.
- `.gitignore` dan `.env.example` dibuat.
- Link antar HTML diperiksa.
- Inline JavaScript diperiksa dengan `node --check`.
- Shift Management tetap tidak digunakan.

## Belum dilakukan
- GitHub Pages belum diaktifkan.
- Supabase belum dibuat.
- `localStorage` belum dimigrasikan.
- Live Sync belum aktif.

## Aturan migrasi
1. Jangan memindahkan semua script sekaligus.
2. Jangan hapus localStorage lama sebelum modul cloud stabil.
3. Jangan commit credential privat.
4. Gunakan commit kecil per perubahan.
5. Simpan baseline Tahap 0 di tempat terpisah.

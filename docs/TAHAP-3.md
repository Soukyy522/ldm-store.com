# Tahap 3 - Supabase Project & Connection

## Tujuan

Tahap 3 membuat project Supabase dan membuktikan bahwa frontend GitHub Pages
bisa terhubung ke PostgreSQL Supabase menggunakan **Project URL + Publishable Key**.

Belum ada data bisnis yang dimigrasikan pada tahap ini.

## File baru

- `js/supabase-config.js`
- `js/supabase-client.js`
- `supabase/sql/00-stage3-system-meta.sql`
- `supabase-connection-test.html`

## Langkah setup

1. Buat project Supabase baru.
2. Catat Project URL.
3. Ambil Publishable Key (`sb_publishable_...`).
4. Buka SQL Editor dan jalankan `supabase/sql/00-stage3-system-meta.sql`.
5. Isi `js/supabase-config.js`.
6. Upload perubahan ke GitHub Pages.
7. Buka `supabase-connection-test.html`.
8. Klik **Tes Koneksi Supabase**.

## Keamanan

Frontend GitHub Pages **tidak boleh** memuat:

- Secret key (`sb_secret_...`)
- legacy `service_role`
- password database
- JWT secret

Publishable Key adalah key client-side berprivilege rendah. Keamanan data
bisnis tetap akan bergantung pada Supabase Auth, grants, dan Row Level Security.

## Kenapa hanya metadata pada Tahap 3?

Agar koneksi, key, Data API, dan RLS dapat diuji sebelum tabel Barang,
Transaksi, Stok, Absensi, Retur, dan laporan dibuat. Migrasi bisnis dimulai
pada Tahap 4 dan sesudahnya.

# Tahap 5 - Supabase Auth Foundation

## Baseline

Tahap 5 dibangun dari `LocDailyMar-LiveSync-TAHAP-4-Cloud-Foundation.zip`.

Akses **Edit Akun tetap Owner-only**.

## Mengapa login utama belum langsung diganti?

Tahap 5 menguji Supabase Auth secara terpisah terlebih dahulu. Ini mencegah aplikasi terkunci jika:

- Auth user belum dibuat
- profile Owner belum di-bootstrap
- email belum dikonfirmasi
- policy / RLS belum benar

`index.html` lama tetap berfungsi sebagai mode legacy sementara.

## Komponen Tahap 5

- `js/cloud-auth.js`
- `supabase-stage5-auth-test.html`
- `supabase/sql/02-stage5-auth-foundation.sql`
- `supabase/sql/02-stage5-bootstrap-owner-template.sql`
- `supabase/sql/02-stage5-verify.sql`

## Alur setup

1. Jalankan SQL Auth Foundation.
2. Buat/invite user dari Supabase Authentication > Users.
3. Pastikan user dapat login dengan email/password.
4. Jalankan template Bootstrap Owner dengan email Auth tersebut.
5. Jalankan Verify SQL.
6. Upload paket ke GitHub Pages.
7. Buka `supabase-stage5-auth-test.html`.
8. Login menggunakan email/password Auth.
9. Pastikan profile, store, dan device berhasil terbaca.

## Data yang belum dipindahkan

- Barang
- transaksi
- stok
- laporan
- Absensi
- Retur
- Supplier / PO / GR
- Closing / EOD

## Tahap sesudahnya

Setelah Auth cloud berhasil, integrasi login aplikasi dapat dilakukan tanpa lagi mempercayai role dari localStorage sebagai sumber otoritatif.

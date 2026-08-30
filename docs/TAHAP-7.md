# Tahap 7 - Cloud Master Barang

Tahap 7 memindahkan Master Barang dari `localStorage.dataBarang` ke `public.products`.

## Yang sudah cloud

- UUID produk stabil
- store_id
- barcode
- nama
- kategori
- satuan
- harga beli
- harga jual
- data promo
- soft delete
- version / updated_at
- Realtime products

## Kompatibilitas

`localStorage.dataBarang` tetap dipakai sebagai cache sementara supaya halaman lama tetap dapat membaca format:

- `nama`
- `harga`
- `hargaBeli`
- `stok`
- `promo`

Cloud row dikonversi kembali ke format tersebut oleh `js/products-service.js`.

## Stok

`legacy_stock_snapshot` hanya snapshot transisi.

Tahap ini belum membuat transaksi stok atomic. Jangan menjadikan nilai tersebut sebagai ledger stok final.

## Migrasi

Jalankan `supabase-stage7-products-migration.html` menggunakan akun Owner pada perangkat yang mempunyai dataBarang paling lengkap.

Setelah migrasi:
- setiap item cache akan memiliki `id` UUID
- product master dibaca dari Supabase
- Realtime menyegarkan cache pada perangkat lain

## Hak akses

- Owner: read + write Master Barang
- Admin: read
- Kasir: read
- Hard delete: tidak tersedia dari browser
- Delete produk: RPC soft delete Owner-only


## Link banyak User Profile

Template Link User Profile sudah menggunakan versi multi-account `VALUES + LOOP`.

File:

- `supabase/sql/04-stage7-link-multiple-user-profiles.sql`

Semua email harus dibuat terlebih dahulu di Supabase Authentication > Users.

Tambahkan akun pada bagian:

```sql
values
    ('owner@example.com', 'cornermar', 'owner'),
    ('admin@example.com', 'admin1', 'admin'),
    ('kasir1@example.com', 'kasir1', 'kasir')
```

Format selalu:

`('EMAIL AUTH', 'USERNAME APLIKASI', 'ROLE')`

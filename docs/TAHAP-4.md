# Tahap 4 - Cloud Foundation

## Baseline

Tahap 4 dibuat dari `LocDailyMar-LiveSync-TAHAP-3-Owner-Login-Fixed.zip`.

Akses **Edit Akun tetap Owner-only**. Perubahan eksperimen yang memberi Admin akses Edit Akun tidak dipakai.

## Tujuan

Membuat fondasi database sebelum data bisnis mulai dimigrasikan.

Tabel:

- `stores`
- `profiles`
- `devices`

Fondasi kolom:

- UUID / stable ID
- `store_id`
- `created_at`
- `updated_at`
- `version`
- `deleted_at`
- `deleted_by`

Keamanan:

- Row Level Security diaktifkan.
- Pengguna anonim tidak mendapat akses foundation tables.
- `profiles` belum bisa ditulis langsung dari frontend.
- Hard delete tidak diberikan.
- Helper `ldm_current_store_id()` dan `ldm_current_role()` disiapkan untuk policy tahap berikutnya.

## Default store

SQL membuat satu store awal:

- code: `LDM-DEFAULT`
- name: `LocDailyMar`
- timezone: `Asia/Makassar`
- currency: `IDR`

UUID store dibuat oleh PostgreSQL.

## Yang belum dilakukan

Tahap 4 belum memindahkan:

- Barang
- transaksi
- stok
- laporan
- Absensi
- Retur
- Pengeluaran
- Supplier / PO / Goods Receipt
- Closing / EOD

Tahap 4 juga belum mengganti login localStorage.

## Tahap berikutnya

Tahap 5: Supabase Auth + bootstrap profile Owner + pengaitan akun cloud ke `store_id`.

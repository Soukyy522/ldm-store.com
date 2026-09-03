# LocDailyMar POS — Clean Production Build 27.9.0

Build produksi LocDailyMar dengan arsitektur HTML/CSS/JavaScript + Supabase.

## Fitur utama saat ini
- 3 Mode Operasional per cabang: Kafe, Warung, Toko Ritel.
- Kafe: menu bergambar + Soft Stock.
- Warung: tanpa gambar + Soft Stock.
- Toko Ritel: tanpa gambar + Strict Stock.
- Multi-Store, transfer stok, dan batas Owner Pusat / Owner Cabang.
- Kasir, Barang, Kartu Stok, Stock Opname, Retur, Supplier, PO, GR.
- Laporan harian + filter Dari Tanggal / Sampai Tanggal.
- Closing Shift, EOD, Absensi, Akun Cloud, Perangkat Cloud.
- Penyimpanan & Retensi dengan Supabase Storage.
- Lisensi V2 + checkout Midtrans pada `license.html`.
- PWA, Offline Queue, Recovery Center, QA & Security.
- Sandbox ringan hanya di `homepage.html`; tidak menyimpan transaksi/data demo.

## Struktur penting
- Halaman aplikasi: root `*.html`
- JavaScript aktif: `js/`
- CSS aktif: `css/`
- Aset: `assets/`
- Supabase aplikasi: `supabase/`
- License Authority: `license-authority-v2/`

## SQL untuk instalasi / update
- Instalasi lengkap database: `SQL-INSTALASI-LENGKAP-3-MODE-MULTISTORE-STORAGE.sql`
- Hardening Owner Pusat/Cabang untuk database existing: `SQL-33-HARDENING-OWNER-PUSAT-CABANG.sql`
- Template jadwal Storage cleanup: `SQL-32-JADWAL-STORAGE-CLEANUP-TEMPLATE.sql`

Migration historis tetap tersedia di `supabase/sql/` untuk audit/development.

## Keamanan
Jangan menaruh Supabase `service_role`, JWT secret, database password, Midtrans Server Key, atau `LDM_STORAGE_CRON_SECRET` di HTML/JavaScript frontend.

## Catatan build bersih
File test browser tahap lama, duplikat service JS di root, checkout legacy, dokumentasi tahap historis, dan tool QA Node yang tidak dibutuhkan runtime telah dikeluarkan dari ZIP distribusi ini. Tidak ada tabel/database customer yang dihapus oleh proses pembersihan file ZIP.

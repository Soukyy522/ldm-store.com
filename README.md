# LocDailyMar POS

Baseline **Live Sync Tahap 1: GitHub Repository Ready**.

## Arsitektur saat ini

- Frontend: HTML + CSS + JavaScript
- Penyimpanan bisnis: masih `localStorage`
- Shift Management: sudah dihapus
- Absensi: Shift 1 / Shift 2 / Full Day hanya atribut Absensi
- Hosting target: GitHub Pages
- Database target: Supabase PostgreSQL

## Halaman aplikasi
- `Purchase-Order.html`
- `absensi.html`
- `backup & restore.html`
- `barang.html`
- `dashboard.html`
- `eod.html`
- `goods.receipt.html`
- `index.html`
- `kartu-stok.html`
- `kasir.html`
- `laporan.html`
- `pengeluaran.html`
- `retur.html`
- `shift-closing.html`
- `stock-opname.html`
- `supplier.html`

## Struktur repository

```text
/
├── index.html
├── dashboard.html
├── barang.html
├── kasir.html
├── ... halaman aplikasi lainnya
├── js/
├── css/
├── assets/
├── docs/
├── .gitignore
└── .env.example
```

## Keamanan

Jangan commit `service_role` key, password database, JWT secret, token admin, atau credential privat.

## Roadmap

- [x] Tahap 0: baseline dan audit
- [x] Tahap 1: repository GitHub siap
- [ ] Tahap 2: GitHub Pages
- [ ] Tahap 3: Supabase project
- [ ] Tahap 4+: migrasi database bertahap

## Status terbaru

- [x] Tahap 16: Offline Queue + Reconnect
- [x] Tahap 17: Sync Conflict & Recovery Center
- [x] Tahap 18: PWA Installation & Safe Update Manager
- [x] Tahap 19: Full QA, Security & Performance
- [x] Tahap 20: Master Satuan dan Konversi Kemasan
- [x] Tahap 21: Promo dan Harga Lanjutan
- [x] Tahap 22: Multi-Toko dan Transfer Stok
- [x] Patch 22.1: Mega Menu desktop global, hamburger HP, dan tema Multi-Toko mengikuti Dashboard
- [x] Patch 22.2: Seluruh navigasi operasional memakai source global yang sama dengan Dashboard, responsive desktop/HP, dan EOD otomatis tersembunyi sampai Closing Shift lengkap

Tahap 21 menambahkan promo harga tetap, diskon persen, minimal pembelian,
jadwal tanggal, pratinjau margin, validasi server, dan riwayat perubahan harga.
Petunjuk pemasangan tersedia pada `docs/TAHAP-21.md`.

Tahap 22 menambahkan jaringan cabang, membership akun per toko, toko aktif per
perangkat, serta transfer stok atomik Draft → Dalam Pengiriman → Diterima.
Petunjuk pemasangan tersedia pada `docs/TAHAP-22.md`.

Tahap 18 menambahkan manifest installable, ikon aplikasi, halaman fallback
offline, satu Service Worker resmi, pemeriksaan update manual, serta perlindungan
agar update/cache cleanup tidak berjalan ketika antrean offline belum aman.
Gunakan `pwa-settings.html` untuk instalasi dan diagnostik perangkat.

Tahap 17 ditambahkan setelah Tahap 19 menggunakan paket Tahap 19 terbaru sebagai
baseline. Conflict sinkronisasi kini tercatat terpusat per store, dapat dipantau
melalui `recovery-center.html`, dan keputusan retry/discard memiliki pembatasan
role serta audit cloud. Discard hanya Owner dan diblokir ulang di server agar
perangkat lama tidak dapat mengirim antrean yang sudah dibatalkan.


## Tahap 2 - GitHub Pages
Paket ini siap untuk deployment GitHub Pages dari branch `main` folder root. Setelah deployment, buka `pages-health-check.html`. Live Sync belum aktif pada Tahap 2.


## Tahap 3 - Supabase

Paket ini memiliki client Supabase dasar dan halaman `supabase-connection-test.html`.
Isi Project URL + Publishable Key di `js/supabase-config.js`, jalankan SQL
`supabase/sql/00-stage3-system-meta.sql`, lalu uji koneksi melalui GitHub Pages.

Data bisnis masih menggunakan `localStorage` pada tahap ini.


## Tahap 4 - Cloud Foundation

Database foundation sudah disiapkan melalui:

- `supabase/sql/01-stage4-cloud-foundation.sql`
- `supabase/sql/01-stage4-verify.sql`
- `supabase-stage4-test.html`

Tabel foundation:

- `stores`
- `profiles`
- `devices`

Edit Akun tetap hanya untuk Owner. Supabase Auth dan migrasi data bisnis belum diaktifkan pada Tahap 4.


## Tahap 5 - Supabase Auth Foundation

File baru:

- `js/cloud-auth.js`
- `supabase-stage5-auth-test.html`
- `supabase/sql/02-stage5-auth-foundation.sql`
- `supabase/sql/02-stage5-bootstrap-owner-template.sql`
- `supabase/sql/02-stage5-verify.sql`

Login utama `index.html` belum diganti. Supabase Auth diuji terpisah terlebih dahulu untuk mencegah lockout saat setup.

Edit Akun tetap hanya dapat diakses Owner.


## Tahap 6 - Main Supabase Auth

Login utama sekarang menggunakan Supabase Auth.

Role resmi berasal dari `public.profiles.role`. Nilai role di localStorage hanya dipertahankan sebagai cache kompatibilitas untuk modul lama.

File utama:
- `js/cloud-session.js`
- `js/cloud-session-guard.js`
- `supabase-stage6-auth-authority-test.html`
- `supabase/sql/03-stage6-main-cloud-auth.sql`
- `supabase/sql/03-stage6-link-user-profile-template.sql`
- `supabase/sql/03-stage6-verify.sql`

Edit Akun tetap Owner-only.


## Tahap 7 - Cloud Master Barang

Master Barang sekarang mempunyai backend `public.products` dengan UUID stabil, RLS, soft delete, dan Realtime.

`localStorage.dataBarang` masih dipertahankan sebagai compatibility cache untuk modul lama. Stok masih berupa `legacy_stock_snapshot` sampai tahap ledger stok atomic.

File utama:
- `js/products-service.js`
- `js/products-bootstrap.js`
- `supabase-stage7-products-migration.html`
- `supabase-stage7-realtime-test.html`
- `supabase/sql/04-stage7-products-cloud.sql`
- `supabase/sql/04-stage7-verify.sql`


### Multi User Profile

Tahap 7 memakai template multi-account untuk menghubungkan beberapa Supabase Auth user ke `public.profiles` sekaligus:

- `supabase/sql/04-stage7-link-multiple-user-profiles.sql`


## Tahap 8 - Cloud Transactions + Atomic Stock

Checkout Kasir sekarang menggunakan `ldm_complete_sale()`.
Transaksi, item, pengurangan stok, dan stock movement disimpan dalam satu PostgreSQL transaction.

File utama:
- `js/transactions-service.js`
- `supabase-stage8-transactions-stock-test.html`
- `supabase/sql/05-stage8-transactions-atomic-stock.sql`
- `supabase/sql/05-stage8-verify.sql`

Atomic stock saat ini berlaku untuk SALE Kasir. Inventory flow lain masih dimigrasikan bertahap.


## Tahap 9 - Cloud Absensi

Presensi sekarang memakai `public.attendance`, private Storage untuk foto, Realtime, dan server-side attendance guard untuk transaksi.

Shift tetap hanya label (`Shift 1`, `Shift 2`, `Full Day`). Shift Management tidak digunakan.

File utama:
- `js/attendance-service.js`
- `js/attendance-bootstrap.js`
- `supabase-stage9-attendance-migration.html`
- `supabase-stage9-attendance-test.html`
- `supabase/sql/06-stage9-cloud-attendance.sql`
- `supabase/sql/06-stage9-verify.sql`


## Tahap 10 - Cloud Retur & Stock Opname

Retur dan Stock Opname baru memakai Supabase sebagai authority. Retur approval/cancel dan Stock Opname approval/cancel mengubah `products.legacy_stock_snapshot` bersama `stock_movements` secara atomik. Histori legacy dapat dimigrasikan tanpa menerapkan stok ulang.


## Tahap 11 - Cloud Procurement

Supplier, Purchase Order, dan Goods Receipt sekarang memiliki cloud authority di Supabase. Goods Receipt Accepted memperbarui stok melalui atomic RPC dan ledger `stock_movements`. Legacy PO/GR dimigrasikan sebagai history-only.

File utama:
- `js/procurement-service.js`
- `js/procurement-bootstrap.js`
- `supabase-stage11-procurement-migration.html`
- `supabase-stage11-procurement-test.html`
- `supabase/sql/08-stage11-suppliers-po-goods-receipt.sql`
- `supabase/sql/08-stage11-verify.sql`


## Tahap 12 - Final Cloud Reporting

Tahap 12 menyelesaikan roadmap Live Sync utama dengan cloud authority untuk Closing Shift, End of Day, Laporan, Dashboard reporting, Pengeluaran, dan Mutasi Kas manual.

Tabel authority baru:
- `public.shift_closings`
- `public.end_of_day_closings`
- `public.operating_expenses`
- `public.legacy_transactions`

File utama:
- `js/reporting-service.js`
- `js/reporting-bootstrap.js`
- `supabase-stage12-reporting-migration.html`
- `supabase-stage12-reporting-test.html`
- `supabase/sql/09-stage12-closing-eod-reporting.sql`
- `supabase/sql/09-stage12-verify.sql`

Shift 1 / Shift 2 / Full Day tetap label saja. Shift Management tidak digunakan.


## Tahap 13 - Production Hardening

Tahap 12 menutup migrasi authority utama. Tahap 13 menambahkan production health check, append-only audit trail, Realtime audit, dan Owner-only Cloud Snapshot.

File utama:
- `cloud-control-center.html`
- `js/production-service.js`
- `supabase/sql/10-stage13-production-hardening.sql`
- `supabase/sql/10-stage13-verify.sql`
- `docs/TAHAP-13.md`

Backup/Restore localStorage lama sekarang diberi label sebagai compatibility cache, bukan cloud authority.


## Tahap 14 - Cloud Account Management

Account authority sekarang menggunakan Supabase Auth + `public.profiles`. Owner mengelola profile melalui `account-management.html`. Auth User baru tetap dibuat melalui Supabase Dashboard agar `service_role` tidak pernah masuk frontend. Password sendiri dan recovery email memakai Supabase Auth.


## Tahap 15
Cloud device groups, Owner approval/revoke, role-aware Akun Cloud, automatic Auth user creation/deletion through a server-side Supabase Edge Function, and account-management white-screen fix. Legacy PeerJS transfer on Dashboard has been removed.


## Tahap 16 - Offline Queue + Reconnect

Transaksi Kasir dapat disimpan sementara di IndexedDB ketika jaringan putus,
lalu diproses kembali melalui RPC idempotent setelah koneksi, Auth, store, dan
device aktif terverifikasi. Scope offline saat ini hanya SALE Kasir; operasi
akun, device, serta administrasi lainnya tetap wajib online.

File utama:
- `js/offline-queue.js`
- `service-worker.js`
- `supabase/sql/14-stage16-offline-queue-reconnect.sql`
- `supabase/sql/14-stage16-verify.sql`
- `docs/TAHAP-16.md`

## Tahap 17 - Sync Conflict & Recovery Center

Conflict dari reconnect kini dicatat per store di `public.sync_conflicts`.
Recovery Center menyediakan retry idempotent, permintaan retry lintas perangkat,
discard Owner-only dengan alasan dan audit, serta server guard agar queue yang
sudah dibatalkan tidak dapat dikirim ulang.

File utama:
- `recovery-center.html`
- `js/recovery-service.js`
- `supabase/sql/16-stage17-sync-conflict-recovery.sql`
- `supabase/sql/16-stage17-verify.sql`
- `supabase-stage17-recovery-test.html`
- `docs/TAHAP-17.md`

## Tahap 18 - PWA Installation & Safe Update

Aplikasi dapat dipasang sebagai PWA. Pembaruan Service Worker menunggu konfirmasi dan tidak diterapkan ketika antrean transaksi offline masih berisiko.

## Tahap 19 - Full QA, Security & Performance

Tahap 19 menambahkan panel diagnosis khusus Owner, audit statis Node.js, audit database baca-saja, hardening browser, dan pengukuran Core Web Vitals. Tahap ini juga memperbaiki aset lokal yang sebelumnya hilang dan menghentikan pembuatan akun lokal dengan password plaintext.

File utama:
- `qa-security-performance.html`
- `js/security-hardening.js`
- `js/qa-runtime.js`
- `tools/qa-stage19.mjs`
- `supabase/sql/15-stage19-full-qa-security-performance-audit.sql`
- `docs/TAHAP-19.md`

Jalankan audit frontend dengan `node tools/qa-stage19.mjs .`. Peringatan berbeda dari kegagalan: kegagalan harus dibereskan sebelum rilis, sedangkan peringatan perlu ditinjau dan dicatat.


## Patch 27.6.2 — Global Storage Quota Hardening

Baseline patch ini adalah **27.6.1 Payment Status Self-Healing**. Semua fitur payment,
license authority, multi-store, dan self-healing 27.6.1 dipertahankan.

Patch 27.6.2 menambahkan `js/storage-quota-guard.js` pada seluruh halaman, membatasi
compatibility cache laporan, melindungi data offline/pending agar tidak dipangkas
otomatis, dan memastikan transaksi cloud yang sudah COMMIT tidak berubah menjadi
status gagal hanya karena `localStorage` penuh.

Petunjuk lengkap: `docs/PATCH-27.6.2-STORAGE-QUOTA-HARDENING.md`.

## Patch 27.7.0 — IndexedDB & Persistent Storage

Patch 27.7.0 menambahkan Storage Engine berbasis IndexedDB (`locdailymar-storage-v27`),
migrasi otomatis snapshot data besar dari localStorage, Storage Health Monitor, verifikasi
IndexedDB, integrasi Persistent Storage, dan hardening transaksi offline ketika quota storage
benar-benar habis. Offline Queue Tahap 16 tetap memakai IndexedDB aslinya dan tidak diganti.

Patch ini tidak membutuhkan SQL Supabase baru. Petunjuk lengkap tersedia di
`docs/PATCH-27.7.0-INDEXEDDB-PERSISTENT-STORAGE.md`.

## Patch 27.7.1 — Transaction Archive Scaling & Full Report Export

Patch 27.7.1 memindahkan arsip laporan besar ke object store IndexedDB khusus `transactions`.
`localStorage` tetap menjadi compatibility cache maksimal 200 transaksi, sedangkan IndexedDB
menyimpan sampai **50.000 transaksi / 365 hari**. Refresh cloud memakai RPC pagination baru
sehingga aplikasi tidak perlu mengambil seluruh umur database setiap kali reporting refresh.

`laporan.html` sekarang memiliki tombol **Download Semua Laporan** yang mengambil seluruh
histori transaksi Supabase secara batch dan menghasilkan CSV UTF-8 yang dapat dibuka di
Excel atau Google Sheets. Histori cloud tidak dibatasi 50.000; angka tersebut hanya batas
arsip lokal per perangkat.

Patch ini membutuhkan SQL:
- `supabase/sql/27-stage27.7.1-report-archive-pagination.sql`
- `supabase/sql/27-stage27.7.1-verify.sql`

Dokumentasi lengkap: `docs/PATCH-27.7.1-TRANSACTION-ARCHIVE-EXPORT.md`.

## Patch 27.7.2 — Dashboard Reporting Authority

Dashboard Owner tidak lagi menjadikan `localStorage` 200 transaksi sebagai sumber akhir grafik. Data periode diambil dari Supabase Reporting dan fallback ke IndexedDB saat offline. Grafik rentang, ringkasan Owner, Top Selling, serta Statistik Penjualan Bulanan sekarang memakai dataset yang konsisten dengan halaman Laporan. Tidak ada SQL baru; patch memakai RPC pagination 27.7.1 yang sudah tersedia.

## Patch 27.8.0 — Midtrans Status, Cancel & Ganti Metode

Patch ini memperbaiki checkout yang tetap `pending` setelah pembayaran dan error
`Transaction doesn't exist` ketika order dibatalkan. Setiap pembuatan Snap token sekarang
mengirim URL webhook secara eksplisit, sedangkan halaman customer dan Developer Center
dapat merekonsiliasi status melalui Get Status API.

Pembatalan membedakan transaksi Core Midtrans dan sesi Snap. Jika customer belum memilih
metode, sesi Snap dibatalkan memakai `snap_token`. Jika transaksi sudah terbentuk dan masih
dapat dibatalkan, Core Cancel API dipakai. Lisensi purchase dan Store Code tetap disimpan
agar order baru dengan metode pembayaran lain dapat dibuat.

Jalankan migration:
- `license-authority-v2/supabase/migrations/20260902080000_ldm_midtrans_status_cancel_retry.sql`

Deploy ulang Edge Functions:
- `ldm-public-checkout-v2`
- `ldm-license-admin-v2`
- `ldm-midtrans-webhook`

Panduan lengkap: `PANDUAN-PERBAIKAN-MIDTRANS-27.8.0.txt`.

## Patch 27.8.1 — Developer Cek Status Midtrans

Patch ini memperbaiki pesan `Action admin tidak dikenal` saat developer menekan
`Cek Status Midtrans`. Backend menerima action kanonis `sync_payment_status` dan alias
kompatibilitas untuk deployment/frontend lama. Respons admin sekarang membawa versi API
agar ketidaksamaan antara halaman Developer Center dan Edge Function mudah didiagnosis.

Tidak ada SQL baru. Deploy ulang Edge Function `ldm-license-admin-v2` dari paket 27.8.1,
kemudian unggah frontend dan muat ulang aplikasi agar cache 27.8.0 diganti.

Panduan lengkap: `PANDUAN-PERBAIKAN-ADMIN-SYNC-27.8.1.txt`.

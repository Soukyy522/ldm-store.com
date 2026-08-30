# TAHAP 22 — Multi-Toko dan Transfer Stok

Versi: **22.0.0**  
Baseline: **TAHAP 21 — Promo & Harga Lanjutan**

## Tujuan

Tahap ini memungkinkan satu jaringan usaha memiliki beberapa Store ID. Setiap perangkat mempunyai toko aktif sendiri, sehingga perpindahan toko pada HP Owner tidak mengubah toko aktif komputer kasir lain.

## Cara kerja Store ID

- Toko utama tetap memakai Store ID lama.
- Cabang baru selalu mendapatkan UUID Store ID baru.
- Data produk, transaksi, stok, laporan, perangkat, dan akun dibatasi berdasarkan toko aktif.
- Owner dapat memiliki membership di beberapa toko.
- Admin/Kasir hanya memperoleh toko yang memang diberikan melalui membership/profile.

## Tabel baru

- `store_networks`: identitas jaringan usaha.
- `store_network_stores`: daftar cabang dalam jaringan.
- `store_memberships`: akses akun dan role pada setiap toko.
- `active_store_sessions`: toko aktif per akun dan perangkat.
- `stock_transfers`: header transfer.
- `stock_transfer_items`: rincian barang transfer.

## Status transfer

1. **DRAFT**: belum mengubah stok.
2. **IN_TRANSIT**: barang dikirim dan stok sumber sudah berkurang.
3. **RECEIVED**: barang diterima dan stok tujuan sudah bertambah.
4. **CANCELLED**: hanya draft yang dapat dibatalkan.

Transfer yang sudah dikirim tidak dapat dibatalkan langsung karena stok sumber sudah keluar. Jika terjadi kesalahan fisik setelah pengiriman, transfer harus diterima dahulu lalu dibuat transfer balik agar ledger stok tetap dapat diaudit.

## Persyaratan barang

Barang sumber dan tujuan harus memiliki barcode yang sama. Saat membuat cabang dengan opsi salin master barang:

- nama, barcode, kategori, satuan, harga, dan promo disalin;
- stok cabang selalu dimulai dari 0;
- riwayat transaksi toko utama tidak disalin.

## Instalasi

### 1. Backup

Cadangkan source aplikasi dan database sebelum menjalankan migration.

### 2. SQL utama

1. Buka Supabase Dashboard.
2. Pilih project LocDailyMar.
3. Buka **SQL Editor** → **New query**.
4. Salin seluruh isi `supabase/sql/19-stage22-multi-store-stock-transfer.sql`.
5. Tekan **Run**.
6. Pastikan tidak ada error.

SQL dibungkus transaksi. Jika salah satu proses gagal, perubahan pada eksekusi tersebut akan dibatalkan oleh PostgreSQL.

### 3. SQL verifikasi

Jalankan `supabase/sql/19-stage22-verify.sql`. Seluruh kolom `*_ok` harus `true`; query membership dan jaringan yang ditandai harus menghasilkan 0 baris.

### 4. Upload aplikasi

Unggah seluruh isi paket versi 22.0.0. File penting:

- `multi-store.html`
- `js/multi-store-service.js`
- `js/supabase-client.js`
- `js/global-system-navigation.js`
- `service-worker.js`

Jangan hanya mengunggah halaman `multi-store.html`. Header device pada `js/supabase-client.js` diperlukan agar RLS mengetahui toko aktif perangkat.

### 5. Update PWA

1. Pastikan Offline Queue kosong.
2. Buka **Aplikasi & Update**.
3. Periksa pembaruan.
4. Terapkan versi 22.0.0.
5. Tutup dan buka kembali aplikasi.

## Membuat cabang

1. Login sebagai Owner.
2. Buka **Multi-Toko & Transfer**.
3. Isi kode dan nama cabang.
4. Aktifkan **Salin master barang** jika diperlukan.
5. Tekan **Buat Cabang Baru**.

Perangkat Owner yang dipakai membuat cabang otomatis disetujui pada cabang tersebut untuk mencegah lockout.

## Berpindah toko

1. Pastikan perangkat online.
2. Pastikan Offline Queue kosong.
3. Buka daftar toko.
4. Tekan **Pindah ke Toko Ini**.
5. Setelah berhasil, aplikasi kembali ke Dashboard dengan toko aktif baru.

Cache kompatibilitas toko sebelumnya dibersihkan, tetapi IndexedDB Offline Queue tidak dihapus. Pergantian diblokir jika masih ada transaksi yang belum tersinkron.

## Membuat transfer stok

1. Aktifkan toko sumber.
2. Pilih toko tujuan.
3. Pilih barang dan isi qty.
4. Simpan sebagai Draft.
5. Periksa kembali rincian transfer.
6. Tekan **Kirim Stok**.
7. Stok sumber berkurang dan ledger mencatat `transfer_out`.
8. Pindah ke toko tujuan.
9. Tekan **Terima Stok**.
10. Stok tujuan bertambah dan ledger mencatat `transfer_in`.

## Role

| Aksi | Owner | Admin | Kasir |
| --- | :---: | :---: | :---: |
| Melihat toko yang dimiliki | Ya | Ya | Tidak ditampilkan |
| Membuat cabang | Ya | Tidak | Tidak |
| Pindah toko sesuai membership | Ya | Ya | Melalui kebijakan berikutnya |
| Membuat transfer | Ya | Ya | Tidak |
| Mengirim transfer | Ya | Ya | Tidak |
| Menerima transfer | Ya | Ya | Tidak |
| Membatalkan Draft | Ya | Ya | Tidak |

## Perlindungan

- Transfer hanya antar-toko dalam jaringan yang sama.
- Store ID tidak diambil dari localStorage sebagai otoritas.
- Role berasal dari `store_memberships` untuk toko aktif.
- Perangkat harus aktif pada toko tujuan.
- Pengiriman dan penerimaan berjalan dalam transaksi database atomik.
- Stok dikunci saat diperbarui untuk mencegah dua transfer memakai stok yang sama.
- Qty melebihi stok akan ditolak oleh server.
- Tabel transfer tidak dapat ditulis langsung dari browser.
- RLS membatasi data berdasarkan membership.

## Checklist pengujian

- [ ] Toko lama otomatis masuk jaringan.
- [ ] Akun lama memperoleh membership home store.
- [ ] Owner dapat membuat cabang.
- [ ] Cabang mendapatkan Store ID berbeda.
- [ ] Master barang tersalin dengan stok 0.
- [ ] Perangkat lain tidak ikut berubah ketika Owner pindah toko.
- [ ] Pergantian toko offline ditolak.
- [ ] Pergantian toko dengan antrean offline ditolak.
- [ ] Admin/Kasir tanpa membership tidak dapat membuka data cabang.
- [ ] Draft tidak mengubah stok.
- [ ] Kirim mengurangi stok sumber satu kali.
- [ ] Terima menambah stok tujuan satu kali.
- [ ] Qty melebihi stok ditolak tanpa perubahan sebagian.
- [ ] Barang tanpa pasangan barcode tujuan ditolak.
- [ ] Draft dapat dibatalkan.
- [ ] Transfer terkirim tidak dapat dibatalkan.
- [ ] Kartu stok mencatat `transfer_out` dan `transfer_in`.
- [ ] Realtime memperbarui riwayat transfer.

## Batas tahap

Tahap 22 menerima seluruh qty sekaligus. Penerimaan sebagian, barang rusak dalam perjalanan, permintaan transfer terpisah, dan approval bertingkat belum disertakan. Fitur tersebut dapat dibangun sebagai tahap lanjutan setelah alur dasar lulus pengujian operasional.

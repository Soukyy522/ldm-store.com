# TAHAP 21 — Promo & Harga Lanjutan

Versi: **21.0.0**  
Baseline: **LocDailyMar-TAHAP(2).zip** dari pengguna

## Tujuan

Tahap ini meningkatkan promo lama tanpa mengubah cara stok dan transaksi utama bekerja. Promo lama tetap terbaca sebagai `fixed_price`, sedangkan promo baru dapat menggunakan harga tetap atau persentase.

## Fitur

- Nama program promo per barang.
- Harga promo tetap, misalnya Rp3.000.
- Diskon persen, misalnya 10%.
- Minimal pembelian, misalnya minimal 10 Pcs.
- Tanggal mulai dan selesai.
- Pratinjau harga final, potongan, dan margin.
- Harga dihitung ulang ketika qty keranjang berubah.
- Draft keranjang lama memakai aturan promo terbaru ketika dipulihkan.
- Validasi database terhadap harga dan tanggal promo.
- Riwayat perubahan harga pada `public.product_pricing_history`.
- Kompatibel dengan promo lama.

## File penting

- `barang.html`
- `kasir.html`
- `js/promo-pricing.js`
- `js/products-service.js`
- `service-worker.js`
- `supabase/sql/18-stage21-promo-advanced-pricing.sql`
- `supabase/sql/18-stage21-verify.sql`

## Cara pemasangan

### 1. Cadangkan aplikasi dan database

Unduh source versi yang sedang digunakan dan buat backup database melalui menu backup yang tersedia. Jangan menghapus tabel lama.

### 2. Jalankan SQL migration

1. Masuk ke Supabase Dashboard.
2. Pilih project LocDailyMar yang benar.
3. Buka **SQL Editor**.
4. Pilih **New query**.
5. Salin seluruh isi `supabase/sql/18-stage21-promo-advanced-pricing.sql`.
6. Tekan **Run** satu kali.
7. Pastikan tidak ada pesan error.

Migration bersifat idempotent sehingga aman dijalankan kembali ketika eksekusi sebelumnya terputus. Jangan menjalankan file verify sebagai pengganti migration.

### 3. Jalankan SQL verifikasi

1. Buat query baru.
2. Salin isi `supabase/sql/18-stage21-verify.sql`.
3. Tekan **Run**.
4. Hasil kolom `*_ok` harus bernilai `true`.

Query ringkasan produk hanya menampilkan data jika SQL Editor menggunakan konteks pengguna aplikasi. Jika dijalankan sebagai administrator dan hasil data kosong, pemeriksaan struktur pada bagian pertama tetap dapat digunakan.

### 4. Unggah file aplikasi

Ganti file repository/hosting dengan seluruh isi paket versi 21.0.0. Pastikan file baru `js/promo-pricing.js` ikut diunggah. Jangan hanya mengganti `barang.html`, karena `kasir.html`, layanan produk, SQL, dan Service Worker harus menggunakan versi yang sama.

### 5. Bersihkan cache PWA secara aman

1. Buka **Aplikasi & Update**.
2. Pastikan antrean Offline Queue kosong.
3. Tekan pemeriksaan pembaruan.
4. Terapkan versi 21.0.0.
5. Tutup lalu buka kembali aplikasi.

Service Worker baru menggunakan cache `release21-promo-pricing-*`. Cache versi lama akan dibersihkan saat aktivasi tanpa menghapus localStorage atau IndexedDB transaksi.

## Cara menggunakan

1. Login sebagai **Owner**.
2. Buka **Data Barang**.
3. Pilih tombol **Promo** pada barang.
4. Aktifkan promo.
5. Isi nama promo.
6. Pilih **Harga promo tetap** atau **Diskon persen**.
7. Isi minimal pembelian.
8. Isi periode jika diperlukan.
9. Periksa pratinjau harga dan margin.
10. Tekan **Simpan Promo**.

### Contoh harga tetap

- Harga normal: Rp3.200
- Jenis: Harga promo tetap
- Harga promo: Rp3.000
- Minimal: 10 Pcs

Qty 1–9 menggunakan Rp3.200. Mulai qty 10, seluruh item pada baris tersebut menggunakan Rp3.000 per Pcs.

### Contoh diskon persen

- Harga normal: Rp20.000
- Jenis: Diskon persen
- Diskon: 10%
- Minimal: 1 Pcs

Harga final menjadi Rp18.000. Nilai ini dihitung kembali oleh database sebelum transaksi disimpan.

## Otoritas dan keamanan

- Owner mengubah promo melalui halaman Barang.
- Admin dan Kasir memakai harga yang sudah ditetapkan.
- Browser menghitung harga untuk tampilan cepat.
- `public.products.promo_price` menjadi harga final promo di server.
- `ldm_complete_sale()` tetap menghitung ulang harga dari database.
- Harga yang dikirim dari Developer Tools tidak menjadi otoritas transaksi.
- RLS lama pada `public.products` tetap berlaku.
- Riwayat harga hanya dapat dibaca Owner/Admin pada store yang sama.

## Checklist pengujian

- [ ] Promo lama masih muncul dan dapat digunakan.
- [ ] Harga tetap aktif pada tanggal yang benar.
- [ ] Diskon persen menghasilkan nominal yang benar.
- [ ] Qty di bawah minimum memakai harga normal.
- [ ] Qty mencapai minimum langsung mengubah harga keranjang.
- [ ] Qty diturunkan kembali memakai harga normal.
- [ ] Promo kedaluwarsa tidak diterapkan.
- [ ] Tanggal selesai sebelum tanggal mulai ditolak.
- [ ] Harga promo lebih tinggi dari harga normal ditolak.
- [ ] Struk menampilkan harga normal, potongan, dan harga final.
- [ ] Laporan mencatat total diskon.
- [ ] Transaksi online berhasil.
- [ ] Transaksi offline masuk antrean dan diverifikasi ulang ketika reconnect.
- [ ] Perangkat kedua menerima perubahan promo setelah Realtime refresh.

## Batas tahap ini

Satu produk mempunyai satu promo aktif. Bundling lintas produk, voucher/kode kupon, harga member, serta beli X gratis Y belum disertakan karena membutuhkan aturan keranjang, pencatatan diskon, retur, dan stok yang berbeda.

# TAHAP 20 — Master Satuan dan Konversi Kemasan

## Tujuan

Tahap 20 memisahkan **satuan dasar stok** dari **satuan beli supplier** tanpa
mengubah cara kerja transaksi lama. Kasir, retur, kartu stok, dan Stock Opname
tetap memakai satuan dasar. Purchase Order dan Goods Receipt memakai satuan
beli, kemudian server mengonversinya ke satuan dasar saat penerimaan diterima.

## Contoh cara kerja

Data Air Mineral:

- Satuan dasar: `Pcs`
- Satuan beli: `Dus`
- Isi per satuan beli: `24`
- Harga beli dasar: `Rp2.500 / Pcs`

Hasilnya:

- Data Barang menampilkan `1 Dus = 24 Pcs`.
- PO 10 Dus dikirim ke supplier sebagai `10 Dus`.
- Harga estimasi kemasan otomatis `24 × Rp2.500 = Rp60.000 / Dus`.
- Goods Receipt menerima 10 Dus.
- Server menambahkan stok `10 × 24 = 240 Pcs` secara atomik.
- Kasir tetap menjual dan memotong stok dalam Pcs.

Data Telur:

- Satuan dasar: `Kg`
- Satuan beli: `Kg`
- Isi per satuan beli: `1`
- Pesan WhatsApp PO menampilkan jumlah dalam `Kg`.

## Aturan keamanan data

1. `public.products.unit` tetap menjadi satuan dasar dan authority stok.
2. `purchase_unit` hanya mengatur satuan pembelian supplier.
3. `purchase_unit_factor` harus lebih besar dari nol.
4. PO dan GR menyimpan snapshot satuan/faktor agar perubahan produk berikutnya
   tidak mengubah dokumen yang sudah dibuat.
5. Qty yang dikirim ke RPC lama tetap qty dasar; trigger Tahap 20 menyimpan
   tampilan kemasan secara terpisah.
6. Barang lama otomatis memakai faktor `1`, sehingga tetap kompatibel.
7. Konversi tidak mengaktifkan histori harga beli berdasarkan periode.
8. `js/supabase-config.js` tidak diubah.

## File utama

- `js/unit-conversion.js`
- `barang.html`
- `Purchase-Order.html`
- `goods.receipt.html`
- `js/products-service.js`
- `js/procurement-service.js`
- `supabase/sql/17-stage20-unit-conversion.sql`
- `supabase/sql/17-stage20-verify.sql`
- `supabase-stage20-unit-test.html`

## Langkah instalasi

1. Cadangkan project dan database sebelum migrasi.
2. Buka Supabase Dashboard → SQL Editor.
3. Jalankan `supabase/sql/17-stage20-unit-conversion.sql` satu kali.
4. Jalankan `supabase/sql/17-stage20-verify.sql`.
5. Pastikan nilai `invalid_*` pada hasil verifikasi adalah `0`.
6. Upload seluruh file paket Tahap 20 ke hosting.
7. Buka PWA Settings dan lakukan update ketika offline queue sudah kosong.
8. Login sebagai Owner lalu buka `barang.html`.
9. Edit satu produk uji dan isi satuan beli serta faktor konversinya.
10. Buat PO, kirim WhatsApp, buat GR, lalu cocokkan penambahan stok.
11. Buka `supabase-stage20-unit-test.html` dan pastikan seluruh tes PASS.

## Checklist konfigurasi barang

- [ ] Satuan dasar dipilih sesuai stok dan penjualan.
- [ ] Satuan beli dipilih sesuai kemasan supplier.
- [ ] Isi per satuan beli lebih besar dari nol.
- [ ] Preview `1 kemasan = n satuan dasar` sudah benar.
- [ ] Harga beli di Data Barang adalah harga per satuan dasar.
- [ ] Barang lama yang belum diatur tetap mempunyai faktor 1.

## Checklist Purchase Order

- [ ] PO menampilkan stok dalam satuan dasar.
- [ ] Qty PO memakai satuan beli.
- [ ] Harga PO memakai harga per kemasan.
- [ ] Subtotal PO benar.
- [ ] WhatsApp menampilkan satuan beli.
- [ ] Telur tampil dalam Kg ketika master barang menggunakan Kg.
- [ ] PO Pending Approval tidak mempunyai tombol WhatsApp.
- [ ] PO Ordered/Partial mempunyai tombol WhatsApp.

## Checklist Goods Receipt

- [ ] GR dari PO memuat sisa qty dalam satuan beli.
- [ ] Penerimaan sebagian tidak melebihi sisa PO.
- [ ] Harga kemasan dikonversi menjadi harga dasar.
- [ ] Owner Accept menambah stok dasar secara atomik.
- [ ] Admin Pending tidak mengubah stok sebelum disetujui.
- [ ] Pembatalan GR mengurangi stok dasar dengan nilai yang sama.
- [ ] Qty PO Received diperbarui pada kemasan dan qty dasar.

## Checklist regresi

- [ ] Kasir dapat bertransaksi seperti sebelumnya.
- [ ] Promo tetap memakai qty satuan dasar.
- [ ] Retur mengembalikan stok dasar.
- [ ] Stock Opname menghitung satuan dasar.
- [ ] Kartu Stok mencatat quantity dasar.
- [ ] Offline Queue tetap idempotent.
- [ ] Recovery Center tetap dapat membaca konflik.
- [ ] Data antar-store tetap dipisahkan RLS.
- [ ] Owner/Admin/Kasir tetap mengikuti permission lama.
- [ ] Tidak ada secret key baru di frontend.

## Kriteria selesai

Tahap 20 dianggap selesai setelah satu produk faktor 1 dan satu produk faktor
lebih dari 1 berhasil melalui alur Barang → PO → WhatsApp → GR → stok, hasil
SQL verify tidak mempunyai data invalid, dan seluruh QA Tahap 19 tetap 0 FAIL.

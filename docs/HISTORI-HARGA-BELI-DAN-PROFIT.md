# Histori Harga Beli dan Profit Berdasarkan Tanggal

## Hasil yang diinginkan

Harga beli tidak dibaca ulang dari master barang ketika laporan dibuka. Setiap
item transaksi menyimpan snapshot harga beli yang berlaku pada waktu transaksi.

Contoh barang dijual Rp30.000 per unit:

| Tanggal | Harga beli berlaku | HPP 1 unit | Profit setelah HPP |
|---|---:|---:|---:|
| 26 | Rp24.200 | Rp24.200 | Rp5.800 |
| 27 | Rp24.200 | Rp24.200 | Rp5.800 |
| 28 | Rp23.700 | Rp23.700 | Rp6.300 |

Perubahan harga tanggal 28 tidak mengubah transaksi tanggal 26 atau 27.

## Cara memasang database

1. Masuk ke Supabase Dashboard untuk project LocDailyMar.
2. Buka **SQL Editor** lalu pilih **New query**.
3. Salin seluruh isi file
   `supabase/sql/17-stage20-historical-purchase-price-profit.sql`.
4. Jalankan query sampai muncul status sukses.
5. Buka query baru, salin isi `supabase/sql/17-stage20-verify.sql`, lalu jalankan.
6. Pastikan empat kolom hasil pertama bernilai `true` dan
   `products_without_price_history` bernilai `0`.
7. Upload/deploy file aplikasi terbaru, terutama `dashboard.html`.

Migrasi aman dijalankan ulang karena memakai `if not exists`, penggantian
function/trigger yang terarah, dan seed yang tidak menggandakan produk yang
sudah mempunyai histori.

## Kapan harga mulai berlaku?

- Edit harga beli dari halaman Barang: berlaku saat perubahan berhasil disimpan.
- Goods Receipt: berlaku saat penerimaan disetujui dan harga produk diperbarui.
- Purchase Order yang masih Draft/Ordered belum mengganti harga beli.
- Transaksi offline: memakai waktu asli ketika transaksi masuk antrean, bukan
  waktu ketika perangkat tersambung kembali.

## Rumus pada laporan

`HPP = jumlah terjual x snapshot harga beli`

`Profit setelah HPP = penjualan bersih setelah retur - HPP setelah retur`

Nilai ini belum mengurangi pengeluaran operasional seperti listrik, sewa, dan
gaji. Karena harga beli bersifat sensitif, kartu HPP dan Profit Setelah HPP hanya
ditampilkan pada `dashboard.html` untuk akun Owner. `laporan.html` tetap berisi
riwayat penjualan dan tidak menampilkan HPP atau profit.

## Catatan transaksi lama

Transaksi cloud yang dibuat sejak Tahap 8 sudah mempunyai
`cost_price_snapshot`, sehingga perubahan ini tidak menulis ulang histori lama.
Transaksi lokal sangat lama yang tidak pernah menyimpan `hargaBeli` akan terbaca
sebagai HPP Rp0; data tersebut tidak bisa direkonstruksi secara akurat hanya dari
harga produk saat ini.

# Patch 19.1.2 - Histori Harga Beli dan Profit Historis

## Tujuan

Perubahan Harga Beli tidak boleh mengubah HPP transaksi yang sudah terjadi. Transaksi cloud menggunakan `transaction_items.cost_price_snapshot` sebagai sumber HPP utama.

Patch ini menambahkan `public.purchase_price_history` untuk menyimpan setiap perubahan `products.purchase_price`. Dashboard Owner memakai urutan:

1. snapshot HPP item transaksi;
2. histori Harga Beli yang berlaku pada waktu transaksi;
3. harga master saat ini hanya sebagai fallback kompatibilitas untuk data legacy yang lebih tua dari fitur histori.

## Contoh

- 26-27: Harga Beli Rp24.200. Penjualan pada periode itu menyimpan HPP Rp24.200.
- 28: Harga Beli diubah menjadi Rp23.700. Penjualan setelah perubahan menyimpan HPP Rp23.700.
- Membuka Dashboard tanggal 26 tidak mengambil Rp23.700 dari Master Barang saat ini, tetapi tetap memakai snapshot Rp24.200.

## Catatan

Histori baru mulai direkam ketika SQL 19.1.2 dipasang. Harga historis sebelum fitur ini tidak direkonstruksi secara fiktif. Untuk transaksi cloud lama, snapshot `cost_price_snapshot` yang sudah ada tetap memberikan HPP historis yang benar.

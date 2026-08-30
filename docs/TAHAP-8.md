# Tahap 8 - Cloud Transactions + Atomic Stock

## Yang menjadi cloud authority

- `public.transactions`
- `public.transaction_items`
- `public.stock_movements`
- sale stock snapshot pada `public.products.legacy_stock_snapshot`

## Atomic checkout

`kasir.html` tidak lagi memotong stok dengan JavaScript lokal.

Checkout memanggil `ldm_complete_sale()` dan PostgreSQL melakukan satu transaksi:

1. validasi Auth/profile/store
2. lock product rows
3. hitung harga dari `public.products`
4. validasi promo
5. validasi stok
6. insert transaction
7. insert transaction_items
8. update stock snapshot
9. append stock_movements
10. commit

Jika salah satu gagal, PostgreSQL rollback seluruh operasi.

## Idempotency

Setiap checkout mempunyai `client_transaction_id` UUID. Request yang sama tidak memotong stok dua kali.

## Price authority

Harga transaksi dihitung ulang di server dari `public.products`. Harga browser tidak dijadikan sumber otoritatif.

## Compatibility

Setelah cloud commit berhasil, transaksi masih ditulis ke `laporan` / `dataLaporan` lokal agar halaman lama dan struk tetap bekerja.

Laporan lintas device penuh belum dipindahkan pada Tahap 8. Backend transaksi sudah centralized dan dapat diperiksa melalui `supabase-stage8-transactions-stock-test.html`.

## Inventory transition

Atomic stock pada Tahap 8 berlaku untuk SALE kasir.

Goods Receipt, Stock Opname, dan Retur masih akan dimigrasikan pada tahap berikutnya. Jangan memakai modul-modul tersebut sebagai pengujian final multi-device stock sebelum migrasinya selesai.

## Void

`ldm_void_sale()` sudah tersedia dan Owner-only. RPC mengembalikan stok dan menulis `sale_void`, tetapi tombol hapus Laporan legacy belum dihubungkan ke RPC ini pada Tahap 8.

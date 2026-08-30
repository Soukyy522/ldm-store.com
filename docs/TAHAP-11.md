# Tahap 11 - Cloud Supplier, Purchase Order & Goods Receipt

## Cloud authority

- `public.suppliers`
- `public.purchase_orders`
- `public.purchase_order_items`
- `public.goods_receipts`
- `public.goods_receipt_items`
- `public.stock_movements` tetap ledger stok atomik.

## Supplier

Master Supplier sekarang memiliki UUID cloud stabil dan scoped per `store_id`. Owner/Admin dapat membuat dan mengubah Supplier melalui RPC. Hanya Owner yang dapat soft-delete. Supplier yang sudah dipakai histori pembelian tidak boleh dihapus, hanya dinonaktifkan.

## Purchase Order

Admin mengajukan PO sebagai `PendingApproval`. Owner dapat Accept menjadi `Ordered`. PO yang sudah menerima sebagian barang menjadi `Partial`, dan setelah seluruh qty diterima menjadi `Received`.

## Goods Receipt

Admin membuat Goods Receipt `PendingApproval`; stok belum berubah. Owner dapat Accept. Owner yang membuat Goods Receipt sendiri dapat langsung `Accepted`.

Penerimaan stok dilakukan di PostgreSQL dalam satu transaksi:

1. validasi supplier dan produk,
2. validasi sisa qty PO,
3. lock produk,
4. tambah stok `products.legacy_stock_snapshot`,
5. update `purchase_price` dan `last_expiry_date`,
6. insert `stock_movements` tipe `goods_receipt`,
7. update qty received PO,
8. update status PO.

Jika satu langkah gagal, seluruh proses rollback.

## Pending reservation

Goods Receipt Pending dari PO ikut mereservasi qty. Device lain tidak dapat membuat penerimaan melebihi sisa PO yang sebenarnya.

## Cancel Goods Receipt

Owner dapat membatalkan Goods Receipt. Jika receipt sebelumnya sudah Accepted, server mencoba membalik stok atomik dan menulis movement `goods_receipt_cancel`. Bila stok terkini lebih kecil daripada qty yang harus dibalik, pembatalan ditolak agar stok tidak menjadi negatif.

## Legacy migration

`dataSupplier`, `dataPurchaseOrder`, dan `dataGoodsReceipt` lama dapat dimigrasikan melalui halaman Tahap 11.

PO/GR legacy ditandai `history_only=true`. Goods Receipt legacy **tidak menerapkan stock effect ulang**, untuk mencegah stok bertambah dua kali.

## Cache kompatibilitas

Setelah cloud aktif:

- `dataSupplier` = cache
- `dataPurchaseOrder` = cache
- `dataGoodsReceipt` = cache

## Realtime

Realtime aktif untuk Supplier, PO, PO Items, Goods Receipt, dan Goods Receipt Items.

## Shift

Tidak ada Shift Management pada Tahap 11.

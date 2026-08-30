# Tahap 10 - Cloud Retur & Stock Opname

## Cloud authority

- `public.sales_returns`
- `public.sales_return_items`
- `public.cash_movements`
- `public.stock_opname_entries`
- `public.stock_movements` tetap ledger inventori atomik.

## Retur

Retur baru hanya memakai transaksi cloud Tahap 8+. PENDING mereservasi qty supaya dua device tidak dapat over-return. Approval Owner mengubah stok dan refund secara atomik. Cancel approved membalik stok melalui `return_cancel`.

## Stock Opname

Pending Stock Opname menyimpan `difference_snapshot`. Saat Owner approve, delta tersebut diterapkan ke stok cloud terbaru. Sistem tidak menimpa stok dengan angka fisik lama setelah transaksi lain terjadi.

## Legacy

Migrasi `dataRetur` dan `dataStockOpname` lama adalah history-only dan tidak menerapkan stock effect ulang.

## Shift

Tidak ada Shift Management. `refund_shift_label` berasal dari Absensi cloud dan hanya berupa label.

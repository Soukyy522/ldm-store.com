# Tahap 12 - Final Cloud Reporting Authority

## Tujuan

Tahap 12 memindahkan authority terakhir yang masih bergantung pada cache browser ke Supabase:

- Closing Shift
- End of Day
- Laporan transaksi lintas perangkat
- Pengeluaran operasional
- Mutasi Kas manual Closing
- Dashboard reporting

LocalStorage tetap dipertahankan sebagai compatibility cache untuk UI lama, tetapi bukan sumber data resmi.

## Authority

### Tabel baru

- `public.shift_closings`
- `public.end_of_day_closings`
- `public.operating_expenses`
- `public.legacy_transactions`

### Tabel cloud sebelumnya yang dipakai

- `public.transactions`
- `public.transaction_items`
- `public.sales_returns`
- `public.sales_return_items`
- `public.cash_movements`
- `public.products`
- `public.stock_movements`
- `public.attendance`

## Closing Shift

Owner/Admin melakukan Closing melalui RPC `ldm_finalize_shift_closing`.

Server menghitung ulang:

- penjualan kotor
- retur approved
- penjualan net
- tunai
- non-tunai
- kas masuk
- kas keluar
- expected cash
- physical cash
- selisih

Angka transaksi dari browser tidak dipercaya sebagai authority.

Closing FINAL mengunci transaksi/mutasi finansial untuk akun + tanggal + shift tersebut.

Owner dapat VOID Closing selama EOD tanggal tersebut belum FINAL.

## End of Day

Owner/Admin dapat finalisasi EOD melalui `ldm_finalize_end_of_day`.

Server memeriksa:

- Shift 1 tersedia
- Shift 2 tersedia
- semua kasir yang mempunyai transaksi sudah Closing
- belum ada EOD FINAL hari itu

Full Day bersifat tambahan. Jika user yang sama juga mempunyai Shift 1/2, Full Day tidak dihitung dua kali.

EOD menyimpan snapshot biaya operasional cloud pada tanggal tersebut.

## Financial period lock

Setelah Closing FINAL:

- transaksi baru pada akun/shift tersebut ditolak
- Mutasi Kas baru ditolak
- perubahan Retur APPROVED yang mengubah hasil Closing ditolak
- void transaksi ditolak

Setelah EOD FINAL:

- transaksi tanggal tersebut ditolak
- Retur yang mengubah financial result ditolak
- Pengeluaran tanggal tersebut tidak dapat ditambah/dihapus
- void transaksi ditolak
- Closing tidak dapat di-void

## Laporan Cloud

Transaksi Tahap 8+ dibaca langsung dari `public.transactions` + `public.transaction_items`.

Void transaksi dilakukan melalui `ldm_reporting_void_sale` agar server memeriksa Retur, Closing, dan EOD sebelum membalik stok.

Bulk reset laporan dinonaktifkan. Audit finansial tidak lagi boleh dihapus dengan sekadar mengosongkan localStorage.

## Legacy transaction history

Transaksi lama sebelum Tahap 8 dapat dipindahkan ke `public.legacy_transactions` sebagai HISTORY ONLY.

Migrasi ini tidak menerapkan stok ulang.

## Pengeluaran

`public.operating_expenses` menjadi authority untuk Dashboard dan `pengeluaran.html`.

Foto Nota disimpan pada bucket private:

`ldm-expense-receipts`

Database hanya menyimpan `receipt_path`; UI menggunakan signed URL sementara.

## Cache compatibility

Setelah migrasi selesai:

- `laporan` / `dataLaporan` / `riwayatTransaksi` / `laporanHistory` = cache cloud
- `shiftClosingLog` / `shiftClosingDailyLogs` = cache cloud
- `endOfDayLog` = cache cloud
- `operasional` = cache cloud
- `mutasiKasShift` = cache cloud

## Realtime

Reporting service memantau perubahan pada:

- transactions
- transaction_items
- sales_returns
- sales_return_items
- cash_movements
- shift_closings
- end_of_day_closings
- operating_expenses
- legacy_transactions

Perubahan memicu refresh compatibility cache lintas perangkat.

## Shift

Tetap tidak ada Shift Management.

`Shift 1`, `Shift 2`, dan `Full Day` hanya merupakan `shift_label` yang berasal dari alur Absensi dan transaksi.

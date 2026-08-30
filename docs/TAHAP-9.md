# Tahap 9 - Cloud Absensi

## Authority

Presensi resmi berada di `public.attendance`.

`localStorage.dataAbsensi` tetap dipakai sebagai compatibility cache agar halaman lama dan modul yang membaca Absensi tidak langsung rusak.

## Tidak ada Shift Management

`Shift 1`, `Shift 2`, dan `Full Day` hanya disimpan sebagai `shift_label` pada record presensi.

Tidak ada:
- `shift_sessions`
- active shift session
- Shift ID
- Shift state machine

## Bukti foto

Selfie Masuk/Keluar dan foto surat Sakit/Izin disimpan di bucket private:

`ldm-attendance-proofs`

Database hanya menyimpan `proof_path`. UI membuat signed URL sementara ketika perlu menampilkan foto.

## Permissions

- Owner: melihat seluruh history store, record untuk user lain, soft delete
- Admin/Kasir: histori table hanya milik sendiri
- Semua user dapat melihat status presensi hari ini melalui RPC summary
- Non-owner hanya dapat membuat presensi untuk dirinya sendiri

## Transaction guard

Transaksi baru setelah Tahap 9 otomatis mengisi `transactions.attendance_id` dan database menolak checkout jika:

- belum Absen Masuk cloud hari itu, atau
- sudah Absen Keluar

Transaksi Tahap 8 yang sudah ada boleh mempunyai `attendance_id = NULL`.

## Legacy migration

Gunakan `supabase-stage9-attendance-migration.html` sebagai Owner dari perangkat yang mempunyai dataAbsensi paling lengkap.

Foto Base64 lama akan dipindahkan ke Storage bila tersedia.

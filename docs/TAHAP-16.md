# Tahap 16 - Offline Queue + Reconnect

Tahap 16 mengaktifkan mode offline terbatas untuk transaksi pada `kasir.html`.
Transaksi yang tidak dapat mencapai Supabase disimpan ke IndexedDB perangkat,
lalu disinkronkan otomatis ketika koneksi, sesi Auth, dan status device kembali
valid.

## Ruang lingkup

- Didukung offline: transaksi penjualan Kasir.
- Tetap wajib online: akun, reaktivasi akun, role, approval/revoke device,
  perubahan Master Barang, retur, stock opname approval, procurement, dan EOD.
- Laporan localStorage menerima transaksi sementara dengan status
  `pending_sync`, lalu diperbarui menggunakan hasil cloud setelah reconnect.

## Perlindungan utama

1. IndexedDB mempertahankan antrean melewati refresh atau browser ditutup.
2. Setiap transaksi memakai `client_transaction_id` UUID yang sama pada setiap
   retry; unique index Tahap 8 mencegah pemotongan stok dua kali.
3. RPC `ldm_sync_offline_sale()` memeriksa user, store, device aktif, role,
   umur antrean, dan waktu perangkat.
4. Harga/promo dihitung ulang oleh `ldm_complete_sale()`. Perbedaan total lokal
   dan server menghasilkan `conflict` serta rollback penuh.
5. Stok cloud hanya berubah ketika RPC berhasil commit. Selama offline, cache
   stok perangkat dikurangi sebagai reservasi lokal.
6. Antrean tidak dapat disinkronkan oleh akun, store, atau perangkat lain.
7. Absensi, `transacted_at`, dan `business_date` divalidasi berdasarkan waktu
   antrean. Closing Shift/EOD yang sudah FINAL tetap memblokir commit.

## Offline lease

Perangkat harus pernah membuka Kasir ketika online dan berstatus `active`.
Hasil verifikasi disimpan sebagai lease maksimal 12 jam. Lease tidak menyimpan
service-role key atau password. Setelah 12 jam, perangkat wajib online untuk
verifikasi ulang sebelum transaksi offline baru dapat dibuat.

## Status antrean

- `pending`: menunggu koneksi/retry.
- `syncing`: sedang dikirim.
- `synced`: sudah commit di cloud.
- `conflict`: harga/promo/stok berbeda dan perlu pemeriksaan.
- `blocked`: akun, store, sesi, atau perangkat tidak valid.
- `failed`: kesalahan non-jaringan yang perlu dicoba ulang setelah diperiksa.

## Berkas utama

- `js/offline-queue.js`
- `service-worker.js`
- `js/transactions-service.js`
- `js/products-service.js`
- `js/cloud-session.js`
- `js/cloud-session-guard.js`
- `kasir.html`
- `supabase/sql/14-stage16-offline-queue-reconnect.sql`
- `supabase/sql/14-stage16-verify.sql`
- `supabase-stage16-offline-queue-test.html`

## Batasan yang disengaja

Offline bukan berarti data langsung tersedia secara global. Sampai statusnya
`synced`, transaksi hanya berada di perangkat pembuatnya. Data global tetap
dibatasi `store_id`. Jangan menghapus data situs/browser ketika masih ada
antrean karena IndexedDB akan ikut terhapus.

# TAHAP 17 — Sync Conflict & Recovery Center

## Tujuan

TAHAP 16 sudah dapat menyimpan transaksi Kasir saat offline dan melakukan retry idempotent ketika internet kembali. TAHAP 17 menambahkan pusat penanganan ketika retry tidak dapat diselesaikan karena stok, harga/promo, absensi/closing, perangkat, sesi, atau error non-jaringan lainnya.

## Alur

1. Queue tetap disimpan di IndexedDB perangkat sumber.
2. Error jaringan tetap berstatus `pending` dan menggunakan backoff; tidak dibuat menjadi conflict cloud.
3. `conflict`, `blocked`, dan `failed` dicatat melalui RPC ke `public.sync_conflicts`.
4. Cloud hanya menyimpan digest payload dan ringkasan operasional, bukan password, token, atau seluruh keranjang.
5. Owner/Admin dapat melihat conflict satu store; Kasir hanya miliknya melalui RLS.
6. Retry tetap menggunakan `client_transaction_id` asli sehingga tidak memotong stok dua kali.
7. Discard hanya Owner, membutuhkan alasan, masuk `audit_events`, dan memicu server guard.
8. Perangkat sumber menerima `retry_requested` melalui Realtime saat Kasir/Recovery Center terbuka.
9. Conflict menjadi `resolved` hanya jika transaksi dengan ID client yang sama benar-benar tersedia di cloud.

## Status

- `open`: membutuhkan pemeriksaan.
- `retry_requested`: server/Owner meminta perangkat sumber mencoba lagi.
- `resolved`: transaksi sudah tersimpan di cloud.
- `discarded`: dibatalkan Owner; retry berikutnya ditolak server.

## Hak akses

| Aksi | Owner | Admin | Kasir |
|---|---:|---:|---:|
| Melihat seluruh conflict store | Ya | Ya | Tidak |
| Melihat conflict sendiri | Ya | Ya | Ya |
| Meminta retry | Ya | Ya | Ya, milik sendiri |
| Discard | Ya | Tidak | Tidak |
| Reopen conflict discarded | Ya | Tidak | Tidak |

## File utama

- `recovery-center.html`
- `js/recovery-service.js`
- `js/offline-queue.js`
- `supabase/sql/16-stage17-sync-conflict-recovery.sql`
- `supabase/sql/16-stage17-verify.sql`
- `supabase-stage17-recovery-test.html`

## Prinsip keamanan

RLS aktif pada tabel conflict. Mutasi hanya melalui fungsi dengan grant minimum, pemeriksaan `auth.uid()`, store, role, dan device. Fungsi `security definer` menggunakan search path kosong serta nama schema eksplisit. Realtime tetap mengikuti hak SELECT RLS pengguna.

# LocDailyMar 27.3.0 — Hasil Lisensi Langsung di Web

## Perubahan utama
- Resend dan WhatsApp Cloud API tidak lagi digunakan untuk pengiriman kredensial pembelian.
- Setelah Midtrans webhook memverifikasi pembayaran, `license.html` menampilkan License Key, Store Code, Store UUID, Network ID, masa berlaku, email Owner, dan paket.
- License Key tetap dibuat server-side, disimpan hash + ciphertext AES-GCM, dan tidak diberikan sebelum payment `paid`.
- Endpoint status tetap dilindungi `order_id` + status token acak yang hanya disimpan hash-nya di server.
- License Key mentah tidak disimpan di localStorage. LocalStorage hanya menyimpan order ID dan status token.
- Customer mendapat peringatan besar untuk screenshot serta tombol Salin Semua Data dan Salin License Key.
- Tombol Gunakan untuk Aktivasi otomatis mengisi Store Code + License Key ke form aktivasi.
- Jika Cloud provisioning aktif, halaman sukses menampilkan tombol Buat/Ganti Password Owner.
- Webhook tidak pernah mengembalikan License Key ke Midtrans.

## Deploy
Tidak ada migrasi SQL baru jika SQL 27.2 sudah terpasang. Deploy ulang:
```bash
npx supabase@latest functions deploy ldm-public-checkout-v2 --use-api
npx supabase@latest functions deploy ldm-midtrans-webhook --use-api
```
Lalu upload frontend 27.3.0 dan hard refresh/update PWA.

## Secrets yang tetap diperlukan
- MIDTRANS_SERVER_KEY
- MIDTRANS_CLIENT_KEY
- MIDTRANS_IS_PRODUCTION
- MIDTRANS_FINISH_URL
- LDM2_CHECKOUT_ALLOWED_ORIGINS
- LDM_CHECKOUT_ENCRYPTION_SECRET
- LDM_APP_SUPABASE_URL
- LDM_APP_SERVICE_ROLE_KEY
- LDM_APP_PUBLIC_URL
- LDM_GUIDE_URL

Secrets Resend/WhatsApp tidak diperlukan lagi.

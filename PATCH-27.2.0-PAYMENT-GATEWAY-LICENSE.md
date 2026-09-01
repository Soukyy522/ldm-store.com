# LocDailyMar 27.2.0 — Payment Gateway Langsung di License

## Ringkasan
Versi 27.2 memindahkan alur pembelian lisensi customer langsung ke `license.html` menggunakan Midtrans Snap. Customer memilih paket, mengisi identitas toko, membuka metode pembayaran, lalu webhook memverifikasi pembayaran dan mengaktifkan lisensi otomatis.

## Alur customer
1. Pilih paket dan periode.
2. Isi Nama Customer, Nama Toko, WhatsApp, Email Owner, Store Code, dan periode.
3. Server memvalidasi harga resmi serta Store Code.
4. Server membuat License Key, Store UUID, Network ID dan order pending tanpa mengirim raw License Key ke browser.
5. Midtrans Snap menampilkan channel pembayaran yang aktif pada merchant.
6. Midtrans mengirim webhook setelah status berubah.
7. Webhook memverifikasi signature dan GET Status API.
8. Lisensi diaktifkan.
9. Bila Cloud App secrets tersedia, Owner + Store + Network diprovision otomatis.
10. License Key + Store Code + Store UUID + Network ID + panduan dikirim melalui Email dan WhatsApp.

## File utama
- `license.html`
- `js/license-checkout-v2.js`
- `js/license-v2-config.js`
- `service-worker.js`
- `license-authority-v2/supabase/functions/ldm-public-checkout-v2/index.ts`
- `license-authority-v2/supabase/functions/ldm-midtrans-webhook/index.ts`
- `license-authority-v2/supabase/functions/_shared/ldm-license-delivery.ts`
- `license-authority-v2/SQL-09-PUBLIC-CHECKOUT-EMAIL-WHATSAPP.sql`
- `license-authority-v2/SQL-10-VERIFY-PUBLIC-CHECKOUT-27.2.sql`

## Keamanan
- Nominal ditentukan server dari `ldm2_plans`.
- Midtrans Server Key tidak berada di frontend.
- Raw License Key tidak pernah dikirim ke browser sebelum maupun sesudah pembayaran.
- Raw key hanya disimpan sementara sebagai ciphertext AES-GCM untuk kebutuhan delivery; aktivasi memakai hash.
- Public checkout diberi rate limit sederhana.
- Status order memakai token acak yang hanya disimpan sebagai hash.
- Webhook melakukan verifikasi signature Midtrans dan Status API.
- Delivery Email/WhatsApp retryable dan tidak membatalkan lisensi yang sudah dibayar.
- Jika Cloud App provisioning dikonfigurasi, Store Code dan email Owner diperiksa sebelum pembayaran untuk mengurangi konflik identitas.

## Catatan deploy
Baca `PANDUAN-PAYMENT-GATEWAY-LICENSE-27.2.txt` sebelum deploy. Gunakan Sandbox Midtrans terlebih dahulu sebelum Production.

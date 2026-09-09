# LOCDAILYMAR — CHATGPT CHECKPOINT

> **BACA FILE INI TERLEBIH DAHULU** jika ZIP ini dibuka pada percakapan ChatGPT baru.

## Baseline aktif
- Produk: **LocDailyMar**
- App version: **27.9.0**
- Build aktif: **V28.3.6**
- Nama build: **License Delivery Origin Hardening**
- Production origin: **https://locdaily.github.io**
- Public app URL: **https://locdaily.github.io**
- Baseline sebelumnya: **V28.3.5**
- Baseline berikutnya wajib memakai ZIP V28.3.6 ini kecuali user mengunggah build yang lebih baru.

## Arsitektur
### Frontend publik
GitHub Pages hanya membutuhkan file frontend statis:
- root `*.html`
- `js/`
- `css/`
- `assets/`
- `manifest.json`
- `service-worker.js`
- `.nojekyll`

### App Supabase
Project App Supabase menyimpan data toko/customer dan Supabase Auth.
- Frontend publishable key boleh berada di browser.
- `service_role`, database password, provider secret, token webhook, dan private key tidak boleh berada di GitHub Pages.

### License Authority Supabase
Project ref: `vplweadbeujidsoponrl`

Browser-facing:
- `ldm-license-v2`
- `ldm-license-admin-v2`
- `ldm-public-checkout-v2`
- `ldm-lynk-order`
- `ldm-public-contact`

Server-to-server / delivery:
- `ldm-lynk-webhook`
- `ldm-resend-test`

## Origin production yang wajib
- `LDM2_ALLOWED_ORIGINS=https://locdaily.github.io`
- `LDM2_CHECKOUT_ALLOWED_ORIGINS=https://locdaily.github.io`
- `LDM2_ADMIN_ALLOWED_ORIGINS=https://locdaily.github.io`
- `LDM2_PUBLIC_CONTACT_ALLOWED_ORIGINS=https://locdaily.github.io`
- `LDM2_ALLOW_NULL_ORIGIN=false`
- `LDM2_PUBLIC_CONTACT_ALLOW_NULL_ORIGIN=false`
- `LDM_APP_PUBLIC_URL=https://locdaily.github.io`
- `LDM_PUBLIC_APP_URL=https://locdaily.github.io`
- `LDM_GUIDE_URL=https://locdaily.github.io/panduan.html`

Gunakan `DEPLOY-GITHUB-ORIGIN-V28.3.6.cmd` dari paket maintenance.

## Supabase Authentication
Pada **App Supabase → Authentication → URL Configuration**:
- Site URL: `https://locdaily.github.io`
- Redirect URL: `https://locdaily.github.io/account-password-reset.html`

## Serah-terima lisensi V28.3.6
Setelah pembayaran Lynk.id menjadi PAID:
1. License Authority memproses payment dan provisioning Owner.
2. Customer dapat membuka receipt aman di `license.html`.
3. Receipt mengembalikan License Key, Store Code, Store UUID, Network ID, login URL, guide URL, dan bila perlu password setup URL.
4. Email transactional dikirim melalui Resend bila Resend production aktif.
5. Link login harus menuju `https://locdaily.github.io/index.html`.
6. Link panduan harus menuju `https://locdaily.github.io/panduan.html`.
7. Recovery/password setup menggunakan redirect `https://locdaily.github.io/account-password-reset.html`.
8. **Automatic WhatsApp license delivery belum aktif** pada build ini. Status delivery WhatsApp tetap `not_configured`; WhatsApp yang ada di frontend dipakai untuk support/manual flow.

### Hardening baru
`_shared/ldm-license-delivery.ts` tidak lagi percaya mentah-mentah pada `LDM_APP_PUBLIC_URL`.
- URL publik harus HTTPS.
- Origin harus termasuk trusted/current origin.
- Origin legacy yang diketahui ditolak.
- Bila secret URL kosong/salah/masih legacy, delivery fallback ke `https://locdaily.github.io`.
- `LDM_GUIDE_URL` juga divalidasi.
- Runtime health menampilkan resolved delivery origin tanpa membocorkan secret.

Frontend `license-checkout-v2.js` juga memvalidasi link Login/Panduan pada receipt dan fallback ke current public app URL bila backend mengembalikan origin yang tidak sesuai.

## Bug checkout yang ikut diperbaiki
Pada V28.3.5 terdapat `r is not defined` saat membuka panel checkout karena event receipt dipanggil di `open()` sebelum object receipt tersedia.
V28.3.6 memindahkan event `ldm-paid-receipt-ready` ke `renderReceipt(r)` setelah receipt benar-benar tersedia.

## Aturan bila origin/domain berubah lagi
Baca `ORIGIN-CHANGE-CHECKLIST-V28.3.6.md`. Minimum:
1. Ubah CORS secrets License Authority.
2. Ubah `LDM_APP_PUBLIC_URL`, `LDM_PUBLIC_APP_URL`, `LDM_GUIDE_URL`.
3. Ubah App Supabase Auth Site URL + Redirect URL.
4. Update frontend public app URL.
5. Update Return/Success URL provider pembayaran bila provider menyimpannya.
6. Redeploy Edge Functions yang membundel `_shared/ldm-license-delivery.ts`, termasuk webhook.
7. Bump Service Worker/PWA cache.
8. Uji order baru hingga PAID, receipt, email, login, panduan, reset password.
9. Audit secret dan repository public.
10. Update checkpoint.

## Security audit
V28.3.6 tidak menambahkan secret baru. Baseline V28.3.5 sudah memisahkan:
- **GITHUB-PAGES-PRODUCTION** untuk repository publik.
- **MAINTENANCE-SOURCE-PRIVATE** untuk SQL, Edge Functions, tools, dan source backend.

Publishable key Supabase frontend dipertahankan karena memang browser-safe bila RLS dan server authorization benar.

Catatan: audit working tree tidak memeriksa Git history. Secret yang pernah ter-commit tetap harus dirotasi dan histori dibersihkan.

## Aturan revisi berikutnya
Setiap update LocDailyMar:
1. Mulai dari baseline terbaru user.
2. Audit origin/CORS/callback/redirect/public URL.
3. Audit alur checkout dan license delivery.
4. Audit secret/credential.
5. Cleanup file superseded/test/duplikat.
6. Update checkpoint.
7. Bump Service Worker/PWA cache bila frontend berubah.
8. Jalankan syntax check + local reference audit sebelum ZIP.

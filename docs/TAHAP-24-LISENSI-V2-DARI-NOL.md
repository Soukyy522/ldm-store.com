# TAHAP 24 — Lisensi V2 dari Nol

Versi aplikasi: **24.0.0**  
Baseline: paket bersih LocDailyMar 22.2 yang diberikan pengguna.

Sistem lama tidak digunakan. Versi ini tidak memakai JWK, signature browser, atau watchdog. Pemeriksaan mempunyai timeout 8 detik dan selalu menampilkan panel kesalahan yang dapat dicoba ulang, sehingga halaman tidak berubah menjadi putih atau loading tanpa akhir.

## 1. Arsitektur yang digunakan

Gunakan dua project Supabase yang berbeda:

1. **Project Cloud Aplikasi Customer** — menyimpan akun Owner/Admin/Kasir, toko, barang, transaksi, laporan, dan stok.
2. **Project License Authority Developer** — hanya Anda sebagai developer yang menguasainya. Project ini menyimpan paket, lisensi, trial, perangkat lisensi, dan audit developer.

Customer tidak diberikan akses Dashboard project License Authority. Browser customer hanya memanggil Edge Function publik yang melakukan validasi di server. `service_role` tidak pernah diletakkan pada file HTML/JavaScript.

## 2. Paket, harga, dan kuota

| Paket | Harga | Device | Toko | Masa aktif |
|---|---:|---:|---:|---|
| Warung Kecil | Rp29.000/bulan atau Rp299.000/tahun | 2 | 1 | Bulanan/tahunan |
| Warung Sederhana | Rp59.000/bulan atau Rp599.000/tahun | 3 | 1 | Bulanan/tahunan |
| Toko | Rp99.000/bulan atau Rp999.000/tahun | 10 | 5 | Bulanan/tahunan |
| Lifetime | Rp3.499.000 sekali bayar | 15 | 8 | Tanpa kedaluwarsa |

Harga dapat diedit pada `js/license-v2-config.js`, `license-v2.html`, dan baris paket pada SQL instalasi. Ketiganya harus tetap sama.

Trial memakai fitur **Warung Sederhana selama 14 hari**, tetapi dibatasi **1 device dan 1 toko**. Satu email atau satu instalasi hanya dapat mendaftar trial satu kali. Pendaftaran langsung muncul di Developer Center.

## 3. Fitur yang dibuka dan dikunci

| Area aplikasi | Kecil | Sederhana | Toko | Lifetime |
|---|:---:|:---:|:---:|:---:|
| Dashboard, Kasir, Barang | ✓ | ✓ | ✓ | ✓ |
| Kartu Stok, Stock Opname, Laporan | ✓ | ✓ | ✓ | ✓ |
| Absensi, Retur, Closing Shift | ✓ | ✓ | ✓ | ✓ |
| Backup & Restore, promo dasar | ✓ | ✓ | ✓ | ✓ |
| Pengeluaran dan promo lanjutan | — | ✓ | ✓ | ✓ |
| Supplier, Purchase Order, Goods Receipt | — | ✓ | ✓ | ✓ |
| Akun Cloud dan Perangkat Cloud | — | ✓ | ✓ | ✓ |
| Recovery Center dan Aplikasi & Update | — | ✓ | ✓ | ✓ |
| Multi-Toko & Transfer Stok | — | — | ✓ | ✓ |
| Cloud Control, End of Day | — | — | ✓ | ✓ |
| QA & Security | — | — | ✓ | ✓ |

Menu tetap mengikuti **dua aturan sekaligus**: role akun dan paket lisensi. Contoh: paket Toko membuka QA & Security, tetapi menu itu tetap hanya terlihat untuk role Owner.

## 4. Membuat project License Authority

1. Buka Supabase Dashboard.
2. Pilih **New project**.
3. Nama yang disarankan: `LocDailyMar License Authority`.
4. Simpan password database secara aman.
5. Setelah project siap, buka **Project Settings → General** dan salin **Reference ID**. Ini disebut `PROJECT_REF_LISENSI`.

Jangan gunakan Reference ID project Cloud aplikasi (`xwzighiqmxemnblzgcrf`) kecuali memang Anda sengaja menjadikan project itu server lisensi. Rekomendasi tetap project terpisah.

## 5. Memasang database lisensi

Pada project License Authority buka **SQL Editor → New query**. Salin seluruh isi:

`license-authority-v2/supabase/migrations/20260830010000_ldm_license_v2.sql`

Tekan **Run**. Hasil akhir harus menampilkan empat paket, dan semua nilai kolom `active` harus `true`.

Warung Kecil harus menunjukkan `max_devices = 2`. Lifetime harus menunjukkan `max_devices = 15` dan `max_stores = 8`.

## 6. Menyiapkan Supabase CLI di Windows

Buka Command Prompt pada folder `license-authority-v2`, kemudian jalankan:

```bat
npx.cmd supabase login
npx.cmd supabase link --project-ref PROJECT_REF_LISENSI
```

Jika `supabase/config.toml` masih berisi placeholder, ganti:

```toml
project_id = "PROJECT_REF_LISENSI"
```

Generate pepper rahasia 64 karakter:

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin hasilnya. Jangan letakkan pepper pada JavaScript atau kirim kepada customer.

## 7. Menyimpan secret Edge Function

Ganti contoh domain dan email berikut:

```bat
npx.cmd supabase secrets set LDM2_DEVICE_PEPPER="HASIL_64_KARAKTER"
npx.cmd supabase secrets set LDM2_ALLOWED_ORIGINS="https://domain-aplikasi-anda.com,http://localhost:5500"
npx.cmd supabase secrets set LDM2_ADMIN_ALLOWED_ORIGINS="https://domain-aplikasi-anda.com,http://localhost:5500"
npx.cmd supabase secrets set LDM2_ADMIN_EMAILS="email.developer@contoh.com"
npx.cmd supabase secrets set LDM2_ALLOW_NULL_ORIGIN="false"
```

Untuk uji sementara dengan membuka HTML langsung melalui `file://`, set `LDM2_ALLOW_NULL_ORIGIN="true"`. Setelah aplikasi di-hosting, ubah kembali ke `false`. Hosting melalui `http://localhost` lebih disarankan daripada membuka file langsung.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` tersedia otomatis di Edge Function Supabase. Jangan menyalin `service_role` ke frontend.

## 8. Deploy dua Edge Function

Dari folder `license-authority-v2`:

```bat
npx.cmd supabase functions deploy ldm-license-v2 --no-verify-jwt
npx.cmd supabase functions deploy ldm-license-admin-v2 --no-verify-jwt
```

Docker tidak diperlukan untuk deploy fungsi ke Supabase Cloud. Struktur folder harus tetap persis seperti paket ini.

Uji health melalui browser console pada domain aplikasi:

```javascript
fetch("https://PROJECT_REF_LISENSI.supabase.co/functions/v1/ldm-license-v2", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "health" })
}).then(r => r.json()).then(console.log).catch(console.error);
```

Hasil harus memiliki `ok: true` dan empat paket.

## 9. Mengisi konfigurasi frontend

Edit `js/license-v2-config.js`:

```javascript
serverUrl: "https://PROJECT_REF_LISENSI.supabase.co/functions/v1/ldm-license-v2",
developerWhatsApp: "628xxxxxxxxxx",
```

Nomor WhatsApp memakai format negara tanpa tanda `+`, spasi, atau angka nol di depan. Contoh `0812...` menjadi `62812...`.

Untuk Developer Center, buka project License Authority → **Project Settings → API**. Salin Project URL dan **Publishable key**. Edit `js/license-v2-admin-config.js`:

```javascript
supabaseUrl: "https://PROJECT_REF_LISENSI.supabase.co",
supabasePublishableKey: "sb_publishable_...",
adminFunctionUrl: "https://PROJECT_REF_LISENSI.supabase.co/functions/v1/ldm-license-admin-v2",
```

Jangan mengubah `js/supabase-config.js`; file itu tetap menunjuk ke Cloud data toko.

## 10. Membuat akun developer

Pada project License Authority:

1. Buka **Authentication → Users → Add user**.
2. Masukkan email developer yang sama dengan secret `LDM2_ADMIN_EMAILS`.
3. Buat password kuat dan konfirmasi email.
4. Buka `developer-license-v2.html` melalui domain yang sudah diizinkan.
5. Login. Customer, trial, status, perangkat, dan kuota akan tampil.

Developer Center dapat:

- membuat License Key manual;
- melihat semua customer dan pendaftar trial;
- menangguhkan atau mengaktifkan kembali lisensi;
- memperpanjang periode;
- mengubah trial menjadi berbayar;
- melihat dan menonaktifkan perangkat lama;
- mencatat tindakan perubahan ke tabel audit.

## 11. Alur trial 14 hari

1. Customer membuka `license-v2.html`.
2. Customer mengisi nama, email, WhatsApp, dan Store Code trial.
3. Server memastikan email dan instalasi belum pernah menggunakan trial.
4. Trial Warung Sederhana aktif 14 hari dengan kuota 1 device/1 toko.
5. Developer Center langsung menampilkan label **TRIAL**.
6. Sesudah 14 hari, pemeriksaan berikutnya otomatis mengubah status menjadi `expired` dan aplikasi diblokir.
7. Setelah pembayaran, developer menekan **Jadikan berbayar**, memilih paket, dan mengirim License Key baru.

## 12. Alur pembelian dan serah terima customer

1. Customer menekan **Pesan via WhatsApp** pada `license-v2.html`.
2. Chat otomatis memuat nama paket dan formulir singkat. Developer mengirim total/tagihan melalui WhatsApp.
3. Setelah pembayaran diverifikasi, developer membuat akun Auth Owner pada **project Cloud customer**.
4. Jalankan `SQL-03-ONBOARDING-CUSTOMER-CLOUD.sql` pada project Cloud setelah mengganti email, Store Code, nama toko, username, dan display name.
5. Developer membuka Developer Center dan menekan **Buat lisensi**.
6. Pilih paket serta periode. License Key mentah tampil **satu kali**; segera salin.
7. Kirim kepada customer secara privat:
   - URL aplikasi;
   - email akun Owner;
   - password sementara (minta customer menggantinya);
   - Store Code;
   - License Key;
   - nama paket, kuota, dan tanggal berakhir;
   - nomor dukungan developer.
8. Customer membuka `license-v2.html`, mengisi Store Code dan License Key, lalu menekan **Aktifkan lisensi**.
9. Customer masuk melalui `index.html` menggunakan akun Owner.
10. Pastikan Store Code setelah login sama dengan Store Code aktivasi.

Contoh pesan serah terima:

```text
Lisensi LocDailyMar sudah siap.
Paket: Warung Sederhana
Store Code: LDM-CUSTOMER-001
Email Owner: email.customer@example.com
Password sementara: (dikirim terpisah)
License Key: LDM2-...
Masa aktif sampai: ...

Buka halaman Lisensi & Paket, aktifkan key, lalu masuk ke aplikasi.
Mohon ganti password sementara setelah login.
```

## 13. Perpanjangan, penangguhan, dan kedaluwarsa

- Lisensi periode otomatis diblokir ketika waktu server sudah mencapai `expires_at`.
- Developer dapat memperpanjang dari Developer Center. Status kembali aktif dan token perangkat lama tetap dapat digunakan.
- **Tangguhkan** dipakai bila ada masalah pembayaran atau penyalahgunaan. Saat online, perubahan diterapkan paling lambat sekitar 2 menit karena cache singkat.
- Bila internet putus, perangkat dengan validasi sukses terakhir mendapat grace maksimal 24 jam. Grace tidak melewati tanggal kedaluwarsa yang sudah tersimpan.
- Lifetime tidak memiliki `expires_at`, tetapi tetap dapat ditangguhkan/dibatalkan developer dan tetap tunduk pada kuota 15 device/8 toko.
- Menonaktifkan perangkat tidak menghapus data transaksi; hanya mengosongkan slot aktivasi.

## 14. Mengapa metode ini tidak membuat layar putih

- Guard memakai overlay tetap; body halaman tidak pernah diberi `display:none` atau `visibility:hidden`.
- Request memiliki timeout 8 detik.
- Kesalahan selalu menampilkan tombol **Coba Lagi** dan **Lisensi & Paket**.
- Tidak ada redirect berulang antara login dan halaman lisensi.
- Service Worker memakai network-first untuk file konfigurasi lisensi sehingga pembaruan URL lebih cepat diterima.

## 15. Checklist selesai

- [ ] Project License Authority terpisah dibuat.
- [ ] SQL instalasi selesai dan empat paket aktif.
- [ ] Pepper, origin, dan email admin disimpan sebagai secret.
- [ ] Dua Edge Function berhasil dideploy.
- [ ] Health mengembalikan `ok: true` dan empat paket.
- [ ] URL server serta nomor WhatsApp diisi.
- [ ] Konfigurasi Developer Center diisi dengan publishable key, bukan service role.
- [ ] Akun developer dibuat dan berhasil login.
- [ ] Trial tampil di Developer Center.
- [ ] Key tiap paket dapat dibuat dan diaktifkan.
- [ ] Warung Kecil berhenti pada perangkat ke-3.
- [ ] Menu terkunci mengikuti paket dan role.
- [ ] Suspend memblokir customer setelah validasi ulang.
- [ ] Perpanjangan mengaktifkan lisensi kedaluwarsa.
- [ ] Perangkat lama dapat dinonaktifkan dan slot kembali tersedia.
- [ ] PWA lama diperbarui ke Service Worker 24.0.0.

## 16. Batasan keamanan yang perlu diketahui

Aplikasi HTML/JavaScript di browser tidak dapat menjadi DRM yang mustahil dibongkar karena source code dan penyimpanan browser berada pada perangkat customer. Sistem ini memberikan kontrol server, key yang disimpan dalam bentuk hash, limit device/store, expiry, suspend, dan audit—cukup kuat untuk mencegah pemakaian biasa tanpa lisensi. Untuk perlindungan lebih tinggi, distribusikan aplikasi sebagai build tersign atau APK dan tetap pertahankan validasi server ini.


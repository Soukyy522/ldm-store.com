# PATCH 22.2 — Tema Terhubung pada Halaman Sistem

Versi: **22.2.0**  
Baseline: **Tahap 22.1 — Navigasi Responsif**

## Halaman yang diperbarui

- `multi-store.html`
- `pwa-settings.html` — Aplikasi & Update
- `recovery-center.html`
- `qa-security-performance.html` — QA & Security

## Hasil

Keempat halaman menggunakan komponen visual yang sama seperti Dashboard:

- header brand, logo, nama dan subjudul toko;
- warna header dan warna aksen;
- font aplikasi;
- warna latar dan kartu;
- dark mode;
- kartu, tombol, tabel dan jarak antarelemen yang konsisten;
- Mega Menu pada desktop;
- hamburger drawer pada HP dan tablet.

## Pengaturan tema terhubung

Tombol **Tema** tersedia pada setiap halaman target. Editor dapat mengubah:

- nama toko/aplikasi;
- subjudul;
- warna header;
- warna aksen;
- warna latar;
- warna kartu;
- font;
- dark mode;
- logo maksimal 2 MB.

Pengaturan disimpan pada `localStorage.headerConfig`, yaitu format yang sama dengan Dashboard. Saat berpindah halaman pada perangkat yang sama, tema tetap digunakan. Tab lain diperbarui melalui `storage` event dan `BroadcastChannel` apabila didukung browser.

Tema ini bersifat per browser/perangkat. Patch ini belum menyimpan tema ke Supabase sehingga perubahan di HP tidak otomatis mengubah tema laptop lain.

## Navigasi

- Desktop menampilkan Mega Menu berkelompok.
- HP menampilkan tombol hamburger pada header.
- Isi menu disaring sesuai role Owner, Admin, atau Kasir.
- Pengaturan tampilan tidak mengubah otoritas halaman maupun keamanan backend.

## Instalasi

1. Pastikan Offline Queue kosong.
2. Unggah seluruh isi paket versi 22.2.0.
3. Jangan memisahkan folder `css` dan `js`.
4. Buka **Aplikasi & Update**.
5. Pilih **Cek Update**, lalu **Terapkan Update**.
6. Tutup dan buka kembali aplikasi.
7. Uji tombol Tema pada salah satu halaman target.
8. Pindah ke halaman target lain dan pastikan tema yang sama masih aktif.

Tidak ada SQL baru pada patch ini.

## Checklist

- [ ] Keempat halaman mempunyai header seragam.
- [ ] Tombol Tema membuka editor.
- [ ] Tema tersimpan setelah reload.
- [ ] Tema yang diubah dari satu halaman terlihat pada halaman lainnya.
- [ ] Dashboard membaca konfigurasi yang sama.
- [ ] Mega Menu desktop terbuka dan seluruh menu sesuai role terlihat.
- [ ] Hamburger HP membuka serta menutup drawer.
- [ ] Dark mode terbaca pada seluruh halaman target.
- [ ] Logo tampil proporsional.
- [ ] Fungsi Multi-Toko, PWA, Recovery, dan QA tetap berjalan.

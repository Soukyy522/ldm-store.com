# PATCH 22.1 — Navigasi Responsif dan Tema Multi-Toko

Versi: **22.1.0**  
Baseline: **Tahap 22 — Multi-Toko dan Transfer Stok**

## Perubahan

- Mega Menu desktop tersedia pada seluruh halaman operasional yang memuat navigasi global.
- Semua menu yang diizinkan untuk role pengguna ditampilkan di dalam Mega Menu.
- Sidebar lama tetap menjadi sumber navigasi HP pada halaman lama.
- Halaman yang tidak mempunyai sidebar, termasuk `multi-store.html`, mendapatkan hamburger drawer otomatis.
- Halaman Multi-Toko memakai warna, font, dark mode, judul, subjudul, dan logo dari `headerConfig` Dashboard.
- Menu `Multi-Toko & Transfer` ditambahkan ke Mega Menu Dashboard.
- Pembatasan role tidak diubah.

## Pembagian menu berdasarkan role

### Owner

Mendapat semua menu, termasuk Multi-Toko, Backup & Restore, dan QA & Security.

### Admin

Mendapat menu operasional dan Multi-Toko, tetapi tidak mendapatkan QA & Security.

### Kasir

Mendapat Dashboard, Absensi, Kasir, Retur, Kartu Stok, Stock Opname, Laporan, Aplikasi & Update, dan Recovery Center. Menu administrasi, pembelian, Multi-Toko, serta QA & Security tidak ditampilkan.

## Instalasi

1. Pastikan Offline Queue kosong.
2. Unggah seluruh paket versi 22.1.0 agar CSS dan JavaScript baru ikut terpasang.
3. Buka **Aplikasi & Update**.
4. Terapkan pembaruan versi 22.1.0.
5. Tutup lalu buka kembali aplikasi.
6. Uji satu akun Owner, Admin, dan Kasir pada desktop serta HP.

Patch ini tidak memerlukan SQL baru dan tidak mengubah tabel maupun data transfer stok.

## Checklist

- [ ] Desktop menampilkan tombol Mega Menu.
- [ ] Mega Menu dapat dibuka dengan klik dan mouse hover.
- [ ] Semua menu yang diizinkan role terlihat di Mega Menu.
- [ ] Menu yang dilarang role tidak muncul.
- [ ] Multi-Toko aktif pada Mega Menu Dashboard.
- [ ] HP menampilkan tombol hamburger.
- [ ] Drawer HP dapat ditutup melalui tombol, overlay, pilihan menu, dan tombol Escape.
- [ ] Tampilan Multi-Toko mengikuti tema Dashboard.
- [ ] Dark mode Multi-Toko mengikuti Dashboard.
- [ ] Logo dan nama toko dari Dashboard muncul di header Multi-Toko.
- [ ] Fungsi membuat cabang dan transfer stok tetap berjalan.

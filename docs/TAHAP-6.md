# Tahap 6 - Main Login Supabase Auth

## Perubahan utama

- `index.html` sekarang login memakai email + password Supabase Auth.
- Role resmi dibaca dari `public.profiles.role`.
- `localStorage.userRole` hanya cache kompatibilitas untuk kode lama.
- Semua halaman aplikasi utama memuat `cloud-session-guard.js`.
- Halaman disembunyikan sementara sampai session/profile cloud berhasil diverifikasi.
- Logout pada halaman lama dipatch agar juga melakukan `supabase.auth.signOut()`.

## Helper baru

- `js/cloud-session.js`
- `js/cloud-session-guard.js`

## User lama

Username aplikasi tetap disimpan di `profiles.username`, tetapi login cloud memakai email Auth.

Semua user yang perlu login harus:

1. Ada di `Authentication > Users`.
2. Memiliki row di `public.profiles`.
3. Memiliki role `owner`, `admin`, atau `kasir`.
4. Terhubung ke `LDM-DEFAULT`.

Gunakan `03-stage6-link-user-profile-template.sql` untuk link profile tambahan.

## Edit Akun

Edit Akun tetap Owner-only.

Namun fitur Edit Akun lama masih mengelola `daftarAkun` localStorage dan **belum** menjadi panel administrasi Supabase Auth. Mengubah password di menu legacy belum mengubah password Auth cloud user lain.

## Data bisnis

Barang/transaksi/stok masih localStorage. Migrasi data bisnis dimulai pada tahap berikutnya setelah Auth authority stabil.

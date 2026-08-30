-- Jalankan pada project SUPABASE LISENSI, bukan project Cloud toko.
-- SQL instalasi wajib sudah dijalankan.
-- PENTING: jalankan HANYA SATU query paket yang dibeli customer.
-- License Key mentah hanya tampil pada hasil query pembuatan/konversi.

-- 1. WARUNG KECIL - 1 bulan, 2 device, 1 toko
select * from public.ldm2_issue_license(
  'WARUNG_KECIL',
  'NAMA CUSTOMER',
  'email.customer@example.com',
  '628xxxxxxxxxx',
  1,
  'Pembayaran Warung Kecil 1 bulan'
);

-- 2. WARUNG SEDERHANA - 12 bulan, 3 device, 1 toko
-- select * from public.ldm2_issue_license(
--   'WARUNG_SEDERHANA','NAMA CUSTOMER','email.customer@example.com',
--   '628xxxxxxxxxx',12,'Pembayaran Warung Sederhana 12 bulan'
-- );

-- 3. TOKO - 12 bulan, 10 device, 5 toko
-- select * from public.ldm2_issue_license(
--   'TOKO','NAMA CUSTOMER','email.customer@example.com',
--   '628xxxxxxxxxx',12,'Pembayaran Toko 12 bulan'
-- );

-- 4. LIFETIME - 15 device, 8 toko, tanpa tanggal kedaluwarsa
-- Nilai durasi tetap diisi 1, tetapi diabaikan oleh fungsi Lifetime.
-- select * from public.ldm2_issue_license(
--   'LIFETIME','NAMA CUSTOMER','email.customer@example.com',
--   '628xxxxxxxxxx',1,'Pembayaran Lifetime lunas'
-- );


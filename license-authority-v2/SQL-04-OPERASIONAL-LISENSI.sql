-- Jalankan pada project SUPABASE LISENSI.
-- Ganti UUID contoh dengan license_id / activation_id dari Developer Center.

-- A. MELIHAT SEMUA CUSTOMER, TRIAL, STATUS, KUOTA
select * from public.ldm2_admin_license_overview order by created_at desc;

-- B. MENANGGUHKAN LISENSI
-- select public.ldm2_set_license_status(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'suspended','Pembayaran belum diterima'
-- );

-- C. MENGAKTIFKAN KEMBALI LISENSI
-- select public.ldm2_set_license_status(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'active','Pembayaran sudah diverifikasi'
-- );

-- D. MEMPERPANJANG 12 BULAN (otomatis aktif kembali)
-- select public.ldm2_renew_license(
--   '00000000-0000-0000-0000-000000000000'::uuid,12
-- );

-- E. MENGUBAH TRIAL MENJADI BERBAYAR
-- Hasil berisi License Key baru. Salin dan kirim hanya kepada customer.
-- select * from public.ldm2_convert_trial(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'WARUNG_SEDERHANA',12
-- );

-- F. MELIHAT PERANGKAT SUATU LISENSI
-- select id as activation_id,device_name,store_code,status,activated_at,last_seen_at
-- from public.ldm2_activations
-- where license_id='00000000-0000-0000-0000-000000000000'::uuid
-- order by last_seen_at desc;

-- G. MENONAKTIFKAN PERANGKAT LAMA DAN MENGOSONGKAN SLOT
-- select public.ldm2_deactivate_device(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'Perangkat lama sudah tidak digunakan'
-- );

-- H. MELIHAT PENDAFTAR TRIAL 14 HARI
select id,customer_name,customer_email,customer_phone,status,starts_at,expires_at,last_checked_at
from public.ldm2_licenses
where is_trial=true
order by created_at desc;


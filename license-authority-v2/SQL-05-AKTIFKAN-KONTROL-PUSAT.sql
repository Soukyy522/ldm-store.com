-- LocDailyMar 25.0
-- Jalankan pada SERVER LISENSI, bukan project Cloud data toko.
-- Menambahkan fitur Kontrol Pusat hanya ke paket Toko dan Lifetime.

begin;

update public.ldm2_plans
set features=case
    when features ? 'central_control' then features
    else features || '["central_control"]'::jsonb
end,
updated_at=now()
where code in ('TOKO','LIFETIME');

update public.ldm2_plans
set features=features - 'central_control',updated_at=now()
where code in ('WARUNG_KECIL','WARUNG_SEDERHANA');

commit;

select code,name,max_devices,max_stores,features ? 'central_control' as kontrol_pusat_aktif
from public.ldm2_plans
order by sort_order;

-- Hasil yang benar:
-- WARUNG_KECIL      = false
-- WARUNG_SEDERHANA  = false
-- TOKO              = true
-- LIFETIME          = true

-- =============================================================================
-- LocDailyMar 26.2 - Sinkronisasi harga paket lisensi
-- Jalankan pada SERVER LISENSI, bukan project Cloud data toko.
-- Aman dijalankan ulang: V27 hanya memperbarui tiga paket yang dijual.
-- =============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_plans') is null then
        raise exception 'Tabel public.ldm2_plans belum ada. Pasang Lisensi V2 terlebih dahulu.';
    end if;
    if (
        select count(*)
        from public.ldm2_plans
        where code in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO')
    ) <> 3 then
        raise exception 'Tiga paket aktif V27 belum lengkap. Periksa instalasi Lisensi V2.';
    end if;
end;
$$;

update public.ldm2_plans
set price_monthly=69000,
    price_yearly=699000,
    price_lifetime=null,
    updated_at=now()
where code='WARUNG_KECIL';

update public.ldm2_plans
set price_monthly=129000,
    price_yearly=1299000,
    price_lifetime=null,
    updated_at=now()
where code='WARUNG_SEDERHANA';

update public.ldm2_plans
set price_monthly=249000,
    price_yearly=2499000,
    price_lifetime=null,
    updated_at=now()
where code='TOKO';

-- Lifetime tidak lagi dijual pada V27. Riwayat lisensi lama tetap dipertahankan.
update public.ldm2_plans set active=false,updated_at=now() where code='LIFETIME';

commit;

-- Semua baris berikut harus sesuai dengan daftar harga aplikasi.
select
    code,
    name,
    price_monthly,
    price_yearly,
    price_lifetime,
    max_devices,
    max_stores,
    active
from public.ldm2_plans
where code in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO')
order by sort_order;

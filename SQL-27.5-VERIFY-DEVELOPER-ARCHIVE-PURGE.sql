-- LocDailyMar 27.5.0 - VERIFY ONLY
-- Jalankan pada PROJECT LICENSE AUTHORITY V2 setelah SQL-14.

select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='ldm2_licenses' and column_name='archived_at') as archived_at_ok,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='ldm2_licenses' and column_name='archived_reason') as archived_reason_ok,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='ldm2_licenses' and column_name='archived_by_email') as archived_by_ok,
    to_regprocedure('public.ldm2_archive_license(uuid,text,text)') is not null as archive_rpc_ok,
    to_regprocedure('public.ldm2_restore_archived_license(uuid,text)') is not null as restore_rpc_ok,
    to_regprocedure('public.ldm2_purge_unused_license(uuid,text,text)') is not null as purge_rpc_ok;

select
    count(*) filter(where archived_at is null) as visible_normal,
    count(*) filter(where archived_at is not null) as archived_total
from public.ldm2_licenses;

-- Informasi saja: lisensi yang mungkin layak dipertimbangkan untuk arsip.
select
    id,
    customer_name,
    customer_email,
    plan_code,
    status,
    primary_store_code,
    archived_at
from public.ldm2_licenses
where status in ('suspended','expired','cancelled','pending_payment')
order by created_at desc
limit 50;

-- LocDailyMar TAHAP 21 - verifikasi setelah migration dijalankan.

-- 1. Semua kolom harus bernilai YES.
select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='promo_name') as promo_name_ok,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='promo_type') as promo_type_ok,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='promo_value') as promo_value_ok;

-- 2. Tabel history, RLS, dan fungsi sinkron harus tersedia.
select
    to_regclass('public.product_pricing_history') is not null as history_table_ok,
    coalesce((select relrowsecurity from pg_class where oid='public.product_pricing_history'::regclass),false) as history_rls_ok,
    to_regprocedure('public.ldm_save_advanced_promos_bulk(jsonb)') is not null as save_promo_rpc_ok,
    to_regprocedure('public.ldm_sync_products_stage21(jsonb)') is not null as sync_stage21_rpc_ok;

-- 3. Ringkasan promo pada store akun yang sedang login.
select
    id,
    name,
    sale_price,
    promo_active,
    promo_name,
    promo_type,
    promo_value,
    promo_price,
    promo_min_qty,
    promo_start_date,
    promo_end_date
from public.products
where store_id = public.ldm_current_store_id()
  and deleted_at is null
order by name;

-- 4. Riwayat hanya terlihat untuk Owner/Admin sesuai RLS.
select
    product_id,
    old_sale_price,
    new_sale_price,
    old_promo,
    new_promo,
    changed_at
from public.product_pricing_history
where store_id = public.ldm_current_store_id()
order by changed_at desc
limit 20;

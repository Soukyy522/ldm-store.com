-- ================================================================
-- LocDailyMar - Tahap 7 Verification
-- ================================================================

-- 1. Metadata
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'products_authority',
    'products_cache',
    'products_realtime',
    'stock_authority'
)
order by key;

-- 2. Table / RLS
select
    schemaname,
    tablename,
    rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'products';

-- 3. Product counts per store
select
    s.code as store_code,
    count(p.id) filter (
        where p.deleted_at is null
    ) as active_product_count,
    count(p.id) filter (
        where p.deleted_at is not null
    ) as deleted_product_count
from public.stores s
left join public.products p
  on p.store_id = s.id
group by s.code
order by s.code;

-- 4. UUID / barcode / name
select
    p.id,
    p.barcode,
    p.name,
    p.category,
    p.unit,
    p.purchase_price,
    p.sale_price,
    p.legacy_stock_snapshot,
    p.promo_active,
    p.version,
    p.updated_at
from public.products p
where p.deleted_at is null
order by p.name
limit 100;

-- 5. Duplicate active barcode harus kosong.
select
    store_id,
    barcode,
    count(*) as duplicate_count
from public.products
where deleted_at is null
  and barcode is not null
  and btrim(barcode) <> ''
group by store_id, barcode
having count(*) > 1;

-- 6. Realtime publication
select
    pubname,
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'products';

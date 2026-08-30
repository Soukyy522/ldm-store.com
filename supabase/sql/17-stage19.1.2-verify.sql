-- ================================================================
-- LocDailyMar 19.1.2 - VERIFY Purchase Price History
-- ================================================================

-- 1. Metadata
select key,value,updated_at
from public.ldm_system_meta
where key in (
    'purchase_price_history',
    'profit_hpp_authority',
    'frontend_patch'
)
order by key;

-- 2. Table + RLS
select schemaname,tablename,rowsecurity
from pg_tables
where schemaname='public'
  and tablename='purchase_price_history';

-- 3. Trigger aktif
select
    event_object_schema,
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation
from information_schema.triggers
where event_object_schema='public'
  and event_object_table='products'
  and trigger_name='trg_products_purchase_price_history';

-- 4. Coverage baseline produk aktif. Harus 0 rows.
select p.id,p.name,p.purchase_price
from public.products p
where p.deleted_at is null
  and not exists (
      select 1
      from public.purchase_price_history h
      where h.store_id=p.store_id
        and h.product_id=p.id
  );

-- 5. Histori terbaru
select
    h.business_date,
    p.name,
    h.purchase_price,
    h.effective_at,
    h.source,
    h.changed_by
from public.purchase_price_history h
join public.products p on p.id=h.product_id
order by h.effective_at desc
limit 100;

-- 6. Snapshot transaksi terbaru.
-- Snapshot ini tetap sumber HPP utama untuk transaksi cloud.
select
    t.business_date,
    t.transaction_code,
    ti.product_name_snapshot,
    ti.qty,
    ti.cost_price_snapshot,
    ti.unit_price,
    ti.line_subtotal
from public.transaction_items ti
join public.transactions t on t.id=ti.transaction_id
order by t.transacted_at desc
limit 100;

-- 7. Realtime publication
select pubname,schemaname,tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename='purchase_price_history';

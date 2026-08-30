-- ================================================================
-- LocDailyMar - Tahap 8 Verification
-- ================================================================

-- 1. Metadata
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'transactions_authority',
    'transaction_items_authority',
    'sales_stock_authority',
    'checkout_mode',
    'checkout_offline_mode',
    'full_inventory_migration'
)
order by key;

-- 2. RLS harus true
select
    schemaname,
    tablename,
    rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
      'products',
      'transactions',
      'transaction_items',
      'stock_movements'
  )
order by tablename;

-- 3. Opening ledger dibanding current snapshot
select
    s.code as store_code,
    count(distinct p.id) filter (
        where p.deleted_at is null
    ) as active_products,
    count(distinct sm.product_id) filter (
        where sm.movement_type = 'opening_balance'
    ) as products_with_opening_movement
from public.stores s
left join public.products p
  on p.store_id = s.id
left join public.stock_movements sm
  on sm.store_id = s.id
 and sm.product_id = p.id
where s.deleted_at is null
group by s.code
order by s.code;

-- 4. Transaction summary
select
    count(*) as transaction_count,
    count(*) filter (where status = 'completed') as completed_count,
    count(*) filter (where status = 'voided') as voided_count,
    coalesce(sum(grand_total) filter (where status = 'completed'), 0) as completed_sales
from public.transactions;

-- 5. Recent transactions
select
    transaction_code,
    cashier_username,
    business_date,
    payment_method,
    subtotal,
    total_discount,
    grand_total,
    status,
    transacted_at
from public.transactions
order by transacted_at desc
limit 30;

-- 6. Recent stock movements
select
    sm.occurred_at,
    sm.movement_type,
    p.name as product_name,
    sm.quantity_change,
    sm.stock_before,
    sm.stock_after,
    sm.reference_code
from public.stock_movements sm
join public.products p
  on p.id = sm.product_id
order by sm.occurred_at desc
limit 50;

-- 7. Stock snapshot harus sama dengan ledger running result terakhir.
-- Per product, stock_after movement terbaru idealnya sama dengan snapshot.
with latest as (
    select distinct on (sm.product_id)
        sm.product_id,
        sm.stock_after,
        sm.occurred_at
    from public.stock_movements sm
    order by sm.product_id, sm.occurred_at desc, sm.created_at desc, sm.id desc
)
select
    p.id,
    p.name,
    p.legacy_stock_snapshot as product_snapshot,
    l.stock_after as ledger_latest_stock
from public.products p
left join latest l
  on l.product_id = p.id
where p.deleted_at is null
  and (
      l.product_id is null
      or p.legacy_stock_snapshot <> l.stock_after
  )
order by p.name;

-- 8. Realtime publication
select
    pubname,
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
      'products',
      'transactions',
      'transaction_items',
      'stock_movements'
  )
order by tablename;

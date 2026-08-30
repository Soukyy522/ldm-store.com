
-- =====================================================================
-- LocDailyMar Tahap 10 - VERIFY
-- =====================================================================

select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'returns_authority',
    'return_stock_mode',
    'cash_movement_authority',
    'stock_opname_authority',
    'stock_opname_apply_mode',
    'shift_management'
)
order by key;

select
    schemaname,
    tablename,
    rowsecurity
from pg_tables
where schemaname='public'
  and tablename in (
      'sales_returns',
      'sales_return_items',
      'cash_movements',
      'stock_opname_entries'
  )
order by tablename;

select
    pubname,
    schemaname,
    tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename in (
      'sales_returns',
      'sales_return_items',
      'cash_movements',
      'stock_opname_entries'
  )
order by tablename;

-- Recent returns
select
    r.return_code,
    r.transaction_code_snapshot,
    r.created_username,
    r.refund_method,
    r.refund_username,
    r.refund_shift_label,
    r.total_refund,
    r.status,
    r.legacy_imported,
    r.stock_effect_applied,
    r.created_at
from public.sales_returns r
where r.deleted_at is null
order by r.created_at desc
limit 50;

-- Return qty tidak boleh melebihi qty transaksi untuk transaksi cloud.
-- Query ideal: 0 rows.
select
    ri.transaction_item_id,
    ti.product_name_snapshot,
    ti.qty as purchased_qty,
    sum(ri.qty) as reserved_or_approved_return_qty
from public.sales_return_items ri
join public.sales_returns r on r.id=ri.return_id
join public.transaction_items ti on ti.id=ri.transaction_item_id
where r.deleted_at is null
  and r.status in ('PENDING','APPROVED')
group by ri.transaction_item_id, ti.product_name_snapshot, ti.qty
having sum(ri.qty) > ti.qty;

-- Recent cash refund movement
select
    direction,
    amount,
    username_snapshot,
    shift_label,
    source_type,
    reference_code,
    status,
    occurred_at
from public.cash_movements
order by occurred_at desc
limit 50;

-- Stock Opname
select
    e.business_date,
    e.product_name_snapshot,
    e.system_stock_snapshot,
    e.physical_stock,
    e.difference_snapshot,
    e.status,
    e.stock_effect_applied,
    e.legacy_imported,
    e.created_username,
    e.created_at
from public.stock_opname_entries e
where e.deleted_at is null
order by e.created_at desc
limit 100;

-- Ledger consistency: latest movement stock_after vs products stock.
-- Ideal: 0 rows.
with latest as (
    select distinct on (m.product_id)
        m.product_id,
        m.stock_after,
        m.occurred_at
    from public.stock_movements m
    order by m.product_id, m.occurred_at desc, m.created_at desc
)
select
    p.id,
    p.name,
    p.legacy_stock_snapshot as product_stock,
    l.stock_after as ledger_stock_after,
    l.occurred_at
from public.products p
join latest l on l.product_id=p.id
where p.deleted_at is null
  and p.legacy_stock_snapshot <> l.stock_after
order by p.name;

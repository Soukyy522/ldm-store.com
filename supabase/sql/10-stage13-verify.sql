-- ================================================================
-- LocDailyMar - Tahap 13 VERIFY
-- Production Hardening
-- ================================================================

-- 1. Metadata
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_version','schema_status','audit_authority',
    'cloud_health_rpc','cloud_snapshot_rpc','cloud_snapshot_restore_mode',
    'production_readiness','shift_management'
)
order by key;

-- 2. Audit table + RLS
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname='public' and tablename='audit_events';

-- 3. Audit triggers yang terpasang
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema='public'
  and trigger_name like 'trg_audit_%'
order by event_object_table, event_manipulation;

-- 4. RPC tersedia
select p.proname
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('ldm_system_health','ldm_export_store_snapshot','ldm_audit_business_change')
order by p.proname;

-- 5. RLS authority tables. Ideal: semua true.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname = any(array[
      'profiles','devices','products','transactions','transaction_items','stock_movements',
      'attendance','sales_returns','sales_return_items','cash_movements','stock_opname_entries',
      'suppliers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
      'shift_closings','end_of_day_closings','operating_expenses','legacy_transactions','audit_events'
  ])
order by c.relname;

-- 6. Realtime audit_events
select pubname, schemaname, tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename='audit_events';

-- 7. Stock snapshot vs latest ledger. Ideal: 0 rows.
with latest as (
    select distinct on (sm.store_id, sm.product_id)
        sm.store_id, sm.product_id, sm.stock_after
    from public.stock_movements sm
    order by sm.store_id, sm.product_id, sm.occurred_at desc, sm.created_at desc, sm.id desc
)
select s.code, p.id, p.name, p.legacy_stock_snapshot, l.stock_after
from public.products p
join public.stores s on s.id=p.store_id
left join latest l on l.store_id=p.store_id and l.product_id=p.id
where p.deleted_at is null
  and p.active=true
  and (
      l.product_id is null
      or abs(coalesce(p.legacy_stock_snapshot,0)-coalesce(l.stock_after,0)) > 0.0005
  )
order by s.code, p.name;

-- 8. Orphan detail rows. Semua ideal 0.
select 'transaction_items' as check_name, count(*) as orphan_count
from public.transaction_items i left join public.transactions t on t.id=i.transaction_id
where t.id is null
union all
select 'sales_return_items', count(*)
from public.sales_return_items i left join public.sales_returns r on r.id=i.return_id
where r.id is null
union all
select 'goods_receipt_items', count(*)
from public.goods_receipt_items i left join public.goods_receipts g on g.id=i.goods_receipt_id
where g.id is null;

-- 9. Browser test:
-- Login Owner/Admin lalu buka cloud-control-center.html.
-- Status ideal = HEALTHY dan check critical = 0.

-- ================================================================
-- LocDailyMar - Tahap 11 Verification
-- ================================================================

-- 1. Metadata
select * from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_version','schema_status','supplier_authority',
    'purchase_order_authority','purchase_order_items_authority','goods_receipt_authority',
    'goods_receipt_items_authority','goods_receipt_stock_mode','goods_receipt_cancel_mode',
    'procurement_realtime','inventory_transition','shift_management'
)
order by key;

-- 2. RLS harus true
select schemaname,tablename,rowsecurity
from pg_tables
where schemaname='public'
  and tablename in (
    'suppliers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items'
  )
order by tablename;

-- 3. Supplier aktif
select s.code,s.name,s.active,s.payment_term_days,s.updated_at
from public.suppliers s
where s.deleted_at is null
order by s.name;

-- 4. PO summary
select po.po_number,po.order_date,po.supplier_name_snapshot,po.status,
       po.total_qty,po.total_received,po.total_value,po.history_only
from public.purchase_orders po
where po.deleted_at is null
order by po.created_at desc
limit 100;

-- 5. GR summary
select gr.gr_number,gr.business_date,gr.supplier_name_snapshot,gr.status,
       gr.purchase_order_number_snapshot,gr.total_qty,gr.total_value,
       gr.stock_effect_applied,gr.stock_effect_reversed,gr.history_only
from public.goods_receipts gr
where gr.deleted_at is null
order by gr.created_at desc
limit 100;

-- 6. PO received consistency. Ideal mismatch = 0 rows untuk data cloud baru.
select poi.id,po.po_number,poi.product_name_snapshot,
       poi.qty_ordered,poi.qty_received,
       coalesce(x.accepted_qty,0) as accepted_gr_qty
from public.purchase_order_items poi
join public.purchase_orders po on po.id=poi.purchase_order_id
left join lateral (
    select sum(gri.qty_received) as accepted_qty
    from public.goods_receipt_items gri
    join public.goods_receipts gr on gr.id=gri.goods_receipt_id
    where gri.purchase_order_item_id=poi.id
      and gr.status='Accepted'
      and gr.history_only=false
      and gr.deleted_at is null
) x on true
where po.history_only=false
  and poi.qty_received <> coalesce(x.accepted_qty,0);

-- 7. Product snapshot vs latest ledger. Ideal = 0 rows.
with latest as (
    select distinct on (sm.product_id)
        sm.product_id,sm.stock_after,sm.occurred_at
    from public.stock_movements sm
    order by sm.product_id,sm.occurred_at desc,sm.created_at desc,sm.id desc
)
select p.id,p.name,p.legacy_stock_snapshot,l.stock_after
from public.products p
join latest l on l.product_id=p.id
where p.deleted_at is null
  and p.legacy_stock_snapshot <> l.stock_after;

-- 8. GR movement coverage untuk Accepted cloud GR. Ideal missing = 0 rows.
select gr.gr_number,gri.id as gr_item_id,gri.product_name_snapshot
from public.goods_receipts gr
join public.goods_receipt_items gri on gri.goods_receipt_id=gr.id
left join public.stock_movements sm
  on sm.store_id=gr.store_id
 and sm.product_id=gri.product_id
 and sm.source_type='goods_receipt'
 and sm.source_id=gri.id::text
where gr.status='Accepted'
  and gr.history_only=false
  and gr.deleted_at is null
  and sm.id is null;

-- 9. Realtime publication
select pubname,schemaname,tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename in ('suppliers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items')
order by tablename;

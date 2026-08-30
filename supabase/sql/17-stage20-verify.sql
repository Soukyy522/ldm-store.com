-- TAHAP 20 - VERIFIKASI BACA SAJA
select
    count(*) as total_products,
    count(*) filter (where purchase_unit_factor > 0) as valid_conversion,
    count(*) filter (where purchase_unit is null or btrim(purchase_unit)='') as invalid_purchase_unit
from public.products
where deleted_at is null;

select id,name,unit as base_unit,purchase_unit,purchase_unit_factor,
       ('1 '||purchase_unit||' = '||purchase_unit_factor||' '||unit) as conversion
from public.products
where deleted_at is null
order by name
limit 100;

select
    count(*) filter (where unit_factor_snapshot <= 0) as invalid_po_factor,
    count(*) filter (where abs(qty_ordered - (purchase_qty_ordered*unit_factor_snapshot)) > 0.01) as invalid_po_qty
from public.purchase_order_items;

select
    count(*) filter (where unit_factor_snapshot <= 0) as invalid_gr_factor,
    count(*) filter (where abs(qty_received - (purchase_qty_received*unit_factor_snapshot)) > 0.01) as invalid_gr_qty
from public.goods_receipt_items;

-- ================================================================
-- LocDailyMar - TAHAP 20
-- Master Satuan Dasar + Konversi Satuan Beli
--
-- Prinsip:
-- - products.unit dan seluruh ledger stok tetap memakai satuan dasar.
-- - PO/GR boleh ditampilkan dalam satuan beli.
-- - RPC lama tetap menerima qty/harga satuan dasar agar kompatibel.
-- - Trigger menyimpan snapshot kemasan untuk tampilan lintas perangkat.
-- ================================================================

begin;

alter table public.products
    add column if not exists purchase_unit text,
    add column if not exists purchase_unit_factor numeric(16,6);

update public.products
set purchase_unit = coalesce(nullif(btrim(purchase_unit),''),nullif(btrim(unit),''),'Pcs'),
    purchase_unit_factor = case
        when purchase_unit_factor is null or purchase_unit_factor <= 0 then 1
        else purchase_unit_factor
    end;

alter table public.products
    alter column purchase_unit set default 'Pcs',
    alter column purchase_unit set not null,
    alter column purchase_unit_factor set default 1,
    alter column purchase_unit_factor set not null;

alter table public.products
    drop constraint if exists products_purchase_unit_factor_positive;
alter table public.products
    add constraint products_purchase_unit_factor_positive
    check (purchase_unit_factor > 0);

alter table public.purchase_order_items
    add column if not exists purchase_unit_snapshot text,
    add column if not exists unit_factor_snapshot numeric(16,6),
    add column if not exists purchase_qty_ordered numeric(16,3),
    add column if not exists purchase_qty_received numeric(16,3),
    add column if not exists package_purchase_price numeric(16,2);

update public.purchase_order_items
set purchase_unit_snapshot = coalesce(nullif(btrim(purchase_unit_snapshot),''),nullif(btrim(unit_snapshot),''),'Pcs'),
    unit_factor_snapshot = coalesce(nullif(unit_factor_snapshot,0),1),
    purchase_qty_ordered = coalesce(purchase_qty_ordered,qty_ordered),
    purchase_qty_received = coalesce(purchase_qty_received,qty_received),
    package_purchase_price = coalesce(package_purchase_price,purchase_price);

alter table public.purchase_order_items
    alter column purchase_unit_snapshot set default 'Pcs',
    alter column purchase_unit_snapshot set not null,
    alter column unit_factor_snapshot set default 1,
    alter column unit_factor_snapshot set not null,
    alter column purchase_qty_ordered set default 0,
    alter column purchase_qty_ordered set not null,
    alter column purchase_qty_received set default 0,
    alter column purchase_qty_received set not null,
    alter column package_purchase_price set default 0,
    alter column package_purchase_price set not null;

alter table public.purchase_order_items
    drop constraint if exists purchase_order_items_unit_factor_positive;
alter table public.purchase_order_items
    add constraint purchase_order_items_unit_factor_positive check (unit_factor_snapshot > 0);

alter table public.goods_receipt_items
    add column if not exists purchase_unit_snapshot text,
    add column if not exists unit_factor_snapshot numeric(16,6),
    add column if not exists purchase_qty_received numeric(16,3),
    add column if not exists package_purchase_price numeric(16,2);

update public.goods_receipt_items
set purchase_unit_snapshot = coalesce(nullif(btrim(purchase_unit_snapshot),''),nullif(btrim(unit_snapshot),''),'Pcs'),
    unit_factor_snapshot = coalesce(nullif(unit_factor_snapshot,0),1),
    purchase_qty_received = coalesce(purchase_qty_received,qty_received),
    package_purchase_price = coalesce(package_purchase_price,purchase_price);

alter table public.goods_receipt_items
    alter column purchase_unit_snapshot set default 'Pcs',
    alter column purchase_unit_snapshot set not null,
    alter column unit_factor_snapshot set default 1,
    alter column unit_factor_snapshot set not null,
    alter column purchase_qty_received set default 0,
    alter column purchase_qty_received set not null,
    alter column package_purchase_price set default 0,
    alter column package_purchase_price set not null;

alter table public.goods_receipt_items
    drop constraint if exists goods_receipt_items_unit_factor_positive;
alter table public.goods_receipt_items
    add constraint goods_receipt_items_unit_factor_positive check (unit_factor_snapshot > 0);

create or replace function public.ldm_snapshot_po_purchase_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_product public.products%rowtype;
begin
    if tg_op = 'INSERT' and new.product_id is not null and new.legacy_item_id is null then
        select * into v_product
        from public.products
        where id=new.product_id and store_id=new.store_id;

        if v_product.id is not null then
            new.unit_snapshot := coalesce(nullif(v_product.unit,''),'Pcs');
            new.purchase_unit_snapshot := coalesce(nullif(v_product.purchase_unit,''),new.unit_snapshot);
            new.unit_factor_snapshot := greatest(coalesce(v_product.purchase_unit_factor,1),0.001);
        end if;
    end if;

    new.purchase_unit_snapshot := coalesce(nullif(btrim(new.purchase_unit_snapshot),''),nullif(btrim(new.unit_snapshot),''),'Pcs');
    new.unit_factor_snapshot := greatest(coalesce(new.unit_factor_snapshot,1),0.001);
    new.purchase_qty_ordered := round(new.qty_ordered / new.unit_factor_snapshot,3);
    new.purchase_qty_received := round(new.qty_received / new.unit_factor_snapshot,3);
    new.package_purchase_price := round(new.purchase_price * new.unit_factor_snapshot,2);
    return new;
end;
$$;

drop trigger if exists trg_stage20_po_unit_snapshot on public.purchase_order_items;
create trigger trg_stage20_po_unit_snapshot
before insert or update of qty_ordered,qty_received,purchase_price,product_id
on public.purchase_order_items
for each row execute function public.ldm_snapshot_po_purchase_unit();

create or replace function public.ldm_snapshot_gr_purchase_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_product public.products%rowtype;
    v_po_item public.purchase_order_items%rowtype;
begin
    if tg_op = 'INSERT' and new.purchase_order_item_id is not null then
        select * into v_po_item
        from public.purchase_order_items
        where id=new.purchase_order_item_id and store_id=new.store_id;
    end if;

    if v_po_item.id is not null then
        new.unit_snapshot := v_po_item.unit_snapshot;
        new.purchase_unit_snapshot := v_po_item.purchase_unit_snapshot;
        new.unit_factor_snapshot := v_po_item.unit_factor_snapshot;
    elsif tg_op = 'INSERT' and new.product_id is not null and new.legacy_item_id is null then
        select * into v_product
        from public.products
        where id=new.product_id and store_id=new.store_id;

        if v_product.id is not null then
            new.unit_snapshot := coalesce(nullif(v_product.unit,''),'Pcs');
            new.purchase_unit_snapshot := coalesce(nullif(v_product.purchase_unit,''),new.unit_snapshot);
            new.unit_factor_snapshot := greatest(coalesce(v_product.purchase_unit_factor,1),0.001);
        end if;
    end if;

    new.purchase_unit_snapshot := coalesce(nullif(btrim(new.purchase_unit_snapshot),''),nullif(btrim(new.unit_snapshot),''),'Pcs');
    new.unit_factor_snapshot := greatest(coalesce(new.unit_factor_snapshot,1),0.001);
    new.purchase_qty_received := round(new.qty_received / new.unit_factor_snapshot,3);
    new.package_purchase_price := round(new.purchase_price * new.unit_factor_snapshot,2);
    return new;
end;
$$;

drop trigger if exists trg_stage20_gr_unit_snapshot on public.goods_receipt_items;
create trigger trg_stage20_gr_unit_snapshot
before insert or update of qty_received,purchase_price,product_id,purchase_order_item_id
on public.goods_receipt_items
for each row execute function public.ldm_snapshot_gr_purchase_unit();

create or replace function public.ldm_save_product_units_bulk(p_products jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_barcode text;
    v_name text;
    v_base_unit text;
    v_purchase_unit text;
    v_factor numeric(16,6);
    v_count integer := 0;
begin
    v_store_id := public.ldm_current_store_id();

    if v_store_id is null then
        raise exception 'Store profile tidak ditemukan.';
    end if;
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat mengubah master satuan.';
    end if;
    if p_products is null or jsonb_typeof(p_products) <> 'array' then
        raise exception 'p_products harus berupa JSON array.';
    end if;

    for v_item in select value from jsonb_array_elements(p_products)
    loop
        v_product_id := null;
        begin
            v_product_id := nullif(v_item->>'id','')::uuid;
        exception when invalid_text_representation then
            v_product_id := null;
        end;

        v_barcode := nullif(btrim(coalesce(v_item->>'barcode','')),'');
        v_name := nullif(btrim(coalesce(v_item->>'nama',v_item->>'name','')),'');
        v_base_unit := coalesce(
            nullif(btrim(v_item->>'satuanDasar'),''),
            nullif(btrim(v_item->>'satuan'),''),
            'Pcs'
        );
        v_purchase_unit := coalesce(
            nullif(btrim(v_item->>'satuanBeli'),''),
            v_base_unit
        );
        v_factor := greatest(coalesce(nullif(v_item->>'konversiBeli','')::numeric,1),0.001);

        update public.products
        set unit=v_base_unit,
            purchase_unit=v_purchase_unit,
            purchase_unit_factor=v_factor
        where store_id=v_store_id
          and deleted_at is null
          and (
              (v_product_id is not null and id=v_product_id)
              or (v_product_id is null and v_barcode is not null and barcode=v_barcode)
              or (
                  v_product_id is null and v_barcode is null and v_name is not null
                  and lower(name)=lower(v_name)
                  and 1=(select count(*) from public.products p2 where p2.store_id=v_store_id and p2.deleted_at is null and lower(p2.name)=lower(v_name))
              )
          );

        if found then v_count := v_count + 1; end if;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_save_product_units_bulk(jsonb) from public,anon;
grant execute on function public.ldm_save_product_units_bulk(jsonb) to authenticated;

create or replace function public.ldm_sync_products_stage20(p_products jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    -- Kedua fungsi berjalan dalam transaksi RPC yang sama.
    v_count := public.ldm_import_legacy_products(p_products);
    perform public.ldm_save_product_units_bulk(p_products);
    return v_count;
end;
$$;

revoke all on function public.ldm_sync_products_stage20(jsonb) from public,anon;
grant execute on function public.ldm_sync_products_stage20(jsonb) to authenticated;

commit;

-- ================================================================
-- LocDailyMar - Live Sync Tahap 11
-- Cloud Supplier + Purchase Order + Goods Receipt
-- Atomic Goods Receipt Stock + Realtime
-- TANPA SHIFT MANAGEMENT
-- ================================================================

begin;

-- ------------------------------------------------
-- Foundation checks
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'public.products belum ada. Jalankan Tahap 7.';
    end if;
    if to_regclass('public.stock_movements') is null then
        raise exception 'public.stock_movements belum ada. Jalankan Tahap 8.';
    end if;
    if to_regclass('public.profiles') is null then
        raise exception 'public.profiles belum ada.';
    end if;
end
$$;

-- Expiry terakhir dari penerimaan barang.
alter table public.products
add column if not exists last_expiry_date date;

-- Stage 11 menambah movement khusus rollback Goods Receipt.
alter table public.stock_movements
    drop constraint if exists stock_movements_movement_type_check;

alter table public.stock_movements
    add constraint stock_movements_movement_type_check
    check (
        movement_type in (
            'opening_balance',
            'sale',
            'sale_void',
            'goods_receipt',
            'goods_receipt_cancel',
            'stock_opname',
            'return',
            'return_cancel',
            'adjustment'
        )
    );

-- ------------------------------------------------
-- SUPPLIERS
-- ------------------------------------------------
create table if not exists public.suppliers (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,

    code text not null,
    name text not null,
    contact_person text,
    phone text,
    whatsapp text,
    email text,
    address text,
    payment_term_days integer not null default 0 check (payment_term_days >= 0),
    category text,
    note text,
    active boolean not null default true,

    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,

    legacy_source_id text,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists suppliers_store_code_unique
on public.suppliers(store_id, lower(btrim(code)))
where deleted_at is null;

create unique index if not exists suppliers_store_name_unique
on public.suppliers(store_id, lower(btrim(name)))
where deleted_at is null;

create unique index if not exists suppliers_legacy_unique
on public.suppliers(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists suppliers_store_active_idx
on public.suppliers(store_id, active, name)
where deleted_at is null;

-- ------------------------------------------------
-- PURCHASE ORDERS
-- ------------------------------------------------
create table if not exists public.purchase_orders (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    client_po_id uuid,
    po_number text not null,

    order_date date not null,
    estimated_arrival date,

    supplier_id uuid not null references public.suppliers(id) on delete restrict,
    supplier_name_snapshot text not null,
    supplier_contact_snapshot text,
    reference text,
    note text,

    status text not null default 'Draft'
        check (status in ('Draft','PendingApproval','Ordered','Partial','Received','Cancelled')),
    approval_status text,

    created_by uuid not null references auth.users(id) on delete restrict,
    created_username text not null,
    created_role text not null,

    approved_by uuid references auth.users(id) on delete restrict,
    approved_username text,
    approved_at timestamptz,

    cancelled_by uuid references auth.users(id) on delete restrict,
    cancelled_username text,
    cancelled_at timestamptz,
    cancel_reason text,

    total_item_types integer not null default 0,
    total_qty numeric(16,3) not null default 0,
    total_received numeric(16,3) not null default 0,
    total_value numeric(16,2) not null default 0,

    legacy_imported boolean not null default false,
    history_only boolean not null default false,
    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists purchase_orders_store_client_unique
on public.purchase_orders(store_id, client_po_id)
where client_po_id is not null;

create unique index if not exists purchase_orders_store_number_unique
on public.purchase_orders(store_id, lower(btrim(po_number)))
where deleted_at is null;

create unique index if not exists purchase_orders_legacy_unique
on public.purchase_orders(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists purchase_orders_store_status_idx
on public.purchase_orders(store_id, status, order_date desc)
where deleted_at is null;

create table if not exists public.purchase_order_items (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
    product_id uuid references public.products(id) on delete restrict,

    product_name_snapshot text not null,
    barcode_snapshot text,
    category_snapshot text,
    unit_snapshot text,
    stock_snapshot numeric(16,3) not null default 0,

    qty_ordered numeric(16,3) not null check (qty_ordered > 0),
    qty_received numeric(16,3) not null default 0 check (qty_received >= 0),
    purchase_price numeric(16,2) not null default 0 check (purchase_price >= 0),
    line_subtotal numeric(16,2) not null default 0,

    legacy_item_id text,
    created_at timestamptz not null default now()
);

create index if not exists purchase_order_items_po_idx
on public.purchase_order_items(purchase_order_id);

create index if not exists purchase_order_items_product_idx
on public.purchase_order_items(store_id, product_id);

-- ------------------------------------------------
-- GOODS RECEIPTS
-- ------------------------------------------------
create table if not exists public.goods_receipts (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    client_gr_id uuid,
    gr_number text not null,

    business_date date not null,
    received_at timestamptz not null default now(),

    supplier_id uuid not null references public.suppliers(id) on delete restrict,
    supplier_name_snapshot text not null,
    delivery_note_number text not null,
    purchase_order_id uuid references public.purchase_orders(id) on delete restrict,
    purchase_order_number_snapshot text,
    note text,

    status text not null default 'PendingApproval'
        check (status in ('PendingApproval','Accepted','Cancelled')),
    approval_status text,

    created_by uuid not null references auth.users(id) on delete restrict,
    created_username text not null,
    created_role text not null,

    approved_by uuid references auth.users(id) on delete restrict,
    approved_username text,
    approved_at timestamptz,

    cancelled_by uuid references auth.users(id) on delete restrict,
    cancelled_username text,
    cancelled_at timestamptz,
    cancel_reason text,

    total_item_types integer not null default 0,
    total_qty numeric(16,3) not null default 0,
    total_value numeric(16,2) not null default 0,

    stock_effect_applied boolean not null default false,
    stock_effect_reversed boolean not null default false,

    legacy_imported boolean not null default false,
    history_only boolean not null default false,
    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists goods_receipts_store_client_unique
on public.goods_receipts(store_id, client_gr_id)
where client_gr_id is not null;

create unique index if not exists goods_receipts_store_number_unique
on public.goods_receipts(store_id, lower(btrim(gr_number)))
where deleted_at is null;

create unique index if not exists goods_receipts_legacy_unique
on public.goods_receipts(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists goods_receipts_store_status_idx
on public.goods_receipts(store_id, status, business_date desc)
where deleted_at is null;

create table if not exists public.goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    goods_receipt_id uuid not null references public.goods_receipts(id) on delete restrict,
    product_id uuid references public.products(id) on delete restrict,
    purchase_order_item_id uuid references public.purchase_order_items(id) on delete restrict,

    product_name_snapshot text not null,
    barcode_snapshot text,
    category_snapshot text,
    unit_snapshot text,

    qty_received numeric(16,3) not null check (qty_received > 0),
    purchase_price_before numeric(16,2) not null default 0,
    purchase_price numeric(16,2) not null default 0 check (purchase_price >= 0),
    line_subtotal numeric(16,2) not null default 0,
    expiry_date date,

    stock_before numeric(16,3),
    stock_after numeric(16,3),
    stock_effect_applied boolean not null default false,

    legacy_item_id text,
    created_at timestamptz not null default now()
);

create index if not exists goods_receipt_items_gr_idx
on public.goods_receipt_items(goods_receipt_id);

create index if not exists goods_receipt_items_product_idx
on public.goods_receipt_items(store_id, product_id);

-- ------------------------------------------------
-- Touch triggers
-- ------------------------------------------------
drop trigger if exists trg_suppliers_touch_row on public.suppliers;
create trigger trg_suppliers_touch_row
before update on public.suppliers
for each row execute function public.ldm_touch_row();

drop trigger if exists trg_purchase_orders_touch_row on public.purchase_orders;
create trigger trg_purchase_orders_touch_row
before update on public.purchase_orders
for each row execute function public.ldm_touch_row();

drop trigger if exists trg_goods_receipts_touch_row on public.goods_receipts;
create trigger trg_goods_receipts_touch_row
before update on public.goods_receipts
for each row execute function public.ldm_touch_row();

-- ------------------------------------------------
-- RLS + privileges
-- Browser read: Owner/Admin same store.
-- Semua write lewat SECURITY DEFINER RPC.
-- ------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;

revoke all on public.suppliers from anon;
revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
revoke all on public.goods_receipts from anon;
revoke all on public.goods_receipt_items from anon;

revoke insert, update, delete on public.suppliers from authenticated;
revoke insert, update, delete on public.purchase_orders from authenticated;
revoke insert, update, delete on public.purchase_order_items from authenticated;
revoke insert, update, delete on public.goods_receipts from authenticated;
revoke insert, update, delete on public.goods_receipt_items from authenticated;

grant select on public.suppliers to authenticated;
grant select on public.purchase_orders to authenticated;
grant select on public.purchase_order_items to authenticated;
grant select on public.goods_receipts to authenticated;
grant select on public.goods_receipt_items to authenticated;

drop policy if exists suppliers_select_store on public.suppliers;
create policy suppliers_select_store on public.suppliers
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
    and deleted_at is null
);

drop policy if exists purchase_orders_select_store on public.purchase_orders;
create policy purchase_orders_select_store on public.purchase_orders
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
    and deleted_at is null
);

drop policy if exists purchase_order_items_select_store on public.purchase_order_items;
create policy purchase_order_items_select_store on public.purchase_order_items
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists goods_receipts_select_store on public.goods_receipts;
create policy goods_receipts_select_store on public.goods_receipts
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
    and deleted_at is null
);

drop policy if exists goods_receipt_items_select_store on public.goods_receipt_items;
create policy goods_receipt_items_select_store on public.goods_receipt_items
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
);

-- ------------------------------------------------
-- Helpers
-- ------------------------------------------------
create or replace function public.ldm_procurement_assert_owner_admin()
returns table(store_id uuid, role text, username text)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store uuid;
    v_role text;
    v_username text;
begin
    v_store := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    if auth.uid() is null or v_store is null then
        raise exception 'Auth session/profile cloud tidak tersedia.';
    end if;

    if v_role not in ('owner','admin') then
        raise exception 'Fitur Supplier/Pembelian hanya untuk Owner/Admin.';
    end if;

    return query select v_store, v_role, v_username;
end;
$$;

revoke all on function public.ldm_procurement_assert_owner_admin() from public, anon;
grant execute on function public.ldm_procurement_assert_owner_admin() to authenticated;

create or replace function public.ldm_recalculate_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ordered numeric(16,3);
    v_received numeric(16,3);
    v_types integer;
    v_value numeric(16,2);
    v_current_status text;
begin
    select status into v_current_status
    from public.purchase_orders
    where id = p_po_id
    for update;

    if v_current_status is null then
        return;
    end if;

    select
        count(*),
        coalesce(sum(qty_ordered),0),
        coalesce(sum(qty_received),0),
        coalesce(sum(line_subtotal),0)
    into v_types, v_ordered, v_received, v_value
    from public.purchase_order_items
    where purchase_order_id = p_po_id;

    update public.purchase_orders
       set total_item_types = v_types,
           total_qty = v_ordered,
           total_received = v_received,
           total_value = v_value,
           status = case
               when v_current_status = 'Cancelled' then 'Cancelled'
               when v_current_status in ('Draft','PendingApproval') then v_current_status
               when v_received <= 0 then 'Ordered'
               when v_received < v_ordered then 'Partial'
               else 'Received'
           end
     where id = p_po_id;
end;
$$;

revoke all on function public.ldm_recalculate_purchase_order(uuid) from public, anon, authenticated;

-- ------------------------------------------------
-- Supplier RPC
-- ------------------------------------------------
create or replace function public.ldm_save_supplier(
    p_supplier_id uuid,
    p_code text,
    p_name text,
    p_contact_person text default null,
    p_phone text default null,
    p_whatsapp text default null,
    p_email text default null,
    p_address text default null,
    p_payment_term_days integer default 0,
    p_category text default null,
    p_note text default null,
    p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ctx record;
    v_id uuid;
    v_code text;
    v_name text;
    v_row public.suppliers%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    v_code := btrim(coalesce(p_code,''));
    v_name := btrim(coalesce(p_name,''));

    if v_name = '' then
        raise exception 'Nama Supplier wajib diisi.';
    end if;

    if v_code = '' then
        v_code := 'SUP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    end if;

    if p_supplier_id is null then
        insert into public.suppliers(
            store_id, code, name, contact_person, phone, whatsapp, email,
            address, payment_term_days, category, note, active,
            created_by, updated_by
        ) values (
            v_ctx.store_id, v_code, v_name,
            nullif(btrim(coalesce(p_contact_person,'')),''),
            nullif(btrim(coalesce(p_phone,'')),''),
            nullif(btrim(coalesce(p_whatsapp,'')),''),
            nullif(btrim(coalesce(p_email,'')),''),
            nullif(btrim(coalesce(p_address,'')),''),
            greatest(coalesce(p_payment_term_days,0),0),
            nullif(btrim(coalesce(p_category,'')),''),
            nullif(btrim(coalesce(p_note,'')),''),
            coalesce(p_active,true), auth.uid(), auth.uid()
        ) returning * into v_row;
    else
        update public.suppliers
           set code = v_code,
               name = v_name,
               contact_person = nullif(btrim(coalesce(p_contact_person,'')),''),
               phone = nullif(btrim(coalesce(p_phone,'')),''),
               whatsapp = nullif(btrim(coalesce(p_whatsapp,'')),''),
               email = nullif(btrim(coalesce(p_email,'')),''),
               address = nullif(btrim(coalesce(p_address,'')),''),
               payment_term_days = greatest(coalesce(p_payment_term_days,0),0),
               category = nullif(btrim(coalesce(p_category,'')),''),
               note = nullif(btrim(coalesce(p_note,'')),''),
               active = coalesce(p_active,true),
               updated_by = auth.uid()
         where id = p_supplier_id
           and store_id = v_ctx.store_id
           and deleted_at is null
        returning * into v_row;

        if v_row.id is null then
            raise exception 'Supplier tidak ditemukan.';
        end if;
    end if;

    return to_jsonb(v_row);
exception
    when unique_violation then
        raise exception 'Kode atau nama Supplier sudah digunakan.';
end;
$$;

revoke all on function public.ldm_save_supplier(uuid,text,text,text,text,text,text,text,integer,text,text,boolean)
from public, anon;
grant execute on function public.ldm_save_supplier(uuid,text,text,text,text,text,text,text,integer,text,text,boolean)
to authenticated;

create or replace function public.ldm_soft_delete_supplier(p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ctx record;
    v_row public.suppliers%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus Supplier.';
    end if;

    select * into v_row
    from public.suppliers
    where id = p_supplier_id
      and store_id = v_ctx.store_id
      and deleted_at is null
    for update;

    if v_row.id is null then
        raise exception 'Supplier tidak ditemukan.';
    end if;

    if exists (
        select 1 from public.purchase_orders
        where supplier_id = v_row.id
          and deleted_at is null
    ) or exists (
        select 1 from public.goods_receipts
        where supplier_id = v_row.id
          and deleted_at is null
    ) then
        raise exception 'Supplier sudah dipakai pada histori pembelian. Nonaktifkan Supplier, jangan hapus.';
    end if;

    update public.suppliers
       set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
     where id = v_row.id;

    return jsonb_build_object('id',v_row.id,'deleted',true);
end;
$$;

revoke all on function public.ldm_soft_delete_supplier(uuid) from public, anon;
grant execute on function public.ldm_soft_delete_supplier(uuid) to authenticated;

-- ------------------------------------------------
-- Purchase Order save/approve/cancel/delete
-- ------------------------------------------------
create or replace function public.ldm_save_purchase_order(
    p_purchase_order_id uuid,
    p_client_po_id uuid,
    p_po_number text,
    p_order_date date,
    p_estimated_arrival date,
    p_supplier_id uuid,
    p_supplier_contact text,
    p_reference text,
    p_note text,
    p_requested_status text,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ctx record;
    v_supplier public.suppliers%rowtype;
    v_po public.purchase_orders%rowtype;
    v_existing public.purchase_orders%rowtype;
    v_item jsonb;
    v_product public.products%rowtype;
    v_status text;
    v_qty numeric(16,3);
    v_price numeric(16,2);
    v_client uuid;
    v_po_number text;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();

    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
        raise exception 'Purchase Order harus mempunyai minimal satu item.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_items) x
        group by x->>'product_id'
        having count(*) > 1
    ) then
        raise exception 'Produk yang sama tidak boleh muncul dua kali pada satu Purchase Order.';
    end if;

    select * into v_supplier
    from public.suppliers
    where id = p_supplier_id
      and store_id = v_ctx.store_id
      and active = true
      and deleted_at is null;

    if v_supplier.id is null then
        raise exception 'Supplier tidak ditemukan atau nonaktif.';
    end if;

    v_po_number := btrim(coalesce(p_po_number,''));
    if v_po_number = '' then
        raise exception 'Nomor PO wajib diisi.';
    end if;

    v_status := case
        when coalesce(p_requested_status,'') = 'Draft' then 'Draft'
        when v_ctx.role = 'owner' then 'Ordered'
        else 'PendingApproval'
    end;

    if p_purchase_order_id is null and p_client_po_id is not null then
        select * into v_existing
        from public.purchase_orders
        where store_id = v_ctx.store_id
          and client_po_id = p_client_po_id
          and deleted_at is null
        limit 1;
        if v_existing.id is not null then
            return to_jsonb(v_existing);
        end if;
    end if;

    if p_purchase_order_id is not null then
        select * into v_existing
        from public.purchase_orders
        where id = p_purchase_order_id
          and store_id = v_ctx.store_id
          and deleted_at is null
        for update;

        if v_existing.id is null then
            raise exception 'Purchase Order tidak ditemukan.';
        end if;
        if v_existing.history_only then
            raise exception 'PO hasil migrasi hanya untuk histori.';
        end if;
        if v_existing.status <> 'Draft' then
            raise exception 'Hanya PO Draft yang dapat diedit.';
        end if;

        update public.purchase_orders
           set po_number = v_po_number,
               order_date = coalesce(p_order_date,current_date),
               estimated_arrival = p_estimated_arrival,
               supplier_id = v_supplier.id,
               supplier_name_snapshot = v_supplier.name,
               supplier_contact_snapshot = nullif(btrim(coalesce(p_supplier_contact,'')),''),
               reference = nullif(btrim(coalesce(p_reference,'')),''),
               note = nullif(btrim(coalesce(p_note,'')),''),
               status = v_status,
               approval_status = case when v_status='PendingApproval' then 'Pending' when v_status='Ordered' then 'Approved' else null end,
               approved_by = case when v_status='Ordered' then auth.uid() else null end,
               approved_username = case when v_status='Ordered' then v_ctx.username else null end,
               approved_at = case when v_status='Ordered' then now() else null end
         where id = v_existing.id
        returning * into v_po;

        delete from public.purchase_order_items
        where purchase_order_id = v_po.id;
    else
        v_client := coalesce(p_client_po_id,gen_random_uuid());
        insert into public.purchase_orders(
            store_id, client_po_id, po_number, order_date, estimated_arrival,
            supplier_id, supplier_name_snapshot, supplier_contact_snapshot,
            reference, note, status, approval_status,
            created_by, created_username, created_role,
            approved_by, approved_username, approved_at
        ) values (
            v_ctx.store_id, v_client, v_po_number, coalesce(p_order_date,current_date), p_estimated_arrival,
            v_supplier.id, v_supplier.name, nullif(btrim(coalesce(p_supplier_contact,'')),''),
            nullif(btrim(coalesce(p_reference,'')),''), nullif(btrim(coalesce(p_note,'')),''),
            v_status,
            case when v_status='PendingApproval' then 'Pending' when v_status='Ordered' then 'Approved' else null end,
            auth.uid(), v_ctx.username, v_ctx.role,
            case when v_status='Ordered' then auth.uid() else null end,
            case when v_status='Ordered' then v_ctx.username else null end,
            case when v_status='Ordered' then now() else null end
        ) returning * into v_po;
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        select * into v_product
        from public.products
        where id = nullif(v_item->>'product_id','')::uuid
          and store_id = v_ctx.store_id
          and active = true
          and deleted_at is null;

        if v_product.id is null then
            raise exception 'Produk PO tidak ditemukan di cloud.';
        end if;

        v_qty := coalesce((v_item->>'qty')::numeric,0);
        v_price := greatest(coalesce((v_item->>'purchase_price')::numeric,0),0);
        if v_qty <= 0 then
            raise exception 'Qty PO harus lebih dari 0.';
        end if;

        insert into public.purchase_order_items(
            store_id, purchase_order_id, product_id,
            product_name_snapshot, barcode_snapshot, category_snapshot, unit_snapshot,
            stock_snapshot, qty_ordered, qty_received, purchase_price, line_subtotal,
            legacy_item_id
        ) values (
            v_ctx.store_id, v_po.id, v_product.id,
            v_product.name, v_product.barcode, v_product.category, v_product.unit,
            v_product.legacy_stock_snapshot, v_qty, 0, v_price, v_qty*v_price,
            nullif(v_item->>'client_item_id','')
        );
    end loop;

    perform public.ldm_recalculate_purchase_order(v_po.id);
    select * into v_po from public.purchase_orders where id=v_po.id;
    return to_jsonb(v_po);
exception
    when unique_violation then
        raise exception 'Nomor PO sudah digunakan.';
end;
$$;

revoke all on function public.ldm_save_purchase_order(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)
from public, anon;
grant execute on function public.ldm_save_purchase_order(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)
to authenticated;

create or replace function public.ldm_approve_purchase_order(p_purchase_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ctx record; v_po public.purchase_orders%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role <> 'owner' then raise exception 'Hanya Owner yang dapat Accept Purchase Order.'; end if;

    select * into v_po from public.purchase_orders
    where id=p_purchase_order_id and store_id=v_ctx.store_id and deleted_at is null
    for update;

    if v_po.id is null then raise exception 'Purchase Order tidak ditemukan.'; end if;
    if v_po.history_only then raise exception 'PO hasil migrasi hanya untuk histori.'; end if;
    if v_po.status <> 'PendingApproval' then raise exception 'PO tidak lagi Pending Approval.'; end if;

    update public.purchase_orders
       set status='Ordered', approval_status='Approved', approved_by=auth.uid(),
           approved_username=v_ctx.username, approved_at=now()
     where id=v_po.id returning * into v_po;

    return to_jsonb(v_po);
end;
$$;
revoke all on function public.ldm_approve_purchase_order(uuid) from public, anon;
grant execute on function public.ldm_approve_purchase_order(uuid) to authenticated;

create or replace function public.ldm_cancel_purchase_order(p_purchase_order_id uuid,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ctx record; v_po public.purchase_orders%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role <> 'owner' then raise exception 'Hanya Owner yang dapat membatalkan Purchase Order.'; end if;

    select * into v_po from public.purchase_orders
    where id=p_purchase_order_id and store_id=v_ctx.store_id and deleted_at is null
    for update;

    if v_po.id is null then raise exception 'Purchase Order tidak ditemukan.'; end if;
    if v_po.history_only then raise exception 'PO hasil migrasi hanya untuk histori.'; end if;
    if v_po.status in ('Received','Cancelled') then raise exception 'PO ini tidak dapat dibatalkan.'; end if;

    if exists (
        select 1 from public.goods_receipts
        where purchase_order_id=v_po.id
          and status='PendingApproval'
          and deleted_at is null
    ) then
        raise exception 'Masih ada Goods Receipt Pending untuk PO ini. Batalkan GR terlebih dahulu.';
    end if;

    update public.purchase_orders
       set status='Cancelled', cancelled_by=auth.uid(), cancelled_username=v_ctx.username,
           cancelled_at=now(), cancel_reason=nullif(btrim(coalesce(p_reason,'')),'')
     where id=v_po.id returning * into v_po;

    return to_jsonb(v_po);
end;
$$;
revoke all on function public.ldm_cancel_purchase_order(uuid,text) from public, anon;
grant execute on function public.ldm_cancel_purchase_order(uuid,text) to authenticated;

create or replace function public.ldm_soft_delete_purchase_order(p_purchase_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ctx record; v_po public.purchase_orders%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role <> 'owner' then raise exception 'Hanya Owner yang dapat menghapus Purchase Order.'; end if;

    select * into v_po from public.purchase_orders
    where id=p_purchase_order_id and store_id=v_ctx.store_id and deleted_at is null
    for update;

    if v_po.id is null then raise exception 'Purchase Order tidak ditemukan.'; end if;
    if v_po.status not in ('Draft','PendingApproval','Cancelled') then
        raise exception 'PO Ordered/Partial/Received tidak boleh dihapus. Batalkan sesuai alur audit.';
    end if;
    if exists(select 1 from public.goods_receipts where purchase_order_id=v_po.id and deleted_at is null) then
        raise exception 'PO sudah mempunyai Goods Receipt dan tidak boleh dihapus.';
    end if;

    update public.purchase_orders set deleted_at=now(),deleted_by=auth.uid() where id=v_po.id;
    return jsonb_build_object('id',v_po.id,'deleted',true);
end;
$$;
revoke all on function public.ldm_soft_delete_purchase_order(uuid) from public, anon;
grant execute on function public.ldm_soft_delete_purchase_order(uuid) to authenticated;

-- ------------------------------------------------
-- Internal apply Goods Receipt atomically.
-- ------------------------------------------------
create or replace function public.ldm_apply_goods_receipt_internal(p_gr_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_gr public.goods_receipts%rowtype;
    v_item public.goods_receipt_items%rowtype;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
begin
    select * into v_gr
    from public.goods_receipts
    where id=p_gr_id and deleted_at is null
    for update;

    if v_gr.id is null then raise exception 'Goods Receipt tidak ditemukan.'; end if;
    if v_gr.history_only then raise exception 'Goods Receipt hasil migrasi hanya untuk histori.'; end if;
    if v_gr.stock_effect_applied and not v_gr.stock_effect_reversed then return; end if;

    for v_item in
        select * from public.goods_receipt_items
        where goods_receipt_id=v_gr.id
        order by product_id::text, id::text
    loop
        if v_item.product_id is null then
            raise exception 'Item Goods Receipt tidak mempunyai product_id cloud.';
        end if;

        select * into v_product
        from public.products
        where id=v_item.product_id
          and store_id=v_gr.store_id
          and active=true
          and deleted_at is null
        for update;

        if v_product.id is null then raise exception 'Produk Goods Receipt tidak ditemukan.'; end if;

        v_before := v_product.legacy_stock_snapshot;
        v_after := v_before + v_item.qty_received;

        update public.products
           set legacy_stock_snapshot=v_after,
               purchase_price=v_item.purchase_price,
               last_expiry_date=coalesce(v_item.expiry_date,last_expiry_date)
         where id=v_product.id;

        update public.goods_receipt_items
           set stock_before=v_before, stock_after=v_after, stock_effect_applied=true
         where id=v_item.id;

        insert into public.stock_movements(
            store_id,product_id,movement_type,quantity_change,stock_before,stock_after,
            unit_cost_snapshot,source_type,source_id,reference_code,note,created_by,occurred_at
        ) values (
            v_gr.store_id,v_product.id,'goods_receipt',v_item.qty_received,v_before,v_after,
            v_item.purchase_price,'goods_receipt',v_item.id::text,v_gr.gr_number,
            'Penerimaan barang '||v_gr.gr_number,auth.uid(),now()
        ) on conflict (store_id,product_id,source_type,source_id)
          where source_type is not null and source_id is not null
          do nothing;

        if v_item.purchase_order_item_id is not null then
            update public.purchase_order_items
               set qty_received = qty_received + v_item.qty_received
             where id=v_item.purchase_order_item_id;
        end if;
    end loop;

    if v_gr.purchase_order_id is not null then
        perform public.ldm_recalculate_purchase_order(v_gr.purchase_order_id);
    end if;

    update public.goods_receipts
       set stock_effect_applied=true,
           stock_effect_reversed=false,
           status='Accepted',
           approval_status='Approved',
           approved_by=coalesce(approved_by,auth.uid()),
           approved_username=coalesce(approved_username,public.ldm_current_username()),
           approved_at=coalesce(approved_at,now())
     where id=v_gr.id;
end;
$$;
revoke all on function public.ldm_apply_goods_receipt_internal(uuid) from public, anon, authenticated;

-- ------------------------------------------------
-- Goods Receipt submit/approve/cancel
-- ------------------------------------------------
create or replace function public.ldm_submit_goods_receipt(
    p_client_gr_id uuid,
    p_gr_number text,
    p_business_date date,
    p_supplier_id uuid,
    p_delivery_note_number text,
    p_purchase_order_id uuid,
    p_note text,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ctx record;
    v_supplier public.suppliers%rowtype;
    v_po public.purchase_orders%rowtype;
    v_gr public.goods_receipts%rowtype;
    v_existing public.goods_receipts%rowtype;
    v_item jsonb;
    v_product public.products%rowtype;
    v_po_item public.purchase_order_items%rowtype;
    v_qty numeric(16,3);
    v_price numeric(16,2);
    v_pending numeric(16,3);
    v_remaining numeric(16,3);
    v_total_qty numeric(16,3):=0;
    v_total_value numeric(16,2):=0;
    v_types integer:=0;
    v_status text;
    v_gr_number text;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();

    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
        raise exception 'Goods Receipt harus mempunyai minimal satu item.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_items) x
        group by x->>'product_id'
        having count(*) > 1
    ) then
        raise exception 'Produk yang sama tidak boleh muncul dua kali pada satu Goods Receipt.';
    end if;

    select * into v_supplier from public.suppliers
    where id=p_supplier_id and store_id=v_ctx.store_id and active=true and deleted_at is null;
    if v_supplier.id is null then raise exception 'Supplier tidak ditemukan atau nonaktif.'; end if;

    v_gr_number := btrim(coalesce(p_gr_number,''));
    if v_gr_number='' then raise exception 'Nomor Goods Receipt wajib diisi.'; end if;
    if btrim(coalesce(p_delivery_note_number,''))='' then raise exception 'Nomor surat jalan wajib diisi.'; end if;

    if p_client_gr_id is not null then
        select * into v_existing from public.goods_receipts
        where store_id=v_ctx.store_id and client_gr_id=p_client_gr_id and deleted_at is null limit 1;
        if v_existing.id is not null then return to_jsonb(v_existing); end if;
    end if;

    if p_purchase_order_id is not null then
        select * into v_po from public.purchase_orders
        where id=p_purchase_order_id and store_id=v_ctx.store_id and deleted_at is null
        for update;
        if v_po.id is null then raise exception 'Purchase Order tidak ditemukan.'; end if;
        if v_po.history_only then raise exception 'PO hasil migrasi hanya untuk histori dan tidak dapat diterima.'; end if;
        if v_po.status not in ('Ordered','Partial') then raise exception 'Status PO tidak siap untuk Goods Receipt.'; end if;
        if v_po.supplier_id<>v_supplier.id then raise exception 'Supplier Goods Receipt tidak sama dengan Supplier PO.'; end if;
    end if;

    v_status := case when v_ctx.role='owner' then 'Accepted' else 'PendingApproval' end;

    insert into public.goods_receipts(
        store_id,client_gr_id,gr_number,business_date,supplier_id,supplier_name_snapshot,
        delivery_note_number,purchase_order_id,purchase_order_number_snapshot,note,
        status,approval_status,created_by,created_username,created_role,
        approved_by,approved_username,approved_at
    ) values (
        v_ctx.store_id,coalesce(p_client_gr_id,gen_random_uuid()),v_gr_number,
        coalesce(p_business_date,current_date),v_supplier.id,v_supplier.name,
        btrim(p_delivery_note_number),v_po.id,case when v_po.id is null then null else v_po.po_number end,
        nullif(btrim(coalesce(p_note,'')),''),v_status,
        case when v_status='Accepted' then 'Approved' else 'Pending' end,
        auth.uid(),v_ctx.username,v_ctx.role,
        case when v_status='Accepted' then auth.uid() else null end,
        case when v_status='Accepted' then v_ctx.username else null end,
        case when v_status='Accepted' then now() else null end
    ) returning * into v_gr;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        select * into v_product from public.products
        where id=nullif(v_item->>'product_id','')::uuid
          and store_id=v_ctx.store_id and active=true and deleted_at is null
        for update;
        if v_product.id is null then raise exception 'Produk Goods Receipt tidak ditemukan.'; end if;

        v_qty := coalesce((v_item->>'qty')::numeric,0);
        v_price := greatest(coalesce((v_item->>'purchase_price')::numeric,0),0);
        if v_qty<=0 then raise exception 'Qty Goods Receipt harus lebih dari 0.'; end if;

        v_po_item.id := null;
        if v_po.id is not null then
            select * into v_po_item from public.purchase_order_items
            where purchase_order_id=v_po.id and product_id=v_product.id
            order by id limit 1
            for update;
            if v_po_item.id is null then raise exception 'Produk % tidak ada pada PO %.',v_product.name,v_po.po_number; end if;

            select coalesce(sum(gri.qty_received),0) into v_pending
            from public.goods_receipt_items gri
            join public.goods_receipts gr on gr.id=gri.goods_receipt_id
            where gri.purchase_order_item_id=v_po_item.id
              and gr.status='PendingApproval'
              and gr.deleted_at is null;

            v_remaining := v_po_item.qty_ordered - v_po_item.qty_received - v_pending;
            if v_qty > v_remaining then
                raise exception 'Qty % melebihi sisa penerimaan PO untuk % (sisa %).',v_qty,v_product.name,v_remaining;
            end if;
        end if;

        insert into public.goods_receipt_items(
            store_id,goods_receipt_id,product_id,purchase_order_item_id,
            product_name_snapshot,barcode_snapshot,category_snapshot,unit_snapshot,
            qty_received,purchase_price_before,purchase_price,line_subtotal,expiry_date,
            legacy_item_id
        ) values (
            v_ctx.store_id,v_gr.id,v_product.id,v_po_item.id,
            v_product.name,v_product.barcode,v_product.category,v_product.unit,
            v_qty,v_product.purchase_price,v_price,v_qty*v_price,
            nullif(v_item->>'expiry_date','')::date,nullif(v_item->>'client_item_id','')
        );

        v_total_qty:=v_total_qty+v_qty;
        v_total_value:=v_total_value+(v_qty*v_price);
        v_types:=v_types+1;
    end loop;

    update public.goods_receipts
       set total_item_types=v_types,total_qty=v_total_qty,total_value=v_total_value
     where id=v_gr.id;

    if v_status='Accepted' then
        perform public.ldm_apply_goods_receipt_internal(v_gr.id);
    end if;

    select * into v_gr from public.goods_receipts where id=v_gr.id;
    return to_jsonb(v_gr);
exception
    when unique_violation then
        raise exception 'Nomor Goods Receipt sudah digunakan.';
end;
$$;

revoke all on function public.ldm_submit_goods_receipt(uuid,text,date,uuid,text,uuid,text,jsonb)
from public, anon;
grant execute on function public.ldm_submit_goods_receipt(uuid,text,date,uuid,text,uuid,text,jsonb)
to authenticated;

create or replace function public.ldm_approve_goods_receipt(p_goods_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ctx record; v_gr public.goods_receipts%rowtype;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role<>'owner' then raise exception 'Hanya Owner yang dapat Accept Goods Receipt.'; end if;

    select * into v_gr from public.goods_receipts
    where id=p_goods_receipt_id and store_id=v_ctx.store_id and deleted_at is null
    for update;
    if v_gr.id is null then raise exception 'Goods Receipt tidak ditemukan.'; end if;
    if v_gr.history_only then raise exception 'Goods Receipt hasil migrasi hanya untuk histori.'; end if;
    if v_gr.status<>'PendingApproval' then raise exception 'Goods Receipt tidak lagi Pending Approval.'; end if;

    -- Reservation sudah dibuat saat submit. Apply terhadap stok terbaru.
    perform public.ldm_apply_goods_receipt_internal(v_gr.id);
    select * into v_gr from public.goods_receipts where id=v_gr.id;
    return to_jsonb(v_gr);
end;
$$;
revoke all on function public.ldm_approve_goods_receipt(uuid) from public, anon;
grant execute on function public.ldm_approve_goods_receipt(uuid) to authenticated;

create or replace function public.ldm_cancel_goods_receipt(p_goods_receipt_id uuid,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ctx record;
    v_gr public.goods_receipts%rowtype;
    v_item public.goods_receipt_items%rowtype;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role<>'owner' then raise exception 'Hanya Owner yang dapat membatalkan Goods Receipt.'; end if;

    select * into v_gr from public.goods_receipts
    where id=p_goods_receipt_id and store_id=v_ctx.store_id and deleted_at is null
    for update;
    if v_gr.id is null then raise exception 'Goods Receipt tidak ditemukan.'; end if;
    if v_gr.history_only then raise exception 'Goods Receipt hasil migrasi hanya untuk histori.'; end if;
    if v_gr.status='Cancelled' then return to_jsonb(v_gr); end if;

    if v_gr.stock_effect_applied and not v_gr.stock_effect_reversed then
        for v_item in
            select * from public.goods_receipt_items
            where goods_receipt_id=v_gr.id
            order by product_id::text,id::text
        loop
            select * into v_product from public.products
            where id=v_item.product_id and store_id=v_ctx.store_id and deleted_at is null
            for update;
            if v_product.id is null then raise exception 'Produk rollback Goods Receipt tidak ditemukan.'; end if;

            v_before:=v_product.legacy_stock_snapshot;
            if v_before < v_item.qty_received then
                raise exception 'Rollback % gagal: stok sekarang % lebih kecil dari qty receipt %.',v_product.name,v_before,v_item.qty_received;
            end if;
            v_after:=v_before-v_item.qty_received;

            update public.products set legacy_stock_snapshot=v_after where id=v_product.id;

            insert into public.stock_movements(
                store_id,product_id,movement_type,quantity_change,stock_before,stock_after,
                unit_cost_snapshot,source_type,source_id,reference_code,note,created_by,occurred_at
            ) values (
                v_ctx.store_id,v_product.id,'goods_receipt_cancel',-v_item.qty_received,v_before,v_after,
                v_item.purchase_price,'goods_receipt_cancel',v_item.id::text,v_gr.gr_number,
                'Pembatalan Goods Receipt '||v_gr.gr_number,auth.uid(),now()
            ) on conflict (store_id,product_id,source_type,source_id)
              where source_type is not null and source_id is not null
              do nothing;

            if v_item.purchase_order_item_id is not null then
                update public.purchase_order_items
                   set qty_received=greatest(qty_received-v_item.qty_received,0)
                 where id=v_item.purchase_order_item_id;
            end if;
        end loop;

        if v_gr.purchase_order_id is not null then
            perform public.ldm_recalculate_purchase_order(v_gr.purchase_order_id);
        end if;
    end if;

    update public.goods_receipts
       set status='Cancelled',approval_status=case when approval_status='Pending' then 'Cancelled' else approval_status end,
           stock_effect_reversed=stock_effect_applied,
           cancelled_by=auth.uid(),cancelled_username=v_ctx.username,cancelled_at=now(),
           cancel_reason=nullif(btrim(coalesce(p_reason,'')),'')
     where id=v_gr.id returning * into v_gr;

    return to_jsonb(v_gr);
end;
$$;
revoke all on function public.ldm_cancel_goods_receipt(uuid,text) from public, anon;
grant execute on function public.ldm_cancel_goods_receipt(uuid,text) to authenticated;

-- ------------------------------------------------
-- Legacy import: HISTORY ONLY. Tidak menerapkan stok ulang.
-- ------------------------------------------------
create or replace function public.ldm_import_legacy_suppliers(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_ctx record; v_row jsonb; v_id text; v_name text; v_code text; v_count int:=0;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi Supplier.'; end if;
    if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Payload Supplier harus array.'; end if;

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        v_id:=coalesce(nullif(v_row->>'legacy_source_id',''),'supplier:'||coalesce(v_row->>'id',gen_random_uuid()::text));
        v_name:=btrim(coalesce(v_row->>'name',''));
        if v_name='' then continue; end if;
        v_code:=btrim(coalesce(v_row->>'code',''));
        if v_code='' then v_code:='SUP-'||upper(substr(md5(v_id),1,6)); end if;

        if exists(select 1 from public.suppliers where store_id=v_ctx.store_id and legacy_source_id=v_id) then continue; end if;
        if exists(select 1 from public.suppliers where store_id=v_ctx.store_id and lower(btrim(name))=lower(v_name) and deleted_at is null) then continue; end if;

        insert into public.suppliers(
            store_id,code,name,contact_person,phone,whatsapp,email,address,payment_term_days,
            category,note,active,created_by,updated_by,legacy_source_id,created_at
        ) values (
            v_ctx.store_id,v_code,v_name,nullif(v_row->>'contact_person',''),nullif(v_row->>'phone',''),
            nullif(v_row->>'whatsapp',''),nullif(v_row->>'email',''),nullif(v_row->>'address',''),
            greatest(coalesce((v_row->>'payment_term_days')::int,0),0),nullif(v_row->>'category',''),
            nullif(v_row->>'note',''),coalesce((v_row->>'active')::boolean,true),auth.uid(),auth.uid(),v_id,
            coalesce(nullif(v_row->>'created_at','')::timestamptz,now())
        );
        v_count:=v_count+1;
    end loop;
    return v_count;
end;
$$;
revoke all on function public.ldm_import_legacy_suppliers(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_suppliers(jsonb) to authenticated;

create or replace function public.ldm_import_legacy_purchase_orders(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
    v_ctx record; v_row jsonb; v_item jsonb; v_id text; v_supplier_id uuid; v_po_id uuid;
    v_product_id uuid; v_status text; v_count int:=0; v_number text;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi PO.'; end if;
    if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Payload PO harus array.'; end if;

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        v_id:=coalesce(nullif(v_row->>'legacy_source_id',''),'po:'||coalesce(v_row->>'id',gen_random_uuid()::text));
        if exists(select 1 from public.purchase_orders where store_id=v_ctx.store_id and legacy_source_id=v_id) then continue; end if;

        select id into v_supplier_id from public.suppliers
        where store_id=v_ctx.store_id and lower(btrim(name))=lower(btrim(coalesce(v_row->>'supplier',''))) and deleted_at is null limit 1;
        if v_supplier_id is null then
            insert into public.suppliers(store_id,code,name,active,created_by,updated_by,legacy_source_id)
            values(v_ctx.store_id,'SUP-'||upper(substr(md5(coalesce(v_row->>'supplier',v_id)),1,6)),coalesce(nullif(btrim(v_row->>'supplier'),''),'Legacy Supplier'),true,auth.uid(),auth.uid(),'auto:'||v_id)
            returning id into v_supplier_id;
        end if;

        v_status:=coalesce(nullif(v_row->>'status',''),'Draft');
        if v_status not in ('Draft','PendingApproval','Ordered','Partial','Received','Cancelled') then v_status:='Draft'; end if;
        v_number:=coalesce(nullif(btrim(v_row->>'po_number'),''),'LEGACY-PO-'||upper(substr(md5(v_id),1,8)));
        if exists(select 1 from public.purchase_orders where store_id=v_ctx.store_id and lower(btrim(po_number))=lower(v_number) and deleted_at is null) then
            v_number:=v_number||'-L'||upper(substr(md5(v_id),1,4));
        end if;

        insert into public.purchase_orders(
            store_id,po_number,order_date,estimated_arrival,supplier_id,supplier_name_snapshot,
            supplier_contact_snapshot,reference,note,status,approval_status,
            created_by,created_username,created_role,approved_username,approved_at,
            total_item_types,total_qty,total_received,total_value,
            legacy_imported,history_only,legacy_source_id,created_at
        ) values (
            v_ctx.store_id,v_number,coalesce(nullif(v_row->>'order_date','')::date,current_date),
            nullif(v_row->>'estimated_arrival','')::date,v_supplier_id,coalesce(v_row->>'supplier','Legacy Supplier'),
            nullif(v_row->>'supplier_contact',''),nullif(v_row->>'reference',''),nullif(v_row->>'note',''),
            v_status,nullif(v_row->>'approval_status',''),auth.uid(),coalesce(v_row->>'created_username','legacy'),
            coalesce(v_row->>'created_role','legacy'),nullif(v_row->>'approved_username',''),
            nullif(v_row->>'approved_at','')::timestamptz,0,0,0,0,true,true,v_id,
            coalesce(nullif(v_row->>'created_at','')::timestamptz,now())
        ) returning id into v_po_id;

        if jsonb_typeof(v_row->'items')='array' then
            for v_item in select value from jsonb_array_elements(v_row->'items')
            loop
                v_product_id:=null;
                select id into v_product_id from public.products
                where store_id=v_ctx.store_id and deleted_at is null and (
                    (nullif(v_item->>'barcode','') is not null and barcode=v_item->>'barcode')
                    or lower(name)=lower(coalesce(v_item->>'name',''))
                ) order by case when barcode=v_item->>'barcode' then 0 else 1 end limit 1;

                if coalesce((v_item->>'qty_ordered')::numeric,0)>0 then
                    insert into public.purchase_order_items(
                        store_id,purchase_order_id,product_id,product_name_snapshot,barcode_snapshot,category_snapshot,unit_snapshot,
                        stock_snapshot,qty_ordered,qty_received,purchase_price,line_subtotal,legacy_item_id
                    ) values (
                        v_ctx.store_id,v_po_id,v_product_id,coalesce(v_item->>'name','Legacy Item'),nullif(v_item->>'barcode',''),
                        nullif(v_item->>'category',''),coalesce(nullif(v_item->>'unit',''),'Pcs'),coalesce((v_item->>'stock_snapshot')::numeric,0),
                        (v_item->>'qty_ordered')::numeric,greatest(coalesce((v_item->>'qty_received')::numeric,0),0),
                        greatest(coalesce((v_item->>'purchase_price')::numeric,0),0),
                        coalesce((v_item->>'qty_ordered')::numeric,0)*greatest(coalesce((v_item->>'purchase_price')::numeric,0),0),
                        nullif(v_item->>'legacy_item_id','')
                    );
                end if;
            end loop;
        end if;
        perform public.ldm_recalculate_purchase_order(v_po_id);
        update public.purchase_orders set status=v_status where id=v_po_id;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;
$$;
revoke all on function public.ldm_import_legacy_purchase_orders(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_purchase_orders(jsonb) to authenticated;

create or replace function public.ldm_import_legacy_goods_receipts(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
    v_ctx record; v_row jsonb; v_item jsonb; v_id text; v_supplier_id uuid; v_gr_id uuid; v_po_id uuid;
    v_product_id uuid; v_status text; v_count int:=0; v_number text;
begin
    select * into v_ctx from public.ldm_procurement_assert_owner_admin();
    if v_ctx.role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi Goods Receipt.'; end if;
    if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Payload Goods Receipt harus array.'; end if;

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        v_id:=coalesce(nullif(v_row->>'legacy_source_id',''),'gr:'||coalesce(v_row->>'id',gen_random_uuid()::text));
        if exists(select 1 from public.goods_receipts where store_id=v_ctx.store_id and legacy_source_id=v_id) then continue; end if;

        select id into v_supplier_id from public.suppliers
        where store_id=v_ctx.store_id and lower(btrim(name))=lower(btrim(coalesce(v_row->>'supplier',''))) and deleted_at is null limit 1;
        if v_supplier_id is null then
            insert into public.suppliers(store_id,code,name,active,created_by,updated_by,legacy_source_id)
            values(v_ctx.store_id,'SUP-'||upper(substr(md5(coalesce(v_row->>'supplier',v_id)),1,6)),coalesce(nullif(btrim(v_row->>'supplier'),''),'Legacy Supplier'),true,auth.uid(),auth.uid(),'auto-gr:'||v_id)
            returning id into v_supplier_id;
        end if;

        v_po_id:=null;
        if nullif(v_row->>'purchase_order_no','') is not null then
            select id into v_po_id from public.purchase_orders
            where store_id=v_ctx.store_id and lower(po_number)=lower(v_row->>'purchase_order_no') and deleted_at is null limit 1;
        end if;

        v_status:=coalesce(nullif(v_row->>'status',''),'Accepted');
        if v_status not in ('PendingApproval','Accepted','Cancelled') then v_status:='Accepted'; end if;
        v_number:=coalesce(nullif(btrim(v_row->>'gr_number'),''),'LEGACY-GR-'||upper(substr(md5(v_id),1,8)));
        if exists(select 1 from public.goods_receipts where store_id=v_ctx.store_id and lower(btrim(gr_number))=lower(v_number) and deleted_at is null) then
            v_number:=v_number||'-L'||upper(substr(md5(v_id),1,4));
        end if;

        insert into public.goods_receipts(
            store_id,gr_number,business_date,supplier_id,supplier_name_snapshot,delivery_note_number,
            purchase_order_id,purchase_order_number_snapshot,note,status,approval_status,
            created_by,created_username,created_role,approved_username,approved_at,
            total_item_types,total_qty,total_value,stock_effect_applied,stock_effect_reversed,
            legacy_imported,history_only,legacy_source_id,created_at,received_at
        ) values (
            v_ctx.store_id,v_number,coalesce(nullif(v_row->>'business_date','')::date,current_date),v_supplier_id,
            coalesce(v_row->>'supplier','Legacy Supplier'),coalesce(nullif(v_row->>'delivery_note',''),'-'),v_po_id,
            nullif(v_row->>'purchase_order_no',''),nullif(v_row->>'note',''),v_status,nullif(v_row->>'approval_status',''),
            auth.uid(),coalesce(v_row->>'created_username','legacy'),coalesce(v_row->>'created_role','legacy'),
            nullif(v_row->>'approved_username',''),nullif(v_row->>'approved_at','')::timestamptz,
            0,0,0,false,false,true,true,v_id,coalesce(nullif(v_row->>'created_at','')::timestamptz,now()),
            coalesce(nullif(v_row->>'created_at','')::timestamptz,now())
        ) returning id into v_gr_id;

        if jsonb_typeof(v_row->'items')='array' then
            for v_item in select value from jsonb_array_elements(v_row->'items')
            loop
                v_product_id:=null;
                select id into v_product_id from public.products
                where store_id=v_ctx.store_id and deleted_at is null and (
                    (nullif(v_item->>'barcode','') is not null and barcode=v_item->>'barcode')
                    or lower(name)=lower(coalesce(v_item->>'name',''))
                ) order by case when barcode=v_item->>'barcode' then 0 else 1 end limit 1;

                if coalesce((v_item->>'qty')::numeric,0)>0 then
                    insert into public.goods_receipt_items(
                        store_id,goods_receipt_id,product_id,product_name_snapshot,barcode_snapshot,category_snapshot,unit_snapshot,
                        qty_received,purchase_price_before,purchase_price,line_subtotal,expiry_date,stock_before,stock_after,
                        stock_effect_applied,legacy_item_id
                    ) values (
                        v_ctx.store_id,v_gr_id,v_product_id,coalesce(v_item->>'name','Legacy Item'),nullif(v_item->>'barcode',''),
                        nullif(v_item->>'category',''),coalesce(nullif(v_item->>'unit',''),'Pcs'),(v_item->>'qty')::numeric,
                        greatest(coalesce((v_item->>'purchase_price_before')::numeric,0),0),greatest(coalesce((v_item->>'purchase_price')::numeric,0),0),
                        (v_item->>'qty')::numeric*greatest(coalesce((v_item->>'purchase_price')::numeric,0),0),
                        nullif(v_item->>'expiry_date','')::date,nullif(v_item->>'stock_before','')::numeric,nullif(v_item->>'stock_after','')::numeric,
                        false,nullif(v_item->>'legacy_item_id','')
                    );
                end if;
            end loop;
        end if;

        update public.goods_receipts gr set
            total_item_types=(select count(*) from public.goods_receipt_items where goods_receipt_id=gr.id),
            total_qty=(select coalesce(sum(qty_received),0) from public.goods_receipt_items where goods_receipt_id=gr.id),
            total_value=(select coalesce(sum(line_subtotal),0) from public.goods_receipt_items where goods_receipt_id=gr.id)
        where gr.id=v_gr_id;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;
$$;
revoke all on function public.ldm_import_legacy_goods_receipts(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_goods_receipts(jsonb) to authenticated;

-- ------------------------------------------------
-- Realtime
-- ------------------------------------------------
do $$
declare v_table text;
begin
    if exists(select 1 from pg_publication where pubname='supabase_realtime') then
        foreach v_table in array array['suppliers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items']
        loop
            if not exists(
                select 1 from pg_publication_tables
                where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
            ) then
                execute format('alter publication supabase_realtime add table public.%I',v_table);
            end if;
        end loop;
    end if;
end
$$;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','11'),
    ('schema_version','11'),
    ('schema_status','cloud_procurement_ready'),
    ('supplier_authority','public.suppliers'),
    ('purchase_order_authority','public.purchase_orders'),
    ('purchase_order_items_authority','public.purchase_order_items'),
    ('goods_receipt_authority','public.goods_receipts'),
    ('goods_receipt_items_authority','public.goods_receipt_items'),
    ('goods_receipt_stock_mode','atomic_rpc'),
    ('goods_receipt_cancel_mode','atomic_reverse'),
    ('procurement_realtime','enabled'),
    ('inventory_transition','supplier_po_goods_receipt_cloud'),
    ('shift_management','removed')
on conflict (key)
do update set value=excluded.value,updated_at=now();

commit;

select * from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_version','schema_status','supplier_authority',
    'purchase_order_authority','purchase_order_items_authority','goods_receipt_authority',
    'goods_receipt_items_authority','goods_receipt_stock_mode','goods_receipt_cancel_mode',
    'procurement_realtime','inventory_transition','shift_management'
)
order by key;

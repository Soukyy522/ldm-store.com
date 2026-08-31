-- ============================================================================
-- LocDailyMar 25.3
-- Harga Beli Purchase Order & Goods Receipt untuk Owner Cabang
-- Jalankan pada Supabase SQL Editor PROJECT APLIKASI.
--
-- Hasil akses:
--   Owner Pusat  : dapat melihat/mengisi harga beli dan total.
--   Owner Cabang : dapat melihat/mengisi harga beli dan total toko aktifnya.
--   Admin         : dapat menjalankan alur procurement, tetapi harga disamarkan.
--   Kasir         : tidak mendapat akses halaman procurement.
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'Tabel public.products belum tersedia.';
    end if;
    if to_regclass('public.purchase_orders') is null
       or to_regclass('public.purchase_order_items') is null then
        raise exception 'Tabel Purchase Order belum tersedia.';
    end if;
    if to_regclass('public.goods_receipts') is null
       or to_regclass('public.goods_receipt_items') is null then
        raise exception 'Tabel Goods Receipt belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_current_store_id()') is null
       or to_regprocedure('public.ldm_current_role()') is null then
        raise exception 'Fungsi konteks store/role cloud belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_save_purchase_order(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)') is null then
        raise exception 'Fungsi dasar Purchase Order belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_submit_goods_receipt(uuid,text,date,uuid,text,uuid,text,jsonb)') is null then
        raise exception 'Fungsi dasar Goods Receipt belum tersedia.';
    end if;
end;
$$;

-- Master barang khusus halaman procurement. Harga beli hanya dibuka untuk Owner.
create or replace function public.ldm_visible_procurement_products()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        jsonb_agg(
            to_jsonb(p) || jsonb_build_object(
                'purchase_price',
                case
                    when public.ldm_current_role() = 'owner'
                    then greatest(coalesce(p.purchase_price,0),0)
                    else 0
                end
            )
            order by lower(p.name)
        ),
        '[]'::jsonb
    )
    from public.products p
    where p.store_id = public.ldm_current_store_id()
      and p.active = true
      and p.deleted_at is null;
$$;

alter function public.ldm_visible_procurement_products() owner to postgres;
revoke all on function public.ldm_visible_procurement_products() from public,anon;
grant execute on function public.ldm_visible_procurement_products() to authenticated;

-- Riwayat PO/GR hanya dari toko aktif. Nilai pembelian dibuka kepada semua Owner.
create or replace function public.ldm_visible_procurement()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'purchase_orders',coalesce((
            select jsonb_agg(
                to_jsonb(po) || jsonb_build_object(
                    'total_value',case
                        when public.ldm_current_role() = 'owner'
                        then coalesce(po.total_value,0)
                        else 0
                    end
                ) order by po.created_at desc
            )
            from public.purchase_orders po
            where po.store_id = public.ldm_current_store_id()
              and po.deleted_at is null
        ),'[]'::jsonb),

        'purchase_order_items',coalesce((
            select jsonb_agg(
                to_jsonb(i) || jsonb_build_object(
                    'purchase_price',case when public.ldm_current_role()='owner' then coalesce(i.purchase_price,0) else 0 end,
                    'package_purchase_price',case when public.ldm_current_role()='owner' then coalesce(i.package_purchase_price,0) else 0 end,
                    'line_subtotal',case when public.ldm_current_role()='owner' then coalesce(i.line_subtotal,0) else 0 end
                ) order by i.created_at
            )
            from public.purchase_order_items i
            where i.store_id = public.ldm_current_store_id()
        ),'[]'::jsonb),

        'goods_receipts',coalesce((
            select jsonb_agg(
                to_jsonb(gr) || jsonb_build_object(
                    'total_value',case
                        when public.ldm_current_role() = 'owner'
                        then coalesce(gr.total_value,0)
                        else 0
                    end
                ) order by gr.created_at desc
            )
            from public.goods_receipts gr
            where gr.store_id = public.ldm_current_store_id()
              and gr.deleted_at is null
        ),'[]'::jsonb),

        'goods_receipt_items',coalesce((
            select jsonb_agg(
                to_jsonb(i) || jsonb_build_object(
                    'purchase_price_before',case when public.ldm_current_role()='owner' then coalesce(i.purchase_price_before,0) else 0 end,
                    'purchase_price',case when public.ldm_current_role()='owner' then coalesce(i.purchase_price,0) else 0 end,
                    'package_purchase_price',case when public.ldm_current_role()='owner' then coalesce(i.package_purchase_price,0) else 0 end,
                    'line_subtotal',case when public.ldm_current_role()='owner' then coalesce(i.line_subtotal,0) else 0 end
                ) order by i.created_at
            )
            from public.goods_receipt_items i
            where i.store_id = public.ldm_current_store_id()
        ),'[]'::jsonb)
    );
$$;

alter function public.ldm_visible_procurement() owner to postgres;
revoke all on function public.ldm_visible_procurement() from public,anon;
grant execute on function public.ldm_visible_procurement() to authenticated;

-- Owner boleh memakai harga yang diisi pada PO/GR.
-- Admin selalu dipaksa memakai harga master/PO dari server.
create or replace function public.ldm_procurement_items_with_server_cost(
    p_items jsonb,
    p_purchase_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store_id uuid;
    v_role text;
    v_item jsonb;
    v_product_id uuid;
    v_price numeric(16,2);
    v_result jsonb := '[]'::jsonb;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Daftar item procurement tidak valid.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if auth.uid() is null or v_store_id is null then
        raise exception 'Session/store cloud tidak tersedia.';
    end if;
    if v_role not in ('owner','admin') then
        raise exception 'Fitur pembelian hanya untuk Owner/Admin.';
    end if;

    if v_role = 'owner' then
        return p_items;
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        begin
            v_product_id := nullif(v_item->>'product_id','')::uuid;
        exception when invalid_text_representation then
            raise exception 'product_id procurement tidak valid.';
        end;

        v_price := null;

        if p_purchase_order_id is not null then
            select poi.purchase_price
              into v_price
              from public.purchase_order_items poi
             where poi.purchase_order_id = p_purchase_order_id
               and poi.product_id = v_product_id
               and poi.store_id = v_store_id
             order by poi.id
             limit 1;
        end if;

        if v_price is null then
            select greatest(coalesce(p.purchase_price,0),0)
              into v_price
              from public.products p
             where p.id = v_product_id
               and p.store_id = v_store_id
               and p.active = true
               and p.deleted_at is null;
        end if;

        if v_price is null then
            raise exception 'Produk procurement tidak ditemukan pada toko aktif.';
        end if;

        v_result := v_result || jsonb_build_array(
            v_item || jsonb_build_object('purchase_price',v_price)
        );
    end loop;

    return v_result;
end;
$$;

alter function public.ldm_procurement_items_with_server_cost(jsonb,uuid) owner to postgres;
revoke all on function public.ldm_procurement_items_with_server_cost(jsonb,uuid)
from public,anon,authenticated;

-- Wrapper PO: total respons hanya disamarkan untuk Admin.
create or replace function public.ldm_save_purchase_order_role_safe(
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
set search_path = ''
as $$
declare
    v_role text;
    v_result jsonb;
    v_safe_items jsonb;
begin
    v_role := public.ldm_current_role();
    if auth.uid() is null or v_role not in ('owner','admin') then
        raise exception 'Purchase Order hanya untuk Owner/Admin.';
    end if;

    v_safe_items := public.ldm_procurement_items_with_server_cost(p_items,null);
    v_result := public.ldm_save_purchase_order(
        p_purchase_order_id,p_client_po_id,p_po_number,p_order_date,
        p_estimated_arrival,p_supplier_id,p_supplier_contact,p_reference,
        p_note,p_requested_status,v_safe_items
    );

    if v_role <> 'owner' then
        v_result := v_result || jsonb_build_object('total_value',0);
    end if;
    return v_result;
end;
$$;

alter function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) owner to postgres;
revoke all on function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) from public,anon;
grant execute on function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) to authenticated;

-- Wrapper GR: total respons hanya disamarkan untuk Admin.
create or replace function public.ldm_submit_goods_receipt_role_safe(
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
set search_path = ''
as $$
declare
    v_role text;
    v_result jsonb;
    v_safe_items jsonb;
begin
    v_role := public.ldm_current_role();
    if auth.uid() is null or v_role not in ('owner','admin') then
        raise exception 'Goods Receipt hanya untuk Owner/Admin.';
    end if;

    v_safe_items := public.ldm_procurement_items_with_server_cost(
        p_items,p_purchase_order_id
    );
    v_result := public.ldm_submit_goods_receipt(
        p_client_gr_id,p_gr_number,p_business_date,p_supplier_id,
        p_delivery_note_number,p_purchase_order_id,p_note,v_safe_items
    );

    if v_role <> 'owner' then
        v_result := v_result || jsonb_build_object('total_value',0);
    end if;
    return v_result;
end;
$$;

alter function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) owner to postgres;
revoke all on function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) from public,anon;
grant execute on function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) to authenticated;

insert into public.ldm_system_meta(key,value)
values ('branch_owner_procurement_values','25.3-ready')
on conflict(key) do update
set value=excluded.value,updated_at=now();

notify pgrst, 'reload schema';

commit;

-- Verifikasi instalasi. Hasil yang benar: true dan 25.3-ready.
select
    to_regprocedure('public.ldm_visible_procurement_products()') is not null
        as procurement_products_ok,
    to_regprocedure('public.ldm_visible_procurement()') is not null
        as procurement_history_ok,
    has_function_privilege(
        'authenticated',
        'public.ldm_visible_procurement_products()',
        'EXECUTE'
    ) as owner_endpoint_execute_ok;

select key,value,updated_at
from public.ldm_system_meta
where key='branch_owner_procurement_values';

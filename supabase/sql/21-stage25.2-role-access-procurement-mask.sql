-- ============================================================================
-- LocDailyMar 25.2
-- Akses Barang Kasir + Procurement Admin Tanpa Membuka Harga Beli
-- Jalankan pada PROJECT SUPABASE APLIKASI, bukan project server lisensi.
-- Prasyarat: Tahap 8, 11, 20, dan 25 sudah terpasang.
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'Tabel public.products belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_complete_sale(uuid,jsonb,numeric,text,numeric,numeric,numeric,text)') is null then
        raise exception 'Fungsi ldm_complete_sale Tahap 8 belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_visible_products()') is null then
        raise exception 'Fungsi ldm_visible_products Tahap 25 belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_visible_procurement()') is null then
        raise exception 'Fungsi ldm_visible_procurement Tahap 25 belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_is_primary_owner()') is null then
        raise exception 'Fungsi ldm_is_primary_owner Tahap 25 belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_current_store_id()') is null
       or to_regprocedure('public.ldm_current_role()') is null then
        raise exception 'Fungsi konteks store/role cloud belum tersedia.';
    end if;
    if to_regclass('public.purchase_order_items') is null then
        raise exception 'Tabel public.purchase_order_items belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_save_purchase_order(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)') is null then
        raise exception 'Fungsi Purchase Order Tahap 11 belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_submit_goods_receipt(uuid,text,date,uuid,text,uuid,text,jsonb)') is null then
        raise exception 'Fungsi Goods Receipt Tahap 11 belum tersedia.';
    end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Perbaikan transaksi kasir setelah SELECT langsung products ditutup.
-- Fungsi tetap memvalidasi auth.uid(), store, role, produk, stok, dan pembayaran.
-- --------------------------------------------------------------------------
alter function public.ldm_complete_sale(
    uuid,jsonb,numeric,text,numeric,numeric,numeric,text
) owner to postgres;

alter function public.ldm_complete_sale(
    uuid,jsonb,numeric,text,numeric,numeric,numeric,text
) security definer;

alter function public.ldm_complete_sale(
    uuid,jsonb,numeric,text,numeric,numeric,numeric,text
) set search_path = public, pg_temp;

revoke all on function public.ldm_complete_sale(
    uuid,jsonb,numeric,text,numeric,numeric,numeric,text
) from public,anon;

grant execute on function public.ldm_complete_sale(
    uuid,jsonb,numeric,text,numeric,numeric,numeric,text
) to authenticated;

-- Produk dibaca melalui RPC yang menyamarkan harga beli.
alter function public.ldm_visible_products() owner to postgres;
alter function public.ldm_visible_products() security definer;
revoke all on function public.ldm_visible_products() from public,anon;
grant execute on function public.ldm_visible_products() to authenticated;

-- Jangan buka tabel products langsung kepada browser.
-- Kasir tetap dapat melihat nama, harga jual/promo, dan stok lewat RPC.
revoke select,insert,update,delete on public.products from authenticated;

-- Snapshot procurement hanya memperlihatkan nilai pembelian kepada Owner Utama.
alter function public.ldm_visible_procurement() owner to postgres;
alter function public.ldm_visible_procurement() security definer;
revoke all on function public.ldm_visible_procurement() from public,anon;
grant execute on function public.ldm_visible_procurement() to authenticated;

-- --------------------------------------------------------------------------
-- Harga tepercaya untuk Admin/Owner Cabang.
-- Nilai dari browser diabaikan dan diganti harga tersimpan di server.
-- Owner Utama tetap dapat memasukkan harga pembelian yang baru.
-- --------------------------------------------------------------------------
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
    v_item jsonb;
    v_product_id uuid;
    v_price numeric(16,2);
    v_result jsonb := '[]'::jsonb;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Daftar item procurement tidak valid.';
    end if;

    if public.ldm_is_primary_owner() then
        return p_items;
    end if;

    v_store_id := public.ldm_current_store_id();
    if auth.uid() is null or v_store_id is null then
        raise exception 'Session/store cloud tidak tersedia.';
    end if;
    if public.ldm_current_role() not in ('owner','admin') then
        raise exception 'Fitur pembelian hanya untuk Owner/Admin.';
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

revoke all on function public.ldm_procurement_items_with_server_cost(jsonb,uuid)
from public,anon,authenticated;

alter function public.ldm_procurement_items_with_server_cost(jsonb,uuid)
owner to postgres;

-- --------------------------------------------------------------------------
-- Wrapper Purchase Order aman untuk Owner dan Admin.
-- --------------------------------------------------------------------------
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

    if not public.ldm_is_primary_owner() then
        v_result := v_result || jsonb_build_object('total_value',0);
    end if;

    return v_result;
end;
$$;

alter function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) owner to postgres;

-- --------------------------------------------------------------------------
-- Wrapper Goods Receipt aman untuk Owner dan Admin.
-- Admin memakai harga PO; tanpa PO memakai harga master server.
-- --------------------------------------------------------------------------
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

    if not public.ldm_is_primary_owner() then
        v_result := v_result || jsonb_build_object('total_value',0);
    end if;

    return v_result;
end;
$$;

alter function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) owner to postgres;

-- Tutup endpoint lama agar Admin tidak dapat melewati wrapper melalui Console.
revoke execute on function public.ldm_save_purchase_order(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) from authenticated;

revoke execute on function public.ldm_submit_goods_receipt(
    uuid,text,date,uuid,text,uuid,text,jsonb
) from authenticated;

revoke all on function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) from public,anon;

grant execute on function public.ldm_save_purchase_order_role_safe(
    uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb
) to authenticated;

revoke all on function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) from public,anon;

grant execute on function public.ldm_submit_goods_receipt_role_safe(
    uuid,text,date,uuid,text,uuid,text,jsonb
) to authenticated;

insert into public.ldm_system_meta(key,value)
values ('role_access_procurement_mask','25.2-ready')
on conflict(key) do update
set value=excluded.value,updated_at=now();

notify pgrst, 'reload schema';

commit;

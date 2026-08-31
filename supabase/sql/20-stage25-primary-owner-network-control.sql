-- =============================================================================
-- LocDailyMar 25.0 - OWNER UTAMA + KONTROL LAPORAN SELURUH CABANG
-- Jalankan pada project Supabase CLOUD APLIKASI (bukan Server Lisensi).
-- Prasyarat: seluruh SQL sampai 19-stage22 sudah terpasang.
-- =============================================================================

begin;

alter table public.store_networks
add column if not exists primary_owner_user_id uuid references auth.users(id) on delete restrict;

-- Inisialisasi aman: pilih Owner aktif pertama pada toko pusat.
update public.store_networks n
set primary_owner_user_id=coalesce(
    n.primary_owner_user_id,
    (
        select sm.user_id
        from public.store_network_stores sns
        join public.store_memberships sm
          on sm.store_id=sns.store_id and sm.active=true and sm.role='owner'
        join public.profiles p
          on p.id=sm.user_id and p.active=true and p.deleted_at is null
        where sns.network_id=n.id and sns.is_primary=true and sns.active=true
        order by p.created_at
        limit 1
    )
)
where n.primary_owner_user_id is null;

create index if not exists store_networks_primary_owner_idx
on public.store_networks(primary_owner_user_id)
where primary_owner_user_id is not null and deleted_at is null;

create or replace function public.ldm_is_primary_owner()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
    select exists(
        select 1
        from public.store_networks n
        join public.store_network_stores sns
          on sns.network_id=n.id and sns.is_primary=true and sns.active=true
        join public.store_memberships sm
          on sm.store_id=sns.store_id and sm.user_id=auth.uid()
         and sm.active=true and sm.role='owner'
        join public.profiles p
          on p.id=auth.uid() and p.active=true and p.deleted_at is null
        where n.primary_owner_user_id=auth.uid()
          and n.active=true and n.deleted_at is null
    );
$$;

create or replace function public.ldm_primary_owner_network_id()
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_network uuid;
begin
    select n.id into v_network
    from public.store_networks n
    join public.store_network_stores sns
      on sns.network_id=n.id and sns.is_primary=true and sns.active=true
    join public.store_memberships sm
      on sm.store_id=sns.store_id and sm.user_id=auth.uid()
     and sm.active=true and sm.role='owner'
    where n.primary_owner_user_id=auth.uid()
      and n.active=true and n.deleted_at is null
    limit 1;
    if v_network is null then
        raise exception 'PRIMARY_OWNER_REQUIRED';
    end if;
    return v_network;
end;
$$;

create or replace function public.ldm_primary_owner_context()
returns table(
    is_primary_owner boolean,
    network_id uuid,
    network_code text,
    network_name text,
    primary_store_id uuid,
    primary_store_code text,
    primary_store_name text,
    active_store_id uuid
)
language sql
stable
security definer
set search_path=''
as $$
    select
        n.primary_owner_user_id=auth.uid()
        and sm.user_id is not null
        and p.id is not null,
        n.id,n.code,n.name,s.id,s.code,s.name,public.ldm_current_store_id()
    from public.store_networks n
    join public.store_network_stores sns
      on sns.network_id=n.id and sns.is_primary=true and sns.active=true
    join public.stores s
      on s.id=sns.store_id and s.status='active' and s.deleted_at is null
    left join public.store_memberships sm
      on sm.store_id=s.id and sm.user_id=auth.uid()
     and sm.active=true and sm.role='owner'
    left join public.profiles p
      on p.id=auth.uid() and p.active=true and p.deleted_at is null
    where n.primary_owner_user_id=auth.uid()
      and n.active=true and n.deleted_at is null
    limit 1;
$$;

create or replace function public.ldm_can_view_sensitive_finance()
returns boolean
language sql
stable
security definer
set search_path=''
as $$ select public.ldm_is_primary_owner(); $$;

-- Perubahan struktur jaringan dari aplikasi hanya boleh dilakukan Owner Utama.
-- SQL Editor/service-role tetap dapat melakukan onboarding karena auth.uid() null.
create or replace function public.ldm_primary_owner_network_structure_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
    if auth.uid() is not null and not public.ldm_is_primary_owner() then
        raise exception 'Hanya Owner Utama cabang pusat yang dapat mengubah struktur jaringan toko.';
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists trg_primary_owner_network_structure on public.store_network_stores;
create trigger trg_primary_owner_network_structure
before insert or update or delete on public.store_network_stores
for each row execute function public.ldm_primary_owner_network_structure_guard();

-- ---------------------------------------------------------------------------
-- Data operasional yang dimasking server-side.
-- ---------------------------------------------------------------------------
create or replace function public.ldm_visible_products()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select coalesce(jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
            'purchase_price',case when public.ldm_is_primary_owner() then p.purchase_price else 0 end
        )
        order by lower(p.name)
    ),'[]'::jsonb)
    from public.products p
    where p.store_id=public.ldm_current_store_id()
      and p.active=true and p.deleted_at is null;
$$;

create or replace function public.ldm_visible_transaction_items()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select coalesce(jsonb_agg(
        to_jsonb(i) || jsonb_build_object(
            'cost_price_snapshot',case when public.ldm_is_primary_owner() then i.cost_price_snapshot else 0 end
        )
        order by i.created_at
    ),'[]'::jsonb)
    from public.transaction_items i
    where i.store_id=public.ldm_current_store_id();
$$;

create or replace function public.ldm_visible_stock_movements(
    p_movement_types text[] default null,
    p_limit integer default 1000
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select coalesce(jsonb_agg(
        to_jsonb(q) || jsonb_build_object(
            'unit_cost_snapshot',case when public.ldm_is_primary_owner() then q.unit_cost_snapshot else 0 end
        ) order by q.occurred_at desc
    ),'[]'::jsonb)
    from (
        select m.*
        from public.stock_movements m
        where m.store_id=public.ldm_current_store_id()
          and (p_movement_types is null or m.movement_type=any(p_movement_types))
        order by m.occurred_at desc
        limit greatest(1,least(coalesce(p_limit,1000),2000))
    ) q;
$$;

create or replace function public.ldm_visible_stock_opname()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select coalesce(jsonb_agg(
        to_jsonb(e) || jsonb_build_object(
            'nominal_snapshot',case when public.ldm_is_primary_owner() then e.nominal_snapshot else 0 end
        )
        order by e.created_at desc
    ),'[]'::jsonb)
    from public.stock_opname_entries e
    where e.store_id=public.ldm_current_store_id()
      and e.deleted_at is null;
$$;

create or replace function public.ldm_visible_procurement()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select jsonb_build_object(
        'purchase_orders',coalesce((
            select jsonb_agg(
                to_jsonb(po) || jsonb_build_object(
                    'total_value',case when public.ldm_is_primary_owner() then po.total_value else 0 end
                ) order by po.created_at desc
            )
            from public.purchase_orders po
            where po.store_id=public.ldm_current_store_id() and po.deleted_at is null
        ),'[]'::jsonb),
        'purchase_order_items',coalesce((
            select jsonb_agg(
                to_jsonb(i) || jsonb_build_object(
                    'purchase_price',case when public.ldm_is_primary_owner() then i.purchase_price else 0 end,
                    'package_purchase_price',case when public.ldm_is_primary_owner() then i.package_purchase_price else 0 end,
                    'line_subtotal',case when public.ldm_is_primary_owner() then i.line_subtotal else 0 end
                ) order by i.created_at
            )
            from public.purchase_order_items i
            where i.store_id=public.ldm_current_store_id()
        ),'[]'::jsonb),
        'goods_receipts',coalesce((
            select jsonb_agg(
                to_jsonb(gr) || jsonb_build_object(
                    'total_value',case when public.ldm_is_primary_owner() then gr.total_value else 0 end
                ) order by gr.created_at desc
            )
            from public.goods_receipts gr
            where gr.store_id=public.ldm_current_store_id() and gr.deleted_at is null
        ),'[]'::jsonb),
        'goods_receipt_items',coalesce((
            select jsonb_agg(
                to_jsonb(i) || jsonb_build_object(
                    'purchase_price_before',case when public.ldm_is_primary_owner() then i.purchase_price_before else 0 end,
                    'purchase_price',case when public.ldm_is_primary_owner() then i.purchase_price else 0 end,
                    'package_purchase_price',case when public.ldm_is_primary_owner() then i.package_purchase_price else 0 end,
                    'line_subtotal',case when public.ldm_is_primary_owner() then i.line_subtotal else 0 end
                ) order by i.created_at
            )
            from public.goods_receipt_items i
            where i.store_id=public.ldm_current_store_id()
        ),'[]'::jsonb)
    );
$$;

create or replace function public.ldm_visible_cost_history()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    select case when public.ldm_is_primary_owner() then
        coalesce((
            select jsonb_agg(to_jsonb(h) order by h.effective_at)
            from public.purchase_price_history h
            where h.store_id=public.ldm_current_store_id()
        ),'[]'::jsonb)
    else '[]'::jsonb end;
$$;

-- Browser tidak lagi membaca tabel sensitif secara langsung.
revoke select on public.products from authenticated;
revoke select on public.transaction_items from authenticated;
revoke select on public.stock_movements from authenticated;
revoke select on public.stock_transfer_items from authenticated;
revoke select on public.stock_opname_entries from authenticated;
revoke select on public.purchase_orders from authenticated;
revoke select on public.purchase_order_items from authenticated;
revoke select on public.goods_receipts from authenticated;
revoke select on public.goods_receipt_items from authenticated;
revoke select on public.purchase_price_history from authenticated;

do $$
begin
    if to_regclass('public.product_purchase_price_history') is not null then
        execute 'revoke select on public.product_purchase_price_history from authenticated';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Laporan jaringan lengkap: hanya Owner Utama.
-- ---------------------------------------------------------------------------
create or replace function public.ldm_primary_owner_network_report(
    p_store_id uuid default null,
    p_date_from date default current_date,
    p_date_to date default current_date,
    p_detail_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
    v_network uuid;
    v_from date:=coalesce(p_date_from,current_date);
    v_to date:=coalesce(p_date_to,current_date);
    v_limit integer:=greatest(20,least(coalesce(p_detail_limit,500),2000));
    v_result jsonb;
begin
    v_network:=public.ldm_primary_owner_network_id();
    if v_from>v_to then raise exception 'Tanggal awal tidak boleh melebihi tanggal akhir.'; end if;
    if v_to-v_from>366 then raise exception 'Rentang laporan maksimal 366 hari.'; end if;
    if p_store_id is not null and not exists(
        select 1 from public.store_network_stores sns
        where sns.network_id=v_network and sns.store_id=p_store_id and sns.active=true
    ) then raise exception 'Cabang tidak termasuk jaringan Owner Utama.'; end if;

    with scoped_stores as (
        select s.id,s.code,s.name,sns.is_primary
        from public.store_network_stores sns
        join public.stores s on s.id=sns.store_id
        where sns.network_id=v_network and sns.active=true
          and s.status='active' and s.deleted_at is null
          and (p_store_id is null or s.id=p_store_id)
    ),
    sales as (
        select t.store_id,count(*) transaction_count,coalesce(sum(t.grand_total),0) gross_sales
        from public.transactions t join scoped_stores ss on ss.id=t.store_id
        where t.status='completed' and t.business_date between v_from and v_to
        group by t.store_id
    ),
    sales_hpp as (
        select t.store_id,coalesce(sum(i.qty*i.cost_price_snapshot),0) hpp
        from public.transactions t
        join public.transaction_items i on i.transaction_id=t.id
        join scoped_stores ss on ss.id=t.store_id
        where t.status='completed' and t.business_date between v_from and v_to
        group by t.store_id
    ),
    refunds as (
        select r.store_id,coalesce(sum(r.total_refund),0) refund_total
        from public.sales_returns r
        join scoped_stores ss on ss.id=r.store_id
        where r.status='APPROVED' and r.deleted_at is null
          and (r.created_at at time zone 'Asia/Makassar')::date between v_from and v_to
        group by r.store_id
    ),
    returned_hpp as (
        select r.store_id,coalesce(sum(ri.qty*coalesce(ti.cost_price_snapshot,0)),0) returned_hpp
        from public.sales_returns r
        join public.sales_return_items ri on ri.return_id=r.id
        left join public.transaction_items ti on ti.id=ri.transaction_item_id
        join scoped_stores ss on ss.id=r.store_id
        where r.status='APPROVED' and r.deleted_at is null
          and (r.created_at at time zone 'Asia/Makassar')::date between v_from and v_to
        group by r.store_id
    ),
    expenses as (
        select e.store_id,coalesce(sum(e.amount),0) expense_total
        from public.operating_expenses e join scoped_stores ss on ss.id=e.store_id
        where e.deleted_at is null and e.business_date between v_from and v_to
        group by e.store_id
    ),
    branch_summary as (
        select ss.id store_id,ss.code store_code,ss.name store_name,ss.is_primary,
               coalesce(sa.transaction_count,0) transaction_count,
               coalesce(sa.gross_sales,0) gross_sales,
               coalesce(r.refund_total,0) refund_total,
               coalesce(sa.gross_sales,0)-coalesce(r.refund_total,0) net_sales,
               greatest(0,coalesce(sh.hpp,0)-coalesce(rh.returned_hpp,0)) hpp,
               (coalesce(sa.gross_sales,0)-coalesce(r.refund_total,0))
                 -greatest(0,coalesce(sh.hpp,0)-coalesce(rh.returned_hpp,0)) gross_profit,
               coalesce(e.expense_total,0) operating_expenses,
               (coalesce(sa.gross_sales,0)-coalesce(r.refund_total,0))
                 -greatest(0,coalesce(sh.hpp,0)-coalesce(rh.returned_hpp,0))
                 -coalesce(e.expense_total,0) net_profit,
               (select count(*) from public.attendance a where a.store_id=ss.id and a.deleted_at is null and a.attendance_date between v_from and v_to) attendance_count,
               (select count(*) from public.shift_closings c where c.store_id=ss.id and c.deleted_at is null and c.status='FINAL' and c.business_date between v_from and v_to) closing_count,
               (select count(*) from public.end_of_day_closings d where d.store_id=ss.id and d.deleted_at is null and d.status='FINAL' and d.business_date between v_from and v_to) eod_count,
               (select count(*) from public.purchase_orders po where po.store_id=ss.id and po.deleted_at is null and po.order_date between v_from and v_to) po_count,
               (select count(*) from public.goods_receipts gr where gr.store_id=ss.id and gr.deleted_at is null and gr.business_date between v_from and v_to) goods_receipt_count,
               (select count(*) from public.stock_opname_entries so where so.store_id=ss.id and so.deleted_at is null and so.business_date between v_from and v_to) stock_opname_count,
               (select count(*) from public.products p where p.store_id=ss.id and p.active=true and p.deleted_at is null) product_count,
               (select count(*) from public.profiles p where p.store_id=ss.id and p.active=true and p.deleted_at is null) employee_count
        from scoped_stores ss
        left join sales sa on sa.store_id=ss.id
        left join sales_hpp sh on sh.store_id=ss.id
        left join refunds r on r.store_id=ss.id
        left join returned_hpp rh on rh.store_id=ss.id
        left join expenses e on e.store_id=ss.id
    )
    select jsonb_build_object(
        'context',jsonb_build_object(
            'network_id',v_network,'date_from',v_from,'date_to',v_to,
            'scope',case when p_store_id is null then 'all' else 'branch' end,
            'generated_at',now()
        ),
        'stores',coalesce((select jsonb_agg(to_jsonb(ss) order by ss.is_primary desc,lower(ss.name)) from scoped_stores ss),'[]'::jsonb),
        'summary',coalesce((
            select jsonb_build_object(
                'store_count',count(*),
                'transaction_count',coalesce(sum(transaction_count),0),
                'gross_sales',coalesce(sum(gross_sales),0),
                'refund_total',coalesce(sum(refund_total),0),
                'net_sales',coalesce(sum(net_sales),0),
                'hpp',coalesce(sum(hpp),0),
                'gross_profit',coalesce(sum(gross_profit),0),
                'operating_expenses',coalesce(sum(operating_expenses),0),
                'net_profit',coalesce(sum(net_profit),0),
                'attendance_count',coalesce(sum(attendance_count),0),
                'closing_count',coalesce(sum(closing_count),0),
                'eod_count',coalesce(sum(eod_count),0),
                'po_count',coalesce(sum(po_count),0),
                'goods_receipt_count',coalesce(sum(goods_receipt_count),0),
                'stock_opname_count',coalesce(sum(stock_opname_count),0),
                'product_count',coalesce(sum(product_count),0),
                'employee_count',coalesce(sum(employee_count),0)
            ) from branch_summary
        ),'{}'::jsonb),
        'branches',coalesce((select jsonb_agg(to_jsonb(bs) order by bs.is_primary desc,lower(bs.store_name)) from branch_summary bs),'[]'::jsonb),
        'datasets',jsonb_build_object(
            'sales_daily',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.business_date desc,q.store_name) from (
                    select t.business_date,s.id store_id,s.name store_name,count(*) transaction_count,
                           sum(t.grand_total) gross_sales,sum(t.total_discount) discount_total
                    from public.transactions t join scoped_stores s on s.id=t.store_id
                    where t.status='completed' and t.business_date between v_from and v_to
                    group by t.business_date,s.id,s.name
                    order by t.business_date desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'attendance',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.recorded_at desc) from (
                    select a.id,a.store_id,s.name store_name,a.attendance_date,a.username_snapshot,
                           a.attendance_type,a.shift_label,a.note,a.recorded_at
                    from public.attendance a join scoped_stores s on s.id=a.store_id
                    where a.deleted_at is null and a.attendance_date between v_from and v_to
                    order by a.recorded_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'shift_closings',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.finalized_at desc) from (
                    select c.id,c.store_id,s.name store_name,c.business_date,c.cashier_username,c.shift_label,
                           c.net_sales,c.expected_cash,c.physical_cash,c.cash_difference,c.transaction_count,c.status,c.finalized_at
                    from public.shift_closings c join scoped_stores s on s.id=c.store_id
                    where c.deleted_at is null and c.business_date between v_from and v_to
                    order by c.finalized_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'eod',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.finalized_at desc) from (
                    select d.id,d.store_id,s.name store_name,d.business_date,d.system_net_sales,d.closing_net_sales,
                           d.sales_difference,d.cash_difference,d.operating_expense_total,d.closing_count,d.status,d.finalized_at
                    from public.end_of_day_closings d join scoped_stores s on s.id=d.store_id
                    where d.deleted_at is null and d.business_date between v_from and v_to
                    order by d.finalized_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'purchase_orders',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
                    select po.id,po.store_id,s.name store_name,po.po_number,po.order_date,po.estimated_arrival,
                           po.supplier_name_snapshot,po.status,po.total_item_types,po.total_qty,po.total_received,
                           po.total_value,po.created_username,po.created_at,
                           (select coalesce(jsonb_agg(jsonb_build_object(
                               'product',i.product_name_snapshot,'barcode',i.barcode_snapshot,'unit',i.unit_snapshot,
                               'qty_ordered',i.qty_ordered,'qty_received',i.qty_received,
                               'purchase_price',i.purchase_price,'subtotal',i.line_subtotal
                           ) order by i.product_name_snapshot),'[]'::jsonb)
                            from public.purchase_order_items i where i.purchase_order_id=po.id) items
                    from public.purchase_orders po join scoped_stores s on s.id=po.store_id
                    where po.deleted_at is null and po.order_date between v_from and v_to
                    order by po.created_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'goods_receipts',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.received_at desc) from (
                    select gr.id,gr.store_id,s.name store_name,gr.gr_number,gr.business_date,gr.received_at,
                           gr.supplier_name_snapshot,gr.purchase_order_number_snapshot,gr.status,
                           gr.total_item_types,gr.total_qty,gr.total_value,gr.created_username,
                           (select coalesce(jsonb_agg(jsonb_build_object(
                               'product',i.product_name_snapshot,'barcode',i.barcode_snapshot,'unit',i.unit_snapshot,
                               'qty_received',i.qty_received,'purchase_price',i.purchase_price,
                               'purchase_price_before',i.purchase_price_before,'subtotal',i.line_subtotal,'expiry_date',i.expiry_date
                           ) order by i.product_name_snapshot),'[]'::jsonb)
                            from public.goods_receipt_items i where i.goods_receipt_id=gr.id) items
                    from public.goods_receipts gr join scoped_stores s on s.id=gr.store_id
                    where gr.deleted_at is null and gr.business_date between v_from and v_to
                    order by gr.received_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'stock_opname',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
                    select so.id,so.store_id,s.name store_name,so.business_date,so.product_name_snapshot,
                           so.barcode_snapshot,so.unit_snapshot,so.system_stock_snapshot,so.physical_stock,
                           so.difference_snapshot,so.nominal_snapshot,so.status,so.created_username,so.created_at
                    from public.stock_opname_entries so join scoped_stores s on s.id=so.store_id
                    where so.deleted_at is null and so.business_date between v_from and v_to
                    order by so.created_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'products',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.store_name,lower(q.name)) from (
                    select p.id,p.store_id,s.name store_name,p.barcode,p.name,p.category,p.unit,
                           p.purchase_unit,p.purchase_unit_factor,p.purchase_price,p.sale_price,
                           p.legacy_stock_snapshot,p.last_expiry_date,p.promo_active,p.promo_price,p.updated_at
                    from public.products p join scoped_stores s on s.id=p.store_id
                    where p.active=true and p.deleted_at is null
                    order by s.name,lower(p.name) limit v_limit
                ) q
            ),'[]'::jsonb),
            'returns',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
                    select r.id,r.store_id,s.name store_name,r.return_code,r.transaction_code_snapshot,
                           r.original_cashier_snapshot,r.created_username,r.refund_method,r.total_refund,
                           r.status,r.note,r.created_at
                    from public.sales_returns r join scoped_stores s on s.id=r.store_id
                    where r.deleted_at is null
                      and (r.created_at at time zone 'Asia/Makassar')::date between v_from and v_to
                    order by r.created_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'expenses',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.occurred_at desc) from (
                    select e.id,e.store_id,s.name store_name,e.business_date,e.occurred_at,e.description,
                           e.category,e.target,e.reference,e.amount,e.created_username
                    from public.operating_expenses e join scoped_stores s on s.id=e.store_id
                    where e.deleted_at is null and e.business_date between v_from and v_to
                    order by e.occurred_at desc limit v_limit
                ) q
            ),'[]'::jsonb),
            'employees',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.store_name,lower(q.display_name)) from (
                    select p.id user_id,p.store_id,s.name store_name,s.code store_code,p.username,
                           coalesce(nullif(p.display_name,''),p.username) display_name,p.role,p.active,p.updated_at
                    from public.profiles p join scoped_stores s on s.id=p.store_id
                    where p.deleted_at is null
                    order by s.name,lower(coalesce(nullif(p.display_name,''),p.username)) limit v_limit
                ) q
            ),'[]'::jsonb),
            'stock_transfers',coalesce((
                select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
                    select st.id,st.transfer_code,st.source_store_id,ss.name source_store_name,
                           st.destination_store_id,ds.name destination_store_name,st.status,st.note,
                           st.created_at,st.sent_at,st.received_at
                    from public.stock_transfers st
                    join public.stores ss on ss.id=st.source_store_id
                    join public.stores ds on ds.id=st.destination_store_id
                    where exists(
                        select 1 from scoped_stores scope
                        where scope.id in (st.source_store_id,st.destination_store_id)
                    )
                      and (st.created_at at time zone 'Asia/Makassar')::date between v_from and v_to
                    order by st.created_at desc limit v_limit
                ) q
            ),'[]'::jsonb)
        )
    ) into v_result;
    return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manajemen akun lintas cabang: hanya Owner Utama.
-- ---------------------------------------------------------------------------
create or replace function public.ldm_primary_owner_accounts()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    with network as (select public.ldm_primary_owner_network_id() id)
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id',p.id,'store_id',p.store_id,'store_code',s.code,'store_name',s.name,
        'username',p.username,'display_name',p.display_name,'role',p.role,'active',p.active,
        'email',u.email,'last_sign_in_at',u.last_sign_in_at,'updated_at',p.updated_at,
        'is_primary_owner',n.primary_owner_user_id=p.id
    ) order by sns.is_primary desc,lower(s.name),lower(p.username)),'[]'::jsonb)
    from network x
    join public.store_networks n on n.id=x.id
    join public.store_network_stores sns on sns.network_id=x.id and sns.active=true
    join public.stores s on s.id=sns.store_id
    join public.profiles p on p.store_id=s.id and p.deleted_at is null
    left join auth.users u on u.id=p.id;
$$;

create or replace function public.ldm_primary_owner_update_account(
    p_user_id uuid,p_store_id uuid,p_username text,p_display_name text,
    p_role text,p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network uuid;
    v_target public.profiles%rowtype;
    v_role text:=lower(btrim(coalesce(p_role,'')));
    v_username text:=btrim(coalesce(p_username,''));
begin
    v_network:=public.ldm_primary_owner_network_id();
    select * into v_target from public.profiles where id=p_user_id for update;
    if v_target.id is null then raise exception 'Akun target tidak ditemukan.'; end if;
    if p_user_id=auth.uid() then raise exception 'Owner Utama tidak dapat mengubah akunnya sendiri dari panel ini.'; end if;
    if not exists(select 1 from public.store_network_stores where network_id=v_network and store_id=v_target.store_id and active=true)
       or not exists(select 1 from public.store_network_stores where network_id=v_network and store_id=p_store_id and active=true)
    then raise exception 'Akun atau cabang tujuan tidak termasuk jaringan ini.'; end if;
    if v_role not in ('owner','admin','kasir') then raise exception 'Role tidak valid.'; end if;
    if v_username !~ '^[A-Za-z0-9._-]{3,50}$' then raise exception 'Username harus 3-50 karakter.'; end if;
    if exists(select 1 from public.profiles p where p.store_id=p_store_id and lower(p.username)=lower(v_username) and p.id<>p_user_id and p.deleted_at is null)
    then raise exception 'Username sudah digunakan pada cabang tujuan.'; end if;

    update public.profiles
    set store_id=p_store_id,username=v_username,display_name=nullif(btrim(coalesce(p_display_name,'')),''),
        role=v_role,active=coalesce(p_active,false),updated_at=now()
    where id=p_user_id;

    update public.store_memberships set active=false,is_default=false,updated_at=now() where user_id=p_user_id;
    insert into public.store_memberships(user_id,store_id,role,active,is_default,invited_by,updated_at)
    values(p_user_id,p_store_id,v_role,coalesce(p_active,false),true,auth.uid(),now())
    on conflict(user_id,store_id) do update
    set role=excluded.role,active=excluded.active,is_default=true,invited_by=auth.uid(),updated_at=now();

    delete from public.active_store_sessions where user_id=p_user_id;
    update public.devices set status='revoked',updated_at=now()
    where user_id=p_user_id and deleted_at is null
      and (store_id<>p_store_id or not coalesce(p_active,false));

    return jsonb_build_object('ok',true,'user_id',p_user_id,'store_id',p_store_id,
        'username',v_username,'role',v_role,'active',coalesce(p_active,false));
end;
$$;

-- Fitur pemindahan karyawan yang sudah dipanggil multi-store.html.
-- Versi tahap lama pernah membuat fungsi-fungsi ini dengan RETURNS TABLE.
-- PostgreSQL tidak dapat mengubah RETURNS TABLE menjadi JSONB memakai
-- CREATE OR REPLACE, sehingga signature lama harus dilepas terlebih dahulu.
drop function if exists public.ldm_network_employees();
drop function if exists public.ldm_transfer_employee(uuid,uuid,text);
drop function if exists public.ldm_employee_transfer_history(integer);

create table if not exists public.employee_store_transfers(
    id uuid primary key default gen_random_uuid(),
    network_id uuid not null references public.store_networks(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,
    source_store_id uuid not null references public.stores(id) on delete restrict,
    destination_store_id uuid not null references public.stores(id) on delete restrict,
    employee_role text not null check(employee_role in ('admin','kasir')),
    note text,
    moved_by uuid not null references auth.users(id) on delete restrict,
    moved_at timestamptz not null default now()
);

-- Kompatibilitas database tahap lama: CREATE TABLE IF NOT EXISTS tidak
-- menambahkan kolom baru pada tabel yang sudah ada.
alter table public.employee_store_transfers
add column if not exists network_id uuid
references public.store_networks(id) on delete restrict;

-- Hubungkan riwayat lama ke network berdasarkan cabang asalnya.
update public.employee_store_transfers e
set network_id=sns.network_id
from public.store_network_stores sns
where e.network_id is null
  and sns.store_id=e.source_store_id;

-- Terapkan NOT NULL hanya jika seluruh riwayat lama berhasil dipetakan.
do $$
begin
    if not exists(
        select 1 from public.employee_store_transfers where network_id is null
    ) then
        alter table public.employee_store_transfers
        alter column network_id set not null;
    end if;
end;
$$;

create index if not exists employee_store_transfers_network_time_idx
on public.employee_store_transfers(network_id,moved_at desc);

alter table public.employee_store_transfers enable row level security;
revoke all on public.employee_store_transfers from anon,authenticated;

create or replace function public.ldm_network_employees()
returns jsonb language sql stable security definer set search_path='' as $$
    with network as (select public.ldm_primary_owner_network_id() id)
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id',p.id,'username',p.username,'display_name',coalesce(nullif(p.display_name,''),p.username),
        'role',p.role,'store_id',p.store_id,'store_code',s.code,'store_name',s.name
    ) order by lower(s.name),lower(p.username)),'[]'::jsonb)
    from network n
    join public.store_network_stores sns on sns.network_id=n.id and sns.active=true
    join public.stores s on s.id=sns.store_id
    join public.profiles p on p.store_id=s.id and p.active=true and p.deleted_at is null
    where p.role in ('admin','kasir');
$$;

create or replace function public.ldm_transfer_employee(p_user_id uuid,p_destination_store_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_network uuid; v_target public.profiles%rowtype; v_source public.stores%rowtype; v_dest public.stores%rowtype;
begin
    v_network:=public.ldm_primary_owner_network_id();
    select * into v_target from public.profiles where id=p_user_id and active=true and deleted_at is null for update;
    if v_target.id is null or v_target.role not in ('admin','kasir') then raise exception 'Karyawan Admin/Kasir tidak ditemukan.'; end if;
    if not exists(select 1 from public.store_network_stores where network_id=v_network and store_id=v_target.store_id and active=true)
       or not exists(select 1 from public.store_network_stores where network_id=v_network and store_id=p_destination_store_id and active=true)
    then raise exception 'Cabang tidak termasuk jaringan Owner Utama.'; end if;
    if v_target.store_id=p_destination_store_id then raise exception 'Karyawan sudah berada di cabang tujuan.'; end if;
    select * into v_source from public.stores where id=v_target.store_id;
    select * into v_dest from public.stores where id=p_destination_store_id;
    perform public.ldm_primary_owner_update_account(p_user_id,p_destination_store_id,v_target.username,v_target.display_name,v_target.role,true);
    insert into public.employee_store_transfers(network_id,user_id,source_store_id,destination_store_id,employee_role,note,moved_by)
    values(v_network,p_user_id,v_source.id,v_dest.id,v_target.role,nullif(btrim(coalesce(p_note,'')),''),auth.uid());
    return jsonb_build_object('ok',true,'user_id',p_user_id,'source_store_name',v_source.name,'destination_store_name',v_dest.name);
end; $$;

create or replace function public.ldm_employee_transfer_history(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
    with network as (select public.ldm_primary_owner_network_id() id)
    select coalesce(jsonb_agg(to_jsonb(q) order by q.moved_at desc),'[]'::jsonb) from (
        select e.id,e.user_id,p.username,p.display_name,e.employee_role,e.source_store_id,ss.name source_store_name,
               e.destination_store_id,ds.name destination_store_name,e.note,e.moved_at,
               coalesce(m.display_name,m.username) moved_by_name
        from public.employee_store_transfers e
        join network n on n.id=e.network_id
        join public.profiles p on p.id=e.user_id
        join public.stores ss on ss.id=e.source_store_id
        join public.stores ds on ds.id=e.destination_store_id
        left join public.profiles m on m.id=e.moved_by
        order by e.moved_at desc limit greatest(1,least(coalesce(p_limit,100),500))
    ) q;
$$;

revoke all on function public.ldm_is_primary_owner() from public,anon;
revoke all on function public.ldm_primary_owner_network_id() from public,anon;
revoke all on function public.ldm_primary_owner_context() from public,anon;
revoke all on function public.ldm_can_view_sensitive_finance() from public,anon;
revoke all on function public.ldm_primary_owner_network_structure_guard() from public,anon,authenticated;
revoke all on function public.ldm_visible_products() from public,anon;
revoke all on function public.ldm_visible_transaction_items() from public,anon;
revoke all on function public.ldm_visible_stock_movements(text[],integer) from public,anon;
revoke all on function public.ldm_visible_stock_opname() from public,anon;
revoke all on function public.ldm_visible_procurement() from public,anon;
revoke all on function public.ldm_visible_cost_history() from public,anon;
revoke all on function public.ldm_primary_owner_network_report(uuid,date,date,integer) from public,anon;
revoke all on function public.ldm_primary_owner_accounts() from public,anon;
revoke all on function public.ldm_primary_owner_update_account(uuid,uuid,text,text,text,boolean) from public,anon;
revoke all on function public.ldm_network_employees() from public,anon;
revoke all on function public.ldm_transfer_employee(uuid,uuid,text) from public,anon;
revoke all on function public.ldm_employee_transfer_history(integer) from public,anon;

grant execute on function public.ldm_is_primary_owner() to authenticated;
grant execute on function public.ldm_primary_owner_context() to authenticated;
grant execute on function public.ldm_can_view_sensitive_finance() to authenticated;
grant execute on function public.ldm_visible_products() to authenticated;
grant execute on function public.ldm_visible_transaction_items() to authenticated;
grant execute on function public.ldm_visible_stock_movements(text[],integer) to authenticated;
grant execute on function public.ldm_visible_stock_opname() to authenticated;
grant execute on function public.ldm_visible_procurement() to authenticated;
grant execute on function public.ldm_visible_cost_history() to authenticated;
grant execute on function public.ldm_primary_owner_network_report(uuid,date,date,integer) to authenticated;
grant execute on function public.ldm_primary_owner_accounts() to authenticated;
grant execute on function public.ldm_primary_owner_update_account(uuid,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.ldm_network_employees() to authenticated;
grant execute on function public.ldm_transfer_employee(uuid,uuid,text) to authenticated;
grant execute on function public.ldm_employee_transfer_history(integer) to authenticated;

insert into public.ldm_system_meta(key,value) values
('primary_owner_control','ready'),('schema_version','25.0')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

-- VERIFIKASI:
select public.ldm_is_primary_owner() as akun_ini_owner_utama;
select * from public.ldm_primary_owner_context();

-- JIKA OWNER UTAMA YANG TERPILIH SALAH, developer dapat menjalankan:
-- update public.store_networks
-- set primary_owner_user_id='UUID_AUTH_OWNER_UTAMA'::uuid
-- where code='KODE_NETWORK';

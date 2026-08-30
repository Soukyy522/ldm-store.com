
-- =====================================================================
-- LocDailyMar Live Sync - TAHAP 10
-- Cloud Retur + Atomic Return Stock + Cloud Stock Opname
-- TANPA SHIFT MANAGEMENT
-- =====================================================================

begin;

do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'Tahap 7 belum siap: public.products tidak ditemukan.';
    end if;

    if to_regclass('public.transactions') is null
       or to_regclass('public.transaction_items') is null
       or to_regclass('public.stock_movements') is null then
        raise exception 'Tahap 8 belum siap.';
    end if;

    if to_regclass('public.attendance') is null then
        raise exception 'Tahap 9 belum siap: public.attendance tidak ditemukan.';
    end if;
end
$$;

-- ---------------------------------------------------------------------
-- SALES RETURNS
-- transaction_id / transaction_item_id / product_id dibuat nullable
-- agar histori legacy pra-cloud dapat diarsipkan TANPA menerapkan stok lagi.
-- Operasi baru melalui RPC selalu membutuhkan UUID cloud.
-- ---------------------------------------------------------------------
create table if not exists public.sales_returns (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,

    client_return_id uuid,
    return_code text not null,

    transaction_id uuid references public.transactions(id) on delete restrict,
    transaction_code_snapshot text not null,
    original_cashier_snapshot text,

    created_by uuid not null references auth.users(id) on delete restrict,
    created_username text not null,

    refund_method text not null
        check (refund_method in ('Tunai','Non Tunai')),

    refund_user_id uuid references auth.users(id) on delete restrict,
    refund_username text,
    refund_attendance_id uuid references public.attendance(id) on delete restrict,
    refund_shift_label text,

    note text,
    total_refund numeric(16,2) not null default 0,

    status text not null default 'PENDING'
        check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),

    approved_by uuid references auth.users(id),
    approved_username text,
    approved_at timestamptz,

    rejected_by uuid references auth.users(id),
    rejected_username text,
    rejected_at timestamptz,
    reject_reason text,

    cancelled_by uuid references auth.users(id),
    cancelled_username text,
    cancelled_at timestamptz,
    cancel_reason text,

    legacy_imported boolean not null default false,
    stock_effect_applied boolean not null default false,
    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists sales_returns_store_client_unique
on public.sales_returns(store_id, client_return_id)
where client_return_id is not null;

create unique index if not exists sales_returns_store_code_unique
on public.sales_returns(store_id, return_code);

create unique index if not exists sales_returns_legacy_unique
on public.sales_returns(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists sales_returns_transaction_idx
on public.sales_returns(store_id, transaction_id, created_at desc)
where deleted_at is null;

create index if not exists sales_returns_status_idx
on public.sales_returns(store_id, status, created_at desc)
where deleted_at is null;

drop trigger if exists trg_sales_returns_touch_row on public.sales_returns;
create trigger trg_sales_returns_touch_row
before update on public.sales_returns
for each row execute function public.ldm_touch_row();

create table if not exists public.sales_return_items (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    return_id uuid not null references public.sales_returns(id) on delete restrict,

    transaction_item_id uuid references public.transaction_items(id) on delete restrict,
    product_id uuid references public.products(id) on delete restrict,

    product_name_snapshot text not null,
    barcode_snapshot text,
    unit_snapshot text,

    qty numeric(16,3) not null check (qty > 0),
    refund_unit_price numeric(16,4) not null default 0,
    refund_amount numeric(16,2) not null default 0,

    reason text,
    restock boolean not null default true,

    created_at timestamptz not null default now()
);

create index if not exists sales_return_items_return_idx
on public.sales_return_items(return_id);

create index if not exists sales_return_items_product_idx
on public.sales_return_items(store_id, product_id, created_at desc);

-- ---------------------------------------------------------------------
-- Cash movement cloud foundation untuk refund tunai.
-- Closing/EOD cloud akan memakai table ini di tahap berikutnya.
-- ---------------------------------------------------------------------
create table if not exists public.cash_movements (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,

    direction text not null check (direction in ('in','out')),
    amount numeric(16,2) not null check (amount >= 0),

    user_id uuid references auth.users(id) on delete restrict,
    username_snapshot text,
    attendance_id uuid references public.attendance(id) on delete restrict,
    shift_label text,

    source_type text not null,
    source_id text not null,
    reference_code text,
    note text,

    status text not null default 'active'
        check (status in ('active','reversed')),

    occurred_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),

    reversed_at timestamptz,
    reversed_by uuid references auth.users(id),
    reverse_reason text
);

create unique index if not exists cash_movements_source_unique
on public.cash_movements(store_id, source_type, source_id);

create index if not exists cash_movements_store_time_idx
on public.cash_movements(store_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- STOCK OPNAME
-- difference_snapshot adalah delta pada saat hitung.
-- Pending approval menerapkan DELTA ke stok terbaru, bukan menimpa
-- stok dengan angka lama. Ini mencegah transaksi setelah counting hilang.
-- ---------------------------------------------------------------------
create table if not exists public.stock_opname_entries (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,

    client_batch_id uuid,
    client_item_id text,

    business_date date not null,

    product_id uuid references public.products(id) on delete restrict,
    product_name_snapshot text not null,
    barcode_snapshot text,
    unit_snapshot text,

    system_stock_snapshot numeric(16,3) not null default 0,
    physical_stock numeric(16,3) not null check (physical_stock >= 0),
    difference_snapshot numeric(16,3) not null default 0,
    nominal_snapshot numeric(16,2) not null default 0,

    note text,

    created_by uuid not null references auth.users(id) on delete restrict,
    created_username text not null,

    status text not null default 'PENDING'
        check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),

    applied_stock_before numeric(16,3),
    applied_stock_after numeric(16,3),
    stock_effect_applied boolean not null default false,

    approved_by uuid references auth.users(id),
    approved_username text,
    approved_at timestamptz,

    rejected_by uuid references auth.users(id),
    rejected_username text,
    rejected_at timestamptz,
    reject_reason text,

    cancelled_by uuid references auth.users(id),
    cancelled_username text,
    cancelled_at timestamptz,
    cancel_reason text,

    legacy_imported boolean not null default false,
    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists stock_opname_batch_product_unique
on public.stock_opname_entries(store_id, client_batch_id, product_id)
where client_batch_id is not null and product_id is not null;

create unique index if not exists stock_opname_legacy_unique
on public.stock_opname_entries(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists stock_opname_store_date_idx
on public.stock_opname_entries(store_id, business_date, created_at desc)
where deleted_at is null;

drop trigger if exists trg_stock_opname_touch_row on public.stock_opname_entries;
create trigger trg_stock_opname_touch_row
before update on public.stock_opname_entries
for each row execute function public.ldm_touch_row();

-- ---------------------------------------------------------------------
-- RLS. Browser baca store sendiri, seluruh write wajib lewat RPC.
-- ---------------------------------------------------------------------
alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;
alter table public.cash_movements enable row level security;
alter table public.stock_opname_entries enable row level security;

revoke all on public.sales_returns from anon;
revoke all on public.sales_return_items from anon;
revoke all on public.cash_movements from anon;
revoke all on public.stock_opname_entries from anon;

revoke insert, update, delete on public.sales_returns from authenticated;
revoke insert, update, delete on public.sales_return_items from authenticated;
revoke insert, update, delete on public.cash_movements from authenticated;
revoke insert, update, delete on public.stock_opname_entries from authenticated;

grant select on public.sales_returns to authenticated;
grant select on public.sales_return_items to authenticated;
grant select on public.cash_movements to authenticated;
grant select on public.stock_opname_entries to authenticated;

drop policy if exists sales_returns_store_select on public.sales_returns;
create policy sales_returns_store_select
on public.sales_returns for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
);

drop policy if exists sales_return_items_store_select on public.sales_return_items;
create policy sales_return_items_store_select
on public.sales_return_items for select to authenticated
using (store_id = public.ldm_current_store_id());

drop policy if exists cash_movements_store_select on public.cash_movements;
create policy cash_movements_store_select
on public.cash_movements for select to authenticated
using (store_id = public.ldm_current_store_id());

drop policy if exists stock_opname_store_select on public.stock_opname_entries;
create policy stock_opname_store_select
on public.stock_opname_entries for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
);

-- ---------------------------------------------------------------------
-- Helper: username current
-- ---------------------------------------------------------------------
create or replace function public.ldm_current_username()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
    select p.username
    from public.profiles p
    where p.id = auth.uid()
      and p.store_id = public.ldm_current_store_id()
      and p.active = true
      and p.deleted_at is null
    limit 1;
$$;

revoke all on function public.ldm_current_username() from public, anon;
grant execute on function public.ldm_current_username() to authenticated;

-- ---------------------------------------------------------------------
-- Helper: resolve active attendance for refund processor TODAY.
-- ---------------------------------------------------------------------
create or replace function public.ldm_active_attendance_for_username(
    p_username text
)
returns table (
    user_id uuid,
    username text,
    attendance_id uuid,
    shift_label text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
    v_timezone text;
    v_today date;
begin
    v_store_id := public.ldm_current_store_id();

    select coalesce(nullif(s.timezone,''),'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = v_store_id
      and s.deleted_at is null
    limit 1;

    v_today := (now() at time zone v_timezone)::date;

    return query
    select
        p.id,
        p.username,
        a.id,
        a.shift_label
    from public.profiles p
    join public.attendance a
      on a.user_id = p.id
     and a.store_id = p.store_id
     and a.attendance_date = v_today
     and a.attendance_type = 'Masuk'
     and a.deleted_at is null
    where p.store_id = v_store_id
      and p.active = true
      and p.deleted_at is null
      and lower(btrim(p.username)) = lower(btrim(p_username))
      and not exists (
          select 1
          from public.attendance out_a
          where out_a.store_id = p.store_id
            and out_a.user_id = p.id
            and out_a.attendance_date = v_today
            and out_a.attendance_type = 'Keluar'
            and out_a.deleted_at is null
            and out_a.recorded_at >= a.recorded_at
      )
    order by a.recorded_at desc
    limit 1;
end;
$$;

revoke all on function public.ldm_active_attendance_for_username(text) from public, anon;
grant execute on function public.ldm_active_attendance_for_username(text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: transaksi cloud yang dapat dipakai Retur.
-- ---------------------------------------------------------------------
create or replace function public.ldm_returnable_transactions(
    p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
    v_limit integer;
    v_result jsonb;
begin
    v_store_id := public.ldm_current_store_id();
    v_limit := greatest(1, least(coalesce(p_limit,200),500));

    select coalesce(jsonb_agg(tx_obj order by tx_time desc),'[]'::jsonb)
      into v_result
    from (
        select
            t.transacted_at as tx_time,
            jsonb_build_object(
                'id', t.id,
                'transaction_code', t.transaction_code,
                'cashier_username', t.cashier_username,
                'shift_label', t.shift_label,
                'business_date', t.business_date,
                'transacted_at', t.transacted_at,
                'payment_method', t.payment_method,
                'grand_total', t.grand_total,
                'subtotal', t.subtotal,
                'manual_discount', t.manual_discount,
                'status', t.status,
                'items', coalesce((
                    select jsonb_agg(
                        jsonb_build_object(
                            'id', ti.id,
                            'product_id', ti.product_id,
                            'name', ti.product_name_snapshot,
                            'barcode', ti.barcode_snapshot,
                            'unit', ti.unit_snapshot,
                            'qty', ti.qty,
                            'unit_price', ti.unit_price,
                            'line_subtotal', ti.line_subtotal
                        )
                        order by ti.created_at, ti.id
                    )
                    from public.transaction_items ti
                    where ti.transaction_id = t.id
                      and ti.store_id = v_store_id
                ), '[]'::jsonb)
            ) as tx_obj
        from public.transactions t
        where t.store_id = v_store_id
          and t.status = 'completed'
        order by t.transacted_at desc
        limit v_limit
    ) q;

    return v_result;
end;
$$;

revoke all on function public.ldm_returnable_transactions(integer) from public, anon;
grant execute on function public.ldm_returnable_transactions(integer) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: submit retur sebagai PENDING.
-- Qty PENDING ikut mereservasi jatah retur agar dua device tidak over-return.
-- ---------------------------------------------------------------------
create or replace function public.ldm_submit_return(
    p_client_return_id uuid,
    p_transaction_id uuid,
    p_items jsonb,
    p_refund_method text,
    p_refund_username text,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_username text;
    v_tx public.transactions%rowtype;
    v_existing public.sales_returns%rowtype;
    v_return_id uuid;
    v_return_code text;
    v_item jsonb;
    v_ti public.transaction_items%rowtype;
    v_qty numeric(16,3);
    v_used numeric(16,3);
    v_refund_unit numeric(16,4);
    v_refund_amount numeric(16,2);
    v_total numeric(16,2) := 0;
    v_refund_method text;
    v_refund record;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    if v_store_id is null or v_username is null then
        raise exception 'Profile cloud aktif tidak ditemukan.';
    end if;

    if v_role not in ('owner','admin','kasir') then
        raise exception 'Role tidak memiliki akses retur.';
    end if;

    if p_client_return_id is null then
        raise exception 'client_return_id wajib diisi.';
    end if;

    select *
      into v_existing
    from public.sales_returns r
    where r.store_id = v_store_id
      and r.client_return_id = p_client_return_id
      and r.deleted_at is null
    limit 1;

    if v_existing.id is not null then
        return jsonb_build_object(
            'id', v_existing.id,
            'return_code', v_existing.return_code,
            'status', v_existing.status,
            'idempotent', true
        );
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Item retur kosong.';
    end if;

    select *
      into v_tx
    from public.transactions t
    where t.id = p_transaction_id
      and t.store_id = v_store_id
      and t.status = 'completed'
    for update;

    if v_tx.id is null then
        raise exception 'Transaksi cloud tidak ditemukan atau sudah void.';
    end if;

    v_refund_method :=
        case
            when lower(btrim(coalesce(p_refund_method,''))) = 'tunai'
                then 'Tunai'
            else 'Non Tunai'
        end;

    select *
      into v_refund
    from public.ldm_active_attendance_for_username(p_refund_username)
    limit 1;

    if not found then
        raise exception 'Akun refund belum Absen Masuk cloud atau sudah Absen Keluar.';
    end if;

    if v_role = 'kasir' and v_refund.user_id <> auth.uid() then
        raise exception 'Kasir hanya dapat memilih dirinya sendiri sebagai pemroses refund.';
    end if;

    v_return_id := gen_random_uuid();
    v_return_code :=
        'RTR-' ||
        to_char(now() at time zone 'Asia/Makassar','YYMMDD-HH24MISS') ||
        '-' ||
        upper(substr(replace(v_return_id::text,'-',''),1,6));

    insert into public.sales_returns (
        id, store_id, client_return_id, return_code,
        transaction_id, transaction_code_snapshot, original_cashier_snapshot,
        created_by, created_username,
        refund_method, refund_user_id, refund_username,
        refund_attendance_id, refund_shift_label,
        note, total_refund, status
    )
    values (
        v_return_id, v_store_id, p_client_return_id, v_return_code,
        v_tx.id, v_tx.transaction_code, v_tx.cashier_username,
        auth.uid(), v_username,
        v_refund_method, v_refund.user_id, v_refund.username,
        v_refund.attendance_id, v_refund.shift_label,
        nullif(btrim(coalesce(p_note,'')),''), 0, 'PENDING'
    );

    for v_item in
        select value from jsonb_array_elements(p_items)
    loop
        v_qty := coalesce((v_item ->> 'qty')::numeric,0);

        if v_qty <= 0 then
            raise exception 'Qty retur harus lebih dari 0.';
        end if;

        select *
          into v_ti
        from public.transaction_items ti
        where ti.id = (v_item ->> 'transaction_item_id')::uuid
          and ti.transaction_id = v_tx.id
          and ti.store_id = v_store_id
        limit 1;

        if v_ti.id is null then
            raise exception 'Item transaksi cloud tidak ditemukan.';
        end if;

        select coalesce(sum(ri.qty),0)
          into v_used
        from public.sales_return_items ri
        join public.sales_returns r
          on r.id = ri.return_id
        where r.store_id = v_store_id
          and r.transaction_id = v_tx.id
          and r.status in ('PENDING','APPROVED')
          and r.deleted_at is null
          and ri.transaction_item_id = v_ti.id;

        if v_used + v_qty > v_ti.qty then
            raise exception
                'Qty retur % melebihi sisa qty untuk % (dibeli %, sudah/pending %, diminta %).',
                v_ti.product_name_snapshot,
                v_ti.product_name_snapshot,
                v_ti.qty,
                v_used,
                v_qty;
        end if;

        -- Alokasi diskon manual proporsional supaya seluruh item
        -- maksimum merefund grand_total transaksi.
        if v_tx.subtotal > 0 then
            v_refund_unit :=
                greatest(
                    0,
                    (
                        v_ti.line_subtotal
                        -
                        (
                            v_tx.manual_discount
                            *
                            (v_ti.line_subtotal / v_tx.subtotal)
                        )
                    )
                    / v_ti.qty
                );
        else
            v_refund_unit := v_ti.unit_price;
        end if;

        v_refund_amount := round(v_refund_unit * v_qty, 2);
        v_total := v_total + v_refund_amount;

        insert into public.sales_return_items (
            store_id, return_id, transaction_item_id, product_id,
            product_name_snapshot, barcode_snapshot, unit_snapshot,
            qty, refund_unit_price, refund_amount,
            reason, restock
        )
        values (
            v_store_id, v_return_id, v_ti.id, v_ti.product_id,
            v_ti.product_name_snapshot, v_ti.barcode_snapshot, v_ti.unit_snapshot,
            v_qty, v_refund_unit, v_refund_amount,
            nullif(btrim(coalesce(v_item ->> 'reason','')),''),
            coalesce((v_item ->> 'restock')::boolean,true)
        );
    end loop;

    update public.sales_returns
       set total_refund = v_total
     where id = v_return_id;

    return jsonb_build_object(
        'id', v_return_id,
        'return_code', v_return_code,
        'status', 'PENDING',
        'total_refund', v_total,
        'idempotent', false
    );
end;
$$;

revoke all on function public.ldm_submit_return(uuid,uuid,jsonb,text,text,text)
from public, anon;
grant execute on function public.ldm_submit_return(uuid,uuid,jsonb,text,text,text)
to authenticated;

-- ---------------------------------------------------------------------
-- RPC: approve retur. Owner only. Stok + ledger + cash refund atomik.
-- ---------------------------------------------------------------------
create or replace function public.ldm_approve_return(
    p_return_id uuid,
    p_refund_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_owner_name text;
    v_return public.sales_returns%rowtype;
    v_item record;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
    v_refund record;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_owner_name := public.ldm_current_username();

    if v_role <> 'owner' then
        raise exception 'Approval retur hanya dapat dilakukan Owner.';
    end if;

    select *
      into v_return
    from public.sales_returns r
    where r.id = p_return_id
      and r.store_id = v_store_id
      and r.deleted_at is null
    for update;

    if v_return.id is null then
        raise exception 'Retur tidak ditemukan.';
    end if;

    if v_return.status = 'APPROVED' then
        return jsonb_build_object(
            'id', v_return.id,
            'return_code', v_return.return_code,
            'status', v_return.status,
            'idempotent', true
        );
    end if;

    if v_return.status <> 'PENDING' then
        raise exception 'Hanya retur PENDING yang dapat diapprove.';
    end if;

    select *
      into v_refund
    from public.ldm_active_attendance_for_username(p_refund_username)
    limit 1;

    if not found then
        raise exception 'Kasir refund belum Absen Masuk cloud atau sudah Absen Keluar.';
    end if;

    -- Lock produk secara deterministic untuk menghindari deadlock.
    for v_item in
        select distinct ri.product_id
        from public.sales_return_items ri
        where ri.return_id = v_return.id
          and ri.restock = true
          and ri.product_id is not null
        order by ri.product_id
    loop
        perform 1
        from public.products p
        where p.id = v_item.product_id
          and p.store_id = v_store_id
          and p.deleted_at is null
        for update;
    end loop;

    for v_item in
        select ri.*
        from public.sales_return_items ri
        where ri.return_id = v_return.id
        order by ri.product_id, ri.id
    loop
        if v_item.restock and v_item.product_id is not null then
            select *
              into v_product
            from public.products p
            where p.id = v_item.product_id
              and p.store_id = v_store_id
              and p.deleted_at is null
            for update;

            if v_product.id is null then
                raise exception 'Produk retur % tidak ditemukan.', v_item.product_name_snapshot;
            end if;

            v_before := v_product.legacy_stock_snapshot;
            v_after := v_before + v_item.qty;

            update public.products
               set legacy_stock_snapshot = v_after
             where id = v_product.id;

            insert into public.stock_movements (
                store_id, product_id, transaction_id, transaction_item_id,
                movement_type, quantity_change, stock_before, stock_after,
                unit_cost_snapshot,
                source_type, source_id, reference_code, note,
                created_by, occurred_at
            )
            values (
                v_store_id, v_product.id,
                v_return.transaction_id, v_item.transaction_item_id,
                'return', v_item.qty, v_before, v_after,
                v_product.purchase_price,
                'sales_return_approve', v_item.id::text,
                v_return.return_code,
                'Retur penjualan ' || v_return.return_code,
                auth.uid(), now()
            )
            on conflict (store_id, product_id, source_type, source_id)
            where source_type is not null and source_id is not null
            do nothing;
        end if;
    end loop;

    if v_return.refund_method = 'Tunai' then
        insert into public.cash_movements (
            store_id, direction, amount,
            user_id, username_snapshot, attendance_id, shift_label,
            source_type, source_id, reference_code, note,
            created_by, occurred_at
        )
        values (
            v_store_id, 'out', v_return.total_refund,
            v_refund.user_id, v_refund.username,
            v_refund.attendance_id, v_refund.shift_label,
            'sales_return', v_return.id::text,
            v_return.return_code,
            'Refund tunai retur ' || v_return.return_code,
            auth.uid(), now()
        )
        on conflict (store_id, source_type, source_id)
        do update set
            status = 'active',
            reversed_at = null,
            reversed_by = null,
            reverse_reason = null;
    end if;

    update public.sales_returns
       set status = 'APPROVED',
           refund_user_id = v_refund.user_id,
           refund_username = v_refund.username,
           refund_attendance_id = v_refund.attendance_id,
           refund_shift_label = v_refund.shift_label,
           approved_by = auth.uid(),
           approved_username = v_owner_name,
           approved_at = now(),
           stock_effect_applied = true
     where id = v_return.id;

    return jsonb_build_object(
        'id', v_return.id,
        'return_code', v_return.return_code,
        'status', 'APPROVED',
        'total_refund', v_return.total_refund
    );
end;
$$;

revoke all on function public.ldm_approve_return(uuid,text) from public, anon;
grant execute on function public.ldm_approve_return(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- Reject retur.
-- ---------------------------------------------------------------------
create or replace function public.ldm_reject_return(
    p_return_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_username text;
    v_return public.sales_returns%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat menolak retur.';
    end if;

    select *
      into v_return
    from public.sales_returns r
    where r.id = p_return_id
      and r.store_id = v_store_id
      and r.deleted_at is null
    for update;

    if v_return.id is null then
        raise exception 'Retur tidak ditemukan.';
    end if;

    if v_return.status <> 'PENDING' then
        raise exception 'Hanya retur PENDING yang dapat ditolak.';
    end if;

    update public.sales_returns
       set status = 'REJECTED',
           rejected_by = auth.uid(),
           rejected_username = v_username,
           rejected_at = now(),
           reject_reason = nullif(btrim(coalesce(p_reason,'')),'')
     where id = v_return.id;

    return jsonb_build_object(
        'id', v_return.id,
        'return_code', v_return.return_code,
        'status', 'REJECTED'
    );
end;
$$;

revoke all on function public.ldm_reject_return(uuid,text) from public, anon;
grant execute on function public.ldm_reject_return(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- Cancel retur. Approved: Owner only + stock reversal atomik.
-- PENDING/REJECTED: Owner/Admin; Kasir hanya PENDING miliknya sendiri.
-- ---------------------------------------------------------------------
create or replace function public.ldm_cancel_return(
    p_return_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_username text;
    v_return public.sales_returns%rowtype;
    v_item record;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    select *
      into v_return
    from public.sales_returns r
    where r.id = p_return_id
      and r.store_id = v_store_id
      and r.deleted_at is null
    for update;

    if v_return.id is null then
        raise exception 'Retur tidak ditemukan.';
    end if;

    if v_return.status = 'CANCELLED' then
        return jsonb_build_object(
            'id', v_return.id,
            'return_code', v_return.return_code,
            'status', 'CANCELLED',
            'idempotent', true
        );
    end if;

    if v_return.status = 'APPROVED' and v_role <> 'owner' then
        raise exception 'Retur APPROVED hanya dapat dicancel Owner.';
    end if;

    if v_return.status in ('PENDING','REJECTED') then
        if v_role not in ('owner','admin','kasir') then
            raise exception 'Tidak memiliki izin cancel retur.';
        end if;

        if v_role = 'kasir'
           and (
               v_return.status <> 'PENDING'
               or v_return.created_by <> auth.uid()
           ) then
            raise exception 'Kasir hanya dapat cancel retur PENDING miliknya sendiri.';
        end if;
    end if;

    if v_return.status = 'APPROVED'
       and v_return.stock_effect_applied
       and not v_return.legacy_imported then

        for v_item in
            select distinct ri.product_id
            from public.sales_return_items ri
            where ri.return_id = v_return.id
              and ri.restock = true
              and ri.product_id is not null
            order by ri.product_id
        loop
            perform 1
            from public.products p
            where p.id = v_item.product_id
              and p.store_id = v_store_id
              and p.deleted_at is null
            for update;
        end loop;

        for v_item in
            select ri.*
            from public.sales_return_items ri
            where ri.return_id = v_return.id
              and ri.restock = true
              and ri.product_id is not null
            order by ri.product_id, ri.id
        loop
            select *
              into v_product
            from public.products p
            where p.id = v_item.product_id
              and p.store_id = v_store_id
              and p.deleted_at is null
            for update;

            if v_product.id is null then
                raise exception 'Produk % tidak ditemukan.', v_item.product_name_snapshot;
            end if;

            v_before := v_product.legacy_stock_snapshot;
            v_after := v_before - v_item.qty;

            if v_after < 0 then
                raise exception
                    'Stok % tidak cukup untuk membalik retur. Stok saat ini %, perlu %.',
                    v_item.product_name_snapshot, v_before, v_item.qty;
            end if;

            update public.products
               set legacy_stock_snapshot = v_after
             where id = v_product.id;

            insert into public.stock_movements (
                store_id, product_id, transaction_id, transaction_item_id,
                movement_type, quantity_change, stock_before, stock_after,
                unit_cost_snapshot,
                source_type, source_id, reference_code, note,
                created_by, occurred_at
            )
            values (
                v_store_id, v_product.id,
                v_return.transaction_id, v_item.transaction_item_id,
                'return_cancel', -v_item.qty, v_before, v_after,
                v_product.purchase_price,
                'sales_return_cancel', v_item.id::text,
                v_return.return_code,
                'Pembatalan retur ' || v_return.return_code,
                auth.uid(), now()
            )
            on conflict (store_id, product_id, source_type, source_id)
            where source_type is not null and source_id is not null
            do nothing;
        end loop;
    end if;

    update public.cash_movements
       set status = 'reversed',
           reversed_at = now(),
           reversed_by = auth.uid(),
           reverse_reason = nullif(btrim(coalesce(p_reason,'')),'Cancel retur')
     where store_id = v_store_id
       and source_type = 'sales_return'
       and source_id = v_return.id::text
       and status = 'active';

    update public.sales_returns
       set status = 'CANCELLED',
           cancelled_by = auth.uid(),
           cancelled_username = v_username,
           cancelled_at = now(),
           cancel_reason = nullif(btrim(coalesce(p_reason,'')),''),
           stock_effect_applied =
               case
                   when legacy_imported then stock_effect_applied
                   else false
               end
     where id = v_return.id;

    return jsonb_build_object(
        'id', v_return.id,
        'return_code', v_return.return_code,
        'status', 'CANCELLED'
    );
end;
$$;

revoke all on function public.ldm_cancel_return(uuid,text) from public, anon;
grant execute on function public.ldm_cancel_return(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- Soft delete return history. APPROVED harus cancel dulu.
-- ---------------------------------------------------------------------
create or replace function public.ldm_soft_delete_return(
    p_return_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_return public.sales_returns%rowtype;
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat mengarsipkan retur.';
    end if;

    v_store_id := public.ldm_current_store_id();

    select *
      into v_return
    from public.sales_returns r
    where r.id = p_return_id
      and r.store_id = v_store_id
      and r.deleted_at is null
    for update;

    if v_return.id is null then
        raise exception 'Retur tidak ditemukan.';
    end if;

    if v_return.status = 'APPROVED' then
        raise exception 'Retur APPROVED harus dicancel terlebih dahulu.';
    end if;

    update public.sales_returns
       set deleted_at = now(),
           deleted_by = auth.uid()
     where id = v_return.id;

    return jsonb_build_object(
        'id', v_return.id,
        'return_code', v_return.return_code,
        'deleted', true
    );
end;
$$;

revoke all on function public.ldm_soft_delete_return(uuid) from public, anon;
grant execute on function public.ldm_soft_delete_return(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- STOCK OPNAME submit batch.
-- Owner directApprove: stok dan ledger dalam transaksi SQL yang sama.
-- Admin/Kasir: PENDING.
-- ---------------------------------------------------------------------
create or replace function public.ldm_submit_stock_opname(
    p_client_batch_id uuid,
    p_business_date date,
    p_items jsonb,
    p_direct_approve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_username text;
    v_item jsonb;
    v_pid uuid;
    v_product public.products%rowtype;
    v_entry_id uuid;
    v_physical numeric(16,3);
    v_difference numeric(16,3);
    v_nominal numeric(16,2);
    v_before numeric(16,3);
    v_after numeric(16,3);
    v_status text;
    v_result jsonb;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    if v_role not in ('owner','admin','kasir') then
        raise exception 'Role tidak memiliki akses Stock Opname.';
    end if;

    if p_client_batch_id is null then
        raise exception 'client_batch_id wajib diisi.';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Item Stock Opname kosong.';
    end if;

    if p_direct_approve and v_role <> 'owner' then
        raise exception 'Direct approval Stock Opname hanya untuk Owner.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_items) x
        group by (x.value ->> 'product_id')
        having count(*) > 1
    ) then
        raise exception 'Satu barang hanya boleh muncul satu kali dalam satu batch Stock Opname.';
    end if;

    if exists (
        select 1
        from public.stock_opname_entries e
        where e.store_id = v_store_id
          and e.client_batch_id = p_client_batch_id
          and e.deleted_at is null
    ) then
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at),'[]'::jsonb)
          into v_result
        from public.stock_opname_entries e
        where e.store_id = v_store_id
          and e.client_batch_id = p_client_batch_id
          and e.deleted_at is null;

        return v_result;
    end if;

    -- Lock semua produk deterministic.
    for v_pid in
        select distinct (x.value ->> 'product_id')::uuid
        from jsonb_array_elements(p_items) x
        order by 1
    loop
        perform 1
        from public.products p
        where p.id = v_pid
          and p.store_id = v_store_id
          and p.deleted_at is null
        for update;

        if not found then
            raise exception 'Produk Stock Opname % tidak ditemukan.', v_pid;
        end if;
    end loop;

    for v_item in
        select value from jsonb_array_elements(p_items)
    loop
        v_pid := (v_item ->> 'product_id')::uuid;
        v_physical := (v_item ->> 'physical_stock')::numeric;

        if v_physical < 0 then
            raise exception 'Stok fisik tidak boleh negatif.';
        end if;

        select *
          into v_product
        from public.products p
        where p.id = v_pid
          and p.store_id = v_store_id
          and p.deleted_at is null
        for update;

        v_before := v_product.legacy_stock_snapshot;
        v_difference := v_physical - v_before;
        v_nominal := abs(v_difference) * v_product.sale_price;
        v_entry_id := gen_random_uuid();
        v_status := case when p_direct_approve then 'APPROVED' else 'PENDING' end;

        if p_direct_approve then
            v_after := v_before + v_difference;

            update public.products
               set legacy_stock_snapshot = v_after
             where id = v_product.id;

            insert into public.stock_movements (
                store_id, product_id,
                movement_type, quantity_change, stock_before, stock_after,
                unit_cost_snapshot,
                source_type, source_id, reference_code, note,
                created_by, occurred_at
            )
            values (
                v_store_id, v_product.id,
                'stock_opname', v_difference, v_before, v_after,
                v_product.purchase_price,
                'stock_opname', v_entry_id::text,
                'OPN-' || upper(substr(replace(v_entry_id::text,'-',''),1,8)),
                coalesce(nullif(btrim(v_item ->> 'note'),''),'Stock Opname'),
                auth.uid(), now()
            );
        else
            v_after := null;
        end if;

        insert into public.stock_opname_entries (
            id, store_id, client_batch_id, client_item_id,
            business_date,
            product_id, product_name_snapshot, barcode_snapshot, unit_snapshot,
            system_stock_snapshot, physical_stock,
            difference_snapshot, nominal_snapshot,
            note,
            created_by, created_username,
            status,
            applied_stock_before, applied_stock_after,
            stock_effect_applied,
            approved_by, approved_username, approved_at
        )
        values (
            v_entry_id, v_store_id, p_client_batch_id,
            nullif(btrim(coalesce(v_item ->> 'client_item_id','')),''),
            coalesce(p_business_date, current_date),
            v_product.id, v_product.name, v_product.barcode, v_product.unit,
            v_before, v_physical,
            v_difference, v_nominal,
            nullif(btrim(coalesce(v_item ->> 'note','')),''),
            auth.uid(), v_username,
            v_status,
            case when p_direct_approve then v_before else null end,
            case when p_direct_approve then v_after else null end,
            p_direct_approve,
            case when p_direct_approve then auth.uid() else null end,
            case when p_direct_approve then v_username else null end,
            case when p_direct_approve then now() else null end
        );
    end loop;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at),'[]'::jsonb)
      into v_result
    from public.stock_opname_entries e
    where e.store_id = v_store_id
      and e.client_batch_id = p_client_batch_id
      and e.deleted_at is null;

    return v_result;
end;
$$;

revoke all on function public.ldm_submit_stock_opname(uuid,date,jsonb,boolean)
from public, anon;
grant execute on function public.ldm_submit_stock_opname(uuid,date,jsonb,boolean)
to authenticated;

-- ---------------------------------------------------------------------
-- Approve pending Stock Opname.
-- Terapkan difference_snapshot ke stok TERBARU.
-- ---------------------------------------------------------------------
create or replace function public.ldm_approve_stock_opname(
    p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_username text;
    v_entry public.stock_opname_entries%rowtype;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Approval Stock Opname hanya dapat dilakukan Owner.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_username := public.ldm_current_username();

    select *
      into v_entry
    from public.stock_opname_entries e
    where e.id = p_entry_id
      and e.store_id = v_store_id
      and e.deleted_at is null
    for update;

    if v_entry.id is null then
        raise exception 'Stock Opname tidak ditemukan.';
    end if;

    if v_entry.status = 'APPROVED' then
        return jsonb_build_object(
            'id', v_entry.id,
            'status', 'APPROVED',
            'idempotent', true
        );
    end if;

    if v_entry.status <> 'PENDING' then
        raise exception 'Hanya Stock Opname PENDING yang dapat diapprove.';
    end if;

    if v_entry.product_id is null then
        raise exception 'Stock Opname legacy tanpa product UUID tidak dapat diterapkan.';
    end if;

    select *
      into v_product
    from public.products p
    where p.id = v_entry.product_id
      and p.store_id = v_store_id
      and p.deleted_at is null
    for update;

    if v_product.id is null then
        raise exception 'Produk Stock Opname tidak ditemukan.';
    end if;

    v_before := v_product.legacy_stock_snapshot;
    v_after := v_before + v_entry.difference_snapshot;

    if v_after < 0 then
        raise exception
            'Stock Opname sudah stale. Stok terbaru % dan delta % menghasilkan stok negatif. Lakukan hitung ulang.',
            v_before, v_entry.difference_snapshot;
    end if;

    update public.products
       set legacy_stock_snapshot = v_after
     where id = v_product.id;

    insert into public.stock_movements (
        store_id, product_id,
        movement_type, quantity_change, stock_before, stock_after,
        unit_cost_snapshot,
        source_type, source_id, reference_code, note,
        created_by, occurred_at
    )
    values (
        v_store_id, v_product.id,
        'stock_opname', v_entry.difference_snapshot, v_before, v_after,
        v_product.purchase_price,
        'stock_opname', v_entry.id::text,
        'OPN-' || upper(substr(replace(v_entry.id::text,'-',''),1,8)),
        coalesce(v_entry.note,'Stock Opname'),
        auth.uid(), now()
    )
    on conflict (store_id, product_id, source_type, source_id)
    where source_type is not null and source_id is not null
    do nothing;

    update public.stock_opname_entries
       set status = 'APPROVED',
           applied_stock_before = v_before,
           applied_stock_after = v_after,
           stock_effect_applied = true,
           approved_by = auth.uid(),
           approved_username = v_username,
           approved_at = now()
     where id = v_entry.id;

    return jsonb_build_object(
        'id', v_entry.id,
        'status', 'APPROVED',
        'stock_before', v_before,
        'stock_after', v_after,
        'difference', v_entry.difference_snapshot
    );
end;
$$;

revoke all on function public.ldm_approve_stock_opname(uuid) from public, anon;
grant execute on function public.ldm_approve_stock_opname(uuid) to authenticated;

create or replace function public.ldm_reject_stock_opname(
    p_entry_id uuid,
    p_reason text default 'Ditolak Owner'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_username text;
    v_entry public.stock_opname_entries%rowtype;
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Penolakan Stock Opname hanya dapat dilakukan Owner.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_username := public.ldm_current_username();

    select *
      into v_entry
    from public.stock_opname_entries e
    where e.id = p_entry_id
      and e.store_id = v_store_id
      and e.deleted_at is null
    for update;

    if v_entry.id is null then
        raise exception 'Stock Opname tidak ditemukan.';
    end if;

    if v_entry.status <> 'PENDING' then
        raise exception 'Hanya Stock Opname PENDING yang dapat ditolak.';
    end if;

    update public.stock_opname_entries
       set status = 'REJECTED',
           rejected_by = auth.uid(),
           rejected_username = v_username,
           rejected_at = now(),
           reject_reason = nullif(btrim(coalesce(p_reason,'')),'')
     where id = v_entry.id;

    return jsonb_build_object('id',v_entry.id,'status','REJECTED');
end;
$$;

revoke all on function public.ldm_reject_stock_opname(uuid,text) from public, anon;
grant execute on function public.ldm_reject_stock_opname(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- Cancel approved Stock Opname dengan reverse delta.
-- ---------------------------------------------------------------------
create or replace function public.ldm_cancel_stock_opname(
    p_entry_id uuid,
    p_reason text default 'Dibatalkan Owner'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_username text;
    v_entry public.stock_opname_entries%rowtype;
    v_product public.products%rowtype;
    v_before numeric(16,3);
    v_after numeric(16,3);
    v_reverse numeric(16,3);
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Cancel Stock Opname hanya dapat dilakukan Owner.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_username := public.ldm_current_username();

    select *
      into v_entry
    from public.stock_opname_entries e
    where e.id = p_entry_id
      and e.store_id = v_store_id
      and e.deleted_at is null
    for update;

    if v_entry.id is null then
        raise exception 'Stock Opname tidak ditemukan.';
    end if;

    if v_entry.status = 'CANCELLED' then
        return jsonb_build_object('id',v_entry.id,'status','CANCELLED','idempotent',true);
    end if;

    if v_entry.status <> 'APPROVED' then
        raise exception 'Hanya Stock Opname APPROVED yang dapat dicancel.';
    end if;

    if v_entry.stock_effect_applied
       and not v_entry.legacy_imported
       and v_entry.product_id is not null then

        select *
          into v_product
        from public.products p
        where p.id = v_entry.product_id
          and p.store_id = v_store_id
          and p.deleted_at is null
        for update;

        v_before := v_product.legacy_stock_snapshot;
        v_reverse := -v_entry.difference_snapshot;
        v_after := v_before + v_reverse;

        if v_after < 0 then
            raise exception
                'Stok tidak cukup untuk membalik Stock Opname. Stok %, reverse delta %.',
                v_before, v_reverse;
        end if;

        update public.products
           set legacy_stock_snapshot = v_after
         where id = v_product.id;

        insert into public.stock_movements (
            store_id, product_id,
            movement_type, quantity_change, stock_before, stock_after,
            unit_cost_snapshot,
            source_type, source_id, reference_code, note,
            created_by, occurred_at
        )
        values (
            v_store_id, v_product.id,
            'adjustment', v_reverse, v_before, v_after,
            v_product.purchase_price,
            'stock_opname_cancel', v_entry.id::text,
            'OPN-CANCEL-' || upper(substr(replace(v_entry.id::text,'-',''),1,8)),
            'Pembatalan Stock Opname: ' || coalesce(p_reason,''),
            auth.uid(), now()
        )
        on conflict (store_id, product_id, source_type, source_id)
        where source_type is not null and source_id is not null
        do nothing;
    end if;

    update public.stock_opname_entries
       set status = 'CANCELLED',
           stock_effect_applied =
               case when legacy_imported then stock_effect_applied else false end,
           cancelled_by = auth.uid(),
           cancelled_username = v_username,
           cancelled_at = now(),
           cancel_reason = nullif(btrim(coalesce(p_reason,'')),'')
     where id = v_entry.id;

    return jsonb_build_object('id',v_entry.id,'status','CANCELLED');
end;
$$;

revoke all on function public.ldm_cancel_stock_opname(uuid,text) from public, anon;
grant execute on function public.ldm_cancel_stock_opname(uuid,text) to authenticated;

create or replace function public.ldm_soft_delete_stock_opname(
    p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_entry public.stock_opname_entries%rowtype;
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat mengarsipkan Stock Opname.';
    end if;

    v_store_id := public.ldm_current_store_id();

    select *
      into v_entry
    from public.stock_opname_entries e
    where e.id = p_entry_id
      and e.store_id = v_store_id
      and e.deleted_at is null
    for update;

    if v_entry.id is null then
        raise exception 'Stock Opname tidak ditemukan.';
    end if;

    if v_entry.status in ('APPROVED','PENDING') then
        raise exception 'Stock Opname APPROVED/PENDING tidak boleh langsung diarsipkan. Approve/reject/cancel terlebih dahulu.';
    end if;

    update public.stock_opname_entries
       set deleted_at = now(),
           deleted_by = auth.uid()
     where id = v_entry.id;

    return jsonb_build_object('id',v_entry.id,'deleted',true);
end;
$$;

revoke all on function public.ldm_soft_delete_stock_opname(uuid) from public, anon;
grant execute on function public.ldm_soft_delete_stock_opname(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- LEGACY IMPORT RETUR.
-- HISTORY ONLY. TIDAK MENERAPKAN stok/kas.
-- ---------------------------------------------------------------------
create or replace function public.ldm_import_legacy_returns(
    p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_username text;
    v_row jsonb;
    v_return_id uuid;
    v_code text;
    v_status text;
    v_item jsonb;
    v_product_id uuid;
    v_total numeric(16,2);
    v_count integer := 0;
    v_legacy_id text;
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Migrasi Retur legacy hanya dapat dilakukan Owner.';
    end if;

    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows harus JSON array.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_username := public.ldm_current_username();

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        v_legacy_id := nullif(btrim(coalesce(v_row ->> 'legacy_source_id','')),'');
        v_code := coalesce(nullif(btrim(v_row ->> 'return_code'),''),'LEGACY-RTR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
        v_status := upper(coalesce(nullif(btrim(v_row ->> 'status'),''),'PENDING'));

        if v_status not in ('PENDING','APPROVED','REJECTED','CANCELLED') then
            v_status := 'PENDING';
        end if;

        if v_legacy_id is not null and exists (
            select 1 from public.sales_returns r
            where r.store_id = v_store_id
              and r.legacy_source_id = v_legacy_id
        ) then
            continue;
        end if;

        v_return_id := gen_random_uuid();
        v_total := coalesce((v_row ->> 'total_refund')::numeric,0);

        insert into public.sales_returns (
            id, store_id, return_code,
            transaction_code_snapshot, original_cashier_snapshot,
            created_by, created_username,
            refund_method, refund_username, refund_shift_label,
            note, total_refund, status,
            approved_username, approved_at,
            rejected_username, rejected_at, reject_reason,
            cancelled_username, cancelled_at, cancel_reason,
            legacy_imported, stock_effect_applied, legacy_source_id,
            created_at
        )
        values (
            v_return_id, v_store_id, v_code,
            coalesce(v_row ->> 'transaction_code','LEGACY'),
            v_row ->> 'original_cashier',
            auth.uid(), coalesce(nullif(v_row ->> 'created_username',''),v_username),
            case when lower(v_row ->> 'refund_method')='tunai' then 'Tunai' else 'Non Tunai' end,
            v_row ->> 'refund_username',
            v_row ->> 'refund_shift_label',
            nullif(v_row ->> 'note',''),
            v_total, v_status,
            v_row ->> 'approved_username',
            nullif(v_row ->> 'approved_at','')::timestamptz,
            v_row ->> 'rejected_username',
            nullif(v_row ->> 'rejected_at','')::timestamptz,
            v_row ->> 'reject_reason',
            v_row ->> 'cancelled_username',
            nullif(v_row ->> 'cancelled_at','')::timestamptz,
            v_row ->> 'cancel_reason',
            true, false, v_legacy_id,
            coalesce(nullif(v_row ->> 'created_at','')::timestamptz, now())
        );

        for v_item in
            select value from jsonb_array_elements(coalesce(v_row -> 'items','[]'::jsonb))
        loop
            v_product_id := null;

            select p.id
              into v_product_id
            from public.products p
            where p.store_id = v_store_id
              and p.deleted_at is null
              and (
                    (
                        nullif(btrim(v_item ->> 'barcode'),'') is not null
                        and p.barcode = btrim(v_item ->> 'barcode')
                    )
                    or lower(btrim(p.name)) = lower(btrim(coalesce(v_item ->> 'name','')))
              )
            order by
                case
                    when p.barcode = btrim(v_item ->> 'barcode') then 0
                    else 1
                end
            limit 1;

            insert into public.sales_return_items (
                store_id, return_id, product_id,
                product_name_snapshot, barcode_snapshot, unit_snapshot,
                qty, refund_unit_price, refund_amount,
                reason, restock
            )
            values (
                v_store_id, v_return_id, v_product_id,
                coalesce(nullif(v_item ->> 'name',''),'Barang Legacy'),
                nullif(v_item ->> 'barcode',''),
                coalesce(nullif(v_item ->> 'unit',''),'Pcs'),
                greatest(coalesce((v_item ->> 'qty')::numeric,0.001),0.001),
                greatest(coalesce((v_item ->> 'unit_price')::numeric,0),0),
                greatest(coalesce((v_item ->> 'refund_amount')::numeric,0),0),
                nullif(v_item ->> 'reason',''),
                coalesce((v_item ->> 'restock')::boolean,true)
            );
        end loop;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_import_legacy_returns(jsonb) from public, anon;
grant execute on function public.ldm_import_legacy_returns(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- LEGACY IMPORT STOCK OPNAME.
-- HISTORY ONLY. TIDAK MENERAPKAN stok lagi.
-- ---------------------------------------------------------------------
create or replace function public.ldm_import_legacy_stock_opname(
    p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_username text;
    v_row jsonb;
    v_product_id uuid;
    v_status text;
    v_legacy_id text;
    v_count integer := 0;
begin
    if public.ldm_current_role() <> 'owner' then
        raise exception 'Migrasi Stock Opname legacy hanya dapat dilakukan Owner.';
    end if;

    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows harus JSON array.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_username := public.ldm_current_username();

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        v_legacy_id := nullif(btrim(coalesce(v_row ->> 'legacy_source_id','')),'');

        if v_legacy_id is not null and exists (
            select 1 from public.stock_opname_entries e
            where e.store_id = v_store_id
              and e.legacy_source_id = v_legacy_id
        ) then
            continue;
        end if;

        v_product_id := null;

        select p.id
          into v_product_id
        from public.products p
        where p.store_id = v_store_id
          and p.deleted_at is null
          and (
                (
                    nullif(btrim(v_row ->> 'barcode'),'') is not null
                    and p.barcode = btrim(v_row ->> 'barcode')
                )
                or lower(btrim(p.name)) = lower(btrim(coalesce(v_row ->> 'name','')))
          )
        order by
            case when p.barcode = btrim(v_row ->> 'barcode') then 0 else 1 end
        limit 1;

        v_status := upper(coalesce(nullif(btrim(v_row ->> 'status'),''),'PENDING'));

        if v_status in ('TERVALIDASI','VALIDATED') then
            v_status := 'APPROVED';
        elsif v_status in ('PENDING') then
            v_status := 'PENDING';
        elsif v_status in ('REJECTED','DITOLAK') then
            v_status := 'REJECTED';
        elsif v_status in ('CANCELLED','DIBATALKAN') then
            v_status := 'CANCELLED';
        else
            v_status := 'PENDING';
        end if;

        insert into public.stock_opname_entries (
            store_id, business_date,
            product_id, product_name_snapshot, barcode_snapshot, unit_snapshot,
            system_stock_snapshot, physical_stock,
            difference_snapshot, nominal_snapshot,
            note, created_by, created_username,
            status,
            legacy_imported, stock_effect_applied, legacy_source_id,
            created_at
        )
        values (
            v_store_id,
            (v_row ->> 'business_date')::date,
            v_product_id,
            coalesce(nullif(v_row ->> 'name',''),'Barang Legacy'),
            nullif(v_row ->> 'barcode',''),
            coalesce(nullif(v_row ->> 'unit',''),'Pcs'),
            coalesce((v_row ->> 'system_stock')::numeric,0),
            greatest(coalesce((v_row ->> 'physical_stock')::numeric,0),0),
            coalesce((v_row ->> 'difference')::numeric,0),
            greatest(coalesce((v_row ->> 'nominal')::numeric,0),0),
            nullif(v_row ->> 'note',''),
            auth.uid(),
            coalesce(nullif(v_row ->> 'created_username',''),v_username),
            v_status,
            true, false, v_legacy_id,
            coalesce(nullif(v_row ->> 'created_at','')::timestamptz, now())
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_import_legacy_stock_opname(jsonb) from public, anon;
grant execute on function public.ldm_import_legacy_stock_opname(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
    if exists (select 1 from pg_publication where pubname='supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname='supabase_realtime'
              and schemaname='public'
              and tablename='sales_returns'
        ) then
            alter publication supabase_realtime add table public.sales_returns;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname='supabase_realtime'
              and schemaname='public'
              and tablename='sales_return_items'
        ) then
            alter publication supabase_realtime add table public.sales_return_items;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname='supabase_realtime'
              and schemaname='public'
              and tablename='cash_movements'
        ) then
            alter publication supabase_realtime add table public.cash_movements;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname='supabase_realtime'
              and schemaname='public'
              and tablename='stock_opname_entries'
        ) then
            alter publication supabase_realtime add table public.stock_opname_entries;
        end if;
    end if;
end
$$;

insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','10'),
    ('schema_version','10'),
    ('schema_status','cloud_returns_stock_opname_ready'),
    ('returns_authority','public.sales_returns'),
    ('return_items_authority','public.sales_return_items'),
    ('return_stock_mode','atomic_rpc'),
    ('cash_movement_authority','public.cash_movements'),
    ('stock_opname_authority','public.stock_opname_entries'),
    ('stock_opname_apply_mode','delta_on_latest_stock'),
    ('inventory_transition','returns_and_stock_opname_cloud'),
    ('shift_management','removed')
on conflict (key)
do update set value=excluded.value, updated_at=now();

commit;

select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_version',
    'schema_status',
    'returns_authority',
    'return_items_authority',
    'return_stock_mode',
    'cash_movement_authority',
    'stock_opname_authority',
    'stock_opname_apply_mode',
    'inventory_transition',
    'shift_management'
)
order by key;

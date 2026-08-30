-- ================================================================
-- LocDailyMar - Live Sync Tahap 8
-- Cloud Transactions + Transaction Items + Atomic Stock Movements
--
-- PRASYARAT:
--   Tahap 4 - Cloud Foundation
--   Tahap 5/6 - Supabase Auth
--   Tahap 7 - public.products + UUID produk
--
-- GARANSI UTAMA:
--   Checkout dijalankan dalam SATU transaksi PostgreSQL.
--   Jika salah satu langkah gagal, semuanya rollback:
--     - header transaksi
--     - item transaksi
--     - pengurangan stok
--     - stock_movements
--
-- Shift Management tetap tidak digunakan.
-- shift_label hanyalah snapshot atribut Absensi legacy.
-- ================================================================

begin;

-- ------------------------------------------------
-- Validasi foundation
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'public.products belum ada. Jalankan Tahap 7 terlebih dahulu.';
    end if;

    if to_regclass('public.profiles') is null then
        raise exception 'public.profiles belum ada.';
    end if;
end
$$;

-- ------------------------------------------------
-- TRANSACTIONS
-- ------------------------------------------------
create table if not exists public.transactions (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null
        references public.stores(id)
        on delete restrict,

    client_transaction_id uuid not null,
    transaction_code text not null,

    cashier_user_id uuid not null
        references auth.users(id)
        on delete restrict,
    cashier_username text not null,

    shift_label text,

    business_date date not null,
    transacted_at timestamptz not null default now(),

    payment_method text not null
        check (payment_method in ('Tunai', 'Non Tunai')),

    normal_subtotal numeric(16,2) not null default 0,
    subtotal numeric(16,2) not null default 0,
    product_discount numeric(16,2) not null default 0,
    manual_discount numeric(16,2) not null default 0,
    total_discount numeric(16,2) not null default 0,
    grand_total numeric(16,2) not null default 0,

    cash_received numeric(16,2) not null default 0,
    cash_amount numeric(16,2) not null default 0,
    qris_amount numeric(16,2) not null default 0,
    change_amount numeric(16,2) not null default 0,

    status text not null default 'completed'
        check (status in ('completed', 'voided')),

    voided_at timestamptz,
    voided_by uuid references auth.users(id),
    void_reason text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1
);

create unique index if not exists transactions_store_client_id_unique
on public.transactions(store_id, client_transaction_id);

create unique index if not exists transactions_store_code_unique
on public.transactions(store_id, transaction_code);

create index if not exists transactions_store_date_idx
on public.transactions(store_id, business_date, transacted_at desc);

create index if not exists transactions_store_cashier_idx
on public.transactions(store_id, cashier_user_id, transacted_at desc);

-- ------------------------------------------------
-- TRANSACTION ITEMS
-- ------------------------------------------------
create table if not exists public.transaction_items (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null
        references public.stores(id)
        on delete restrict,
    transaction_id uuid not null
        references public.transactions(id)
        on delete restrict,
    product_id uuid not null
        references public.products(id)
        on delete restrict,

    product_name_snapshot text not null,
    barcode_snapshot text,
    unit_snapshot text,

    qty numeric(16,3) not null
        check (qty > 0),

    cost_price_snapshot numeric(16,2) not null default 0,
    normal_unit_price numeric(16,2) not null default 0,
    unit_price numeric(16,2) not null default 0,
    line_normal_subtotal numeric(16,2) not null default 0,
    line_discount numeric(16,2) not null default 0,
    line_subtotal numeric(16,2) not null default 0,

    created_at timestamptz not null default now()
);

create index if not exists transaction_items_transaction_idx
on public.transaction_items(transaction_id);

create index if not exists transaction_items_product_idx
on public.transaction_items(store_id, product_id, created_at desc);

-- ------------------------------------------------
-- STOCK MOVEMENTS
-- Append-only ledger.
-- ------------------------------------------------
create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null
        references public.stores(id)
        on delete restrict,
    product_id uuid not null
        references public.products(id)
        on delete restrict,

    transaction_id uuid
        references public.transactions(id)
        on delete restrict,
    transaction_item_id uuid
        references public.transaction_items(id)
        on delete restrict,

    movement_type text not null
        check (
            movement_type in (
                'opening_balance',
                'sale',
                'sale_void',
                'goods_receipt',
                'stock_opname',
                'return',
                'return_cancel',
                'adjustment'
            )
        ),

    quantity_change numeric(16,3) not null,
    stock_before numeric(16,3) not null,
    stock_after numeric(16,3) not null,

    unit_cost_snapshot numeric(16,2) not null default 0,

    source_type text,
    source_id text,
    reference_code text,
    note text,

    created_by uuid not null
        references auth.users(id)
        on delete restrict,

    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists stock_movements_product_idx
on public.stock_movements(store_id, product_id, occurred_at desc);

create index if not exists stock_movements_transaction_idx
on public.stock_movements(transaction_id);

create unique index if not exists stock_movements_source_unique
on public.stock_movements(
    store_id,
    product_id,
    source_type,
    source_id
)
where source_type is not null
  and source_id is not null;

-- Touch trigger hanya untuk table mutable.
drop trigger if exists trg_transactions_touch_row
on public.transactions;

create trigger trg_transactions_touch_row
before update on public.transactions
for each row
execute function public.ldm_touch_row();

-- ------------------------------------------------
-- RLS + table privileges
-- ------------------------------------------------
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.transactions from anon;
revoke all on public.transaction_items from anon;
revoke all on public.stock_movements from anon;

-- Browser hanya membaca. Semua write dilakukan RPC atomic.
grant select on public.transactions to authenticated;
grant select on public.transaction_items to authenticated;
grant select on public.stock_movements to authenticated;

revoke insert, update, delete on public.transactions from authenticated;
revoke insert, update, delete on public.transaction_items from authenticated;
revoke insert, update, delete on public.stock_movements from authenticated;

-- Setelah Tahap 8, perubahan Master Barang dari browser juga melalui RPC.
-- Ini mencegah stock snapshot ditimpa direct UPDATE.
revoke insert, update, delete on public.products from authenticated;
grant select on public.products to authenticated;

-- Transactions SELECT same store.
drop policy if exists transactions_select_same_store
on public.transactions;

create policy transactions_select_same_store
on public.transactions
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
);

-- Items SELECT same store.
drop policy if exists transaction_items_select_same_store
on public.transaction_items;

create policy transaction_items_select_same_store
on public.transaction_items
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
);

-- Ledger SELECT same store.
drop policy if exists stock_movements_select_same_store
on public.stock_movements;

create policy stock_movements_select_same_store
on public.stock_movements
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
);

-- ------------------------------------------------
-- Seed ledger opening balance dari snapshot Tahap 7.
-- Idempotent melalui source unique index.
-- ------------------------------------------------
insert into public.stock_movements (
    store_id,
    product_id,
    movement_type,
    quantity_change,
    stock_before,
    stock_after,
    unit_cost_snapshot,
    source_type,
    source_id,
    reference_code,
    note,
    created_by,
    occurred_at
)
select
    p.store_id,
    p.id,
    'opening_balance',
    p.legacy_stock_snapshot,
    0,
    p.legacy_stock_snapshot,
    p.purchase_price,
    'stage8_opening',
    p.id::text,
    'STAGE8-OPENING',
    'Opening balance dari snapshot stok saat Tahap 8 diaktifkan.',
    coalesce(
        (
            select pr.id
            from public.profiles pr
            where pr.store_id = p.store_id
              and pr.role = 'owner'
              and pr.active = true
              and pr.deleted_at is null
            order by pr.created_at
            limit 1
        ),
        auth.uid()
    ),
    now()
from public.products p
where p.deleted_at is null
  and not exists (
      select 1
      from public.stock_movements sm
      where sm.store_id = p.store_id
        and sm.product_id = p.id
        and sm.source_type = 'stage8_opening'
        and sm.source_id = p.id::text
  )
  and coalesce(
      (
          select pr.id
          from public.profiles pr
          where pr.store_id = p.store_id
            and pr.role = 'owner'
            and pr.active = true
            and pr.deleted_at is null
          order by pr.created_at
          limit 1
      ),
      auth.uid()
  ) is not null;

-- ------------------------------------------------
-- Replace Stage 7 Master Barang importer.
-- PENTING:
-- Existing products TIDAK lagi mengubah legacy_stock_snapshot.
-- Stok hanya berubah melalui stock movement RPC.
-- Produk baru boleh mempunyai opening stock pertama.
-- ------------------------------------------------
create or replace function public.ldm_import_legacy_products(
    p_products jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_item jsonb;
    v_count integer := 0;

    v_id uuid;
    v_inserted_id uuid;
    v_barcode text;
    v_name text;
    v_category text;
    v_unit text;

    v_purchase_price numeric(16,2);
    v_sale_price numeric(16,2);
    v_initial_stock numeric(16,3);

    v_promo jsonb;
    v_promo_active boolean;
    v_promo_price numeric(16,2);
    v_promo_min_qty numeric(16,3);
    v_promo_start date;
    v_promo_end date;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null then
        raise exception 'Store profile tidak ditemukan.';
    end if;

    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat sinkron Master Barang.';
    end if;

    if p_products is null
       or jsonb_typeof(p_products) <> 'array' then
        raise exception 'p_products harus berupa JSON array.';
    end if;

    for v_item in
        select value
        from jsonb_array_elements(p_products)
    loop
        v_id := null;
        v_inserted_id := null;

        begin
            if nullif(
                btrim(coalesce(v_item ->> 'id', '')),
                ''
            ) is not null then
                v_id := (v_item ->> 'id')::uuid;
            end if;
        exception
            when invalid_text_representation then
                v_id := null;
        end;

        v_barcode := nullif(
            btrim(coalesce(v_item ->> 'barcode', '')),
            ''
        );

        v_name := btrim(
            coalesce(
                v_item ->> 'nama',
                v_item ->> 'name',
                ''
            )
        );

        if v_name = '' then
            raise exception 'Nama barang tidak boleh kosong.';
        end if;

        v_category := nullif(
            btrim(
                coalesce(
                    v_item ->> 'kategori',
                    v_item ->> 'category',
                    ''
                )
            ),
            ''
        );

        v_unit := nullif(
            btrim(
                coalesce(
                    v_item ->> 'satuan',
                    v_item ->> 'unit',
                    ''
                )
            ),
            ''
        );

        v_purchase_price := greatest(
            coalesce(
                nullif(v_item ->> 'hargaBeli', '')::numeric,
                0
            ),
            0
        );

        v_sale_price := greatest(
            coalesce(
                nullif(v_item ->> 'harga', '')::numeric,
                0
            ),
            0
        );

        v_initial_stock := coalesce(
            nullif(v_item ->> 'stok', '')::numeric,
            0
        );

        v_promo := coalesce(
            v_item -> 'promo',
            '{}'::jsonb
        );

        v_promo_active := coalesce(
            (v_promo ->> 'aktif')::boolean,
            false
        );

        v_promo_price := nullif(
            v_promo ->> 'hargaPromo',
            ''
        )::numeric;

        v_promo_min_qty := greatest(
            coalesce(
                nullif(v_promo ->> 'minQty', '')::numeric,
                1
            ),
            1
        );

        v_promo_start := nullif(
            v_promo ->> 'tglMulai',
            ''
        )::date;

        v_promo_end := nullif(
            v_promo ->> 'tglSelesai',
            ''
        )::date;

        -- UUID existing: update MASTER only, stock untouched.
        if v_id is not null
           and exists (
               select 1
               from public.products p
               where p.id = v_id
                 and p.store_id = v_store_id
           ) then

            update public.products
               set barcode = v_barcode,
                   name = v_name,
                   category = v_category,
                   unit = v_unit,
                   purchase_price = v_purchase_price,
                   sale_price = v_sale_price,
                   promo_active = v_promo_active,
                   promo_price = v_promo_price,
                   promo_min_qty = v_promo_min_qty,
                   promo_start_date = v_promo_start,
                   promo_end_date = v_promo_end,
                   active = true,
                   deleted_at = null,
                   deleted_by = null
             where id = v_id
               and store_id = v_store_id;

        -- Barcode existing: update MASTER only, stock untouched.
        elsif v_barcode is not null
          and exists (
              select 1
              from public.products p
              where p.store_id = v_store_id
                and p.barcode = v_barcode
                and p.deleted_at is null
          ) then

            update public.products
               set name = v_name,
                   category = v_category,
                   unit = v_unit,
                   purchase_price = v_purchase_price,
                   sale_price = v_sale_price,
                   promo_active = v_promo_active,
                   promo_price = v_promo_price,
                   promo_min_qty = v_promo_min_qty,
                   promo_start_date = v_promo_start,
                   promo_end_date = v_promo_end,
                   active = true
             where store_id = v_store_id
               and barcode = v_barcode
               and deleted_at is null;

        -- Produk baru: initial stock dicatat sebagai opening movement.
        else
            insert into public.products (
                store_id,
                barcode,
                name,
                category,
                unit,
                purchase_price,
                sale_price,
                legacy_stock_snapshot,
                promo_active,
                promo_price,
                promo_min_qty,
                promo_start_date,
                promo_end_date,
                active
            )
            values (
                v_store_id,
                v_barcode,
                v_name,
                v_category,
                v_unit,
                v_purchase_price,
                v_sale_price,
                v_initial_stock,
                v_promo_active,
                v_promo_price,
                v_promo_min_qty,
                v_promo_start,
                v_promo_end,
                true
            )
            returning id into v_inserted_id;

            insert into public.stock_movements (
                store_id,
                product_id,
                movement_type,
                quantity_change,
                stock_before,
                stock_after,
                unit_cost_snapshot,
                source_type,
                source_id,
                reference_code,
                note,
                created_by
            )
            values (
                v_store_id,
                v_inserted_id,
                'opening_balance',
                v_initial_stock,
                0,
                v_initial_stock,
                v_purchase_price,
                'product_create',
                v_inserted_id::text,
                'PRODUCT-CREATE',
                'Opening stock produk baru dari Master Barang.',
                auth.uid()
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_import_legacy_products(jsonb)
from public, anon;
grant execute on function public.ldm_import_legacy_products(jsonb)
to authenticated;

-- ------------------------------------------------
-- Atomic checkout RPC
-- ------------------------------------------------
create or replace function public.ldm_complete_sale(
    p_client_transaction_id uuid,
    p_items jsonb,
    p_manual_discount numeric default 0,
    p_payment_method text default 'Tunai',
    p_cash_received numeric default 0,
    p_cash_amount numeric default 0,
    p_qris_amount numeric default 0,
    p_shift_label text default null
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
    v_timezone text;
    v_business_date date;

    v_existing public.transactions%rowtype;
    v_transaction_id uuid;
    v_transaction_code text;
    v_transaction_item_id uuid;

    v_item jsonb;
    v_product public.products%rowtype;
    v_product_id uuid;
    v_qty numeric(16,3);

    v_normal_unit numeric(16,2);
    v_unit_price numeric(16,2);
    v_line_normal numeric(16,2);
    v_line_subtotal numeric(16,2);
    v_line_discount numeric(16,2);

    v_normal_subtotal numeric(16,2) := 0;
    v_subtotal numeric(16,2) := 0;
    v_product_discount numeric(16,2) := 0;
    v_manual_discount numeric(16,2) := 0;
    v_total_discount numeric(16,2) := 0;
    v_grand_total numeric(16,2) := 0;

    v_cash_received numeric(16,2) := 0;
    v_cash_amount numeric(16,2) := 0;
    v_qris_amount numeric(16,2) := 0;
    v_change_amount numeric(16,2) := 0;

    v_stock_before numeric(16,3);
    v_stock_after numeric(16,3);

    v_computed_items jsonb := '[]'::jsonb;
    v_result_items jsonb := '[]'::jsonb;
begin
    if p_client_transaction_id is null then
        raise exception 'client_transaction_id wajib diisi.';
    end if;

    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    select
        p.username,
        s.timezone
    into
        v_username,
        v_timezone
    from public.profiles p
    join public.stores s
      on s.id = p.store_id
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
      and s.status = 'active'
      and s.deleted_at is null
    limit 1;

    if v_store_id is null
       or v_username is null then
        raise exception 'Profile/store Auth tidak valid.';
    end if;

    if v_role not in ('owner', 'admin', 'kasir') then
        raise exception 'Role % tidak diizinkan transaksi.', v_role;
    end if;

    -- Idempotency: request yang sama tidak boleh memotong stok dua kali.
    select *
      into v_existing
    from public.transactions t
    where t.store_id = v_store_id
      and t.client_transaction_id = p_client_transaction_id
    limit 1;

    if found then
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', ti.id,
                    'product_id', ti.product_id,
                    'nama', ti.product_name_snapshot,
                    'barcode', ti.barcode_snapshot,
                    'satuan', ti.unit_snapshot,
                    'qty', ti.qty,
                    'hargaNormal', ti.normal_unit_price,
                    'harga', ti.unit_price,
                    'subtotal', ti.line_subtotal,
                    'diskon', ti.line_discount,
                    'hargaBeli', ti.cost_price_snapshot
                )
                order by ti.created_at, ti.id
            ),
            '[]'::jsonb
        )
        into v_result_items
        from public.transaction_items ti
        where ti.transaction_id = v_existing.id;

        return jsonb_build_object(
            'id', v_existing.id,
            'client_transaction_id', v_existing.client_transaction_id,
            'transaction_code', v_existing.transaction_code,
            'business_date', v_existing.business_date,
            'transacted_at', v_existing.transacted_at,
            'cashier_username', v_existing.cashier_username,
            'shift_label', v_existing.shift_label,
            'payment_method', v_existing.payment_method,
            'normal_subtotal', v_existing.normal_subtotal,
            'subtotal', v_existing.subtotal,
            'product_discount', v_existing.product_discount,
            'manual_discount', v_existing.manual_discount,
            'total_discount', v_existing.total_discount,
            'grand_total', v_existing.grand_total,
            'cash_received', v_existing.cash_received,
            'cash_amount', v_existing.cash_amount,
            'qris_amount', v_existing.qris_amount,
            'change_amount', v_existing.change_amount,
            'status', v_existing.status,
            'items', v_result_items,
            'idempotent_replay', true
        );
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Keranjang transaksi kosong.';
    end if;

    v_timezone := coalesce(nullif(v_timezone, ''), 'Asia/Makassar');
    v_business_date := (now() at time zone v_timezone)::date;

    -- Kunci produk secara deterministic untuk mengurangi risiko deadlock.
    for v_product_id in
        select distinct (x.value ->> 'product_id')::uuid
        from jsonb_array_elements(p_items) x
        order by 1
    loop
        perform 1
        from public.products p
        where p.id = v_product_id
          and p.store_id = v_store_id
          and p.active = true
          and p.deleted_at is null
        for update;

        if not found then
            raise exception 'Produk % tidak ditemukan/aktif pada store ini.', v_product_id;
        end if;
    end loop;

    -- Hitung harga dari database, BUKAN dari harga browser.
    for v_item in
        select value
        from jsonb_array_elements(p_items)
    loop
        begin
            v_product_id := (v_item ->> 'product_id')::uuid;
        exception
            when invalid_text_representation then
                raise exception 'product_id pada keranjang tidak valid.';
        end;

        v_qty := coalesce(
            nullif(v_item ->> 'qty', '')::numeric,
            0
        );

        if v_qty <= 0 then
            raise exception 'Qty harus lebih besar dari 0.';
        end if;

        select *
          into strict v_product
        from public.products p
        where p.id = v_product_id
          and p.store_id = v_store_id
          and p.active = true
          and p.deleted_at is null;

        if v_product.legacy_stock_snapshot < v_qty then
            raise exception
                'Stok % tidak cukup. Tersedia %, diminta %.',
                v_product.name,
                v_product.legacy_stock_snapshot,
                v_qty;
        end if;

        v_normal_unit := greatest(v_product.sale_price, 0);
        v_unit_price := v_normal_unit;

        if v_product.promo_active = true
           and v_product.promo_price is not null
           and v_product.promo_price >= 0
           and v_qty >= greatest(v_product.promo_min_qty, 1)
           and (
               v_product.promo_start_date is null
               or v_business_date >= v_product.promo_start_date
           )
           and (
               v_product.promo_end_date is null
               or v_business_date <= v_product.promo_end_date
           ) then
            v_unit_price := least(
                v_normal_unit,
                v_product.promo_price
            );
        end if;

        v_line_normal := round(v_normal_unit * v_qty, 2);
        v_line_subtotal := round(v_unit_price * v_qty, 2);
        v_line_discount := greatest(
            v_line_normal - v_line_subtotal,
            0
        );

        v_normal_subtotal := v_normal_subtotal + v_line_normal;
        v_subtotal := v_subtotal + v_line_subtotal;
        v_product_discount := v_product_discount + v_line_discount;

        v_computed_items := v_computed_items || jsonb_build_array(
            jsonb_build_object(
                'product_id', v_product.id,
                'product_name', v_product.name,
                'barcode', v_product.barcode,
                'unit', v_product.unit,
                'qty', v_qty,
                'cost_price', v_product.purchase_price,
                'normal_unit_price', v_normal_unit,
                'unit_price', v_unit_price,
                'line_normal_subtotal', v_line_normal,
                'line_discount', v_line_discount,
                'line_subtotal', v_line_subtotal
            )
        );
    end loop;

    v_manual_discount := greatest(
        coalesce(p_manual_discount, 0),
        0
    );

    if v_manual_discount > v_subtotal then
        raise exception
            'Diskon manual % melebihi subtotal %.',
            v_manual_discount,
            v_subtotal;
    end if;

    v_total_discount := v_product_discount + v_manual_discount;
    v_grand_total := greatest(v_subtotal - v_manual_discount, 0);

    if p_payment_method not in ('Tunai', 'Non Tunai') then
        raise exception 'Metode pembayaran tidak valid.';
    end if;

    if p_payment_method = 'Tunai' then
        v_cash_received := greatest(coalesce(p_cash_received, 0), 0);

        if v_cash_received < v_grand_total then
            raise exception
                'Uang tunai kurang. Total %, diterima %.',
                v_grand_total,
                v_cash_received;
        end if;

        v_cash_amount := v_grand_total;
        v_qris_amount := 0;
        v_change_amount := v_cash_received - v_grand_total;
    else
        v_cash_received := greatest(coalesce(p_cash_received, 0), 0);
        v_cash_amount := greatest(coalesce(p_cash_amount, 0), 0);
        v_qris_amount := greatest(coalesce(p_qris_amount, 0), 0);
        v_change_amount := 0;

        if abs((v_cash_amount + v_qris_amount) - v_grand_total) > 0.01 then
            raise exception
                'Pembayaran Non Tunai harus sama dengan total. Cash %, QRIS %, total %.',
                v_cash_amount,
                v_qris_amount,
                v_grand_total;
        end if;
    end if;

    v_transaction_code :=
        'LDM-'
        || to_char(now() at time zone v_timezone, 'YYMMDD-HH24MISS')
        || '-'
        || upper(
            substr(
                replace(p_client_transaction_id::text, '-', ''),
                1,
                6
            )
        );

    insert into public.transactions (
        store_id,
        client_transaction_id,
        transaction_code,
        cashier_user_id,
        cashier_username,
        shift_label,
        business_date,
        transacted_at,
        payment_method,
        normal_subtotal,
        subtotal,
        product_discount,
        manual_discount,
        total_discount,
        grand_total,
        cash_received,
        cash_amount,
        qris_amount,
        change_amount,
        status
    )
    values (
        v_store_id,
        p_client_transaction_id,
        v_transaction_code,
        auth.uid(),
        v_username,
        nullif(btrim(coalesce(p_shift_label, '')), ''),
        v_business_date,
        now(),
        p_payment_method,
        v_normal_subtotal,
        v_subtotal,
        v_product_discount,
        v_manual_discount,
        v_total_discount,
        v_grand_total,
        v_cash_received,
        v_cash_amount,
        v_qris_amount,
        v_change_amount,
        'completed'
    )
    returning id into v_transaction_id;

    -- Insert item + stock ledger + decrement snapshot.
    for v_item in
        select value
        from jsonb_array_elements(v_computed_items)
    loop
        v_product_id := (v_item ->> 'product_id')::uuid;
        v_qty := (v_item ->> 'qty')::numeric;

        select *
          into strict v_product
        from public.products p
        where p.id = v_product_id
          and p.store_id = v_store_id
        for update;

        v_stock_before := v_product.legacy_stock_snapshot;
        v_stock_after := v_stock_before - v_qty;

        if v_stock_after < 0 then
            raise exception
                'Stok % menjadi negatif. Transaksi dibatalkan.',
                v_product.name;
        end if;

        insert into public.transaction_items (
            store_id,
            transaction_id,
            product_id,
            product_name_snapshot,
            barcode_snapshot,
            unit_snapshot,
            qty,
            cost_price_snapshot,
            normal_unit_price,
            unit_price,
            line_normal_subtotal,
            line_discount,
            line_subtotal
        )
        values (
            v_store_id,
            v_transaction_id,
            v_product_id,
            v_item ->> 'product_name',
            nullif(v_item ->> 'barcode', ''),
            nullif(v_item ->> 'unit', ''),
            v_qty,
            (v_item ->> 'cost_price')::numeric,
            (v_item ->> 'normal_unit_price')::numeric,
            (v_item ->> 'unit_price')::numeric,
            (v_item ->> 'line_normal_subtotal')::numeric,
            (v_item ->> 'line_discount')::numeric,
            (v_item ->> 'line_subtotal')::numeric
        )
        returning id into v_transaction_item_id;

        update public.products
           set legacy_stock_snapshot = v_stock_after
         where id = v_product_id
           and store_id = v_store_id;

        insert into public.stock_movements (
            store_id,
            product_id,
            transaction_id,
            transaction_item_id,
            movement_type,
            quantity_change,
            stock_before,
            stock_after,
            unit_cost_snapshot,
            source_type,
            source_id,
            reference_code,
            note,
            created_by,
            occurred_at
        )
        values (
            v_store_id,
            v_product_id,
            v_transaction_id,
            v_transaction_item_id,
            'sale',
            -v_qty,
            v_stock_before,
            v_stock_after,
            (v_item ->> 'cost_price')::numeric,
            'transaction_item',
            v_transaction_item_id::text,
            v_transaction_code,
            'Penjualan kasir',
            auth.uid(),
            now()
        );

        v_result_items := v_result_items || jsonb_build_array(
            jsonb_build_object(
                'id', v_transaction_item_id,
                'product_id', v_product_id,
                'nama', v_item ->> 'product_name',
                'barcode', v_item ->> 'barcode',
                'satuan', v_item ->> 'unit',
                'qty', v_qty,
                'hargaNormal', (v_item ->> 'normal_unit_price')::numeric,
                'harga', (v_item ->> 'unit_price')::numeric,
                'subtotal', (v_item ->> 'line_subtotal')::numeric,
                'diskon', (v_item ->> 'line_discount')::numeric,
                'hargaBeli', (v_item ->> 'cost_price')::numeric,
                'stock_before', v_stock_before,
                'stock_after', v_stock_after
            )
        );
    end loop;

    return jsonb_build_object(
        'id', v_transaction_id,
        'client_transaction_id', p_client_transaction_id,
        'transaction_code', v_transaction_code,
        'business_date', v_business_date,
        'transacted_at', now(),
        'cashier_username', v_username,
        'shift_label', nullif(btrim(coalesce(p_shift_label, '')), ''),
        'payment_method', p_payment_method,
        'normal_subtotal', v_normal_subtotal,
        'subtotal', v_subtotal,
        'product_discount', v_product_discount,
        'manual_discount', v_manual_discount,
        'total_discount', v_total_discount,
        'grand_total', v_grand_total,
        'cash_received', v_cash_received,
        'cash_amount', v_cash_amount,
        'qris_amount', v_qris_amount,
        'change_amount', v_change_amount,
        'status', 'completed',
        'items', v_result_items,
        'idempotent_replay', false
    );
end;
$$;

revoke all on function public.ldm_complete_sale(
    uuid,
    jsonb,
    numeric,
    text,
    numeric,
    numeric,
    numeric,
    text
) from public, anon;

grant execute on function public.ldm_complete_sale(
    uuid,
    jsonb,
    numeric,
    text,
    numeric,
    numeric,
    numeric,
    text
) to authenticated;

-- ------------------------------------------------
-- Void transaksi cloud.
-- Owner-only. Tidak hard delete.
-- Stok dikembalikan secara atomic dan ledger mendapat sale_void.
-- Belum dihubungkan ke tombol hapus Laporan pada Tahap 8.
-- ------------------------------------------------
create or replace function public.ldm_void_sale(
    p_transaction_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_transaction public.transactions%rowtype;
    v_item public.transaction_items%rowtype;
    v_stock_before numeric(16,3);
    v_stock_after numeric(16,3);
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat void transaksi cloud.';
    end if;

    select *
      into strict v_transaction
    from public.transactions t
    where t.id = p_transaction_id
      and t.store_id = v_store_id
    for update;

    if v_transaction.status = 'voided' then
        return jsonb_build_object(
            'id', v_transaction.id,
            'transaction_code', v_transaction.transaction_code,
            'status', 'voided',
            'already_voided', true
        );
    end if;

    for v_item in
        select ti.*
        from public.transaction_items ti
        where ti.transaction_id = v_transaction.id
        order by ti.product_id, ti.id
    loop
        perform 1
        from public.products p
        where p.id = v_item.product_id
          and p.store_id = v_store_id
        for update;
    end loop;

    for v_item in
        select ti.*
        from public.transaction_items ti
        where ti.transaction_id = v_transaction.id
        order by ti.product_id, ti.id
    loop
        select p.legacy_stock_snapshot
          into strict v_stock_before
        from public.products p
        where p.id = v_item.product_id
          and p.store_id = v_store_id
        for update;

        v_stock_after := v_stock_before + v_item.qty;

        update public.products
           set legacy_stock_snapshot = v_stock_after
         where id = v_item.product_id
           and store_id = v_store_id;

        insert into public.stock_movements (
            store_id,
            product_id,
            transaction_id,
            transaction_item_id,
            movement_type,
            quantity_change,
            stock_before,
            stock_after,
            unit_cost_snapshot,
            source_type,
            source_id,
            reference_code,
            note,
            created_by
        )
        values (
            v_store_id,
            v_item.product_id,
            v_transaction.id,
            v_item.id,
            'sale_void',
            v_item.qty,
            v_stock_before,
            v_stock_after,
            v_item.cost_price_snapshot,
            'transaction_void',
            v_transaction.id::text || ':' || v_item.id::text,
            v_transaction.transaction_code,
            coalesce(nullif(btrim(p_reason), ''), 'Void transaksi penjualan'),
            auth.uid()
        )
        on conflict (
            store_id,
            product_id,
            source_type,
            source_id
        )
        where source_type is not null
          and source_id is not null
        do nothing;
    end loop;

    update public.transactions
       set status = 'voided',
           voided_at = now(),
           voided_by = auth.uid(),
           void_reason = coalesce(
               nullif(btrim(p_reason), ''),
               'Void transaksi penjualan'
           )
     where id = v_transaction.id;

    return jsonb_build_object(
        'id', v_transaction.id,
        'transaction_code', v_transaction.transaction_code,
        'status', 'voided',
        'already_voided', false
    );
end;
$$;

revoke all on function public.ldm_void_sale(uuid, text)
from public, anon;
grant execute on function public.ldm_void_sale(uuid, text)
to authenticated;

-- ------------------------------------------------
-- Realtime publication
-- ------------------------------------------------
do $$
begin
    if exists (
        select 1
        from pg_publication
        where pubname = 'supabase_realtime'
    ) then
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'transactions'
        ) then
            alter publication supabase_realtime
            add table public.transactions;
        end if;

        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'transaction_items'
        ) then
            alter publication supabase_realtime
            add table public.transaction_items;
        end if;

        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'stock_movements'
        ) then
            alter publication supabase_realtime
            add table public.stock_movements;
        end if;
    end if;
end
$$;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta (key, value)
values
    ('live_sync_stage', '8'),
    ('schema_status', 'transactions_atomic_stock_ready'),
    ('schema_version', '8'),
    ('transactions_authority', 'public.transactions'),
    ('transaction_items_authority', 'public.transaction_items'),
    ('sales_stock_authority', 'public.stock_movements'),
    ('checkout_mode', 'atomic_rpc'),
    ('checkout_offline_mode', 'block_write_when_server_unavailable'),
    ('full_inventory_migration', 'in_progress')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'transactions_authority',
    'transaction_items_authority',
    'sales_stock_authority',
    'checkout_mode',
    'checkout_offline_mode',
    'full_inventory_migration'
)
order by key;

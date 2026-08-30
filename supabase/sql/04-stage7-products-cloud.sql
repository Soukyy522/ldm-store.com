-- ================================================================
-- LocDailyMar - Live Sync Tahap 7
-- Cloud Master Barang + Stable UUID + Realtime
--
-- Tahap ini memindahkan MASTER BARANG ke Supabase.
-- Stok masih berupa snapshot transisi.
-- Atomic stock movement dibuat pada tahap berikutnya.
-- ================================================================

begin;

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null
        references public.stores(id)
        on delete restrict,

    barcode text,
    name text not null,
    category text,
    unit text,

    purchase_price numeric(16,2) not null default 0,
    sale_price numeric(16,2) not null default 0,

    -- Snapshot kompatibilitas untuk aplikasi lama.
    -- Belum menjadi ledger stok final.
    legacy_stock_snapshot numeric(16,3) not null default 0,

    promo_active boolean not null default false,
    promo_price numeric(16,2),
    promo_min_qty numeric(16,3) not null default 1,
    promo_start_date date,
    promo_end_date date,

    active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

-- Unique barcode per store for active/non-deleted rows.
create unique index if not exists products_store_barcode_unique
on public.products (
    store_id,
    barcode
)
where barcode is not null
  and btrim(barcode) <> ''
  and deleted_at is null;

create index if not exists products_store_name_idx
on public.products (
    store_id,
    lower(name)
)
where deleted_at is null;

create index if not exists products_store_active_idx
on public.products (
    store_id,
    active
)
where deleted_at is null;

drop trigger if exists trg_products_touch_row
on public.products;

create trigger trg_products_touch_row
before update on public.products
for each row
execute function public.ldm_touch_row();

-- ------------------------------------------------
-- RLS
-- ------------------------------------------------
alter table public.products
enable row level security;

revoke all on public.products from anon;
grant select, insert, update on public.products to authenticated;

drop policy if exists products_select_same_store
on public.products;

create policy products_select_same_store
on public.products
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
);

drop policy if exists products_insert_owner
on public.products;

create policy products_insert_owner
on public.products
for insert
to authenticated
with check (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
    and deleted_at is null
);

drop policy if exists products_update_owner
on public.products;

create policy products_update_owner
on public.products
for update
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
)
with check (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
);

-- Hard delete tidak diberikan ke browser.
revoke delete on public.products from authenticated;

-- ------------------------------------------------
-- Import/upsert legacy dataBarang.
--
-- Hanya Owner.
-- Tidak melakukan hard delete.
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
    v_barcode text;
    v_name text;
    v_category text;
    v_unit text;

    v_purchase_price numeric(16,2);
    v_sale_price numeric(16,2);
    v_stock numeric(16,3);

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
        raise exception 'Hanya Owner yang dapat migrasi/sinkron Master Barang.';
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

        begin
            if nullif(
                btrim(
                    coalesce(
                        v_item ->> 'id',
                        ''
                    )
                ),
                ''
            ) is not null then
                v_id :=
                    (
                        v_item ->> 'id'
                    )::uuid;
            end if;
        exception
            when invalid_text_representation then
                v_id := null;
        end;

        v_barcode :=
            nullif(
                btrim(
                    coalesce(
                        v_item ->> 'barcode',
                        ''
                    )
                ),
                ''
            );

        v_name :=
            btrim(
                coalesce(
                    v_item ->> 'nama',
                    v_item ->> 'name',
                    ''
                )
            );

        if v_name = '' then
            raise exception
                'Nama barang tidak boleh kosong.';
        end if;

        v_category :=
            nullif(
                btrim(
                    coalesce(
                        v_item ->> 'kategori',
                        v_item ->> 'category',
                        ''
                    )
                ),
                ''
            );

        v_unit :=
            nullif(
                btrim(
                    coalesce(
                        v_item ->> 'satuan',
                        v_item ->> 'unit',
                        ''
                    )
                ),
                ''
            );

        v_purchase_price :=
            greatest(
                coalesce(
                    nullif(
                        v_item ->> 'hargaBeli',
                        ''
                    )::numeric,
                    0
                ),
                0
            );

        v_sale_price :=
            greatest(
                coalesce(
                    nullif(
                        v_item ->> 'harga',
                        ''
                    )::numeric,
                    0
                ),
                0
            );

        v_stock :=
            coalesce(
                nullif(
                    v_item ->> 'stok',
                    ''
                )::numeric,
                0
            );

        v_promo :=
            coalesce(
                v_item -> 'promo',
                '{}'::jsonb
            );

        v_promo_active :=
            coalesce(
                (
                    v_promo ->> 'aktif'
                )::boolean,
                false
            );

        v_promo_price :=
            nullif(
                v_promo ->> 'hargaPromo',
                ''
            )::numeric;

        v_promo_min_qty :=
            greatest(
                coalesce(
                    nullif(
                        v_promo ->> 'minQty',
                        ''
                    )::numeric,
                    1
                ),
                1
            );

        v_promo_start :=
            nullif(
                v_promo ->> 'tglMulai',
                ''
            )::date;

        v_promo_end :=
            nullif(
                v_promo ->> 'tglSelesai',
                ''
            )::date;

        -- 1. UUID yang sudah dikenal.
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
                   legacy_stock_snapshot = v_stock,
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

        -- 2. Cocokkan barcode jika belum punya UUID.
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
                   legacy_stock_snapshot = v_stock,
                   promo_active = v_promo_active,
                   promo_price = v_promo_price,
                   promo_min_qty = v_promo_min_qty,
                   promo_start_date = v_promo_start,
                   promo_end_date = v_promo_end,
                   active = true
             where store_id = v_store_id
               and barcode = v_barcode
               and deleted_at is null;

        -- 3. Insert baru.
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
                v_stock,
                v_promo_active,
                v_promo_price,
                v_promo_min_qty,
                v_promo_start,
                v_promo_end,
                true
            );

        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_import_legacy_products(jsonb)
from public, anon;

grant execute
on function public.ldm_import_legacy_products(jsonb)
to authenticated;

-- ------------------------------------------------
-- Soft delete produk.
-- ------------------------------------------------
create or replace function public.ldm_soft_delete_product(
    p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_updated integer;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null then
        raise exception 'Store profile tidak ditemukan.';
    end if;

    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus Master Barang.';
    end if;

    update public.products
       set active = false,
           deleted_at = now(),
           deleted_by = auth.uid()
     where id = p_product_id
       and store_id = v_store_id
       and deleted_at is null;

    get diagnostics
        v_updated = row_count;

    return v_updated > 0;
end;
$$;

revoke all on function public.ldm_soft_delete_product(uuid)
from public, anon;

grant execute
on function public.ldm_soft_delete_product(uuid)
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
    ) and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'products'
    ) then
        alter publication supabase_realtime
        add table public.products;
    end if;
end
$$;

-- Metadata
insert into public.ldm_system_meta (key, value)
values
    ('live_sync_stage', '7'),
    ('schema_status', 'products_cloud_ready'),
    ('schema_version', '7'),
    ('products_authority', 'public.products'),
    ('products_cache', 'localStorage.dataBarang'),
    ('products_realtime', 'enabled'),
    ('stock_authority', 'legacy_snapshot_transition')
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
    'products_authority',
    'products_cache',
    'products_realtime',
    'stock_authority'
)
order by key;

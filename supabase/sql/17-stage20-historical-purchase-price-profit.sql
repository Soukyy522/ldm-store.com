-- ================================================================
-- LocDailyMar - Histori Harga Beli + Snapshot HPP Berdasarkan Waktu
-- Jalankan setelah 16-stage17-sync-conflict-recovery.sql
--
-- Tujuan:
-- 1. Setiap perubahan products.purchase_price disimpan sebagai histori.
-- 2. transaction_items.cost_price_snapshot selalu memakai harga beli yang
--    berlaku pada waktu transaksi, bukan harga terbaru saat laporan dibuka.
-- 3. Transaksi offline memakai transactions.transacted_at (queued_at) sehingga
--    perubahan harga setelah transaksi dibuat tidak mengubah HPP transaksi.
-- ================================================================

begin;

create table if not exists public.product_purchase_price_history (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null
        references public.stores(id)
        on delete restrict,
    product_id uuid not null
        references public.products(id)
        on delete restrict,
    purchase_price numeric(16,2) not null
        check (purchase_price >= 0),
    effective_at timestamptz not null default now(),
    source_type text not null default 'product_update',
    source_id text,
    changed_by uuid references auth.users(id),
    created_at timestamptz not null default now()
);

create index if not exists idx_product_purchase_price_history_lookup
on public.product_purchase_price_history(
    store_id,
    product_id,
    effective_at desc,
    created_at desc
);

-- Satu nilai awal untuk produk yang sudah ada. Snapshot transaksi lama tidak
-- diubah; data ini menjadi titik awal bagi transaksi baru setelah migrasi.
insert into public.product_purchase_price_history(
    store_id,
    product_id,
    purchase_price,
    effective_at,
    source_type,
    source_id,
    changed_by
)
select
    p.store_id,
    p.id,
    greatest(coalesce(p.purchase_price,0),0),
    coalesce(p.created_at,now()),
    'migration_seed',
    p.id::text,
    null
from public.products p
where p.deleted_at is null
  and not exists (
      select 1
      from public.product_purchase_price_history h
      where h.store_id=p.store_id
        and h.product_id=p.id
  );

alter table public.product_purchase_price_history enable row level security;

revoke all on public.product_purchase_price_history from anon;
revoke insert, update, delete on public.product_purchase_price_history from authenticated;
grant select on public.product_purchase_price_history to authenticated;

drop policy if exists product_purchase_price_history_owner_select
on public.product_purchase_price_history;

create policy product_purchase_price_history_owner_select
on public.product_purchase_price_history
for select
to authenticated
using (
    store_id=public.ldm_current_store_id()
    and public.ldm_current_role()='owner'
);

-- Catat otomatis ketika produk baru dibuat atau harga beli benar-benar berubah.
create or replace function public.ldm_record_purchase_price_history()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
    if tg_op='INSERT'
       or new.purchase_price is distinct from old.purchase_price then
        insert into public.product_purchase_price_history(
            store_id,
            product_id,
            purchase_price,
            effective_at,
            source_type,
            source_id,
            changed_by
        ) values (
            new.store_id,
            new.id,
            greatest(coalesce(new.purchase_price,0),0),
            now(),
            case when tg_op='INSERT' then 'product_created' else 'product_update' end,
            new.id::text,
            auth.uid()
        );
    end if;

    return new;
end;
$$;

revoke all on function public.ldm_record_purchase_price_history()
from public,anon,authenticated;

drop trigger if exists trg_products_purchase_price_history
on public.products;

create trigger trg_products_purchase_price_history
after insert or update of purchase_price
on public.products
for each row
execute function public.ldm_record_purchase_price_history();

-- Helper internal untuk mengambil harga yang berlaku tepat pada waktu transaksi.
create or replace function public.ldm_purchase_price_at(
    p_store_id uuid,
    p_product_id uuid,
    p_effective_at timestamptz
)
returns numeric
language sql
stable
security definer
set search_path=public,pg_temp
as $$
    select coalesce(
        (
            select h.purchase_price
            from public.product_purchase_price_history h
            where h.store_id=p_store_id
              and h.product_id=p_product_id
              and h.effective_at<=coalesce(p_effective_at,now())
            order by h.effective_at desc,h.created_at desc,h.id desc
            limit 1
        ),
        (
            select greatest(coalesce(p.purchase_price,0),0)
            from public.products p
            where p.store_id=p_store_id
              and p.id=p_product_id
            limit 1
        ),
        0
    );
$$;

revoke all on function public.ldm_purchase_price_at(uuid,uuid,timestamptz)
from public,anon,authenticated;

-- Paksa snapshot HPP dari histori server. Browser tidak dapat menyisipkan harga
-- beli palsu, dan reconnect mengambil waktu transaksi asli dari Tahap 16.
create or replace function public.ldm_set_transaction_item_historical_cost()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
    v_effective_at timestamptz;
begin
    select t.transacted_at
      into v_effective_at
    from public.transactions t
    where t.id=new.transaction_id
      and t.store_id=new.store_id
    limit 1;

    if v_effective_at is null then
        raise exception 'Waktu transaksi untuk snapshot harga beli tidak ditemukan.';
    end if;

    new.cost_price_snapshot := public.ldm_purchase_price_at(
        new.store_id,
        new.product_id,
        v_effective_at
    );

    return new;
end;
$$;

revoke all on function public.ldm_set_transaction_item_historical_cost()
from public,anon,authenticated;

drop trigger if exists trg_transaction_items_historical_cost
on public.transaction_items;

create trigger trg_transaction_items_historical_cost
before insert on public.transaction_items
for each row
execute function public.ldm_set_transaction_item_historical_cost();

-- Samakan unit_cost_snapshot ledger stok dengan snapshot pada item transaksi.
create or replace function public.ldm_set_sale_movement_historical_cost()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
    if new.movement_type='sale'
       and new.transaction_item_id is not null then
        select ti.cost_price_snapshot
          into new.unit_cost_snapshot
        from public.transaction_items ti
        where ti.id=new.transaction_item_id
          and ti.store_id=new.store_id
        limit 1;
    end if;

    return new;
end;
$$;

revoke all on function public.ldm_set_sale_movement_historical_cost()
from public,anon,authenticated;

drop trigger if exists trg_stock_movements_historical_sale_cost
on public.stock_movements;

create trigger trg_stock_movements_historical_sale_cost
before insert on public.stock_movements
for each row
execute function public.ldm_set_sale_movement_historical_cost();

commit;

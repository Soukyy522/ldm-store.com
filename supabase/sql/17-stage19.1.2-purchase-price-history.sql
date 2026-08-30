-- ================================================================
-- LocDailyMar 19.1.2
-- Purchase Price History + Historical HPP / Profit Foundation
--
-- Tujuan:
-- - setiap perubahan products.purchase_price disimpan sebagai histori;
-- - transaksi cloud tetap memakai transaction_items.cost_price_snapshot
--   sebagai HPP paling otoritatif;
-- - histori menjadi fallback untuk transaksi legacy yang tidak mempunyai
--   snapshot HPP lengkap;
-- - perubahan harga hari ini tidak menimpa HPP transaksi hari sebelumnya.
-- ================================================================

begin;

create table if not exists public.purchase_price_history (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    product_id uuid not null references public.products(id) on delete restrict,
    purchase_price numeric(16,2) not null check (purchase_price >= 0),
    effective_at timestamptz not null default now(),
    business_date date not null,
    source text not null default 'purchase_price_change',
    changed_by uuid references auth.users(id),
    created_at timestamptz not null default now()
);

create index if not exists purchase_price_history_product_time_idx
on public.purchase_price_history(store_id, product_id, effective_at desc);

create index if not exists purchase_price_history_store_date_idx
on public.purchase_price_history(store_id, business_date desc, product_id);

alter table public.purchase_price_history enable row level security;

revoke all on public.purchase_price_history from anon;
revoke insert, update, delete on public.purchase_price_history from authenticated;
grant select on public.purchase_price_history to authenticated;

drop policy if exists purchase_price_history_owner_select
on public.purchase_price_history;

create policy purchase_price_history_owner_select
on public.purchase_price_history
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
);

create or replace function public.ldm_capture_purchase_price_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_timezone text;
    v_date date;
    v_source text;
begin
    if tg_op = 'UPDATE'
       and new.purchase_price is not distinct from old.purchase_price then
        return new;
    end if;

    select coalesce(nullif(s.timezone,''),'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = new.store_id
      and s.deleted_at is null
    limit 1;

    v_timezone := coalesce(v_timezone,'Asia/Makassar');
    v_date := (now() at time zone v_timezone)::date;
    v_source := case
        when tg_op = 'INSERT' then 'product_create'
        else 'purchase_price_change'
    end;

    insert into public.purchase_price_history(
        store_id,
        product_id,
        purchase_price,
        effective_at,
        business_date,
        source,
        changed_by
    ) values (
        new.store_id,
        new.id,
        greatest(coalesce(new.purchase_price,0),0),
        now(),
        v_date,
        v_source,
        auth.uid()
    );

    return new;
end;
$$;

drop trigger if exists trg_products_purchase_price_history
on public.products;

create trigger trg_products_purchase_price_history
after insert or update of purchase_price
on public.products
for each row
execute function public.ldm_capture_purchase_price_history();

-- Seed nilai HPP saat fitur 19.1.2 mulai dipasang.
-- Sengaja memakai NOW(), bukan created_at produk. Kita tidak mengarang
-- harga historis sebelum fitur ini tersedia.
insert into public.purchase_price_history(
    store_id,
    product_id,
    purchase_price,
    effective_at,
    business_date,
    source,
    changed_by
)
select
    p.store_id,
    p.id,
    greatest(coalesce(p.purchase_price,0),0),
    now(),
    (now() at time zone coalesce(nullif(s.timezone,''),'Asia/Makassar'))::date,
    'stage19_1_2_baseline',
    auth.uid()
from public.products p
join public.stores s on s.id = p.store_id
where p.deleted_at is null
  and not exists (
      select 1
      from public.purchase_price_history h
      where h.store_id = p.store_id
        and h.product_id = p.id
  );

-- RPC owner-only untuk diagnosis harga efektif pada suatu waktu.
create or replace function public.ldm_purchase_price_at(
    p_product_id uuid,
    p_at timestamptz
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_price numeric;
begin
    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat membaca histori Harga Beli.';
    end if;

    select h.purchase_price
      into v_price
    from public.purchase_price_history h
    where h.store_id = v_store_id
      and h.product_id = p_product_id
      and h.effective_at <= coalesce(p_at,now())
    order by h.effective_at desc, h.created_at desc
    limit 1;

    return v_price;
end;
$$;

revoke all on function public.ldm_purchase_price_at(uuid,timestamptz)
from public, anon;
grant execute on function public.ldm_purchase_price_at(uuid,timestamptz)
to authenticated;

-- Realtime supaya Dashboard Owner pada device lain ikut menerima histori baru.
do $$
begin
    if exists (
        select 1 from pg_publication where pubname='supabase_realtime'
    ) and not exists (
        select 1
        from pg_publication_tables
        where pubname='supabase_realtime'
          and schemaname='public'
          and tablename='purchase_price_history'
    ) then
        alter publication supabase_realtime
        add table public.purchase_price_history;
    end if;
end
$$;

insert into public.ldm_system_meta(key,value)
values
    ('purchase_price_history','enabled'),
    ('profit_hpp_authority','transaction_item_snapshot_then_price_history'),
    ('frontend_patch','19.1.2')
on conflict (key)
do update set value=excluded.value, updated_at=now();

commit;

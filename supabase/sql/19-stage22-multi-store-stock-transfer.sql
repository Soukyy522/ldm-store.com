-- ================================================================
-- LocDailyMar - TAHAP 22
-- Multi-Toko + Transfer Stok Atomik
-- Baseline: Tahap 21 Promo & Harga Lanjutan
-- Jalankan di Supabase Dashboard > SQL Editor.
-- ================================================================

begin;

-- ------------------------------------------------
-- Jaringan toko dan membership akun
-- ------------------------------------------------
create table if not exists public.store_networks (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id) on delete set null,
    constraint store_networks_code_not_blank check (btrim(code) <> ''),
    constraint store_networks_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.store_network_stores (
    network_id uuid not null references public.store_networks(id) on delete cascade,
    store_id uuid not null references public.stores(id) on delete restrict,
    is_primary boolean not null default false,
    active boolean not null default true,
    joined_at timestamptz not null default now(),
    primary key (network_id,store_id),
    unique (store_id)
);

create table if not exists public.store_memberships (
    user_id uuid not null references auth.users(id) on delete cascade,
    store_id uuid not null references public.stores(id) on delete restrict,
    role text not null check (role in ('owner','admin','kasir')),
    active boolean not null default true,
    is_default boolean not null default false,
    invited_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id,store_id)
);

create index if not exists store_memberships_store_idx
on public.store_memberships(store_id,active,role);

create table if not exists public.active_store_sessions (
    user_id uuid not null references auth.users(id) on delete cascade,
    client_device_id text not null,
    store_id uuid not null references public.stores(id) on delete cascade,
    switched_at timestamptz not null default now(),
    primary key (user_id,client_device_id),
    constraint active_store_sessions_device_not_blank check (btrim(client_device_id) <> '')
);

drop trigger if exists trg_store_networks_touch on public.store_networks;
create trigger trg_store_networks_touch
before update on public.store_networks
for each row execute function public.ldm_touch_row();

-- Satu jaringan awal untuk setiap toko lama yang belum terhubung.
insert into public.store_networks(code,name,created_by)
select
    'NET-' || upper(substr(replace(s.id::text,'-',''),1,12)),
    s.name || ' Network',
    (
        select p.id from public.profiles p
        where p.store_id=s.id and p.active=true and p.deleted_at is null
        order by case p.role when 'owner' then 1 when 'admin' then 2 else 3 end,p.created_at
        limit 1
    )
from public.stores s
where s.deleted_at is null
  and not exists (
      select 1 from public.store_network_stores sns where sns.store_id=s.id
  )
on conflict (code) do nothing;

insert into public.store_network_stores(network_id,store_id,is_primary,active)
select n.id,s.id,true,true
from public.stores s
join public.store_networks n
  on n.code='NET-' || upper(substr(replace(s.id::text,'-',''),1,12))
where s.deleted_at is null
on conflict (store_id) do nothing;

insert into public.store_memberships(user_id,store_id,role,active,is_default,invited_by)
select p.id,p.store_id,p.role,p.active,true,p.id
from public.profiles p
where p.deleted_at is null
on conflict (user_id,store_id) do update
set role=excluded.role,active=excluded.active,is_default=true,updated_at=now();

-- Akun baru otomatis memperoleh membership pada home store-nya.
create or replace function public.ldm_sync_profile_store_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.store_memberships(
        user_id,store_id,role,active,is_default,invited_by,updated_at
    ) values (
        new.id,new.store_id,new.role,
        new.active and new.deleted_at is null,
        true,auth.uid(),now()
    )
    on conflict (user_id,store_id) do update
    set role=excluded.role,
        active=excluded.active,
        is_default=true,
        updated_at=now();
    return new;
end;
$$;

drop trigger if exists trg_stage22_profile_membership on public.profiles;
create trigger trg_stage22_profile_membership
after insert or update of store_id,role,active,deleted_at
on public.profiles
for each row execute function public.ldm_sync_profile_store_membership();

-- ------------------------------------------------
-- Device ID dari header PostgREST
-- ------------------------------------------------
create or replace function public.ldm_request_device_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    v_headers text;
    v_result text;
begin
    v_headers := current_setting('request.headers',true);
    if v_headers is null or btrim(v_headers)='' then return null; end if;
    begin
        v_result := nullif(btrim((v_headers::jsonb ->> 'x-ldm-device-id')),'');
    exception when others then
        v_result := null;
    end;
    return v_result;
end;
$$;

-- Store dan role sekarang mengikuti toko aktif PER PERANGKAT.
create or replace function public.ldm_current_store_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_device text;
    v_store uuid;
begin
    v_device := public.ldm_request_device_id();

    if v_device is not null then
        select sess.store_id into v_store
        from public.active_store_sessions sess
        join public.store_memberships sm
          on sm.user_id=sess.user_id and sm.store_id=sess.store_id and sm.active=true
        join public.devices d
          on d.user_id=sess.user_id and d.store_id=sess.store_id
         and d.client_device_id=sess.client_device_id
         and d.status='active' and d.deleted_at is null
        join public.stores s
          on s.id=sess.store_id and s.status='active' and s.deleted_at is null
        where sess.user_id=auth.uid()
          and sess.client_device_id=v_device
        limit 1;
    end if;

    if v_store is null then
        select p.store_id into v_store
        from public.profiles p
        join public.stores s on s.id=p.store_id
        where p.id=auth.uid() and p.active=true and p.deleted_at is null
          and s.status='active' and s.deleted_at is null
        limit 1;
    end if;
    return v_store;
end;
$$;

create or replace function public.ldm_current_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_store uuid;
    v_role text;
begin
    v_store := public.ldm_current_store_id();
    select sm.role into v_role
    from public.store_memberships sm
    where sm.user_id=auth.uid() and sm.store_id=v_store and sm.active=true
    limit 1;

    if v_role is null then
        select p.role into v_role from public.profiles p
        where p.id=auth.uid() and p.store_id=v_store
          and p.active=true and p.deleted_at is null limit 1;
    end if;
    return v_role;
end;
$$;

revoke all on function public.ldm_request_device_id() from public,anon;
revoke all on function public.ldm_current_store_id() from public,anon;
revoke all on function public.ldm_current_role() from public,anon;
grant execute on function public.ldm_request_device_id() to authenticated;
grant execute on function public.ldm_current_store_id() to authenticated;
grant execute on function public.ldm_current_role() to authenticated;

create or replace function public.ldm_my_context()
returns table (
    user_id uuid,username text,display_name text,role text,
    store_id uuid,store_code text,store_name text,profile_version bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id,p.username,p.display_name,public.ldm_current_role(),
           s.id,s.code,s.name,p.version
    from public.profiles p
    join public.stores s on s.id=public.ldm_current_store_id()
    where p.id=auth.uid() and p.active=true and p.deleted_at is null
      and s.status='active' and s.deleted_at is null
    limit 1;
$$;

revoke all on function public.ldm_my_context() from public,anon;
grant execute on function public.ldm_my_context() to authenticated;

-- Registrasi perangkat mengikuti toko aktif, bukan selalu home store profile.
create or replace function public.ldm_register_device(
    p_client_device_id text,p_device_name text default null,p_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store uuid;
    v_device_id uuid;
    v_client text;
begin
    v_client := btrim(coalesce(p_client_device_id,''));
    if v_client='' or length(v_client)>200 then raise exception 'client_device_id tidak valid'; end if;
    v_store := public.ldm_current_store_id();
    if v_store is null then raise exception 'Toko aktif tidak ditemukan.'; end if;
    if not exists(select 1 from public.store_memberships sm where sm.user_id=auth.uid() and sm.store_id=v_store and sm.active=true) then
        raise exception 'Akun tidak memiliki akses ke toko aktif.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_store::text||':'||v_client,0));
    update public.devices
    set user_id=auth.uid(),device_name=nullif(btrim(coalesce(p_device_name,'')),''),
        platform=nullif(btrim(coalesce(p_platform,'')),''),last_seen_at=now()
    where store_id=v_store and client_device_id=v_client and deleted_at is null
    returning id into v_device_id;

    if v_device_id is null then
        insert into public.devices(store_id,user_id,client_device_id,device_name,platform,status,last_seen_at)
        values(v_store,auth.uid(),v_client,nullif(btrim(coalesce(p_device_name,'')),''),
               nullif(btrim(coalesce(p_platform,'')),''),'pending',now())
        returning id into v_device_id;
    end if;
    return v_device_id;
end;
$$;

revoke all on function public.ldm_register_device(text,text,text) from public,anon;
grant execute on function public.ldm_register_device(text,text,text) to authenticated;

-- ------------------------------------------------
-- RLS multi-store
-- ------------------------------------------------
alter table public.store_networks enable row level security;
alter table public.store_network_stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.active_store_sessions enable row level security;

revoke all on public.store_networks,public.store_network_stores,public.store_memberships,public.active_store_sessions from anon;
revoke insert,update,delete on public.store_networks,public.store_network_stores,public.store_memberships,public.active_store_sessions from authenticated;
grant select on public.store_networks,public.store_network_stores,public.store_memberships,public.active_store_sessions to authenticated;

drop policy if exists store_networks_member_select on public.store_networks;
create or replace function public.ldm_has_network_access(p_network_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists(
        select 1 from public.store_network_stores sns
        join public.store_memberships sm on sm.store_id=sns.store_id
        where sns.network_id=p_network_id and sns.active=true
          and sm.user_id=auth.uid() and sm.active=true
    );
$$;

create policy store_networks_member_select on public.store_networks
for select to authenticated using (
    deleted_at is null and public.ldm_has_network_access(id)
);

drop policy if exists store_network_stores_member_select on public.store_network_stores;
create policy store_network_stores_member_select on public.store_network_stores
for select to authenticated using (
    public.ldm_has_network_access(network_id)
);

drop policy if exists store_memberships_self_or_management on public.store_memberships;
create policy store_memberships_self_or_management on public.store_memberships
for select to authenticated using (
    user_id=auth.uid()
    or (
        store_id=public.ldm_current_store_id()
        and public.ldm_current_role() in ('owner','admin')
    )
);

drop policy if exists active_store_sessions_self on public.active_store_sessions;
create policy active_store_sessions_self on public.active_store_sessions
for select to authenticated using (user_id=auth.uid());

-- ------------------------------------------------
-- Helper jaringan, cabang, dan perpindahan toko aktif
-- ------------------------------------------------
create or replace function public.ldm_same_network(p_store_a uuid,p_store_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists(
        select 1
        from public.store_network_stores a
        join public.store_network_stores b on b.network_id=a.network_id
        join public.store_networks n on n.id=a.network_id
        where a.store_id=p_store_a and b.store_id=p_store_b
          and a.active=true and b.active=true and n.active=true and n.deleted_at is null
    );
$$;

create or replace function public.ldm_my_network_stores()
returns table(
    store_id uuid,store_code text,store_name text,member_role text,
    is_current boolean,is_primary boolean,product_count bigint,total_stock numeric
)
language sql
stable
security definer
set search_path = ''
as $$
    select s.id,s.code,s.name,sm.role,
           s.id=public.ldm_current_store_id(),sns.is_primary,
           (select count(*) from public.products p where p.store_id=s.id and p.active=true and p.deleted_at is null),
           (select coalesce(sum(p.legacy_stock_snapshot),0) from public.products p where p.store_id=s.id and p.active=true and p.deleted_at is null)
    from public.store_memberships sm
    join public.stores s on s.id=sm.store_id
    join public.store_network_stores sns on sns.store_id=s.id and sns.active=true
    where sm.user_id=auth.uid() and sm.active=true
      and s.status='active' and s.deleted_at is null
    order by sns.is_primary desc,lower(s.name);
$$;

create or replace function public.ldm_create_branch_store(
    p_code text,p_name text,p_copy_products boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_current uuid;
    v_network uuid;
    v_store public.stores%rowtype;
    v_code text;
    v_name text;
    v_device text;
    v_source_device public.devices%rowtype;
begin
    v_current:=public.ldm_current_store_id();
    if public.ldm_current_role()<>'owner' then raise exception 'Hanya Owner yang dapat membuat cabang.'; end if;
    select sns.network_id into v_network from public.store_network_stores sns
    where sns.store_id=v_current and sns.active=true limit 1;
    if v_network is null then raise exception 'Jaringan toko belum tersedia.'; end if;

    v_code:=regexp_replace(upper(btrim(coalesce(p_code,''))),'[^A-Z0-9_-]','','g');
    v_name:=btrim(coalesce(p_name,''));
    if length(v_code)<3 or length(v_code)>30 then raise exception 'Kode toko harus 3-30 karakter.'; end if;
    if length(v_name)<3 or length(v_name)>120 then raise exception 'Nama toko harus 3-120 karakter.'; end if;

    insert into public.stores(code,name,timezone,currency,status)
    select v_code,v_name,s.timezone,s.currency,'active' from public.stores s where s.id=v_current
    returning * into v_store;

    insert into public.store_network_stores(network_id,store_id,is_primary,active)
    values(v_network,v_store.id,false,true);
    insert into public.store_memberships(user_id,store_id,role,active,is_default,invited_by)
    values(auth.uid(),v_store.id,'owner',true,false,auth.uid());

    if p_copy_products then
        insert into public.products(
            store_id,barcode,name,category,unit,purchase_unit,purchase_unit_factor,
            purchase_price,sale_price,legacy_stock_snapshot,last_expiry_date,
            promo_active,promo_name,promo_type,promo_value,promo_price,promo_min_qty,
            promo_start_date,promo_end_date,active
        )
        select v_store.id,p.barcode,p.name,p.category,p.unit,p.purchase_unit,p.purchase_unit_factor,
               p.purchase_price,p.sale_price,0,null,
               p.promo_active,p.promo_name,p.promo_type,p.promo_value,p.promo_price,p.promo_min_qty,
               p.promo_start_date,p.promo_end_date,p.active
        from public.products p
        where p.store_id=v_current and p.active=true and p.deleted_at is null;
    end if;

    -- Perangkat Owner yang sedang aktif diwariskan ke cabang baru agar tidak lockout.
    v_device:=public.ldm_request_device_id();
    if v_device is not null then
        select * into v_source_device from public.devices d
        where d.store_id=v_current and d.user_id=auth.uid()
          and d.client_device_id=v_device and d.status='active' and d.deleted_at is null limit 1;
        if v_source_device.id is not null then
            insert into public.devices(store_id,user_id,client_device_id,device_name,platform,status,last_seen_at)
            values(v_store.id,auth.uid(),v_device,v_source_device.device_name,v_source_device.platform,'active',now());
        end if;
    end if;

    return jsonb_build_object('id',v_store.id,'code',v_store.code,'name',v_store.name,'products_copied',p_copy_products);
end;
$$;

create or replace function public.ldm_prepare_store_device(
    p_store_id uuid,p_client_device_id text,p_device_name text default null,p_platform text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_client text;
    v_status text:='pending';
    v_current uuid;
begin
    v_client:=btrim(coalesce(p_client_device_id,''));
    if v_client='' or v_client is distinct from public.ldm_request_device_id() then
        raise exception 'Identitas perangkat tidak valid.';
    end if;
    if not exists(select 1 from public.store_memberships sm where sm.user_id=auth.uid() and sm.store_id=p_store_id and sm.active=true) then
        raise exception 'Akun tidak memiliki akses ke toko tujuan.';
    end if;

    v_current:=public.ldm_current_store_id();
    if public.ldm_current_role()='owner'
       and public.ldm_same_network(v_current,p_store_id)
       and exists(select 1 from public.devices d where d.store_id=v_current and d.user_id=auth.uid() and d.client_device_id=v_client and d.status='active' and d.deleted_at is null) then
        v_status:='active';
    end if;

    update public.devices set user_id=auth.uid(),device_name=nullif(btrim(coalesce(p_device_name,'')),''),
        platform=nullif(btrim(coalesce(p_platform,'')),''),last_seen_at=now()
    where store_id=p_store_id and client_device_id=v_client and deleted_at is null
    returning status into v_status;

    if not found then
        insert into public.devices(store_id,user_id,client_device_id,device_name,platform,status,last_seen_at)
        values(p_store_id,auth.uid(),v_client,nullif(btrim(coalesce(p_device_name,'')),''),
               nullif(btrim(coalesce(p_platform,'')),''),v_status,now());
    end if;
    return v_status;
end;
$$;

create or replace function public.ldm_switch_store(p_store_id uuid,p_client_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_client text;
    v_store public.stores%rowtype;
    v_role text;
begin
    v_client:=btrim(coalesce(p_client_device_id,''));
    if v_client='' or v_client is distinct from public.ldm_request_device_id() then
        raise exception 'Identitas perangkat tidak valid.';
    end if;
    select s.* into v_store
    from public.stores s
    join public.store_memberships sm on sm.store_id=s.id
    where s.id=p_store_id and sm.user_id=auth.uid() and sm.active=true
      and s.status='active' and s.deleted_at is null limit 1;
    if v_store.id is null then raise exception 'Akses toko tidak ditemukan.'; end if;
    select sm.role into v_role
    from public.store_memberships sm
    where sm.store_id=p_store_id and sm.user_id=auth.uid() and sm.active=true
    limit 1;
    if not exists(select 1 from public.devices d where d.store_id=p_store_id and d.user_id=auth.uid()
                  and d.client_device_id=v_client and d.status='active' and d.deleted_at is null) then
        raise exception 'Perangkat belum disetujui untuk toko tujuan.';
    end if;

    insert into public.active_store_sessions(user_id,client_device_id,store_id,switched_at)
    values(auth.uid(),v_client,p_store_id,now())
    on conflict(user_id,client_device_id) do update set store_id=excluded.store_id,switched_at=now();

    return jsonb_build_object('store_id',v_store.id,'store_code',v_store.code,'store_name',v_store.name,'role',v_role);
end;
$$;

-- ------------------------------------------------
-- Transfer stok
-- ------------------------------------------------
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
check (movement_type in (
    'opening_balance','sale','sale_void','goods_receipt','goods_receipt_cancel',
    'stock_opname','return','return_cancel','adjustment','transfer_out','transfer_in'
));

create table if not exists public.stock_transfers (
    id uuid primary key default gen_random_uuid(),
    transfer_code text not null unique,
    source_store_id uuid not null references public.stores(id) on delete restrict,
    destination_store_id uuid not null references public.stores(id) on delete restrict,
    status text not null default 'DRAFT' check(status in ('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
    note text,
    cancel_reason text,
    created_by uuid not null references auth.users(id) on delete restrict,
    sent_by uuid references auth.users(id) on delete restrict,
    received_by uuid references auth.users(id) on delete restrict,
    cancelled_by uuid references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    received_at timestamptz,
    cancelled_at timestamptz,
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    constraint stock_transfer_different_store check(source_store_id<>destination_store_id)
);

create table if not exists public.stock_transfer_items (
    id uuid primary key default gen_random_uuid(),
    transfer_id uuid not null references public.stock_transfers(id) on delete restrict,
    source_product_id uuid not null references public.products(id) on delete restrict,
    destination_product_id uuid not null references public.products(id) on delete restrict,
    barcode_snapshot text not null,
    product_name_snapshot text not null,
    unit_snapshot text not null,
    qty_requested numeric(16,3) not null check(qty_requested>0),
    qty_sent numeric(16,3) not null default 0 check(qty_sent>=0),
    qty_received numeric(16,3) not null default 0 check(qty_received>=0),
    unit_cost_snapshot numeric(16,2) not null default 0,
    created_at timestamptz not null default now(),
    unique(transfer_id,source_product_id)
);

create index if not exists stock_transfers_source_idx on public.stock_transfers(source_store_id,created_at desc);
create index if not exists stock_transfers_destination_idx on public.stock_transfers(destination_store_id,created_at desc);
create index if not exists stock_transfer_items_transfer_idx on public.stock_transfer_items(transfer_id);

drop trigger if exists trg_stock_transfers_touch on public.stock_transfers;
create trigger trg_stock_transfers_touch before update on public.stock_transfers
for each row execute function public.ldm_touch_row();

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
revoke all on public.stock_transfers,public.stock_transfer_items from anon;
revoke insert,update,delete on public.stock_transfers,public.stock_transfer_items from authenticated;
grant select on public.stock_transfers,public.stock_transfer_items to authenticated;

drop policy if exists stock_transfers_network_member_select on public.stock_transfers;
create policy stock_transfers_network_member_select on public.stock_transfers
for select to authenticated using (
    exists(select 1 from public.store_memberships sm where sm.user_id=auth.uid() and sm.active=true
           and sm.store_id in (source_store_id,destination_store_id))
);

drop policy if exists stock_transfer_items_network_member_select on public.stock_transfer_items;
create policy stock_transfer_items_network_member_select on public.stock_transfer_items
for select to authenticated using (
    exists(select 1 from public.stock_transfers st join public.store_memberships sm
           on sm.store_id in (st.source_store_id,st.destination_store_id)
           where st.id=stock_transfer_items.transfer_id and sm.user_id=auth.uid() and sm.active=true)
);

create or replace function public.ldm_transfer_product_candidates(p_destination_store_id uuid)
returns table(
    source_product_id uuid,destination_product_id uuid,barcode text,product_name text,
    unit text,source_stock numeric,destination_stock numeric,transfer_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_source uuid;
begin
    v_source:=public.ldm_current_store_id();
    if public.ldm_current_role() not in ('owner','admin') then raise exception 'Role tidak diizinkan membuat transfer.'; end if;
    if not public.ldm_same_network(v_source,p_destination_store_id) then raise exception 'Toko tujuan bukan bagian jaringan yang sama.'; end if;
    return query
    select p.id,dp.id,p.barcode,p.name,p.unit,p.legacy_stock_snapshot,
           coalesce(dp.legacy_stock_snapshot,0),dp.id is not null
    from public.products p
    left join public.products dp on dp.store_id=p_destination_store_id
      and dp.barcode=p.barcode and dp.active=true and dp.deleted_at is null
    where p.store_id=v_source and p.active=true and p.deleted_at is null
    order by lower(p.name);
end;
$$;

create or replace function public.ldm_create_stock_transfer(
    p_destination_store_id uuid,p_items jsonb,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_source uuid;
    v_transfer public.stock_transfers%rowtype;
    v_item jsonb;
    v_source_product public.products%rowtype;
    v_destination_product public.products%rowtype;
    v_qty numeric(16,3);
    v_code text;
begin
    v_source:=public.ldm_current_store_id();
    if public.ldm_current_role() not in ('owner','admin') then raise exception 'Role tidak diizinkan membuat transfer.'; end if;
    if p_destination_store_id=v_source or not public.ldm_same_network(v_source,p_destination_store_id) then
        raise exception 'Toko tujuan transfer tidak valid.';
    end if;
    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
        raise exception 'Minimal satu barang harus dipilih.';
    end if;

    v_code:='TRF-'||to_char(now() at time zone 'Asia/Makassar','YYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
    insert into public.stock_transfers(transfer_code,source_store_id,destination_store_id,status,note,created_by)
    values(v_code,v_source,p_destination_store_id,'DRAFT',nullif(btrim(coalesce(p_note,'')),''),auth.uid())
    returning * into v_transfer;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0);
        if v_qty<=0 then raise exception 'Qty transfer harus lebih besar dari 0.'; end if;
        select * into strict v_source_product from public.products p
        where p.id=(v_item->>'source_product_id')::uuid and p.store_id=v_source
          and p.active=true and p.deleted_at is null;
        if nullif(btrim(coalesce(v_source_product.barcode,'')),'') is null then
            raise exception 'Barang % belum memiliki barcode.',v_source_product.name;
        end if;
        select * into v_destination_product from public.products p
        where p.store_id=p_destination_store_id and p.barcode=v_source_product.barcode
          and p.active=true and p.deleted_at is null limit 1;
        if v_destination_product.id is null then
            raise exception 'Barang % belum tersedia pada toko tujuan.',v_source_product.name;
        end if;
        insert into public.stock_transfer_items(
            transfer_id,source_product_id,destination_product_id,barcode_snapshot,
            product_name_snapshot,unit_snapshot,qty_requested,unit_cost_snapshot
        ) values (
            v_transfer.id,v_source_product.id,v_destination_product.id,v_source_product.barcode,
            v_source_product.name,coalesce(v_source_product.unit,'Pcs'),v_qty,v_source_product.purchase_price
        );
    end loop;
    return jsonb_build_object('id',v_transfer.id,'transfer_code',v_transfer.transfer_code,'status',v_transfer.status);
end;
$$;

create or replace function public.ldm_send_stock_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer public.stock_transfers%rowtype;
    v_item public.stock_transfer_items%rowtype;
    v_product public.products%rowtype;
    v_after numeric(16,3);
begin
    select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
    if v_transfer.id is null or v_transfer.source_store_id<>public.ldm_current_store_id() then raise exception 'Transfer sumber tidak ditemukan pada toko aktif.'; end if;
    if public.ldm_current_role() not in ('owner','admin') then raise exception 'Role tidak diizinkan mengirim transfer.'; end if;
    if v_transfer.status<>'DRAFT' then raise exception 'Hanya transfer DRAFT yang dapat dikirim.'; end if;

    for v_item in select * from public.stock_transfer_items where transfer_id=v_transfer.id order by source_product_id
    loop
        select * into strict v_product from public.products
        where id=v_item.source_product_id and store_id=v_transfer.source_store_id for update;
        if v_product.legacy_stock_snapshot<v_item.qty_requested then
            raise exception 'Stok % tidak cukup. Tersedia %, diminta %.',v_product.name,v_product.legacy_stock_snapshot,v_item.qty_requested;
        end if;
        v_after:=v_product.legacy_stock_snapshot-v_item.qty_requested;
        update public.products set legacy_stock_snapshot=v_after where id=v_product.id;
        update public.stock_transfer_items set qty_sent=qty_requested where id=v_item.id;
        insert into public.stock_movements(
            store_id,product_id,movement_type,quantity_change,stock_before,stock_after,
            unit_cost_snapshot,source_type,source_id,reference_code,note,created_by
        ) values (
            v_transfer.source_store_id,v_product.id,'transfer_out',-v_item.qty_requested,
            v_product.legacy_stock_snapshot,v_after,v_product.purchase_price,
            'stock_transfer_out',v_item.id::text,v_transfer.transfer_code,
            'Transfer stok ke toko lain',auth.uid()
        );
    end loop;
    update public.stock_transfers set status='IN_TRANSIT',sent_by=auth.uid(),sent_at=now() where id=v_transfer.id;
    return jsonb_build_object('id',v_transfer.id,'transfer_code',v_transfer.transfer_code,'status','IN_TRANSIT');
end;
$$;

create or replace function public.ldm_receive_stock_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer public.stock_transfers%rowtype;
    v_item public.stock_transfer_items%rowtype;
    v_product public.products%rowtype;
    v_after numeric(16,3);
begin
    select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
    if v_transfer.id is null or v_transfer.destination_store_id<>public.ldm_current_store_id() then raise exception 'Transfer tujuan tidak ditemukan pada toko aktif.'; end if;
    if public.ldm_current_role() not in ('owner','admin') then raise exception 'Role tidak diizinkan menerima transfer.'; end if;
    if v_transfer.status<>'IN_TRANSIT' then raise exception 'Hanya transfer DALAM PENGIRIMAN yang dapat diterima.'; end if;

    for v_item in select * from public.stock_transfer_items where transfer_id=v_transfer.id order by destination_product_id
    loop
        select * into strict v_product from public.products
        where id=v_item.destination_product_id and store_id=v_transfer.destination_store_id for update;
        v_after:=v_product.legacy_stock_snapshot+v_item.qty_sent;
        update public.products set legacy_stock_snapshot=v_after where id=v_product.id;
        update public.stock_transfer_items set qty_received=qty_sent where id=v_item.id;
        insert into public.stock_movements(
            store_id,product_id,movement_type,quantity_change,stock_before,stock_after,
            unit_cost_snapshot,source_type,source_id,reference_code,note,created_by
        ) values (
            v_transfer.destination_store_id,v_product.id,'transfer_in',v_item.qty_sent,
            v_product.legacy_stock_snapshot,v_after,v_item.unit_cost_snapshot,
            'stock_transfer_in',v_item.id::text,v_transfer.transfer_code,
            'Penerimaan transfer stok',auth.uid()
        );
    end loop;
    update public.stock_transfers set status='RECEIVED',received_by=auth.uid(),received_at=now() where id=v_transfer.id;
    return jsonb_build_object('id',v_transfer.id,'transfer_code',v_transfer.transfer_code,'status','RECEIVED');
end;
$$;

create or replace function public.ldm_cancel_stock_transfer(p_transfer_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_transfer public.stock_transfers%rowtype; v_reason text;
begin
    select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
    if v_transfer.id is null or v_transfer.source_store_id<>public.ldm_current_store_id() then raise exception 'Transfer sumber tidak ditemukan.'; end if;
    if public.ldm_current_role() not in ('owner','admin') then raise exception 'Role tidak diizinkan membatalkan transfer.'; end if;
    if v_transfer.status<>'DRAFT' then raise exception 'Transfer yang sudah dikirim tidak dapat dibatalkan.'; end if;
    v_reason:=btrim(coalesce(p_reason,''));
    if length(v_reason)<3 then raise exception 'Alasan pembatalan minimal 3 karakter.'; end if;
    update public.stock_transfers set status='CANCELLED',cancel_reason=v_reason,cancelled_by=auth.uid(),cancelled_at=now() where id=v_transfer.id;
    return jsonb_build_object('id',v_transfer.id,'transfer_code',v_transfer.transfer_code,'status','CANCELLED');
end;
$$;

create or replace function public.ldm_stock_transfer_list(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    from (
        select st.created_at,
        jsonb_build_object(
            'id',st.id,'transfer_code',st.transfer_code,'status',st.status,
            'source_store_id',st.source_store_id,'source_store_name',ss.name,
            'destination_store_id',st.destination_store_id,'destination_store_name',ds.name,
            'note',st.note,'cancel_reason',st.cancel_reason,'created_at',st.created_at,
            'sent_at',st.sent_at,'received_at',st.received_at,
            'items',(
                select coalesce(jsonb_agg(jsonb_build_object(
                    'id',i.id,'barcode',i.barcode_snapshot,'name',i.product_name_snapshot,
                    'unit',i.unit_snapshot,'qty_requested',i.qty_requested,
                    'qty_sent',i.qty_sent,'qty_received',i.qty_received
                ) order by i.product_name_snapshot),'[]'::jsonb)
                from public.stock_transfer_items i where i.transfer_id=st.id
            )
        ) row_data
        from public.stock_transfers st
        join public.stores ss on ss.id=st.source_store_id
        join public.stores ds on ds.id=st.destination_store_id
        where exists(select 1 from public.store_memberships sm where sm.user_id=auth.uid() and sm.active=true
                     and sm.store_id in (st.source_store_id,st.destination_store_id))
        order by st.created_at desc limit greatest(1,least(coalesce(p_limit,100),500))
    ) q;
$$;

revoke all on function public.ldm_same_network(uuid,uuid) from public,anon;
revoke all on function public.ldm_has_network_access(uuid) from public,anon;
revoke all on function public.ldm_my_network_stores() from public,anon;
revoke all on function public.ldm_create_branch_store(text,text,boolean) from public,anon;
revoke all on function public.ldm_prepare_store_device(uuid,text,text,text) from public,anon;
revoke all on function public.ldm_switch_store(uuid,text) from public,anon;
revoke all on function public.ldm_transfer_product_candidates(uuid) from public,anon;
revoke all on function public.ldm_create_stock_transfer(uuid,jsonb,text) from public,anon;
revoke all on function public.ldm_send_stock_transfer(uuid) from public,anon;
revoke all on function public.ldm_receive_stock_transfer(uuid) from public,anon;
revoke all on function public.ldm_cancel_stock_transfer(uuid,text) from public,anon;
revoke all on function public.ldm_stock_transfer_list(integer) from public,anon;

grant execute on function public.ldm_my_network_stores() to authenticated;
grant execute on function public.ldm_has_network_access(uuid) to authenticated;
grant execute on function public.ldm_create_branch_store(text,text,boolean) to authenticated;
grant execute on function public.ldm_prepare_store_device(uuid,text,text,text) to authenticated;
grant execute on function public.ldm_switch_store(uuid,text) to authenticated;
grant execute on function public.ldm_transfer_product_candidates(uuid) to authenticated;
grant execute on function public.ldm_create_stock_transfer(uuid,jsonb,text) to authenticated;
grant execute on function public.ldm_send_stock_transfer(uuid) to authenticated;
grant execute on function public.ldm_receive_stock_transfer(uuid) to authenticated;
grant execute on function public.ldm_cancel_stock_transfer(uuid,text) to authenticated;
grant execute on function public.ldm_stock_transfer_list(integer) to authenticated;

insert into public.ldm_system_meta(key,value) values
('live_sync_stage','22'),('schema_status','multi_store_stock_transfer_ready'),
('schema_version','22'),('store_authority','store_memberships + active_store_sessions'),
('stock_transfer_authority','stock_transfers + stock_transfer_items + stock_movements')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

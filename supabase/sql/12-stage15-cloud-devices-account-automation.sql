-- ================================================================
-- LocDailyMar Live Sync - TAHAP 15
-- Cloud Device Groups + Owner Approval + Account Automation Foundation
-- Built on Tahap 14
-- ================================================================

begin;

-- ------------------------------------------------
-- DEVICE GROUPS
-- ------------------------------------------------
create table if not exists public.device_groups (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    name text not null,
    active boolean not null default true,
    created_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version >= 1),
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id) on delete set null,
    constraint device_groups_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists uq_device_groups_store_name_active
on public.device_groups(store_id, lower(name))
where deleted_at is null;

create index if not exists idx_device_groups_store
on public.device_groups(store_id);

drop trigger if exists trg_ldm_device_groups_touch on public.device_groups;
create trigger trg_ldm_device_groups_touch
before update on public.device_groups
for each row execute function public.ldm_touch_row();

alter table public.device_groups enable row level security;
revoke all on public.device_groups from anon, authenticated;
grant select on public.device_groups to authenticated;

drop policy if exists device_groups_owner_select on public.device_groups;
create policy device_groups_owner_select
on public.device_groups for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
    and deleted_at is null
);

-- ------------------------------------------------
-- Extend devices: pending / active / revoked + optional group
-- ------------------------------------------------
alter table public.devices
add column if not exists group_id uuid
references public.device_groups(id) on delete set null;

alter table public.devices
    drop constraint if exists devices_status_check;

alter table public.devices
    add constraint devices_status_check
    check (status in ('pending','active','revoked'));

create index if not exists idx_devices_group_id
on public.devices(group_id);

-- Direct browser mutation is no longer allowed.
-- Device registration and Owner management use SECURITY DEFINER RPCs.
revoke insert, update, delete on public.devices from authenticated;
grant select on public.devices to authenticated;

-- Direct visibility: Owner sees same store, normal users only own device rows.
drop policy if exists "devices_select_same_store" on public.devices;
drop policy if exists devices_select_owner_or_self on public.devices;
create policy devices_select_owner_or_self
on public.devices for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and (
        public.ldm_current_role() = 'owner'
        or user_id = auth.uid()
    )
);

-- Old mutation policies become irrelevant because table privileges are revoked,
-- but remove them to avoid accidental re-grants later.
drop policy if exists "devices_insert_self" on public.devices;
drop policy if exists "devices_update_self_or_management" on public.devices;

-- ------------------------------------------------
-- Rework device registration.
-- Existing device keeps its status.
-- Every NEW device becomes PENDING until an already-linked Owner approves.
-- Existing device rows keep their current status, so the current Device A remains active after upgrade.
-- Revoked device NEVER auto-reactivates by login.
-- ------------------------------------------------
create or replace function public.ldm_register_device(
    p_client_device_id text,
    p_device_name text default null,
    p_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_device_id uuid;
    v_client_id text;
    v_initial_status text;
begin
    v_client_id := btrim(coalesce(p_client_device_id, ''));

    if v_client_id = '' then
        raise exception 'client_device_id wajib diisi';
    end if;

    if length(v_client_id) > 200 then
        raise exception 'client_device_id terlalu panjang';
    end if;

    select p.store_id, p.role
      into v_store_id, v_role
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
    limit 1;

    if v_store_id is null then
        raise exception 'Profile aktif untuk user ini belum tersedia';
    end if;

    v_initial_status := 'pending';

    perform pg_advisory_xact_lock(
        hashtextextended(v_store_id::text || ':' || v_client_id, 0)
    );

    update public.devices
       set user_id = auth.uid(),
           device_name = nullif(btrim(coalesce(p_device_name, '')), ''),
           platform = nullif(btrim(coalesce(p_platform, '')), ''),
           last_seen_at = now(),
           deleted_at = null,
           deleted_by = null
     where store_id = v_store_id
       and client_device_id = v_client_id
       and deleted_at is null
     returning id into v_device_id;

    if v_device_id is null then
        insert into public.devices (
            store_id, user_id, client_device_id, device_name,
            platform, status, last_seen_at
        ) values (
            v_store_id, auth.uid(), v_client_id,
            nullif(btrim(coalesce(p_device_name, '')), ''),
            nullif(btrim(coalesce(p_platform, '')), ''),
            v_initial_status, now()
        )
        returning id into v_device_id;
    end if;

    return v_device_id;
end;
$$;

revoke all on function public.ldm_register_device(text,text,text) from public, anon;
grant execute on function public.ldm_register_device(text,text,text) to authenticated;

-- ------------------------------------------------
-- Current browser device access.
-- ------------------------------------------------
create or replace function public.ldm_current_device_access(
    p_client_device_id text
)
returns table (
    device_id uuid,
    client_device_id text,
    status text,
    device_name text,
    platform text,
    group_id uuid,
    group_name text,
    last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
begin
    v_store_id := public.ldm_current_store_id();

    if v_store_id is null then
        raise exception 'Profile aktif tidak ditemukan.';
    end if;

    return query
    select
        d.id,
        d.client_device_id,
        d.status,
        d.device_name,
        d.platform,
        d.group_id,
        g.name,
        d.last_seen_at
    from public.devices d
    left join public.device_groups g
      on g.id = d.group_id
     and g.deleted_at is null
    where d.store_id = v_store_id
      and d.user_id = auth.uid()
      and d.client_device_id = btrim(coalesce(p_client_device_id,''))
      and d.deleted_at is null
    limit 1;
end;
$$;

revoke all on function public.ldm_current_device_access(text) from public, anon;
grant execute on function public.ldm_current_device_access(text) to authenticated;

-- ------------------------------------------------
-- Role-aware device list helper retained for compatibility.
-- Owner: all devices in store. Others: own devices only.
-- ------------------------------------------------
create or replace function public.ldm_my_devices()
returns table (
    id uuid,
    client_device_id text,
    device_name text,
    platform text,
    status text,
    last_seen_at timestamptz,
    user_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        d.id,
        d.client_device_id,
        d.device_name,
        d.platform,
        d.status,
        d.last_seen_at,
        d.user_id
    from public.devices d
    where d.store_id = public.ldm_current_store_id()
      and d.deleted_at is null
      and (
        public.ldm_current_role() = 'owner'
        or d.user_id = auth.uid()
      )
    order by d.last_seen_at desc;
$$;

revoke all on function public.ldm_my_devices() from public, anon;
grant execute on function public.ldm_my_devices() to authenticated;

-- ------------------------------------------------
-- OWNER DEVICE MANAGEMENT
-- ------------------------------------------------
create or replace function public.ldm_device_owner_list()
returns table (
    device_id uuid,
    client_device_id text,
    device_name text,
    platform text,
    status text,
    last_seen_at timestamptz,
    user_id uuid,
    username text,
    user_role text,
    group_id uuid,
    group_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat mengelola perangkat cloud.';
    end if;

    return query
    select
        d.id, d.client_device_id, d.device_name, d.platform,
        d.status, d.last_seen_at, d.user_id,
        p.username, p.role,
        d.group_id, g.name
    from public.devices d
    left join public.profiles p on p.id = d.user_id
    left join public.device_groups g
      on g.id = d.group_id and g.deleted_at is null
    where d.store_id = v_store_id
      and d.deleted_at is null
    order by
        case d.status when 'pending' then 1 when 'active' then 2 else 3 end,
        d.last_seen_at desc;
end;
$$;

revoke all on function public.ldm_device_owner_list() from public, anon;
grant execute on function public.ldm_device_owner_list() to authenticated;

create or replace function public.ldm_device_group_list()
returns table (
    id uuid,
    name text,
    active boolean,
    member_count bigint,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare v_store_id uuid;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat membaca grup perangkat.';
    end if;

    return query
    select
        g.id, g.name, g.active,
        count(d.id) filter (where d.deleted_at is null and d.status = 'active'),
        g.created_at
    from public.device_groups g
    left join public.devices d on d.group_id = g.id
    where g.store_id = v_store_id
      and g.deleted_at is null
    group by g.id
    order by lower(g.name), g.created_at;
end;
$$;

revoke all on function public.ldm_device_group_list() from public, anon;
grant execute on function public.ldm_device_group_list() to authenticated;

create or replace function public.ldm_device_group_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_store_id uuid; v_name text; v_row public.device_groups%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat membuat grup perangkat.';
    end if;
    v_name := btrim(coalesce(p_name,''));
    if length(v_name) < 3 or length(v_name) > 80 then
        raise exception 'Nama grup harus 3-80 karakter.';
    end if;

    insert into public.device_groups(store_id,name,active,created_by)
    values(v_store_id,v_name,true,auth.uid())
    returning * into v_row;

    return jsonb_build_object('id',v_row.id,'name',v_row.name,'active',v_row.active);
end;
$$;
revoke all on function public.ldm_device_group_create(text) from public, anon;
grant execute on function public.ldm_device_group_create(text) to authenticated;

create or replace function public.ldm_device_group_delete(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_store_id uuid; v_name text;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus grup perangkat.';
    end if;

    select name into v_name
    from public.device_groups
    where id=p_group_id and store_id=v_store_id and deleted_at is null
    for update;

    if v_name is null then raise exception 'Grup perangkat tidak ditemukan.'; end if;

    update public.devices
       set group_id = null
     where store_id=v_store_id and group_id=p_group_id and deleted_at is null;

    update public.device_groups
       set active=false, deleted_at=now(), deleted_by=auth.uid()
     where id=p_group_id and store_id=v_store_id;

    return jsonb_build_object('id',p_group_id,'name',v_name,'deleted',true);
end;
$$;
revoke all on function public.ldm_device_group_delete(uuid) from public, anon;
grant execute on function public.ldm_device_group_delete(uuid) to authenticated;

create or replace function public.ldm_device_approve(
    p_device_id uuid,
    p_group_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_store_id uuid; v_row public.devices%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghubungkan perangkat.';
    end if;

    if p_group_id is not null and not exists(
        select 1 from public.device_groups g
        where g.id=p_group_id and g.store_id=v_store_id
          and g.active=true and g.deleted_at is null
    ) then
        raise exception 'Grup perangkat tidak valid.';
    end if;

    update public.devices
       set status='active', group_id=p_group_id,
           deleted_at=null, deleted_by=null
     where id=p_device_id and store_id=v_store_id and deleted_at is null
     returning * into v_row;

    if v_row.id is null then raise exception 'Perangkat tidak ditemukan.'; end if;

    return jsonb_build_object(
        'device_id',v_row.id,'status',v_row.status,
        'group_id',v_row.group_id,'client_device_id',v_row.client_device_id
    );
end;
$$;
revoke all on function public.ldm_device_approve(uuid,uuid) from public, anon;
grant execute on function public.ldm_device_approve(uuid,uuid) to authenticated;

create or replace function public.ldm_device_revoke(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_store_id uuid; v_row public.devices%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat memutuskan perangkat.';
    end if;

    update public.devices
       set status='revoked', group_id=null
     where id=p_device_id and store_id=v_store_id and deleted_at is null
     returning * into v_row;

    if v_row.id is null then raise exception 'Perangkat tidak ditemukan.'; end if;

    return jsonb_build_object(
        'device_id',v_row.id,'status',v_row.status,
        'client_device_id',v_row.client_device_id
    );
end;
$$;
revoke all on function public.ldm_device_revoke(uuid) from public, anon;
grant execute on function public.ldm_device_revoke(uuid) to authenticated;

-- ------------------------------------------------
-- ROLE-AWARE CLOUD ACCOUNT LIST
-- Owner: all profiles + Auth email metadata.
-- Admin: all store profiles, but other users' email/Auth metadata hidden.
-- Kasir: own profile only.
-- ------------------------------------------------
create or replace function public.ldm_account_list()
returns table (
    user_id uuid,
    email text,
    username text,
    display_name text,
    role text,
    active boolean,
    employee_id text,
    auth_created_at timestamptz,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    profile_created_at timestamptz,
    profile_updated_at timestamptz,
    profile_version bigint
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
stable
as $$
declare v_store_id uuid; v_role text;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null or v_role not in ('owner','admin','kasir') then
        raise exception 'Profile cloud aktif tidak ditemukan.';
    end if;

    return query
    select
        p.id,
        case when v_role='owner' or p.id=auth.uid() then u.email::text else null end,
        p.username,
        p.display_name,
        p.role,
        p.active,
        p.employee_id,
        case when v_role='owner' or p.id=auth.uid() then u.created_at else null end,
        case when v_role='owner' or p.id=auth.uid() then u.email_confirmed_at else null end,
        case when v_role='owner' or p.id=auth.uid() then u.last_sign_in_at else null end,
        p.created_at,
        p.updated_at,
        p.version
    from public.profiles p
    join auth.users u on u.id=p.id
    where p.store_id=v_store_id
      and p.deleted_at is null
      and (v_role in ('owner','admin') or p.id=auth.uid())
    order by
        case p.role when 'owner' then 1 when 'admin' then 2 when 'kasir' then 3 else 4 end,
        lower(p.username), p.id;
end;
$$;
revoke all on function public.ldm_account_list() from public, anon;
grant execute on function public.ldm_account_list() to authenticated;

create or replace function public.ldm_account_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid; v_role text;
    v_total integer; v_active integer; v_inactive integer;
    v_owners integer; v_admins integer; v_cashiers integer;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    if v_store_id is null or v_role not in ('owner','admin','kasir') then
        raise exception 'Profile cloud aktif tidak ditemukan.';
    end if;

    if v_role='kasir' then
        select count(*), count(*) filter(where active), count(*) filter(where not active),
               count(*) filter(where role='owner' and active),
               count(*) filter(where role='admin' and active),
               count(*) filter(where role='kasir' and active)
          into v_total,v_active,v_inactive,v_owners,v_admins,v_cashiers
        from public.profiles
        where id=auth.uid() and store_id=v_store_id and deleted_at is null;
    else
        select count(*), count(*) filter(where active), count(*) filter(where not active),
               count(*) filter(where role='owner' and active),
               count(*) filter(where role='admin' and active),
               count(*) filter(where role='kasir' and active)
          into v_total,v_active,v_inactive,v_owners,v_admins,v_cashiers
        from public.profiles
        where store_id=v_store_id and deleted_at is null;
    end if;

    return jsonb_build_object(
        'total_profiles',v_total,'active_profiles',v_active,'inactive_profiles',v_inactive,
        'active_owners',v_owners,'active_admins',v_admins,'active_cashiers',v_cashiers,
        'viewer_role',v_role
    );
end;
$$;
revoke all on function public.ldm_account_health() from public, anon;
grant execute on function public.ldm_account_health() to authenticated;

-- ------------------------------------------------
-- Hard-delete safety inspector for Edge Function.
-- Finds RESTRICT / NO ACTION FKs to auth.users that currently reference target.
-- ------------------------------------------------
create or replace function public.ldm_account_delete_safety(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
    v_store_id uuid; v_role text; v_target public.profiles%rowtype;
    v_other_owner_count integer; r record; v_exists boolean; v_blockers jsonb := '[]'::jsonb;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    if v_store_id is null or v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus akun cloud.';
    end if;
    if p_user_id = auth.uid() then
        raise exception 'Owner yang sedang login tidak dapat menghapus dirinya sendiri.';
    end if;

    select * into v_target from public.profiles
    where id=p_user_id and store_id=v_store_id and deleted_at is null;
    if v_target.id is null then raise exception 'Profile target tidak ditemukan.'; end if;

    if v_target.role='owner' and v_target.active=true then
        select count(*) into v_other_owner_count
        from public.profiles
        where store_id=v_store_id and role='owner' and active=true
          and deleted_at is null and id<>p_user_id;
        if v_other_owner_count < 1 then
            raise exception 'Owner aktif terakhir tidak dapat dihapus.';
        end if;
    end if;

    for r in
        select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
        from pg_constraint con
        join pg_class c on c.oid=con.conrelid
        join pg_namespace n on n.oid=c.relnamespace
        join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
        where con.contype='f'
          and con.confrelid='auth.users'::regclass
          and con.confdeltype in ('a','r')
          and array_length(con.conkey,1)=1
    loop
        execute format(
            'select exists(select 1 from %I.%I where %I = $1)',
            r.schema_name, r.table_name, r.column_name
        ) into v_exists using p_user_id;

        if v_exists then
            v_blockers := v_blockers || jsonb_build_array(
                jsonb_build_object(
                    'schema',r.schema_name,
                    'table',r.table_name,
                    'column',r.column_name
                )
            );
        end if;
    end loop;

    return jsonb_build_object(
        'user_id',p_user_id,
        'can_hard_delete',jsonb_array_length(v_blockers)=0,
        'blockers',v_blockers
    );
end;
$$;
revoke all on function public.ldm_account_delete_safety(uuid) from public, anon;
grant execute on function public.ldm_account_delete_safety(uuid) to authenticated;

-- Realtime for owner device console.
do $$
begin
    if exists(select 1 from pg_publication where pubname='supabase_realtime') then
        if not exists(
            select 1 from pg_publication_tables
            where pubname='supabase_realtime' and schemaname='public' and tablename='devices'
        ) then
            alter publication supabase_realtime add table public.devices;
        end if;
        if not exists(
            select 1 from pg_publication_tables
            where pubname='supabase_realtime' and schemaname='public' and tablename='device_groups'
        ) then
            alter publication supabase_realtime add table public.device_groups;
        end if;
    end if;
end $$;

insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','15'),
    ('schema_version','15'),
    ('schema_status','cloud_devices_and_account_admin_ready'),
    ('device_access_mode','owner_approved_groups'),
    ('device_management_role','owner_only'),
    ('cloud_account_page_access','role_aware_all_roles'),
    ('cloud_account_write_role','owner_only'),
    ('cloud_account_create_delete','edge_function_required')
on conflict(key) do update set value=excluded.value, updated_at=now();

commit;

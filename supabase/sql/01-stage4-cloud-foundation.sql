-- ================================================================
-- LocDailyMar - Live Sync Tahap 4
-- Cloud Foundation
--
-- Tujuan:
--   1. stores
--   2. profiles
--   3. devices
--   4. UUID / stable ID
--   5. store_id
--   6. created_at / updated_at
--   7. version
--   8. soft delete: deleted_at / deleted_by
--   9. Row Level Security dasar
--
-- PENTING:
-- - Tahap ini BELUM memigrasikan Barang, transaksi, stok, retur, dsb.
-- - Tahap ini BELUM mengganti login localStorage dengan Supabase Auth.
-- - Jalankan setelah SQL Tahap 3.
-- ================================================================

begin;

-- ------------------------------------------------
-- Metadata Tahap 3 dibuat lagi secara idempotent
-- agar file ini lebih aman jika dijalankan ulang.
-- ------------------------------------------------
create table if not exists public.ldm_system_meta (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

alter table public.ldm_system_meta enable row level security;

revoke all on table public.ldm_system_meta from anon, authenticated;
grant select on table public.ldm_system_meta to anon, authenticated;

drop policy if exists "ldm_system_meta_read" on public.ldm_system_meta;
create policy "ldm_system_meta_read"
on public.ldm_system_meta
for select
to anon, authenticated
using (true);

-- ------------------------------------------------
-- Function timestamp + version
-- ------------------------------------------------
create or replace function public.ldm_touch_row()
returns trigger
language plpgsql
as $$
begin
    -- Stable primary key dan created_at tidak boleh berubah.
    new.id := old.id;
    new.created_at := old.created_at;

    new.updated_at := now();
    new.version := old.version + 1;

    return new;
end;
$$;

-- ------------------------------------------------
-- STORES
-- ------------------------------------------------
create table if not exists public.stores (
    id uuid primary key default gen_random_uuid(),

    code text not null unique,
    name text not null,

    timezone text not null default 'Asia/Makassar',
    currency text not null default 'IDR',

    status text not null default 'active'
        check (status in ('active', 'inactive')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    version bigint not null default 1
        check (version >= 1),

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id) on delete set null,

    constraint stores_code_not_blank
        check (btrim(code) <> ''),

    constraint stores_name_not_blank
        check (btrim(name) <> '')
);

drop trigger if exists trg_ldm_stores_touch on public.stores;
create trigger trg_ldm_stores_touch
before update on public.stores
for each row
execute function public.ldm_touch_row();

-- Toko awal. ID tetap UUID dan cukup dicari berdasarkan code.
insert into public.stores (
    code,
    name,
    timezone,
    currency,
    status
)
values (
    'LDM-DEFAULT',
    'LocDailyMar',
    'Asia/Makassar',
    'IDR',
    'active'
)
on conflict (code)
do update set
    name = excluded.name,
    timezone = excluded.timezone,
    currency = excluded.currency,
    status = excluded.status,
    deleted_at = null;

-- ------------------------------------------------
-- PROFILES
--
-- id = auth.users.id agar identitas login dan profil
-- memiliki stable UUID yang sama.
-- Data profile baru akan dibuat saat Tahap 5 Auth.
-- ------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    store_id uuid not null
        references public.stores(id)
        on delete restrict,

    username text not null,
    display_name text,

    role text not null
        check (role in ('owner', 'admin', 'kasir')),

    active boolean not null default true,

    employee_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    version bigint not null default 1
        check (version >= 1),

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id) on delete set null,

    constraint profiles_username_not_blank
        check (btrim(username) <> '')
);

create index if not exists idx_profiles_store_id
    on public.profiles(store_id);

create index if not exists idx_profiles_store_role
    on public.profiles(store_id, role);

create unique index if not exists uq_profiles_store_username_active
    on public.profiles(store_id, lower(username))
    where deleted_at is null;

drop trigger if exists trg_ldm_profiles_touch on public.profiles;
create trigger trg_ldm_profiles_touch
before update on public.profiles
for each row
execute function public.ldm_touch_row();

-- ------------------------------------------------
-- DEVICES
--
-- client_device_id berasal dari browser/perangkat.
-- UUID kolom id tetap menjadi primary key cloud.
-- ------------------------------------------------
create table if not exists public.devices (
    id uuid primary key default gen_random_uuid(),

    store_id uuid not null
        references public.stores(id)
        on delete restrict,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    client_device_id text not null,
    device_name text,
    platform text,

    status text not null default 'active'
        check (status in ('active', 'revoked')),

    last_seen_at timestamptz not null default now(),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    version bigint not null default 1
        check (version >= 1),

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id) on delete set null,

    constraint devices_client_id_not_blank
        check (btrim(client_device_id) <> '')
);

create index if not exists idx_devices_store_id
    on public.devices(store_id);

create index if not exists idx_devices_user_id
    on public.devices(user_id);

create index if not exists idx_devices_last_seen
    on public.devices(store_id, last_seen_at desc);

create unique index if not exists uq_devices_store_client_active
    on public.devices(store_id, client_device_id)
    where deleted_at is null;

drop trigger if exists trg_ldm_devices_touch on public.devices;
create trigger trg_ldm_devices_touch
before update on public.devices
for each row
execute function public.ldm_touch_row();

-- ------------------------------------------------
-- Helper current user
--
-- SECURITY DEFINER dipakai hanya untuk membaca profil user
-- yang sedang login, agar policy tidak mengalami recursive RLS.
-- ------------------------------------------------
create or replace function public.ldm_current_store_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.store_id
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
    limit 1;
$$;

create or replace function public.ldm_current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.role
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
    limit 1;
$$;

revoke all on function public.ldm_current_store_id() from public, anon;
revoke all on function public.ldm_current_role() from public, anon;

grant execute on function public.ldm_current_store_id() to authenticated;
grant execute on function public.ldm_current_role() to authenticated;

-- ------------------------------------------------
-- RLS
-- ------------------------------------------------
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.devices enable row level security;

-- Permission table level.
-- ANON tidak mendapatkan akses ke foundation tables.
revoke all on table public.stores from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.devices from anon, authenticated;

grant select, update
    on table public.stores
    to authenticated;

grant select
    on table public.profiles
    to authenticated;

grant select, insert, update
    on table public.devices
    to authenticated;

-- STORES: user login hanya melihat tokonya sendiri.
drop policy if exists "stores_select_same_store" on public.stores;
create policy "stores_select_same_store"
on public.stores
for select
to authenticated
using (
    id = public.ldm_current_store_id()
    and deleted_at is null
);

-- Hanya Owner yang boleh mengubah metadata toko.
drop policy if exists "stores_update_owner" on public.stores;
create policy "stores_update_owner"
on public.stores
for update
to authenticated
using (
    id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
    and deleted_at is null
)
with check (
    id = public.ldm_current_store_id()
    and public.ldm_current_role() = 'owner'
);

-- PROFILES:
-- user dapat membaca dirinya sendiri.
-- Owner/Admin dapat membaca profile dalam toko yang sama.
-- Tidak ada INSERT/UPDATE/DELETE langsung pada Tahap 4.
drop policy if exists "profiles_select_self_or_management" on public.profiles;
create policy "profiles_select_self_or_management"
on public.profiles
for select
to authenticated
using (
    (
        id = auth.uid()
        and deleted_at is null
    )
    or
    (
        store_id = public.ldm_current_store_id()
        and public.ldm_current_role() in ('owner', 'admin')
        and deleted_at is null
    )
);

-- DEVICES:
-- Semua user login dapat melihat perangkat dalam toko yang sama.
drop policy if exists "devices_select_same_store" on public.devices;
create policy "devices_select_same_store"
on public.devices
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
);

-- User hanya boleh mendaftarkan perangkat untuk dirinya sendiri.
drop policy if exists "devices_insert_self" on public.devices;
create policy "devices_insert_self"
on public.devices
for insert
to authenticated
with check (
    store_id = public.ldm_current_store_id()
    and user_id = auth.uid()
    and deleted_at is null
);

-- User boleh memperbarui perangkatnya sendiri.
-- Owner/Admin juga boleh mengelola perangkat dalam toko yang sama.
drop policy if exists "devices_update_self_or_management" on public.devices;
create policy "devices_update_self_or_management"
on public.devices
for update
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and (
        user_id = auth.uid()
        or public.ldm_current_role() in ('owner', 'admin')
    )
)
with check (
    store_id = public.ldm_current_store_id()
    and (
        user_id = auth.uid()
        or public.ldm_current_role() in ('owner', 'admin')
    )
);

-- Tidak ada hard DELETE policy pada tahap ini.
-- Penghapusan cloud nantinya menggunakan soft delete.

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta (key, value)
values
    ('app_name', 'LocDailyMar'),
    ('live_sync_stage', '4'),
    ('schema_status', 'cloud_foundation_ready'),
    ('schema_version', '4'),
    ('default_store_code', 'LDM-DEFAULT')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

-- ================================================================
-- OUTPUT VERIFIKASI
-- ================================================================
select
    id,
    code,
    name,
    timezone,
    currency,
    status,
    version
from public.stores
where code = 'LDM-DEFAULT';

select *
from public.ldm_system_meta
order by key;

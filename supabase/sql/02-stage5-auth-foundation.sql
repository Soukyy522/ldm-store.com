-- ================================================================
-- LocDailyMar - Live Sync Tahap 5
-- Supabase Auth Foundation
--
-- Prasyarat:
--   - Tahap 3 sudah terpasang.
--   - Tahap 4 sudah terpasang.
--
-- Tujuan:
--   1. Context Auth user -> profile -> store.
--   2. Registrasi device yang authenticated.
--   3. Session cloud dapat diuji dari browser.
--   4. Metadata schema naik ke Tahap 5.
--
-- PENTING:
--   - File ini TIDAK membuat user Auth dengan password.
--   - User Auth pertama dibuat dari Supabase Dashboard / invitation.
--   - Setelah user Auth ada, jalankan template bootstrap Owner.
--   - Login utama index.html belum diganti pada Tahap 5.
-- ================================================================

begin;

-- ------------------------------------------------
-- Pastikan foundation Tahap 4 tersedia
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.stores') is null then
        raise exception 'Tabel public.stores belum ada. Jalankan Tahap 4 terlebih dahulu.';
    end if;

    if to_regclass('public.profiles') is null then
        raise exception 'Tabel public.profiles belum ada. Jalankan Tahap 4 terlebih dahulu.';
    end if;

    if to_regclass('public.devices') is null then
        raise exception 'Tabel public.devices belum ada. Jalankan Tahap 4 terlebih dahulu.';
    end if;
end
$$;

-- ------------------------------------------------
-- Context user saat ini.
--
-- SECURITY DEFINER aman di sini karena hasil hanya untuk auth.uid()
-- yang sedang login.
-- ------------------------------------------------
create or replace function public.ldm_my_context()
returns table (
    user_id uuid,
    username text,
    display_name text,
    role text,
    store_id uuid,
    store_code text,
    store_name text,
    profile_version bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        p.id as user_id,
        p.username,
        p.display_name,
        p.role,
        p.store_id,
        s.code as store_code,
        s.name as store_name,
        p.version as profile_version
    from public.profiles p
    join public.stores s
      on s.id = p.store_id
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
      and s.deleted_at is null
      and s.status = 'active'
    limit 1;
$$;

revoke all on function public.ldm_my_context() from public, anon;
grant execute on function public.ldm_my_context() to authenticated;

-- ------------------------------------------------
-- Registrasi / refresh perangkat milik user saat ini.
--
-- Client hanya mengirim identifier browser dan metadata tampilan.
-- store_id dan user_id selalu ditentukan oleh server dari auth.uid().
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
    v_device_id uuid;
    v_client_id text;
begin
    v_client_id := btrim(coalesce(p_client_device_id, ''));

    if v_client_id = '' then
        raise exception 'client_device_id wajib diisi';
    end if;

    if length(v_client_id) > 200 then
        raise exception 'client_device_id terlalu panjang';
    end if;

    select p.store_id
      into v_store_id
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.deleted_at is null
    limit 1;

    if v_store_id is null then
        raise exception 'Profile aktif untuk user ini belum tersedia';
    end if;

    -- Hindari race ketika dua request pertama datang bersamaan.
    perform pg_advisory_xact_lock(
        hashtextextended(
            v_store_id::text || ':' || v_client_id,
            0
        )
    );

    update public.devices
       set user_id = auth.uid(),
           device_name = nullif(btrim(coalesce(p_device_name, '')), ''),
           platform = nullif(btrim(coalesce(p_platform, '')), ''),
           status = 'active',
           last_seen_at = now(),
           deleted_at = null,
           deleted_by = null
     where store_id = v_store_id
       and client_device_id = v_client_id
     returning id into v_device_id;

    if v_device_id is null then
        insert into public.devices (
            store_id,
            user_id,
            client_device_id,
            device_name,
            platform,
            status,
            last_seen_at
        )
        values (
            v_store_id,
            auth.uid(),
            v_client_id,
            nullif(btrim(coalesce(p_device_name, '')), ''),
            nullif(btrim(coalesce(p_platform, '')), ''),
            'active',
            now()
        )
        returning id into v_device_id;
    end if;

    return v_device_id;
end;
$$;

revoke all on function public.ldm_register_device(text, text, text) from public, anon;
grant execute on function public.ldm_register_device(text, text, text) to authenticated;

-- ------------------------------------------------
-- Daftar device yang dapat dilihat oleh user.
-- RLS devices tetap berlaku pada query normal.
-- Helper ini juga dibatasi ke store user aktif.
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
    order by d.last_seen_at desc;
$$;

revoke all on function public.ldm_my_devices() from public, anon;
grant execute on function public.ldm_my_devices() to authenticated;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta (key, value)
values
    ('app_name', 'LocDailyMar'),
    ('live_sync_stage', '5'),
    ('schema_status', 'auth_foundation_ready'),
    ('schema_version', '5'),
    ('auth_mode', 'supabase_auth_test'),
    ('main_login_mode', 'legacy_local_temporarily')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

-- ================================================================
-- Verifikasi cepat
-- ================================================================
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'auth_mode',
    'main_login_mode'
)
order by key;

-- ================================================================
-- LocDailyMar - Live Sync Tahap 14
-- CLOUD ACCOUNT MANAGEMENT + USER LIFECYCLE + PASSWORD RECOVERY
--
-- Tahap 13 sudah menyediakan production hardening, audit trail,
-- cloud snapshot, dan health check.
--
-- Tahap 14 memindahkan menu Edit Akun dari daftarAkun/localStorage
-- menuju Supabase Auth + public.profiles sebagai authority resmi.
--
-- PENTING:
-- - Browser TIDAK memperoleh service_role.
-- - Browser TIDAK dapat membuat auth.users dengan Admin API.
-- - Auth User baru dibuat dari Supabase Dashboard > Authentication > Users,
--   lalu Owner menghubungkannya ke LocDailyMar melalui RPC ini.
-- - Password user lain TIDAK pernah dibaca/ditulis Owner.
-- - Password sendiri dapat diubah melalui Supabase Auth updateUser.
-- - Password lupa memakai recovery email Supabase Auth.
-- - Tidak ada Shift Management.
-- ================================================================

begin;

-- ------------------------------------------------
-- Preflight
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'Baseline cloud belum lengkap: public.profiles tidak ditemukan.';
    end if;

    if to_regclass('public.audit_events') is null then
        raise exception 'Tahap 13 belum lengkap: public.audit_events tidak ditemukan.';
    end if;

    if to_regclass('public.ldm_system_meta') is null then
        raise exception 'public.ldm_system_meta tidak ditemukan.';
    end if;
end
$$;

-- ------------------------------------------------
-- ACCOUNT LIST
-- Owner-only. Email Auth hanya diekspos untuk profile di store Owner.
-- auth.users tidak pernah diberikan SELECT langsung ke browser.
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
declare
    v_store_id uuid;
    v_role text;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null or v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat membuka manajemen akun cloud.';
    end if;

    return query
    select
        p.id,
        u.email::text,
        p.username,
        p.display_name,
        p.role,
        p.active,
        p.employee_id,
        u.created_at,
        u.email_confirmed_at,
        u.last_sign_in_at,
        p.created_at,
        p.updated_at,
        p.version
    from public.profiles p
    join auth.users u
      on u.id = p.id
    where p.store_id = v_store_id
      and p.deleted_at is null
    order by
        case p.role
            when 'owner' then 1
            when 'admin' then 2
            when 'kasir' then 3
            else 4
        end,
        lower(p.username),
        p.id;
end;
$$;

revoke all on function public.ldm_account_list()
from public, anon;
grant execute on function public.ldm_account_list()
to authenticated;

-- ------------------------------------------------
-- LINK EXISTING AUTH USER
-- Auth User HARUS sudah dibuat di Supabase Authentication > Users.
-- Function mencari exact email dan membuat/mengaktifkan public.profiles.
-- ------------------------------------------------
create or replace function public.ldm_account_link_existing_auth(
    p_email text,
    p_username text,
    p_display_name text default null,
    p_role text default 'kasir'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_store_id uuid;
    v_actor_role text;
    v_email text;
    v_username text;
    v_display_name text;
    v_role text;
    v_user_id uuid;
    v_existing public.profiles%rowtype;
    v_row public.profiles%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    v_actor_role := public.ldm_current_role();

    if v_store_id is null or v_actor_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghubungkan Auth User.';
    end if;

    v_email := lower(btrim(coalesce(p_email, '')));
    v_username := btrim(coalesce(p_username, ''));
    v_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
    v_role := lower(btrim(coalesce(p_role, 'kasir')));

    if v_email = '' then
        raise exception 'Email Auth wajib diisi.';
    end if;

    if v_username !~ '^[A-Za-z0-9._-]{3,50}$' then
        raise exception 'Username harus 3-50 karakter dan hanya boleh huruf, angka, titik, garis bawah, atau strip.';
    end if;

    if v_role not in ('owner','admin','kasir') then
        raise exception 'Role harus owner, admin, atau kasir.';
    end if;

    select u.id
      into v_user_id
    from auth.users u
    where lower(u.email::text) = v_email
    limit 1;

    if v_user_id is null then
        raise exception 'Auth User dengan email % belum ada. Buat dulu di Supabase Authentication > Users.', v_email;
    end if;

    select p.*
      into v_existing
    from public.profiles p
    where p.id = v_user_id
    limit 1;

    if v_existing.id is not null
       and v_existing.store_id <> v_store_id then
        raise exception 'Auth User tersebut sudah terhubung ke store lain. Relink lintas store diblokir.';
    end if;

    if exists (
        select 1
        from public.profiles p
        where p.store_id = v_store_id
          and lower(p.username) = lower(v_username)
          and p.id <> v_user_id
          and p.deleted_at is null
    ) then
        raise exception 'Username % sudah dipakai profile lain.', v_username;
    end if;

    if v_user_id = auth.uid() and v_role <> 'owner' then
        raise exception 'Owner yang sedang login tidak dapat menurunkan role dirinya sendiri melalui menu akun.';
    end if;

    insert into public.profiles (
        id,
        store_id,
        username,
        display_name,
        role,
        active,
        deleted_at,
        deleted_by
    )
    values (
        v_user_id,
        v_store_id,
        v_username,
        coalesce(v_display_name, v_username),
        v_role,
        true,
        null,
        null
    )
    on conflict (id)
    do update set
        store_id = excluded.store_id,
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        active = true,
        deleted_at = null,
        deleted_by = null
    returning * into v_row;

    return jsonb_build_object(
        'user_id', v_row.id,
        'email', v_email,
        'username', v_row.username,
        'display_name', v_row.display_name,
        'role', v_row.role,
        'active', v_row.active,
        'profile_version', v_row.version
    );
end;
$$;

revoke all on function public.ldm_account_link_existing_auth(text,text,text,text)
from public, anon;
grant execute on function public.ldm_account_link_existing_auth(text,text,text,text)
to authenticated;

-- ------------------------------------------------
-- UPDATE PROFILE / ACTIVATE / DEACTIVATE
-- - Owner-only.
-- - Tidak dapat menonaktifkan/demote diri sendiri.
-- - Owner terakhir tidak dapat dinonaktifkan/demote.
-- - Tidak ada hard delete Auth User/Profile dari browser.
-- ------------------------------------------------
create or replace function public.ldm_account_update_profile(
    p_user_id uuid,
    p_username text,
    p_display_name text default null,
    p_role text default 'kasir',
    p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_store_id uuid;
    v_actor_role text;
    v_username text;
    v_display_name text;
    v_role text;
    v_active boolean;
    v_target public.profiles%rowtype;
    v_row public.profiles%rowtype;
    v_other_owner_count integer;
begin
    v_store_id := public.ldm_current_store_id();
    v_actor_role := public.ldm_current_role();

    if v_store_id is null or v_actor_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat mengubah akun cloud.';
    end if;

    if p_user_id is null then
        raise exception 'User ID wajib diisi.';
    end if;

    select p.*
      into v_target
    from public.profiles p
    where p.id = p_user_id
      and p.store_id = v_store_id
      and p.deleted_at is null
    for update;

    if v_target.id is null then
        raise exception 'Profile cloud tidak ditemukan pada store ini.';
    end if;

    v_username := btrim(coalesce(p_username, ''));
    v_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
    v_role := lower(btrim(coalesce(p_role, 'kasir')));
    v_active := coalesce(p_active, true);

    if v_username !~ '^[A-Za-z0-9._-]{3,50}$' then
        raise exception 'Username harus 3-50 karakter dan hanya boleh huruf, angka, titik, garis bawah, atau strip.';
    end if;

    if v_role not in ('owner','admin','kasir') then
        raise exception 'Role harus owner, admin, atau kasir.';
    end if;

    if exists (
        select 1
        from public.profiles p
        where p.store_id = v_store_id
          and lower(p.username) = lower(v_username)
          and p.id <> p_user_id
          and p.deleted_at is null
    ) then
        raise exception 'Username % sudah dipakai profile lain.', v_username;
    end if;

    if p_user_id = auth.uid()
       and (v_role <> 'owner' or v_active = false) then
        raise exception 'Owner yang sedang login tidak dapat menonaktifkan atau menurunkan role dirinya sendiri.';
    end if;

    if v_target.role = 'owner'
       and v_target.active = true
       and (v_role <> 'owner' or v_active = false) then

        select count(*)
          into v_other_owner_count
        from public.profiles p
        where p.store_id = v_store_id
          and p.role = 'owner'
          and p.active = true
          and p.deleted_at is null
          and p.id <> p_user_id;

        if v_other_owner_count < 1 then
            raise exception 'Owner aktif terakhir tidak dapat dinonaktifkan atau diturunkan role.';
        end if;
    end if;

    update public.profiles
       set username = v_username,
           display_name = coalesce(v_display_name, v_username),
           role = v_role,
           active = v_active,
           deleted_at = null,
           deleted_by = null
     where id = p_user_id
       and store_id = v_store_id
    returning * into v_row;

    -- Device lama ditandai revoked saat profile dinonaktifkan.
    -- Ini metadata operasional; access aplikasi tetap ditolak terutama
    -- karena ldm_current_store_id/role dan ldm_my_context mensyaratkan active=true.
    if v_active = false then
        update public.devices
           set status = 'revoked'
         where store_id = v_store_id
           and user_id = p_user_id
           and deleted_at is null
           and status <> 'revoked';
    end if;

    return jsonb_build_object(
        'user_id', v_row.id,
        'username', v_row.username,
        'display_name', v_row.display_name,
        'role', v_row.role,
        'active', v_row.active,
        'profile_version', v_row.version
    );
end;
$$;

revoke all on function public.ldm_account_update_profile(uuid,text,text,text,boolean)
from public, anon;
grant execute on function public.ldm_account_update_profile(uuid,text,text,text,boolean)
to authenticated;

-- ------------------------------------------------
-- ACCOUNT HEALTH
-- Owner-only summary.
-- ------------------------------------------------
create or replace function public.ldm_account_health()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
stable
as $$
declare
    v_store_id uuid;
    v_role text;
    v_total integer;
    v_active integer;
    v_inactive integer;
    v_owners integer;
    v_admins integer;
    v_cashiers integer;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null or v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat membaca Account Health.';
    end if;

    select
        count(*),
        count(*) filter (where p.active = true),
        count(*) filter (where p.active = false),
        count(*) filter (where p.active = true and p.role = 'owner'),
        count(*) filter (where p.active = true and p.role = 'admin'),
        count(*) filter (where p.active = true and p.role = 'kasir')
    into
        v_total,
        v_active,
        v_inactive,
        v_owners,
        v_admins,
        v_cashiers
    from public.profiles p
    where p.store_id = v_store_id
      and p.deleted_at is null;

    return jsonb_build_object(
        'total_profiles', v_total,
        'active_profiles', v_active,
        'inactive_profiles', v_inactive,
        'active_owners', v_owners,
        'active_admins', v_admins,
        'active_cashiers', v_cashiers,
        'last_owner_safe', (v_owners >= 1)
    );
end;
$$;

revoke all on function public.ldm_account_health()
from public, anon;
grant execute on function public.ldm_account_health()
to authenticated;

-- ------------------------------------------------
-- Realtime profiles
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
          and tablename = 'profiles'
    ) then
        alter publication supabase_realtime
        add table public.profiles;
    end if;
end
$$;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta (key, value)
values
    ('live_sync_stage', '14'),
    ('schema_version', '14'),
    ('schema_status', 'cloud_account_management_ready'),
    ('account_authority', 'auth.users + public.profiles'),
    ('account_management_mode', 'owner_rpc_existing_auth_link'),
    ('account_password_mode', 'self_update_or_recovery_email'),
    ('legacy_account_store', 'compatibility_cache_only'),
    ('account_realtime', 'profiles_enabled'),
    ('shift_management', 'removed')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_version',
    'schema_status',
    'account_authority',
    'account_management_mode',
    'account_password_mode',
    'legacy_account_store',
    'account_realtime',
    'shift_management'
)
order by key;

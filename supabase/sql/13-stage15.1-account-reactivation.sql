-- ================================================================
-- LocDailyMar Live Sync - TAHAP 15.1
-- Owner-only archived account list for safe account reactivation
-- Requires Tahap 15
-- ================================================================

begin;

do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'Tabel public.profiles belum tersedia. Jalankan Tahap 4-15 terlebih dahulu.';
    end if;
    if to_regclass('public.ldm_system_meta') is null then
        raise exception 'Tabel public.ldm_system_meta belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_current_store_id()') is null
       or to_regprocedure('public.ldm_current_role()') is null then
        raise exception 'RPC context cloud belum tersedia. Jalankan fondasi Auth terlebih dahulu.';
    end if;
end
$$;

-- Hanya Owner aktif yang dapat melihat akun terarsip pada store yang sama.
-- Auth email/banned_until dibaca server-side dan tidak diberikan kepada role lain.
create or replace function public.ldm_account_archived_list()
returns table (
    user_id uuid,
    email text,
    username text,
    display_name text,
    role text,
    active boolean,
    deleted_at timestamptz,
    deleted_by uuid,
    auth_created_at timestamptz,
    last_sign_in_at timestamptz,
    banned_until timestamptz,
    is_banned boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
stable
as $$
declare
    v_store_id uuid;
begin
    v_store_id := public.ldm_current_store_id();

    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat melihat akun dinonaktifkan.';
    end if;

    return query
    select
        p.id,
        u.email::text,
        p.username,
        p.display_name,
        p.role,
        p.active,
        p.deleted_at,
        p.deleted_by,
        u.created_at,
        u.last_sign_in_at,
        u.banned_until,
        coalesce(u.banned_until > now(), false)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.store_id = v_store_id
      and p.deleted_at is not null
    order by p.deleted_at desc, lower(p.username), p.id;
end;
$$;

revoke all on function public.ldm_account_archived_list() from public, anon;
grant execute on function public.ldm_account_archived_list() to authenticated;

insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','15.1'),
    ('schema_version','15.1'),
    ('schema_status','account_reactivation_ready'),
    ('cloud_account_reactivation','owner_edge_function_only')
on conflict(key) do update
set value=excluded.value, updated_at=now();

commit;


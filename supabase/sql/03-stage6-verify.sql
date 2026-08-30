-- ================================================================
-- LocDailyMar - Tahap 6 Verification
-- ================================================================

-- 1. Metadata
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'auth_mode',
    'main_login_mode',
    'role_authority',
    'local_role_mode'
)
order by key;

-- 2. Semua Auth user dan profile
select
    u.id as auth_user_id,
    u.email,
    p.username,
    p.role,
    p.active,
    s.code as store_code,
    s.name as store_name
from auth.users u
left join public.profiles p
  on p.id = u.id
left join public.stores s
  on s.id = p.store_id
order by u.created_at;

-- 3. Auth user yang BELUM punya profile.
select
    u.id,
    u.email,
    u.created_at
from auth.users u
left join public.profiles p
  on p.id = u.id
where p.id is null
order by u.created_at;

-- 4. Active Owner wajib minimal satu.
select
    count(*) as active_owner_count
from public.profiles
where role = 'owner'
  and active = true
  and deleted_at is null;

-- 5. Role yang tidak valid harus nol.
select
    count(*) as invalid_role_count
from public.profiles
where role not in (
    'owner',
    'admin',
    'kasir'
);

-- 6. Devices yang sudah terdaftar.
select
    d.id,
    d.client_device_id,
    d.device_name,
    d.status,
    d.last_seen_at,
    p.username,
    p.role
from public.devices d
left join public.profiles p
  on p.id = d.user_id
where d.deleted_at is null
order by d.last_seen_at desc;

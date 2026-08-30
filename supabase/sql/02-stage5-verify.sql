-- ================================================================
-- LocDailyMar - Tahap 5 Verification
-- ================================================================

-- 1. Metadata
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

-- 2. Auth users yang sudah mempunyai profile
select
    u.id as auth_user_id,
    u.email,
    u.created_at as auth_created_at,
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

-- 3. Harus ada minimal satu Owner setelah bootstrap.
select
    count(*) as active_owner_count
from public.profiles
where role = 'owner'
  and active = true
  and deleted_at is null;

-- 4. Device boleh masih 0 sebelum browser test.
select
    count(*) as device_count
from public.devices
where deleted_at is null;

-- 5. Function Tahap 5
select
    routine_name,
    routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'ldm_my_context',
      'ldm_register_device',
      'ldm_my_devices'
  )
order by routine_name;

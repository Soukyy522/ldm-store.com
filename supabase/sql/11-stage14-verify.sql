-- ================================================================
-- LocDailyMar - Tahap 14 VERIFY
-- Cloud Account Management
-- ================================================================

-- 1. Metadata
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

-- 2. Profiles RLS harus true
select schemaname,tablename,rowsecurity
from pg_tables
where schemaname='public'
  and tablename='profiles';

-- 3. RPC Tahap 14 harus tersedia
select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
      'ldm_account_list',
      'ldm_account_link_existing_auth',
      'ldm_account_update_profile',
      'ldm_account_health'
  )
order by p.proname;

-- 4. Realtime profiles
select pubname,schemaname,tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename='profiles';

-- 5. Profile aktif dan Auth User
select
    s.code as store_code,
    u.email,
    p.id,
    p.username,
    p.display_name,
    p.role,
    p.active,
    p.deleted_at,
    u.email_confirmed_at,
    u.last_sign_in_at
from public.profiles p
join auth.users u on u.id=p.id
join public.stores s on s.id=p.store_id
order by s.code,p.role,p.username;

-- 6. Username duplicate dalam store. Ideal = 0 rows.
select
    p.store_id,
    lower(btrim(p.username)) as normalized_username,
    count(*) as duplicate_count
from public.profiles p
where p.deleted_at is null
group by p.store_id,lower(btrim(p.username))
having count(*) > 1;

-- 7. Store tanpa Owner aktif. Ideal = 0 rows.
select s.id,s.code,s.name
from public.stores s
where s.deleted_at is null
  and s.status='active'
  and not exists (
      select 1
      from public.profiles p
      where p.store_id=s.id
        and p.role='owner'
        and p.active=true
        and p.deleted_at is null
  );

-- 8. Profile orphan Auth seharusnya mustahil karena FK. Ideal = 0 rows.
select p.id,p.username
from public.profiles p
left join auth.users u on u.id=p.id
where u.id is null;

-- 9. Audit trigger profiles dari Tahap 13 harus tetap ada
select
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation
from information_schema.triggers
where event_object_schema='public'
  and event_object_table='profiles'
order by trigger_name,event_manipulation;

-- 10. Browser test:
-- Login Owner -> buka account-management.html
-- Status ideal: Account Health aman dan daftar akun muncul.

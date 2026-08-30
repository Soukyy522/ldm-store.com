-- LocDailyMar - Tahap 4 Verification
-- Aman dijalankan setelah 01-stage4-cloud-foundation.sql.

-- 1. Tabel foundation
select
    schemaname,
    tablename,
    rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
      'stores',
      'profiles',
      'devices',
      'ldm_system_meta'
  )
order by tablename;

-- 2. Policies
select
    schemaname,
    tablename,
    policyname,
    roles,
    cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
      'stores',
      'profiles',
      'devices',
      'ldm_system_meta'
  )
order by tablename, policyname;

-- 3. Default store
select
    id,
    code,
    name,
    timezone,
    currency,
    status,
    created_at,
    updated_at,
    version
from public.stores
where code = 'LDM-DEFAULT';

-- 4. Metadata version
select *
from public.ldm_system_meta
order by key;

-- 5. Profiles masih boleh kosong pada Tahap 4.
select count(*) as profile_count
from public.profiles;

-- 6. Devices masih boleh kosong pada Tahap 4.
select count(*) as device_count
from public.devices;

-- LocDailyMar TAHAP 15.1 VERIFY (read-only)

select key,value,updated_at
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_version',
    'schema_status',
    'cloud_account_reactivation'
)
order by key;

select
    n.nspname as schema_name,
    p.proname as routine_name,
    pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='ldm_account_archived_list';

-- Harus 0: profile terarsip yang Auth User-nya sudah tidak ada tidak dapat direaktivasi.
select count(*) as archived_profiles_without_auth_user
from public.profiles p
left join auth.users u on u.id=p.id
where p.deleted_at is not null
  and u.id is null;

-- Harus 0: username akun terarsip bentrok dengan akun aktif pada store yang sama.
-- Jika ada hasil, ubah salah satu username sebelum menekan Aktifkan Kembali.
select
    archived.store_id,
    archived.id as archived_user_id,
    archived.username as archived_username,
    active.id as active_user_id,
    active.username as active_username
from public.profiles archived
join public.profiles active
  on active.store_id=archived.store_id
 and active.id<>archived.id
 and lower(active.username)=lower(archived.username)
 and active.deleted_at is null
where archived.deleted_at is not null
order by archived.store_id, lower(archived.username);


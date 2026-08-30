-- LocDailyMar TAHAP 15 VERIFY
select key,value from public.ldm_system_meta
where key in ('live_sync_stage','schema_status','device_access_mode','device_management_role','cloud_account_page_access','cloud_account_write_role','cloud_account_create_delete')
order by key;

select schemaname,tablename,rowsecurity
from pg_tables
where schemaname='public' and tablename in ('devices','device_groups')
order by tablename;

select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'ldm_current_device_access','ldm_device_owner_list','ldm_device_group_list',
    'ldm_device_group_create','ldm_device_group_delete','ldm_device_approve',
    'ldm_device_revoke','ldm_account_list','ldm_account_health','ldm_account_delete_safety'
  )
order by routine_name;

select d.id,d.client_device_id,d.device_name,d.status,p.username,p.role,
       g.name as group_name,d.last_seen_at
from public.devices d
left join public.profiles p on p.id=d.user_id
left join public.device_groups g on g.id=d.group_id and g.deleted_at is null
where d.deleted_at is null
order by d.last_seen_at desc;

select id,name,active,created_at
from public.device_groups
where deleted_at is null
order by name;

select pubname,schemaname,tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename in ('profiles','devices','device_groups')
order by tablename;

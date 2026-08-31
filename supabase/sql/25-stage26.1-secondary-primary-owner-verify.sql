-- LocDailyMar 26.1 - Verifikasi Dua Owner Pusat

select
    exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='store_networks'
          and column_name='secondary_primary_owner_user_id'
    ) as secondary_uuid_column_ok,
    exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='store_networks'
          and column_name='secondary_primary_owner_enabled'
    ) as secondary_enabled_column_ok,
    to_regprocedure('public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)') is not null
        as developer_function_ok,
    to_regprocedure('public.ldm_can_manage_central_catalog()') is not null
        as catalog_authority_ok;

select
    n.id as network_id,
    n.code as network_code,
    n.name as network_name,
    n.primary_owner_user_id,
    u1.email as primary_owner_email,
    n.secondary_primary_owner_user_id,
    u2.email as secondary_owner_email,
    n.secondary_primary_owner_enabled
from public.store_networks n
left join auth.users u1 on u1.id=n.primary_owner_user_id
left join auth.users u2 on u2.id=n.secondary_primary_owner_user_id
where n.deleted_at is null
order by n.created_at;

select key,value
from public.ldm_system_meta
where key in ('secondary_primary_owner','primary_owner_max_count','schema_version')
order by key;

select
    not has_function_privilege(
        'authenticated',
        'public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)',
        'EXECUTE'
    ) as browser_cannot_manage_secondary,
    has_function_privilege(
        'service_role',
        'public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)',
        'EXECUTE'
    ) as service_role_can_manage_secondary;

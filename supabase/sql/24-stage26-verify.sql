-- LocDailyMar 26.0 - Pemeriksaan Katalog Pusat
-- Jalankan setelah 24-stage26-central-product-catalog-sync.sql.

select
    to_regclass('public.product_catalog_sync_settings') is not null as settings_table_ok,
    to_regclass('public.product_catalog_links') is not null as links_table_ok,
    to_regprocedure('public.ldm_can_manage_central_catalog()') is not null as authority_rpc_ok,
    to_regprocedure('public.ldm_primary_owner_catalog_status()') is not null as status_rpc_ok,
    to_regprocedure('public.ldm_primary_owner_sync_catalog(uuid,boolean)') is not null as branch_sync_rpc_ok,
    to_regprocedure('public.ldm_primary_owner_sync_all_catalog(boolean)') is not null as all_sync_rpc_ok,
    to_regprocedure('public.ldm_primary_owner_set_catalog_sync(uuid,boolean)') is not null as auto_sync_rpc_ok;

select
    exists(
        select 1 from pg_trigger
        where tgname='trg_stage26_central_catalog_guard' and not tgisinternal
    ) as catalog_guard_trigger_ok,
    exists(
        select 1 from pg_trigger
        where tgname='trg_stage26_catalog_auto_update' and not tgisinternal
    ) as auto_update_trigger_ok,
    exists(
        select 1 from pg_trigger
        where tgname='trg_stage26_catalog_auto_insert_delete' and not tgisinternal
    ) as auto_insert_delete_trigger_ok;

select key,value
from public.ldm_system_meta
where key in (
    'central_product_catalog',
    'central_product_catalog_stock_scope',
    'schema_version'
)
order by key;

select
    has_function_privilege('authenticated','public.ldm_primary_owner_catalog_status()','EXECUTE') as status_allowed,
    has_function_privilege('authenticated','public.ldm_primary_owner_sync_catalog(uuid,boolean)','EXECUTE') as sync_allowed,
    not has_function_privilege('authenticated','public.ldm_sync_catalog_store_internal(uuid,uuid,uuid,uuid)','EXECUTE') as internal_sync_closed,
    not has_table_privilege('authenticated','public.products','INSERT') as direct_insert_closed,
    not has_table_privilege('authenticated','public.products','UPDATE') as direct_update_closed,
    not has_table_privilege('authenticated','public.products','DELETE') as direct_delete_closed;

select
    s.code as store_code,
    s.name as store_name,
    sns.is_primary,
    coalesce(cs.enabled,false) as auto_sync,
    cs.last_synced_at,
    coalesce((cs.last_result->>'processed')::integer,0) as last_processed
from public.store_network_stores sns
join public.stores s on s.id=sns.store_id
left join public.product_catalog_sync_settings cs
  on cs.network_id=sns.network_id and cs.store_id=sns.store_id
where sns.active=true
order by sns.network_id,sns.is_primary desc,lower(s.name);

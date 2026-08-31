-- LocDailyMar 26.3.0 VERIFY - read only
select
    to_regclass('public.store_branch_management_audit') is not null as branch_audit_ok,
    to_regprocedure('public.ldm_manageable_network_branches()') is not null as branch_list_rpc_ok,
    to_regprocedure('public.ldm_manage_branch(uuid,text,text,text,text)') is not null as branch_manage_rpc_ok,
    to_regprocedure('public.ldm_account_set_active(uuid,boolean)') is not null as account_set_active_rpc_ok,
    to_regprocedure('public.ldm_create_branch_store(text,text,boolean)') is not null as create_branch_rpc_ok;

select key,value,updated_at
from public.ldm_system_meta
where key in ('app_schema_patch','branch_management','account_reactivation_transport')
order by key;

-- Jalankan saat login sebagai Owner Utama untuk melihat status cabang.
select * from public.ldm_manageable_network_branches();

-- Transfer yang akan memblokir Nonaktifkan/Hapus Cabang.
select st.id,st.transfer_code,st.status,st.source_store_id,st.destination_store_id
from public.stock_transfers st
where st.status in ('DRAFT','IN_TRANSIT')
order by st.created_at desc;

-- Verifikasi LocDailyMar 25.0 - jalankan pada Supabase CLOUD APLIKASI
select
    to_regprocedure('public.ldm_is_primary_owner()') is not null as primary_check_ok,
    to_regprocedure('public.ldm_primary_owner_context()') is not null as context_ok,
    to_regprocedure('public.ldm_primary_owner_network_report(uuid,date,date,integer)') is not null as report_ok,
    to_regprocedure('public.ldm_primary_owner_accounts()') is not null as accounts_ok,
    to_regprocedure('public.ldm_primary_owner_update_account(uuid,uuid,text,text,text,boolean)') is not null as account_update_ok,
    to_regprocedure('public.ldm_visible_products()') is not null as product_mask_ok,
    to_regprocedure('public.ldm_visible_procurement()') is not null as procurement_mask_ok,
    to_regprocedure('public.ldm_visible_stock_opname()') is not null as opname_mask_ok,
    to_regprocedure('public.ldm_visible_transaction_items()') is not null as hpp_mask_ok,
    to_regprocedure('public.ldm_visible_stock_movements(text[],integer)') is not null as stock_cost_mask_ok,
    to_regprocedure('public.ldm_transfer_employee(uuid,uuid,text)') is not null as employee_transfer_ok,
    exists(
        select 1 from pg_trigger
        where tgname='trg_primary_owner_network_structure' and not tgisinternal
    ) as network_guard_ok;

select n.code network_code,n.name network_name,n.primary_owner_user_id,
       s.code primary_store_code,s.name primary_store_name,p.username primary_owner_username
from public.store_networks n
left join public.store_network_stores sns
  on sns.network_id=n.id and sns.is_primary=true and sns.active=true
left join public.stores s on s.id=sns.store_id
left join public.profiles p on p.id=n.primary_owner_user_id
where n.deleted_at is null
order by n.created_at;

-- Jalankan saat login sebagai akun Owner Utama.
select * from public.ldm_primary_owner_context();
select public.ldm_is_primary_owner() as akun_ini_owner_utama;

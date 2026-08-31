-- LocDailyMar 25.2 - Verifikasi akses role dan penyamaran procurement

select key,value,updated_at
from public.ldm_system_meta
where key='role_access_procurement_mask';

select
    p.proname as function_name,
    pg_get_userbyid(p.proowner) as owner_name,
    p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
      'ldm_complete_sale',
      'ldm_visible_products',
      'ldm_visible_procurement',
      'ldm_save_purchase_order_role_safe',
      'ldm_submit_goods_receipt_role_safe'
  )
order by p.proname;

select
    has_function_privilege(
        'authenticated',
        'public.ldm_save_purchase_order_role_safe(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)',
        'EXECUTE'
    ) as safe_po_execute,
    has_function_privilege(
        'authenticated',
        'public.ldm_submit_goods_receipt_role_safe(uuid,text,date,uuid,text,uuid,text,jsonb)',
        'EXECUTE'
    ) as safe_gr_execute,
    has_function_privilege(
        'authenticated',
        'public.ldm_save_purchase_order(uuid,uuid,text,date,date,uuid,text,text,text,text,jsonb)',
        'EXECUTE'
    ) as legacy_po_execute_must_be_false,
    has_function_privilege(
        'authenticated',
        'public.ldm_submit_goods_receipt(uuid,text,date,uuid,text,uuid,text,jsonb)',
        'EXECUTE'
    ) as legacy_gr_execute_must_be_false,
    has_table_privilege('authenticated','public.products','SELECT')
        as direct_products_select_must_be_false;


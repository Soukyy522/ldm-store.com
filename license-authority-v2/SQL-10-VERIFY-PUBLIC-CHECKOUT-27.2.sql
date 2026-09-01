
-- LocDailyMar 27.2.0 VERIFY
-- Jalankan pada Supabase PROJECT LICENSE AUTHORITY V2.

select
  to_regclass('public.ldm2_checkout_deliveries') is not null as checkout_delivery_table_ok,
  to_regclass('public.ldm2_checkout_attempts') is not null as checkout_rate_table_ok,
  to_regprocedure('public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text)') is not null
    as create_purchase_order_rpc_ok,
  to_regprocedure('public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)') is not null
    as midtrans_apply_rpc_ok,
  to_regprocedure('public.ldm2_create_retry_purchase_order(text,uuid,text,bigint)') is not null
    as retry_purchase_rpc_ok;

select
  p.order_id,p.status as payment_status,p.provider_status,
  l.customer_email,l.customer_phone,l.plan_code,l.status as license_status,
  l.primary_store_code,l.primary_store_id,l.network_id,
  d.email_status,d.whatsapp_status,d.provision_status,
  d.email_attempts,d.whatsapp_attempts,d.completed_at,d.last_attempt_at
from public.ldm2_checkout_deliveries d
join public.ldm2_payments p on p.id=d.payment_id
join public.ldm2_licenses l on l.id=d.license_id
order by d.created_at desc
limit 50;

select event_type,detail,created_at
from public.ldm2_events
where event_type in ('SYSTEM_PATCH','CUSTOMER_DELIVERY_UPDATED')
order by created_at desc
limit 50;

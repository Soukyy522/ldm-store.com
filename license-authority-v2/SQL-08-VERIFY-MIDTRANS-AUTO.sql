-- Jalankan pada project Supabase KHUSUS LISENSI.

select
    count(*) as total_payment,
    count(*) filter(where status='pending') as pending,
    count(*) filter(where status='paid') as paid,
    count(*) filter(where status in ('failed','expired','cancelled')) as tidak_berhasil,
    count(*) filter(where status='paid' and processed_at is null) as paid_belum_diproses
from public.ldm2_payments;

select
    p.order_id,p.payment_type,p.billing_cycle,p.amount,p.status,
    p.provider_status,p.fraud_status,p.paid_at,p.processed_at,
    l.customer_name,l.primary_store_code,l.primary_store_id,l.network_id,
    l.plan_code,l.status as license_status,l.expires_at
from public.ldm2_payments p
join public.ldm2_licenses l on l.id=p.license_id
order by p.created_at desc;

select
    count(*) filter(where primary_store_id is null) as store_id_kosong,
    count(*) filter(where nullif(btrim(primary_store_code),'') is null) as store_code_kosong,
    count(*) filter(where network_id is null) as network_id_kosong
from public.ldm2_licenses;

select event_type,license_id,detail,created_at
from public.ldm2_events
where event_type in (
    'PAYMENT_ORDER_CREATED','PAYMENT_STATUS_UPDATED','PAYMENT_AMOUNT_MISMATCH',
    'LICENSE_ACTIVATED_BY_PAYMENT','LICENSE_RENEWED_BY_PAYMENT','LICENSE_CONVERTED_BY_PAYMENT'
)
order by created_at desc
limit 100;

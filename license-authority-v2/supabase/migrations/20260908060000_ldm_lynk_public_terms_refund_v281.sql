-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06
-- SQL-16-LYNK-PUBLIC-TERMS-REFUND-V28.1.sql
-- Refund policy aligned to public LYNK.ID Terms & Conditions.
-- Source: https://www.lynk.id/terms
-- Basis checked: 2026-09-08
--
-- IMPORTANT
-- * This migration does NOT call a Lynk refund API.
-- * Public customer requests are internal LocDailyMar RFD records.
-- * Actual refund is recorded only after it is genuinely processed through Lynk.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.ldm2_refund_policy') is null
     or to_regclass('public.ldm2_refund_requests') is null
     or to_regclass('public.ldm2_refunds') is null then
    raise exception 'Jalankan SQL-15 V28 terlebih dahulu sebelum SQL-16 V28.1.';
  end if;
end $$;

alter table public.ldm2_refund_policy
  add column if not exists refund_window_hours integer not null default 24,
  add column if not exists policy_basis text not null default 'lynk_public_terms',
  add column if not exists policy_source_url text not null default 'https://www.lynk.id/terms',
  add column if not exists only_non_delivery boolean not null default true,
  add column if not exists exclude_transaction_fees boolean not null default true,
  add column if not exists creator_confirmation_hours integer not null default 24;

update public.ldm2_refund_policy
set enabled=true,
    refund_window_days=1,
    refund_window_hours=24,
    allow_partial_refund=false,
    min_reason_length=20,
    policy_version='lynk-public-terms-2026-09-08-v1',
    policy_basis='lynk_public_terms',
    policy_source_url='https://www.lynk.id/terms',
    only_non_delivery=true,
    exclude_transaction_fees=true,
    creator_confirmation_hours=24,
    policy_summary='Refund kepada LYNK.ID dapat diajukan paling lambat 24 jam setelah pembayaran dan hanya karena produk/layanan dari Kreator belum diterima. Jika disetujui, biaya transaksi, jasa platform, dan pajak dapat tidak termasuk. Klaim setelah 24 jam atau ketidaksesuaian layanan ditujukan langsung kepada Kreator.',
    updated_at=now(),
    updated_by='SQL-16-LYNK-PUBLIC-TERMS-REFUND-V28.1'
where id=1;

alter table public.ldm2_refund_requests
  add column if not exists policy_route text,
  add column if not exists terms_source_url text,
  add column if not exists claim_basis text;

alter table public.ldm2_refund_requests
  drop constraint if exists ldm2_refund_requests_reason_category_check;

alter table public.ldm2_refund_requests
  add constraint ldm2_refund_requests_reason_category_check check (reason_category in (
    'not_delivered',
    'duplicate_payment','wrong_plan','wrong_period','provisioning_issue',
    'technical_issue','service_issue','changed_mind','other'
  ));

create or replace function public.ldm2_get_refund_policy()
returns jsonb
language plpgsql
security definer
set search_path=''
stable
as $$
declare v_policy public.ldm2_refund_policy%rowtype;
begin
  select * into v_policy from public.ldm2_refund_policy where id=1;
  if not found then
    return jsonb_build_object(
      'enabled',true,'refund_window_days',1,'refund_window_hours',24,
      'allow_partial_refund',false,'min_reason_length',20,
      'policy_version','lynk-public-terms-fallback','policy_basis','lynk_public_terms',
      'policy_source_url','https://www.lynk.id/terms','only_non_delivery',true,
      'exclude_transaction_fees',true,'creator_confirmation_hours',24
    );
  end if;
  return jsonb_build_object(
    'enabled',v_policy.enabled,
    'refund_window_days',v_policy.refund_window_days,
    'refund_window_hours',v_policy.refund_window_hours,
    'allow_partial_refund',false,
    'min_reason_length',v_policy.min_reason_length,
    'policy_version',v_policy.policy_version,
    'policy_summary',v_policy.policy_summary,
    'policy_basis',v_policy.policy_basis,
    'policy_source_url',v_policy.policy_source_url,
    'only_non_delivery',v_policy.only_non_delivery,
    'exclude_transaction_fees',v_policy.exclude_transaction_fees,
    'creator_confirmation_hours',v_policy.creator_confirmation_hours,
    'updated_at',v_policy.updated_at
  );
end;
$$;

create or replace function public.ldm2_refund_eligibility(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
stable
as $$
declare
  v_payment public.ldm2_payments%rowtype;
  v_policy public.ldm2_refund_policy%rowtype;
  v_committed bigint := 0;
  v_remaining bigint := 0;
  v_deadline timestamptz;
  v_eligible boolean := false;
  v_reason text := null;
  v_delivery_status text := null;
  v_delivery_completed timestamptz := null;
  v_delivery_evidence boolean := false;
begin
  select * into v_payment from public.ldm2_payments where id=p_payment_id;
  if not found then
    return jsonb_build_object('ok',false,'eligible',false,'code','PAYMENT_NOT_FOUND','message','Pembayaran tidak ditemukan.');
  end if;
  select * into v_policy from public.ldm2_refund_policy where id=1;
  if not found then raise exception 'Kebijakan refund belum tersedia.'; end if;

  select d.provision_status,d.completed_at
    into v_delivery_status,v_delivery_completed
  from public.ldm2_checkout_deliveries d
  where d.payment_id=v_payment.id
  order by d.created_at desc limit 1;
  v_delivery_evidence := coalesce(v_delivery_status='ready',false) or v_delivery_completed is not null;

  select coalesce(sum(amount),0)::bigint into v_committed
  from public.ldm2_refunds
  where payment_id=v_payment.id and status in ('requested','accepted','completed','unknown');

  v_remaining := greatest(v_payment.amount-v_committed,0);
  v_deadline := case when v_payment.paid_at is not null
    then v_payment.paid_at + make_interval(hours=>coalesce(v_policy.refund_window_hours,24))
    else null end;

  if not v_policy.enabled then
    v_reason := 'Refund sedang dinonaktifkan.';
  elsif lower(coalesce(v_payment.provider,'')) <> 'lynk' then
    v_reason := 'Kebijakan ini hanya untuk transaksi LYNK.ID.';
  elsif v_payment.status not in ('paid','partially_refunded') then
    v_reason := format('Status pembayaran %s tidak memenuhi jalur refund LYNK.ID.',coalesce(v_payment.status,'-'));
  elsif v_payment.paid_at is null then
    v_reason := 'Waktu pembayaran terverifikasi tidak tersedia.';
  elsif now() > v_deadline then
    v_reason := 'Batas pengajuan refund kepada LYNK.ID sudah lewat 24 jam. Klaim setelah 24 jam harus disampaikan langsung kepada LocDailyMar sebagai Kreator.';
  elsif v_remaining <= 0 then
    v_reason := 'Tidak ada nominal transaksi yang tersisa untuk dicatat sebagai refund.';
  else
    v_eligible := true;
  end if;

  return jsonb_build_object(
    'ok',true,'eligible',v_eligible,'reason',v_reason,
    'payment_id',v_payment.id,'order_id',v_payment.order_id,
    'payment_status',v_payment.status,'provider_status',v_payment.provider_status,
    'amount',v_payment.amount,'paid_at',v_payment.paid_at,
    'refund_deadline',v_deadline,'refund_window_days',1,'refund_window_hours',24,
    'allow_partial_refund',false,'min_reason_length',v_policy.min_reason_length,
    'already_refunded_or_reserved',v_committed,'remaining_refundable',v_remaining,
    'policy_version',v_policy.policy_version,'policy_basis','lynk_public_terms',
    'policy_source_url','https://www.lynk.id/terms','only_non_delivery',true,
    'required_reason_category','not_delivered','exclude_transaction_fees',true,
    'creator_confirmation_hours',24,
    'delivery_provision_status',v_delivery_status,
    'delivery_completed_at',v_delivery_completed,
    'delivery_evidence_available',v_delivery_evidence,
    'after_window_route','creator_direct',
    'mismatch_route','creator_direct'
  );
end;
$$;

create or replace function public.ldm2_create_customer_refund_request(
  p_payment_id uuid,p_request_code text,p_refund_type text,p_requested_amount bigint,
  p_reason_category text,p_reason_detail text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.ldm2_payments%rowtype;
  v_license public.ldm2_licenses%rowtype;
  v_elig jsonb;
  v_request public.ldm2_refund_requests%rowtype;
  v_detail text := btrim(coalesce(p_reason_detail,''));
  v_remaining bigint;
begin
  select * into v_payment from public.ldm2_payments where id=p_payment_id for update;
  if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;
  select * into v_license from public.ldm2_licenses where id=v_payment.license_id;
  if not found then raise exception 'Lisensi pembayaran tidak ditemukan.'; end if;

  v_elig := public.ldm2_refund_eligibility(v_payment.id);
  if coalesce((v_elig->>'eligible')::boolean,false) is not true then
    raise exception '%',coalesce(v_elig->>'reason','Pembayaran tidak memenuhi ketentuan refund LYNK.ID.');
  end if;
  if lower(btrim(coalesce(p_refund_type,''))) <> 'full' then
    raise exception 'Ketentuan publik LYNK.ID pada mode ini hanya menggunakan refund pembelian penuh.';
  end if;
  if lower(btrim(coalesce(p_reason_category,''))) <> 'not_delivered' then
    raise exception 'Refund kepada LYNK.ID hanya dapat diajukan dengan dasar produk/layanan belum diterima.';
  end if;
  if length(v_detail)<20 then raise exception 'Jelaskan produk/layanan yang belum diterima minimal 20 karakter.'; end if;
  if length(v_detail)>1500 then raise exception 'Penjelasan refund maksimal 1500 karakter.'; end if;

  v_remaining := coalesce((v_elig->>'remaining_refundable')::bigint,0);
  if v_remaining<=0 then raise exception 'Tidak ada nilai transaksi yang dapat diajukan.'; end if;

  if exists(select 1 from public.ldm2_refund_requests where payment_id=v_payment.id
            and status in ('submitted','reviewing','waiting_customer','approved','processing')) then
    raise exception 'Masih ada permintaan refund aktif untuk pembayaran ini.';
  end if;

  insert into public.ldm2_refund_requests(
    request_code,payment_id,license_id,order_id,refund_type,requested_amount,
    reason_category,reason_detail,requester_name,requester_email,requester_phone,
    status,policy_version,refund_deadline,eligibility_snapshot,
    policy_route,terms_source_url,claim_basis
  ) values (
    upper(btrim(p_request_code)),v_payment.id,v_payment.license_id,v_payment.order_id,
    'full',v_remaining,'not_delivered',v_detail,
    v_license.customer_name,v_license.customer_email,v_license.customer_phone,
    'submitted',v_elig->>'policy_version',(v_elig->>'refund_deadline')::timestamptz,v_elig,
    'lynk_platform_24h','https://www.lynk.id/terms','non_delivery'
  ) returning * into v_request;

  return jsonb_build_object(
    'ok',true,'request_code',v_request.request_code,'status',v_request.status,
    'order_id',v_request.order_id,'refund_type','full','requested_amount',v_request.requested_amount,
    'refund_deadline',v_request.refund_deadline,'created_at',v_request.created_at,
    'policy_route','lynk_platform_24h','terms_source_url','https://www.lynk.id/terms'
  );
end;
$$;

-- Developer ledger records ACTUAL amount that Lynk really returned.
-- For a full-purchase refund, actual amount can be lower than payment amount
-- because transaction/platform fees and taxes may be excluded by Lynk terms.
create or replace function public.ldm2_prepare_refund(
  p_payment_id uuid,p_refund_key text,p_refund_type text,p_amount bigint,p_reason text,
  p_admin_user_id uuid,p_admin_email text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.ldm2_payments%rowtype;
  v_committed bigint:=0; v_remaining bigint:=0; v_amount bigint;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_refund public.ldm2_refunds%rowtype;
begin
  select * into v_payment from public.ldm2_payments where id=p_payment_id for update;
  if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;
  if v_payment.status not in ('paid','partially_refunded') then raise exception 'Payment tidak berada pada status yang dapat dicatat refund.'; end if;
  if lower(btrim(coalesce(p_refund_type,'')))<>'full' then raise exception 'Mode LYNK.ID public terms hanya mencatat refund pembelian penuh.'; end if;
  if length(v_reason)<20 then raise exception 'Catatan proses refund minimal 20 karakter.'; end if;
  if length(v_reason)>255 then raise exception 'Catatan refund maksimal 255 karakter.'; end if;

  select coalesce(sum(amount),0)::bigint into v_committed from public.ldm2_refunds
  where payment_id=v_payment.id and status in ('requested','accepted','completed','unknown');
  v_remaining:=greatest(v_payment.amount-v_committed,0);
  v_amount:=p_amount;
  if v_amount is null or v_amount<=0 then raise exception 'Nominal aktual refund harus lebih dari 0.'; end if;
  if v_amount>v_payment.amount then raise exception 'Nominal aktual refund tidak boleh melebihi nilai transaksi.'; end if;

  insert into public.ldm2_refunds(payment_id,license_id,order_id,refund_key,refund_type,amount,reason,status,requested_by_user_id,requested_by_email)
  values(v_payment.id,v_payment.license_id,v_payment.order_id,left(btrim(p_refund_key),120),'full',v_amount,left(v_reason,255),'requested',p_admin_user_id,left(lower(btrim(coalesce(p_admin_email,''))),180))
  returning * into v_refund;

  return jsonb_build_object('ok',true,'refund_id',v_refund.id,'refund_key',v_refund.refund_key,
    'refund_type','full','amount',v_refund.amount,'order_id',v_payment.order_id,'payment_id',v_payment.id,
    'license_id',v_payment.license_id,'actual_amount_mode',true,'fees_and_taxes_may_be_excluded',true);
end;
$$;

create or replace function public.ldm2_finish_refund(
  p_refund_key text,p_success boolean,p_provider_status text,p_provider_transaction_id text,
  p_provider_response jsonb,p_error text default null,p_unknown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_refund public.ldm2_refunds%rowtype;
  v_payment public.ldm2_payments%rowtype;
  v_total bigint:=0; v_new_status text;
begin
  select * into v_refund from public.ldm2_refunds where refund_key=btrim(p_refund_key) for update;
  if not found then raise exception 'Refund key tidak ditemukan.'; end if;
  select * into v_payment from public.ldm2_payments where id=v_refund.payment_id for update;
  if not found then raise exception 'Payment refund tidak ditemukan.'; end if;

  if p_unknown then
    update public.ldm2_refunds set status='unknown',provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
      provider_transaction_id=nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),
      provider_response=coalesce(p_provider_response,'{}'::jsonb),error_message=left(coalesce(p_error,'Status refund belum dapat dipastikan.'),1000),updated_at=now()
    where id=v_refund.id;
    return jsonb_build_object('ok',true,'status','unknown','refund_key',v_refund.refund_key);
  end if;
  if not p_success then
    update public.ldm2_refunds set status='failed',provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
      provider_transaction_id=nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),
      provider_response=coalesce(p_provider_response,'{}'::jsonb),error_message=left(coalesce(p_error,'Refund ditolak/tidak berhasil.'),1000),failed_at=now(),updated_at=now()
    where id=v_refund.id;
    return jsonb_build_object('ok',true,'status','failed','refund_key',v_refund.refund_key);
  end if;

  update public.ldm2_refunds set status='accepted',provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
    provider_transaction_id=coalesce(nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),provider_transaction_id),
    provider_response=coalesce(p_provider_response,'{}'::jsonb),error_message=null,accepted_at=coalesce(accepted_at,now()),updated_at=now()
  where id=v_refund.id;

  select coalesce(sum(amount),0)::bigint into v_total from public.ldm2_refunds
  where payment_id=v_payment.id and status in ('accepted','completed');

  -- A LYNK full-purchase refund is considered REFUNDED even when actual cash
  -- returned is lower than gross payment because platform fees/taxes may be excluded.
  v_new_status := case when v_refund.refund_type='full' then 'refunded'
                       when v_total>=v_payment.amount then 'refunded' else 'partially_refunded' end;

  update public.ldm2_payments
  set refund_amount=least(v_total,amount),refunded_at=coalesce(refunded_at,now()),status=v_new_status,
      provider_status=coalesce(nullif(lower(btrim(coalesce(p_provider_status,''))),''),provider_status),
      provider_detail=coalesce(provider_detail,'{}'::jsonb)||jsonb_build_object(
        'last_refund_key',v_refund.refund_key,'last_refund_amount',v_refund.amount,
        'refund_total_actual',least(v_total,v_payment.amount),'refund_scope','lynk_full_purchase',
        'fees_and_taxes_may_be_excluded',true,'terms_url','https://www.lynk.id/terms',
        'refund_management','commercial-06-v28.1'),
      payment_state_version=payment_state_version+1,updated_at=now()
  where id=v_payment.id;

  insert into public.ldm2_events(license_id,event_type,detail)
  values(v_payment.license_id,'PAYMENT_REFUNDED_BY_LYNK_TERMS',jsonb_build_object(
    'order_id',v_payment.order_id,'refund_key',v_refund.refund_key,'actual_refund_amount',v_refund.amount,
    'payment_status',v_new_status,'fees_and_taxes_may_be_excluded',true));

  return jsonb_build_object('ok',true,'status','accepted','refund_key',v_refund.refund_key,
    'payment_status',v_new_status,'refund_amount',v_refund.amount,'refund_total',least(v_total,v_payment.amount),
    'remaining_refundable',case when v_new_status='refunded' then 0 else greatest(v_payment.amount-v_total,0) end);
end;
$$;

revoke all on function public.ldm2_get_refund_policy() from public,anon,authenticated;
revoke all on function public.ldm2_refund_eligibility(uuid) from public,anon,authenticated;
revoke all on function public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) from public,anon,authenticated;
revoke all on function public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean) from public,anon,authenticated;

grant execute on function public.ldm2_get_refund_policy() to service_role;
grant execute on function public.ldm2_refund_eligibility(uuid) to service_role;
grant execute on function public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text) to service_role;
grant execute on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) to service_role;
grant execute on function public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean) to service_role;

commit;

-- VERIFIER: all *_ok should be TRUE and policy values should show 24/full/non-delivery.
select
  to_regclass('public.ldm2_refund_policy') is not null as refund_policy_table_ok,
  to_regclass('public.ldm2_refund_requests') is not null as refund_requests_table_ok,
  to_regprocedure('public.ldm2_get_refund_policy()') is not null as refund_policy_rpc_ok,
  to_regprocedure('public.ldm2_refund_eligibility(uuid)') is not null as refund_eligibility_rpc_ok,
  to_regprocedure('public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text)') is not null as refund_request_rpc_ok,
  to_regprocedure('public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text)') is not null as prepare_refund_rpc_ok,
  to_regprocedure('public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean)') is not null as finish_refund_rpc_ok;

select id,enabled,refund_window_days,refund_window_hours,allow_partial_refund,min_reason_length,
       policy_version,policy_basis,policy_source_url,only_non_delivery,exclude_transaction_fees,
       creator_confirmation_hours,policy_summary,updated_at
from public.ldm2_refund_policy where id=1;

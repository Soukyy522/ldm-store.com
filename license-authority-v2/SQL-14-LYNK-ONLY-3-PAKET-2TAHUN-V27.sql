-- ============================================================================
-- LocDailyMar 27.9.0 - V27
-- LYNK.ID ONLY + 3 PAKET + PERIODE 2 TAHUN
-- Jalankan HANYA pada License Authority V2.
-- Harga 2 tahun = 2 x harga tahunan.
-- Lifetime dinonaktifkan untuk penjualan baru, tetapi data lisensi lama tidak dihapus.
-- ============================================================================

begin;


-- 0) Pastikan fondasi checkout/lisensi sudah ada.
do $$
begin
  if to_regclass('public.ldm2_plans') is null
     or to_regclass('public.ldm2_payments') is null
     or to_regclass('public.ldm2_licenses') is null
     or to_regclass('public.ldm2_checkout_deliveries') is null then
    raise exception 'Fondasi License Authority/Public Checkout belum lengkap. Pasang SQL fondasi Commercial #06 lebih dulu.';
  end if;
end
$$;

-- Inbox webhook Lynk.id. Dibuat di V27 juga agar SQL ini cukup untuk memasang
-- lapisan Lynk pada database yang sudah memiliki fondasi checkout.
create table if not exists public.ldm2_lynk_events (
  id uuid primary key default extensions.gen_random_uuid(),
  event_key text not null unique,
  payment_id uuid references public.ldm2_payments(id) on delete set null,
  license_id uuid references public.ldm2_licenses(id) on delete set null,
  matched_order_id text,
  transaction_id text,
  event_status text,
  customer_email text,
  gross_amount numeric,
  product_ref text,
  token_valid boolean not null default false,
  auto_process_enabled boolean not null default false,
  auto_match_status text,
  raw_headers jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  receive_count integer not null default 1 check (receive_count >= 1),
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  delivery_email_status text,
  delivery_email_error text
);
create index if not exists idx_ldm2_lynk_events_last_received on public.ldm2_lynk_events(last_received_at desc);
create index if not exists idx_ldm2_lynk_events_transaction on public.ldm2_lynk_events(transaction_id) where transaction_id is not null;
create index if not exists idx_ldm2_lynk_events_email_amount on public.ldm2_lynk_events(customer_email,gross_amount,last_received_at desc);
alter table public.ldm2_lynk_events enable row level security;
revoke all on public.ldm2_lynk_events from anon,authenticated;

-- 1) Lifetime tidak lagi ditawarkan untuk pembelian baru.
update public.ldm2_plans set active=false where code='LIFETIME';

-- 2) Payment baru default ke Lynk.id.
alter table public.ldm2_payments alter column provider set default 'lynk';

-- 3) Tambahkan siklus 2 tahun dan durasi 24 bulan.
alter table public.ldm2_payments drop constraint if exists ldm2_payments_billing_cycle_check;
alter table public.ldm2_payments add constraint ldm2_payments_billing_cycle_check
  check (billing_cycle in ('monthly','yearly','two_year','lifetime'));
alter table public.ldm2_payments drop constraint if exists ldm2_payments_duration_months_check;
alter table public.ldm2_payments add constraint ldm2_payments_duration_months_check
  check (duration_months in (0,1,12,24));

-- 4) Hanya Lynk.id yang boleh diset untuk order baru.
create or replace function public.ldm2_set_payment_provider(p_order_id text,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment public.ldm2_payments%rowtype;
begin
  if lower(btrim(coalesce(p_provider,''))) <> 'lynk' then raise exception 'V27 hanya mengizinkan provider Lynk.id.'; end if;
  update public.ldm2_payments set provider='lynk',error_message=null,
    provider_detail=coalesce(provider_detail,'{}'::jsonb)||jsonb_build_object('provider','lynk')
  where order_id=btrim(p_order_id) and status in ('pending','challenge','failed','expired','cancelled') and processed_at is null
  returning * into v_payment;
  if not found then raise exception 'Order pembayaran tidak ditemukan atau sudah final.'; end if;
  return jsonb_build_object('ok',true,'order_id',v_payment.order_id,'provider','lynk');
end $$;

-- 4b) Metadata checkout + inbox webhook khusus Lynk.id.
create or replace function public.ldm2_set_lynk_order(
  p_order_id text,p_checkout_url text,p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment public.ldm2_payments%rowtype;
begin
  update public.ldm2_payments
  set provider='lynk',redirect_url=nullif(btrim(coalesce(p_checkout_url,'')),''),provider_status='awaiting_lynk_payment',
      provider_detail=coalesce(provider_detail,'{}'::jsonb)||coalesce(p_provider_detail,'{}'::jsonb)
        ||jsonb_build_object('provider','lynk','checkout_url',nullif(btrim(coalesce(p_checkout_url,'')),'')),error_message=null
  where order_id=btrim(p_order_id) and processed_at is null
  returning * into v_payment;
  if not found then raise exception 'Order Lynk.id tidak ditemukan atau sudah final.'; end if;
  return jsonb_build_object('ok',true,'order_id',v_payment.order_id,'provider','lynk','status',v_payment.status);
end $$;

create or replace function public.ldm2_register_lynk_event(
  p_event_key text,p_transaction_id text,p_event_status text,p_customer_email text,p_gross_amount numeric,
  p_product_ref text,p_token_valid boolean,p_auto_process_enabled boolean,p_raw_headers jsonb,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.ldm2_lynk_events%rowtype;
begin
  insert into public.ldm2_lynk_events(event_key,transaction_id,event_status,customer_email,gross_amount,product_ref,token_valid,auto_process_enabled,raw_headers,payload)
  values(left(btrim(p_event_key),160),nullif(left(btrim(coalesce(p_transaction_id,'')),180),''),nullif(left(btrim(coalesce(p_event_status,'')),100),''),
         nullif(lower(left(btrim(coalesce(p_customer_email,'')),200)),''),p_gross_amount,nullif(left(btrim(coalesce(p_product_ref,'')),300),''),
         coalesce(p_token_valid,false),coalesce(p_auto_process_enabled,false),coalesce(p_raw_headers,'{}'::jsonb),coalesce(p_payload,'{}'::jsonb))
  on conflict(event_key) do update set
    receive_count=public.ldm2_lynk_events.receive_count+1,last_received_at=now(),
    transaction_id=coalesce(excluded.transaction_id,public.ldm2_lynk_events.transaction_id),
    event_status=coalesce(excluded.event_status,public.ldm2_lynk_events.event_status),
    customer_email=coalesce(excluded.customer_email,public.ldm2_lynk_events.customer_email),
    gross_amount=coalesce(excluded.gross_amount,public.ldm2_lynk_events.gross_amount),
    product_ref=coalesce(excluded.product_ref,public.ldm2_lynk_events.product_ref),
    token_valid=excluded.token_valid,auto_process_enabled=excluded.auto_process_enabled,raw_headers=excluded.raw_headers,payload=excluded.payload
  returning * into v_event;
  return jsonb_build_object('ok',true,'event_key',v_event.event_key,'receive_count',v_event.receive_count,'already_processed',v_event.processed_at is not null);
end $$;

create or replace function public.ldm2_finish_lynk_event(
  p_event_key text,p_order_id text default null,p_match_status text default null,p_success boolean default false,
  p_error text default null,p_delivery_email_status text default null,p_delivery_email_error text default null
)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.ldm2_lynk_events e set
    matched_order_id=nullif(btrim(coalesce(p_order_id,'')),''),
    payment_id=coalesce((select p.id from public.ldm2_payments p where p.order_id=nullif(btrim(coalesce(p_order_id,'')),'')),e.payment_id),
    license_id=coalesce((select p.license_id from public.ldm2_payments p where p.order_id=nullif(btrim(coalesce(p_order_id,'')),'')),e.license_id),
    auto_match_status=nullif(left(btrim(coalesce(p_match_status,'')),100),''),
    processed_at=case when p_success then coalesce(e.processed_at,now()) else e.processed_at end,
    processing_error=case when p_success then null else left(coalesce(p_error,'Webhook Lynk.id belum diproses'),1500) end,
    delivery_email_status=coalesce(nullif(left(btrim(coalesce(p_delivery_email_status,'')),60),''),e.delivery_email_status),
    delivery_email_error=case when p_delivery_email_error is null then e.delivery_email_error else left(p_delivery_email_error,1500) end,
    last_received_at=now()
  where e.event_key=left(btrim(p_event_key),160);
end $$;

-- 5) Harga resmi. 2 tahun = 2 x tahunan. Lifetime ditolak untuk order baru.
create or replace function public.ldm2_expected_price(p_plan_code text,p_billing_cycle text)
returns bigint language plpgsql security definer set search_path='' stable as $$
declare v_plan public.ldm2_plans%rowtype;v_cycle text:=lower(btrim(p_billing_cycle));v_amount bigint;
begin
  select * into v_plan from public.ldm2_plans where code=upper(btrim(p_plan_code)) and active=true;
  if not found then raise exception 'Paket tidak ditemukan/nonaktif. Paket aktif V27 hanya Warung Kecil, Warung Sederhana, dan Toko.'; end if;
  if v_plan.code not in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO') then raise exception 'Paket ini tidak dijual pada V27.'; end if;
  v_amount:=case v_cycle when 'monthly' then v_plan.price_monthly when 'yearly' then v_plan.price_yearly when 'two_year' then v_plan.price_yearly*2 else null end;
  if v_amount is null or v_amount<=0 then raise exception 'Periode harus monthly, yearly, atau two_year.'; end if;
  return v_amount;
end $$;

create or replace function public.ldm2_create_purchase_order(
 p_order_id text,p_key_hash_hex text,p_key_prefix text,p_customer_name text,p_customer_email text,p_customer_phone text,
 p_plan_code text,p_billing_cycle text,p_store_code text,p_store_name text,p_amount bigint,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_plan_code text:=upper(btrim(p_plan_code));v_cycle text:=lower(btrim(p_billing_cycle));v_store_code text:=upper(btrim(coalesce(p_store_code,'')));v_expected bigint;v_license_id uuid;v_store_id uuid:=extensions.gen_random_uuid();v_network_id uuid:=extensions.gen_random_uuid();v_payment_id uuid;v_months integer;
begin
  if v_plan_code not in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO') then raise exception 'Paket pembelian tidak tersedia.'; end if;
  if nullif(btrim(p_order_id),'') is null then raise exception 'Order ID wajib diisi.'; end if;
  if nullif(btrim(p_customer_name),'') is null then raise exception 'Nama customer wajib diisi.'; end if;
  if nullif(btrim(p_customer_email),'') is null then raise exception 'Email customer wajib diisi.'; end if;
  if nullif(btrim(p_store_name),'') is null then raise exception 'Nama toko wajib diisi.'; end if;
  v_expected:=public.ldm2_expected_price(v_plan_code,v_cycle);if p_amount<>v_expected then raise exception 'Nominal tidak sesuai harga resmi paket.'; end if;
  if v_store_code='' then loop v_store_code:='LDM-'||upper(left(replace(extensions.gen_random_uuid()::text,'-',''),10));exit when not exists(select 1 from public.ldm2_licenses where upper(primary_store_code)=v_store_code);end loop;end if;
  if v_store_code !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then raise exception 'Store Code harus 3-30 karakter: huruf kapital, angka, atau tanda strip.'; end if;
  if exists(select 1 from public.ldm2_licenses where upper(primary_store_code)=v_store_code) then raise exception 'Store Code % sudah digunakan.',v_store_code; end if;
  v_months:=case v_cycle when 'monthly' then 1 when 'yearly' then 12 when 'two_year' then 24 else -1 end;if v_months<0 then raise exception 'Periode pembelian tidak valid.'; end if;
  insert into public.ldm2_licenses(key_hash,key_prefix,customer_name,customer_email,customer_phone,customer_email_hash,plan_code,status,is_trial,starts_at,expires_at,notes,primary_store_id,primary_store_code,primary_store_name,network_id)
  values(decode(p_key_hash_hex,'hex'),btrim(p_key_prefix),btrim(p_customer_name),lower(btrim(p_customer_email)),nullif(btrim(p_customer_phone),''),extensions.digest(lower(btrim(p_customer_email)),'sha256'),v_plan_code,'pending_payment',false,now(),null,p_notes,v_store_id,v_store_code,btrim(p_store_name),v_network_id) returning id into v_license_id;
  insert into public.ldm2_payments(order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,provider,status)
  values(btrim(p_order_id),v_license_id,'purchase',v_plan_code,v_cycle,v_months,p_amount,'lynk','pending') returning id into v_payment_id;
  insert into public.ldm2_events(license_id,event_type,detail) values(v_license_id,'PAYMENT_ORDER_CREATED',jsonb_build_object('order_id',btrim(p_order_id),'payment_type','purchase','provider','lynk','billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount,'store_code',v_store_code,'store_id',v_store_id,'network_id',v_network_id));
  return jsonb_build_object('ok',true,'license_id',v_license_id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),'plan_code',v_plan_code,'billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount,'store_id',v_store_id,'store_code',v_store_code,'store_name',btrim(p_store_name),'network_id',v_network_id,'status','pending_payment');
end $$;

create or replace function public.ldm2_create_renewal_order(p_order_id text,p_license_id uuid,p_billing_cycle text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_license public.ldm2_licenses%rowtype;v_cycle text:=lower(btrim(p_billing_cycle));v_expected bigint;v_payment_id uuid;v_months integer;
begin
  select * into v_license from public.ldm2_licenses where id=p_license_id for update;if not found then raise exception 'Lisensi tidak ditemukan.'; end if;
  if v_license.is_trial then raise exception 'Trial harus dikonversi melalui pembelian paket baru.'; end if;if v_license.status='cancelled' then raise exception 'Lisensi dibatalkan tidak dapat diperpanjang.'; end if;if v_license.plan_code not in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO') then raise exception 'Paket lama ini tidak tersedia untuk renewal otomatis V27.'; end if;
  v_expected:=public.ldm2_expected_price(v_license.plan_code,v_cycle);if p_amount<>v_expected then raise exception 'Nominal perpanjangan tidak sesuai harga resmi.'; end if;v_months:=case v_cycle when 'monthly' then 1 when 'yearly' then 12 when 'two_year' then 24 else -1 end;if v_months<0 then raise exception 'Periode renewal tidak valid.'; end if;
  insert into public.ldm2_payments(order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,provider,status) values(btrim(p_order_id),v_license.id,'renewal',v_license.plan_code,v_cycle,v_months,p_amount,'lynk','pending') returning id into v_payment_id;
  insert into public.ldm2_events(license_id,event_type,detail) values(v_license.id,'PAYMENT_ORDER_CREATED',jsonb_build_object('order_id',btrim(p_order_id),'payment_type','renewal','provider','lynk','billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount));
  return jsonb_build_object('ok',true,'license_id',v_license.id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),'plan_code',v_license.plan_code,'billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount,'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,'store_name',v_license.primary_store_name,'network_id',v_license.network_id,'status','pending');
end $$;

create or replace function public.ldm2_create_trial_conversion_order(p_order_id text,p_license_id uuid,p_key_hash_hex text,p_key_prefix text,p_plan_code text,p_billing_cycle text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_license public.ldm2_licenses%rowtype;v_plan_code text:=upper(btrim(p_plan_code));v_cycle text:=lower(btrim(p_billing_cycle));v_expected bigint;v_payment_id uuid;v_months integer;
begin
  select * into v_license from public.ldm2_licenses where id=p_license_id for update;if not found or not v_license.is_trial then raise exception 'Lisensi trial tidak ditemukan.'; end if;if v_plan_code not in ('WARUNG_KECIL','WARUNG_SEDERHANA','TOKO') then raise exception 'Paket tujuan tidak tersedia.'; end if;
  if exists(select 1 from public.ldm2_payments where license_id=v_license.id and payment_type='conversion' and status in ('pending','challenge')) then raise exception 'Masih ada pembayaran konversi yang menunggu.'; end if;
  v_expected:=public.ldm2_expected_price(v_plan_code,v_cycle);if p_amount<>v_expected then raise exception 'Nominal konversi tidak sesuai harga resmi.'; end if;v_months:=case v_cycle when 'monthly' then 1 when 'yearly' then 12 when 'two_year' then 24 else -1 end;if v_months<0 then raise exception 'Periode konversi tidak valid.'; end if;
  insert into public.ldm2_payments(order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,provider,status,license_key_hash,license_key_prefix) values(btrim(p_order_id),v_license.id,'conversion',v_plan_code,v_cycle,v_months,p_amount,'lynk','pending',decode(p_key_hash_hex,'hex'),btrim(p_key_prefix)) returning id into v_payment_id;
  insert into public.ldm2_events(license_id,event_type,detail) values(v_license.id,'PAYMENT_ORDER_CREATED',jsonb_build_object('order_id',btrim(p_order_id),'payment_type','conversion','provider','lynk','plan_code',v_plan_code,'billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount));
  return jsonb_build_object('ok',true,'license_id',v_license.id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),'plan_code',v_plan_code,'billing_cycle',v_cycle,'duration_months',v_months,'amount',p_amount,'status','pending');
end $$;

-- 5b) Terapkan payment SUCCESS dari webhook Lynk.id secara idempotent.
create or replace function public.ldm2_apply_lynk_payment(
  p_order_id text,p_transaction_id text,p_event_status text,p_gross_amount numeric,p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_payment public.ldm2_payments%rowtype;v_license public.ldm2_licenses%rowtype;
  v_expiry timestamptz;v_base timestamptz;v_status text:=upper(btrim(coalesce(p_event_status,'')));
begin
  select * into v_payment from public.ldm2_payments where order_id=btrim(p_order_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','ORDER_NOT_FOUND'); end if;
  if v_payment.provider<>'lynk' then return jsonb_build_object('ok',false,'code','PROVIDER_MISMATCH'); end if;
  if v_payment.duration_months not in (1,12,24) then return jsonb_build_object('ok',false,'code','UNSUPPORTED_DURATION'); end if;
  if p_gross_amount is null or round(p_gross_amount)::bigint<>v_payment.amount then
    insert into public.ldm2_events(license_id,event_type,detail) values(v_payment.license_id,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object('order_id',v_payment.order_id,'provider','lynk','expected',v_payment.amount,'received',p_gross_amount));
    return jsonb_build_object('ok',false,'code','AMOUNT_MISMATCH');
  end if;
  if v_payment.processed_at is not null or v_payment.status='paid' then return jsonb_build_object('ok',true,'processed',false,'duplicate',true,'order_id',v_payment.order_id); end if;
  if nullif(btrim(coalesce(p_transaction_id,'')),'') is not null and exists(select 1 from public.ldm2_payments p where p.provider_transaction_id=btrim(p_transaction_id) and p.id<>v_payment.id) then
    return jsonb_build_object('ok',false,'code','TRANSACTION_ALREADY_USED');
  end if;
  select * into v_license from public.ldm2_licenses where id=v_payment.license_id for update;
  if not found then raise exception 'Lisensi order Lynk.id tidak ditemukan.'; end if;

  if v_payment.payment_type='purchase' then
    v_expiry:=now()+make_interval(months=>v_payment.duration_months);
    update public.ldm2_licenses set status='active',starts_at=coalesce(starts_at,now()),expires_at=v_expiry where id=v_license.id;
  elsif v_payment.payment_type='conversion' then
    v_expiry:=now()+make_interval(months=>v_payment.duration_months);
    update public.ldm2_licenses set status='active',plan_code=v_payment.plan_code,is_trial=false,trial_identity_hash=null,
      key_hash=v_payment.license_key_hash,key_prefix=v_payment.license_key_prefix,starts_at=now(),expires_at=v_expiry,
      max_devices_override=null,max_stores_override=null where id=v_license.id;
  else
    v_base:=greatest(now(),coalesce(v_license.expires_at,now()));v_expiry:=v_base+make_interval(months=>v_payment.duration_months);
    update public.ldm2_licenses set status='active',expires_at=v_expiry where id=v_license.id;
  end if;

  update public.ldm2_payments set status='paid',provider_status=lower(nullif(v_status,'')),
    provider_transaction_id=coalesce(nullif(btrim(p_transaction_id),''),provider_transaction_id),paid_at=coalesce(paid_at,now()),processed_at=now(),
    provider_terminal_at=coalesce(provider_terminal_at,now()),last_provider_event_at=now(),last_provider_event_source='lynk_webhook',
    provider_detail=coalesce(provider_detail,'{}'::jsonb)||coalesce(p_provider_detail,'{}'::jsonb)||jsonb_build_object('provider','lynk','last_event_status',v_status),
    payment_state_version=payment_state_version+1 where id=v_payment.id;

  insert into public.ldm2_events(license_id,event_type,detail) values(v_license.id,
    case when v_payment.payment_type='purchase' then 'LICENSE_ACTIVATED_BY_PAYMENT' when v_payment.payment_type='conversion' then 'LICENSE_CONVERTED_BY_PAYMENT' else 'LICENSE_RENEWED_BY_PAYMENT' end,
    jsonb_build_object('order_id',v_payment.order_id,'billing_cycle',v_payment.billing_cycle,'duration_months',v_payment.duration_months,'amount',v_payment.amount,'expires_at',v_expiry,'provider','lynk','transaction_id',p_transaction_id));

  return jsonb_build_object('ok',true,'processed',true,'order_id',v_payment.order_id,'payment_status','paid','license_id',v_license.id,'license_status','active','expires_at',v_expiry,'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,'network_id',v_license.network_id);
end $$;

-- Cegah INSERT pembayaran provider selain Lynk tanpa merusak baris histori provider lama.
create or replace function public.ldm2_enforce_new_payment_lynk_only()
returns trigger language plpgsql set search_path='' as $$
begin
  if coalesce(new.provider,'lynk')<>'lynk' then raise exception 'V27 hanya menerima payment baru melalui Lynk.id.'; end if;
  new.provider:='lynk';return new;
end $$;
drop trigger if exists trg_ldm2_new_payment_lynk_only on public.ldm2_payments;
create trigger trg_ldm2_new_payment_lynk_only before insert on public.ldm2_payments for each row execute function public.ldm2_enforce_new_payment_lynk_only();

-- 6) Hapus RPC integrasi gateway lama jika masih ada. Histori transaksi/event tidak dihapus.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in (
             'ldm2_set_midtrans_checkout','ldm2_apply_midtrans_notification','ldm2_register_midtrans_event','ldm2_finish_midtrans_event','ldm2_midtrans_reconciliation_candidates','ldm2_mark_midtrans_reconciliation',
             'ldm2_set_doku_checkout','ldm2_apply_doku_notification','ldm2_register_doku_event','ldm2_finish_doku_event','ldm2_doku_reconciliation_candidates','ldm2_mark_doku_reconciliation'
           )
  loop
    begin execute 'drop function if exists '||r.sig; exception when dependent_objects_still_exist then raise notice 'Lewati %, masih memiliki dependency historis.',r.sig; end;
  end loop;
end $$;

revoke all on function public.ldm2_expected_price(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.ldm2_create_renewal_order(text,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.ldm2_create_trial_conversion_order(text,uuid,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.ldm2_expected_price(text,text) to service_role;
grant execute on function public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text) to service_role;
grant execute on function public.ldm2_create_renewal_order(text,uuid,text,bigint) to service_role;
grant execute on function public.ldm2_create_trial_conversion_order(text,uuid,text,text,text,text,bigint) to service_role;

revoke all on function public.ldm2_set_payment_provider(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_set_lynk_order(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_register_lynk_event(text,text,text,text,numeric,text,boolean,boolean,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_finish_lynk_event(text,text,text,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.ldm2_set_payment_provider(text,text) to service_role;
grant execute on function public.ldm2_set_lynk_order(text,text,jsonb) to service_role;
grant execute on function public.ldm2_register_lynk_event(text,text,text,text,numeric,text,boolean,boolean,jsonb,jsonb) to service_role;
grant execute on function public.ldm2_finish_lynk_event(text,text,text,boolean,text,text,text) to service_role;
grant execute on function public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb) to service_role;

insert into public.ldm2_events(license_id,event_type,detail)
select null,'SYSTEM_PATCH',jsonb_build_object('version','27.9.0-v27','feature','LYNK_ONLY_3_PLANS_2_YEAR','installed_at',now())
where not exists(select 1 from public.ldm2_events where event_type='SYSTEM_PATCH' and detail->>'version'='27.9.0-v27' and detail->>'feature'='LYNK_ONLY_3_PLANS_2_YEAR');

commit;

-- VERIFIKASI
select
 (select active=false from public.ldm2_plans where code='LIFETIME') as lifetime_sales_disabled,
 public.ldm2_expected_price('WARUNG_KECIL','two_year')=1398000 as wk_2year_ok,
 public.ldm2_expected_price('WARUNG_SEDERHANA','two_year')=2598000 as ws_2year_ok,
 public.ldm2_expected_price('TOKO','two_year')=4998000 as toko_2year_ok,
 to_regclass('public.ldm2_lynk_events') is not null as lynk_events_table_ok,
 to_regprocedure('public.ldm2_set_lynk_order(text,text,jsonb)') is not null as set_lynk_order_ok,
 to_regprocedure('public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb)') is not null as apply_lynk_payment_ok,
 column_default ilike '%lynk%' as new_payment_default_lynk
from information_schema.columns where table_schema='public' and table_name='ldm2_payments' and column_name='provider';

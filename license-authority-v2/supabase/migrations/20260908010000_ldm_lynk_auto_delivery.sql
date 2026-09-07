-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06 V26
-- LYNK.ID SAFE AUTO WEBHOOK + AUTOMATIC LICENSE DELIVERY
-- Jalankan HANYA pada PROJECT LICENSE AUTHORITY V2.
-- Aman dijalankan ulang.
--
-- Catatan keamanan:
-- Dokumentasi publik Lynk.id mengonfirmasi fitur webhook transaksi sukses,
-- tetapi kontrak payload/signature teknis tidak dipublikasikan secara lengkap.
-- Karena itu V26 menyimpan payload asli lebih dulu dan hanya mengaktifkan
-- AUTO_PROCESS setelah mapping field sudah diverifikasi dari webhook akun sendiri.
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regclass('public.ldm2_checkout_deliveries') is null
       or to_regprocedure('public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text)') is null then
        raise exception 'Fondasi Public Checkout/Lisensi belum lengkap. Pasang migration Commercial #06 sebelumnya terlebih dahulu.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Payment provider: Midtrans + DOKU + Lynk.id
-- --------------------------------------------------------------------------
alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_provider_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_provider_check
    check (provider in ('midtrans','doku','lynk'));

create index if not exists idx_ldm2_payments_provider_status_created
    on public.ldm2_payments(provider,status,created_at desc);

create or replace function public.ldm2_set_payment_provider(
    p_order_id text,
    p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_provider text := lower(btrim(coalesce(p_provider,'')));
    v_payment public.ldm2_payments%rowtype;
begin
    if v_provider not in ('midtrans','doku','lynk') then
        raise exception 'Payment provider tidak dikenal: %', v_provider;
    end if;

    update public.ldm2_payments
    set provider=v_provider,
        error_message=null,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)||jsonb_build_object('provider',v_provider)
    where order_id=btrim(p_order_id)
      and status in ('pending','challenge','failed','expired','cancelled')
      and processed_at is null
    returning * into v_payment;

    if not found then raise exception 'Order pembayaran tidak ditemukan atau sudah final.'; end if;
    return jsonb_build_object('ok',true,'order_id',v_payment.order_id,'provider',v_payment.provider);
end;
$$;

-- Menyimpan metadata order Lynk.id yang sudah dibuat sebelum redirect customer.
create or replace function public.ldm2_set_lynk_order(
    p_order_id text,
    p_checkout_url text,
    p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
begin
    update public.ldm2_payments
    set provider='lynk',
        redirect_url=nullif(btrim(coalesce(p_checkout_url,'')),''),
        provider_status='awaiting_lynk_payment',
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
            || coalesce(p_provider_detail,'{}'::jsonb)
            || jsonb_build_object('provider','lynk','checkout_url',nullif(btrim(coalesce(p_checkout_url,'')),'')),
        error_message=null
    where order_id=btrim(p_order_id)
      and processed_at is null
    returning * into v_payment;

    if not found then raise exception 'Order Lynk.id tidak ditemukan atau sudah final.'; end if;
    return jsonb_build_object('ok',true,'order_id',v_payment.order_id,'provider','lynk','status',v_payment.status);
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Inbox webhook Lynk.id
-- --------------------------------------------------------------------------
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

create index if not exists idx_ldm2_lynk_events_last_received
    on public.ldm2_lynk_events(last_received_at desc);
create index if not exists idx_ldm2_lynk_events_transaction
    on public.ldm2_lynk_events(transaction_id)
    where transaction_id is not null;
create index if not exists idx_ldm2_lynk_events_email_amount
    on public.ldm2_lynk_events(customer_email,gross_amount,last_received_at desc);

alter table public.ldm2_lynk_events enable row level security;
revoke all on public.ldm2_lynk_events from anon,authenticated;

create or replace function public.ldm2_register_lynk_event(
    p_event_key text,
    p_transaction_id text,
    p_event_status text,
    p_customer_email text,
    p_gross_amount numeric,
    p_product_ref text,
    p_token_valid boolean,
    p_auto_process_enabled boolean,
    p_raw_headers jsonb,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_event public.ldm2_lynk_events%rowtype;
begin
    insert into public.ldm2_lynk_events(
        event_key,transaction_id,event_status,customer_email,gross_amount,product_ref,
        token_valid,auto_process_enabled,raw_headers,payload
    ) values (
        left(btrim(p_event_key),160),
        nullif(left(btrim(coalesce(p_transaction_id,'')),180),''),
        nullif(left(btrim(coalesce(p_event_status,'')),100),''),
        nullif(lower(left(btrim(coalesce(p_customer_email,'')),200)),''),
        p_gross_amount,
        nullif(left(btrim(coalesce(p_product_ref,'')),300),''),
        coalesce(p_token_valid,false),coalesce(p_auto_process_enabled,false),
        coalesce(p_raw_headers,'{}'::jsonb),coalesce(p_payload,'{}'::jsonb)
    )
    on conflict(event_key) do update
    set receive_count=public.ldm2_lynk_events.receive_count+1,
        last_received_at=now(),
        transaction_id=coalesce(excluded.transaction_id,public.ldm2_lynk_events.transaction_id),
        event_status=coalesce(excluded.event_status,public.ldm2_lynk_events.event_status),
        customer_email=coalesce(excluded.customer_email,public.ldm2_lynk_events.customer_email),
        gross_amount=coalesce(excluded.gross_amount,public.ldm2_lynk_events.gross_amount),
        product_ref=coalesce(excluded.product_ref,public.ldm2_lynk_events.product_ref),
        token_valid=excluded.token_valid,
        auto_process_enabled=excluded.auto_process_enabled,
        raw_headers=excluded.raw_headers,
        payload=excluded.payload
    returning * into v_event;

    return jsonb_build_object(
        'ok',true,'event_key',v_event.event_key,'receive_count',v_event.receive_count,
        'already_processed',v_event.processed_at is not null
    );
end;
$$;

create or replace function public.ldm2_finish_lynk_event(
    p_event_key text,
    p_order_id text default null,
    p_match_status text default null,
    p_success boolean default false,
    p_error text default null,
    p_delivery_email_status text default null,
    p_delivery_email_error text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
    update public.ldm2_lynk_events e
    set matched_order_id=nullif(btrim(coalesce(p_order_id,'')),''),
        payment_id=coalesce((select p.id from public.ldm2_payments p where p.order_id=nullif(btrim(coalesce(p_order_id,'')),'')),e.payment_id),
        license_id=coalesce((select p.license_id from public.ldm2_payments p where p.order_id=nullif(btrim(coalesce(p_order_id,'')),'')),e.license_id),
        auto_match_status=nullif(left(btrim(coalesce(p_match_status,'')),100),''),
        processed_at=case when p_success then coalesce(e.processed_at,now()) else e.processed_at end,
        processing_error=case when p_success then null else left(coalesce(p_error,'Webhook Lynk.id belum diproses'),1500) end,
        delivery_email_status=coalesce(nullif(left(btrim(coalesce(p_delivery_email_status,'')),60),''),e.delivery_email_status),
        delivery_email_error=case when p_delivery_email_error is null then e.delivery_email_error else left(p_delivery_email_error,1500) end,
        last_received_at=now()
    where e.event_key=left(btrim(p_event_key),160);
end;
$$;

-- --------------------------------------------------------------------------
-- 3. State machine SUCCESS Lynk.id.
--    HANYA dipanggil setelah webhook sudah melewati token URL, mapping payload,
--    status sukses, match email+amount yang unik, dan mode AUTO_PROCESS aktif.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_apply_lynk_payment(
    p_order_id text,
    p_transaction_id text,
    p_event_status text,
    p_gross_amount numeric,
    p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_expiry timestamptz;
    v_base timestamptz;
    v_status text := upper(btrim(coalesce(p_event_status,'')));
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
    for update;

    if not found then return jsonb_build_object('ok',false,'code','ORDER_NOT_FOUND'); end if;
    if v_payment.provider<>'lynk' then return jsonb_build_object('ok',false,'code','PROVIDER_MISMATCH'); end if;

    if p_gross_amount is null or round(p_gross_amount)::bigint<>v_payment.amount then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object(
            'order_id',v_payment.order_id,'provider','lynk','expected',v_payment.amount,'received',p_gross_amount
        ));
        return jsonb_build_object('ok',false,'code','AMOUNT_MISMATCH');
    end if;

    if v_payment.processed_at is not null or v_payment.status='paid' then
        return jsonb_build_object('ok',true,'processed',false,'duplicate',true,'order_id',v_payment.order_id);
    end if;

    if nullif(btrim(coalesce(p_transaction_id,'')),'') is not null
       and exists(select 1 from public.ldm2_payments p
                  where p.provider_transaction_id=btrim(p_transaction_id)
                    and p.id<>v_payment.id) then
        return jsonb_build_object('ok',false,'code','TRANSACTION_ALREADY_USED');
    end if;

    select * into v_license from public.ldm2_licenses where id=v_payment.license_id for update;
    if not found then raise exception 'Lisensi order Lynk.id tidak ditemukan.'; end if;

    if v_payment.payment_type='purchase' then
        v_expiry := case when v_payment.billing_cycle='lifetime' then null
                         else now()+make_interval(months=>v_payment.duration_months) end;
        update public.ldm2_licenses
        set status='active',starts_at=coalesce(starts_at,now()),expires_at=v_expiry
        where id=v_license.id;
    elsif v_payment.payment_type='conversion' then
        v_expiry := case when v_payment.billing_cycle='lifetime' then null
                         else now()+make_interval(months=>v_payment.duration_months) end;
        update public.ldm2_licenses
        set status='active',plan_code=v_payment.plan_code,is_trial=false,trial_identity_hash=null,
            key_hash=v_payment.license_key_hash,key_prefix=v_payment.license_key_prefix,
            starts_at=now(),expires_at=v_expiry,max_devices_override=null,max_stores_override=null
        where id=v_license.id;
    else
        v_base := greatest(now(),coalesce(v_license.expires_at,now()));
        v_expiry := v_base+make_interval(months=>v_payment.duration_months);
        update public.ldm2_licenses set status='active',expires_at=v_expiry where id=v_license.id;
    end if;

    update public.ldm2_payments
    set status='paid',provider_status=lower(nullif(v_status,'')),
        provider_transaction_id=coalesce(nullif(btrim(p_transaction_id),''),provider_transaction_id),
        paid_at=coalesce(paid_at,now()),processed_at=now(),provider_terminal_at=coalesce(provider_terminal_at,now()),
        last_provider_event_at=now(),last_provider_event_source='lynk_webhook',
        provider_detail=coalesce(provider_detail,'{}'::jsonb)||coalesce(p_provider_detail,'{}'::jsonb)
            ||jsonb_build_object('provider','lynk','last_event_status',v_status),
        payment_state_version=payment_state_version+1
    where id=v_payment.id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,
        case when v_payment.payment_type='purchase' then 'LICENSE_ACTIVATED_BY_PAYMENT'
             when v_payment.payment_type='conversion' then 'LICENSE_CONVERTED_BY_PAYMENT'
             else 'LICENSE_RENEWED_BY_PAYMENT' end,
        jsonb_build_object(
            'order_id',v_payment.order_id,'billing_cycle',v_payment.billing_cycle,'amount',v_payment.amount,
            'expires_at',v_expiry,'provider','lynk','transaction_id',p_transaction_id
        ));

    return jsonb_build_object(
        'ok',true,'processed',true,'order_id',v_payment.order_id,'payment_status','paid',
        'license_id',v_license.id,'license_status','active','expires_at',v_expiry,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,'network_id',v_license.network_id
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 4. Permissions
-- --------------------------------------------------------------------------
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

commit;

-- --------------------------------------------------------------------------
-- VERIFIKASI
-- Semua kolom di bawah harus TRUE.
-- --------------------------------------------------------------------------
select
    to_regclass('public.ldm2_lynk_events') is not null as lynk_events_table_ok,
    to_regprocedure('public.ldm2_set_lynk_order(text,text,jsonb)') is not null as set_lynk_order_rpc_ok,
    to_regprocedure('public.ldm2_register_lynk_event(text,text,text,text,numeric,text,boolean,boolean,jsonb,jsonb)') is not null as register_lynk_event_rpc_ok,
    to_regprocedure('public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb)') is not null as apply_lynk_payment_rpc_ok,
    exists(
        select 1 from pg_constraint c
        join pg_class t on t.oid=c.conrelid
        join pg_namespace n on n.oid=t.relnamespace
        where n.nspname='public' and t.relname='ldm2_payments'
          and c.conname='ldm2_payments_provider_check'
          and pg_get_constraintdef(c.oid) ilike '%lynk%'
    ) as provider_lynk_ok;

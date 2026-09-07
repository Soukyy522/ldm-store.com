-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06 V23
-- MULTI PAYMENT GATEWAY: MIDTRANS + DOKU CHECKOUT
-- Jalankan HANYA pada PROJECT LICENSE AUTHORITY V2.
-- Aman dijalankan ulang.
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regclass('public.ldm2_events') is null
       or to_regprocedure('public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)') is null then
        raise exception 'Fondasi Midtrans/Lisensi belum lengkap. Jalankan migration Commercial #06 sebelumnya terlebih dahulu.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Provider pembayaran sekarang boleh Midtrans atau DOKU.
-- --------------------------------------------------------------------------
alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_provider_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_provider_check
    check (provider in ('midtrans','doku'));

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
    if v_provider not in ('midtrans','doku') then
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

create or replace function public.ldm2_set_doku_checkout(
    p_order_id text,
    p_checkout_token text,
    p_redirect_url text,
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
    set provider='doku',
        snap_token=nullif(btrim(p_checkout_token),''),
        redirect_url=nullif(btrim(p_redirect_url),''),
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
            || coalesce(p_provider_detail,'{}'::jsonb)
            || jsonb_build_object('provider','doku'),
        error_message=null
    where order_id=btrim(p_order_id)
      and processed_at is null
    returning * into v_payment;

    if not found then raise exception 'Order pembayaran DOKU tidak ditemukan.'; end if;
    return jsonb_build_object(
        'ok',true,'order_id',v_payment.order_id,'provider','doku',
        'redirect_url',v_payment.redirect_url
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Event inbox DOKU. Duplicate webhook aman/idempotent.
-- --------------------------------------------------------------------------
create table if not exists public.ldm2_doku_events (
    event_key text primary key,
    payment_id uuid references public.ldm2_payments(id) on delete set null,
    license_id uuid references public.ldm2_licenses(id) on delete set null,
    order_id text not null,
    source text not null default 'webhook',
    request_id text,
    transaction_id text,
    transaction_status text,
    gross_amount numeric(18,2),
    signature_valid boolean,
    receive_count integer not null default 1 check (receive_count > 0),
    first_received_at timestamptz not null default now(),
    last_received_at timestamptz not null default now(),
    verified_at timestamptz,
    processed_at timestamptz,
    processing_error text,
    provider_detail jsonb not null default '{}'::jsonb
);

create index if not exists idx_ldm2_doku_events_order_time
    on public.ldm2_doku_events(order_id,last_received_at desc);
create index if not exists idx_ldm2_doku_events_unprocessed
    on public.ldm2_doku_events(last_received_at)
    where processed_at is null;

alter table public.ldm2_doku_events enable row level security;
revoke all on table public.ldm2_doku_events from public,anon,authenticated;
grant all on table public.ldm2_doku_events to service_role;

create or replace function public.ldm2_register_doku_event(
    p_event_key text,
    p_order_id text,
    p_source text,
    p_request_id text,
    p_transaction_id text,
    p_transaction_status text,
    p_gross_amount numeric,
    p_signature_valid boolean,
    p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_event public.ldm2_doku_events%rowtype;
begin
    if nullif(btrim(p_event_key),'') is null then raise exception 'Event key wajib diisi.'; end if;
    if nullif(btrim(p_order_id),'') is null then raise exception 'Order ID wajib diisi.'; end if;

    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id);

    insert into public.ldm2_doku_events(
        event_key,payment_id,license_id,order_id,source,request_id,transaction_id,
        transaction_status,gross_amount,signature_valid,verified_at,provider_detail
    ) values (
        left(btrim(p_event_key),128),v_payment.id,v_payment.license_id,btrim(p_order_id),
        left(coalesce(nullif(btrim(p_source),''),'webhook'),80),
        nullif(left(btrim(coalesce(p_request_id,'')),128),''),
        nullif(left(btrim(coalesce(p_transaction_id,'')),160),''),
        nullif(left(upper(btrim(coalesce(p_transaction_status,''))),60),''),
        p_gross_amount,p_signature_valid,
        case when p_signature_valid is true then now() else null end,
        coalesce(p_provider_detail,'{}'::jsonb)
    )
    on conflict(event_key) do update
    set receive_count=public.ldm2_doku_events.receive_count+1,
        last_received_at=now(),
        payment_id=coalesce(public.ldm2_doku_events.payment_id,excluded.payment_id),
        license_id=coalesce(public.ldm2_doku_events.license_id,excluded.license_id),
        signature_valid=coalesce(excluded.signature_valid,public.ldm2_doku_events.signature_valid),
        verified_at=case
            when excluded.signature_valid is true then coalesce(public.ldm2_doku_events.verified_at,now())
            else public.ldm2_doku_events.verified_at
        end,
        provider_detail=coalesce(public.ldm2_doku_events.provider_detail,'{}'::jsonb)
            || coalesce(excluded.provider_detail,'{}'::jsonb)
    returning * into v_event;

    return jsonb_build_object(
        'ok',true,'event_key',v_event.event_key,'receive_count',v_event.receive_count,
        'already_processed',v_event.processed_at is not null,
        'order_known',v_event.payment_id is not null
    );
end;
$$;

create or replace function public.ldm2_finish_doku_event(
    p_event_key text,
    p_success boolean,
    p_error text default null,
    p_provider_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
    update public.ldm2_doku_events
    set processed_at=case when p_success then coalesce(processed_at,now()) else processed_at end,
        processing_error=case when p_success then null else left(coalesce(p_error,'DOKU event gagal diproses'),1000) end,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)||coalesce(p_provider_detail,'{}'::jsonb),
        last_received_at=now()
    where event_key=left(btrim(p_event_key),128);
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Rekonsiliasi provider-aware.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_mark_doku_reconciliation(
    p_order_id text,
    p_success boolean,
    p_source text,
    p_error text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
    update public.ldm2_payments
    set last_reconciled_at=now(),
        reconcile_attempts=reconcile_attempts+1,
        last_reconcile_error=case when p_success then null else left(coalesce(p_error,'Rekonsiliasi DOKU gagal'),1000) end,
        last_provider_event_source=left(coalesce(nullif(btrim(p_source),''),'doku_reconcile'),120),
        last_provider_event_at=now()
    where order_id=btrim(p_order_id) and provider='doku';
end;
$$;

-- Patch penting: cron Midtrans jangan pernah mengambil payment DOKU.
create or replace function public.ldm2_midtrans_reconciliation_candidates(
    p_limit integer default 25,
    p_min_age_seconds integer default 120,
    p_max_age_days integer default 7
)
returns table(
    id uuid,
    license_id uuid,
    order_id text,
    status text,
    provider_status text,
    payment_type text,
    amount bigint,
    snap_token text,
    created_at timestamptz,
    last_reconciled_at timestamptz,
    reconcile_attempts integer
)
language sql
security definer
set search_path=''
as $$
    select
        p.id,p.license_id,p.order_id,p.status,p.provider_status,p.payment_type,p.amount,
        p.snap_token,p.created_at,p.last_reconciled_at,p.reconcile_attempts
    from public.ldm2_payments p
    where p.provider='midtrans'
      and p.status in ('pending','challenge')
      and p.created_at <= now() - make_interval(secs=>greatest(30,least(coalesce(p_min_age_seconds,120),86400)))
      and p.created_at >= now() - make_interval(days=>greatest(1,least(coalesce(p_max_age_days,7),30)))
      and (p.last_reconciled_at is null or p.last_reconciled_at <= now() - interval '2 minutes')
    order by coalesce(p.last_reconciled_at,p.created_at),p.created_at
    limit greatest(1,least(coalesce(p_limit,25),100));
$$;

create or replace function public.ldm2_doku_reconciliation_candidates(
    p_limit integer default 25,
    p_min_age_seconds integer default 120,
    p_max_age_days integer default 7
)
returns table(
    id uuid,
    license_id uuid,
    order_id text,
    status text,
    provider_status text,
    payment_type text,
    amount bigint,
    redirect_url text,
    created_at timestamptz,
    last_reconciled_at timestamptz,
    reconcile_attempts integer
)
language sql
security definer
set search_path=''
as $$
    select
        p.id,p.license_id,p.order_id,p.status,p.provider_status,p.payment_type,p.amount,
        p.redirect_url,p.created_at,p.last_reconciled_at,p.reconcile_attempts
    from public.ldm2_payments p
    where p.provider='doku'
      and p.status in ('pending','challenge')
      and p.created_at <= now() - make_interval(secs=>greatest(60,least(coalesce(p_min_age_seconds,120),86400)))
      and p.created_at >= now() - make_interval(days=>greatest(1,least(coalesce(p_max_age_days,7),30)))
      and (p.last_reconciled_at is null or p.last_reconciled_at <= now() - interval '2 minutes')
    order by coalesce(p.last_reconciled_at,p.created_at),p.created_at
    limit greatest(1,least(coalesce(p_limit,25),100));
$$;

-- --------------------------------------------------------------------------
-- 4. State machine DOKU Checkout.
--    DOKU Checkout: FAILED sengaja tidak menutup local order, karena customer
--    masih dapat mencoba channel lain di Checkout. SUCCESS adalah final paid.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_apply_doku_notification(
    p_order_id text,
    p_transaction_id text,
    p_transaction_status text,
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
    v_gateway_status text := upper(btrim(coalesce(p_transaction_status,'')));
    v_current_status text;
    v_candidate_status text;
    v_effective_status text;
    v_success boolean := false;
    v_stale boolean := false;
    v_base timestamptz;
    v_expiry timestamptz;
    v_source text := left(coalesce(nullif(btrim(coalesce(p_provider_detail->>'synced_by','')),''),'doku'),120);
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
    for update;

    if not found then
        return jsonb_build_object('ok',false,'code','ORDER_NOT_FOUND','message','Order ID tidak dikenal.');
    end if;

    if v_payment.provider <> 'doku' then
        return jsonb_build_object('ok',false,'code','PROVIDER_MISMATCH','message','Order ini bukan pembayaran DOKU.');
    end if;

    if not (p_gross_amount is not null and round(p_gross_amount)::bigint = v_payment.amount) then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object(
            'order_id',v_payment.order_id,'expected',v_payment.amount,'received',p_gross_amount,
            'provider','doku','provider_status',v_gateway_status,'source',v_source
        ));
        return jsonb_build_object('ok',false,'code','AMOUNT_MISMATCH','message','Nominal pembayaran DOKU tidak sesuai order.');
    end if;

    v_current_status := lower(coalesce(v_payment.status,'pending'));
    v_success := v_gateway_status='SUCCESS';

    v_candidate_status := case
        when v_gateway_status='SUCCESS' then 'paid'
        when v_gateway_status in ('PENDING','REDIRECT','TIMEOUT','ORDER_GENERATED','ORDER_RECOVERED','FAILED') then v_current_status
        when v_gateway_status in ('EXPIRED','ORDER_EXPIRED') then 'expired'
        when v_gateway_status='CANCELLED' then 'cancelled'
        when v_gateway_status='REFUNDED' then 'refunded'
        else v_current_status
    end;
    v_effective_status := v_candidate_status;

    if v_current_status='refunded' and v_candidate_status<>'refunded' then
        v_effective_status := v_current_status; v_stale := true;
    elsif v_current_status='partially_refunded' and v_candidate_status not in ('partially_refunded','refunded') then
        v_effective_status := v_current_status; v_stale := true;
    elsif (v_current_status='paid' or v_payment.processed_at is not null)
          and v_candidate_status in ('pending','challenge','failed','expired','cancelled') then
        v_effective_status := 'paid'; v_stale := true;
    elsif v_current_status in ('cancelled','expired','failed')
          and v_candidate_status in ('pending','challenge') then
        v_effective_status := v_current_status; v_stale := true;
    end if;

    update public.ldm2_payments
    set provider_transaction_id=coalesce(nullif(btrim(p_transaction_id),''),provider_transaction_id),
        provider_status=case when v_stale then provider_status else nullif(lower(v_gateway_status),'') end,
        status=v_effective_status,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
            || coalesce(p_provider_detail,'{}'::jsonb)
            || jsonb_build_object(
                'provider','doku',
                'last_incoming_status',v_gateway_status,
                'last_incoming_candidate',v_candidate_status,
                'last_event_stale_ignored',v_stale
            ),
        paid_at=case when v_success then coalesce(paid_at,now()) else paid_at end,
        refunded_at=case when v_candidate_status='refunded' then coalesce(refunded_at,now()) else refunded_at end,
        provider_terminal_at=case
            when v_effective_status in ('paid','failed','expired','cancelled','refunded','partially_refunded')
                then coalesce(provider_terminal_at,now())
            else provider_terminal_at
        end,
        last_provider_event_at=now(),
        last_provider_event_source=v_source,
        payment_state_version=payment_state_version+1
    where id=v_payment.id;

    if v_stale then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_STALE_STATUS_IGNORED',jsonb_build_object(
            'order_id',v_payment.order_id,'provider','doku','current_status',v_current_status,
            'incoming_status',v_gateway_status,'candidate_status',v_candidate_status,'source',v_source
        ));
        return jsonb_build_object('ok',true,'processed',false,'ignored_stale',true,
            'order_id',v_payment.order_id,'payment_status',v_effective_status,'incoming_status',v_gateway_status);
    end if;

    if v_candidate_status='refunded' then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_REFUNDED',jsonb_build_object(
            'order_id',v_payment.order_id,'provider','doku','payment_status','refunded','source',v_source
        ));
        return jsonb_build_object('ok',true,'processed',false,'refund_recorded',true,
            'order_id',v_payment.order_id,'payment_status','refunded','license_action','manual_review_required');
    end if;

    if not v_success then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_STATUS_UPDATED',jsonb_build_object(
            'order_id',v_payment.order_id,'provider','doku','payment_status',v_effective_status,
            'provider_status',v_gateway_status,'source',v_source
        ));
        return jsonb_build_object('ok',true,'processed',false,'order_id',v_payment.order_id,
            'payment_status',v_effective_status);
    end if;

    if v_payment.processed_at is not null then
        return jsonb_build_object('ok',true,'processed',false,'duplicate',true,
            'order_id',v_payment.order_id,'payment_status','paid');
    end if;

    select * into v_license
    from public.ldm2_licenses
    where id=v_payment.license_id
    for update;
    if not found then raise exception 'Lisensi order tidak ditemukan.'; end if;

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
    set status='paid',processed_at=now(),paid_at=coalesce(paid_at,now()),
        provider_terminal_at=coalesce(provider_terminal_at,now())
    where id=v_payment.id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,
        case when v_payment.payment_type='purchase' then 'LICENSE_ACTIVATED_BY_PAYMENT'
             when v_payment.payment_type='conversion' then 'LICENSE_CONVERTED_BY_PAYMENT'
             else 'LICENSE_RENEWED_BY_PAYMENT' end,
        jsonb_build_object(
            'order_id',v_payment.order_id,'billing_cycle',v_payment.billing_cycle,
            'amount',v_payment.amount,'expires_at',v_expiry,'provider','doku','source',v_source
        ));

    return jsonb_build_object(
        'ok',true,'processed',true,'order_id',v_payment.order_id,'payment_status','paid',
        'license_id',v_license.id,'license_status','active','expires_at',v_expiry,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'network_id',v_license.network_id
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 5. Permissions
-- --------------------------------------------------------------------------
revoke all on function public.ldm2_set_payment_provider(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_set_doku_checkout(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_register_doku_event(text,text,text,text,text,text,numeric,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_finish_doku_event(text,boolean,text,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_mark_doku_reconciliation(text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_doku_reconciliation_candidates(integer,integer,integer) from public,anon,authenticated;
revoke all on function public.ldm2_apply_doku_notification(text,text,text,numeric,jsonb) from public,anon,authenticated;

grant execute on function public.ldm2_set_payment_provider(text,text) to service_role;
grant execute on function public.ldm2_set_doku_checkout(text,text,text,jsonb) to service_role;
grant execute on function public.ldm2_register_doku_event(text,text,text,text,text,text,numeric,boolean,jsonb) to service_role;
grant execute on function public.ldm2_finish_doku_event(text,boolean,text,jsonb) to service_role;
grant execute on function public.ldm2_mark_doku_reconciliation(text,boolean,text,text) to service_role;
grant execute on function public.ldm2_doku_reconciliation_candidates(integer,integer,integer) to service_role;
grant execute on function public.ldm2_apply_doku_notification(text,text,text,numeric,jsonb) to service_role;

insert into public.ldm2_events(license_id,event_type,detail)
select null,'SYSTEM_PATCH',jsonb_build_object(
    'version','27.9.0-commercial-06-v23',
    'feature','DOKU_MULTI_GATEWAY',
    'installed_at',now()
)
where not exists (
    select 1 from public.ldm2_events
    where event_type='SYSTEM_PATCH'
      and detail->>'version'='27.9.0-commercial-06-v23'
      and detail->>'feature'='DOKU_MULTI_GATEWAY'
);

commit;

-- VERIFIKASI: seluruh kolom boolean di bawah harus TRUE.
select
    exists(
        select 1 from pg_catalog.pg_constraint c
        join pg_catalog.pg_class r on r.oid=c.conrelid
        join pg_catalog.pg_namespace n on n.oid=r.relnamespace
        where n.nspname='public' and r.relname='ldm2_payments'
          and c.conname='ldm2_payments_provider_check'
    ) as provider_constraint_ok,
    to_regclass('public.ldm2_doku_events') is not null as doku_event_table_ok,
    to_regprocedure('public.ldm2_set_payment_provider(text,text)') is not null as set_provider_rpc_ok,
    to_regprocedure('public.ldm2_set_doku_checkout(text,text,text,jsonb)') is not null as set_doku_checkout_rpc_ok,
    to_regprocedure('public.ldm2_register_doku_event(text,text,text,text,text,text,numeric,boolean,jsonb)') is not null as register_doku_event_rpc_ok,
    to_regprocedure('public.ldm2_finish_doku_event(text,boolean,text,jsonb)') is not null as finish_doku_event_rpc_ok,
    to_regprocedure('public.ldm2_mark_doku_reconciliation(text,boolean,text,text)') is not null as doku_reconcile_mark_rpc_ok,
    to_regprocedure('public.ldm2_doku_reconciliation_candidates(integer,integer,integer)') is not null as doku_reconcile_candidates_rpc_ok,
    to_regprocedure('public.ldm2_apply_doku_notification(text,text,text,numeric,jsonb)') is not null as apply_doku_rpc_ok;

-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06
-- MIDTRANS + LICENSE PRODUCTION HARDENING V19
-- Jalankan HANYA pada Supabase PROJECT LICENSE AUTHORITY V2.
-- Aman dijalankan ulang (idempotent).
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regclass('public.ldm2_events') is null
       or to_regprocedure('public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)') is null then
        raise exception 'Fondasi Midtrans/Lisensi belum lengkap. Jalankan migration License Authority V2 sebelumnya terlebih dahulu.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Metadata rekonsiliasi + refund
-- --------------------------------------------------------------------------
alter table public.ldm2_payments
    add column if not exists last_reconciled_at timestamptz,
    add column if not exists reconcile_attempts integer not null default 0,
    add column if not exists last_reconcile_error text,
    add column if not exists last_provider_event_at timestamptz,
    add column if not exists last_provider_event_source text,
    add column if not exists provider_terminal_at timestamptz,
    add column if not exists refunded_at timestamptz,
    add column if not exists refund_amount bigint not null default 0,
    add column if not exists payment_state_version bigint not null default 0;

alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_status_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_status_check
    check (status in (
        'pending','paid','failed','expired','cancelled','refunded',
        'partially_refunded','challenge'
    ));

alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_reconcile_attempts_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_reconcile_attempts_check
    check (reconcile_attempts >= 0);

alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_refund_amount_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_refund_amount_check
    check (refund_amount >= 0);

create index if not exists idx_ldm2_payments_reconcile_due
    on public.ldm2_payments(status, last_reconciled_at, created_at)
    where status in ('pending','challenge');

-- --------------------------------------------------------------------------
-- 2. Event inbox Midtrans.
--    event_key dibuat server dari payload/status yang sudah disanitasi.
--    Duplicate webhook tidak membuat aktivasi lisensi kedua kali.
-- --------------------------------------------------------------------------
create table if not exists public.ldm2_midtrans_events (
    event_key text primary key,
    payment_id uuid references public.ldm2_payments(id) on delete set null,
    license_id uuid references public.ldm2_licenses(id) on delete set null,
    order_id text not null,
    source text not null default 'webhook',
    transaction_id text,
    transaction_status text,
    status_code text,
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

create index if not exists idx_ldm2_midtrans_events_order_time
    on public.ldm2_midtrans_events(order_id, last_received_at desc);
create index if not exists idx_ldm2_midtrans_events_unprocessed
    on public.ldm2_midtrans_events(last_received_at)
    where processed_at is null;

alter table public.ldm2_midtrans_events enable row level security;
revoke all on table public.ldm2_midtrans_events from public,anon,authenticated;
grant all on table public.ldm2_midtrans_events to service_role;

-- Register/upsert event. Kalau event yang sama datang lagi setelah gagal,
-- event tetap boleh diproses ulang. Hanya processed_at yang menandakan sukses.
create or replace function public.ldm2_register_midtrans_event(
    p_event_key text,
    p_order_id text,
    p_source text,
    p_transaction_id text,
    p_transaction_status text,
    p_status_code text,
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
    v_event public.ldm2_midtrans_events%rowtype;
begin
    if nullif(btrim(p_event_key),'') is null then
        raise exception 'Event key wajib diisi.';
    end if;
    if nullif(btrim(p_order_id),'') is null then
        raise exception 'Order ID wajib diisi.';
    end if;

    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id);

    insert into public.ldm2_midtrans_events(
        event_key,payment_id,license_id,order_id,source,transaction_id,
        transaction_status,status_code,gross_amount,signature_valid,verified_at,
        provider_detail
    ) values (
        left(btrim(p_event_key),128),v_payment.id,v_payment.license_id,btrim(p_order_id),
        left(coalesce(nullif(btrim(p_source),''),'webhook'),80),
        nullif(left(btrim(coalesce(p_transaction_id,'')),160),''),
        nullif(left(lower(btrim(coalesce(p_transaction_status,''))),40),''),
        nullif(left(btrim(coalesce(p_status_code,'')),20),''),
        p_gross_amount,p_signature_valid,
        case when p_signature_valid is true then now() else null end,
        coalesce(p_provider_detail,'{}'::jsonb)
    )
    on conflict(event_key) do update
    set receive_count=public.ldm2_midtrans_events.receive_count+1,
        last_received_at=now(),
        payment_id=coalesce(public.ldm2_midtrans_events.payment_id,excluded.payment_id),
        license_id=coalesce(public.ldm2_midtrans_events.license_id,excluded.license_id),
        signature_valid=coalesce(excluded.signature_valid,public.ldm2_midtrans_events.signature_valid),
        verified_at=case
            when excluded.signature_valid is true then coalesce(public.ldm2_midtrans_events.verified_at,now())
            else public.ldm2_midtrans_events.verified_at
        end,
        provider_detail=coalesce(public.ldm2_midtrans_events.provider_detail,'{}'::jsonb)
            || coalesce(excluded.provider_detail,'{}'::jsonb)
    returning * into v_event;

    return jsonb_build_object(
        'ok',true,
        'event_key',v_event.event_key,
        'receive_count',v_event.receive_count,
        'already_processed',v_event.processed_at is not null,
        'order_known',v_event.payment_id is not null
    );
end;
$$;

create or replace function public.ldm2_finish_midtrans_event(
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
    update public.ldm2_midtrans_events
    set processed_at=case when p_success then coalesce(processed_at,now()) else processed_at end,
        processing_error=case when p_success then null else left(coalesce(p_error,'Midtrans event gagal diproses'),1000) end,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)||coalesce(p_provider_detail,'{}'::jsonb),
        last_received_at=now()
    where event_key=left(btrim(p_event_key),128);
end;
$$;

create or replace function public.ldm2_mark_midtrans_reconciliation(
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
        last_reconcile_error=case when p_success then null else left(coalesce(p_error,'Rekonsiliasi Midtrans gagal'),1000) end,
        last_provider_event_source=left(coalesce(nullif(btrim(p_source),''),'reconcile'),120),
        last_provider_event_at=now()
    where order_id=btrim(p_order_id);
end;
$$;

-- Kandidat untuk Edge Function reconciliation. Tidak melakukan HTTP dari SQL.
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
    where p.status in ('pending','challenge')
      and p.created_at <= now() - make_interval(secs=>greatest(30,least(coalesce(p_min_age_seconds,120),86400)))
      and p.created_at >= now() - make_interval(days=>greatest(1,least(coalesce(p_max_age_days,7),30)))
      and (
          p.last_reconciled_at is null
          or p.last_reconciled_at <= now() - interval '2 minutes'
      )
    order by coalesce(p.last_reconciled_at,p.created_at),p.created_at
    limit greatest(1,least(coalesce(p_limit,25),100));
$$;

-- --------------------------------------------------------------------------
-- 3. State machine Midtrans yang monotonic/idempotent.
--    PAID tidak boleh turun kembali ke PENDING/EXPIRED/CANCELLED/FAILED.
--    REFUND dicatat tetapi tidak otomatis mencabut lisensi.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_apply_midtrans_notification(
    p_order_id text,
    p_transaction_id text,
    p_transaction_status text,
    p_fraud_status text,
    p_status_code text,
    p_gross_amount numeric,
    p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_gateway_status text := lower(btrim(coalesce(p_transaction_status,'')));
    v_fraud text := lower(btrim(coalesce(p_fraud_status,'')));
    v_current_status text;
    v_candidate_status text;
    v_effective_status text;
    v_success boolean := false;
    v_stale boolean := false;
    v_base timestamptz;
    v_expiry timestamptz;
    v_source text := left(coalesce(nullif(btrim(coalesce(p_provider_detail->>'synced_by','')),''),'midtrans'),120);
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
    for update;

    if not found then
        return jsonb_build_object('ok',false,'code','ORDER_NOT_FOUND','message','Order ID tidak dikenal.');
    end if;

    if not (p_gross_amount is not null and round(p_gross_amount)::bigint = v_payment.amount) then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object(
            'order_id',v_payment.order_id,'expected',v_payment.amount,'received',p_gross_amount,
            'provider_status',v_gateway_status,'source',v_source
        ));
        return jsonb_build_object('ok',false,'code','AMOUNT_MISMATCH','message','Nominal pembayaran tidak sesuai order.');
    end if;

    v_current_status := lower(coalesce(v_payment.status,'pending'));
    v_success := btrim(coalesce(p_status_code,''))='200' and (
        v_gateway_status='settlement'
        or (v_gateway_status='capture' and coalesce(v_fraud,'accept')='accept')
    );

    v_candidate_status := case
        when v_success then 'paid'
        when v_gateway_status='pending' then 'pending'
        when v_gateway_status='capture' and v_fraud='challenge' then 'challenge'
        when v_gateway_status='expire' then 'expired'
        when v_gateway_status='cancel' then 'cancelled'
        when v_gateway_status in ('deny','failure') then 'failed'
        when v_gateway_status='partial_refund' then 'partially_refunded'
        when v_gateway_status='refund' then 'refunded'
        else v_current_status
    end;

    v_effective_status := v_candidate_status;

    -- Terminal-state protection. Status lama tidak boleh menurunkan hasil final.
    if v_current_status='refunded' and v_candidate_status<>'refunded' then
        v_effective_status := v_current_status;
        v_stale := true;
    elsif v_current_status='partially_refunded'
          and v_candidate_status not in ('partially_refunded','refunded') then
        v_effective_status := v_current_status;
        v_stale := true;
    elsif (v_current_status='paid' or v_payment.processed_at is not null)
          and v_candidate_status in ('pending','challenge','failed','expired','cancelled') then
        v_effective_status := 'paid';
        v_stale := true;
    elsif v_current_status in ('cancelled','expired','failed')
          and v_candidate_status in ('pending','challenge') then
        v_effective_status := v_current_status;
        v_stale := true;
    end if;

    update public.ldm2_payments
    set provider_transaction_id=coalesce(nullif(btrim(p_transaction_id),''),provider_transaction_id),
        provider_status=case when v_stale then provider_status else nullif(v_gateway_status,'') end,
        fraud_status=case when v_stale then fraud_status else nullif(v_fraud,'') end,
        status_code=case when v_stale then status_code else nullif(btrim(p_status_code),'') end,
        status=v_effective_status,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
            || coalesce(p_provider_detail,'{}'::jsonb)
            || jsonb_build_object(
                'last_incoming_status',v_gateway_status,
                'last_incoming_candidate',v_candidate_status,
                'last_event_stale_ignored',v_stale
            ),
        paid_at=case when v_success then coalesce(paid_at,now()) else paid_at end,
        refunded_at=case when v_candidate_status in ('refunded','partially_refunded') then coalesce(refunded_at,now()) else refunded_at end,
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
            'order_id',v_payment.order_id,'current_status',v_current_status,
            'incoming_status',v_gateway_status,'candidate_status',v_candidate_status,
            'source',v_source
        ));
        return jsonb_build_object(
            'ok',true,'processed',false,'ignored_stale',true,
            'order_id',v_payment.order_id,'payment_status',v_effective_status,
            'incoming_status',v_gateway_status
        );
    end if;

    -- Refund dicatat, tetapi lisensi tidak dicabut otomatis. Keputusan refund
    -- dan entitlement memerlukan kebijakan merchant/audit tersendiri.
    if v_candidate_status in ('refunded','partially_refunded') then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,
            case when v_candidate_status='refunded' then 'PAYMENT_REFUNDED' else 'PAYMENT_PARTIALLY_REFUNDED' end,
            jsonb_build_object(
                'order_id',v_payment.order_id,'payment_status',v_candidate_status,
                'provider_status',v_gateway_status,'source',v_source
            ));
        return jsonb_build_object(
            'ok',true,'processed',false,'refund_recorded',true,
            'order_id',v_payment.order_id,'payment_status',v_candidate_status,
            'license_action','manual_review_required'
        );
    end if;

    if not v_success then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_STATUS_UPDATED',jsonb_build_object(
            'order_id',v_payment.order_id,'payment_status',v_effective_status,
            'provider_status',v_gateway_status,'source',v_source
        ));
        return jsonb_build_object(
            'ok',true,'processed',false,'order_id',v_payment.order_id,
            'payment_status',v_effective_status
        );
    end if;

    -- Idempotency: duplicate success tidak mengaktifkan/renew lisensi kedua kali.
    if v_payment.processed_at is not null then
        return jsonb_build_object(
            'ok',true,'processed',false,'duplicate',true,
            'order_id',v_payment.order_id,'payment_status','paid'
        );
    end if;

    select * into v_license
    from public.ldm2_licenses
    where id=v_payment.license_id
    for update;

    if not found then raise exception 'Lisensi order tidak ditemukan.'; end if;

    if v_payment.payment_type='purchase' then
        v_expiry := case
            when v_payment.billing_cycle='lifetime' then null
            else now()+make_interval(months=>v_payment.duration_months)
        end;
        update public.ldm2_licenses
        set status='active',starts_at=coalesce(starts_at,now()),expires_at=v_expiry
        where id=v_license.id;
    elsif v_payment.payment_type='conversion' then
        v_expiry := case
            when v_payment.billing_cycle='lifetime' then null
            else now()+make_interval(months=>v_payment.duration_months)
        end;
        update public.ldm2_licenses
        set status='active',plan_code=v_payment.plan_code,is_trial=false,trial_identity_hash=null,
            key_hash=v_payment.license_key_hash,key_prefix=v_payment.license_key_prefix,
            starts_at=now(),expires_at=v_expiry,
            max_devices_override=null,max_stores_override=null
        where id=v_license.id;
    else
        v_base := greatest(now(),coalesce(v_license.expires_at,now()));
        v_expiry := v_base+make_interval(months=>v_payment.duration_months);
        update public.ldm2_licenses
        set status='active',expires_at=v_expiry
        where id=v_license.id;
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
            'amount',v_payment.amount,'expires_at',v_expiry,'provider','midtrans','source',v_source
        ));

    return jsonb_build_object(
        'ok',true,'processed',true,'order_id',v_payment.order_id,'payment_status','paid',
        'license_id',v_license.id,'license_status','active','expires_at',v_expiry,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'network_id',v_license.network_id
    );
end;
$$;

revoke all on function public.ldm2_register_midtrans_event(text,text,text,text,text,text,numeric,boolean,jsonb)
    from public,anon,authenticated;
revoke all on function public.ldm2_finish_midtrans_event(text,boolean,text,jsonb)
    from public,anon,authenticated;
revoke all on function public.ldm2_mark_midtrans_reconciliation(text,boolean,text,text)
    from public,anon,authenticated;
revoke all on function public.ldm2_midtrans_reconciliation_candidates(integer,integer,integer)
    from public,anon,authenticated;
revoke all on function public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)
    from public,anon,authenticated;

grant execute on function public.ldm2_register_midtrans_event(text,text,text,text,text,text,numeric,boolean,jsonb)
    to service_role;
grant execute on function public.ldm2_finish_midtrans_event(text,boolean,text,jsonb)
    to service_role;
grant execute on function public.ldm2_mark_midtrans_reconciliation(text,boolean,text,text)
    to service_role;
grant execute on function public.ldm2_midtrans_reconciliation_candidates(integer,integer,integer)
    to service_role;
grant execute on function public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)
    to service_role;

insert into public.ldm2_events(license_id,event_type,detail)
select null,'SYSTEM_PATCH',jsonb_build_object(
    'version','27.9.0-commercial-06-v19',
    'feature','MIDTRANS_PRODUCTION_HARDENING',
    'installed_at',now()
)
where not exists (
    select 1 from public.ldm2_events
    where event_type='SYSTEM_PATCH'
      and detail->>'version'='27.9.0-commercial-06-v19'
      and detail->>'feature'='MIDTRANS_PRODUCTION_HARDENING'
);

commit;

-- VERIFIKASI: seluruh kolom boolean harus TRUE.
select
    to_regclass('public.ldm2_midtrans_events') is not null as midtrans_event_table_ok,
    to_regprocedure('public.ldm2_register_midtrans_event(text,text,text,text,text,text,numeric,boolean,jsonb)') is not null as register_event_rpc_ok,
    to_regprocedure('public.ldm2_finish_midtrans_event(text,boolean,text,jsonb)') is not null as finish_event_rpc_ok,
    to_regprocedure('public.ldm2_mark_midtrans_reconciliation(text,boolean,text,text)') is not null as reconcile_mark_rpc_ok,
    to_regprocedure('public.ldm2_midtrans_reconciliation_candidates(integer,integer,integer)') is not null as reconcile_candidates_rpc_ok,
    to_regprocedure('public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb)') is not null as apply_midtrans_rpc_ok,
    exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='ldm2_payments' and column_name='last_reconciled_at'
    ) as reconcile_columns_ok,
    exists(
        select 1
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class r on r.oid=c.conrelid
        join pg_catalog.pg_namespace n on n.oid=r.relnamespace
        where n.nspname='public' and r.relname='ldm2_payments'
          and c.conname='ldm2_payments_status_check'
    ) as payment_status_constraint_ok;

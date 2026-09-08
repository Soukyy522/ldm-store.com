-- ============================================================================
-- LocDailyMar 27.9.0 - V28.2.5
-- SQL-18-INTERNAL-FULL-REFUND-POLICY-V28.2.5.sql
--
-- Tujuan:
-- 1. Refund customer menjadi kebijakan INTERNAL LocDailyMar, bukan kebijakan LYNK.ID.
-- 2. Pengajuan hanya maksimal 24 jam setelah pembayaran terverifikasi.
-- 3. Hanya REFUND PENUH. Partial refund tidak tersedia untuk request baru.
-- 4. Email dan alasan wajib.
-- 5. Estimasi pemrosesan 2-3 hari kerja.
-- 6. Request customer tetap menggunakan kode RFD-YYYYMMDD-XXXXXXXXXX.
--
-- Jalankan HANYA pada Supabase PROJECT LICENSE AUTHORITY V2:
-- vplweadbeujidsoponrl
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_refund_policy') is null
       or to_regclass('public.ldm2_refund_requests') is null
       or to_regclass('public.ldm2_refunds') is null
       or to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null then
        raise exception 'Fondasi Refund Management belum lengkap. Pasang SQL-15/SQL-16 lebih dahulu.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- Policy columns. Kolom legacy provider tetap dipertahankan agar migration lama
-- tidak rusak, tetapi policy aktif sekarang adalah kebijakan internal LocDailyMar.
-- --------------------------------------------------------------------------
alter table public.ldm2_refund_policy
    add column if not exists refund_window_hours integer not null default 24,
    add column if not exists processing_business_days_min integer not null default 2,
    add column if not exists processing_business_days_max integer not null default 3;

alter table public.ldm2_refund_policy
    drop constraint if exists ldm2_refund_policy_processing_business_days_check;

alter table public.ldm2_refund_policy
    add constraint ldm2_refund_policy_processing_business_days_check
    check (
        processing_business_days_min between 1 and 30
        and processing_business_days_max between processing_business_days_min and 30
    );

-- Kolom ini dibuat NOT NULL oleh migration LYNK public terms.
-- Sekarang source URL eksternal tidak diperlukan.
alter table public.ldm2_refund_policy
    alter column policy_source_url drop not null;

update public.ldm2_refund_policy
set enabled=true,
    refund_window_days=1,
    refund_window_hours=24,
    allow_partial_refund=false,
    min_reason_length=20,
    processing_business_days_min=2,
    processing_business_days_max=3,
    policy_version='locdailymar-internal-full-refund-2026-09-09-v1',
    policy_basis='locdailymar_internal',
    policy_source_url=null,
    only_non_delivery=false,
    exclude_transaction_fees=false,
    creator_confirmation_hours=0,
    policy_summary='Refund penuh dapat diajukan maksimal 24 jam sejak pembayaran terverifikasi. Customer wajib mencantumkan email, kategori alasan, dan penjelasan. Permintaan yang diterima diproses sekitar 2-3 hari kerja.',
    updated_at=now(),
    updated_by='SQL-18-INTERNAL-FULL-REFUND-POLICY-V28.2.5'
where id=1;

-- --------------------------------------------------------------------------
-- Request processing estimate.
-- --------------------------------------------------------------------------
alter table public.ldm2_refund_requests
    add column if not exists processing_estimate_start_at timestamptz,
    add column if not exists processing_due_at timestamptz;

-- Kategori alasan internal. "not_delivered" tetap dipertahankan untuk request lama.
alter table public.ldm2_refund_requests
    drop constraint if exists ldm2_refund_requests_reason_category_check;

alter table public.ldm2_refund_requests
    add constraint ldm2_refund_requests_reason_category_check check (
        reason_category in (
            'not_delivered',
            'duplicate_payment',
            'wrong_plan',
            'wrong_period',
            'provisioning_issue',
            'technical_issue',
            'service_issue',
            'changed_mind',
            'other'
        )
    );

-- --------------------------------------------------------------------------
-- Helper: tambah N hari kerja (Senin-Jumat).
-- Hari libur nasional tidak dihitung oleh helper database ini, sehingga tanggal
-- yang ditampilkan tetap merupakan estimasi operasional.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_add_business_days(
    p_start timestamptz,
    p_days integer
)
returns timestamptz
language plpgsql
immutable
set search_path=''
as $$
declare
    v_result timestamptz := p_start;
    v_added integer := 0;
    v_dow integer;
begin
    if p_start is null then return null; end if;
    if coalesce(p_days,0) <= 0 then return p_start; end if;

    while v_added < p_days loop
        v_result := v_result + interval '1 day';
        v_dow := extract(isodow from v_result);
        if v_dow between 1 and 5 then
            v_added := v_added + 1;
        end if;
    end loop;
    return v_result;
end;
$$;

-- --------------------------------------------------------------------------
-- Public policy via service-role Edge Function.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_get_refund_policy()
returns jsonb
language plpgsql
security definer
set search_path=''
stable
as $$
declare
    v_policy public.ldm2_refund_policy%rowtype;
begin
    select * into v_policy
    from public.ldm2_refund_policy
    where id=1;

    if not found then
        return jsonb_build_object(
            'enabled',true,
            'refund_window_days',1,
            'refund_window_hours',24,
            'allow_partial_refund',false,
            'min_reason_length',20,
            'processing_business_days_min',2,
            'processing_business_days_max',3,
            'processing_sla_label','2-3 hari kerja',
            'policy_version','locdailymar-internal-full-refund-fallback',
            'policy_basis','locdailymar_internal',
            'policy_source_url',null
        );
    end if;

    return jsonb_build_object(
        'enabled',v_policy.enabled,
        'refund_window_days',1,
        'refund_window_hours',coalesce(v_policy.refund_window_hours,24),
        'allow_partial_refund',false,
        'min_reason_length',v_policy.min_reason_length,
        'processing_business_days_min',coalesce(v_policy.processing_business_days_min,2),
        'processing_business_days_max',coalesce(v_policy.processing_business_days_max,3),
        'processing_sla_label',format('%s-%s hari kerja',
            coalesce(v_policy.processing_business_days_min,2),
            coalesce(v_policy.processing_business_days_max,3)
        ),
        'policy_version',v_policy.policy_version,
        'policy_summary',v_policy.policy_summary,
        'policy_basis','locdailymar_internal',
        'policy_source_url',null,
        'updated_at',v_policy.updated_at
    );
end;
$$;

-- --------------------------------------------------------------------------
-- Eligibility internal: harus PAID, belum direfund, dan <= 24 jam.
-- --------------------------------------------------------------------------
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
    v_deadline timestamptz;
    v_eligible boolean := false;
    v_reason text := null;
begin
    select * into v_payment
    from public.ldm2_payments
    where id=p_payment_id;

    if not found then
        return jsonb_build_object(
            'ok',false,
            'eligible',false,
            'code','PAYMENT_NOT_FOUND',
            'message','Pembayaran tidak ditemukan.'
        );
    end if;

    select * into v_policy
    from public.ldm2_refund_policy
    where id=1;

    if not found then
        raise exception 'Kebijakan refund belum tersedia.';
    end if;

    select coalesce(sum(amount),0)::bigint
    into v_committed
    from public.ldm2_refunds
    where payment_id=v_payment.id
      and status in ('requested','accepted','completed','unknown');

    v_deadline := case
        when v_payment.paid_at is not null
        then v_payment.paid_at + make_interval(hours=>coalesce(v_policy.refund_window_hours,24))
        else null
    end;

    if not v_policy.enabled then
        v_reason := 'Refund sedang dinonaktifkan.';
    elsif lower(coalesce(v_payment.status,'')) <> 'paid' then
        v_reason := format('Status pembayaran %s tidak memenuhi syarat refund penuh.',coalesce(v_payment.status,'-'));
    elsif v_payment.paid_at is null then
        v_reason := 'Waktu pembayaran terverifikasi tidak tersedia.';
    elsif now() > v_deadline then
        v_reason := 'Batas pengajuan refund sudah lewat 24 jam sejak pembayaran.';
    elsif v_committed > 0 or coalesce(v_payment.refund_amount,0) > 0 then
        v_reason := 'Pembayaran ini sudah memiliki proses/riwayat refund sehingga refund penuh baru tidak dapat diajukan.';
    elsif coalesce(v_payment.amount,0) <= 0 then
        v_reason := 'Nilai pembayaran tidak valid.';
    else
        v_eligible := true;
    end if;

    return jsonb_build_object(
        'ok',true,
        'eligible',v_eligible,
        'reason',v_reason,
        'payment_id',v_payment.id,
        'order_id',v_payment.order_id,
        'payment_status',v_payment.status,
        'provider_status',v_payment.provider_status,
        'amount',v_payment.amount,
        'paid_at',v_payment.paid_at,
        'refund_deadline',v_deadline,
        'refund_window_days',1,
        'refund_window_hours',24,
        'refund_type','full',
        'allow_partial_refund',false,
        'full_refund_amount',v_payment.amount,
        'remaining_refundable',case when v_eligible then v_payment.amount else greatest(v_payment.amount-v_committed,0) end,
        'already_refunded_or_reserved',v_committed,
        'min_reason_length',v_policy.min_reason_length,
        'processing_business_days_min',coalesce(v_policy.processing_business_days_min,2),
        'processing_business_days_max',coalesce(v_policy.processing_business_days_max,3),
        'processing_sla_label',format('%s-%s hari kerja',
            coalesce(v_policy.processing_business_days_min,2),
            coalesce(v_policy.processing_business_days_max,3)
        ),
        'policy_version',v_policy.policy_version,
        'policy_basis','locdailymar_internal',
        'policy_source_url',null,
        'requires_email',true,
        'requires_reason',true
    );
end;
$$;

-- --------------------------------------------------------------------------
-- Customer request V2: email wajib dan harus sama dengan email pembelian.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_create_customer_refund_request_v2(
    p_payment_id uuid,
    p_request_code text,
    p_refund_type text,
    p_requested_amount bigint,
    p_reason_category text,
    p_reason_detail text,
    p_requester_email text
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
    v_type text := lower(btrim(coalesce(p_refund_type,'')));
    v_category text := lower(btrim(coalesce(p_reason_category,'')));
    v_detail text := btrim(coalesce(p_reason_detail,''));
    v_email text := lower(btrim(coalesce(p_requester_email,'')));
    v_expected_email text;
    v_amount bigint;
    v_process_start timestamptz;
    v_process_due timestamptz;
begin
    if upper(btrim(coalesce(p_request_code,''))) !~ '^RFD-[0-9]{8}-[A-F0-9]{10}$' then
        raise exception 'Format kode permintaan refund tidak valid.';
    end if;

    select * into v_payment
    from public.ldm2_payments
    where id=p_payment_id
    for update;
    if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;

    select * into v_license
    from public.ldm2_licenses
    where id=v_payment.license_id;
    if not found then raise exception 'Lisensi pembayaran tidak ditemukan.'; end if;

    v_elig := public.ldm2_refund_eligibility(v_payment.id);
    if coalesce((v_elig->>'eligible')::boolean,false) is not true then
        raise exception '%',coalesce(v_elig->>'reason','Pembayaran tidak memenuhi kebijakan refund.');
    end if;

    if v_type <> 'full' then
        raise exception 'Refund customer saat ini hanya tersedia untuk Refund Penuh.';
    end if;

    if v_category not in (
        'duplicate_payment','wrong_plan','wrong_period','provisioning_issue',
        'technical_issue','service_issue','changed_mind','other'
    ) then
        raise exception 'Kategori alasan refund tidak valid.';
    end if;

    if length(v_detail) < 20 then
        raise exception 'Alasan refund minimal 20 karakter.';
    end if;
    if length(v_detail) > 1500 then
        raise exception 'Alasan refund maksimal 1500 karakter.';
    end if;

    if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'Email refund tidak valid.';
    end if;

    v_expected_email := lower(btrim(coalesce(v_license.customer_email,'')));
    if v_expected_email = '' then
        raise exception 'Email pembelian tidak tersedia pada lisensi.';
    end if;
    if v_email <> v_expected_email then
        raise exception 'Email refund harus sama dengan email yang digunakan saat pembelian.';
    end if;

    if exists(
        select 1
        from public.ldm2_refund_requests
        where payment_id=v_payment.id
          and status in ('submitted','reviewing','waiting_customer','approved','processing')
    ) then
        raise exception 'Masih ada permintaan refund aktif untuk pembayaran ini.';
    end if;

    v_amount := v_payment.amount;

    if p_requested_amount is not null
       and p_requested_amount > 0
       and p_requested_amount <> v_amount then
        raise exception 'Refund penuh harus menggunakan seluruh nilai transaksi (%).',v_amount;
    end if;

    v_process_start := public.ldm2_add_business_days(now(),2);
    v_process_due := public.ldm2_add_business_days(now(),3);

    insert into public.ldm2_refund_requests(
        request_code,payment_id,license_id,order_id,
        refund_type,requested_amount,
        reason_category,reason_detail,
        requester_name,requester_email,requester_phone,
        status,policy_version,refund_deadline,eligibility_snapshot,
        policy_route,terms_source_url,claim_basis,
        processing_estimate_start_at,processing_due_at
    ) values (
        upper(btrim(p_request_code)),v_payment.id,v_payment.license_id,v_payment.order_id,
        'full',v_amount,
        v_category,v_detail,
        v_license.customer_name,v_email,v_license.customer_phone,
        'submitted',v_elig->>'policy_version',(v_elig->>'refund_deadline')::timestamptz,v_elig,
        'locdailymar_internal_24h',null,v_category,
        v_process_start,v_process_due
    )
    returning * into v_request;

    return jsonb_build_object(
        'ok',true,
        'request_code',v_request.request_code,
        'status',v_request.status,
        'order_id',v_request.order_id,
        'refund_type','full',
        'requested_amount',v_request.requested_amount,
        'reason_category',v_request.reason_category,
        'requester_email',v_request.requester_email,
        'refund_deadline',v_request.refund_deadline,
        'processing_business_days_min',2,
        'processing_business_days_max',3,
        'processing_sla_label','2-3 hari kerja',
        'processing_estimate_start_at',v_request.processing_estimate_start_at,
        'processing_due_at',v_request.processing_due_at,
        'created_at',v_request.created_at,
        'policy_route','locdailymar_internal_24h'
    );
end;
$$;

-- --------------------------------------------------------------------------
-- Developer ledger: request baru hanya full refund dengan nominal transaksi penuh.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_prepare_refund(
    p_payment_id uuid,
    p_refund_key text,
    p_refund_type text,
    p_amount bigint,
    p_reason text,
    p_admin_user_id uuid,
    p_admin_email text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_reason text := btrim(coalesce(p_reason,''));
    v_refund public.ldm2_refunds%rowtype;
    v_committed bigint := 0;
begin
    select * into v_payment
    from public.ldm2_payments
    where id=p_payment_id
    for update;
    if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;

    if lower(coalesce(v_payment.status,'')) <> 'paid' then
        raise exception 'Payment harus berstatus PAID untuk refund penuh.';
    end if;

    if lower(btrim(coalesce(p_refund_type,''))) <> 'full' then
        raise exception 'Refund baru hanya mendukung Refund Penuh.';
    end if;

    if length(v_reason) < 20 then
        raise exception 'Catatan proses refund minimal 20 karakter.';
    end if;
    if length(v_reason) > 500 then
        raise exception 'Catatan proses refund maksimal 500 karakter.';
    end if;

    if p_amount is null or p_amount <> v_payment.amount then
        raise exception 'Nominal Refund Penuh harus sama dengan nilai transaksi (%).',v_payment.amount;
    end if;

    select coalesce(sum(amount),0)::bigint
    into v_committed
    from public.ldm2_refunds
    where payment_id=v_payment.id
      and status in ('requested','accepted','completed','unknown');

    if v_committed > 0 or coalesce(v_payment.refund_amount,0) > 0 then
        raise exception 'Pembayaran ini sudah memiliki refund/ledger refund.';
    end if;

    insert into public.ldm2_refunds(
        payment_id,license_id,order_id,
        refund_key,refund_type,amount,reason,status,
        requested_by_user_id,requested_by_email
    )
    values(
        v_payment.id,v_payment.license_id,v_payment.order_id,
        left(btrim(p_refund_key),120),'full',v_payment.amount,left(v_reason,500),'requested',
        p_admin_user_id,left(lower(btrim(coalesce(p_admin_email,''))),180)
    )
    returning * into v_refund;

    return jsonb_build_object(
        'ok',true,
        'refund_id',v_refund.id,
        'refund_key',v_refund.refund_key,
        'refund_type','full',
        'amount',v_refund.amount,
        'order_id',v_payment.order_id,
        'payment_id',v_payment.id,
        'license_id',v_payment.license_id,
        'policy_basis','locdailymar_internal'
    );
end;
$$;

revoke all on function public.ldm2_add_business_days(timestamptz,integer) from public,anon,authenticated;
revoke all on function public.ldm2_get_refund_policy() from public,anon,authenticated;
revoke all on function public.ldm2_refund_eligibility(uuid) from public,anon,authenticated;
revoke all on function public.ldm2_create_customer_refund_request_v2(uuid,text,text,bigint,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) from public,anon,authenticated;

grant execute on function public.ldm2_add_business_days(timestamptz,integer) to service_role;
grant execute on function public.ldm2_get_refund_policy() to service_role;
grant execute on function public.ldm2_refund_eligibility(uuid) to service_role;
grant execute on function public.ldm2_create_customer_refund_request_v2(uuid,text,text,bigint,text,text,text) to service_role;
grant execute on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) to service_role;

commit;

-- ============================================================================
-- VALIDASI
-- ============================================================================
select
    to_regprocedure('public.ldm2_get_refund_policy()') is not null as policy_rpc_ok,
    to_regprocedure('public.ldm2_refund_eligibility(uuid)') is not null as eligibility_rpc_ok,
    to_regprocedure('public.ldm2_create_customer_refund_request_v2(uuid,text,text,bigint,text,text,text)') is not null as customer_request_v2_rpc_ok,
    to_regprocedure('public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text)') is not null as prepare_refund_rpc_ok;

select
    id,enabled,refund_window_hours,allow_partial_refund,
    processing_business_days_min,processing_business_days_max,
    policy_version,policy_basis,policy_source_url,policy_summary
from public.ldm2_refund_policy
where id=1;

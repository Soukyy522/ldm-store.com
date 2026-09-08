-- ============================================================================
-- LocDailyMar 27.9.0 - V28
-- LYNK.ID CUSTOMER CANCEL ORDER + REFUND REQUEST
-- Jalankan HANYA pada Supabase PROJECT LICENSE AUTHORITY V2.
-- Project ref: vplweadbeujidsoponrl
--
-- Isi file ini:
--   A. Refund Policy + Refund Ledger (idempotent)
--   B. Customer Refund Request / RFD (idempotent)
--   C. Cancel order publik Lynk.id + proteksi payment-after-cancel
-- ============================================================================

-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06
-- REFUND MANAGEMENT + REFUND POLICY V20
-- Jalankan HANYA pada Supabase PROJECT LICENSE AUTHORITY V2.
-- Prasyarat: fondasi payment/refund License Authority sudah terpasang.
-- Aman dijalankan ulang (idempotent).
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regclass('public.ldm2_admin_audit') is null then
        raise exception 'Fondasi License Authority/payment belum lengkap. Pasang migration fondasi sebelumnya terlebih dahulu.';
    end if;
    if not exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='ldm2_payments' and column_name='refund_amount'
    ) then
        raise exception 'Fondasi refund belum lengkap. Kolom refund_amount tidak ditemukan.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Kebijakan Refund LocDailyMar.
--    Hanya satu row aktif (id=1). Nilai default 3 hari kalender sejak paid_at.
--    Ubah refund_window_days bila kebijakan bisnis berubah.
-- --------------------------------------------------------------------------
create table if not exists public.ldm2_refund_policy (
    id smallint primary key default 1 check (id = 1),
    enabled boolean not null default true,
    refund_window_days integer not null default 3 check (refund_window_days between 1 and 30),
    allow_partial_refund boolean not null default true,
    min_reason_length integer not null default 10 check (min_reason_length between 5 and 100),
    policy_version text not null default '2026-09-v1',
    policy_summary text not null default 'Refund dapat diajukan maksimal 3 hari kalender sejak pembayaran terverifikasi. Refund hanya diproses untuk transaksi yang memenuhi syarat provider dan kebijakan LocDailyMar.',
    updated_at timestamptz not null default now(),
    updated_by text
);

insert into public.ldm2_refund_policy(id)
values (1)
on conflict (id) do nothing;

alter table public.ldm2_refund_policy enable row level security;
revoke all on table public.ldm2_refund_policy from public, anon, authenticated;
grant all on table public.ldm2_refund_policy to service_role;

-- --------------------------------------------------------------------------
-- 2. Riwayat refund.
--    refund_key unik mencegah retry request yang sama menghasilkan refund ganda.
-- --------------------------------------------------------------------------
create table if not exists public.ldm2_refunds (
    id uuid primary key default extensions.gen_random_uuid(),
    payment_id uuid not null references public.ldm2_payments(id) on delete restrict,
    license_id uuid not null references public.ldm2_licenses(id) on delete restrict,
    order_id text not null,
    refund_key text not null unique,
    refund_type text not null check (refund_type in ('full','partial')),
    amount bigint not null check (amount > 0),
    reason text not null,
    status text not null default 'requested'
        check (status in ('requested','accepted','completed','failed','unknown','rejected')),
    provider_status text,
    provider_transaction_id text,
    provider_response jsonb not null default '{}'::jsonb,
    error_message text,
    requested_by_user_id uuid,
    requested_by_email text,
    requested_at timestamptz not null default now(),
    accepted_at timestamptz,
    completed_at timestamptz,
    failed_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists idx_ldm2_refunds_payment_time
    on public.ldm2_refunds(payment_id, requested_at desc);
create index if not exists idx_ldm2_refunds_order_time
    on public.ldm2_refunds(order_id, requested_at desc);
create index if not exists idx_ldm2_refunds_status_time
    on public.ldm2_refunds(status, requested_at desc);

alter table public.ldm2_refunds enable row level security;
revoke all on table public.ldm2_refunds from public, anon, authenticated;
grant all on table public.ldm2_refunds to service_role;

-- --------------------------------------------------------------------------
-- 3. Helper policy publik via server-side Edge Function.
--    Tidak diberikan langsung ke anon/authenticated.
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
    select * into v_policy from public.ldm2_refund_policy where id=1;
    if not found then
        return jsonb_build_object(
            'enabled',true,
            'refund_window_days',3,
            'allow_partial_refund',true,
            'min_reason_length',10,
            'policy_version','fallback-v1'
        );
    end if;
    return jsonb_build_object(
        'enabled',v_policy.enabled,
        'refund_window_days',v_policy.refund_window_days,
        'allow_partial_refund',v_policy.allow_partial_refund,
        'min_reason_length',v_policy.min_reason_length,
        'policy_version',v_policy.policy_version,
        'policy_summary',v_policy.policy_summary,
        'updated_at',v_policy.updated_at
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 4. Eligibility. Menghitung batas refund dari paid_at + policy days.
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
    v_remaining bigint := 0;
    v_deadline timestamptz;
    v_eligible boolean := false;
    v_reason text := null;
begin
    select * into v_payment from public.ldm2_payments where id=p_payment_id;
    if not found then
        return jsonb_build_object('ok',false,'eligible',false,'code','PAYMENT_NOT_FOUND','message','Pembayaran tidak ditemukan.');
    end if;

    select * into v_policy from public.ldm2_refund_policy where id=1;
    if not found then
        raise exception 'Kebijakan refund belum tersedia.';
    end if;

    select coalesce(sum(amount),0)::bigint into v_committed
    from public.ldm2_refunds
    where payment_id=v_payment.id
      and status in ('requested','accepted','completed','unknown');

    v_remaining := greatest(v_payment.amount - v_committed, 0);
    v_deadline := case when v_payment.paid_at is not null
        then v_payment.paid_at + make_interval(days => v_policy.refund_window_days)
        else null end;

    if not v_policy.enabled then
        v_reason := 'Refund sedang dinonaktifkan oleh kebijakan merchant.';
    elsif v_payment.status not in ('paid','partially_refunded') then
        v_reason := format('Status pembayaran %s tidak memenuhi syarat refund.', coalesce(v_payment.status,'-'));
    elsif v_payment.paid_at is null then
        v_reason := 'Waktu pembayaran terverifikasi tidak tersedia.';
    elsif now() > v_deadline then
        v_reason := format('Batas refund %s hari telah berakhir.', v_policy.refund_window_days);
    elsif v_remaining <= 0 then
        v_reason := 'Tidak ada nominal tersisa yang dapat direfund.';
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
        'refund_window_days',v_policy.refund_window_days,
        'allow_partial_refund',v_policy.allow_partial_refund,
        'min_reason_length',v_policy.min_reason_length,
        'already_refunded_or_reserved',v_committed,
        'remaining_refundable',v_remaining,
        'policy_version',v_policy.policy_version
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 5. Reserve refund secara atomic sebelum refund diproses oleh provider/prosedur merchant.
--    Ini menutup race condition dua developer menekan Refund bersamaan.
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
    v_policy public.ldm2_refund_policy%rowtype;
    v_committed bigint := 0;
    v_remaining bigint := 0;
    v_deadline timestamptz;
    v_amount bigint;
    v_type text := lower(btrim(coalesce(p_refund_type,'')));
    v_reason text := btrim(coalesce(p_reason,''));
    v_refund public.ldm2_refunds%rowtype;
begin
    select * into v_payment
    from public.ldm2_payments
    where id=p_payment_id
    for update;
    if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;

    select * into v_policy from public.ldm2_refund_policy where id=1;
    if not found or not v_policy.enabled then raise exception 'Refund sedang dinonaktifkan.'; end if;

    if v_payment.status not in ('paid','partially_refunded') then
        raise exception 'Refund hanya tersedia untuk pembayaran PAID/PARTIALLY_REFUNDED.';
    end if;
    if v_payment.paid_at is null then raise exception 'Waktu pembayaran terverifikasi tidak tersedia.'; end if;

    v_deadline := v_payment.paid_at + make_interval(days => v_policy.refund_window_days);
    if now() > v_deadline then
        raise exception 'Batas refund % hari telah berakhir pada %.', v_policy.refund_window_days, v_deadline;
    end if;

    if length(v_reason) < v_policy.min_reason_length then
        raise exception 'Alasan refund minimal % karakter.', v_policy.min_reason_length;
    end if;
    if length(v_reason) > 255 then
        raise exception 'Alasan refund maksimal 255 karakter agar kompatibel dengan provider.';
    end if;
    if v_type not in ('full','partial') then raise exception 'Jenis refund harus full atau partial.'; end if;
    if v_type='partial' and not v_policy.allow_partial_refund then raise exception 'Partial refund dinonaktifkan oleh kebijakan merchant.'; end if;

    select coalesce(sum(amount),0)::bigint into v_committed
    from public.ldm2_refunds
    where payment_id=v_payment.id
      and status in ('requested','accepted','completed','unknown');
    v_remaining := greatest(v_payment.amount - v_committed, 0);
    if v_remaining <= 0 then raise exception 'Tidak ada nominal tersisa yang dapat direfund.'; end if;

    v_amount := case when v_type='full' then v_remaining else p_amount end;
    if v_amount is null or v_amount <= 0 then raise exception 'Nominal refund harus lebih dari 0.'; end if;
    if v_amount > v_remaining then raise exception 'Nominal refund melebihi sisa yang dapat direfund.'; end if;

    insert into public.ldm2_refunds(
        payment_id,license_id,order_id,refund_key,refund_type,amount,reason,status,
        requested_by_user_id,requested_by_email
    ) values (
        v_payment.id,v_payment.license_id,v_payment.order_id,left(btrim(p_refund_key),120),v_type,
        v_amount,left(v_reason,255),'requested',p_admin_user_id,left(lower(btrim(coalesce(p_admin_email,''))),180)
    )
    returning * into v_refund;

    return jsonb_build_object(
        'ok',true,
        'refund_id',v_refund.id,
        'refund_key',v_refund.refund_key,
        'refund_type',v_refund.refund_type,
        'amount',v_refund.amount,
        'remaining_before',v_remaining,
        'remaining_after_reservation',v_remaining-v_refund.amount,
        'refund_deadline',v_deadline,
        'order_id',v_payment.order_id,
        'payment_id',v_payment.id,
        'license_id',v_payment.license_id
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 6. Selesaikan request setelah respons provider.
--    successful provider response langsung memperbarui aggregate refund payment.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_finish_refund(
    p_refund_key text,
    p_success boolean,
    p_provider_status text,
    p_provider_transaction_id text,
    p_provider_response jsonb,
    p_error text default null,
    p_unknown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_refund public.ldm2_refunds%rowtype;
    v_payment public.ldm2_payments%rowtype;
    v_total bigint := 0;
    v_new_status text;
begin
    select * into v_refund
    from public.ldm2_refunds
    where refund_key=btrim(p_refund_key)
    for update;
    if not found then raise exception 'Refund key tidak ditemukan.'; end if;

    select * into v_payment
    from public.ldm2_payments
    where id=v_refund.payment_id
    for update;
    if not found then raise exception 'Payment refund tidak ditemukan.'; end if;

    if p_unknown then
        update public.ldm2_refunds
        set status='unknown', provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
            provider_transaction_id=nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),
            provider_response=coalesce(p_provider_response,'{}'::jsonb),
            error_message=left(coalesce(p_error,'Status refund belum dapat dipastikan.'),1000),updated_at=now()
        where id=v_refund.id;
        return jsonb_build_object('ok',true,'status','unknown','refund_key',v_refund.refund_key);
    end if;

    if not p_success then
        update public.ldm2_refunds
        set status='failed', provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
            provider_transaction_id=nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),
            provider_response=coalesce(p_provider_response,'{}'::jsonb),
            error_message=left(coalesce(p_error,'Refund ditolak provider.'),1000),failed_at=now(),updated_at=now()
        where id=v_refund.id;
        return jsonb_build_object('ok',true,'status','failed','refund_key',v_refund.refund_key);
    end if;

    update public.ldm2_refunds
    set status='accepted',
        provider_status=nullif(left(btrim(coalesce(p_provider_status,'')),80),''),
        provider_transaction_id=coalesce(nullif(left(btrim(coalesce(p_provider_transaction_id,'')),160),''),provider_transaction_id),
        provider_response=coalesce(p_provider_response,'{}'::jsonb),error_message=null,
        accepted_at=coalesce(accepted_at,now()),updated_at=now()
    where id=v_refund.id;

    select coalesce(sum(amount),0)::bigint into v_total
    from public.ldm2_refunds
    where payment_id=v_payment.id and status in ('accepted','completed');

    v_new_status := case when v_total >= v_payment.amount then 'refunded' else 'partially_refunded' end;
    update public.ldm2_payments
    set refund_amount=least(v_total,amount),
        refunded_at=coalesce(refunded_at,now()),
        status=v_new_status,
        provider_status=coalesce(nullif(lower(btrim(coalesce(p_provider_status,''))),''),provider_status),
        provider_detail=coalesce(provider_detail,'{}'::jsonb)||jsonb_build_object(
            'last_refund_key',v_refund.refund_key,
            'last_refund_amount',v_refund.amount,
            'refund_total',least(v_total,v_payment.amount),
            'refund_management','commercial-06-v20'
        ),
        payment_state_version=payment_state_version+1,
        updated_at=now()
    where id=v_payment.id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_payment.license_id,
        case when v_new_status='refunded' then 'PAYMENT_REFUNDED_BY_DEVELOPER' else 'PAYMENT_PARTIALLY_REFUNDED_BY_DEVELOPER' end,
        jsonb_build_object(
            'order_id',v_payment.order_id,'refund_key',v_refund.refund_key,
            'refund_amount',v_refund.amount,'refund_total',v_total,
            'payment_status',v_new_status
        ));

    return jsonb_build_object(
        'ok',true,'status','accepted','refund_key',v_refund.refund_key,
        'payment_status',v_new_status,'refund_amount',v_refund.amount,
        'refund_total',least(v_total,v_payment.amount),'remaining_refundable',greatest(v_payment.amount-v_total,0)
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 7. Permission hardening.
-- --------------------------------------------------------------------------
revoke all on function public.ldm2_get_refund_policy() from public,anon,authenticated;
revoke all on function public.ldm2_refund_eligibility(uuid) from public,anon,authenticated;
revoke all on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) from public,anon,authenticated;
revoke all on function public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean) from public,anon,authenticated;

grant execute on function public.ldm2_get_refund_policy() to service_role;
grant execute on function public.ldm2_refund_eligibility(uuid) to service_role;
grant execute on function public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text) to service_role;
grant execute on function public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean) to service_role;

commit;

-- --------------------------------------------------------------------------
-- VERIFIKASI. Semua nilai *_ok harus TRUE.
-- --------------------------------------------------------------------------
select
    to_regclass('public.ldm2_refund_policy') is not null as refund_policy_table_ok,
    to_regclass('public.ldm2_refunds') is not null as refunds_table_ok,
    to_regprocedure('public.ldm2_get_refund_policy()') is not null as refund_policy_rpc_ok,
    to_regprocedure('public.ldm2_refund_eligibility(uuid)') is not null as refund_eligibility_rpc_ok,
    to_regprocedure('public.ldm2_prepare_refund(uuid,text,text,bigint,text,uuid,text)') is not null as prepare_refund_rpc_ok,
    to_regprocedure('public.ldm2_finish_refund(text,boolean,text,text,jsonb,text,boolean)') is not null as finish_refund_rpc_ok;

select id,enabled,refund_window_days,allow_partial_refund,min_reason_length,policy_version,policy_summary,updated_at
from public.ldm2_refund_policy
where id=1;


-- ============================================================================
-- LocDailyMar 27.9.0 - COMMERCIAL #06
-- CUSTOMER REFUND REQUESTS + SUPPORT CENTER INTEGRATION V21
-- Jalankan HANYA pada Supabase PROJECT LICENSE AUTHORITY V2.
-- Prasyarat: SQL-42 Refund Management Policy V20 sudah terpasang.
-- Aman dijalankan ulang (idempotent).
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_refund_policy') is null
       or to_regclass('public.ldm2_refunds') is null
       or to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null then
        raise exception 'SQL-42 Refund Management Policy V20 belum lengkap. Jalankan SQL-42 terlebih dahulu.';
    end if;
    if to_regprocedure('public.ldm2_refund_eligibility(uuid)') is null then
        raise exception 'RPC ldm2_refund_eligibility belum tersedia. Jalankan SQL-42 terlebih dahulu.';
    end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Permintaan refund customer. Ini berbeda dari ldm2_refunds:
--    ldm2_refund_requests = permintaan/review customer (RFD-...)
--    ldm2_refunds          = pencatatan eksekusi refund oleh Developer
-- --------------------------------------------------------------------------
create table if not exists public.ldm2_refund_requests (
    id uuid primary key default extensions.gen_random_uuid(),
    request_code text not null unique,
    payment_id uuid not null references public.ldm2_payments(id) on delete restrict,
    license_id uuid not null references public.ldm2_licenses(id) on delete restrict,
    order_id text not null,

    refund_type text not null check (refund_type in ('full','partial')),
    requested_amount bigint not null check (requested_amount > 0),
    reason_category text not null check (reason_category in (
        'duplicate_payment','wrong_plan','wrong_period','provisioning_issue',
        'technical_issue','service_issue','changed_mind','other'
    )),
    reason_detail text not null,

    requester_name text,
    requester_email text,
    requester_phone text,

    status text not null default 'submitted' check (status in (
        'submitted','reviewing','waiting_customer','approved','processing',
        'completed','rejected','cancelled'
    )),
    response_note text,
    linked_refund_key text,

    policy_version text,
    refund_deadline timestamptz,
    eligibility_snapshot jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reviewed_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz
);

create index if not exists idx_ldm2_refund_requests_payment_time
    on public.ldm2_refund_requests(payment_id, created_at desc);
create index if not exists idx_ldm2_refund_requests_status_time
    on public.ldm2_refund_requests(status, created_at desc);
create index if not exists idx_ldm2_refund_requests_order_time
    on public.ldm2_refund_requests(order_id, created_at desc);

-- Satu request aktif per payment. Request completed/rejected/cancelled tidak
-- menghalangi request baru, selama payment masih eligible dan masih ada sisa.
create unique index if not exists uq_ldm2_refund_request_active_payment
    on public.ldm2_refund_requests(payment_id)
    where status in ('submitted','reviewing','waiting_customer','approved','processing');

alter table public.ldm2_refund_requests enable row level security;
revoke all on table public.ldm2_refund_requests from public, anon, authenticated;
grant all on table public.ldm2_refund_requests to service_role;

-- --------------------------------------------------------------------------
-- 2. Buat request customer setelah Public Checkout Edge Function memverifikasi
--    order_id + status_token. Eligibility dihitung ulang di DB.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_create_customer_refund_request(
    p_payment_id uuid,
    p_request_code text,
    p_refund_type text,
    p_requested_amount bigint,
    p_reason_category text,
    p_reason_detail text
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
    v_type text := lower(btrim(coalesce(p_refund_type,'')));
    v_category text := lower(btrim(coalesce(p_reason_category,'')));
    v_detail text := btrim(coalesce(p_reason_detail,''));
    v_amount bigint;
    v_remaining bigint;
    v_request public.ldm2_refund_requests%rowtype;
begin
    if upper(btrim(coalesce(p_request_code,''))) !~ '^RFD-[0-9]{8}-[A-F0-9]{10}$' then
        raise exception 'Format kode permintaan refund tidak valid.';
    end if;

    select * into v_payment from public.ldm2_payments where id=p_payment_id for update;
    if not found then raise exception 'Pembayaran tidak ditemukan.'; end if;

    select * into v_license from public.ldm2_licenses where id=v_payment.license_id;
    if not found then raise exception 'Lisensi pembayaran tidak ditemukan.'; end if;

    v_elig := public.ldm2_refund_eligibility(v_payment.id);
    if coalesce((v_elig->>'eligible')::boolean,false) is not true then
        raise exception '%', coalesce(v_elig->>'reason','Pembayaran tidak memenuhi kebijakan refund.');
    end if;

    if v_type not in ('full','partial') then raise exception 'Jenis refund harus full atau partial.'; end if;
    if v_type='partial' and coalesce((v_elig->>'allow_partial_refund')::boolean,false) is not true then
        raise exception 'Partial refund sedang tidak diizinkan oleh kebijakan.';
    end if;
    if v_category not in ('duplicate_payment','wrong_plan','wrong_period','provisioning_issue','technical_issue','service_issue','changed_mind','other') then
        raise exception 'Kategori alasan refund tidak valid.';
    end if;
    if length(v_detail) < 20 then raise exception 'Penjelasan refund minimal 20 karakter.'; end if;
    if length(v_detail) > 1500 then raise exception 'Penjelasan refund maksimal 1500 karakter.'; end if;

    v_remaining := coalesce((v_elig->>'remaining_refundable')::bigint,0);
    v_amount := case when v_type='full' then v_remaining else p_requested_amount end;
    if v_amount is null or v_amount <= 0 or v_amount > v_remaining then
        raise exception 'Nominal refund tidak valid. Maksimal sisa refundable adalah %.', v_remaining;
    end if;

    if exists(
        select 1 from public.ldm2_refund_requests
        where payment_id=v_payment.id
          and status in ('submitted','reviewing','waiting_customer','approved','processing')
    ) then
        raise exception 'Masih ada permintaan refund aktif untuk pembayaran ini.';
    end if;

    insert into public.ldm2_refund_requests(
        request_code,payment_id,license_id,order_id,refund_type,requested_amount,
        reason_category,reason_detail,requester_name,requester_email,requester_phone,
        status,policy_version,refund_deadline,eligibility_snapshot
    ) values (
        upper(btrim(p_request_code)),v_payment.id,v_payment.license_id,v_payment.order_id,v_type,v_amount,
        v_category,v_detail,v_license.customer_name,v_license.customer_email,v_license.customer_phone,
        'submitted',v_elig->>'policy_version',(v_elig->>'refund_deadline')::timestamptz,v_elig
    ) returning * into v_request;

    return jsonb_build_object(
        'ok',true,
        'request_code',v_request.request_code,
        'status',v_request.status,
        'order_id',v_request.order_id,
        'refund_type',v_request.refund_type,
        'requested_amount',v_request.requested_amount,
        'refund_deadline',v_request.refund_deadline,
        'created_at',v_request.created_at
    );
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Customer dapat membatalkan request selama belum diproses developer.
--    Edge Function tetap wajib memverifikasi status_token payment sebelum RPC.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_cancel_customer_refund_request(
    p_payment_id uuid,
    p_request_code text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_request public.ldm2_refund_requests%rowtype;
begin
    select * into v_request
    from public.ldm2_refund_requests
    where payment_id=p_payment_id and request_code=upper(btrim(p_request_code))
    for update;
    if not found then raise exception 'Permintaan refund tidak ditemukan.'; end if;
    if v_request.status not in ('submitted','waiting_customer') then
        raise exception 'Permintaan refund dengan status % tidak dapat dibatalkan customer.', v_request.status;
    end if;

    update public.ldm2_refund_requests
    set status='cancelled',cancelled_at=now(),updated_at=now()
    where id=v_request.id
    returning * into v_request;

    return jsonb_build_object('ok',true,'request_code',v_request.request_code,'status',v_request.status,'cancelled_at',v_request.cancelled_at);
end;
$$;

-- --------------------------------------------------------------------------
-- 4. Developer update status/catatan request. Eksekusi uang tetap melalui
--    ldm2_prepare_refund + proses refund merchant/provider + ldm2_finish_refund.
-- --------------------------------------------------------------------------
create or replace function public.ldm2_update_refund_request(
    p_request_code text,
    p_status text,
    p_response_note text default null,
    p_linked_refund_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_request public.ldm2_refund_requests%rowtype;
    v_status text := lower(btrim(coalesce(p_status,'')));
    v_note text := nullif(btrim(coalesce(p_response_note,'')),'');
begin
    if v_status not in ('submitted','reviewing','waiting_customer','approved','processing','completed','rejected','cancelled') then
        raise exception 'Status permintaan refund tidak valid.';
    end if;

    select * into v_request from public.ldm2_refund_requests
    where request_code=upper(btrim(p_request_code)) for update;
    if not found then raise exception 'Permintaan refund tidak ditemukan.'; end if;

    if v_request.status in ('completed','cancelled') and v_status <> v_request.status then
        raise exception 'Permintaan refund yang sudah % tidak dapat dibuka kembali.', v_request.status;
    end if;
    if v_status='rejected' and coalesce(length(v_note),0) < 10 then
        raise exception 'Alasan penolakan minimal 10 karakter.';
    end if;

    update public.ldm2_refund_requests
    set status=v_status,
        response_note=coalesce(v_note,response_note),
        linked_refund_key=coalesce(nullif(btrim(coalesce(p_linked_refund_key,'')),''),linked_refund_key),
        reviewed_at=case when v_status in ('reviewing','waiting_customer','approved','processing','rejected') then coalesce(reviewed_at,now()) else reviewed_at end,
        completed_at=case when v_status in ('completed','rejected') then now() else completed_at end,
        updated_at=now()
    where id=v_request.id
    returning * into v_request;

    return jsonb_build_object(
        'ok',true,'request_code',v_request.request_code,'status',v_request.status,
        'response_note',v_request.response_note,'linked_refund_key',v_request.linked_refund_key,
        'updated_at',v_request.updated_at,'completed_at',v_request.completed_at
    );
end;
$$;

revoke all on function public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.ldm2_cancel_customer_refund_request(uuid,text) from public, anon, authenticated;
revoke all on function public.ldm2_update_refund_request(text,text,text,text) from public, anon, authenticated;
grant execute on function public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text) to service_role;
grant execute on function public.ldm2_cancel_customer_refund_request(uuid,text) to service_role;
grant execute on function public.ldm2_update_refund_request(text,text,text,text) to service_role;

commit;

-- VALIDASI
select
    to_regclass('public.ldm2_refund_requests') is not null as refund_requests_table_ok,
    to_regprocedure('public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text)') is not null as create_refund_request_rpc_ok,
    to_regprocedure('public.ldm2_cancel_customer_refund_request(uuid,text)') is not null as cancel_refund_request_rpc_ok,
    to_regprocedure('public.ldm2_update_refund_request(text,text,text,text)') is not null as update_refund_request_rpc_ok;


-- ============================================================================
-- C. V28: Customer Cancel Order + Payment-after-Cancel Guard
-- ============================================================================

begin;

create or replace function public.ldm2_cancel_public_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_old_store_code text;
    v_cancel_store_code text;
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(coalesce(p_order_id,''))
    for update;

    if not found then
        raise exception 'Order pembayaran tidak ditemukan.';
    end if;

    if lower(coalesce(v_payment.provider,'')) <> 'lynk' then
        raise exception 'Order ini bukan pembayaran Lynk.id.';
    end if;

    if v_payment.status='cancelled' then
        return jsonb_build_object(
            'ok',true,'already_cancelled',true,'order_id',v_payment.order_id,
            'payment_status','cancelled'
        );
    end if;

    if v_payment.status in ('paid','partially_refunded','refunded') then
        return jsonb_build_object(
            'ok',false,'code','PAYMENT_ALREADY_PAID','order_id',v_payment.order_id,
            'payment_status',v_payment.status,'refund_required',true
        );
    end if;

    if v_payment.status not in ('pending','challenge') then
        raise exception 'Order dengan status % tidak dapat dibatalkan customer.', coalesce(v_payment.status,'-');
    end if;

    update public.ldm2_payments
    set status='cancelled',
        provider_status='customer_cancelled',
        processed_at=coalesce(processed_at,now()),
        provider_terminal_at=coalesce(provider_terminal_at,now()),
        last_provider_event_at=now(),
        last_provider_event_source='customer_cancel',
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
          || jsonb_build_object(
              'customer_cancelled',true,
              'customer_cancelled_at',now(),
              'cancel_scope','locdailymar_order_only',
              'provider','lynk'
          ),
        payment_state_version=payment_state_version+1
    where id=v_payment.id;

    select * into v_license
    from public.ldm2_licenses
    where id=v_payment.license_id
    for update;

    -- Purchase baru yang belum pernah dibayar boleh ditutup dan Store Code
    -- dilepas agar customer dapat membuat order baru memakai Store Code semula.
    if found and v_payment.payment_type='purchase' and v_license.status='pending_payment' then
        v_old_store_code := v_license.primary_store_code;
        v_cancel_store_code := left('CANCELLED-' || upper(replace(extensions.gen_random_uuid()::text,'-','')),30);

        update public.ldm2_licenses
        set status='cancelled',
            primary_store_code=v_cancel_store_code,
            notes=concat_ws(E'\n',nullif(notes,''),
                'Order '||v_payment.order_id||' dibatalkan customer sebelum pembayaran. Store Code semula: '||coalesce(v_old_store_code,'-'))
        where id=v_license.id;

        -- Kolom arsip tersedia pada baseline komersial saat ini. Jika ada,
        -- arsipkan draft lisensi yang batal agar tidak memenuhi dashboard aktif.
        if exists(
            select 1 from information_schema.columns
            where table_schema='public' and table_name='ldm2_licenses' and column_name='archived_at'
        ) then
            execute 'update public.ldm2_licenses set archived_at=coalesce(archived_at,now()), archived_reason=coalesce(archived_reason,''Customer cancelled unpaid order''), archived_by_email=coalesce(archived_by_email,''customer-self-service'') where id=$1'
            using v_license.id;
        end if;
    end if;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_payment.license_id,'PAYMENT_ORDER_CANCELLED_BY_CUSTOMER',jsonb_build_object(
        'order_id',v_payment.order_id,
        'provider','lynk',
        'payment_type',v_payment.payment_type,
        'amount',v_payment.amount,
        'cancelled_at',now(),
        'note','Pembatalan hanya membatalkan order LocDailyMar. Customer harus menutup Lynk.id dan tidak melanjutkan pembayaran.'
    ));

    return jsonb_build_object(
        'ok',true,
        'order_id',v_payment.order_id,
        'payment_status','cancelled',
        'message','Order LocDailyMar berhasil dibatalkan.'
    );
end;
$$;

revoke all on function public.ldm2_cancel_public_order(text) from public,anon,authenticated;
grant execute on function public.ldm2_cancel_public_order(text) to service_role;

-- Terapkan payment SUCCESS dari webhook Lynk.id secara idempotent.
-- V28 menolak aktivasi otomatis bila customer sudah membatalkan order lokal.
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

  -- Sangat penting: jangan mengaktifkan lisensi dari order yang sudah dicancel.
  -- Jika customer tetap membayar pada tab Lynk.id setelah cancel, tandai untuk review/refund.
  if v_payment.status='cancelled' then
    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_payment.license_id,'PAYMENT_RECEIVED_AFTER_CANCEL',jsonb_build_object(
      'order_id',v_payment.order_id,'provider','lynk','transaction_id',p_transaction_id,
      'amount',p_gross_amount,'event_status',v_status,'received_at',now(),
      'action_required','MANUAL_PAYMENT_REVIEW_OR_REFUND'
    ));
    return jsonb_build_object(
      'ok',false,'code','ORDER_CANCELLED_PAYMENT_REVIEW','order_id',v_payment.order_id,
      'payment_status','cancelled','payment_received_after_cancel',true,'refund_review_required',true
    );
  end if;

  if v_payment.processed_at is not null or v_payment.status='paid' then
    return jsonb_build_object('ok',true,'processed',false,'duplicate',true,'order_id',v_payment.order_id);
  end if;

  if nullif(btrim(coalesce(p_transaction_id,'')),'') is not null and exists(
    select 1 from public.ldm2_payments p where p.provider_transaction_id=btrim(p_transaction_id) and p.id<>v_payment.id
  ) then
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

revoke all on function public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb) to service_role;

insert into public.ldm2_events(license_id,event_type,detail)
select null,'SYSTEM_PATCH',jsonb_build_object('version','27.9.0-v28','feature','LYNK_CUSTOMER_CANCEL_REFUND','installed_at',now())
where not exists(
  select 1 from public.ldm2_events
  where event_type='SYSTEM_PATCH'
    and detail->>'version'='27.9.0-v28'
    and detail->>'feature'='LYNK_CUSTOMER_CANCEL_REFUND'
);

commit;

-- VERIFIKASI V28
select
  to_regprocedure('public.ldm2_cancel_public_order(text)') is not null as cancel_order_rpc_ok,
  to_regprocedure('public.ldm2_apply_lynk_payment(text,text,text,numeric,jsonb)') is not null as lynk_apply_guard_ok,
  to_regclass('public.ldm2_refund_policy') is not null as refund_policy_table_ok,
  to_regclass('public.ldm2_refunds') is not null as refund_ledger_table_ok,
  to_regclass('public.ldm2_refund_requests') is not null as refund_requests_table_ok,
  to_regprocedure('public.ldm2_refund_eligibility(uuid)') is not null as refund_eligibility_ok,
  to_regprocedure('public.ldm2_create_customer_refund_request(uuid,text,text,bigint,text,text)') is not null as refund_request_create_ok,
  to_regprocedure('public.ldm2_cancel_customer_refund_request(uuid,text)') is not null as refund_request_cancel_ok;

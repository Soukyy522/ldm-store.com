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

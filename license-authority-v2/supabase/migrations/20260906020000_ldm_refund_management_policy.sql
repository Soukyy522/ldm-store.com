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

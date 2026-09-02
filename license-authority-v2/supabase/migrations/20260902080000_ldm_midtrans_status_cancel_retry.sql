-- =============================================================================
-- LocDailyMar 27.8.0
-- MIDTRANS STATUS RECONCILIATION + SNAP SESSION CANCEL + PAYMENT RETRY
-- Jalankan pada Supabase PROJECT LICENSE AUTHORITY V2.
-- Migration ini aman dijalankan ulang (idempotent).
-- =============================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regprocedure('public.ldm2_create_retry_purchase_order(text,uuid,text,bigint)') is null then
        raise exception 'Migration pembayaran sebelumnya belum lengkap. Jalankan semua migration License Authority V2 secara berurutan terlebih dahulu.';
    end if;
end
$$;

alter table public.ldm2_payments
    add column if not exists cancelled_at timestamptz,
    add column if not exists cancelled_by text,
    add column if not exists cancellation_reason text;

create index if not exists idx_ldm2_payments_cancelled_at
    on public.ldm2_payments(cancelled_at desc)
    where cancelled_at is not null;

-- Membatalkan order lokal setelah server memastikan bahwa transaksi Midtrans
-- belum dibayar. Fungsi ini tidak membatalkan lisensi purchase agar Store Code,
-- Store ID, Network ID, dan key hash dapat dipakai kembali oleh order retry.
create or replace function public.ldm2_cancel_pending_payment_local(
    p_order_id text,
    p_actor text,
    p_reason text,
    p_provider_status text default 'local_cancel',
    p_provider_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_actor text := left(coalesce(nullif(btrim(p_actor),''),'system'),120);
    v_reason text := left(coalesce(nullif(btrim(p_reason),''),'Order pembayaran dibatalkan'),500);
    v_provider_status text := left(coalesce(nullif(btrim(p_provider_status),''),'local_cancel'),40);
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
    for update;

    if not found then
        raise exception 'Order pembayaran tidak ditemukan.';
    end if;

    if v_payment.status in ('paid','refunded') or v_payment.processed_at is not null then
        raise exception 'Pembayaran sudah berhasil/diproses dan tidak boleh dibatalkan. Gunakan proses refund sesuai kebijakan merchant.';
    end if;

    if v_payment.status='cancelled' then
        update public.ldm2_payments
        set provider_status=coalesce(nullif(provider_status,''),v_provider_status),
            provider_detail=coalesce(provider_detail,'{}'::jsonb)
                || coalesce(p_provider_detail,'{}'::jsonb)
                || jsonb_build_object('local_cancel_actor',v_actor,'local_cancel_reason',v_reason),
            cancelled_at=coalesce(cancelled_at,now()),
            cancelled_by=coalesce(cancelled_by,v_actor),
            cancellation_reason=coalesce(cancellation_reason,v_reason)
        where id=v_payment.id;
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_CANCEL_CONFIRMED',jsonb_build_object(
            'order_id',v_payment.order_id,'actor',v_actor,'reason',v_reason
        ));
        return jsonb_build_object(
            'ok',true,'already_cancelled',true,'order_id',v_payment.order_id,
            'payment_status','cancelled','provider_status',coalesce(v_payment.provider_status,v_provider_status),
            'license_id',v_payment.license_id
        );
    end if;

    if v_payment.status not in ('pending','challenge','failed','expired') then
        raise exception 'Status pembayaran % tidak dapat dibatalkan.',v_payment.status;
    end if;

    update public.ldm2_payments
    set status='cancelled',
        provider_status=v_provider_status,
        provider_detail=coalesce(provider_detail,'{}'::jsonb)
            || coalesce(p_provider_detail,'{}'::jsonb)
            || jsonb_build_object('local_cancel_actor',v_actor,'local_cancel_reason',v_reason),
        cancelled_at=coalesce(cancelled_at,now()),
        cancelled_by=v_actor,
        cancellation_reason=v_reason,
        error_message=null
    where id=v_payment.id;

    -- Purchase tetap pending_payment supaya customer/developer dapat membuat
    -- order baru. Renewal/conversion tidak mengubah status lisensi yang sudah ada.
    if v_payment.payment_type='purchase' then
        update public.ldm2_licenses
        set status='pending_payment'
        where id=v_payment.license_id
          and status in ('pending_payment','cancelled')
          and not exists(
              select 1 from public.ldm2_payments paid
              where paid.license_id=v_payment.license_id
                and (paid.status='paid' or paid.processed_at is not null)
          );
    end if;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_payment.license_id,'PAYMENT_CANCELLED_FOR_RETRY',jsonb_build_object(
        'order_id',v_payment.order_id,
        'payment_type',v_payment.payment_type,
        'actor',v_actor,
        'reason',v_reason,
        'provider_status',v_provider_status
    ));

    return jsonb_build_object(
        'ok',true,'order_id',v_payment.order_id,'payment_status','cancelled',
        'provider_status',v_provider_status,'license_id',v_payment.license_id,
        'license_preserved_for_retry',v_payment.payment_type='purchase'
    );
end;
$$;

revoke all on function public.ldm2_cancel_pending_payment_local(text,text,text,text,jsonb)
    from public,anon,authenticated;
grant execute on function public.ldm2_cancel_pending_payment_local(text,text,text,text,jsonb)
    to service_role;

-- Memperbarui RPC retry agar data versi 27.7.2 yang telanjur mengubah lisensi
-- purchase menjadi cancelled juga dapat dipulihkan tanpa membuat Store Code baru.
create or replace function public.ldm2_create_retry_purchase_order(
    p_order_id text,
    p_license_id uuid,
    p_billing_cycle text,
    p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
    v_cycle text := lower(btrim(p_billing_cycle));
    v_expected bigint;
    v_months integer;
    v_payment_id uuid;
begin
    if nullif(btrim(p_order_id),'') is null then raise exception 'Order ID wajib diisi.'; end if;
    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found then raise exception 'Lisensi pending tidak ditemukan.'; end if;
    if v_license.status not in ('pending_payment','cancelled') then
        raise exception 'Retry hanya tersedia untuk lisensi purchase yang belum aktif.';
    end if;
    if exists(
        select 1 from public.ldm2_payments
        where license_id=v_license.id
          and (status in ('paid','refunded') or processed_at is not null)
    ) then
        raise exception 'Lisensi memiliki pembayaran yang sudah diproses dan tidak dapat memakai retry purchase.';
    end if;
    if exists(
        select 1 from public.ldm2_payments
        where license_id=v_license.id
          and status in ('pending','challenge')
    ) then
        raise exception 'Masih ada order pembayaran yang menunggu.';
    end if;

    v_expected := public.ldm2_expected_price(v_license.plan_code,v_cycle);
    if p_amount<>v_expected then raise exception 'Nominal retry tidak sesuai harga resmi.'; end if;
    v_months := case v_cycle when 'monthly' then 1 when 'yearly' then 12 when 'lifetime' then 0 else -1 end;
    if v_months<0 then raise exception 'Periode retry tidak valid.'; end if;

    update public.ldm2_licenses
    set status='pending_payment'
    where id=v_license.id and status='cancelled';

    insert into public.ldm2_payments(
        order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,status
    ) values (
        btrim(p_order_id),v_license.id,'purchase',v_license.plan_code,v_cycle,v_months,p_amount,'pending'
    ) returning id into v_payment_id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,'PAYMENT_ORDER_RETRY_CREATED',jsonb_build_object(
        'order_id',btrim(p_order_id),'billing_cycle',v_cycle,'amount',p_amount,
        'source_version','27.8.0'
    ));

    return jsonb_build_object(
        'ok',true,'license_id',v_license.id,'payment_id',v_payment_id,
        'order_id',btrim(p_order_id),'plan_code',v_license.plan_code,
        'billing_cycle',v_cycle,'amount',p_amount,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'network_id',v_license.network_id,'status','pending'
    );
end;
$$;

revoke all on function public.ldm2_create_retry_purchase_order(text,uuid,text,bigint)
    from public,anon,authenticated;
grant execute on function public.ldm2_create_retry_purchase_order(text,uuid,text,bigint)
    to service_role;

insert into public.ldm2_events(license_id,event_type,detail)
select null,'SYSTEM_PATCH',jsonb_build_object(
    'version','27.8.0',
    'feature','MIDTRANS_STATUS_CANCEL_RETRY',
    'installed_at',now()
)
where not exists (
    select 1 from public.ldm2_events
    where event_type='SYSTEM_PATCH'
      and detail->>'version'='27.8.0'
      and detail->>'feature'='MIDTRANS_STATUS_CANCEL_RETRY'
);

commit;

-- VERIFIKASI: semua nilai harus true / tersedia.
select
    to_regprocedure('public.ldm2_cancel_pending_payment_local(text,text,text,text,jsonb)') is not null
        as cancel_local_rpc_ok,
    to_regprocedure('public.ldm2_create_retry_purchase_order(text,uuid,text,bigint)') is not null
        as retry_purchase_rpc_ok,
    exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='ldm2_payments' and column_name='cancelled_at'
    ) as cancelled_at_column_ok;

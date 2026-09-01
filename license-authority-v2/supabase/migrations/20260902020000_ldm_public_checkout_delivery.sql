-- =====================================================================
-- LocDailyMar License Authority V2.2
-- CHECKOUT PUBLIK MIDTRANS + PENGIRIMAN EMAIL/WHATSAPP
-- Jalankan pada project Supabase KHUSUS LISENSI setelah migration V2.1.
-- =====================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_payments') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regprocedure('public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text)') is null then
        raise exception 'Midtrans V2.1 belum terpasang. Jalankan migration 20260902010000 terlebih dahulu.';
    end if;
end
$$;

alter table public.ldm2_payments
    add column if not exists public_checkout boolean not null default false,
    add column if not exists checkout_token_hash bytea,
    add column if not exists license_key_ciphertext text,
    add column if not exists delivery_email text,
    add column if not exists delivery_phone text,
    add column if not exists activation_url text,
    add column if not exists guide_url text,
    add column if not exists email_delivery_status text not null default 'pending',
    add column if not exists whatsapp_delivery_status text not null default 'pending',
    add column if not exists email_delivery_attempts integer not null default 0,
    add column if not exists whatsapp_delivery_attempts integer not null default 0,
    add column if not exists email_delivery_attempted_at timestamptz,
    add column if not exists whatsapp_delivery_attempted_at timestamptz,
    add column if not exists email_provider_id text,
    add column if not exists whatsapp_provider_id text,
    add column if not exists email_delivery_error text,
    add column if not exists whatsapp_delivery_error text,
    add column if not exists delivered_at timestamptz;

alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_email_delivery_status_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_email_delivery_status_check
    check (email_delivery_status in ('pending','sending','sent','failed'));

alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_whatsapp_delivery_status_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_whatsapp_delivery_status_check
    check (whatsapp_delivery_status in ('pending','sending','sent','failed'));

create unique index if not exists uq_ldm2_checkout_token_hash
    on public.ldm2_payments(checkout_token_hash)
    where checkout_token_hash is not null;
create index if not exists idx_ldm2_public_checkout_created
    on public.ldm2_payments(public_checkout,created_at desc)
    where public_checkout=true;
create index if not exists idx_ldm2_delivery_queue
    on public.ldm2_payments(status,email_delivery_status,whatsapp_delivery_status,created_at)
    where public_checkout=true;

create or replace function public.ldm2_create_public_checkout_order(
    p_order_id text,
    p_key_hash_hex text,
    p_key_prefix text,
    p_license_key_ciphertext text,
    p_checkout_token_hash_hex text,
    p_customer_name text,
    p_customer_email text,
    p_customer_phone text,
    p_plan_code text,
    p_billing_cycle text,
    p_store_code text,
    p_store_name text,
    p_amount bigint,
    p_activation_url text,
    p_guide_url text,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_recent integer;
    v_result jsonb;
begin
    -- Satu email maksimal membuat tiga checkout publik per jam. Harga dan
    -- paket tetap divalidasi ulang oleh ldm2_create_purchase_order.
    select count(*) into v_recent
    from public.ldm2_payments pay
    join public.ldm2_licenses lic on lic.id=pay.license_id
    where pay.public_checkout=true
      and lower(lic.customer_email)=lower(btrim(p_customer_email))
      and pay.created_at>=now()-interval '1 hour';

    if v_recent>=3 then
        raise exception 'Batas pembuatan pembayaran tercapai. Gunakan order sebelumnya atau coba lagi satu jam kemudian.';
    end if;

    v_result := public.ldm2_create_purchase_order(
        p_order_id,p_key_hash_hex,p_key_prefix,p_customer_name,p_customer_email,
        p_customer_phone,p_plan_code,p_billing_cycle,p_store_code,p_store_name,
        p_amount,p_notes
    );

    update public.ldm2_payments
    set public_checkout=true,
        checkout_token_hash=decode(p_checkout_token_hash_hex,'hex'),
        license_key_ciphertext=p_license_key_ciphertext,
        delivery_email=lower(btrim(p_customer_email)),
        delivery_phone=btrim(p_customer_phone),
        activation_url=nullif(btrim(p_activation_url),''),
        guide_url=nullif(btrim(p_guide_url),'')
    where order_id=btrim(p_order_id);

    insert into public.ldm2_events(license_id,event_type,detail)
    values((v_result->>'license_id')::uuid,'PUBLIC_CHECKOUT_CREATED',jsonb_build_object(
        'order_id',p_order_id,'email',lower(btrim(p_customer_email)),
        'phone_suffix',right(btrim(p_customer_phone),4)
    ));

    return v_result;
end;
$$;

create or replace function public.ldm2_public_checkout_status(
    p_order_id text,
    p_checkout_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
    v_payment public.ldm2_payments%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_plan public.ldm2_plans%rowtype;
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
      and public_checkout=true
      and checkout_token_hash=decode(p_checkout_token_hash_hex,'hex');

    if not found then
        return jsonb_build_object('ok',false,'code','CHECKOUT_NOT_FOUND','message','Order atau token checkout tidak valid.');
    end if;

    select * into v_license from public.ldm2_licenses where id=v_payment.license_id;
    select * into v_plan from public.ldm2_plans where code=v_payment.plan_code;

    return jsonb_build_object(
        'ok',true,'order_id',v_payment.order_id,'payment_status',v_payment.status,
        'provider_status',v_payment.provider_status,'amount',v_payment.amount,
        'billing_cycle',v_payment.billing_cycle,'plan_code',v_payment.plan_code,
        'plan_name',v_plan.name,'license_status',v_license.status,
        'store_code',v_license.primary_store_code,'store_id',v_license.primary_store_id,
        'network_id',v_license.network_id,'expires_at',v_license.expires_at,
        'email_delivery_status',v_payment.email_delivery_status,
        'whatsapp_delivery_status',v_payment.whatsapp_delivery_status,
        'activation_url',v_payment.activation_url,'guide_url',v_payment.guide_url,
        'license_key_ciphertext',case when v_payment.status='paid' and v_payment.processed_at is not null
            then v_payment.license_key_ciphertext else null end
    );
end;
$$;

create or replace function public.ldm2_claim_delivery(
    p_order_id text,
    p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_channel text := lower(btrim(p_channel));
    v_payment public.ldm2_payments%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_plan_name text;
begin
    if v_channel not in ('email','whatsapp') then raise exception 'Channel pengiriman tidak valid.'; end if;

    if v_channel='email' then
        update public.ldm2_payments
        set email_delivery_status='sending',email_delivery_attempts=email_delivery_attempts+1,
            email_delivery_attempted_at=now(),
            email_delivery_error=null
        where order_id=btrim(p_order_id) and public_checkout=true
          and status='paid' and processed_at is not null
          and (email_delivery_status in ('pending','failed')
               or (email_delivery_status='sending' and email_delivery_attempted_at<now()-interval '5 minutes'))
          and email_delivery_attempts<5
        returning * into v_payment;
    else
        update public.ldm2_payments
        set whatsapp_delivery_status='sending',whatsapp_delivery_attempts=whatsapp_delivery_attempts+1,
            whatsapp_delivery_attempted_at=now(),
            whatsapp_delivery_error=null
        where order_id=btrim(p_order_id) and public_checkout=true
          and status='paid' and processed_at is not null
          and (whatsapp_delivery_status in ('pending','failed')
               or (whatsapp_delivery_status='sending' and whatsapp_delivery_attempted_at<now()-interval '5 minutes'))
          and whatsapp_delivery_attempts<5
        returning * into v_payment;
    end if;

    if not found then return jsonb_build_object('ok',false,'claimed',false); end if;
    select * into v_license from public.ldm2_licenses where id=v_payment.license_id;
    select name into v_plan_name from public.ldm2_plans where code=v_payment.plan_code;

    return jsonb_build_object(
        'ok',true,'claimed',true,'channel',v_channel,'order_id',v_payment.order_id,
        'customer_name',v_license.customer_name,'email',v_payment.delivery_email,
        'phone',v_payment.delivery_phone,'plan_code',v_payment.plan_code,
        'plan_name',v_plan_name,'billing_cycle',v_payment.billing_cycle,
        'amount',v_payment.amount,'license_key_ciphertext',v_payment.license_key_ciphertext,
        'store_code',v_license.primary_store_code,'store_id',v_license.primary_store_id,
        'network_id',v_license.network_id,'expires_at',v_license.expires_at,
        'activation_url',v_payment.activation_url,'guide_url',v_payment.guide_url
    );
end;
$$;

create or replace function public.ldm2_finish_delivery(
    p_order_id text,
    p_channel text,
    p_success boolean,
    p_provider_id text default null,
    p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_channel text := lower(btrim(p_channel));
    v_license_id uuid;
begin
    if v_channel='email' then
        update public.ldm2_payments
        set email_delivery_status=case when p_success then 'sent' else 'failed' end,
            email_provider_id=case when p_success then nullif(btrim(p_provider_id),'') else email_provider_id end,
            email_delivery_error=case when p_success then null else left(coalesce(p_error,'Pengiriman email gagal'),500) end
        where order_id=btrim(p_order_id)
        returning license_id into v_license_id;
    elsif v_channel='whatsapp' then
        update public.ldm2_payments
        set whatsapp_delivery_status=case when p_success then 'sent' else 'failed' end,
            whatsapp_provider_id=case when p_success then nullif(btrim(p_provider_id),'') else whatsapp_provider_id end,
            whatsapp_delivery_error=case when p_success then null else left(coalesce(p_error,'Pengiriman WhatsApp gagal'),500) end
        where order_id=btrim(p_order_id)
        returning license_id into v_license_id;
    else
        raise exception 'Channel pengiriman tidak valid.';
    end if;

    update public.ldm2_payments
    set delivered_at=case
        when email_delivery_status='sent' and whatsapp_delivery_status='sent' then coalesce(delivered_at,now())
        else delivered_at end
    where order_id=btrim(p_order_id);

    if v_license_id is not null then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_license_id,case when p_success then 'LICENSE_DELIVERY_SENT' else 'LICENSE_DELIVERY_FAILED' end,
            jsonb_build_object('order_id',p_order_id,'channel',v_channel,'provider_id',p_provider_id,'error',p_error));
    end if;
end;
$$;

revoke all on function public.ldm2_create_public_checkout_order(text,text,text,text,text,text,text,text,text,text,text,text,bigint,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_public_checkout_status(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_claim_delivery(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_finish_delivery(text,text,boolean,text,text) from public,anon,authenticated;

grant execute on function public.ldm2_create_public_checkout_order(text,text,text,text,text,text,text,text,text,text,text,text,bigint,text,text,text) to service_role;
grant execute on function public.ldm2_public_checkout_status(text,text) to service_role;
grant execute on function public.ldm2_claim_delivery(text,text) to service_role;
grant execute on function public.ldm2_finish_delivery(text,text,boolean,text,text) to service_role;

commit;

select
    count(*) filter(where public_checkout) as checkout_customer,
    count(*) filter(where public_checkout and status='paid') as checkout_paid,
    count(*) filter(where public_checkout and email_delivery_status='failed') as email_gagal,
    count(*) filter(where public_checkout and whatsapp_delivery_status='failed') as whatsapp_gagal
from public.ldm2_payments;

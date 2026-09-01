-- =====================================================================
-- LocDailyMar License Authority V2.1
-- MIDTRANS OTOMATIS + STORE CODE/STORE ID SAAT PEMBUATAN LISENSI
--
-- Jalankan pada project Supabase KHUSUS LISENSI milik developer.
-- Jalankan SETELAH 20260830010000_ldm_license_v2.sql.
-- =====================================================================

begin;

do $$
begin
    if to_regclass('public.ldm2_plans') is null
       or to_regclass('public.ldm2_licenses') is null
       or to_regclass('public.ldm2_events') is null then
        raise exception 'Lisensi V2 dasar belum terpasang. Jalankan migration 20260830010000 terlebih dahulu.';
    end if;
end
$$;

alter table public.ldm2_licenses
    add column if not exists primary_store_id uuid,
    add column if not exists primary_store_code text,
    add column if not exists primary_store_name text,
    add column if not exists network_id uuid;

update public.ldm2_licenses l
set
    primary_store_id = coalesce(l.primary_store_id, extensions.gen_random_uuid()),
    network_id = coalesce(l.network_id, extensions.gen_random_uuid()),
    primary_store_code = coalesce(
        nullif(upper(btrim(l.primary_store_code)), ''),
        (
            select upper(btrim(a.store_code))
            from public.ldm2_activations a
            where a.license_id = l.id
            order by a.activated_at, a.id
            limit 1
        ),
        'LDM-LEGACY-' || upper(left(replace(l.id::text, '-', ''), 8))
    ),
    primary_store_name = coalesce(
        nullif(btrim(l.primary_store_name), ''),
        l.customer_name || ' - Toko Pusat'
    );

-- Data lisensi lama kadang memakai Store Code generik yang sama, misalnya
-- LDM-DEFAULT. Pertahankan baris pertama dan beri kode migrasi unik pada
-- baris duplikat sebelum unique index dibuat.
do $$
declare
    v_row record;
    v_candidate text;
begin
    for v_row in
        select id
        from (
            select
                id,
                row_number() over (
                    partition by upper(btrim(primary_store_code))
                    order by created_at,id
                ) as duplicate_number
            from public.ldm2_licenses
        ) ranked
        where duplicate_number > 1
    loop
        v_candidate := 'LDM-MIG-' || replace(v_row.id::text,'-','');
        while exists(
            select 1
            from public.ldm2_licenses l
            where l.id<>v_row.id
              and upper(btrim(l.primary_store_code))=upper(v_candidate)
        ) loop
            v_candidate := 'LDM-MIG-' || replace(v_row.id::text,'-','') || '-'
                || upper(left(replace(extensions.gen_random_uuid()::text,'-',''),8));
        end loop;

        update public.ldm2_licenses
        set primary_store_code=v_candidate
        where id=v_row.id;

        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_row.id,'DUPLICATE_STORE_CODE_MIGRATED',jsonb_build_object(
            'new_store_code',v_candidate,
            'reason','Duplicate primary_store_code sebelum instalasi Midtrans'
        ));
    end loop;
end
$$;

alter table public.ldm2_licenses
    alter column primary_store_id set default extensions.gen_random_uuid(),
    alter column primary_store_id set not null,
    alter column primary_store_code set default ('LDM-' || upper(left(replace(extensions.gen_random_uuid()::text, '-', ''), 10))),
    alter column primary_store_code set not null,
    alter column primary_store_name set default 'Toko Utama',
    alter column primary_store_name set not null,
    alter column network_id set default extensions.gen_random_uuid(),
    alter column network_id set not null;

create unique index if not exists uq_ldm2_license_primary_store_id
    on public.ldm2_licenses(primary_store_id);
create unique index if not exists uq_ldm2_license_primary_store_code
    on public.ldm2_licenses(upper(primary_store_code));
create unique index if not exists uq_ldm2_license_network_id
    on public.ldm2_licenses(network_id);

alter table public.ldm2_licenses
    drop constraint if exists ldm2_licenses_status_check;
alter table public.ldm2_licenses
    add constraint ldm2_licenses_status_check
    check (status in ('pending_payment','active','suspended','expired','cancelled'));

create table if not exists public.ldm2_payments (
    id uuid primary key default extensions.gen_random_uuid(),
    order_id text not null unique,
    license_id uuid not null references public.ldm2_licenses(id) on delete restrict,
    payment_type text not null check (payment_type in ('purchase','renewal','conversion')),
    plan_code text not null references public.ldm2_plans(code),
    billing_cycle text not null check (billing_cycle in ('monthly','yearly','lifetime')),
    duration_months integer not null default 0 check (duration_months in (0,1,12)),
    amount bigint not null check (amount > 0),
    currency text not null default 'IDR' check (currency = 'IDR'),
    provider text not null default 'midtrans' check (provider = 'midtrans'),
    status text not null default 'pending'
        check (status in ('pending','paid','failed','expired','cancelled','refunded','challenge')),
    snap_token text,
    redirect_url text,
    provider_transaction_id text,
    provider_status text,
    fraud_status text,
    status_code text,
    paid_at timestamptz,
    processed_at timestamptz,
    provider_detail jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.ldm2_payments
    add column if not exists license_key_hash bytea,
    add column if not exists license_key_prefix text;
alter table public.ldm2_payments
    drop constraint if exists ldm2_payments_payment_type_check;
alter table public.ldm2_payments
    add constraint ldm2_payments_payment_type_check
    check (payment_type in ('purchase','renewal','conversion'));

create unique index if not exists uq_ldm2_payment_provider_transaction
    on public.ldm2_payments(provider_transaction_id)
    where provider_transaction_id is not null;
create index if not exists idx_ldm2_payments_license_created
    on public.ldm2_payments(license_id, created_at desc);
create index if not exists idx_ldm2_payments_status_created
    on public.ldm2_payments(status, created_at desc);

drop trigger if exists trg_ldm2_payments_touch on public.ldm2_payments;
create trigger trg_ldm2_payments_touch
before update on public.ldm2_payments
for each row execute function public.ldm2_touch_updated_at();

create or replace function public.ldm2_expected_price(
    p_plan_code text,
    p_billing_cycle text
)
returns bigint
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
    v_plan public.ldm2_plans%rowtype;
    v_cycle text := lower(btrim(p_billing_cycle));
    v_amount bigint;
begin
    select * into v_plan
    from public.ldm2_plans
    where code = upper(btrim(p_plan_code))
      and active = true;

    if not found then
        raise exception 'Paket tidak ditemukan atau nonaktif.';
    end if;

    if v_plan.code = 'LIFETIME' and v_cycle <> 'lifetime' then
        raise exception 'Paket Lifetime hanya memakai siklus lifetime.';
    end if;
    if v_plan.code <> 'LIFETIME' and v_cycle = 'lifetime' then
        raise exception 'Siklus lifetime hanya tersedia untuk paket Lifetime.';
    end if;

    v_amount := case v_cycle
        when 'monthly' then v_plan.price_monthly
        when 'yearly' then v_plan.price_yearly
        when 'lifetime' then v_plan.price_lifetime
        else null
    end;

    if v_amount is null or v_amount <= 0 then
        raise exception 'Harga paket untuk siklus % belum dikonfigurasi.', v_cycle;
    end if;

    return v_amount;
end;
$$;

create or replace function public.ldm2_create_purchase_order(
    p_order_id text,
    p_key_hash_hex text,
    p_key_prefix text,
    p_customer_name text,
    p_customer_email text,
    p_customer_phone text,
    p_plan_code text,
    p_billing_cycle text,
    p_store_code text,
    p_store_name text,
    p_amount bigint,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_plan_code text := upper(btrim(p_plan_code));
    v_cycle text := lower(btrim(p_billing_cycle));
    v_store_code text := upper(btrim(coalesce(p_store_code, '')));
    v_expected bigint;
    v_license_id uuid;
    v_store_id uuid := extensions.gen_random_uuid();
    v_network_id uuid := extensions.gen_random_uuid();
    v_payment_id uuid;
    v_months integer;
begin
    if nullif(btrim(p_order_id), '') is null then raise exception 'Order ID wajib diisi.'; end if;
    if nullif(btrim(p_customer_name), '') is null then raise exception 'Nama customer wajib diisi.'; end if;
    if nullif(btrim(p_customer_email), '') is null then raise exception 'Email customer wajib diisi.'; end if;
    if nullif(btrim(p_store_name), '') is null then raise exception 'Nama toko wajib diisi.'; end if;

    v_expected := public.ldm2_expected_price(v_plan_code, v_cycle);
    if p_amount <> v_expected then raise exception 'Nominal tidak sesuai harga resmi paket.'; end if;

    if v_store_code = '' then
        loop
            v_store_code := 'LDM-' || upper(left(replace(extensions.gen_random_uuid()::text, '-', ''), 10));
            exit when not exists(
                select 1 from public.ldm2_licenses
                where upper(primary_store_code) = v_store_code
            );
        end loop;
    end if;

    if v_store_code !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then
        raise exception 'Store Code harus 3-30 karakter: huruf kapital, angka, atau tanda strip.';
    end if;
    if exists(select 1 from public.ldm2_licenses where upper(primary_store_code)=v_store_code) then
        raise exception 'Store Code % sudah digunakan.', v_store_code;
    end if;

    v_months := case v_cycle when 'monthly' then 1 when 'yearly' then 12 else 0 end;

    insert into public.ldm2_licenses(
        key_hash,key_prefix,customer_name,customer_email,customer_phone,
        customer_email_hash,plan_code,status,is_trial,starts_at,expires_at,notes,
        primary_store_id,primary_store_code,primary_store_name,network_id
    ) values (
        decode(p_key_hash_hex,'hex'),btrim(p_key_prefix),btrim(p_customer_name),lower(btrim(p_customer_email)),
        nullif(btrim(p_customer_phone),''),extensions.digest(lower(btrim(p_customer_email)),'sha256'),
        v_plan_code,'pending_payment',false,now(),null,p_notes,
        v_store_id,v_store_code,btrim(p_store_name),v_network_id
    ) returning id into v_license_id;

    insert into public.ldm2_payments(
        order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,status
    ) values (
        btrim(p_order_id),v_license_id,'purchase',v_plan_code,v_cycle,v_months,p_amount,'pending'
    ) returning id into v_payment_id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license_id,'PAYMENT_ORDER_CREATED',jsonb_build_object(
        'order_id',btrim(p_order_id),'payment_type','purchase','billing_cycle',v_cycle,
        'amount',p_amount,'store_code',v_store_code,'store_id',v_store_id,'network_id',v_network_id
    ));

    return jsonb_build_object(
        'ok',true,'license_id',v_license_id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),
        'plan_code',v_plan_code,'billing_cycle',v_cycle,'amount',p_amount,
        'store_id',v_store_id,'store_code',v_store_code,'store_name',btrim(p_store_name),
        'network_id',v_network_id,'status','pending_payment'
    );
end;
$$;

create or replace function public.ldm2_create_renewal_order(
    p_order_id text,
    p_license_id uuid,
    p_billing_cycle text,
    p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
    v_cycle text := lower(btrim(p_billing_cycle));
    v_expected bigint;
    v_payment_id uuid;
    v_months integer;
begin
    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found then raise exception 'Lisensi tidak ditemukan.'; end if;
    if v_license.is_trial then raise exception 'Trial harus dikonversi melalui pembelian paket baru.'; end if;
    if v_license.status='cancelled' then raise exception 'Lisensi yang dibatalkan tidak dapat diperpanjang.'; end if;
    if v_license.plan_code='LIFETIME' then raise exception 'Paket Lifetime tidak memerlukan perpanjangan.'; end if;

    v_expected := public.ldm2_expected_price(v_license.plan_code,v_cycle);
    if p_amount<>v_expected then raise exception 'Nominal perpanjangan tidak sesuai harga resmi.'; end if;
    v_months := case v_cycle when 'monthly' then 1 when 'yearly' then 12 else 0 end;

    insert into public.ldm2_payments(
        order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,status
    ) values (
        btrim(p_order_id),v_license.id,'renewal',v_license.plan_code,v_cycle,v_months,p_amount,'pending'
    ) returning id into v_payment_id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,'PAYMENT_ORDER_CREATED',jsonb_build_object(
        'order_id',btrim(p_order_id),'payment_type','renewal','billing_cycle',v_cycle,'amount',p_amount
    ));

    return jsonb_build_object(
        'ok',true,'license_id',v_license.id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),
        'plan_code',v_license.plan_code,'billing_cycle',v_cycle,'amount',p_amount,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'store_name',v_license.primary_store_name,'network_id',v_license.network_id,
        'status','pending'
    );
end;
$$;

create or replace function public.ldm2_create_trial_conversion_order(
    p_order_id text,
    p_license_id uuid,
    p_key_hash_hex text,
    p_key_prefix text,
    p_plan_code text,
    p_billing_cycle text,
    p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
    v_plan_code text := upper(btrim(p_plan_code));
    v_cycle text := lower(btrim(p_billing_cycle));
    v_expected bigint;
    v_payment_id uuid;
    v_months integer;
begin
    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found or not v_license.is_trial then
        raise exception 'Lisensi trial tidak ditemukan.';
    end if;
    if v_license.status='cancelled' then
        raise exception 'Lisensi trial yang dibatalkan tidak dapat dikonversi.';
    end if;
    if exists(
        select 1 from public.ldm2_payments
        where license_id=v_license.id
          and payment_type='conversion'
          and status in ('pending','challenge')
    ) then
        raise exception 'Masih ada pembayaran konversi trial yang menunggu. Gunakan link order tersebut.';
    end if;

    v_expected := public.ldm2_expected_price(v_plan_code,v_cycle);
    if p_amount<>v_expected then raise exception 'Nominal konversi tidak sesuai harga resmi.'; end if;
    v_months := case v_cycle when 'monthly' then 1 when 'yearly' then 12 else 0 end;

    insert into public.ldm2_payments(
        order_id,license_id,payment_type,plan_code,billing_cycle,duration_months,amount,status,
        license_key_hash,license_key_prefix
    ) values (
        btrim(p_order_id),v_license.id,'conversion',v_plan_code,v_cycle,v_months,p_amount,'pending',
        decode(p_key_hash_hex,'hex'),btrim(p_key_prefix)
    ) returning id into v_payment_id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,'PAYMENT_ORDER_CREATED',jsonb_build_object(
        'order_id',btrim(p_order_id),'payment_type','conversion','plan_code',v_plan_code,
        'billing_cycle',v_cycle,'amount',p_amount
    ));

    return jsonb_build_object(
        'ok',true,'license_id',v_license.id,'payment_id',v_payment_id,'order_id',btrim(p_order_id),
        'plan_code',v_plan_code,'billing_cycle',v_cycle,'amount',p_amount,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'store_name',v_license.primary_store_name,'network_id',v_license.network_id,
        'status','pending'
    );
end;
$$;

create or replace function public.ldm2_set_midtrans_checkout(
    p_order_id text,
    p_snap_token text,
    p_redirect_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.ldm2_payments%rowtype;
begin
    update public.ldm2_payments
    set snap_token=nullif(btrim(p_snap_token),''),redirect_url=nullif(btrim(p_redirect_url),''),
        error_message=null
    where order_id=btrim(p_order_id)
    returning * into v_payment;
    if not found then raise exception 'Order pembayaran tidak ditemukan.'; end if;
    return jsonb_build_object('ok',true,'order_id',v_payment.order_id,'redirect_url',v_payment.redirect_url);
end;
$$;

create or replace function public.ldm2_mark_payment_error(
    p_order_id text,
    p_message text
)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.ldm2_payments
    set error_message=left(coalesce(p_message,'Gagal membuat pembayaran'),500)
    where order_id=btrim(p_order_id) and status='pending';
$$;

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
    v_new_status text;
    v_success boolean := false;
    v_base timestamptz;
    v_expiry timestamptz;
begin
    select * into v_payment
    from public.ldm2_payments
    where order_id=btrim(p_order_id)
    for update;

    if not found then
        return jsonb_build_object('ok',false,'code','ORDER_NOT_FOUND','message','Order ID tidak dikenal.');
    end if;

    if round(p_gross_amount)::bigint <> v_payment.amount then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object(
            'order_id',v_payment.order_id,'expected',v_payment.amount,'received',p_gross_amount
        ));
        return jsonb_build_object('ok',false,'code','AMOUNT_MISMATCH','message','Nominal pembayaran tidak sesuai order.');
    end if;

    v_success := btrim(coalesce(p_status_code,''))='200' and (
        v_gateway_status='settlement'
        or (v_gateway_status='capture' and coalesce(v_fraud,'accept')='accept')
    );

    v_new_status := case
        when v_success then 'paid'
        when v_gateway_status='pending' then 'pending'
        when v_gateway_status='capture' and v_fraud='challenge' then 'challenge'
        when v_gateway_status='expire' then 'expired'
        when v_gateway_status='cancel' then 'cancelled'
        when v_gateway_status='deny' then 'failed'
        when v_gateway_status in ('refund','partial_refund') then 'refunded'
        else v_payment.status
    end;

    update public.ldm2_payments
    set provider_transaction_id=coalesce(nullif(btrim(p_transaction_id),''),provider_transaction_id),
        provider_status=v_gateway_status,fraud_status=nullif(v_fraud,''),status_code=p_status_code,
        status=v_new_status,provider_detail=coalesce(p_provider_detail,'{}'::jsonb),
        paid_at=case when v_success then coalesce(paid_at,now()) else paid_at end
    where id=v_payment.id;

    if not v_success then
        insert into public.ldm2_events(license_id,event_type,detail)
        values(v_payment.license_id,'PAYMENT_STATUS_UPDATED',jsonb_build_object(
            'order_id',v_payment.order_id,'payment_status',v_new_status,'provider_status',v_gateway_status
        ));
        return jsonb_build_object('ok',true,'processed',false,'order_id',v_payment.order_id,'payment_status',v_new_status);
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
        v_expiry := case
            when v_payment.billing_cycle='lifetime' then null
            else now()+make_interval(months=>v_payment.duration_months)
        end;
        update public.ldm2_licenses
        set status='active',starts_at=now(),expires_at=v_expiry
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
    set status='paid',processed_at=now(),paid_at=coalesce(paid_at,now())
    where id=v_payment.id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,
        case when v_payment.payment_type='purchase' then 'LICENSE_ACTIVATED_BY_PAYMENT'
             when v_payment.payment_type='conversion' then 'LICENSE_CONVERTED_BY_PAYMENT'
             else 'LICENSE_RENEWED_BY_PAYMENT' end,
        jsonb_build_object('order_id',v_payment.order_id,'billing_cycle',v_payment.billing_cycle,
            'amount',v_payment.amount,'expires_at',v_expiry,'provider','midtrans'));

    return jsonb_build_object(
        'ok',true,'processed',true,'order_id',v_payment.order_id,'payment_status','paid',
        'license_id',v_license.id,'license_status','active','expires_at',v_expiry,
        'store_id',v_license.primary_store_id,'store_code',v_license.primary_store_code,
        'network_id',v_license.network_id
    );
end;
$$;

create or replace function public.ldm2_guard_primary_store_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_primary_code text;
begin
    select primary_store_code into v_primary_code
    from public.ldm2_licenses
    where id=new.license_id;

    if v_primary_code is not null
       and not exists(
           select 1 from public.ldm2_activations a
           where a.license_id=new.license_id
             and a.status='active'
             and a.id is distinct from new.id
       )
       and upper(btrim(new.store_code))<>upper(btrim(v_primary_code)) then
        raise exception 'Aktivasi pertama wajib menggunakan Store Code utama: %',v_primary_code;
    end if;
    return new;
end;
$$;

-- Versi dasar fungsi trial belum mengenal kolom Store/Network baru. Fungsi
-- berikut mempertahankan trial 14 hari dan memastikan Store Code trial sama
-- dengan Store Code aktivasi pertamanya.
create or replace function public.ldm2_start_trial(
    p_customer_name text,
    p_customer_email text,
    p_customer_phone text,
    p_email_hash_hex text,
    p_trial_identity_hash_hex text,
    p_activation_token_hash_hex text,
    p_device_hash_hex text,
    p_device_name text,
    p_store_code text,
    p_app_version text default null,
    p_ip_hash_hex text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_license_id uuid;
    v_activation_id uuid;
    v_store_id uuid := extensions.gen_random_uuid();
    v_network_id uuid := extensions.gen_random_uuid();
    v_store_code text := upper(btrim(coalesce(p_store_code,'')));
    v_expiry timestamptz := now() + interval '14 days';
    v_features jsonb;
begin
    if nullif(btrim(p_customer_name),'') is null
       or nullif(btrim(p_customer_email),'') is null then
        return jsonb_build_object('ok',false,'code','TRIAL_IDENTITY_REQUIRED','message','Nama dan email trial wajib diisi.');
    end if;
    if v_store_code !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then
        return jsonb_build_object('ok',false,'code','STORE_CODE_INVALID','message','Store Code harus 3-30 karakter: huruf, angka, atau tanda strip.');
    end if;
    if exists(select 1 from public.ldm2_licenses where upper(primary_store_code)=v_store_code) then
        return jsonb_build_object('ok',false,'code','STORE_CODE_USED','message','Store Code sudah digunakan.');
    end if;
    if exists(select 1 from public.ldm2_trial_claims where
        email_hash=decode(p_email_hash_hex,'hex') or
        identity_hash=decode(p_trial_identity_hash_hex,'hex')
    ) then
        return jsonb_build_object('ok',false,'code','TRIAL_ALREADY_USED','message','Masa trial sudah pernah digunakan oleh email atau instalasi ini.');
    end if;

    select features into v_features
    from public.ldm2_plans
    where code='WARUNG_SEDERHANA' and active=true;
    if v_features is null then
        return jsonb_build_object('ok',false,'code','TRIAL_PLAN_INACTIVE','message','Paket trial sedang tidak tersedia.');
    end if;

    insert into public.ldm2_licenses(
        key_hash,key_prefix,customer_name,customer_email,customer_phone,customer_email_hash,
        plan_code,status,is_trial,trial_identity_hash,starts_at,expires_at,
        max_devices_override,max_stores_override,notes,
        primary_store_id,primary_store_code,primary_store_name,network_id
    ) values (
        null,'TRIAL-14-HARI',btrim(p_customer_name),lower(btrim(p_customer_email)),nullif(btrim(p_customer_phone),''),
        decode(p_email_hash_hex,'hex'),'WARUNG_SEDERHANA','active',true,decode(p_trial_identity_hash_hex,'hex'),
        now(),v_expiry,1,1,'Trial otomatis Paket Warung Sederhana',
        v_store_id,v_store_code,btrim(p_customer_name) || ' - Toko Trial',v_network_id
    ) returning id into v_license_id;

    insert into public.ldm2_trial_claims(email_hash,identity_hash,license_id)
    values(decode(p_email_hash_hex,'hex'),decode(p_trial_identity_hash_hex,'hex'),v_license_id);

    insert into public.ldm2_activations(
        license_id,activation_token_hash,device_hash,device_name,store_code,status,app_version,ip_hash
    ) values (
        v_license_id,decode(p_activation_token_hash_hex,'hex'),decode(p_device_hash_hex,'hex'),
        coalesce(nullif(btrim(p_device_name),''),'Perangkat Trial'),v_store_code,'active',p_app_version,
        case when nullif(p_ip_hash_hex,'') is null then null else decode(p_ip_hash_hex,'hex') end
    ) returning id into v_activation_id;

    insert into public.ldm2_events(license_id,activation_id,event_type,detail)
    values(v_license_id,v_activation_id,'TRIAL_STARTED',jsonb_build_object(
        'days',14,'store_code',v_store_code,'store_id',v_store_id,'network_id',v_network_id
    ));

    return jsonb_build_object(
        'ok',true,'license_id',v_license_id,'plan_code','WARUNG_SEDERHANA','plan_name','Warung Sederhana',
        'status','active','is_trial',true,'expires_at',v_expiry,'max_devices',1,'max_stores',1,
        'features',v_features,'store_code',v_store_code,'store_id',v_store_id,'network_id',v_network_id
    );
exception when unique_violation then
    return jsonb_build_object('ok',false,'code','TRIAL_ALREADY_USED','message','Masa trial atau Store Code sudah pernah digunakan.');
end;
$$;

drop trigger if exists trg_ldm2_primary_store_activation on public.ldm2_activations;
create trigger trg_ldm2_primary_store_activation
before insert or update of store_code,status on public.ldm2_activations
for each row execute function public.ldm2_guard_primary_store_activation();

drop view if exists public.ldm2_admin_license_overview;
create view public.ldm2_admin_license_overview as
select
    l.id,l.key_prefix,l.customer_name,l.customer_email,l.customer_phone,l.plan_code,p.name as plan_name,
    l.status,l.is_trial,l.starts_at,l.expires_at,l.notes,l.created_at,l.updated_at,l.last_checked_at,
    l.primary_store_id,l.primary_store_code,l.primary_store_name,l.network_id,
    coalesce(l.max_devices_override,p.max_devices) as max_devices,
    coalesce(l.max_stores_override,p.max_stores) as max_stores,
    count(a.id) filter(where a.status='active') as active_installations,
    count(distinct a.device_hash) filter(where a.status='active') as active_devices,
    count(distinct a.store_code) filter(where a.status='active') as active_stores,
    pay.order_id as latest_order_id,pay.status as latest_payment_status,
    pay.billing_cycle as latest_billing_cycle,pay.amount as latest_payment_amount,
    pay.redirect_url as latest_payment_url,pay.created_at as latest_payment_created_at
from public.ldm2_licenses l
join public.ldm2_plans p on p.code=l.plan_code
left join public.ldm2_activations a on a.license_id=l.id
left join lateral (
    select x.order_id,x.status,x.billing_cycle,x.amount,x.redirect_url,x.created_at
    from public.ldm2_payments x
    where x.license_id=l.id
    order by x.created_at desc,x.id desc
    limit 1
) pay on true
group by l.id,p.name,p.max_devices,p.max_stores,
    pay.order_id,pay.status,pay.billing_cycle,pay.amount,pay.redirect_url,pay.created_at;

alter table public.ldm2_payments enable row level security;
revoke all on table public.ldm2_payments from public,anon,authenticated;
revoke all on public.ldm2_admin_license_overview from public,anon,authenticated;
grant all on table public.ldm2_payments to service_role;
grant select on public.ldm2_admin_license_overview to service_role;

revoke all on function public.ldm2_expected_price(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.ldm2_create_renewal_order(text,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.ldm2_create_trial_conversion_order(text,uuid,text,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.ldm2_set_midtrans_checkout(text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_mark_payment_error(text,text) from public,anon,authenticated;
revoke all on function public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.ldm2_start_trial(text,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;

grant execute on function public.ldm2_expected_price(text,text) to service_role;
grant execute on function public.ldm2_create_purchase_order(text,text,text,text,text,text,text,text,text,text,bigint,text) to service_role;
grant execute on function public.ldm2_create_renewal_order(text,uuid,text,bigint) to service_role;
grant execute on function public.ldm2_create_trial_conversion_order(text,uuid,text,text,text,text,bigint) to service_role;
grant execute on function public.ldm2_set_midtrans_checkout(text,text,text) to service_role;
grant execute on function public.ldm2_mark_payment_error(text,text) to service_role;
grant execute on function public.ldm2_apply_midtrans_notification(text,text,text,text,text,numeric,jsonb) to service_role;
grant execute on function public.ldm2_start_trial(text,text,text,text,text,text,text,text,text,text,text) to service_role;

commit;

select
    l.customer_name,l.primary_store_code,l.primary_store_id,l.network_id,
    l.status,l.plan_code,p.order_id,p.status as payment_status,p.amount,p.redirect_url
from public.ldm2_licenses l
left join public.ldm2_payments p on p.license_id=l.id
order by l.created_at desc,p.created_at desc;

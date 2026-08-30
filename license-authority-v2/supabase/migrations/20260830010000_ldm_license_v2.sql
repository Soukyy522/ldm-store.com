-- ================================================================
-- LocDailyMar License Authority V2 - instalasi dari nol
-- Jalankan HANYA pada project Supabase khusus lisensi milik developer.
-- Jangan jalankan pada project Cloud data toko.
-- ================================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.ldm2_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create table if not exists public.ldm2_plans (
    code text primary key,
    name text not null,
    description text not null default '',
    price_monthly integer,
    price_yearly integer,
    price_lifetime integer,
    max_devices integer not null check (max_devices > 0),
    max_stores integer not null check (max_stores > 0),
    features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
    active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ldm2_licenses (
    id uuid primary key default gen_random_uuid(),
    key_hash bytea unique,
    key_prefix text not null,
    customer_name text not null,
    customer_email text not null,
    customer_phone text,
    customer_email_hash bytea not null,
    plan_code text not null references public.ldm2_plans(code),
    status text not null default 'active'
        check (status in ('active','suspended','expired','cancelled')),
    is_trial boolean not null default false,
    trial_identity_hash bytea,
    starts_at timestamptz not null default now(),
    expires_at timestamptz,
    max_devices_override integer check (max_devices_override is null or max_devices_override > 0),
    max_stores_override integer check (max_stores_override is null or max_stores_override > 0),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_checked_at timestamptz,
    constraint ldm2_license_period_valid check (expires_at is null or expires_at > starts_at)
);

create unique index if not exists uq_ldm2_trial_email
on public.ldm2_licenses(customer_email_hash)
where is_trial = true;

create unique index if not exists uq_ldm2_trial_identity
on public.ldm2_licenses(trial_identity_hash)
where is_trial = true and trial_identity_hash is not null;

create index if not exists idx_ldm2_licenses_status_expiry
on public.ldm2_licenses(status, expires_at);

create index if not exists idx_ldm2_licenses_customer
on public.ldm2_licenses(lower(customer_email), created_at desc);

-- Klaim trial disimpan permanen. Mengubah trial menjadi paket berbayar
-- tidak membuat email/instalasi tersebut bisa meminta trial kedua.
create table if not exists public.ldm2_trial_claims (
    id uuid primary key default gen_random_uuid(),
    email_hash bytea not null unique,
    identity_hash bytea not null unique,
    license_id uuid not null references public.ldm2_licenses(id) on delete restrict,
    claimed_at timestamptz not null default now()
);

create table if not exists public.ldm2_activations (
    id uuid primary key default gen_random_uuid(),
    license_id uuid not null references public.ldm2_licenses(id) on delete cascade,
    activation_token_hash bytea not null unique,
    device_hash bytea not null,
    device_name text not null default 'Perangkat',
    store_code text not null,
    status text not null default 'active' check (status in ('active','deactivated')),
    activated_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    deactivated_at timestamptz,
    deactivation_reason text,
    app_version text,
    ip_hash bytea,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ldm2_store_code_not_blank check (btrim(store_code) <> ''),
    unique (license_id, device_hash, store_code)
);

create index if not exists idx_ldm2_activations_license_status
on public.ldm2_activations(license_id, status, last_seen_at desc);

create table if not exists public.ldm2_events (
    id bigint generated always as identity primary key,
    license_id uuid references public.ldm2_licenses(id) on delete set null,
    activation_id uuid references public.ldm2_activations(id) on delete set null,
    event_type text not null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_ldm2_events_license_created
on public.ldm2_events(license_id, created_at desc);

create table if not exists public.ldm2_admin_audit (
    id bigint generated always as identity primary key,
    admin_user_id uuid,
    admin_email text,
    action text not null,
    target_license_id uuid references public.ldm2_licenses(id) on delete set null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

drop trigger if exists trg_ldm2_plans_touch on public.ldm2_plans;
create trigger trg_ldm2_plans_touch before update on public.ldm2_plans
for each row execute function public.ldm2_touch_updated_at();

drop trigger if exists trg_ldm2_licenses_touch on public.ldm2_licenses;
create trigger trg_ldm2_licenses_touch before update on public.ldm2_licenses
for each row execute function public.ldm2_touch_updated_at();

drop trigger if exists trg_ldm2_activations_touch on public.ldm2_activations;
create trigger trg_ldm2_activations_touch before update on public.ldm2_activations
for each row execute function public.ldm2_touch_updated_at();

insert into public.ldm2_plans(
    code,name,description,price_monthly,price_yearly,price_lifetime,
    max_devices,max_stores,features,active,sort_order
) values
(
    'WARUNG_KECIL','Warung Kecil','Operasional inti untuk satu warung.',29000,299000,null,2,1,
    '["dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns","shift_closing","backup_restore","basic_promo"]'::jsonb,
    true,10
),
(
    'WARUNG_SEDERHANA','Warung Sederhana','Operasional lengkap, pembelian, dan Cloud dasar.',59000,599000,null,3,1,
    '["dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns","shift_closing","backup_restore","basic_promo","advanced_promo","expenses","suppliers","purchase_order","goods_receipt","cloud_accounts","cloud_devices","recovery_center","app_update"]'::jsonb,
    true,20
),
(
    'TOKO','Toko','Operasional tingkat lanjut untuk beberapa cabang.',99000,999000,null,10,5,
    '["dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns","shift_closing","backup_restore","basic_promo","advanced_promo","expenses","suppliers","purchase_order","goods_receipt","cloud_accounts","cloud_devices","recovery_center","app_update","multi_store","cloud_control","central_control","eod","qa_security"]'::jsonb,
    true,30
),
(
    'LIFETIME','Lifetime','Semua fitur dengan masa pakai tanpa tanggal kedaluwarsa.',null,null,3499000,15,8,
    '["dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns","shift_closing","backup_restore","basic_promo","advanced_promo","expenses","suppliers","purchase_order","goods_receipt","cloud_accounts","cloud_devices","recovery_center","app_update","multi_store","cloud_control","central_control","eod","qa_security"]'::jsonb,
    true,40
)
on conflict (code) do update set
    name=excluded.name,
    description=excluded.description,
    price_monthly=excluded.price_monthly,
    price_yearly=excluded.price_yearly,
    price_lifetime=excluded.price_lifetime,
    max_devices=excluded.max_devices,
    max_stores=excluded.max_stores,
    features=excluded.features,
    active=excluded.active,
    sort_order=excluded.sort_order;

create or replace function public.ldm2_issue_license(
    p_plan_code text,
    p_customer_name text,
    p_customer_email text,
    p_customer_phone text default null,
    p_duration_months integer default 1,
    p_notes text default null
)
returns table(license_id uuid, license_key text, plan_code text, starts_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_plan public.ldm2_plans%rowtype;
    v_key text;
    v_id uuid;
    v_start timestamptz := now();
    v_expiry timestamptz;
begin
    select * into v_plan from public.ldm2_plans
    where code=upper(btrim(p_plan_code)) and active=true;
    if not found then raise exception 'Paket tidak ditemukan atau nonaktif.'; end if;
    if nullif(btrim(p_customer_name),'') is null then raise exception 'Nama customer wajib diisi.'; end if;
    if nullif(btrim(p_customer_email),'') is null then raise exception 'Email customer wajib diisi.'; end if;

    if v_plan.code='LIFETIME' then
        v_expiry := null;
    else
        if coalesce(p_duration_months,0) < 1 then raise exception 'Durasi minimal 1 bulan.'; end if;
        v_expiry := v_start + make_interval(months => p_duration_months);
    end if;

    v_key := 'LDM2-' || replace(v_plan.code,'WARUNG_','W') || '-'
        || upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8)) || '-'
        || upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8)) || '-'
        || upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8));

    insert into public.ldm2_licenses(
        key_hash,key_prefix,customer_name,customer_email,customer_phone,
        customer_email_hash,plan_code,status,is_trial,starts_at,expires_at,notes
    ) values (
        extensions.digest(upper(v_key),'sha256'),left(v_key,18),btrim(p_customer_name),lower(btrim(p_customer_email)),
        nullif(btrim(p_customer_phone),''),extensions.digest(lower(btrim(p_customer_email)),'sha256'),
        v_plan.code,'active',false,v_start,v_expiry,p_notes
    ) returning id into v_id;

    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_id,'LICENSE_ISSUED',jsonb_build_object('plan',v_plan.code,'duration_months',p_duration_months));

    return query select v_id,v_key,v_plan.code,v_start,v_expiry;
end;
$$;

create or replace function public.ldm2_activate(
    p_key_hash_hex text,
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
    v_license public.ldm2_licenses%rowtype;
    v_plan public.ldm2_plans%rowtype;
    v_activation_id uuid;
    v_device_limit integer;
    v_store_limit integer;
    v_device_count integer;
    v_store_count integer;
    v_existing boolean;
begin
    select * into v_license from public.ldm2_licenses
    where key_hash=decode(p_key_hash_hex,'hex') for update;
    if not found then return jsonb_build_object('ok',false,'code','LICENSE_KEY_INVALID','message','License Key tidak ditemukan.'); end if;

    if v_license.expires_at is not null and now() >= v_license.expires_at then
        update public.ldm2_licenses set status='expired' where id=v_license.id;
        return jsonb_build_object('ok',false,'code','LICENSE_EXPIRED','message','Masa berlaku lisensi sudah berakhir.');
    end if;
    if v_license.status <> 'active' then
        return jsonb_build_object('ok',false,'code','LICENSE_'||upper(v_license.status),'message','Lisensi sedang '||v_license.status||'.');
    end if;

    select * into v_plan from public.ldm2_plans where code=v_license.plan_code and active=true;
    if not found then return jsonb_build_object('ok',false,'code','PLAN_INACTIVE','message','Paket sedang tidak tersedia.'); end if;

    v_device_limit := coalesce(v_license.max_devices_override,v_plan.max_devices);
    v_store_limit := coalesce(v_license.max_stores_override,v_plan.max_stores);
    select exists(select 1 from public.ldm2_activations a where a.license_id=v_license.id
        and a.device_hash=decode(p_device_hash_hex,'hex') and a.store_code=upper(btrim(p_store_code))) into v_existing;

    if not v_existing then
        select count(distinct device_hash) into v_device_count from public.ldm2_activations
        where license_id=v_license.id and status='active';
        if v_device_count >= v_device_limit then
            return jsonb_build_object('ok',false,'code','DEVICE_LIMIT_REACHED','message','Batas perangkat paket sudah tercapai.','limit',v_device_limit);
        end if;
        select count(distinct store_code) into v_store_count from public.ldm2_activations
        where license_id=v_license.id and status='active';
        if v_store_count >= v_store_limit and not exists(
            select 1 from public.ldm2_activations where license_id=v_license.id
            and status='active' and store_code=upper(btrim(p_store_code))
        ) then
            return jsonb_build_object('ok',false,'code','STORE_LIMIT_REACHED','message','Batas toko paket sudah tercapai.','limit',v_store_limit);
        end if;
    end if;

    insert into public.ldm2_activations(
        license_id,activation_token_hash,device_hash,device_name,store_code,status,
        activated_at,last_seen_at,deactivated_at,deactivation_reason,app_version,ip_hash
    ) values (
        v_license.id,decode(p_activation_token_hash_hex,'hex'),decode(p_device_hash_hex,'hex'),
        coalesce(nullif(btrim(p_device_name),''),'Perangkat'),upper(btrim(p_store_code)),'active',
        now(),now(),null,null,p_app_version,
        case when nullif(p_ip_hash_hex,'') is null then null else decode(p_ip_hash_hex,'hex') end
    ) on conflict (license_id,device_hash,store_code) do update set
        activation_token_hash=excluded.activation_token_hash,
        device_name=excluded.device_name,status='active',activated_at=now(),last_seen_at=now(),
        deactivated_at=null,deactivation_reason=null,app_version=excluded.app_version,ip_hash=excluded.ip_hash,
        updated_at=now()
    returning id into v_activation_id;

    insert into public.ldm2_events(license_id,activation_id,event_type,detail)
    values(v_license.id,v_activation_id,'DEVICE_ACTIVATED',jsonb_build_object('store_code',upper(btrim(p_store_code)),'device_name',p_device_name));

    return jsonb_build_object(
        'ok',true,'license_id',v_license.id,'plan_code',v_plan.code,'plan_name',v_plan.name,
        'status','active','is_trial',v_license.is_trial,'expires_at',v_license.expires_at,
        'max_devices',v_device_limit,'max_stores',v_store_limit,'features',v_plan.features,
        'store_code',upper(btrim(p_store_code))
    );
end;
$$;

create or replace function public.ldm2_check(
    p_activation_token_hash_hex text,
    p_device_hash_hex text,
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
    v_activation public.ldm2_activations%rowtype;
    v_license public.ldm2_licenses%rowtype;
    v_plan public.ldm2_plans%rowtype;
begin
    select * into v_activation from public.ldm2_activations
    where activation_token_hash=decode(p_activation_token_hash_hex,'hex')
      and device_hash=decode(p_device_hash_hex,'hex')
      and store_code=upper(btrim(p_store_code))
    limit 1;
    if not found or v_activation.status <> 'active' then
        return jsonb_build_object('ok',false,'code','ACTIVATION_INVALID','message','Aktivasi perangkat tidak tersedia atau sudah dinonaktifkan.');
    end if;

    select * into v_license from public.ldm2_licenses where id=v_activation.license_id for update;
    if v_license.expires_at is not null and now() >= v_license.expires_at then
        update public.ldm2_licenses set status='expired',last_checked_at=now() where id=v_license.id;
        return jsonb_build_object('ok',false,'code','LICENSE_EXPIRED','message','Masa berlaku lisensi sudah berakhir.','expires_at',v_license.expires_at);
    end if;
    if v_license.status <> 'active' then
        return jsonb_build_object('ok',false,'code','LICENSE_'||upper(v_license.status),'message','Lisensi sedang '||v_license.status||'.');
    end if;

    select * into v_plan from public.ldm2_plans where code=v_license.plan_code and active=true;
    if not found then return jsonb_build_object('ok',false,'code','PLAN_INACTIVE','message','Paket sedang tidak tersedia.'); end if;

    update public.ldm2_activations set last_seen_at=now(),app_version=p_app_version,
        ip_hash=case when nullif(p_ip_hash_hex,'') is null then ip_hash else decode(p_ip_hash_hex,'hex') end
    where id=v_activation.id;
    update public.ldm2_licenses set last_checked_at=now() where id=v_license.id;

    return jsonb_build_object(
        'ok',true,'license_id',v_license.id,'plan_code',v_plan.code,'plan_name',v_plan.name,
        'status','active','is_trial',v_license.is_trial,'expires_at',v_license.expires_at,
        'max_devices',coalesce(v_license.max_devices_override,v_plan.max_devices),
        'max_stores',coalesce(v_license.max_stores_override,v_plan.max_stores),
        'features',v_plan.features,'store_code',v_activation.store_code,
        'checked_at',now()
    );
end;
$$;

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
    v_expiry timestamptz := now() + interval '14 days';
    v_features jsonb;
begin
    if exists(select 1 from public.ldm2_trial_claims where
        email_hash=decode(p_email_hash_hex,'hex') or
        identity_hash=decode(p_trial_identity_hash_hex,'hex')
    ) then
        return jsonb_build_object('ok',false,'code','TRIAL_ALREADY_USED','message','Masa trial sudah pernah digunakan oleh email atau instalasi ini.');
    end if;
    select features into v_features from public.ldm2_plans where code='WARUNG_SEDERHANA' and active=true;
    if v_features is null then return jsonb_build_object('ok',false,'code','TRIAL_PLAN_INACTIVE','message','Paket trial sedang tidak tersedia.'); end if;

    insert into public.ldm2_licenses(
        key_hash,key_prefix,customer_name,customer_email,customer_phone,customer_email_hash,
        plan_code,status,is_trial,trial_identity_hash,starts_at,expires_at,
        max_devices_override,max_stores_override,notes
    ) values (
        null,'TRIAL-14-HARI',btrim(p_customer_name),lower(btrim(p_customer_email)),nullif(btrim(p_customer_phone),''),
        decode(p_email_hash_hex,'hex'),'WARUNG_SEDERHANA','active',true,decode(p_trial_identity_hash_hex,'hex'),
        now(),v_expiry,1,1,'Trial otomatis Paket Warung Sederhana'
    ) returning id into v_license_id;

    insert into public.ldm2_trial_claims(email_hash,identity_hash,license_id)
    values(decode(p_email_hash_hex,'hex'),decode(p_trial_identity_hash_hex,'hex'),v_license_id);

    insert into public.ldm2_activations(
        license_id,activation_token_hash,device_hash,device_name,store_code,status,app_version,ip_hash
    ) values (
        v_license_id,decode(p_activation_token_hash_hex,'hex'),decode(p_device_hash_hex,'hex'),
        coalesce(nullif(btrim(p_device_name),''),'Perangkat Trial'),upper(btrim(p_store_code)),'active',p_app_version,
        case when nullif(p_ip_hash_hex,'') is null then null else decode(p_ip_hash_hex,'hex') end
    ) returning id into v_activation_id;

    insert into public.ldm2_events(license_id,activation_id,event_type,detail)
    values(v_license_id,v_activation_id,'TRIAL_STARTED',jsonb_build_object('days',14,'store_code',upper(btrim(p_store_code))));

    return jsonb_build_object(
        'ok',true,'license_id',v_license_id,'plan_code','WARUNG_SEDERHANA','plan_name','Warung Sederhana',
        'status','active','is_trial',true,'expires_at',v_expiry,'max_devices',1,'max_stores',1,
        'features',v_features,'store_code',upper(btrim(p_store_code))
    );
exception when unique_violation then
    return jsonb_build_object('ok',false,'code','TRIAL_ALREADY_USED','message','Masa trial sudah pernah digunakan.');
end;
$$;

create or replace function public.ldm2_set_license_status(p_license_id uuid,p_status text,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_license public.ldm2_licenses%rowtype;
begin
    if lower(p_status) not in ('active','suspended','cancelled') then raise exception 'Status tidak diizinkan.'; end if;
    update public.ldm2_licenses set status=lower(p_status),notes=case when p_reason is null then notes else p_reason end
    where id=p_license_id returning * into v_license;
    if not found then raise exception 'Lisensi tidak ditemukan.'; end if;
    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,'LICENSE_STATUS_CHANGED',jsonb_build_object('status',v_license.status,'reason',p_reason));
    return jsonb_build_object('ok',true,'license_id',v_license.id,'status',v_license.status);
end;
$$;

create or replace function public.ldm2_renew_license(p_license_id uuid,p_duration_months integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_license public.ldm2_licenses%rowtype; v_base timestamptz; v_expiry timestamptz;
begin
    if p_duration_months < 1 then raise exception 'Durasi minimal 1 bulan.'; end if;
    select * into v_license from public.ldm2_licenses where id=p_license_id for update;
    if not found then raise exception 'Lisensi tidak ditemukan.'; end if;
    if v_license.plan_code='LIFETIME' then return jsonb_build_object('ok',true,'license_id',v_license.id,'status','active','expires_at',null,'message','Lifetime tidak memerlukan perpanjangan.'); end if;
    v_base := greatest(now(),coalesce(v_license.expires_at,now()));
    v_expiry := v_base + make_interval(months=>p_duration_months);
    update public.ldm2_licenses set expires_at=v_expiry,status='active' where id=v_license.id;
    insert into public.ldm2_events(license_id,event_type,detail)
    values(v_license.id,'LICENSE_RENEWED',jsonb_build_object('months',p_duration_months,'expires_at',v_expiry));
    return jsonb_build_object('ok',true,'license_id',v_license.id,'status','active','expires_at',v_expiry);
end;
$$;

create or replace function public.ldm2_convert_trial(
    p_license_id uuid,p_plan_code text,p_duration_months integer default 1
)
returns table(license_id uuid,license_key text,plan_code text,expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_plan public.ldm2_plans%rowtype; v_key text; v_expiry timestamptz;
begin
    select * into v_plan from public.ldm2_plans where code=upper(btrim(p_plan_code)) and active=true;
    if not found then raise exception 'Paket tidak ditemukan.'; end if;
    if not exists(select 1 from public.ldm2_licenses where id=p_license_id and is_trial=true) then raise exception 'Lisensi trial tidak ditemukan.'; end if;
    if v_plan.code='LIFETIME' then v_expiry:=null;
    else
        if p_duration_months<1 then raise exception 'Durasi minimal 1 bulan.'; end if;
        v_expiry:=now()+make_interval(months=>p_duration_months);
    end if;
    v_key := 'LDM2-'||replace(v_plan.code,'WARUNG_','W')||'-'||upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8))||'-'||upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8))||'-'||upper(substr(encode(extensions.gen_random_bytes(12),'hex'),1,8));
    update public.ldm2_licenses set key_hash=extensions.digest(upper(v_key),'sha256'),key_prefix=left(v_key,18),
        plan_code=v_plan.code,status='active',is_trial=false,starts_at=now(),expires_at=v_expiry,
        max_devices_override=null,max_stores_override=null,notes='Trial dikonversi menjadi berbayar'
    where id=p_license_id;
    insert into public.ldm2_events(license_id,event_type,detail)
    values(p_license_id,'TRIAL_CONVERTED',jsonb_build_object('plan',v_plan.code,'expires_at',v_expiry));
    return query select p_license_id,v_key,v_plan.code,v_expiry;
end;
$$;

create or replace function public.ldm2_deactivate_device(p_activation_id uuid,p_reason text default 'Dinonaktifkan developer')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_activation public.ldm2_activations%rowtype;
begin
    update public.ldm2_activations set status='deactivated',deactivated_at=now(),deactivation_reason=p_reason
    where id=p_activation_id returning * into v_activation;
    if not found then raise exception 'Perangkat tidak ditemukan.'; end if;
    insert into public.ldm2_events(license_id,activation_id,event_type,detail)
    values(v_activation.license_id,v_activation.id,'DEVICE_DEACTIVATED',jsonb_build_object('reason',p_reason));
    return jsonb_build_object('ok',true,'activation_id',v_activation.id,'status','deactivated');
end;
$$;

create or replace function public.ldm2_deactivate_by_token(
    p_activation_token_hash_hex text,p_device_hash_hex text,p_store_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_activation public.ldm2_activations%rowtype;
begin
    update public.ldm2_activations set status='deactivated',deactivated_at=now(),
        deactivation_reason='Dinonaktifkan dari perangkat customer'
    where activation_token_hash=decode(p_activation_token_hash_hex,'hex')
      and device_hash=decode(p_device_hash_hex,'hex')
      and store_code=upper(btrim(p_store_code))
    returning * into v_activation;
    if not found then
        return jsonb_build_object('ok',false,'code','ACTIVATION_INVALID','message','Aktivasi tidak ditemukan.');
    end if;
    insert into public.ldm2_events(license_id,activation_id,event_type,detail)
    values(v_activation.license_id,v_activation.id,'DEVICE_DEACTIVATED',jsonb_build_object('reason','Customer self-service'));
    return jsonb_build_object('ok',true,'activation_id',v_activation.id,'status','deactivated');
end;
$$;

create or replace view public.ldm2_admin_license_overview as
select
    l.id,l.key_prefix,l.customer_name,l.customer_email,l.customer_phone,l.plan_code,p.name as plan_name,
    l.status,l.is_trial,l.starts_at,l.expires_at,l.notes,l.created_at,l.updated_at,l.last_checked_at,
    coalesce(l.max_devices_override,p.max_devices) as max_devices,
    coalesce(l.max_stores_override,p.max_stores) as max_stores,
    count(a.id) filter(where a.status='active') as active_installations,
    count(distinct a.device_hash) filter(where a.status='active') as active_devices,
    count(distinct a.store_code) filter(where a.status='active') as active_stores
from public.ldm2_licenses l
join public.ldm2_plans p on p.code=l.plan_code
left join public.ldm2_activations a on a.license_id=l.id
group by l.id,p.name,p.max_devices,p.max_stores;

alter table public.ldm2_plans enable row level security;
alter table public.ldm2_licenses enable row level security;
alter table public.ldm2_trial_claims enable row level security;
alter table public.ldm2_activations enable row level security;
alter table public.ldm2_events enable row level security;
alter table public.ldm2_admin_audit enable row level security;

revoke all on table public.ldm2_plans,public.ldm2_licenses,public.ldm2_trial_claims,public.ldm2_activations,public.ldm2_events,public.ldm2_admin_audit from public,anon,authenticated;
revoke all on public.ldm2_admin_license_overview from public,anon,authenticated;
grant all on table public.ldm2_plans,public.ldm2_licenses,public.ldm2_trial_claims,public.ldm2_activations,public.ldm2_events,public.ldm2_admin_audit to service_role;
grant select on public.ldm2_admin_license_overview to service_role;
grant usage,select on all sequences in schema public to service_role;

revoke all on function public.ldm2_issue_license(text,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.ldm2_activate(text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_check(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_start_trial(text,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_set_license_status(uuid,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_renew_license(uuid,integer) from public,anon,authenticated;
revoke all on function public.ldm2_convert_trial(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.ldm2_deactivate_device(uuid,text) from public,anon,authenticated;
revoke all on function public.ldm2_deactivate_by_token(text,text,text) from public,anon,authenticated;

grant execute on function public.ldm2_issue_license(text,text,text,text,integer,text) to service_role;
grant execute on function public.ldm2_activate(text,text,text,text,text,text,text) to service_role;
grant execute on function public.ldm2_check(text,text,text,text,text) to service_role;
grant execute on function public.ldm2_start_trial(text,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.ldm2_set_license_status(uuid,text,text) to service_role;
grant execute on function public.ldm2_renew_license(uuid,integer) to service_role;
grant execute on function public.ldm2_convert_trial(uuid,text,integer) to service_role;
grant execute on function public.ldm2_deactivate_device(uuid,text) to service_role;
grant execute on function public.ldm2_deactivate_by_token(text,text,text) to service_role;

commit;

select code,name,max_devices,max_stores,active from public.ldm2_plans order by sort_order;

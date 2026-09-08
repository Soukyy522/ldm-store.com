-- =============================================================================
-- LocDailyMar 27.9.0 - V28.1.8
-- LEGACY LIFETIME + OWNER LICENSE VAULT
-- Jalankan pada Supabase PROJECT LICENSE AUTHORITY V2:
-- vplweadbeujidsoponrl
--
-- TUJUAN:
-- 1. Lisensi LIFETIME lama tetap dapat diaktifkan/dicek walaupun plan LIFETIME
--    tidak aktif untuk PENJUALAN BARU.
-- 2. Menambahkan vault terenkripsi untuk menyimpan kembali License Key yang
--    memang masih dimiliki customer saat aktivasi, agar dapat dilihat ulang
--    oleh Owner yang terautentikasi.
-- 3. TIDAK mengaktifkan kembali penjualan paket Lifetime.
--
-- PENTING:
-- - ldm2_plans.LIFETIME tetap active=false.
-- - License Key historis yang hanya tersimpan sebagai HASH tidak dapat
--   direkonstruksi. Vault akan terisi saat customer mengaktivasi dengan key
--   lama, atau dari checkout modern yang memang sudah menyimpan ciphertext.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. Vault terenkripsi untuk key yang dapat dipulihkan.
--    Isi ciphertext dibuat/dibaca hanya oleh Edge Function service-role.
-- -----------------------------------------------------------------------------
create table if not exists public.ldm2_license_secret_vault (
    license_id uuid primary key
        references public.ldm2_licenses(id) on delete cascade,
    license_key_ciphertext text not null,
    source text not null default 'activation'
        check (source in ('activation','checkout','developer')),
    registered_at timestamptz not null default now(),
    last_revealed_at timestamptz,
    reveal_count integer not null default 0 check (reveal_count >= 0),
    updated_at timestamptz not null default now()
);

drop trigger if exists trg_ldm2_license_secret_vault_touch
on public.ldm2_license_secret_vault;

create trigger trg_ldm2_license_secret_vault_touch
before update on public.ldm2_license_secret_vault
for each row execute function public.ldm2_touch_updated_at();

alter table public.ldm2_license_secret_vault enable row level security;
revoke all on public.ldm2_license_secret_vault from anon, authenticated;

comment on table public.ldm2_license_secret_vault is
'Ciphertext License Key untuk pemulihan oleh Owner yang terautentikasi. Tidak menyimpan password Owner.';

-- -----------------------------------------------------------------------------
-- B. Aktivasi: Lifetime legacy boleh memakai plan row yang inactive.
--    Paket inactive selain Lifetime tetap ditolak.
-- -----------------------------------------------------------------------------
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
    select * into v_license
    from public.ldm2_licenses
    where key_hash=decode(p_key_hash_hex,'hex')
    for update;

    if not found then
        return jsonb_build_object(
            'ok',false,
            'code','LICENSE_KEY_INVALID',
            'message','License Key tidak ditemukan.'
        );
    end if;

    if v_license.expires_at is not null and now() >= v_license.expires_at then
        update public.ldm2_licenses
        set status='expired'
        where id=v_license.id;

        return jsonb_build_object(
            'ok',false,
            'code','LICENSE_EXPIRED',
            'message','Masa berlaku lisensi sudah berakhir.'
        );
    end if;

    if v_license.status <> 'active' then
        return jsonb_build_object(
            'ok',false,
            'code','LICENSE_'||upper(v_license.status),
            'message','Lisensi sedang '||v_license.status||'.'
        );
    end if;

    -- Lifetime legacy tetap boleh dipakai walaupun active=false pada katalog.
    -- Katalog active=false hanya berarti TIDAK DIJUAL LAGI.
    select *
    into v_plan
    from public.ldm2_plans
    where code=v_license.plan_code
      and (
        active=true
        or code='LIFETIME'
      );

    if not found then
        return jsonb_build_object(
            'ok',false,
            'code','PLAN_INACTIVE',
            'message','Paket sedang tidak tersedia.'
        );
    end if;

    v_device_limit := coalesce(v_license.max_devices_override,v_plan.max_devices);
    v_store_limit := coalesce(v_license.max_stores_override,v_plan.max_stores);

    select exists(
        select 1
        from public.ldm2_activations a
        where a.license_id=v_license.id
          and a.device_hash=decode(p_device_hash_hex,'hex')
          and a.store_code=upper(btrim(p_store_code))
    )
    into v_existing;

    if not v_existing then
        select count(distinct device_hash)
        into v_device_count
        from public.ldm2_activations
        where license_id=v_license.id
          and status='active';

        if v_device_count >= v_device_limit then
            return jsonb_build_object(
                'ok',false,
                'code','DEVICE_LIMIT_REACHED',
                'message','Batas perangkat paket sudah tercapai.',
                'limit',v_device_limit
            );
        end if;

        select count(distinct store_code)
        into v_store_count
        from public.ldm2_activations
        where license_id=v_license.id
          and status='active';

        if v_store_count >= v_store_limit
           and not exists(
                select 1
                from public.ldm2_activations
                where license_id=v_license.id
                  and status='active'
                  and store_code=upper(btrim(p_store_code))
           ) then
            return jsonb_build_object(
                'ok',false,
                'code','STORE_LIMIT_REACHED',
                'message','Batas toko paket sudah tercapai.',
                'limit',v_store_limit
            );
        end if;
    end if;

    insert into public.ldm2_activations(
        license_id,
        activation_token_hash,
        device_hash,
        device_name,
        store_code,
        status,
        activated_at,
        last_seen_at,
        deactivated_at,
        deactivation_reason,
        app_version,
        ip_hash
    ) values (
        v_license.id,
        decode(p_activation_token_hash_hex,'hex'),
        decode(p_device_hash_hex,'hex'),
        coalesce(nullif(btrim(p_device_name),''),'Perangkat'),
        upper(btrim(p_store_code)),
        'active',
        now(),
        now(),
        null,
        null,
        p_app_version,
        case
            when nullif(p_ip_hash_hex,'') is null then null
            else decode(p_ip_hash_hex,'hex')
        end
    )
    on conflict (license_id,device_hash,store_code)
    do update set
        activation_token_hash=excluded.activation_token_hash,
        device_name=excluded.device_name,
        status='active',
        activated_at=now(),
        last_seen_at=now(),
        deactivated_at=null,
        deactivation_reason=null,
        app_version=excluded.app_version,
        ip_hash=excluded.ip_hash,
        updated_at=now()
    returning id into v_activation_id;

    insert into public.ldm2_events(
        license_id,
        activation_id,
        event_type,
        detail
    ) values (
        v_license.id,
        v_activation_id,
        'DEVICE_ACTIVATED',
        jsonb_build_object(
            'store_code',upper(btrim(p_store_code)),
            'device_name',p_device_name,
            'legacy_lifetime',v_plan.code='LIFETIME' and v_plan.active=false
        )
    );

    return jsonb_build_object(
        'ok',true,
        'license_id',v_license.id,
        'plan_code',v_plan.code,
        'plan_name',v_plan.name,
        'status','active',
        'is_trial',v_license.is_trial,
        'expires_at',v_license.expires_at,
        'max_devices',v_device_limit,
        'max_stores',v_store_limit,
        'features',v_plan.features,
        'store_code',upper(btrim(p_store_code)),
        'legacy_plan',v_plan.code='LIFETIME' and v_plan.active=false,
        'plan_sales_active',v_plan.active
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- C. Check: aturan legacy Lifetime sama seperti aktivasi.
-- -----------------------------------------------------------------------------
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
    select *
    into v_activation
    from public.ldm2_activations
    where activation_token_hash=decode(p_activation_token_hash_hex,'hex')
      and device_hash=decode(p_device_hash_hex,'hex')
      and store_code=upper(btrim(p_store_code))
    limit 1;

    if not found or v_activation.status <> 'active' then
        return jsonb_build_object(
            'ok',false,
            'code','ACTIVATION_INVALID',
            'message','Aktivasi perangkat tidak tersedia atau sudah dinonaktifkan.'
        );
    end if;

    select *
    into v_license
    from public.ldm2_licenses
    where id=v_activation.license_id
    for update;

    if v_license.expires_at is not null and now() >= v_license.expires_at then
        update public.ldm2_licenses
        set status='expired',
            last_checked_at=now()
        where id=v_license.id;

        return jsonb_build_object(
            'ok',false,
            'code','LICENSE_EXPIRED',
            'message','Masa berlaku lisensi sudah berakhir.',
            'expires_at',v_license.expires_at
        );
    end if;

    if v_license.status <> 'active' then
        return jsonb_build_object(
            'ok',false,
            'code','LICENSE_'||upper(v_license.status),
            'message','Lisensi sedang '||v_license.status||'.'
        );
    end if;

    select *
    into v_plan
    from public.ldm2_plans
    where code=v_license.plan_code
      and (
        active=true
        or code='LIFETIME'
      );

    if not found then
        return jsonb_build_object(
            'ok',false,
            'code','PLAN_INACTIVE',
            'message','Paket sedang tidak tersedia.'
        );
    end if;

    update public.ldm2_activations
    set last_seen_at=now(),
        app_version=p_app_version,
        ip_hash=case
            when nullif(p_ip_hash_hex,'') is null then ip_hash
            else decode(p_ip_hash_hex,'hex')
        end
    where id=v_activation.id;

    update public.ldm2_licenses
    set last_checked_at=now()
    where id=v_license.id;

    return jsonb_build_object(
        'ok',true,
        'license_id',v_license.id,
        'plan_code',v_plan.code,
        'plan_name',v_plan.name,
        'status','active',
        'is_trial',v_license.is_trial,
        'expires_at',v_license.expires_at,
        'max_devices',coalesce(v_license.max_devices_override,v_plan.max_devices),
        'max_stores',coalesce(v_license.max_stores_override,v_plan.max_stores),
        'features',v_plan.features,
        'store_code',v_activation.store_code,
        'checked_at',now(),
        'legacy_plan',v_plan.code='LIFETIME' and v_plan.active=false,
        'plan_sales_active',v_plan.active
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- D. Pastikan Lifetime tetap OFF untuk penjualan baru.
-- -----------------------------------------------------------------------------
update public.ldm2_plans
set active=false
where code='LIFETIME';

commit;

-- =============================================================================
-- VERIFIKASI CEPAT
-- =============================================================================
select
    code,
    name,
    active,
    max_devices,
    max_stores
from public.ldm2_plans
where code='LIFETIME';

select
    to_regclass('public.ldm2_license_secret_vault') is not null
        as owner_license_vault_table_ok;

select
    count(*) as lifetime_active_license_count
from public.ldm2_licenses
where plan_code='LIFETIME'
  and status='active';

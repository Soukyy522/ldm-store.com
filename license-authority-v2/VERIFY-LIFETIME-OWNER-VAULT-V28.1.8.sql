-- =============================================================================
-- LocDailyMar V28.1.8 - VERIFY LEGACY LIFETIME + OWNER VAULT
-- READ ONLY
-- =============================================================================

-- 1. Lifetime tetap tidak dijual baru.
select
    code,
    name,
    active,
    max_devices,
    max_stores
from public.ldm2_plans
where code='LIFETIME';

-- TARGET:
-- code=LIFETIME
-- active=false

-- 2. Vault tersedia.
select
    to_regclass('public.ldm2_license_secret_vault') is not null
        as owner_license_vault_table_ok;

-- 3. Lifetime aktif yang sudah ada tidak dihapus.
select
    id,
    customer_email,
    plan_code,
    status,
    starts_at,
    expires_at,
    primary_store_code
from public.ldm2_licenses
where plan_code='LIFETIME'
order by created_at desc
limit 50;

-- TARGET untuk lisensi lama yang masih sah:
-- status=active
-- expires_at=NULL

-- 4. Fungsi activate/check mengandung pengecualian legacy Lifetime.
select
    position(
        'or code=''lifetime'''
        in lower(pg_get_functiondef(
            'public.ldm2_activate(text,text,text,text,text,text,text)'::regprocedure
        ))
    ) > 0 as activate_lifetime_legacy_patch_ok;

select
    position(
        'or code=''lifetime'''
        in lower(pg_get_functiondef(
            'public.ldm2_check(text,text,text,text,text)'::regprocedure
        ))
    ) > 0 as check_lifetime_legacy_patch_ok;

-- 5. Vault key yang sudah terdaftar. Ciphertext tidak ditampilkan.
select
    v.license_id,
    l.plan_code,
    l.customer_email,
    v.source,
    v.registered_at,
    v.last_revealed_at,
    v.reveal_count,
    length(v.license_key_ciphertext) > 20 as ciphertext_present
from public.ldm2_license_secret_vault v
join public.ldm2_licenses l on l.id=v.license_id
order by v.updated_at desc
limit 50;

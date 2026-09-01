-- =====================================================================
-- ONBOARDING CUSTOMER DENGAN STORE ID/NETWORK ID DARI DEVELOPER CENTER
-- Jalankan pada project SUPABASE CLOUD APLIKASI customer.
-- BUKAN pada project Supabase khusus lisensi.
--
-- Sebelum RUN:
-- 1. Authentication > Users > Add user.
-- 2. Buat akun Owner customer dan konfirmasi emailnya.
-- 3. Salin Store Code, Store ID, dan Network ID hasil Developer Center.
-- 4. Ganti semua nilai pada bagian KONFIGURASI.
-- =====================================================================

do $$
declare
    -- ======================= KONFIGURASI =======================
    v_email text := lower('email.customer@example.com');
    v_store_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_network_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_store_code text := upper('LDM-STORE-CODE');
    v_store_name text := 'Nama Toko Customer';
    v_username text := 'owner';
    v_display_name text := 'Owner Toko';
    v_timezone text := 'Asia/Makassar';
    -- ===========================================================

    v_user_id uuid;
    v_existing_store_id uuid;
    v_existing_network_id uuid;
begin
    if v_store_id='00000000-0000-0000-0000-000000000000'::uuid
       or v_network_id='00000000-0000-0000-0000-000000000000'::uuid then
        raise exception 'Ganti Store ID dan Network ID dengan hasil Developer Center.';
    end if;
    if v_store_code='LDM-STORE-CODE' then
        raise exception 'Ganti Store Code dengan hasil Developer Center.';
    end if;
    if to_regclass('public.stores') is null or to_regclass('public.profiles') is null then
        raise exception 'Cloud Foundation aplikasi belum terpasang.';
    end if;

    select id into v_user_id
    from auth.users
    where lower(email)=v_email
    limit 1;
    if v_user_id is null then
        raise exception 'Auth User % belum ada. Buat dahulu melalui Authentication > Users.',v_email;
    end if;

    select id into v_existing_store_id
    from public.stores
    where upper(code)=v_store_code
    limit 1;
    if v_existing_store_id is not null and v_existing_store_id<>v_store_id then
        raise exception 'Store Code % sudah terhubung dengan Store ID lain: %',v_store_code,v_existing_store_id;
    end if;

    insert into public.stores(id,code,name,timezone,currency,status,deleted_at)
    values(v_store_id,v_store_code,v_store_name,v_timezone,'IDR','active',null)
    on conflict(id) do update set
        code=excluded.code,name=excluded.name,timezone=excluded.timezone,
        status='active',deleted_at=null;

    insert into public.profiles(id,store_id,username,display_name,role,active,deleted_at,deleted_by)
    values(v_user_id,v_store_id,v_username,v_display_name,'owner',true,null,null)
    on conflict(id) do update set
        store_id=excluded.store_id,username=excluded.username,display_name=excluded.display_name,
        role='owner',active=true,deleted_at=null,deleted_by=null;

    if to_regclass('public.store_networks') is not null
       and to_regclass('public.store_network_stores') is not null
       and to_regclass('public.store_memberships') is not null then

        select id into v_existing_network_id
        from public.store_networks
        where code='NET-'||v_store_code
        limit 1;
        if v_existing_network_id is not null and v_existing_network_id<>v_network_id then
            raise exception 'Network Code sudah terhubung dengan Network ID lain: %',v_existing_network_id;
        end if;

        insert into public.store_networks(id,code,name,active,created_by,deleted_at)
        values(v_network_id,'NET-'||v_store_code,v_store_name||' Network',true,v_user_id,null)
        on conflict(id) do update set
            code=excluded.code,name=excluded.name,active=true,created_by=v_user_id,deleted_at=null;

        insert into public.store_network_stores(network_id,store_id,is_primary,active)
        values(v_network_id,v_store_id,true,true)
        on conflict(store_id) do update set
            network_id=excluded.network_id,is_primary=true,active=true;

        insert into public.store_memberships(user_id,store_id,role,active,is_default,invited_by)
        values(v_user_id,v_store_id,'owner',true,true,v_user_id)
        on conflict(user_id,store_id) do update set
            role='owner',active=true,is_default=true,updated_at=now();
    end if;

    raise notice 'ONBOARDING BERHASIL | user_id=% | store_id=% | store_code=% | network_id=%',
        v_user_id,v_store_id,v_store_code,v_network_id;
end
$$;

-- HASIL PEMERIKSAAN
select
    p.id as user_id,u.email,p.username,p.role,p.active,
    s.id as store_id,s.code as store_code,s.name as store_name,
    sns.network_id,sns.is_primary
from public.profiles p
join auth.users u on u.id=p.id
join public.stores s on s.id=p.store_id
left join public.store_network_stores sns on sns.store_id=s.id
where lower(u.email)=lower('email.customer@example.com');

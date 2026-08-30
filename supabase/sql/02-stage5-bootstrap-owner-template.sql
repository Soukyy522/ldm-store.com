-- ================================================================
-- LocDailyMar - Tahap 5
-- TEMPLATE BOOTSTRAP OWNER
--
-- Jalankan HANYA setelah user sudah ada di:
-- Supabase Dashboard -> Authentication -> Users
--
-- CARA PAKAI:
-- 1. Ganti OWNER_EMAIL_HERE dengan email Auth user yang sudah dibuat.
-- 2. Ganti OWNER_USERNAME_HERE dengan username aplikasi yang diinginkan.
-- 3. Jalankan file ini di SQL Editor.
--
-- Contoh username:
-- owner
-- atau
-- cornermar
--
-- JANGAN masukkan password ke SQL ini.
-- ================================================================

begin;

do $$
declare
    v_owner_email text := 'OWNER_EMAIL_HERE';
    v_owner_username text := 'OWNER_USERNAME_HERE';

    v_auth_user_id uuid;
    v_store_id uuid;
begin
    if v_owner_email = 'OWNER_EMAIL_HERE'
       or btrim(v_owner_email) = '' then
        raise exception 'Ganti OWNER_EMAIL_HERE terlebih dahulu.';
    end if;

    if v_owner_username = 'OWNER_USERNAME_HERE'
       or btrim(v_owner_username) = '' then
        raise exception 'Ganti OWNER_USERNAME_HERE terlebih dahulu.';
    end if;

    select u.id
      into v_auth_user_id
    from auth.users u
    where lower(u.email) = lower(btrim(v_owner_email))
    limit 1;

    if v_auth_user_id is null then
        raise exception
            'Auth user dengan email % tidak ditemukan. Buat/invite user dari Authentication > Users terlebih dahulu.',
            v_owner_email;
    end if;

    select s.id
      into v_store_id
    from public.stores s
    where s.code = 'LDM-DEFAULT'
      and s.deleted_at is null
    limit 1;

    if v_store_id is null then
        raise exception 'Store LDM-DEFAULT tidak ditemukan. Jalankan Tahap 4 terlebih dahulu.';
    end if;

    -- Hindari dua profile aktif dengan username yang sama.
    if exists (
        select 1
        from public.profiles p
        where p.store_id = v_store_id
          and lower(p.username) = lower(btrim(v_owner_username))
          and p.id <> v_auth_user_id
          and p.deleted_at is null
    ) then
        raise exception
            'Username % sudah dipakai profile lain.',
            v_owner_username;
    end if;

    insert into public.profiles (
        id,
        store_id,
        username,
        display_name,
        role,
        active,
        deleted_at,
        deleted_by
    )
    values (
        v_auth_user_id,
        v_store_id,
        btrim(v_owner_username),
        btrim(v_owner_username),
        'owner',
        true,
        null,
        null
    )
    on conflict (id)
    do update set
        store_id = excluded.store_id,
        username = excluded.username,
        display_name = excluded.display_name,
        role = 'owner',
        active = true,
        deleted_at = null,
        deleted_by = null;
end
$$;

commit;

-- HASIL
select
    p.id,
    p.username,
    p.role,
    p.active,
    s.code as store_code,
    s.name as store_name,
    p.created_at,
    p.updated_at
from public.profiles p
join public.stores s
  on s.id = p.store_id
where p.role = 'owner'
  and p.deleted_at is null
order by p.created_at;

-- ================================================================
-- LocDailyMar - Tahap 6
-- LINK BANYAK AUTH USER -> PROFILE
--
-- Semua email HARUS sudah tersedia di:
-- Supabase -> Authentication -> Users
--
-- PASSWORD TIDAK DITULIS DI SQL INI.
-- ================================================================

begin;

do $$
declare

    -- Data satu akun yang sedang diproses
    v_account record;

    -- UUID Auth User
    v_user_id uuid;

    -- UUID toko LocDailyMar
    v_store_id uuid;

begin

    -- ============================================================
    -- 1. AMBIL STORE LocDailyMar
    -- ============================================================

    select s.id
      into v_store_id
    from public.stores s
    where s.code = 'LDM-DEFAULT'
      and s.deleted_at is null
    limit 1;


    if v_store_id is null then

        raise exception
            'Store LDM-DEFAULT tidak ditemukan.';

    end if;


    -- ============================================================
    -- 2. DAFTAR AKUN
    --
    -- FORMAT:
    -- email, username, role
    -- ============================================================

    for v_account in

        select *
        from (
            values

                (
                    'rudigamer126@gmail.com',
                    'locdaily',
                    'owner'
                )

        ) as daftar(
            email,
            username,
            role
        )

    loop


        -- ========================================================
        -- 3. VALIDASI ROLE
        -- ========================================================

        if lower(v_account.role)
           not in (
               'owner',
               'admin',
               'kasir'
           )
        then

            raise exception
                'Role akun % tidak valid: %',
                v_account.username,
                v_account.role;

        end if;


        -- ========================================================
        -- 4. CARI USER DI SUPABASE AUTH
        -- ========================================================

        select u.id
          into v_user_id
        from auth.users u
        where lower(u.email) =
              lower(
                  btrim(
                      v_account.email
                  )
              )
        limit 1;


        if v_user_id is null then

            raise exception
                'Auth user dengan email % tidak ditemukan.',
                v_account.email;

        end if;


        -- ========================================================
        -- 5. CEK USERNAME SUDAH DIPAKAI ATAU BELUM
        -- ========================================================

        if exists (

            select 1
            from public.profiles p

            where p.store_id =
                  v_store_id

              and lower(p.username) =
                  lower(
                      btrim(
                          v_account.username
                      )
                  )

              and p.id <>
                  v_user_id

              and p.deleted_at is null

        ) then

            raise exception
                'Username % sudah dipakai profile lain.',
                v_account.username;

        end if;


        -- ========================================================
        -- 6. INSERT / UPDATE PROFILE
        -- ========================================================

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

            v_user_id,
            v_store_id,

            btrim(
                v_account.username
            ),

            btrim(
                v_account.username
            ),

            lower(
                v_account.role
            ),

            true,
            null,
            null

        )

        on conflict (id)

        do update set

            store_id =
                excluded.store_id,

            username =
                excluded.username,

            display_name =
                excluded.display_name,

            role =
                excluded.role,

            active =
                true,

            deleted_at =
                null,

            deleted_by =
                null;


        raise notice
            'Akun % berhasil diproses sebagai %.',
            v_account.username,
            v_account.role;


    end loop;

end
$$;

commit;


-- ================================================================
-- 7. TAMPILKAN HASIL
-- ================================================================

select

    u.email,
    p.id,
    p.username,
    p.role,
    p.active,
    s.code as store_code,
    s.name as store_name

from public.profiles p

join auth.users u
  on u.id = p.id

join public.stores s
  on s.id = p.store_id

where s.code = 'LDM-DEFAULT'
  and p.deleted_at is null

order by

    case p.role

        when 'owner'
            then 1

        when 'admin'
            then 2

        when 'kasir'
            then 3

        else 4

    end,

    p.username;

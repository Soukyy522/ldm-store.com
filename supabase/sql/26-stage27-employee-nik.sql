-- =====================================================================
-- LocDailyMar - TAHAP 27
-- NIK KARYAWAN OTOMATIS: YYMMDDSSNNN
--
-- Contoh 26090157001:
-- 26  = tahun akun dibuat (2026)
-- 09  = bulan akun dibuat
-- 01  = tanggal akun dibuat
-- 57  = detik akun dibuat
-- 001 = urutan karyawan pada Store ID tersebut
-- =====================================================================

begin;

do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'Tabel public.profiles belum tersedia.';
    end if;
    if to_regclass('public.stores') is null then
        raise exception 'Tabel public.stores belum tersedia.';
    end if;
end
$$;

alter table public.profiles
    add column if not exists employee_id text,
    add column if not exists employee_origin_store_id uuid
        references public.stores(id)
        on delete restrict;

update public.profiles
set employee_origin_store_id = store_id
where employee_origin_store_id is null;

-- Counter ini memastikan nomor urut tidak dipakai ulang walaupun akun lama
-- dihapus permanen. Batas format NNN adalah 001 sampai 999 per Store ID.
create table if not exists public.ldm_employee_counters (
    store_id uuid primary key
        references public.stores(id)
        on delete cascade,
    last_number integer not null default 0
        check (last_number between 0 and 999),
    updated_at timestamptz not null default now()
);

revoke all on table public.ldm_employee_counters from public, anon, authenticated;

do $$
declare
    v_over_limit record;
begin
    select p.store_id, count(*)::integer as total
      into v_over_limit
    from public.profiles p
    group by p.store_id
    having count(*) > 999
    limit 1;

    if v_over_limit.store_id is not null then
        raise exception 'Store ID % memiliki % akun. Format NNN hanya mendukung maksimal 999 akun.',
            v_over_limit.store_id, v_over_limit.total;
    end if;
end
$$;

-- Migrasi akun lama. Urutan ditentukan dari waktu profile dibuat, lalu UUID
-- sebagai pengunci urutan apabila beberapa akun tercatat pada waktu yang sama.
with ranked as (
    select
        p.id,
        p.store_id,
        p.created_at,
        row_number() over (
            partition by p.store_id
            order by p.created_at, p.id
        )::integer as employee_number,
        case
            when exists (
                select 1
                from pg_timezone_names tz
                where tz.name = nullif(btrim(s.timezone), '')
            ) then s.timezone
            else 'UTC'
        end as store_timezone
    from public.profiles p
    join public.stores s on s.id = p.store_id
)
update public.profiles p
set
    employee_id =
        to_char(
            timezone(r.store_timezone, coalesce(r.created_at, now())),
            'YYMMDDSS'
        ) || lpad(r.employee_number::text, 3, '0'),
    updated_at = now()
from ranked r
where p.id = r.id;

insert into public.ldm_employee_counters(store_id, last_number, updated_at)
select p.store_id, count(*)::integer, now()
from public.profiles p
group by p.store_id
on conflict(store_id) do update
set
    last_number = greatest(
        public.ldm_employee_counters.last_number,
        excluded.last_number
    ),
    updated_at = now();

create unique index if not exists uq_profiles_origin_store_employee_nik
    on public.profiles(employee_origin_store_id, employee_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_employee_nik_format'
    ) then
        alter table public.profiles
            add constraint profiles_employee_nik_format
            check (employee_id ~ '^[0-9]{11}$');
    end if;
end
$$;

alter table public.profiles
    alter column employee_id set not null,
    alter column employee_origin_store_id set not null;

create or replace function public.ldm_generate_employee_nik(
    p_store_id uuid,
    p_created_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_timezone text;
    v_number integer;
    v_local_timestamp timestamp;
begin
    if p_store_id is null then
        raise exception 'Store ID wajib tersedia untuk membuat NIK Karyawan.';
    end if;

    select case
        when exists (
            select 1
            from pg_timezone_names tz
            where tz.name = nullif(btrim(s.timezone), '')
        ) then s.timezone
        else 'UTC'
    end
      into v_timezone
    from public.stores s
    where s.id = p_store_id
      and s.deleted_at is null;

    if v_timezone is null then
        raise exception 'Store ID % tidak ditemukan atau sudah dihapus.', p_store_id;
    end if;

    -- Mengunci proses per Store ID agar dua akun yang dibuat bersamaan tetap
    -- memperoleh tiga digit urutan yang berbeda.
    perform pg_advisory_xact_lock(hashtext(p_store_id::text));

    insert into public.ldm_employee_counters(store_id, last_number, updated_at)
    values (p_store_id, 1, now())
    on conflict(store_id) do update
    set
        last_number = public.ldm_employee_counters.last_number + 1,
        updated_at = now()
    returning last_number into v_number;

    if v_number > 999 then
        raise exception 'Batas 999 NIK Karyawan pada Store ID % telah tercapai.', p_store_id;
    end if;

    v_local_timestamp := timezone(v_timezone, coalesce(p_created_at, now()));

    return to_char(v_local_timestamp, 'YYMMDDSS')
        || lpad(v_number::text, 3, '0');
end;
$$;

revoke all on function public.ldm_generate_employee_nik(uuid,timestamptz)
from public, anon, authenticated;

create or replace function public.ldm_profiles_assign_employee_nik()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_existing_employee_id text;
    v_existing_origin_store_id uuid;
begin
    new.created_at := coalesce(new.created_at, now());

    -- UPSERT profile lama tidak boleh menghabiskan nomor urut baru.
    select p.employee_id, p.employee_origin_store_id
      into v_existing_employee_id, v_existing_origin_store_id
    from public.profiles p
    where p.id = new.id
    limit 1;

    if v_existing_employee_id is not null then
        new.employee_id := v_existing_employee_id;
        new.employee_origin_store_id := v_existing_origin_store_id;
        return new;
    end if;

    new.employee_origin_store_id := new.store_id;
    new.employee_id := public.ldm_generate_employee_nik(
        new.store_id,
        new.created_at
    );

    return new;
end;
$$;

drop trigger if exists trg_profiles_assign_employee_nik
on public.profiles;

create trigger trg_profiles_assign_employee_nik
before insert on public.profiles
for each row
execute function public.ldm_profiles_assign_employee_nik();

-- Tambahkan NIK pada daftar akun yang dinonaktifkan.
drop function if exists public.ldm_account_archived_list();

create function public.ldm_account_archived_list()
returns table (
    user_id uuid,
    email text,
    username text,
    display_name text,
    employee_id text,
    role text,
    active boolean,
    deleted_at timestamptz,
    deleted_by uuid,
    auth_created_at timestamptz,
    last_sign_in_at timestamptz,
    banned_until timestamptz,
    is_banned boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
stable
as $$
declare
    v_store_id uuid;
begin
    v_store_id := public.ldm_current_store_id();

    if v_store_id is null or public.ldm_current_role() <> 'owner' then
        raise exception 'Hanya Owner yang dapat melihat akun dinonaktifkan.';
    end if;

    return query
    select
        p.id,
        u.email::text,
        p.username,
        p.display_name,
        p.employee_id,
        p.role,
        p.active,
        p.deleted_at,
        p.deleted_by,
        u.created_at,
        u.last_sign_in_at,
        u.banned_until,
        coalesce(u.banned_until > now(), false)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.store_id = v_store_id
      and p.deleted_at is not null
    order by p.deleted_at desc, lower(p.username), p.id;
end;
$$;

revoke all on function public.ldm_account_archived_list()
from public, anon;
grant execute on function public.ldm_account_archived_list()
to authenticated;

-- NIK ikut tersedia pada fitur pemindahan karyawan antarcabang.
create or replace function public.ldm_network_employees()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with network as (
        select public.ldm_primary_owner_network_id() id
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'user_id', p.id,
                'username', p.username,
                'display_name', coalesce(nullif(p.display_name,''),p.username),
                'employee_id', p.employee_id,
                'role', p.role,
                'store_id', p.store_id,
                'store_code', s.code,
                'store_name', s.name
            )
            order by lower(s.name), lower(p.username)
        ),
        '[]'::jsonb
    )
    from network n
    join public.store_network_stores sns
      on sns.network_id = n.id
     and sns.active = true
    join public.stores s on s.id = sns.store_id
    join public.profiles p
      on p.store_id = s.id
     and p.active = true
     and p.deleted_at is null
    where p.role in ('admin','kasir');
$$;

revoke all on function public.ldm_network_employees()
from public, anon;
grant execute on function public.ldm_network_employees()
to authenticated;

create or replace function public.ldm_primary_owner_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with network as (
        select public.ldm_primary_owner_network_id() id
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'user_id', p.id,
                'employee_id', p.employee_id,
                'store_id', p.store_id,
                'store_code', s.code,
                'store_name', s.name,
                'username', p.username,
                'display_name', p.display_name,
                'role', p.role,
                'active', p.active,
                'email', u.email,
                'last_sign_in_at', u.last_sign_in_at,
                'updated_at', p.updated_at,
                'is_primary_owner', n.primary_owner_user_id = p.id
            )
            order by sns.is_primary desc, lower(s.name), lower(p.username)
        ),
        '[]'::jsonb
    )
    from network x
    join public.store_networks n on n.id = x.id
    join public.store_network_stores sns
      on sns.network_id = x.id
     and sns.active = true
    join public.stores s on s.id = sns.store_id
    join public.profiles p
      on p.store_id = s.id
     and p.deleted_at is null
    left join auth.users u on u.id = p.id;
$$;

revoke all on function public.ldm_primary_owner_accounts()
from public, anon;
grant execute on function public.ldm_primary_owner_accounts()
to authenticated;

insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','27'),
    ('schema_version','27.0'),
    ('schema_status','employee_nik_ready'),
    ('employee_nik_format','YYMMDDSSNNN')
on conflict(key) do update
set value=excluded.value, updated_at=now();

commit;

-- HASIL PEMERIKSAAN
select
    p.employee_id as nik_karyawan,
    p.username,
    p.role,
    s.code as store_code,
    p.created_at
from public.profiles p
join public.stores s on s.id = p.store_id
order by s.code, p.created_at, p.id;

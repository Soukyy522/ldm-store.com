-- =============================================================================
-- LocDailyMar 26.1 - MAKSIMAL DUA OWNER PUSAT
--
-- Owner Pusat 1 : primary_owner_user_id, tetap dibuat otomatis oleh Tahap 25.
-- Owner Pusat 2 : secondary_primary_owner_user_id, hanya diatur developer.
-- Jika slot kedua kosong/nonaktif, sistem efektif hanya mempunyai satu Owner Pusat.
-- Jalankan pada Supabase project APLIKASI, bukan server lisensi.
-- Prasyarat: Tahap 25 dan Tahap 26 telah terpasang.
-- =============================================================================

begin;

do $$
begin
    if to_regclass('public.store_networks') is null
       or to_regclass('public.store_network_stores') is null
       or to_regclass('public.store_memberships') is null
       or to_regclass('public.profiles') is null then
        raise exception 'Tahap Multi Toko/Owner Pusat belum lengkap.';
    end if;
    if to_regprocedure('public.ldm_is_primary_owner()') is null then
        raise exception 'SQL Tahap 25 belum terpasang.';
    end if;
end;
$$;

alter table public.store_networks
add column if not exists secondary_primary_owner_user_id uuid
references auth.users(id) on delete restrict;

alter table public.store_networks
add column if not exists secondary_primary_owner_enabled boolean
not null default false;

-- Rapikan juga bila sebelumnya pernah ada percobaan migrasi yang membuat
-- kolom ini nullable/tanpa default.
alter table public.store_networks
alter column secondary_primary_owner_enabled set default false;

update public.store_networks
set secondary_primary_owner_enabled=false
where secondary_primary_owner_enabled is null;

alter table public.store_networks
alter column secondary_primary_owner_enabled set not null;

-- Data lama selalu dimulai dengan slot kedua nonaktif.
update public.store_networks
set secondary_primary_owner_enabled=false
where secondary_primary_owner_user_id is null
  and secondary_primary_owner_enabled=true;

do $$
begin
    if not exists(
        select 1 from pg_constraint
        where conname='store_networks_secondary_owner_not_same'
          and conrelid='public.store_networks'::regclass
    ) then
        alter table public.store_networks
        add constraint store_networks_secondary_owner_not_same
        check (
            secondary_primary_owner_user_id is null
            or secondary_primary_owner_user_id is distinct from primary_owner_user_id
        );
    end if;

    if not exists(
        select 1 from pg_constraint
        where conname='store_networks_secondary_owner_enabled_has_user'
          and conrelid='public.store_networks'::regclass
    ) then
        alter table public.store_networks
        add constraint store_networks_secondary_owner_enabled_has_user
        check (
            secondary_primary_owner_enabled=false
            or secondary_primary_owner_user_id is not null
        );
    end if;
end;
$$;

create index if not exists store_networks_secondary_primary_owner_idx
on public.store_networks(secondary_primary_owner_user_id)
where secondary_primary_owner_user_id is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Validasi perubahan slot kedua. Browser tidak boleh mengubah slot ini.
-- SQL Editor/service-role tetap dapat mengaturnya karena auth.uid() bernilai null.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_validate_secondary_primary_owner()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
    v_changed boolean := false;
    v_primary_store_id uuid;
begin
    if tg_op='INSERT' then
        v_changed := new.secondary_primary_owner_user_id is not null
                     or new.secondary_primary_owner_enabled=true;
    else
        v_changed := old.secondary_primary_owner_user_id
                        is distinct from new.secondary_primary_owner_user_id
                     or old.secondary_primary_owner_enabled
                        is distinct from new.secondary_primary_owner_enabled;
    end if;

    if not v_changed then return new; end if;

    if auth.uid() is not null then
        raise exception 'DEVELOPER_ONLY: Owner Pusat kedua hanya dapat diatur developer.';
    end if;

    if new.secondary_primary_owner_enabled
       and new.secondary_primary_owner_user_id is null then
        raise exception 'UUID Owner Pusat kedua wajib diisi sebelum diaktifkan.';
    end if;

    if new.secondary_primary_owner_user_id is null then
        new.secondary_primary_owner_enabled := false;
        return new;
    end if;

    if new.secondary_primary_owner_user_id=new.primary_owner_user_id then
        raise exception 'Owner Pusat pertama dan kedua tidak boleh akun yang sama.';
    end if;

    select sns.store_id into v_primary_store_id
    from public.store_network_stores sns
    where sns.network_id=new.id
      and sns.is_primary=true
      and sns.active=true
    limit 1;

    if v_primary_store_id is null then
        raise exception 'Cabang pusat jaringan tidak ditemukan.';
    end if;

    -- Syarat profil/membership hanya wajib saat hak pusat DIAKTIFKAN.
    -- Dengan demikian developer tetap dapat menonaktifkan slot walaupun
    -- akun terkait telanjur tidak aktif.
    if new.secondary_primary_owner_enabled and not exists(
        select 1
        from public.profiles p
        join public.store_memberships sm
          on sm.user_id=p.id
         and sm.store_id=v_primary_store_id
         and sm.role='owner'
         and sm.active=true
        where p.id=new.secondary_primary_owner_user_id
          and p.store_id=v_primary_store_id
          and p.role='owner'
          and p.active=true
          and p.deleted_at is null
    ) then
        raise exception 'Akun kedua harus Owner aktif dengan membership aktif di cabang pusat.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_stage261_validate_secondary_primary_owner
on public.store_networks;
create trigger trg_stage261_validate_secondary_primary_owner
before insert or update on public.store_networks
for each row execute function public.ldm_validate_secondary_primary_owner();

-- -----------------------------------------------------------------------------
-- Pemeriksaan pusat sekarang menerima slot 1 ATAU slot 2 yang aktif.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_is_primary_owner()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
    select exists(
        select 1
        from public.store_networks n
        join public.store_network_stores sns
          on sns.network_id=n.id and sns.is_primary=true and sns.active=true
        join public.store_memberships sm
          on sm.store_id=sns.store_id and sm.user_id=auth.uid()
         and sm.active=true and sm.role='owner'
        join public.profiles p
          on p.id=auth.uid() and p.active=true and p.deleted_at is null
        where (
                n.primary_owner_user_id=auth.uid()
                or (
                    n.secondary_primary_owner_enabled=true
                    and n.secondary_primary_owner_user_id=auth.uid()
                )
              )
          and n.active=true
          and n.deleted_at is null
    );
$$;

create or replace function public.ldm_primary_owner_network_id()
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_network uuid;
begin
    select n.id into v_network
    from public.store_networks n
    join public.store_network_stores sns
      on sns.network_id=n.id and sns.is_primary=true and sns.active=true
    join public.store_memberships sm
      on sm.store_id=sns.store_id and sm.user_id=auth.uid()
     and sm.active=true and sm.role='owner'
    join public.profiles p
      on p.id=auth.uid() and p.active=true and p.deleted_at is null
    where (
            n.primary_owner_user_id=auth.uid()
            or (
                n.secondary_primary_owner_enabled=true
                and n.secondary_primary_owner_user_id=auth.uid()
            )
          )
      and n.active=true
      and n.deleted_at is null
    limit 1;

    if v_network is null then raise exception 'PRIMARY_OWNER_REQUIRED'; end if;
    return v_network;
end;
$$;

-- Signature dan return type dipertahankan agar frontend lama tetap kompatibel.
create or replace function public.ldm_primary_owner_context()
returns table(
    is_primary_owner boolean,
    network_id uuid,
    network_code text,
    network_name text,
    primary_store_id uuid,
    primary_store_code text,
    primary_store_name text,
    active_store_id uuid
)
language sql
stable
security definer
set search_path=''
as $$
    select
        true,
        n.id,n.code,n.name,s.id,s.code,s.name,public.ldm_current_store_id()
    from public.store_networks n
    join public.store_network_stores sns
      on sns.network_id=n.id and sns.is_primary=true and sns.active=true
    join public.stores s
      on s.id=sns.store_id and s.status='active' and s.deleted_at is null
    join public.store_memberships sm
      on sm.store_id=s.id and sm.user_id=auth.uid()
     and sm.active=true and sm.role='owner'
    join public.profiles p
      on p.id=auth.uid() and p.active=true and p.deleted_at is null
    where (
            n.primary_owner_user_id=auth.uid()
            or (
                n.secondary_primary_owner_enabled=true
                and n.secondary_primary_owner_user_id=auth.uid()
            )
          )
      and n.active=true
      and n.deleted_at is null
    limit 1;
$$;

-- Daftar akun menandai kedua Owner Pusat agar keduanya tidak dapat diedit
-- dari panel Kontrol Pusat.
create or replace function public.ldm_primary_owner_accounts()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
    with network as (select public.ldm_primary_owner_network_id() id)
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id',p.id,'store_id',p.store_id,'store_code',s.code,'store_name',s.name,
        'username',p.username,'display_name',p.display_name,'role',p.role,'active',p.active,
        'email',u.email,'last_sign_in_at',u.last_sign_in_at,'updated_at',p.updated_at,
        'is_primary_owner',(
            n.primary_owner_user_id=p.id
            or (
                n.secondary_primary_owner_enabled=true
                and n.secondary_primary_owner_user_id=p.id
            )
        ),
        'primary_owner_slot',case
            when n.primary_owner_user_id=p.id then 1
            when n.secondary_primary_owner_enabled=true
             and n.secondary_primary_owner_user_id=p.id then 2
            else null
        end
    ) order by sns.is_primary desc,lower(s.name),lower(p.username)),'[]'::jsonb)
    from network x
    join public.store_networks n on n.id=x.id
    join public.store_network_stores sns on sns.network_id=x.id and sns.active=true
    join public.stores s on s.id=sns.store_id
    join public.profiles p on p.store_id=s.id and p.deleted_at is null
    left join auth.users u on u.id=p.id;
$$;

-- Owner Pusat kedua juga boleh mengelola katalog hanya saat toko aktif=pusat.
create or replace function public.ldm_can_manage_central_catalog()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
    select public.ldm_is_primary_owner()
       and exists(
            select 1
            from public.store_networks n
            join public.store_network_stores sns
              on sns.network_id=n.id
             and sns.is_primary=true
             and sns.active=true
            where (
                    n.primary_owner_user_id=auth.uid()
                    or (
                        n.secondary_primary_owner_enabled=true
                        and n.secondary_primary_owner_user_id=auth.uid()
                    )
                  )
              and n.active=true
              and n.deleted_at is null
              and sns.store_id=public.ldm_current_store_id()
       );
$$;

-- -----------------------------------------------------------------------------
-- Lindungi profil kedua Owner Pusat dari perubahan melalui aplikasi/RPC akun.
-- Developer SQL/service-role tetap dapat memperbaikinya bila diperlukan.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_protect_primary_owner_profiles()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
    if auth.uid() is not null and exists(
        select 1 from public.store_networks n
        where n.active=true and n.deleted_at is null
          and (
                n.primary_owner_user_id=old.id
                or (
                    n.secondary_primary_owner_enabled=true
                    and n.secondary_primary_owner_user_id=old.id
                )
              )
    ) then
        raise exception 'Akun Owner Pusat hanya dapat diubah developer.';
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists trg_stage261_protect_primary_owner_profiles
on public.profiles;
create trigger trg_stage261_protect_primary_owner_profiles
before update or delete on public.profiles
for each row execute function public.ldm_protect_primary_owner_profiles();

-- -----------------------------------------------------------------------------
-- Satu-satunya fungsi administrasi slot kedua.
-- Tidak diberikan kepada authenticated/anon; dipakai SQL Editor/developer.
-- p_user_id NULL + p_enabled false = hapus penetapan slot kedua.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_developer_set_secondary_primary_owner(
    p_network_id uuid,
    p_user_id uuid,
    p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network public.store_networks%rowtype;
    v_primary_store_id uuid;
    v_email text;
begin
    if auth.uid() is not null then
        raise exception 'DEVELOPER_ONLY';
    end if;

    select * into v_network
    from public.store_networks
    where id=p_network_id and active=true and deleted_at is null
    for update;
    if v_network.id is null then raise exception 'Network tidak ditemukan.'; end if;

    if coalesce(p_enabled,false) and p_user_id is null then
        raise exception 'UUID Owner Pusat kedua wajib diisi.';
    end if;

    if p_user_id is not null then
        if p_user_id=v_network.primary_owner_user_id then
            raise exception 'Akun tersebut sudah menjadi Owner Pusat pertama.';
        end if;

        select sns.store_id into v_primary_store_id
        from public.store_network_stores sns
        where sns.network_id=p_network_id
          and sns.is_primary=true and sns.active=true
        limit 1;

        -- Akun harus valid ketika diaktifkan. Mode false sengaja tetap boleh
        -- dipakai untuk mencabut hak pusat dari akun yang sudah tidak aktif.
        if coalesce(p_enabled,false) and not exists(
            select 1
            from public.profiles p
            join public.store_memberships sm
              on sm.user_id=p.id and sm.store_id=v_primary_store_id
             and sm.role='owner' and sm.active=true
            where p.id=p_user_id
              and p.store_id=v_primary_store_id
              and p.role='owner'
              and p.active=true
              and p.deleted_at is null
        ) then
            raise exception 'Akun harus Owner aktif pada cabang pusat.';
        end if;
    end if;

    update public.store_networks
       set secondary_primary_owner_user_id=p_user_id,
           secondary_primary_owner_enabled=case
               when p_user_id is null then false else coalesce(p_enabled,false)
           end,
           updated_at=now()
     where id=p_network_id;

    select u.email into v_email from auth.users u where u.id=p_user_id;

    return jsonb_build_object(
        'ok',true,
        'network_id',p_network_id,
        'secondary_owner_user_id',p_user_id,
        'secondary_owner_email',v_email,
        'enabled',case when p_user_id is null then false else coalesce(p_enabled,false) end
    );
end;
$$;

revoke all on function public.ldm_validate_secondary_primary_owner()
from public,anon,authenticated;
revoke all on function public.ldm_protect_primary_owner_profiles()
from public,anon,authenticated;
revoke all on function public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)
from public,anon,authenticated;

grant execute on function public.ldm_is_primary_owner() to authenticated;
grant execute on function public.ldm_primary_owner_context() to authenticated;
grant execute on function public.ldm_primary_owner_accounts() to authenticated;
grant execute on function public.ldm_can_manage_central_catalog() to authenticated;

-- service_role dapat dipakai dari backend developer. Frontend tidak mendapat izin.
grant execute on function public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)
to service_role;

insert into public.ldm_system_meta(key,value)
values
    ('secondary_primary_owner','ready'),
    ('primary_owner_max_count','2'),
    ('schema_version','26.1')
on conflict(key) do update set value=excluded.value,updated_at=now();

notify pgrst, 'reload schema';
commit;

-- Pemeriksaan cepat instalasi (tidak menetapkan akun):
select
    to_regprocedure('public.ldm_developer_set_secondary_primary_owner(uuid,uuid,boolean)') is not null
        as developer_function_ok,
    to_regprocedure('public.ldm_is_primary_owner()') is not null
        as primary_owner_check_ok;

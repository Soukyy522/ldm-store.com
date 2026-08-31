-- ================================================================
-- LocDailyMar 26.3.0
-- Manajemen Cabang Aman + Hardening Reaktivasi Akun
-- Jalankan pada PROJECT CLOUD DATA TOKO.
-- Prasyarat: Tahap 25/26.2.x sudah terpasang.
-- ================================================================

begin;

-- ------------------------------------------------
-- Validasi fondasi
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.stores') is null
       or to_regclass('public.store_networks') is null
       or to_regclass('public.store_network_stores') is null then
        raise exception 'Fondasi Multi-Toko belum tersedia.';
    end if;
    if to_regprocedure('public.ldm_is_primary_owner()') is null
       or to_regprocedure('public.ldm_primary_owner_network_id()') is null then
        raise exception 'Fondasi Owner Utama belum tersedia. Jalankan SQL Primary Owner terlebih dahulu.';
    end if;
end
$$;

-- ------------------------------------------------
-- Audit perubahan cabang
-- ------------------------------------------------
create table if not exists public.store_branch_management_audit (
    id uuid primary key default gen_random_uuid(),
    network_id uuid not null references public.store_networks(id) on delete cascade,
    store_id uuid not null references public.stores(id) on delete restrict,
    action text not null check (action in ('EDIT','DEACTIVATE','ACTIVATE','ARCHIVE')),
    old_code text,
    new_code text,
    old_name text,
    new_name text,
    old_status text,
    new_status text,
    reason text,
    actor_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists store_branch_management_audit_network_idx
on public.store_branch_management_audit(network_id,created_at desc);

alter table public.store_branch_management_audit enable row level security;
revoke all on public.store_branch_management_audit from anon;
revoke insert,update,delete on public.store_branch_management_audit from authenticated;
grant select on public.store_branch_management_audit to authenticated;

drop policy if exists branch_audit_primary_owner_select on public.store_branch_management_audit;
create policy branch_audit_primary_owner_select
on public.store_branch_management_audit
for select
to authenticated
using (public.ldm_is_primary_owner());

-- ------------------------------------------------
-- Daftar seluruh cabang yang dapat dikelola Owner Utama,
-- termasuk cabang nonaktif/arsip.
-- ------------------------------------------------
create or replace function public.ldm_manageable_network_branches()
returns table(
    store_id uuid,
    store_code text,
    store_name text,
    is_primary boolean,
    network_link_active boolean,
    store_status text,
    is_archived boolean,
    created_at timestamptz,
    updated_at timestamptz,
    employee_count bigint,
    product_count bigint,
    transaction_count bigint,
    device_count bigint,
    open_transfer_count bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
    v_network uuid;
begin
    if not public.ldm_is_primary_owner() then
        raise exception 'PRIMARY_OWNER_REQUIRED';
    end if;
    v_network := public.ldm_primary_owner_network_id();

    return query
    select
        s.id,s.code,s.name,sns.is_primary,sns.active,s.status,
        (s.deleted_at is not null),s.created_at,s.updated_at,
        (select count(*) from public.profiles p where p.store_id=s.id and p.deleted_at is null),
        (select count(*) from public.products p where p.store_id=s.id and p.deleted_at is null),
        (select count(*) from public.transactions t where t.store_id=s.id),
        (select count(*) from public.devices d where d.store_id=s.id and d.deleted_at is null),
        (select count(*) from public.stock_transfers st
          where (st.source_store_id=s.id or st.destination_store_id=s.id)
            and st.status in ('DRAFT','IN_TRANSIT'))
    from public.store_network_stores sns
    join public.stores s on s.id=sns.store_id
    where sns.network_id=v_network
    order by sns.is_primary desc,
             case when s.deleted_at is null and s.status='active' then 1
                  when s.deleted_at is null then 2 else 3 end,
             lower(s.name);
end;
$$;

-- ------------------------------------------------
-- Manajemen cabang.
-- EDIT        : ubah kode/nama; Store ID tetap sama.
-- DEACTIVATE  : cabang berhenti operasional, histori utuh.
-- ACTIVATE    : aktifkan kembali cabang nonaktif.
-- ARCHIVE     : soft-delete dari operasional; histori tetap utuh.
-- Cabang pusat tidak dapat dinonaktifkan/diarsipkan.
-- ------------------------------------------------
create or replace function public.ldm_manage_branch(
    p_store_id uuid,
    p_action text,
    p_code text default null,
    p_name text default null,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network uuid;
    v_action text := upper(btrim(coalesce(p_action,'')));
    v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
    v_store public.stores%rowtype;
    v_is_primary boolean;
    v_link_active boolean;
    v_code text;
    v_name text;
    v_open_transfers integer;
    v_old_code text;
    v_old_name text;
    v_old_status text;
begin
    if not public.ldm_is_primary_owner() then
        raise exception 'PRIMARY_OWNER_REQUIRED';
    end if;
    if p_store_id is null then raise exception 'Store ID wajib diisi.'; end if;
    if v_action not in ('EDIT','DEACTIVATE','ACTIVATE','ARCHIVE') then
        raise exception 'Aksi cabang tidak valid.';
    end if;

    v_network := public.ldm_primary_owner_network_id();

    select s.*
      into v_store
    from public.store_network_stores sns
    join public.stores s on s.id=sns.store_id
    where sns.network_id=v_network and sns.store_id=p_store_id
    for update of s;

    select sns.is_primary,sns.active
      into v_is_primary,v_link_active
    from public.store_network_stores sns
    where sns.network_id=v_network and sns.store_id=p_store_id
    for update;

    if v_store.id is null then
        raise exception 'Cabang tidak ditemukan pada jaringan Owner Utama.';
    end if;

    v_old_code:=v_store.code;
    v_old_name:=v_store.name;
    v_old_status:=v_store.status;

    if v_action='EDIT' then
        if v_store.deleted_at is not null then
            raise exception 'Cabang yang sudah diarsipkan tidak dapat diedit.';
        end if;
        v_code:=regexp_replace(upper(btrim(coalesce(p_code,''))),'[^A-Z0-9_-]','','g');
        v_name:=btrim(coalesce(p_name,''));
        if length(v_code)<3 or length(v_code)>30 then raise exception 'Kode cabang harus 3-30 karakter.'; end if;
        if length(v_name)<3 or length(v_name)>120 then raise exception 'Nama cabang harus 3-120 karakter.'; end if;
        if exists(select 1 from public.stores s where lower(s.code)=lower(v_code) and s.id<>p_store_id) then
            raise exception 'Kode cabang % sudah digunakan toko lain.',v_code;
        end if;
        update public.stores
           set code=v_code,name=v_name
         where id=p_store_id;

    elsif v_action='DEACTIVATE' then
        if v_is_primary then raise exception 'Cabang pusat tidak dapat dinonaktifkan.'; end if;
        if v_store.deleted_at is not null then raise exception 'Cabang sudah diarsipkan.'; end if;
        if v_store.status='inactive' and v_link_active=false then
            return jsonb_build_object('ok',true,'mode','already_inactive','store_id',p_store_id);
        end if;

        select count(*) into v_open_transfers
        from public.stock_transfers st
        where (st.source_store_id=p_store_id or st.destination_store_id=p_store_id)
          and st.status in ('DRAFT','IN_TRANSIT');
        if v_open_transfers>0 then
            raise exception 'Cabang masih memiliki % transfer stok Draft/Dalam Pengiriman. Selesaikan atau batalkan terlebih dahulu.',v_open_transfers;
        end if;

        update public.stores set status='inactive' where id=p_store_id;
        update public.store_network_stores set active=false where network_id=v_network and store_id=p_store_id;
        delete from public.active_store_sessions where store_id=p_store_id;
        update public.devices set status='revoked',group_id=null
         where store_id=p_store_id and deleted_at is null and status<>'revoked';

    elsif v_action='ACTIVATE' then
        if v_store.deleted_at is not null then
            raise exception 'Cabang sudah diarsipkan. Pemulihan arsip harus dilakukan developer melalui SQL agar tidak terjadi aktivasi tidak sengaja.';
        end if;
        update public.stores set status='active' where id=p_store_id;
        update public.store_network_stores set active=true where network_id=v_network and store_id=p_store_id;

    elsif v_action='ARCHIVE' then
        if v_is_primary then raise exception 'Cabang pusat tidak dapat dihapus/diarsipkan.'; end if;
        if v_store.deleted_at is not null then
            return jsonb_build_object('ok',true,'mode','already_archived','store_id',p_store_id);
        end if;

        select count(*) into v_open_transfers
        from public.stock_transfers st
        where (st.source_store_id=p_store_id or st.destination_store_id=p_store_id)
          and st.status in ('DRAFT','IN_TRANSIT');
        if v_open_transfers>0 then
            raise exception 'Cabang masih memiliki % transfer stok Draft/Dalam Pengiriman. Selesaikan atau batalkan terlebih dahulu.',v_open_transfers;
        end if;

        update public.stores
           set status='inactive',deleted_at=now(),deleted_by=auth.uid()
         where id=p_store_id;
        update public.store_network_stores set active=false where network_id=v_network and store_id=p_store_id;
        delete from public.active_store_sessions where store_id=p_store_id;
        update public.devices set status='revoked',group_id=null
         where store_id=p_store_id and deleted_at is null and status<>'revoked';
    end if;

    insert into public.store_branch_management_audit(
        network_id,store_id,action,old_code,new_code,old_name,new_name,
        old_status,new_status,reason,actor_user_id
    )
    select
        v_network,s.id,v_action,v_old_code,s.code,v_old_name,s.name,
        v_old_status,s.status,v_reason,auth.uid()
    from public.stores s where s.id=p_store_id;

    return (
        select jsonb_build_object(
            'ok',true,
            'action',v_action,
            'store_id',s.id,
            'store_code',s.code,
            'store_name',s.name,
            'status',s.status,
            'archived',s.deleted_at is not null,
            'message',case v_action
                when 'EDIT' then 'Data cabang berhasil diperbarui.'
                when 'DEACTIVATE' then 'Cabang berhasil dinonaktifkan. Histori tetap disimpan.'
                when 'ACTIVATE' then 'Cabang berhasil diaktifkan kembali. Perangkat perlu disetujui ulang.'
                when 'ARCHIVE' then 'Cabang berhasil diarsipkan dari operasional. Histori tetap disimpan.'
            end
        ) from public.stores s where s.id=p_store_id
    );
end;
$$;

-- Pembuatan cabang tetap memakai public.ldm_create_branch_store() dari Tahap Multi-Toko.
-- UI 26.3 hanya menampilkan form Tambah Cabang kepada Owner Pusat.

-- ------------------------------------------------
-- Reaktivasi profile biasa (active=false, bukan arsip) tetap melalui RPC.
-- Akun arsip yang Auth user-nya diblokir tetap dipulihkan oleh Edge Function.
-- ------------------------------------------------
create or replace function public.ldm_account_set_active(
    p_user_id uuid,
    p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_target public.profiles%rowtype;
    v_other_owner integer;
begin
    if public.ldm_current_role()<>'owner' then raise exception 'Hanya Owner yang dapat mengubah status akun.'; end if;
    select * into v_target from public.profiles
     where id=p_user_id and store_id=v_store and deleted_at is null for update;
    if v_target.id is null then raise exception 'Profile aktif/nonaktif tidak ditemukan pada store ini.'; end if;
    if p_user_id=auth.uid() and coalesce(p_active,false)=false then raise exception 'Owner yang sedang login tidak dapat menonaktifkan dirinya sendiri.'; end if;
    if v_target.role='owner' and v_target.active=true and coalesce(p_active,false)=false then
        select count(*) into v_other_owner from public.profiles
         where store_id=v_store and role='owner' and active=true and deleted_at is null and id<>p_user_id;
        if v_other_owner<1 then raise exception 'Owner aktif terakhir tidak dapat dinonaktifkan.'; end if;
    end if;
    update public.profiles set active=coalesce(p_active,false) where id=p_user_id and store_id=v_store;
    if coalesce(p_active,false)=false then
        update public.devices set status='revoked',group_id=null
         where store_id=v_store and user_id=p_user_id and deleted_at is null;
    end if;
    return jsonb_build_object('ok',true,'user_id',p_user_id,'active',coalesce(p_active,false));
end;
$$;

revoke all on function public.ldm_manageable_network_branches() from public,anon;
revoke all on function public.ldm_manage_branch(uuid,text,text,text,text) from public,anon;
revoke all on function public.ldm_account_set_active(uuid,boolean) from public,anon;
grant execute on function public.ldm_manageable_network_branches() to authenticated;
grant execute on function public.ldm_manage_branch(uuid,text,text,text,text) to authenticated;
grant execute on function public.ldm_account_set_active(uuid,boolean) to authenticated;

insert into public.ldm_system_meta(key,value)
values
('app_schema_patch','26.3.0'),
('branch_management','primary_owner_edit_deactivate_activate_archive'),
('account_reactivation_transport','edge_function_explicit_http_with_rpc_for_plain_inactive')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

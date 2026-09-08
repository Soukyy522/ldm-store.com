-- =============================================================================
-- LocDailyMar 27.5.0
-- Developer License Center: Arsipkan / Pulihkan / Hapus Permanen lisensi tidak terpakai
-- Jalankan pada Supabase PROJECT LICENSE AUTHORITY V2.
-- =============================================================================

begin;

alter table public.ldm2_licenses
    add column if not exists archived_at timestamptz,
    add column if not exists archived_reason text,
    add column if not exists archived_by_email text;

create index if not exists idx_ldm2_licenses_archived_at
    on public.ldm2_licenses(archived_at, created_at desc);

-- View admin diperluas dengan status arsip. Kolom baru ditambahkan di bagian akhir
-- agar consumer lama tetap kompatibel.
create or replace view public.ldm2_admin_license_overview as
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
    pay.redirect_url as latest_payment_url,pay.created_at as latest_payment_created_at,
    l.archived_at,l.archived_reason,l.archived_by_email
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

revoke all on public.ldm2_admin_license_overview from public,anon,authenticated;
grant select on public.ldm2_admin_license_overview to service_role;

create or replace function public.ldm2_archive_license(
    p_license_id uuid,
    p_admin_email text,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
    v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found then
        raise exception 'Lisensi tidak ditemukan.';
    end if;

    if v_license.archived_at is not null then
        return jsonb_build_object('ok',true,'already_archived',true,'license_id',v_license.id);
    end if;

    if v_license.status='active' then
        raise exception 'Lisensi masih aktif. Tangguhkan atau batalkan lisensi terlebih dahulu sebelum diarsipkan.';
    end if;

    if v_license.status='pending_payment' then
        raise exception 'Lisensi masih berstatus pending_payment. Batalkan order/lisensi terlebih dahulu agar checkout publik tidak dapat dilanjutkan, lalu arsipkan.';
    end if;

    if exists(
        select 1 from public.ldm2_payments
        where license_id=v_license.id
          and status in ('pending','challenge')
    ) then
        raise exception 'Masih ada pembayaran pending/challenge. Batalkan atau selesaikan order pembayaran terlebih dahulu.';
    end if;

    update public.ldm2_licenses
    set archived_at=now(),
        archived_reason=coalesce(v_reason,'Tidak digunakan lagi'),
        archived_by_email=lower(nullif(btrim(coalesce(p_admin_email,'')),''))
    where id=v_license.id;

    return jsonb_build_object(
        'ok',true,
        'license_id',v_license.id,
        'message','Lisensi/customer berhasil diarsipkan. Riwayat pembayaran dan aktivasi tetap disimpan.'
    );
end;
$$;

create or replace function public.ldm2_restore_archived_license(
    p_license_id uuid,
    p_admin_email text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
begin
    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found then
        raise exception 'Lisensi tidak ditemukan.';
    end if;

    if v_license.archived_at is null then
        return jsonb_build_object('ok',true,'already_restored',true,'license_id',v_license.id);
    end if;

    update public.ldm2_licenses
    set archived_at=null,
        archived_reason=null,
        archived_by_email=null
    where id=v_license.id;

    return jsonb_build_object(
        'ok',true,
        'license_id',v_license.id,
        'message','Lisensi/customer berhasil dipulihkan dari arsip.'
    );
end;
$$;

-- Hapus permanen sengaja dibuat sangat ketat.
-- Hanya untuk lisensi yang BENAR-BENAR belum pernah digunakan.
create or replace function public.ldm2_purge_unused_license(
    p_license_id uuid,
    p_admin_email text,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_license public.ldm2_licenses%rowtype;
    v_snapshot jsonb;
    v_order_ids text[];
begin
    if upper(btrim(coalesce(p_confirmation,''))) <> 'HAPUS' then
        raise exception 'Konfirmasi penghapusan permanen tidak valid. Ketik HAPUS.';
    end if;

    select * into v_license
    from public.ldm2_licenses
    where id=p_license_id
    for update;

    if not found then
        raise exception 'Lisensi tidak ditemukan.';
    end if;

    if v_license.archived_at is null then
        raise exception 'Lisensi harus diarsipkan terlebih dahulu sebelum dihapus permanen.';
    end if;

    if v_license.status='active' then
        raise exception 'Lisensi aktif tidak boleh dihapus permanen.';
    end if;

    if exists(select 1 from public.ldm2_trial_claims where license_id=v_license.id) then
        raise exception 'Lisensi pernah digunakan untuk klaim trial. Arsipkan saja; data klaim trial wajib dipertahankan.';
    end if;

    if exists(select 1 from public.ldm2_activations where license_id=v_license.id) then
        raise exception 'Lisensi pernah diaktivasi pada perangkat. Arsipkan saja; riwayat aktivasi wajib dipertahankan.';
    end if;

    if exists(
        select 1 from public.ldm2_payments
        where license_id=v_license.id
          and (status in ('paid','refunded','pending','challenge') or paid_at is not null)
    ) then
        raise exception 'Lisensi memiliki pembayaran sukses/refund/pending. Arsipkan saja; riwayat keuangan tidak boleh dihapus.';
    end if;

    if exists(
        select 1 from public.ldm2_checkout_deliveries
        where license_id=v_license.id
          and (provision_status='ready' or owner_user_id is not null)
    ) then
        raise exception 'Customer pernah diprovision ke Cloud Data Toko. Arsipkan saja agar relasi customer tetap dapat diaudit.';
    end if;

    select coalesce(array_agg(order_id), array[]::text[]) into v_order_ids
    from public.ldm2_payments
    where license_id=v_license.id;

    v_snapshot := jsonb_build_object(
        'deleted_license_id',v_license.id,
        'customer_name',v_license.customer_name,
        'customer_email',v_license.customer_email,
        'plan_code',v_license.plan_code,
        'status',v_license.status,
        'key_prefix',v_license.key_prefix,
        'primary_store_code',v_license.primary_store_code,
        'network_id',v_license.network_id,
        'archived_at',v_license.archived_at,
        'purged_at',now()
    );

    -- Simpan jejak admin tanpa FK ke lisensi yang sebentar lagi dihapus.
    insert into public.ldm2_admin_audit(admin_user_id,admin_email,action,target_license_id,detail)
    values(null,lower(nullif(btrim(coalesce(p_admin_email,'')),'')),'PURGE_UNUSED_LICENSE',null,v_snapshot);

    delete from public.ldm2_checkout_attempts
    where order_id = any(v_order_ids);

    delete from public.ldm2_checkout_deliveries
    where license_id=v_license.id;

    delete from public.ldm2_payments
    where license_id=v_license.id
      and status in ('failed','expired','cancelled');

    -- Pengaman terakhir: bila masih ada payment yang tidak ikut terhapus, hentikan.
    if exists(select 1 from public.ldm2_payments where license_id=v_license.id) then
        raise exception 'Masih ada riwayat pembayaran yang tidak aman untuk dihapus. Gunakan Arsipkan.';
    end if;

    delete from public.ldm2_licenses where id=v_license.id;

    return jsonb_build_object(
        'ok',true,
        'deleted',true,
        'license_id',p_license_id,
        'message','Lisensi/customer yang belum pernah digunakan berhasil dihapus permanen dari License Authority.'
    );
end;
$$;

revoke all on function public.ldm2_archive_license(uuid,text,text) from public,anon,authenticated;
revoke all on function public.ldm2_restore_archived_license(uuid,text) from public,anon,authenticated;
revoke all on function public.ldm2_purge_unused_license(uuid,text,text) from public,anon,authenticated;

grant execute on function public.ldm2_archive_license(uuid,text,text) to service_role;
grant execute on function public.ldm2_restore_archived_license(uuid,text) to service_role;
grant execute on function public.ldm2_purge_unused_license(uuid,text,text) to service_role;

commit;

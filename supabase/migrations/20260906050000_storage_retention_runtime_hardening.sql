-- LocDailyMar 27.9.0 - Commercial Storage & Retention Runtime Hardening V22
-- Jalankan pada APP SUPABASE, BUKAN License Authority.
-- Tujuan:
-- 1) Edge Function tidak lagi mengakses schema storage lewat PostgREST.
-- 2) Kandidat file cleanup dihitung server-side lewat RPC service_role.
-- 3) Menyediakan health check aman untuk Owner/Admin.

begin;

create or replace function public.ldm_storage_cleanup_plan_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_setting public.data_retention_settings%rowtype;
    v_attendance jsonb := '[]'::jsonb;
    v_expenses jsonb := '[]'::jsonb;
    v_orphans jsonb := '[]'::jsonb;
    v_attendance_cutoff timestamptz;
    v_expense_cutoff timestamptz;
    v_orphan_cutoff timestamptz;
begin
    if p_store_id is null then
        raise exception 'STORE_ID_REQUIRED';
    end if;

    select * into v_setting
    from public.data_retention_settings
    where store_id = p_store_id;

    if not found then
        insert into public.data_retention_settings(store_id)
        values (p_store_id)
        on conflict (store_id) do nothing;

        select * into v_setting
        from public.data_retention_settings
        where store_id = p_store_id;
    end if;

    v_attendance_cutoff := now() - make_interval(days => greatest(1, coalesce(v_setting.attendance_proof_days, 365)));
    v_expense_cutoff := now() - make_interval(days => greatest(1, coalesce(v_setting.expense_receipt_days, 1095)));
    v_orphan_cutoff := now() - make_interval(days => greatest(1, coalesce(v_setting.orphan_product_image_days, 30)));

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id,
        'path', q.proof_path,
        'size', q.file_size
    )), '[]'::jsonb)
    into v_attendance
    from (
        select
            a.id,
            a.proof_path,
            coalesce((o.metadata->>'size')::bigint, 0) as file_size
        from public.attendance a
        left join storage.objects o
          on o.bucket_id = 'ldm-attendance-proofs'
         and o.name = a.proof_path
        where a.store_id = p_store_id
          and a.proof_path is not null
          and a.created_at < v_attendance_cutoff
        order by a.created_at asc
        limit 5000
    ) q;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id,
        'path', q.receipt_path,
        'size', q.file_size
    )), '[]'::jsonb)
    into v_expenses
    from (
        select
            e.id,
            e.receipt_path,
            coalesce((o.metadata->>'size')::bigint, 0) as file_size
        from public.operating_expenses e
        left join storage.objects o
          on o.bucket_id = 'ldm-expense-receipts'
         and o.name = e.receipt_path
        where e.store_id = p_store_id
          and e.receipt_path is not null
          and e.created_at < v_expense_cutoff
        order by e.created_at asc
        limit 5000
    ) q;

    select coalesce(jsonb_agg(jsonb_build_object(
        'path', q.name,
        'size', q.file_size
    )), '[]'::jsonb)
    into v_orphans
    from (
        select
            o.name,
            coalesce((o.metadata->>'size')::bigint, 0) as file_size
        from storage.objects o
        where o.bucket_id = 'ldm-product-images'
          and o.name like p_store_id::text || '/%'
          and o.created_at < v_orphan_cutoff
          and not exists (
              select 1
              from public.products p
              where p.store_id = p_store_id
                and p.image_path = o.name
          )
        order by o.created_at asc
        limit 10000
    ) q;

    return jsonb_build_object(
        'store_id', p_store_id,
        'enabled', coalesce(v_setting.enabled, true),
        'attendance', v_attendance,
        'expenses', v_expenses,
        'orphan_product_images', v_orphans,
        'generated_at', now()
    );
end;
$$;

revoke all on function public.ldm_storage_cleanup_plan_store(uuid) from public, anon, authenticated;
grant execute on function public.ldm_storage_cleanup_plan_store(uuid) to service_role;

create or replace function public.ldm_storage_retention_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_settings boolean := false;
    v_runs boolean := false;
    v_product_bucket boolean := false;
    v_attendance_bucket boolean := false;
    v_expense_bucket boolean := false;
begin
    if v_store is null then
        raise exception 'Store aktif tidak ditemukan.';
    end if;
    if v_role not in ('owner', 'admin') then
        raise exception 'Akses penyimpanan hanya untuk Owner/Admin.';
    end if;

    select exists(
        select 1 from public.data_retention_settings where store_id = v_store
    ) into v_settings;

    select to_regclass('public.storage_cleanup_runs') is not null into v_runs;

    select exists(select 1 from storage.buckets where id='ldm-product-images') into v_product_bucket;
    select exists(select 1 from storage.buckets where id='ldm-attendance-proofs') into v_attendance_bucket;
    select exists(select 1 from storage.buckets where id='ldm-expense-receipts') into v_expense_bucket;

    return jsonb_build_object(
        'ok', true,
        'store_id', v_store,
        'role', v_role,
        'retention_settings_ready', v_settings,
        'cleanup_runs_ready', v_runs,
        'cleanup_plan_rpc_ready', to_regprocedure('public.ldm_storage_cleanup_plan_store(uuid)') is not null,
        'buckets', jsonb_build_object(
            'product_images', v_product_bucket,
            'attendance_proofs', v_attendance_bucket,
            'expense_receipts', v_expense_bucket
        ),
        'checked_at', now()
    );
end;
$$;

revoke all on function public.ldm_storage_retention_health() from public, anon;
grant execute on function public.ldm_storage_retention_health() to authenticated;

commit;

-- Verifikasi cepat setelah dijalankan:
select
    to_regprocedure('public.ldm_storage_cleanup_plan_store(uuid)') is not null as cleanup_plan_rpc_ok,
    to_regprocedure('public.ldm_storage_retention_health()') is not null as storage_health_rpc_ok,
    to_regclass('public.data_retention_settings') is not null as retention_settings_table_ok,
    to_regclass('public.storage_cleanup_runs') is not null as cleanup_runs_table_ok;

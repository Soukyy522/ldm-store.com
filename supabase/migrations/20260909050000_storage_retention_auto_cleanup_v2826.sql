-- ============================================================================
-- LocDailyMar 27.9.0 - V28.2.6
-- SQL-45 STORAGE RETENTION AUTO CLEANUP HARDENING
--
-- Jalankan pada APP SUPABASE:
-- xwzighiqmxemnblzgcrf
--
-- BUKAN pada License Authority.
--
-- Tujuan:
-- 1. Melengkapi table/RPC fondasi Retensi yang sebelumnya direferensikan
--    frontend/Edge Function tetapi tidak ikut tersimpan lengkap di repository.
-- 2. Menjamin transaksi dan data bisnis inti TIDAK masuk auto-delete.
-- 3. Menjadwalkan Edge Function cleanup otomatis memakai pg_cron + pg_net.
-- 4. Menyediakan status scheduler nyata, bukan hanya "cron secret tersedia".
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

begin;

do $$
begin
    if to_regclass('public.stores') is null
       or to_regclass('public.products') is null
       or to_regclass('public.transactions') is null
       or to_regclass('public.transaction_items') is null
       or to_regclass('public.stock_movements') is null
       or to_regclass('public.attendance') is null
       or to_regclass('public.operating_expenses') is null
       or to_regclass('public.audit_events') is null then
        raise exception 'Fondasi App Supabase belum lengkap. Jalankan tahapan schema LocDailyMar sebelum SQL-45.';
    end if;

    if to_regprocedure('public.ldm_current_store_id()') is null
       or to_regprocedure('public.ldm_current_role()') is null then
        raise exception 'RPC context LocDailyMar belum tersedia.';
    end if;
end
$$;

-- Product image_path dibutuhkan oleh cleanup orphan image.
alter table public.products
    add column if not exists image_path text;

-- --------------------------------------------------------------------------
-- Retention settings per store.
-- --------------------------------------------------------------------------
create table if not exists public.data_retention_settings (
    store_id uuid primary key references public.stores(id) on delete cascade,
    enabled boolean not null default true,
    audit_days integer not null default 180,
    attendance_proof_days integer not null default 365,
    expense_receipt_days integer not null default 1095,
    orphan_product_image_days integer not null default 30,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);

alter table public.data_retention_settings
    drop constraint if exists data_retention_settings_audit_days_check,
    drop constraint if exists data_retention_settings_attendance_days_check,
    drop constraint if exists data_retention_settings_expense_days_check,
    drop constraint if exists data_retention_settings_orphan_days_check;

alter table public.data_retention_settings
    add constraint data_retention_settings_audit_days_check
        check (audit_days between 30 and 3650),
    add constraint data_retention_settings_attendance_days_check
        check (attendance_proof_days between 30 and 3650),
    add constraint data_retention_settings_expense_days_check
        check (expense_receipt_days between 90 and 3650),
    add constraint data_retention_settings_orphan_days_check
        check (orphan_product_image_days between 7 and 365);

alter table public.data_retention_settings enable row level security;
revoke all on public.data_retention_settings from anon;
revoke insert, update, delete on public.data_retention_settings from authenticated;
grant select on public.data_retention_settings to authenticated;

drop policy if exists data_retention_settings_select_owner_admin
on public.data_retention_settings;

create policy data_retention_settings_select_owner_admin
on public.data_retention_settings
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
);

-- --------------------------------------------------------------------------
-- Cleanup run log.
-- --------------------------------------------------------------------------
create table if not exists public.storage_cleanup_runs (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete cascade,
    trigger_source text not null default 'manual'
        check (trigger_source in ('manual','cron')),
    status text not null default 'running'
        check (status in ('running','success','failed')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    database_rows_deleted bigint not null default 0,
    storage_objects_deleted bigint not null default 0,
    storage_bytes_deleted bigint not null default 0,
    detail jsonb not null default '{}'::jsonb,
    error_message text
);

create index if not exists storage_cleanup_runs_store_time_idx
on public.storage_cleanup_runs(store_id, started_at desc);

alter table public.storage_cleanup_runs enable row level security;
revoke all on public.storage_cleanup_runs from anon;
revoke insert, update, delete on public.storage_cleanup_runs from authenticated;
grant select on public.storage_cleanup_runs to authenticated;

drop policy if exists storage_cleanup_runs_select_owner_admin
on public.storage_cleanup_runs;

create policy storage_cleanup_runs_select_owner_admin
on public.storage_cleanup_runs
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
);

-- --------------------------------------------------------------------------
-- Runtime secret for server-side cron. Never grant to application roles.
-- Secret is injected by Edge Function configuration action.
-- --------------------------------------------------------------------------
create table if not exists public.ldm_storage_runtime_secret (
    id smallint primary key default 1 check (id=1),
    function_url text not null,
    cron_secret text not null,
    schedule text not null default '17 19 * * *',
    updated_at timestamptz not null default now()
);

revoke all on public.ldm_storage_runtime_secret from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Settings RPC.
-- --------------------------------------------------------------------------
create or replace function public.ldm_get_retention_settings()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_setting public.data_retention_settings%rowtype;
begin
    if v_store is null then raise exception 'Store aktif tidak ditemukan.'; end if;
    if v_role not in ('owner','admin') then raise exception 'Akses retensi hanya untuk Owner/Admin.'; end if;

    insert into public.data_retention_settings(store_id)
    values(v_store)
    on conflict(store_id) do nothing;

    select * into v_setting
    from public.data_retention_settings
    where store_id=v_store;

    return jsonb_build_object(
        'store_id',v_setting.store_id,
        'enabled',v_setting.enabled,
        'audit_days',v_setting.audit_days,
        'attendance_proof_days',v_setting.attendance_proof_days,
        'expense_receipt_days',v_setting.expense_receipt_days,
        'orphan_product_image_days',v_setting.orphan_product_image_days,
        'updated_at',v_setting.updated_at
    );
end;
$$;

revoke all on function public.ldm_get_retention_settings() from public, anon;
grant execute on function public.ldm_get_retention_settings() to authenticated;

create or replace function public.ldm_update_retention_settings(
    p_enabled boolean,
    p_audit_days integer,
    p_attendance_proof_days integer,
    p_expense_receipt_days integer,
    p_orphan_product_image_days integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
begin
    if v_store is null then raise exception 'Store aktif tidak ditemukan.'; end if;
    if v_role <> 'owner' then raise exception 'Hanya Owner yang dapat mengubah kebijakan retensi.'; end if;

    if p_audit_days not between 30 and 3650 then raise exception 'Audit teknis harus 30-3650 hari.'; end if;
    if p_attendance_proof_days not between 30 and 3650 then raise exception 'Foto absensi harus 30-3650 hari.'; end if;
    if p_expense_receipt_days not between 90 and 3650 then raise exception 'Bukti pengeluaran harus 90-3650 hari.'; end if;
    if p_orphan_product_image_days not between 7 and 365 then raise exception 'Gambar yatim harus 7-365 hari.'; end if;

    insert into public.data_retention_settings(
        store_id,enabled,audit_days,attendance_proof_days,
        expense_receipt_days,orphan_product_image_days,updated_at,updated_by
    ) values(
        v_store,coalesce(p_enabled,true),p_audit_days,p_attendance_proof_days,
        p_expense_receipt_days,p_orphan_product_image_days,now(),auth.uid()
    )
    on conflict(store_id) do update set
        enabled=excluded.enabled,
        audit_days=excluded.audit_days,
        attendance_proof_days=excluded.attendance_proof_days,
        expense_receipt_days=excluded.expense_receipt_days,
        orphan_product_image_days=excluded.orphan_product_image_days,
        updated_at=now(),
        updated_by=auth.uid();

    return public.ldm_get_retention_settings();
end;
$$;

revoke all on function public.ldm_update_retention_settings(boolean,integer,integer,integer,integer)
from public, anon;
grant execute on function public.ldm_update_retention_settings(boolean,integer,integer,integer,integer)
to authenticated;

-- --------------------------------------------------------------------------
-- Storage overview.
-- Core business row counts are READ ONLY and never cleanup targets.
-- --------------------------------------------------------------------------
create or replace function public.ldm_storage_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_product_bytes bigint := 0;
    v_attendance_bytes bigint := 0;
    v_expense_bytes bigint := 0;
    v_objects bigint := 0;
begin
    if v_store is null then raise exception 'Store aktif tidak ditemukan.'; end if;
    if v_role not in ('owner','admin') then raise exception 'Akses penyimpanan hanya untuk Owner/Admin.'; end if;

    select
        count(*)::bigint,
        coalesce(sum(case when bucket_id='ldm-product-images' then coalesce((metadata->>'size')::bigint,0) else 0 end),0)::bigint,
        coalesce(sum(case when bucket_id='ldm-attendance-proofs' then coalesce((metadata->>'size')::bigint,0) else 0 end),0)::bigint,
        coalesce(sum(case when bucket_id='ldm-expense-receipts' then coalesce((metadata->>'size')::bigint,0) else 0 end),0)::bigint
    into v_objects,v_product_bytes,v_attendance_bytes,v_expense_bytes
    from storage.objects
    where bucket_id in ('ldm-product-images','ldm-attendance-proofs','ldm-expense-receipts')
      and name like v_store::text || '/%';

    return jsonb_build_object(
        'store_id',v_store,
        'storage_objects',v_objects,
        'product_image_bytes',v_product_bytes,
        'attendance_proof_bytes',v_attendance_bytes,
        'expense_receipt_bytes',v_expense_bytes,
        'storage_bytes',v_product_bytes+v_attendance_bytes+v_expense_bytes,
        'rows',jsonb_build_object(
            'products',(select count(*) from public.products where store_id=v_store),
            'transactions',(select count(*) from public.transactions where store_id=v_store),
            'transaction_items',(select count(*) from public.transaction_items where store_id=v_store),
            'stock_movements',(select count(*) from public.stock_movements where store_id=v_store),
            'attendance',(select count(*) from public.attendance where store_id=v_store),
            'audit_events',(select count(*) from public.audit_events where store_id=v_store)
        ),
        'core_business_auto_delete',false,
        'generated_at',now()
    );
end;
$$;

revoke all on function public.ldm_storage_overview() from public, anon;
grant execute on function public.ldm_storage_overview() to authenticated;

-- --------------------------------------------------------------------------
-- Cleanup plan used by service-role Edge Function.
-- LIMITS prevent one run from becoming unbounded. Next daily run continues.
-- --------------------------------------------------------------------------
create or replace function public.ldm_storage_cleanup_plan_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
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
    if p_store_id is null then raise exception 'STORE_ID_REQUIRED'; end if;

    insert into public.data_retention_settings(store_id)
    values(p_store_id)
    on conflict(store_id) do nothing;

    select * into v_setting
    from public.data_retention_settings
    where store_id=p_store_id;

    v_attendance_cutoff := now() - make_interval(days=>v_setting.attendance_proof_days);
    v_expense_cutoff := now() - make_interval(days=>v_setting.expense_receipt_days);
    v_orphan_cutoff := now() - make_interval(days=>v_setting.orphan_product_image_days);

    select coalesce(jsonb_agg(jsonb_build_object(
        'id',q.id,'path',q.proof_path,'size',q.file_size
    )),'[]'::jsonb)
    into v_attendance
    from (
        select a.id,a.proof_path,coalesce((o.metadata->>'size')::bigint,0) file_size
        from public.attendance a
        left join storage.objects o
          on o.bucket_id='ldm-attendance-proofs' and o.name=a.proof_path
        where a.store_id=p_store_id
          and a.proof_path is not null
          and a.created_at < v_attendance_cutoff
        order by a.created_at asc
        limit 5000
    ) q;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id',q.id,'path',q.receipt_path,'size',q.file_size
    )),'[]'::jsonb)
    into v_expenses
    from (
        select e.id,e.receipt_path,coalesce((o.metadata->>'size')::bigint,0) file_size
        from public.operating_expenses e
        left join storage.objects o
          on o.bucket_id='ldm-expense-receipts' and o.name=e.receipt_path
        where e.store_id=p_store_id
          and e.receipt_path is not null
          and e.created_at < v_expense_cutoff
        order by e.created_at asc
        limit 5000
    ) q;

    select coalesce(jsonb_agg(jsonb_build_object(
        'path',q.name,'size',q.file_size
    )),'[]'::jsonb)
    into v_orphans
    from (
        select o.name,coalesce((o.metadata->>'size')::bigint,0) file_size
        from storage.objects o
        where o.bucket_id='ldm-product-images'
          and o.name like p_store_id::text || '/%'
          and o.created_at < v_orphan_cutoff
          and not exists(
              select 1
              from public.products p
              where p.store_id=p_store_id and p.image_path=o.name
          )
        order by o.created_at asc
        limit 10000
    ) q;

    return jsonb_build_object(
        'store_id',p_store_id,
        'enabled',v_setting.enabled,
        'attendance',v_attendance,
        'expenses',v_expenses,
        'orphan_product_images',v_orphans,
        'generated_at',now()
    );
end;
$$;

revoke all on function public.ldm_storage_cleanup_plan_store(uuid)
from public,anon,authenticated;
grant execute on function public.ldm_storage_cleanup_plan_store(uuid)
to service_role;

-- --------------------------------------------------------------------------
-- Database cleanup: ONLY technical audit rows.
-- Never delete:
-- products, transactions, transaction_items, stock_movements, attendance rows,
-- operating_expenses rows, closing, EOD, PO, GR, returns, stock opname.
-- --------------------------------------------------------------------------
create or replace function public.ldm_cleanup_database_retention_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_setting public.data_retention_settings%rowtype;
    v_audit_deleted bigint := 0;
begin
    if p_store_id is null then raise exception 'STORE_ID_REQUIRED'; end if;

    insert into public.data_retention_settings(store_id)
    values(p_store_id)
    on conflict(store_id) do nothing;

    select * into v_setting
    from public.data_retention_settings
    where store_id=p_store_id;

    with deleted as (
        delete from public.audit_events
        where store_id=p_store_id
          and created_at < now() - make_interval(days=>v_setting.audit_days)
        returning 1
    )
    select count(*) into v_audit_deleted from deleted;

    return jsonb_build_object(
        'store_id',p_store_id,
        'database_rows_deleted',v_audit_deleted,
        'audit_events_deleted',v_audit_deleted,
        'core_business_rows_deleted',0,
        'core_business_protected',true,
        'cleaned_at',now()
    );
end;
$$;

revoke all on function public.ldm_cleanup_database_retention_store(uuid)
from public,anon,authenticated;
grant execute on function public.ldm_cleanup_database_retention_store(uuid)
to service_role;

-- --------------------------------------------------------------------------
-- Actual auto-cleanup scheduler.
-- Secret is stored in a locked table and never returned to browser.
-- Default schedule: 19:17 UTC = 03:17 WITA every day.
-- --------------------------------------------------------------------------
create or replace function public.ldm_storage_configure_auto_cleanup(
    p_function_url text,
    p_cron_secret text,
    p_schedule text default '17 19 * * *'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_url text := btrim(coalesce(p_function_url,''));
    v_secret text := btrim(coalesce(p_cron_secret,''));
    v_schedule text := btrim(coalesce(p_schedule,''));
    v_existing bigint;
    v_job bigint;
    v_command text;
begin
    if v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/ldm-storage-maintenance$' then
        raise exception 'Function URL storage maintenance tidak valid.';
    end if;
    if length(v_secret) < 24 then
        raise exception 'Cron secret belum valid.';
    end if;
    if v_schedule = '' then v_schedule := '17 19 * * *'; end if;

    insert into public.ldm_storage_runtime_secret(id,function_url,cron_secret,schedule,updated_at)
    values(1,v_url,v_secret,v_schedule,now())
    on conflict(id) do update set
        function_url=excluded.function_url,
        cron_secret=excluded.cron_secret,
        schedule=excluded.schedule,
        updated_at=now();

    select jobid into v_existing
    from cron.job
    where jobname='ldm-storage-retention-daily'
    order by jobid desc
    limit 1;

    if v_existing is not null then
        perform cron.unschedule(v_existing);
    end if;

    v_command :=
        'select net.http_post(' ||
        'url := (select function_url from public.ldm_storage_runtime_secret where id=1),' ||
        'headers := jsonb_build_object(' ||
            quote_literal('Content-Type') || ',' || quote_literal('application/json') || ',' ||
            quote_literal('x-ldm-cron-secret') || ',(select cron_secret from public.ldm_storage_runtime_secret where id=1)' ||
        '),' ||
        'body := ' || quote_literal('{"action":"cleanup-all-stores"}') || '::jsonb' ||
        ');';

    select cron.schedule(
        'ldm-storage-retention-daily',
        v_schedule,
        v_command
    ) into v_job;

    return jsonb_build_object(
        'ok',true,
        'job_id',v_job,
        'job_name','ldm-storage-retention-daily',
        'schedule',v_schedule,
        'schedule_label','Setiap hari sekitar 03:17 WITA',
        'configured_at',now()
    );
end;
$$;

revoke all on function public.ldm_storage_configure_auto_cleanup(text,text,text)
from public,anon,authenticated;
grant execute on function public.ldm_storage_configure_auto_cleanup(text,text,text)
to service_role;

create or replace function public.ldm_storage_auto_cleanup_status()
returns jsonb
language plpgsql
security definer
set search_path=''
stable
as $$
declare
    v_role text := public.ldm_current_role();
    v_job_id bigint;
    v_schedule text;
    v_active boolean := false;
    v_last_status text;
    v_last_start timestamptz;
    v_last_end timestamptz;
    v_last_store_run timestamptz;
    v_last_store_status text;
begin
    if v_role not in ('owner','admin') and auth.role() <> 'service_role' then
        raise exception 'Akses status scheduler hanya untuk Owner/Admin.';
    end if;

    select jobid,schedule,active
    into v_job_id,v_schedule,v_active
    from cron.job
    where jobname='ldm-storage-retention-daily'
    order by jobid desc
    limit 1;

    if v_job_id is not null then
        select status,start_time,end_time
        into v_last_status,v_last_start,v_last_end
        from cron.job_run_details
        where jobid=v_job_id
        order by start_time desc
        limit 1;
    end if;

    if public.ldm_current_store_id() is not null then
        select started_at,status
        into v_last_store_run,v_last_store_status
        from public.storage_cleanup_runs
        where store_id=public.ldm_current_store_id()
          and trigger_source='cron'
        order by started_at desc
        limit 1;
    end if;

    return jsonb_build_object(
        'configured',v_job_id is not null,
        'active',coalesce(v_active,false),
        'job_id',v_job_id,
        'schedule',v_schedule,
        'schedule_label','Setiap hari sekitar 03:17 WITA',
        'last_cron_status',v_last_status,
        'last_cron_started_at',v_last_start,
        'last_cron_finished_at',v_last_end,
        'last_store_cleanup_at',v_last_store_run,
        'last_store_cleanup_status',v_last_store_status
    );
end;
$$;

revoke all on function public.ldm_storage_auto_cleanup_status()
from public,anon;
grant execute on function public.ldm_storage_auto_cleanup_status()
to authenticated,service_role;

-- --------------------------------------------------------------------------
-- Health check now verifies the REAL scheduler.
-- --------------------------------------------------------------------------
create or replace function public.ldm_storage_retention_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
    v_store uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_settings boolean := false;
    v_runs boolean := false;
    v_product_bucket boolean := false;
    v_attendance_bucket boolean := false;
    v_expense_bucket boolean := false;
    v_scheduler jsonb := '{}'::jsonb;
begin
    if v_store is null then raise exception 'Store aktif tidak ditemukan.'; end if;
    if v_role not in ('owner','admin') then raise exception 'Akses penyimpanan hanya untuk Owner/Admin.'; end if;

    select exists(select 1 from public.data_retention_settings where store_id=v_store)
    into v_settings;
    select to_regclass('public.storage_cleanup_runs') is not null into v_runs;

    select exists(select 1 from storage.buckets where id='ldm-product-images') into v_product_bucket;
    select exists(select 1 from storage.buckets where id='ldm-attendance-proofs') into v_attendance_bucket;
    select exists(select 1 from storage.buckets where id='ldm-expense-receipts') into v_expense_bucket;

    v_scheduler := public.ldm_storage_auto_cleanup_status();

    return jsonb_build_object(
        'ok',true,
        'store_id',v_store,
        'role',v_role,
        'retention_settings_ready',v_settings,
        'cleanup_runs_ready',v_runs,
        'cleanup_plan_rpc_ready',to_regprocedure('public.ldm_storage_cleanup_plan_store(uuid)') is not null,
        'database_cleanup_rpc_ready',to_regprocedure('public.ldm_cleanup_database_retention_store(uuid)') is not null,
        'settings_rpc_ready',to_regprocedure('public.ldm_get_retention_settings()') is not null,
        'overview_rpc_ready',to_regprocedure('public.ldm_storage_overview()') is not null,
        'scheduler',v_scheduler,
        'buckets',jsonb_build_object(
            'product_images',v_product_bucket,
            'attendance_proofs',v_attendance_bucket,
            'expense_receipts',v_expense_bucket
        ),
        'core_business_auto_delete',false,
        'checked_at',now()
    );
end;
$$;

revoke all on function public.ldm_storage_retention_health()
from public,anon;
grant execute on function public.ldm_storage_retention_health()
to authenticated;

commit;

-- ============================================================================
-- VERIFIKASI
-- ============================================================================
select
    to_regclass('public.data_retention_settings') is not null as retention_settings_ok,
    to_regclass('public.storage_cleanup_runs') is not null as cleanup_runs_ok,
    to_regprocedure('public.ldm_get_retention_settings()') is not null as get_settings_ok,
    to_regprocedure('public.ldm_update_retention_settings(boolean,integer,integer,integer,integer)') is not null as update_settings_ok,
    to_regprocedure('public.ldm_storage_overview()') is not null as overview_ok,
    to_regprocedure('public.ldm_storage_cleanup_plan_store(uuid)') is not null as plan_ok,
    to_regprocedure('public.ldm_cleanup_database_retention_store(uuid)') is not null as db_cleanup_ok,
    to_regprocedure('public.ldm_storage_configure_auto_cleanup(text,text,text)') is not null as scheduler_config_ok,
    to_regprocedure('public.ldm_storage_auto_cleanup_status()') is not null as scheduler_status_ok;

select jobid,jobname,schedule,active
from cron.job
where jobname='ldm-storage-retention-daily';

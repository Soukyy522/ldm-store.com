-- ================================================================
-- Verifikasi Tahap 16 - Offline Queue + Reconnect
-- Semua baris utama harus menghasilkan PASS / angka 0.
-- ================================================================

select
    case when count(*) = 8 then 'PASS' else 'FAIL' end as metadata_stage16,
    count(*) as metadata_count
from public.ldm_system_meta
where (key,value) in (
    values
        ('live_sync_stage','16'),
        ('schema_version','16'),
        ('schema_status','offline_queue_reconnect_ready'),
        ('checkout_offline_mode','indexeddb_queue_idempotent_reconnect'),
        ('offline_queue_scope','sales_only'),
        ('offline_queue_max_age','7_days'),
        ('offline_lease_duration','12_hours'),
        ('offline_attendance_validation','queued_transaction_time')
);

select
    case when count(*) = 1 then 'PASS' else 'FAIL' end as reconnect_rpc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ldm_sync_offline_sale';

select
    case when count(*) = 1 then 'PASS' else 'FAIL' end as queued_time_attendance_guard
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ldm_require_active_attendance_for_transaction'
  and pg_get_functiondef(p.oid) like '%ldm.offline_queued_at%';

select
    case when count(*) = 4 then 'PASS' else 'FAIL' end as offline_audit_columns,
    count(*) as column_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'transactions'
  and column_name in ('was_offline','origin_client_device_id','queued_at','synced_at');

select
    case when count(*) = 0 then 'PASS' else 'FAIL' end as invalid_offline_audit_rows,
    count(*) as invalid_count
from public.transactions
where was_offline = true
  and (
      origin_client_device_id is null
      or queued_at is null
      or synced_at is null
  );

select
    case when count(*) = 0 then 'PASS' else 'FAIL' end as duplicate_client_transaction_ids,
    count(*) as duplicate_groups
from (
    select store_id,client_transaction_id
    from public.transactions
    group by store_id,client_transaction_id
    having count(*) > 1
) duplicates;

select
    count(*) filter (where was_offline = true) as offline_transactions,
    count(*) filter (where was_offline = false) as direct_online_transactions,
    max(synced_at) filter (where was_offline = true) as last_offline_sync
from public.transactions;

-- ================================================================
-- LocDailyMar - Tahap 9 Verification
-- ================================================================

-- 1. Metadata
select *
from public.ldm_system_meta
where key in (
    'live_sync_stage',
    'schema_status',
    'schema_version',
    'attendance_authority',
    'attendance_cache',
    'attendance_proof_storage',
    'attendance_realtime',
    'attendance_shift_mode',
    'transaction_attendance_guard'
)
order by key;

-- 2. Attendance table + RLS
select
    schemaname,
    tablename,
    rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'attendance';

-- 3. Storage bucket harus private
select
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
from storage.buckets
where id = 'ldm-attendance-proofs';

-- 4. Active profiles
select
    s.code as store_code,
    p.username,
    p.role,
    p.active
from public.profiles p
join public.stores s
  on s.id = p.store_id
where p.deleted_at is null
order by s.code, p.role, p.username;

-- 5. Attendance rows terbaru
select
    a.id,
    a.attendance_date,
    a.username_snapshot,
    a.attendance_type,
    a.shift_label,
    a.recorded_at,
    a.proof_path,
    a.legacy_source_id
from public.attendance a
where a.deleted_at is null
order by a.recorded_at desc
limit 100;

-- 6. Duplicate Masuk harus kosong
select
    store_id,
    user_id,
    attendance_date,
    count(*) as duplicate_count
from public.attendance
where attendance_type = 'Masuk'
  and deleted_at is null
group by store_id, user_id, attendance_date
having count(*) > 1;

-- 7. Duplicate Keluar harus kosong
select
    store_id,
    user_id,
    attendance_date,
    count(*) as duplicate_count
from public.attendance
where attendance_type = 'Keluar'
  and deleted_at is null
group by store_id, user_id, attendance_date
having count(*) > 1;

-- 8. Transaction relation
select
    t.transaction_code,
    t.cashier_username,
    t.business_date,
    t.attendance_id,
    a.attendance_type,
    a.shift_label,
    t.status
from public.transactions t
left join public.attendance a
  on a.id = t.attendance_id
order by t.transacted_at desc
limit 50;

-- Catatan:
-- transaksi yang dibuat sebelum Tahap 9 boleh attendance_id NULL.

-- 9. Realtime publication
select
    pubname,
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'attendance';

-- ================================================================
-- LocDailyMar - Tahap 12 Verification
-- ================================================================

-- 1. Metadata
select * from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_status','schema_version','closing_authority','eod_authority',
    'reporting_sales_authority','legacy_reporting_authority','operating_expense_authority',
    'cash_movement_authority','reporting_cache_mode','reporting_realtime',
    'financial_close_guard','shift_management','full_live_sync_core'
)
order by key;

-- 2. RLS wajib TRUE
select schemaname,tablename,rowsecurity
from pg_tables
where schemaname='public'
  and tablename in (
    'shift_closings','end_of_day_closings','operating_expenses','legacy_transactions',
    'transactions','transaction_items','sales_returns','cash_movements'
  )
order by tablename;

-- 3. Expense receipt bucket wajib PRIVATE
select id,name,public,file_size_limit,allowed_mime_types
from storage.buckets
where id='ldm-expense-receipts';

-- 4. Duplicate FINAL closing harus 0 rows
select store_id,business_date,lower(cashier_username) cashier,shift_label,count(*)
from public.shift_closings
where status='FINAL' and deleted_at is null
group by store_id,business_date,lower(cashier_username),shift_label
having count(*)>1;

-- 5. Duplicate FINAL EOD harus 0 rows
select store_id,business_date,count(*)
from public.end_of_day_closings
where status='FINAL' and deleted_at is null
group by store_id,business_date
having count(*)>1;

-- 6. Cash movement aktif yang menunjuk Closing VOIDED harus 0 rows
select m.id,m.reference_code,m.closing_id,c.status
from public.cash_movements m
join public.shift_closings c on c.id=m.closing_id
where m.status='active' and c.status<>'FINAL';

-- 7. Transaksi completed yang dibuat setelah Closing FINAL pada shift sama ideal 0 rows
select t.id,t.transaction_code,t.business_date,t.cashier_username,t.shift_label,t.transacted_at,c.finalized_at
from public.transactions t
join public.shift_closings c
  on c.store_id=t.store_id
 and c.business_date=t.business_date
 and c.cashier_user_id=t.cashier_user_id
 and c.shift_label=t.shift_label
 and c.status='FINAL'
 and c.deleted_at is null
where t.status='completed' and t.transacted_at>c.finalized_at;

-- 8. EOD latest
select business_date,system_net_sales,closing_net_sales,sales_difference,
       expected_cash,physical_cash,cash_difference,operating_expense_total,
       closing_count,status,finalized_username,finalized_at
from public.end_of_day_closings
where deleted_at is null
order by business_date desc,finalized_at desc
limit 30;

-- 9. Closing latest
select business_date,cashier_username,shift_label,gross_sales,approved_returns,
       net_sales,cash_sales,noncash_sales,cash_in,cash_out,expected_cash,
       physical_cash,cash_difference,status,finalized_at
from public.shift_closings
where deleted_at is null
order by finalized_at desc
limit 100;

-- 10. Realtime publication
select pubname,schemaname,tablename
from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public'
  and tablename in ('shift_closings','end_of_day_closings','operating_expenses','legacy_transactions')
order by tablename;

-- 11. Product snapshot vs latest stock ledger ideal 0 rows
with latest as (
    select distinct on (sm.product_id)
        sm.product_id,sm.stock_after
    from public.stock_movements sm
    order by sm.product_id,sm.occurred_at desc,sm.created_at desc,sm.id desc
)
select p.id,p.name,p.legacy_stock_snapshot,l.stock_after
from public.products p
join latest l on l.product_id=p.id
where p.deleted_at is null
  and p.legacy_stock_snapshot is distinct from l.stock_after;

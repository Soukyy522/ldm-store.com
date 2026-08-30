-- ============================================================================
-- OPSIONAL: HAPUS DATABASE FINANCE CONTROL / TAHAP 28
-- ============================================================================
-- JANGAN jalankan file ini jika SQL Tahap 28 belum pernah dipasang.
-- File ini akan menghapus tagihan supplier, pembayaran Finance Control,
-- dan kunci periode Finance Control. Audit lama tetap dipertahankan.
-- Lakukan backup database sebelum menjalankannya.

begin;

drop function if exists public.ldm_finance_daily_report(date,date);
drop function if exists public.ldm_finance_summary(date,date);
drop function if exists public.ldm_finance_unlock_period(uuid,text);
drop function if exists public.ldm_finance_lock_period(date,date,text);
drop function if exists public.ldm_finance_cancel_supplier_invoice(uuid,text);
drop function if exists public.ldm_finance_reverse_supplier_payment(uuid,text);
drop function if exists public.ldm_finance_record_supplier_payment(uuid,uuid,date,numeric,text,text,text);
drop function if exists public.ldm_finance_create_supplier_invoice(uuid,text,uuid,uuid,date,date,numeric,text);
drop function if exists public.ldm_finance_audit(text,text,text,date,jsonb);
drop function if exists public.ldm_finance_assert_open_date(date);
drop function if exists public.ldm_finance_require_owner();

drop table if exists public.supplier_invoice_payments;
drop table if exists public.financial_period_locks;
drop table if exists public.supplier_invoices;

delete from public.ldm_system_meta
where key in ('stage28_finance_control','stage28_historical_hpp');

commit;

-- Verifikasi setelah selesai:
select to_regclass('public.supplier_invoices') as supplier_invoices,
       to_regclass('public.supplier_invoice_payments') as supplier_invoice_payments,
       to_regclass('public.financial_period_locks') as financial_period_locks;
-- Ketiga hasil seharusnya NULL.

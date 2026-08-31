-- ============================================================
-- VERIFY LocDailyMar 26.2.2 - EOD transaction readiness
-- Jalankan setelah 26-stage26.2.2-eod-transaction-readiness.sql
-- ============================================================

-- 1. Fungsi finalisasi EOD harus ada.
select
    to_regprocedure('public.ldm_finalize_end_of_day(text)') is not null
    as finalize_eod_function_ok;

-- 2. Lihat transaksi hari ini dan pasangan akun + shift yang wajib closing.
with context as (
    select
        public.ldm_current_store_id() as store_id,
        (now() at time zone public.ldm_store_timezone())::date as business_date
), requirements as (
    select distinct
        t.cashier_user_id,
        t.cashier_username,
        nullif(btrim(coalesce(t.shift_label, '')), '') as shift_label
    from public.transactions t
    join context c on c.store_id = t.store_id
    where t.business_date = c.business_date
      and t.status = 'completed'
)
select
    cashier_username,
    coalesce(shift_label, 'Shift tidak tercatat') as shift_transaksi,
    exists (
        select 1
        from public.shift_closings s
        join context c on c.store_id = s.store_id
        where s.business_date = c.business_date
          and s.status = 'FINAL'
          and s.deleted_at is null
          and (
              (requirements.cashier_user_id is not null and s.cashier_user_id = requirements.cashier_user_id)
              or
              (
                  requirements.cashier_user_id is null
                  and lower(btrim(coalesce(s.cashier_username, ''))) =
                      lower(btrim(coalesce(requirements.cashier_username, '')))
              )
          )
          and (
              requirements.shift_label is null
              or lower(btrim(coalesce(s.shift_label, ''))) = lower(requirements.shift_label)
              or lower(btrim(coalesce(s.shift_label, ''))) = 'full day'
          )
    ) as closing_sesuai_transaksi_ok
from requirements
order by cashier_username, shift_label;

-- 3. Jika semua baris closing_sesuai_transaksi_ok = true,
--    EOD sudah memenuhi syarat Closing Shift.

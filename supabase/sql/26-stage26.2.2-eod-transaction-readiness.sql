-- ============================================================
-- LocDailyMar 26.2.2
-- EOD readiness berbasis akun + shift yang BENAR-BENAR transaksi
-- Jalankan pada Supabase PROJECT CLOUD DATA TOKO.
-- ============================================================

create or replace function public.ldm_finalize_end_of_day(
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_username text := public.ldm_current_username();
    v_timezone text := public.ldm_store_timezone();
    v_today date;
    v_missing text;
    v_transaction_count integer := 0;
    v_system_gross numeric(16,2) := 0;
    v_returns numeric(16,2) := 0;
    v_system_net numeric(16,2) := 0;
    v_close_sales numeric(16,2) := 0;
    v_cash numeric(16,2) := 0;
    v_noncash numeric(16,2) := 0;
    v_in numeric(16,2) := 0;
    v_out numeric(16,2) := 0;
    v_expected numeric(16,2) := 0;
    v_physical numeric(16,2) := 0;
    v_opening numeric(16,2) := 0;
    v_expenses numeric(16,2) := 0;
    v_count integer := 0;
    v_accounts jsonb := '[]'::jsonb;
    v_id uuid;
begin
    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat finalisasi End of Day.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    if exists (
        select 1
        from public.end_of_day_closings e
        where e.store_id = v_store_id
          and e.business_date = v_today
          and e.status = 'FINAL'
          and e.deleted_at is null
    ) then
        raise exception 'End of Day hari ini sudah FINAL.';
    end if;

    select count(*)::integer
      into v_transaction_count
    from public.transactions t
    where t.store_id = v_store_id
      and t.business_date = v_today
      and t.status = 'completed';

    if v_transaction_count = 0 then
        raise exception 'EOD belum siap: belum ada transaksi selesai pada hari ini.';
    end if;

    /*
     * Satu kebutuhan Closing dibuat untuk setiap pasangan unik:
     *   akun kasir + shift transaksi.
     *
     * Aturan pemenuhan:
     * - transaksi Shift 1  -> Closing Shift 1 ATAU Full Day akun yang sama
     * - transaksi Shift 2  -> Closing Shift 2 ATAU Full Day akun yang sama
     * - transaksi Full Day -> Closing Full Day akun yang sama
     * - transaksi tanpa label shift -> Closing apa pun milik akun yang sama
     *
     * Tidak ada lagi kewajiban global Shift 1 DAN Shift 2 harus selalu ada.
     */
    select string_agg(
               format(
                   '%s (%s)',
                   x.cashier_username,
                   coalesce(x.shift_label, 'Shift tidak tercatat')
               ),
               ', ' order by x.cashier_username, x.shift_label
           )
      into v_missing
    from (
        select distinct
            t.cashier_user_id,
            t.cashier_username,
            nullif(btrim(coalesce(t.shift_label, '')), '') as shift_label
        from public.transactions t
        where t.store_id = v_store_id
          and t.business_date = v_today
          and t.status = 'completed'
    ) x
    where not exists (
        select 1
        from public.shift_closings c
        where c.store_id = v_store_id
          and c.business_date = v_today
          and c.status = 'FINAL'
          and c.deleted_at is null
          and (
              (x.cashier_user_id is not null and c.cashier_user_id = x.cashier_user_id)
              or
              (
                  x.cashier_user_id is null
                  and lower(btrim(coalesce(c.cashier_username, ''))) =
                      lower(btrim(coalesce(x.cashier_username, '')))
              )
          )
          and (
              x.shift_label is null
              or lower(btrim(coalesce(c.shift_label, ''))) = lower(x.shift_label)
              or lower(btrim(coalesce(c.shift_label, ''))) = 'full day'
          )
    );

    if v_missing is not null then
        raise exception 'EOD belum siap. Belum Closing sesuai transaksi: %', v_missing;
    end if;

    select coalesce(sum(t.grand_total), 0)
      into v_system_gross
    from public.transactions t
    where t.store_id = v_store_id
      and t.business_date = v_today
      and t.status = 'completed';

    select coalesce(sum(r.total_refund), 0)
      into v_returns
    from public.sales_returns r
    where r.store_id = v_store_id
      and r.status = 'APPROVED'
      and r.deleted_at is null
      and (r.approved_at at time zone v_timezone)::date = v_today;

    v_system_net := v_system_gross - v_returns;

    /*
     * Hanya Closing akun yang memang memiliki transaksi hari ini yang
     * masuk ke EOD. Jika suatu akun mempunyai Full Day, Full Day menjadi
     * sumber gabungan utama untuk akun itu agar tidak terjadi double count.
     */
    with final_closing as (
        select c.*
        from public.shift_closings c
        where c.store_id = v_store_id
          and c.business_date = v_today
          and c.status = 'FINAL'
          and c.deleted_at is null
          and exists (
              select 1
              from public.transactions t
              where t.store_id = v_store_id
                and t.business_date = v_today
                and t.status = 'completed'
                and (
                    (t.cashier_user_id is not null and t.cashier_user_id = c.cashier_user_id)
                    or
                    (
                        t.cashier_user_id is null
                        and lower(btrim(coalesce(t.cashier_username, ''))) =
                            lower(btrim(coalesce(c.cashier_username, '')))
                    )
                )
                and (
                    nullif(btrim(coalesce(t.shift_label, '')), '') is null
                    or lower(btrim(coalesce(c.shift_label, ''))) = lower(btrim(t.shift_label))
                    or lower(btrim(coalesce(c.shift_label, ''))) = 'full day'
                )
          )
    ), selected as (
        -- Full Day menang untuk akun yang memilikinya.
        select c.*
        from final_closing c
        where lower(btrim(coalesce(c.shift_label, ''))) = 'full day'

        union all

        -- Shift normal dipakai hanya bila akun tidak mempunyai Full Day.
        select c.*
        from final_closing c
        where lower(btrim(coalesce(c.shift_label, ''))) in ('shift 1', 'shift 2')
          and not exists (
              select 1
              from final_closing f
              where (
                  (f.cashier_user_id is not null and f.cashier_user_id = c.cashier_user_id)
                  or
                  (
                      f.cashier_user_id is null
                      and lower(btrim(coalesce(f.cashier_username, ''))) =
                          lower(btrim(coalesce(c.cashier_username, '')))
                  )
              )
                and lower(btrim(coalesce(f.shift_label, ''))) = 'full day'
          )
    )
    select
        coalesce(sum(net_sales), 0),
        coalesce(sum(cash_sales), 0),
        coalesce(sum(noncash_sales), 0),
        coalesce(sum(cash_in), 0),
        coalesce(sum(cash_out), 0),
        coalesce(sum(expected_cash), 0),
        coalesce(sum(physical_cash), 0),
        coalesce(sum(opening_cash), 0),
        count(*)::integer,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'cashier', cashier_username,
                    'shift', shift_label,
                    'net_sales', net_sales,
                    'cash_sales', cash_sales,
                    'noncash_sales', noncash_sales,
                    'expected_cash', expected_cash,
                    'physical_cash', physical_cash,
                    'cash_difference', cash_difference
                )
                order by cashier_username, shift_label
            ),
            '[]'::jsonb
        )
    into
        v_close_sales,
        v_cash,
        v_noncash,
        v_in,
        v_out,
        v_expected,
        v_physical,
        v_opening,
        v_count,
        v_accounts
    from selected;

    select coalesce(sum(x.amount), 0)
      into v_expenses
    from public.operating_expenses x
    where x.store_id = v_store_id
      and x.business_date = v_today
      and x.deleted_at is null;

    if (
        (v_physical - v_expected) <> 0
        or (v_close_sales - v_system_net) <> 0
    ) and nullif(btrim(coalesce(p_note, '')), '') is null then
        raise exception 'Ada selisih tunai/omzet. Catatan wajib diisi.';
    end if;

    insert into public.end_of_day_closings(
        store_id,
        business_date,
        system_net_sales,
        closing_net_sales,
        sales_difference,
        cash_sales,
        noncash_sales,
        cash_in,
        cash_out,
        expected_cash,
        physical_cash,
        cash_difference,
        opening_cash,
        operating_expense_total,
        closing_count,
        note,
        accounts_snapshot,
        status,
        finalized_by,
        finalized_username,
        finalized_role,
        finalized_at,
        snapshot
    ) values (
        v_store_id,
        v_today,
        v_system_net,
        v_close_sales,
        v_close_sales - v_system_net,
        v_cash,
        v_noncash,
        v_in,
        v_out,
        v_expected,
        v_physical,
        v_physical - v_expected,
        v_opening,
        v_expenses,
        v_count,
        nullif(btrim(coalesce(p_note, '')), ''),
        v_accounts,
        'FINAL',
        auth.uid(),
        coalesce(v_username, '-'),
        v_role,
        now(),
        jsonb_build_object(
            'version', '26.2.2',
            'server_calculated', true,
            'readiness_rule', 'transaction_account_shift',
            'gross_sales', v_system_gross,
            'approved_returns', v_returns
        )
    ) returning id into v_id;

    return jsonb_build_object(
        'id', v_id,
        'business_date', v_today,
        'system_net_sales', v_system_net,
        'closing_net_sales', v_close_sales,
        'sales_difference', v_close_sales - v_system_net,
        'expected_cash', v_expected,
        'physical_cash', v_physical,
        'cash_difference', v_physical - v_expected,
        'operating_expense_total', v_expenses,
        'closing_count', v_count,
        'status', 'FINAL',
        'readiness_rule', 'transaction_account_shift'
    );
end;
$$;

revoke all on function public.ldm_finalize_end_of_day(text) from public, anon;
grant execute on function public.ldm_finalize_end_of_day(text) to authenticated;

-- ================================================================
-- LocDailyMar - Live Sync Tahap 12
-- Cloud Closing + EOD + Laporan + Dashboard
-- Final cross-device reporting authority
-- TANPA SHIFT MANAGEMENT
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- Foundation checks
-- ----------------------------------------------------------------
do $$
begin
    if to_regclass('public.transactions') is null then
        raise exception 'Tahap 8 belum tersedia: public.transactions tidak ditemukan.';
    end if;
    if to_regclass('public.attendance') is null then
        raise exception 'Tahap 9 belum tersedia: public.attendance tidak ditemukan.';
    end if;
    if to_regclass('public.sales_returns') is null then
        raise exception 'Tahap 10 belum tersedia: public.sales_returns tidak ditemukan.';
    end if;
    if to_regclass('public.cash_movements') is null then
        raise exception 'Tahap 10 belum tersedia: public.cash_movements tidak ditemukan.';
    end if;
    if to_regclass('public.goods_receipts') is null then
        raise exception 'Tahap 11 belum tersedia: public.goods_receipts tidak ditemukan.';
    end if;
end
$$;

-- ----------------------------------------------------------------
-- SHIFT CLOSING CLOUD
-- Shift adalah label Absensi saja, bukan Shift Management.
-- ----------------------------------------------------------------
create table if not exists public.shift_closings (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    business_date date not null,

    cashier_user_id uuid references auth.users(id) on delete restrict,
    cashier_username text not null,
    attendance_id uuid references public.attendance(id) on delete restrict,
    shift_label text not null
        check (shift_label in ('Shift 1','Shift 2','Full Day')),

    opening_cash numeric(16,2) not null default 0 check (opening_cash >= 0),
    gross_sales numeric(16,2) not null default 0,
    approved_returns numeric(16,2) not null default 0,
    net_sales numeric(16,2) not null default 0,
    cash_sales numeric(16,2) not null default 0,
    noncash_sales numeric(16,2) not null default 0,
    cash_in numeric(16,2) not null default 0,
    cash_out numeric(16,2) not null default 0,
    expected_cash numeric(16,2) not null default 0,
    physical_cash numeric(16,2) not null default 0,
    cash_difference numeric(16,2) not null default 0,
    transaction_count integer not null default 0,

    note text,
    status text not null default 'FINAL'
        check (status in ('FINAL','VOIDED')),

    finalized_by uuid not null references auth.users(id) on delete restrict,
    finalized_username text not null,
    finalized_role text not null,
    finalized_at timestamptz not null default now(),

    voided_by uuid references auth.users(id),
    voided_username text,
    voided_at timestamptz,
    void_reason text,

    legacy_imported boolean not null default false,
    legacy_source_id text,
    snapshot jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists shift_closings_final_unique
on public.shift_closings(
    store_id,
    business_date,
    lower(btrim(cashier_username)),
    lower(btrim(shift_label))
)
where status = 'FINAL' and deleted_at is null;

create unique index if not exists shift_closings_legacy_unique
on public.shift_closings(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists shift_closings_store_date_idx
on public.shift_closings(store_id, business_date, finalized_at desc)
where deleted_at is null;

drop trigger if exists trg_shift_closings_touch_row on public.shift_closings;
create trigger trg_shift_closings_touch_row
before update on public.shift_closings
for each row execute function public.ldm_touch_row();

-- Cash movements sekarang dapat dikunci ke Closing Shift cloud.
alter table public.cash_movements
add column if not exists closing_id uuid
    references public.shift_closings(id)
    on delete restrict;

create index if not exists cash_movements_closing_idx
on public.cash_movements(closing_id)
where closing_id is not null;

-- ----------------------------------------------------------------
-- END OF DAY CLOUD
-- ----------------------------------------------------------------
create table if not exists public.end_of_day_closings (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    business_date date not null,

    system_net_sales numeric(16,2) not null default 0,
    closing_net_sales numeric(16,2) not null default 0,
    sales_difference numeric(16,2) not null default 0,

    cash_sales numeric(16,2) not null default 0,
    noncash_sales numeric(16,2) not null default 0,
    cash_in numeric(16,2) not null default 0,
    cash_out numeric(16,2) not null default 0,
    expected_cash numeric(16,2) not null default 0,
    physical_cash numeric(16,2) not null default 0,
    cash_difference numeric(16,2) not null default 0,
    opening_cash numeric(16,2) not null default 0,
    operating_expense_total numeric(16,2) not null default 0,
    closing_count integer not null default 0,

    note text,
    accounts_snapshot jsonb not null default '[]'::jsonb,
    status text not null default 'FINAL'
        check (status in ('FINAL','VOIDED')),

    finalized_by uuid not null references auth.users(id) on delete restrict,
    finalized_username text not null,
    finalized_role text not null,
    finalized_at timestamptz not null default now(),

    voided_by uuid references auth.users(id),
    voided_username text,
    voided_at timestamptz,
    void_reason text,

    legacy_imported boolean not null default false,
    legacy_source_id text,
    snapshot jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists eod_final_store_date_unique
on public.end_of_day_closings(store_id, business_date)
where status = 'FINAL' and deleted_at is null;

create unique index if not exists eod_legacy_unique
on public.end_of_day_closings(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists eod_store_date_idx
on public.end_of_day_closings(store_id, business_date desc, finalized_at desc)
where deleted_at is null;

drop trigger if exists trg_eod_touch_row on public.end_of_day_closings;
create trigger trg_eod_touch_row
before update on public.end_of_day_closings
for each row execute function public.ldm_touch_row();

-- ----------------------------------------------------------------
-- OPERATING EXPENSE CLOUD
-- Dashboard profit membutuhkan sumber biaya yang sama di semua device.
-- ----------------------------------------------------------------
create table if not exists public.operating_expenses (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    client_expense_id uuid,
    business_date date not null,
    occurred_at timestamptz not null default now(),

    description text not null,
    category text,
    target text,
    reference text,
    amount numeric(16,2) not null check (amount > 0),

    receipt_path text,
    receipt_name text,
    receipt_original_size bigint not null default 0,

    created_by uuid not null references auth.users(id) on delete restrict,
    created_username text not null,
    created_role text not null,

    legacy_imported boolean not null default false,
    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists operating_expenses_client_unique
on public.operating_expenses(store_id, client_expense_id)
where client_expense_id is not null;

create unique index if not exists operating_expenses_legacy_unique
on public.operating_expenses(store_id, legacy_source_id)
where legacy_source_id is not null;

create index if not exists operating_expenses_store_date_idx
on public.operating_expenses(store_id, business_date, occurred_at desc)
where deleted_at is null;

drop trigger if exists trg_operating_expenses_touch_row on public.operating_expenses;
create trigger trg_operating_expenses_touch_row
before update on public.operating_expenses
for each row execute function public.ldm_touch_row();

-- ----------------------------------------------------------------
-- LEGACY TRANSACTIONS HISTORY ONLY
-- Pre-Tahap-8 reports can be shared across devices without reapplying stock.
-- ----------------------------------------------------------------
create table if not exists public.legacy_transactions (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    legacy_source_id text not null,
    transaction_code text not null,
    business_date date not null,
    cashier_username text,
    shift_label text,
    payment_method text,
    grand_total numeric(16,2) not null default 0,
    payload jsonb not null,
    imported_by uuid not null references auth.users(id) on delete restrict,
    imported_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists legacy_transactions_source_unique
on public.legacy_transactions(store_id, legacy_source_id)
where deleted_at is null;

create index if not exists legacy_transactions_store_date_idx
on public.legacy_transactions(store_id, business_date desc, imported_at desc)
where deleted_at is null;

-- ----------------------------------------------------------------
-- Private receipt bucket
-- ----------------------------------------------------------------
insert into storage.buckets(
    id, name, public, file_size_limit, allowed_mime_types
)
values (
    'ldm-expense-receipts',
    'ldm-expense-receipts',
    false,
    5242880,
    array['image/jpeg','image/png','image/webp']
)
on conflict (id)
do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------
-- RLS / privileges
-- ----------------------------------------------------------------
alter table public.shift_closings enable row level security;
alter table public.end_of_day_closings enable row level security;
alter table public.operating_expenses enable row level security;
alter table public.legacy_transactions enable row level security;

revoke all on public.shift_closings from anon;
revoke all on public.end_of_day_closings from anon;
revoke all on public.operating_expenses from anon;
revoke all on public.legacy_transactions from anon;

revoke insert, update, delete on public.shift_closings from authenticated;
revoke insert, update, delete on public.end_of_day_closings from authenticated;
revoke insert, update, delete on public.operating_expenses from authenticated;
revoke insert, update, delete on public.legacy_transactions from authenticated;

grant select on public.shift_closings to authenticated;
grant select on public.end_of_day_closings to authenticated;
grant select on public.operating_expenses to authenticated;
grant select on public.legacy_transactions to authenticated;

drop policy if exists shift_closings_select_store on public.shift_closings;
create policy shift_closings_select_store
on public.shift_closings for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists eod_select_store on public.end_of_day_closings;
create policy eod_select_store
on public.end_of_day_closings for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists operating_expenses_select_store on public.operating_expenses;
create policy operating_expenses_select_store
on public.operating_expenses for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists legacy_transactions_select_store on public.legacy_transactions;
create policy legacy_transactions_select_store
on public.legacy_transactions for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and (
        public.ldm_current_role() in ('owner','admin')
        or lower(coalesce(cashier_username,'')) = lower(public.ldm_current_username())
    )
);

-- Storage path: store_id/user_id/YYYY-MM-DD/file.jpg
-- Owner/Admin can upload; Owner/Admin same store can read.
drop policy if exists ldm_expense_receipts_insert on storage.objects;
create policy ldm_expense_receipts_insert
on storage.objects for insert to authenticated
with check (
    bucket_id = 'ldm-expense-receipts'
    and (storage.foldername(name))[1] = public.ldm_current_store_id()::text
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists ldm_expense_receipts_select on storage.objects;
create policy ldm_expense_receipts_select
on storage.objects for select to authenticated
using (
    bucket_id = 'ldm-expense-receipts'
    and (storage.foldername(name))[1] = public.ldm_current_store_id()::text
    and public.ldm_current_role() in ('owner','admin')
);

drop policy if exists ldm_expense_receipts_delete on storage.objects;
create policy ldm_expense_receipts_delete
on storage.objects for delete to authenticated
using (
    bucket_id = 'ldm-expense-receipts'
    and (storage.foldername(name))[1] = public.ldm_current_store_id()::text
    and public.ldm_current_role() = 'owner'
);

-- ----------------------------------------------------------------
-- Helper: timezone/date for current store
-- ----------------------------------------------------------------
create or replace function public.ldm_store_timezone()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(nullif(s.timezone,''),'Asia/Makassar')
    from public.stores s
    where s.id = public.ldm_current_store_id()
      and s.deleted_at is null
    limit 1;
$$;

revoke all on function public.ldm_store_timezone() from public, anon;
grant execute on function public.ldm_store_timezone() to authenticated;

-- ----------------------------------------------------------------
-- Manual cash movement
-- ----------------------------------------------------------------
create or replace function public.ldm_add_manual_cash_movement(
    p_username text,
    p_shift_label text,
    p_direction text,
    p_amount numeric,
    p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_timezone text := public.ldm_store_timezone();
    v_today date;
    v_user_id uuid;
    v_attendance_id uuid;
    v_source uuid := gen_random_uuid();
    v_id uuid;
begin
    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat membuat Mutasi Kas.';
    end if;

    if btrim(coalesce(p_shift_label,'')) not in ('Shift 1','Shift 2','Full Day') then
        raise exception 'Shift label tidak valid.';
    end if;

    if lower(btrim(coalesce(p_direction,''))) not in ('in','out') then
        raise exception 'Arah Mutasi Kas tidak valid.';
    end if;

    if coalesce(p_amount,0) <= 0 then
        raise exception 'Nominal Mutasi Kas harus lebih dari 0.';
    end if;

    if nullif(btrim(coalesce(p_note,'')),'') is null then
        raise exception 'Keterangan Mutasi Kas wajib diisi.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    select p.id into v_user_id
    from public.profiles p
    where p.store_id = v_store_id
      and lower(p.username) = lower(btrim(p_username))
      and p.active = true
      and p.deleted_at is null
    limit 1;

    if v_user_id is null then
        raise exception 'Profile kasir % tidak ditemukan.', p_username;
    end if;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_today
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'End of Day sudah FINAL. Mutasi Kas baru ditolak.';
    end if;

    if exists (
        select 1 from public.shift_closings c
        where c.store_id=v_store_id and c.business_date=v_today
          and lower(c.cashier_username)=lower(btrim(p_username))
          and c.shift_label=btrim(p_shift_label)
          and c.status='FINAL' and c.deleted_at is null
    ) then
        raise exception 'Closing Shift sudah FINAL. Mutasi Kas baru ditolak.';
    end if;

    select a.id into v_attendance_id
    from public.attendance a
    where a.store_id=v_store_id
      and a.user_id=v_user_id
      and a.attendance_date=v_today
      and a.attendance_type='Masuk'
      and a.shift_label=btrim(p_shift_label)
      and a.deleted_at is null
    order by a.recorded_at desc
    limit 1;

    insert into public.cash_movements(
        store_id,direction,amount,user_id,username_snapshot,
        attendance_id,shift_label,source_type,source_id,
        reference_code,note,created_by,occurred_at
    ) values (
        v_store_id,lower(btrim(p_direction)),p_amount,v_user_id,btrim(p_username),
        v_attendance_id,btrim(p_shift_label),'manual_closing',v_source::text,
        'MUT-'||upper(substr(replace(v_source::text,'-',''),1,8)),btrim(p_note),auth.uid(),now()
    ) returning id into v_id;

    return jsonb_build_object('id',v_id,'status','active');
end;
$$;

revoke all on function public.ldm_add_manual_cash_movement(text,text,text,numeric,text) from public,anon;
grant execute on function public.ldm_add_manual_cash_movement(text,text,text,numeric,text) to authenticated;

create or replace function public.ldm_reverse_manual_cash_movement(
    p_movement_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_row public.cash_movements%rowtype;
begin
    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat membatalkan Mutasi Kas manual.';
    end if;

    select * into strict v_row
    from public.cash_movements m
    where m.id=p_movement_id and m.store_id=v_store_id
    for update;

    if v_row.source_type <> 'manual_closing' then
        raise exception 'Hanya Mutasi Kas manual yang dapat dibatalkan dari halaman Closing.';
    end if;

    if v_row.closing_id is not null then
        raise exception 'Mutasi Kas sudah terkunci pada Closing Shift.';
    end if;

    if v_row.status='reversed' then
        return jsonb_build_object('id',v_row.id,'status','reversed','already_reversed',true);
    end if;

    update public.cash_movements
       set status='reversed', reversed_at=now(), reversed_by=auth.uid(),
           reverse_reason=coalesce(nullif(btrim(p_reason),''),'Dibatalkan dari Closing Shift')
     where id=v_row.id;

    return jsonb_build_object('id',v_row.id,'status','reversed','already_reversed',false);
end;
$$;

revoke all on function public.ldm_reverse_manual_cash_movement(uuid,text) from public,anon;
grant execute on function public.ldm_reverse_manual_cash_movement(uuid,text) to authenticated;

-- ----------------------------------------------------------------
-- Create Closing Shift server-side
-- ----------------------------------------------------------------
create or replace function public.ldm_finalize_shift_closing(
    p_cashier_username text,
    p_shift_label text,
    p_opening_cash numeric,
    p_physical_cash numeric,
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
    v_cashier_id uuid;
    v_attendance_id uuid;
    v_gross numeric(16,2) := 0;
    v_returns numeric(16,2) := 0;
    v_cash numeric(16,2) := 0;
    v_noncash numeric(16,2) := 0;
    v_cash_in numeric(16,2) := 0;
    v_cash_out numeric(16,2) := 0;
    v_expected numeric(16,2) := 0;
    v_physical numeric(16,2) := greatest(coalesce(p_physical_cash,0),0);
    v_opening numeric(16,2) := greatest(coalesce(p_opening_cash,0),0);
    v_count integer := 0;
    v_id uuid;
begin
    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat Closing Shift.';
    end if;

    if btrim(coalesce(p_shift_label,'')) not in ('Shift 1','Shift 2','Full Day') then
        raise exception 'Shift label tidak valid.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    select p.id into v_cashier_id
    from public.profiles p
    where p.store_id=v_store_id
      and lower(p.username)=lower(btrim(p_cashier_username))
      and p.active=true and p.deleted_at is null
    limit 1;

    if v_cashier_id is null then
        raise exception 'Profile kasir % tidak ditemukan.', p_cashier_username;
    end if;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_today
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'End of Day hari ini sudah FINAL.';
    end if;

    if exists (
        select 1 from public.shift_closings c
        where c.store_id=v_store_id and c.business_date=v_today
          and lower(c.cashier_username)=lower(btrim(p_cashier_username))
          and c.shift_label=btrim(p_shift_label)
          and c.status='FINAL' and c.deleted_at is null
    ) then
        raise exception 'Closing Shift untuk akun/shift ini sudah ada.';
    end if;

    select a.id into v_attendance_id
    from public.attendance a
    where a.store_id=v_store_id and a.user_id=v_cashier_id
      and a.attendance_date=v_today and a.attendance_type='Masuk'
      and a.shift_label=btrim(p_shift_label) and a.deleted_at is null
    order by a.recorded_at desc limit 1;

    if v_attendance_id is null then
        raise exception 'Absen Masuk cloud untuk akun dan shift ini tidak ditemukan.';
    end if;

    select
        coalesce(sum(t.grand_total),0),
        coalesce(sum(t.cash_amount),0),
        coalesce(sum(t.qris_amount),0),
        count(*)::integer
    into v_gross,v_cash,v_noncash,v_count
    from public.transactions t
    where t.store_id=v_store_id
      and t.cashier_user_id=v_cashier_id
      and t.business_date=v_today
      and t.shift_label=btrim(p_shift_label)
      and t.status='completed';

    select coalesce(sum(r.total_refund),0)
      into v_returns
    from public.sales_returns r
    where r.store_id=v_store_id
      and r.status='APPROVED'
      and r.refund_user_id=v_cashier_id
      and r.refund_shift_label=btrim(p_shift_label)
      and (r.approved_at at time zone v_timezone)::date=v_today
      and r.deleted_at is null;

    select
        coalesce(sum(case when m.direction='in' then m.amount else 0 end),0),
        coalesce(sum(case when m.direction='out' then m.amount else 0 end),0)
    into v_cash_in,v_cash_out
    from public.cash_movements m
    where m.store_id=v_store_id
      and m.user_id=v_cashier_id
      and m.shift_label=btrim(p_shift_label)
      and m.status='active'
      and (m.occurred_at at time zone v_timezone)::date=v_today;

    v_expected := v_cash + v_cash_in - v_cash_out;

    insert into public.shift_closings(
        store_id,business_date,cashier_user_id,cashier_username,
        attendance_id,shift_label,opening_cash,gross_sales,approved_returns,
        net_sales,cash_sales,noncash_sales,cash_in,cash_out,expected_cash,
        physical_cash,cash_difference,transaction_count,note,status,
        finalized_by,finalized_username,finalized_role,finalized_at,snapshot
    ) values (
        v_store_id,v_today,v_cashier_id,btrim(p_cashier_username),
        v_attendance_id,btrim(p_shift_label),v_opening,v_gross,v_returns,
        v_gross-v_returns,v_cash,v_noncash,v_cash_in,v_cash_out,v_expected,
        v_physical,v_physical-v_expected,v_count,nullif(btrim(coalesce(p_note,'')),''),'FINAL',
        auth.uid(),coalesce(v_username,'-'),v_role,now(),
        jsonb_build_object(
            'version',12,
            'server_calculated',true,
            'gross_sales',v_gross,
            'returns',v_returns,
            'cash_sales',v_cash,
            'noncash_sales',v_noncash,
            'cash_in',v_cash_in,
            'cash_out',v_cash_out
        )
    ) returning id into v_id;

    update public.cash_movements
       set closing_id=v_id
     where store_id=v_store_id
       and user_id=v_cashier_id
       and shift_label=btrim(p_shift_label)
       and status='active'
       and closing_id is null
       and (occurred_at at time zone v_timezone)::date=v_today;

    return jsonb_build_object(
        'id',v_id,'business_date',v_today,'cashier_username',btrim(p_cashier_username),
        'shift_label',btrim(p_shift_label),'gross_sales',v_gross,
        'approved_returns',v_returns,'net_sales',v_gross-v_returns,
        'cash_sales',v_cash,'noncash_sales',v_noncash,
        'cash_in',v_cash_in,'cash_out',v_cash_out,
        'expected_cash',v_expected,'physical_cash',v_physical,
        'cash_difference',v_physical-v_expected,'status','FINAL'
    );
end;
$$;

revoke all on function public.ldm_finalize_shift_closing(text,text,numeric,numeric,text) from public,anon;
grant execute on function public.ldm_finalize_shift_closing(text,text,numeric,numeric,text) to authenticated;

create or replace function public.ldm_void_shift_closing(
    p_closing_id uuid,
    p_reason text default null
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
    v_row public.shift_closings%rowtype;
begin
    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat membatalkan Closing Shift.';
    end if;

    select * into strict v_row
    from public.shift_closings c
    where c.id=p_closing_id and c.store_id=v_store_id and c.deleted_at is null
    for update;

    if v_row.status='VOIDED' then
        return jsonb_build_object('id',v_row.id,'status','VOIDED','already_voided',true);
    end if;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_row.business_date
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'Closing Shift terkunci karena End of Day sudah FINAL.';
    end if;

    update public.shift_closings
       set status='VOIDED',voided_by=auth.uid(),voided_username=coalesce(v_username,'-'),
           voided_at=now(),void_reason=coalesce(nullif(btrim(p_reason),''),'Dibatalkan Owner')
     where id=v_row.id;

    update public.cash_movements
       set closing_id=null
     where closing_id=v_row.id and status='active';

    return jsonb_build_object('id',v_row.id,'status','VOIDED','already_voided',false);
end;
$$;

revoke all on function public.ldm_void_shift_closing(uuid,text) from public,anon;
grant execute on function public.ldm_void_shift_closing(uuid,text) to authenticated;

-- ----------------------------------------------------------------
-- Operating expense write RPCs
-- ----------------------------------------------------------------
create or replace function public.ldm_save_operating_expense(
    p_client_expense_id uuid,
    p_business_date date,
    p_description text,
    p_category text,
    p_target text,
    p_reference text,
    p_amount numeric,
    p_receipt_path text,
    p_receipt_name text,
    p_receipt_original_size bigint
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
    v_id uuid;
begin
    if v_role not in ('owner','admin') then
        raise exception 'Hanya Owner/Admin yang dapat menyimpan Pengeluaran.';
    end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then
        raise exception 'Keterangan Pengeluaran wajib diisi.';
    end if;
    if coalesce(p_amount,0) <= 0 then
        raise exception 'Nominal Pengeluaran harus lebih dari 0.';
    end if;
    if p_business_date is null then
        raise exception 'Tanggal Pengeluaran wajib diisi.';
    end if;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=p_business_date
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'Tanggal % sudah memiliki End of Day FINAL.',p_business_date;
    end if;

    insert into public.operating_expenses(
        store_id,client_expense_id,business_date,occurred_at,
        description,category,target,reference,amount,
        receipt_path,receipt_name,receipt_original_size,
        created_by,created_username,created_role
    ) values (
        v_store_id,coalesce(p_client_expense_id,gen_random_uuid()),p_business_date,now(),
        btrim(p_description),nullif(btrim(coalesce(p_category,'')),''),
        nullif(btrim(coalesce(p_target,'')),''),nullif(btrim(coalesce(p_reference,'')),''),p_amount,
        nullif(btrim(coalesce(p_receipt_path,'')),''),nullif(btrim(coalesce(p_receipt_name,'')),''),
        greatest(coalesce(p_receipt_original_size,0),0),
        auth.uid(),coalesce(v_username,'-'),v_role
    )
    on conflict (store_id,client_expense_id)
    where client_expense_id is not null
    do update set
        description=excluded.description,category=excluded.category,target=excluded.target,
        reference=excluded.reference,amount=excluded.amount,
        receipt_path=excluded.receipt_path,receipt_name=excluded.receipt_name,
        receipt_original_size=excluded.receipt_original_size
    returning id into v_id;

    return jsonb_build_object('id',v_id,'status','saved');
end;
$$;

revoke all on function public.ldm_save_operating_expense(uuid,date,text,text,text,text,numeric,text,text,bigint) from public,anon;
grant execute on function public.ldm_save_operating_expense(uuid,date,text,text,text,text,numeric,text,text,bigint) to authenticated;

create or replace function public.ldm_soft_delete_operating_expense(
    p_expense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_row public.operating_expenses%rowtype;
begin
    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus Pengeluaran.';
    end if;

    select * into strict v_row
    from public.operating_expenses x
    where x.id=p_expense_id and x.store_id=v_store_id and x.deleted_at is null
    for update;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_row.business_date
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'Pengeluaran terkunci karena End of Day tanggal tersebut sudah FINAL.';
    end if;

    update public.operating_expenses
       set deleted_at=now(),deleted_by=auth.uid()
     where id=v_row.id;

    return jsonb_build_object('id',v_row.id,'receipt_path',v_row.receipt_path,'deleted',true);
end;
$$;

revoke all on function public.ldm_soft_delete_operating_expense(uuid) from public,anon;
grant execute on function public.ldm_soft_delete_operating_expense(uuid) to authenticated;

-- ----------------------------------------------------------------
-- End of Day server finalization
-- ----------------------------------------------------------------
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
    v_has1 boolean;
    v_has2 boolean;
    v_missing text;
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
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_today
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'End of Day hari ini sudah FINAL.';
    end if;

    select
        exists(select 1 from public.shift_closings c where c.store_id=v_store_id and c.business_date=v_today and c.status='FINAL' and c.shift_label='Shift 1' and c.deleted_at is null),
        exists(select 1 from public.shift_closings c where c.store_id=v_store_id and c.business_date=v_today and c.status='FINAL' and c.shift_label='Shift 2' and c.deleted_at is null)
    into v_has1,v_has2;

    if not v_has1 or not v_has2 then
        raise exception 'EOD belum siap: Shift 1 dan Shift 2 harus tersedia.';
    end if;

    select string_agg(x.cashier_username,', ')
      into v_missing
    from (
        select distinct t.cashier_user_id,t.cashier_username
        from public.transactions t
        where t.store_id=v_store_id and t.business_date=v_today and t.status='completed'
    ) x
    where not exists (
        select 1 from public.shift_closings c
        where c.store_id=v_store_id and c.business_date=v_today
          and c.cashier_user_id=x.cashier_user_id
          and c.status='FINAL' and c.deleted_at is null
    );

    if v_missing is not null then
        raise exception 'EOD belum siap. Belum Closing: %',v_missing;
    end if;

    select coalesce(sum(t.grand_total),0)
      into v_system_gross
    from public.transactions t
    where t.store_id=v_store_id and t.business_date=v_today and t.status='completed';

    select coalesce(sum(r.total_refund),0)
      into v_returns
    from public.sales_returns r
    where r.store_id=v_store_id and r.status='APPROVED' and r.deleted_at is null
      and (r.approved_at at time zone v_timezone)::date=v_today;

    v_system_net := v_system_gross - v_returns;

    -- Avoid double count Full Day for a user that also has Shift 1/2.
    with final_closing as (
        select c.*
        from public.shift_closings c
        where c.store_id=v_store_id and c.business_date=v_today
          and c.status='FINAL' and c.deleted_at is null
    ), selected as (
        select c.* from final_closing c
        where c.shift_label in ('Shift 1','Shift 2')
        union all
        select c.* from final_closing c
        where c.shift_label='Full Day'
          and not exists (
              select 1 from final_closing n
              where n.cashier_user_id=c.cashier_user_id
                and n.shift_label in ('Shift 1','Shift 2')
          )
    )
    select
        coalesce(sum(net_sales),0),coalesce(sum(cash_sales),0),coalesce(sum(noncash_sales),0),
        coalesce(sum(cash_in),0),coalesce(sum(cash_out),0),coalesce(sum(expected_cash),0),
        coalesce(sum(physical_cash),0),coalesce(sum(opening_cash),0),count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
            'id',id,'cashier',cashier_username,'shift',shift_label,'net_sales',net_sales,
            'cash_sales',cash_sales,'noncash_sales',noncash_sales,'expected_cash',expected_cash,
            'physical_cash',physical_cash,'cash_difference',cash_difference
        ) order by cashier_username,shift_label),'[]'::jsonb)
    into v_close_sales,v_cash,v_noncash,v_in,v_out,v_expected,v_physical,v_opening,v_count,v_accounts
    from selected;

    select coalesce(sum(x.amount),0)
      into v_expenses
    from public.operating_expenses x
    where x.store_id=v_store_id and x.business_date=v_today and x.deleted_at is null;

    if ((v_physical-v_expected) <> 0 or (v_close_sales-v_system_net) <> 0)
       and nullif(btrim(coalesce(p_note,'')),'') is null then
        raise exception 'Ada selisih tunai/omzet. Catatan wajib diisi.';
    end if;

    insert into public.end_of_day_closings(
        store_id,business_date,system_net_sales,closing_net_sales,sales_difference,
        cash_sales,noncash_sales,cash_in,cash_out,expected_cash,physical_cash,
        cash_difference,opening_cash,operating_expense_total,closing_count,note,
        accounts_snapshot,status,finalized_by,finalized_username,finalized_role,finalized_at,snapshot
    ) values (
        v_store_id,v_today,v_system_net,v_close_sales,v_close_sales-v_system_net,
        v_cash,v_noncash,v_in,v_out,v_expected,v_physical,v_physical-v_expected,
        v_opening,v_expenses,v_count,nullif(btrim(coalesce(p_note,'')),''),
        v_accounts,'FINAL',auth.uid(),coalesce(v_username,'-'),v_role,now(),
        jsonb_build_object('version',12,'server_calculated',true,'gross_sales',v_system_gross,'approved_returns',v_returns)
    ) returning id into v_id;

    return jsonb_build_object(
        'id',v_id,'business_date',v_today,'system_net_sales',v_system_net,
        'closing_net_sales',v_close_sales,'sales_difference',v_close_sales-v_system_net,
        'expected_cash',v_expected,'physical_cash',v_physical,
        'cash_difference',v_physical-v_expected,'operating_expense_total',v_expenses,
        'closing_count',v_count,'status','FINAL'
    );
end;
$$;

revoke all on function public.ldm_finalize_end_of_day(text) from public,anon;
grant execute on function public.ldm_finalize_end_of_day(text) to authenticated;

create or replace function public.ldm_void_end_of_day(
    p_eod_id uuid,
    p_reason text default null
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
    v_row public.end_of_day_closings%rowtype;
begin
    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat membatalkan End of Day.';
    end if;

    select * into strict v_row
    from public.end_of_day_closings e
    where e.id=p_eod_id and e.store_id=v_store_id and e.deleted_at is null
    for update;

    if v_row.status='VOIDED' then
        return jsonb_build_object('id',v_row.id,'status','VOIDED','already_voided',true);
    end if;

    update public.end_of_day_closings
       set status='VOIDED',voided_by=auth.uid(),voided_username=coalesce(v_username,'-'),
           voided_at=now(),void_reason=coalesce(nullif(btrim(p_reason),''),'Dibatalkan Owner')
     where id=v_row.id;

    return jsonb_build_object('id',v_row.id,'status','VOIDED','already_voided',false);
end;
$$;

revoke all on function public.ldm_void_end_of_day(uuid,text) from public,anon;
grant execute on function public.ldm_void_end_of_day(uuid,text) to authenticated;

-- ----------------------------------------------------------------
-- Safe transaction void used by Tahap 12 reporting.
-- Old direct ldm_void_sale execute is revoked from browser.
-- ----------------------------------------------------------------
create or replace function public.ldm_reporting_void_sale(
    p_transaction_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_tx public.transactions%rowtype;
begin
    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat void transaksi cloud.';
    end if;

    select * into strict v_tx
    from public.transactions t
    where t.id=p_transaction_id and t.store_id=v_store_id
    for update;

    if exists (
        select 1 from public.sales_returns r
        where r.store_id=v_store_id and r.transaction_id=v_tx.id
          and r.status in ('PENDING','APPROVED') and r.deleted_at is null
    ) then
        raise exception 'Transaksi memiliki Retur PENDING/APPROVED. Selesaikan atau batalkan Retur terlebih dahulu.';
    end if;

    if exists (
        select 1 from public.shift_closings c
        where c.store_id=v_store_id and c.business_date=v_tx.business_date
          and c.cashier_user_id=v_tx.cashier_user_id
          and c.shift_label=v_tx.shift_label
          and c.status='FINAL' and c.deleted_at is null
    ) then
        raise exception 'Transaksi terkunci karena sudah masuk Closing Shift FINAL.';
    end if;

    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=v_store_id and e.business_date=v_tx.business_date
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'Transaksi terkunci karena End of Day sudah FINAL.';
    end if;

    return public.ldm_void_sale(v_tx.id,p_reason);
end;
$$;

revoke all on function public.ldm_reporting_void_sale(uuid,text) from public,anon;
grant execute on function public.ldm_reporting_void_sale(uuid,text) to authenticated;
revoke execute on function public.ldm_void_sale(uuid,text) from authenticated;

-- ----------------------------------------------------------------
-- Guards so closed financial periods cannot silently change.
-- ----------------------------------------------------------------
create or replace function public.ldm_guard_transaction_after_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if exists (
        select 1 from public.end_of_day_closings e
        where e.store_id=new.store_id and e.business_date=new.business_date
          and e.status='FINAL' and e.deleted_at is null
    ) then
        raise exception 'Transaksi ditolak: End of Day tanggal ini sudah FINAL.';
    end if;

    if exists (
        select 1 from public.shift_closings c
        where c.store_id=new.store_id and c.business_date=new.business_date
          and c.cashier_user_id=new.cashier_user_id
          and c.shift_label=new.shift_label
          and c.status='FINAL' and c.deleted_at is null
    ) then
        raise exception 'Transaksi ditolak: Closing Shift akun ini sudah FINAL.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_zz_transactions_guard_financial_close on public.transactions;
create trigger trg_zz_transactions_guard_financial_close
before insert on public.transactions
for each row execute function public.ldm_guard_transaction_after_close();

create or replace function public.ldm_guard_cash_movement_after_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_timezone text;
    v_date date;
begin
    select coalesce(nullif(s.timezone,''),'Asia/Makassar') into v_timezone
    from public.stores s where s.id=new.store_id limit 1;
    v_date := (new.occurred_at at time zone v_timezone)::date;

    if tg_op='INSERT' then
        if new.user_id is not null and new.shift_label is not null and exists (
            select 1 from public.shift_closings c
            where c.store_id=new.store_id and c.business_date=v_date
              and c.cashier_user_id=new.user_id and c.shift_label=new.shift_label
              and c.status='FINAL' and c.deleted_at is null
        ) then
            raise exception 'Mutasi Kas ditolak: Closing Shift sudah FINAL.';
        end if;
        if exists (
            select 1 from public.end_of_day_closings e
            where e.store_id=new.store_id and e.business_date=v_date
              and e.status='FINAL' and e.deleted_at is null
        ) then
            raise exception 'Mutasi Kas ditolak: End of Day sudah FINAL.';
        end if;
    elsif tg_op='UPDATE' then
        if old.closing_id is not null and new.status is distinct from old.status then
            raise exception 'Mutasi Kas terkunci pada Closing Shift FINAL.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_cash_movements_guard_financial_close on public.cash_movements;
create trigger trg_cash_movements_guard_financial_close
before insert or update on public.cash_movements
for each row execute function public.ldm_guard_cash_movement_after_close();

create or replace function public.ldm_guard_return_approval_after_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_timezone text;
    v_date date;
begin
    if (
        (new.status='APPROVED' and old.status is distinct from new.status)
        or
        (old.status='APPROVED' and new.status is distinct from old.status)
    ) then
        select coalesce(nullif(s.timezone,''),'Asia/Makassar') into v_timezone
        from public.stores s where s.id=new.store_id limit 1;
        v_date := (coalesce(old.approved_at,new.approved_at,now()) at time zone v_timezone)::date;

        if coalesce(new.refund_user_id,old.refund_user_id) is not null
           and coalesce(new.refund_shift_label,old.refund_shift_label) is not null
           and exists (
            select 1 from public.shift_closings c
            where c.store_id=new.store_id and c.business_date=v_date
              and c.cashier_user_id=coalesce(new.refund_user_id,old.refund_user_id)
              and c.shift_label=coalesce(new.refund_shift_label,old.refund_shift_label)
              and c.status='FINAL' and c.deleted_at is null
        ) then
            raise exception 'Perubahan Retur ditolak: Closing Shift refund sudah FINAL.';
        end if;
        if exists (
            select 1 from public.end_of_day_closings e
            where e.store_id=new.store_id and e.business_date=v_date
              and e.status='FINAL' and e.deleted_at is null
        ) then
            raise exception 'Perubahan Retur ditolak: End of Day sudah FINAL.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_sales_returns_guard_financial_close on public.sales_returns;
create trigger trg_sales_returns_guard_financial_close
before update on public.sales_returns
for each row execute function public.ldm_guard_return_approval_after_close();

-- ----------------------------------------------------------------
-- Legacy migrations: HISTORY ONLY, no stock effects.
-- ----------------------------------------------------------------
create or replace function public.ldm_import_legacy_transactions(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
    v_store_id uuid:=public.ldm_current_store_id();
    v_role text:=public.ldm_current_role();
    v jsonb; v_count integer:=0; v_source text; v_code text; v_date date;
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi transaksi legacy.'; end if;
    if jsonb_typeof(p_rows)<>'array' then raise exception 'Payload harus JSON array.'; end if;
    for v in select value from jsonb_array_elements(p_rows) loop
        v_source:=coalesce(nullif(btrim(v->>'legacy_source_id'),''),'laporan:'||md5(v::text));
        v_code:=coalesce(nullif(btrim(v->>'transaction_code'),''),'LEGACY-'||upper(substr(md5(v::text),1,10)));
        v_date:=(v->>'business_date')::date;
        insert into public.legacy_transactions(
            store_id,legacy_source_id,transaction_code,business_date,cashier_username,
            shift_label,payment_method,grand_total,payload,imported_by
        ) values (
            v_store_id,v_source,v_code,v_date,v->>'cashier_username',v->>'shift_label',
            v->>'payment_method',greatest(coalesce((v->>'grand_total')::numeric,0),0),v->'payload',auth.uid()
        ) on conflict (store_id,legacy_source_id) where deleted_at is null do nothing;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;$$;
revoke all on function public.ldm_import_legacy_transactions(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_transactions(jsonb) to authenticated;

create or replace function public.ldm_soft_delete_legacy_transaction(p_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_store_id uuid:=public.ldm_current_store_id(); v_role text:=public.ldm_current_role();
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat mengarsipkan transaksi legacy.'; end if;
    update public.legacy_transactions set deleted_at=now(),deleted_by=auth.uid()
    where id=p_id and store_id=v_store_id and deleted_at is null;
    if not found then raise exception 'Transaksi legacy tidak ditemukan.'; end if;
    return jsonb_build_object('id',p_id,'deleted',true);
end;$$;
revoke all on function public.ldm_soft_delete_legacy_transaction(uuid) from public,anon;
grant execute on function public.ldm_soft_delete_legacy_transaction(uuid) to authenticated;

create or replace function public.ldm_import_legacy_shift_closings(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
    v_store_id uuid:=public.ldm_current_store_id(); v_role text:=public.ldm_current_role();
    v jsonb; v_count integer:=0; v_user_id uuid; v_source text;
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi Closing legacy.'; end if;
    if jsonb_typeof(p_rows)<>'array' then raise exception 'Payload harus JSON array.'; end if;
    for v in select value from jsonb_array_elements(p_rows) loop
        select p.id into v_user_id from public.profiles p
        where p.store_id=v_store_id and lower(p.username)=lower(btrim(v->>'cashier_username'))
          and p.deleted_at is null limit 1;
        v_source:=coalesce(nullif(btrim(v->>'legacy_source_id'),''),'closing:'||md5(v::text));
        insert into public.shift_closings(
            store_id,business_date,cashier_user_id,cashier_username,shift_label,
            opening_cash,gross_sales,approved_returns,net_sales,cash_sales,noncash_sales,
            cash_in,cash_out,expected_cash,physical_cash,cash_difference,transaction_count,
            note,status,finalized_by,finalized_username,finalized_role,finalized_at,
            legacy_imported,legacy_source_id,snapshot
        ) values (
            v_store_id,(v->>'business_date')::date,v_user_id,btrim(v->>'cashier_username'),
            case when v->>'shift_label' in ('Shift 1','Shift 2','Full Day') then v->>'shift_label' else 'Full Day' end,
            coalesce((v->>'opening_cash')::numeric,0),coalesce((v->>'gross_sales')::numeric,0),
            coalesce((v->>'approved_returns')::numeric,0),coalesce((v->>'net_sales')::numeric,0),
            coalesce((v->>'cash_sales')::numeric,0),coalesce((v->>'noncash_sales')::numeric,0),
            coalesce((v->>'cash_in')::numeric,0),coalesce((v->>'cash_out')::numeric,0),
            coalesce((v->>'expected_cash')::numeric,0),coalesce((v->>'physical_cash')::numeric,0),
            coalesce((v->>'cash_difference')::numeric,0),coalesce((v->>'transaction_count')::integer,0),
            v->>'note','FINAL',auth.uid(),coalesce(v->>'finalized_username',public.ldm_current_username()),
            coalesce(v->>'finalized_role','owner'),coalesce((v->>'finalized_at')::timestamptz,now()),
            true,v_source,coalesce(v->'snapshot','{}'::jsonb)
        ) on conflict do nothing;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;$$;
revoke all on function public.ldm_import_legacy_shift_closings(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_shift_closings(jsonb) to authenticated;

create or replace function public.ldm_import_legacy_eod(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_store_id uuid:=public.ldm_current_store_id(); v_role text:=public.ldm_current_role(); v jsonb; v_count integer:=0; v_source text;
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi EOD legacy.'; end if;
    if jsonb_typeof(p_rows)<>'array' then raise exception 'Payload harus JSON array.'; end if;
    for v in select value from jsonb_array_elements(p_rows) loop
        v_source:=coalesce(nullif(btrim(v->>'legacy_source_id'),''),'eod:'||md5(v::text));
        insert into public.end_of_day_closings(
            store_id,business_date,system_net_sales,closing_net_sales,sales_difference,
            cash_sales,noncash_sales,cash_in,cash_out,expected_cash,physical_cash,cash_difference,
            opening_cash,operating_expense_total,closing_count,note,accounts_snapshot,status,
            finalized_by,finalized_username,finalized_role,finalized_at,
            legacy_imported,legacy_source_id,snapshot
        ) values (
            v_store_id,(v->>'business_date')::date,coalesce((v->>'system_net_sales')::numeric,0),
            coalesce((v->>'closing_net_sales')::numeric,0),coalesce((v->>'sales_difference')::numeric,0),
            coalesce((v->>'cash_sales')::numeric,0),coalesce((v->>'noncash_sales')::numeric,0),
            coalesce((v->>'cash_in')::numeric,0),coalesce((v->>'cash_out')::numeric,0),
            coalesce((v->>'expected_cash')::numeric,0),coalesce((v->>'physical_cash')::numeric,0),
            coalesce((v->>'cash_difference')::numeric,0),coalesce((v->>'opening_cash')::numeric,0),
            coalesce((v->>'operating_expense_total')::numeric,0),coalesce((v->>'closing_count')::integer,0),
            v->>'note',coalesce(v->'accounts_snapshot','[]'::jsonb),'FINAL',auth.uid(),
            coalesce(v->>'finalized_username',public.ldm_current_username()),coalesce(v->>'finalized_role','owner'),
            coalesce((v->>'finalized_at')::timestamptz,now()),true,v_source,coalesce(v->'snapshot','{}'::jsonb)
        ) on conflict do nothing;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;$$;
revoke all on function public.ldm_import_legacy_eod(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_eod(jsonb) to authenticated;

create or replace function public.ldm_import_legacy_expenses(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_store_id uuid:=public.ldm_current_store_id(); v_role text:=public.ldm_current_role(); v jsonb; v_count integer:=0; v_source text;
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi Pengeluaran legacy.'; end if;
    if jsonb_typeof(p_rows)<>'array' then raise exception 'Payload harus JSON array.'; end if;
    for v in select value from jsonb_array_elements(p_rows) loop
        v_source:=coalesce(nullif(btrim(v->>'legacy_source_id'),''),'expense:'||md5(v::text));
        insert into public.operating_expenses(
            store_id,business_date,occurred_at,description,category,target,reference,amount,
            receipt_path,receipt_name,receipt_original_size,created_by,created_username,created_role,
            legacy_imported,legacy_source_id
        ) values (
            v_store_id,(v->>'business_date')::date,coalesce((v->>'occurred_at')::timestamptz,now()),
            btrim(v->>'description'),v->>'category',v->>'target',v->>'reference',
            greatest(coalesce((v->>'amount')::numeric,0),0.01),v->>'receipt_path',v->>'receipt_name',
            greatest(coalesce((v->>'receipt_original_size')::bigint,0),0),auth.uid(),
            coalesce(v->>'created_username',public.ldm_current_username()),coalesce(v->>'created_role','owner'),
            true,v_source
        ) on conflict (store_id,legacy_source_id) where legacy_source_id is not null do nothing;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;$$;
revoke all on function public.ldm_import_legacy_expenses(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_expenses(jsonb) to authenticated;

create or replace function public.ldm_import_legacy_cash_movements(p_rows jsonb)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
    v_store_id uuid:=public.ldm_current_store_id(); v_role text:=public.ldm_current_role();
    v_timezone text:=public.ldm_store_timezone(); v jsonb; v_count integer:=0; v_user_id uuid; v_source text;
    v_occurred timestamptz;
begin
    if v_role<>'owner' then raise exception 'Hanya Owner yang dapat migrasi Mutasi Kas legacy.'; end if;
    if jsonb_typeof(p_rows)<>'array' then raise exception 'Payload harus JSON array.'; end if;
    for v in select value from jsonb_array_elements(p_rows) loop
        select p.id into v_user_id from public.profiles p
        where p.store_id=v_store_id and lower(p.username)=lower(btrim(v->>'username'))
          and p.deleted_at is null limit 1;
        if v_user_id is null then continue; end if;
        v_source:=coalesce(nullif(btrim(v->>'legacy_source_id'),''),'legacy-cash:'||md5(v::text));
        v_occurred:=(((v->>'business_date')::date + coalesce(nullif(v->>'time','')::time,time '00:00')) at time zone v_timezone);
        insert into public.cash_movements(
            store_id,direction,amount,user_id,username_snapshot,shift_label,
            source_type,source_id,reference_code,note,status,occurred_at,created_by
        ) values (
            v_store_id,case when lower(v->>'direction')='in' then 'in' else 'out' end,
            greatest(coalesce((v->>'amount')::numeric,0),0),v_user_id,btrim(v->>'username'),
            case when v->>'shift_label' in ('Shift 1','Shift 2','Full Day') then v->>'shift_label' else null end,
            'legacy_manual_closing',v_source,v->>'reference_code',v->>'note','active',v_occurred,auth.uid()
        ) on conflict (store_id,source_type,source_id) do nothing;
        v_count:=v_count+1;
    end loop;
    return v_count;
end;$$;
revoke all on function public.ldm_import_legacy_cash_movements(jsonb) from public,anon;
grant execute on function public.ldm_import_legacy_cash_movements(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------
do $$
declare v_table text;
begin
    if exists(select 1 from pg_publication where pubname='supabase_realtime') then
        foreach v_table in array array[
            'shift_closings','end_of_day_closings','operating_expenses','legacy_transactions'
        ] loop
            if not exists(
                select 1 from pg_publication_tables
                where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
            ) then
                execute format('alter publication supabase_realtime add table public.%I',v_table);
            end if;
        end loop;
    end if;
end
$$;

-- ----------------------------------------------------------------
-- Metadata
-- ----------------------------------------------------------------
insert into public.ldm_system_meta(key,value)
values
    ('live_sync_stage','12'),
    ('schema_status','final_cloud_reporting_ready'),
    ('schema_version','12'),
    ('closing_authority','public.shift_closings'),
    ('eod_authority','public.end_of_day_closings'),
    ('reporting_sales_authority','public.transactions'),
    ('legacy_reporting_authority','public.legacy_transactions'),
    ('operating_expense_authority','public.operating_expenses'),
    ('cash_movement_authority','public.cash_movements'),
    ('reporting_cache_mode','localStorage_compatibility_cache_only'),
    ('reporting_realtime','enabled'),
    ('financial_close_guard','enabled'),
    ('shift_management','removed'),
    ('full_live_sync_core','complete')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

select * from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_status','schema_version','closing_authority','eod_authority',
    'reporting_sales_authority','legacy_reporting_authority','operating_expense_authority',
    'cash_movement_authority','reporting_cache_mode','reporting_realtime',
    'financial_close_guard','shift_management','full_live_sync_core'
)
order by key;

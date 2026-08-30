-- ================================================================
-- LocDailyMar Live Sync - TAHAP 16
-- Offline Queue + Reconnect untuk transaksi Kasir
-- Jalankan setelah Tahap 15.1
-- ================================================================

begin;

-- Jejak audit transaksi yang berasal dari antrean perangkat.
alter table public.transactions
    add column if not exists was_offline boolean not null default false,
    add column if not exists origin_client_device_id text,
    add column if not exists queued_at timestamptz,
    add column if not exists synced_at timestamptz;

create index if not exists idx_transactions_store_offline_queue
on public.transactions(store_id, queued_at desc)
where was_offline = true;

-- Tahap 9 memvalidasi absensi pada waktu INSERT. Untuk reconnect, INSERT bisa
-- terjadi setelah Kasir Absen Keluar. Trigger ini mempertahankan perilaku lama
-- untuk transaksi online, tetapi memakai queued_at ketika wrapper Tahap 16
-- menetapkan context transaction-local.
create or replace function public.ldm_require_active_attendance_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_masuk public.attendance%rowtype;
    v_keluar_at timestamptz;
    v_effective_at timestamptz;
    v_offline_queued_text text;
    v_offline_device_id text;
    v_timezone text;
begin
    v_offline_queued_text := nullif(current_setting('ldm.offline_queued_at',true),'');
    v_offline_device_id := nullif(current_setting('ldm.offline_client_device_id',true),'');

    if v_offline_queued_text is not null then
        begin
            v_effective_at := v_offline_queued_text::timestamptz;
        exception when others then
            raise exception 'OFFLINE_BLOCKED: queued_at context tidak valid.';
        end;

        select coalesce(nullif(s.timezone,''),'Asia/Makassar')
          into v_timezone
        from public.stores s
        where s.id = new.store_id
          and s.deleted_at is null
        limit 1;

        v_timezone := coalesce(v_timezone,'Asia/Makassar');
        new.business_date := (v_effective_at at time zone v_timezone)::date;
        new.transacted_at := v_effective_at;
        new.was_offline := true;
        new.origin_client_device_id := v_offline_device_id;
        new.queued_at := v_effective_at;
    else
        v_effective_at := new.transacted_at;
    end if;

    select a.*
      into v_masuk
    from public.attendance a
    where a.store_id = new.store_id
      and a.user_id = new.cashier_user_id
      and a.attendance_date = new.business_date
      and a.attendance_type = 'Masuk'
      and a.deleted_at is null
      and (
          v_offline_queued_text is null
          or a.recorded_at <= v_effective_at
      )
    order by a.recorded_at desc
    limit 1;

    if v_masuk.id is null then
        raise exception 'Checkout ditolak: Absen Masuk cloud pada waktu transaksi belum tersedia.';
    end if;

    select max(a.recorded_at)
      into v_keluar_at
    from public.attendance a
    where a.store_id = new.store_id
      and a.user_id = new.cashier_user_id
      and a.attendance_date = new.business_date
      and a.attendance_type = 'Keluar'
      and a.deleted_at is null
      and (
          v_offline_queued_text is null
          or a.recorded_at <= v_effective_at
      );

    if v_keluar_at is not null
       and v_keluar_at >= v_masuk.recorded_at then
        raise exception 'Checkout ditolak: akun sudah Absen Keluar pada waktu transaksi.';
    end if;

    new.attendance_id := v_masuk.id;

    if nullif(btrim(coalesce(new.shift_label,'')),'') is null then
        new.shift_label := v_masuk.shift_label;
    end if;

    return new;
end;
$$;

revoke all on function public.ldm_require_active_attendance_for_transaction()
from public, anon, authenticated;

-- Reconnect selalu melewati wrapper ini. Wrapper memverifikasi bahwa antrean
-- masih dimiliki user, store, dan perangkat aktif yang sama. RPC checkout lama
-- tetap menjadi satu-satunya tempat perhitungan harga + pemotongan stok atomik.
create or replace function public.ldm_sync_offline_sale(
    p_client_device_id text,
    p_queued_store_id uuid,
    p_queued_user_id uuid,
    p_queued_at timestamptz,
    p_client_transaction_id uuid,
    p_items jsonb,
    p_manual_discount numeric default 0,
    p_payment_method text default 'Tunai',
    p_cash_received numeric default 0,
    p_cash_amount numeric default 0,
    p_qris_amount numeric default 0,
    p_shift_label text default null,
    p_expected_grand_total numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_timezone text;
    v_device_id uuid;
    v_result jsonb;
    v_transaction_id uuid;
    v_server_total numeric(16,2);
    v_expected_total numeric(16,2);
    v_business_date date;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if auth.uid() is null then
        raise exception 'OFFLINE_BLOCKED: Session Auth tidak tersedia.';
    end if;

    if p_queued_user_id is distinct from auth.uid() then
        raise exception 'OFFLINE_BLOCKED: User antrean tidak sesuai dengan akun yang login.';
    end if;

    if v_store_id is null or p_queued_store_id is distinct from v_store_id then
        raise exception 'OFFLINE_BLOCKED: store_id antrean tidak sesuai dengan store akun.';
    end if;

    if v_role not in ('owner','admin','kasir') then
        raise exception 'OFFLINE_BLOCKED: Role tidak diizinkan menyinkronkan transaksi.';
    end if;

    if btrim(coalesce(p_client_device_id,'')) = '' then
        raise exception 'OFFLINE_BLOCKED: client_device_id wajib diisi.';
    end if;

    select d.id
      into v_device_id
    from public.devices d
    where d.store_id = v_store_id
      and d.user_id = auth.uid()
      and d.client_device_id = btrim(p_client_device_id)
      and d.status = 'active'
      and d.deleted_at is null
    limit 1;

    if v_device_id is null then
        raise exception 'OFFLINE_BLOCKED: Perangkat tidak aktif atau bukan milik akun/store ini.';
    end if;

    if p_queued_at is null then
        raise exception 'OFFLINE_BLOCKED: queued_at wajib diisi.';
    end if;

    if p_queued_at > now() + interval '5 minutes' then
        raise exception 'OFFLINE_BLOCKED: Waktu transaksi lebih maju dari waktu server.';
    end if;

    if p_queued_at < now() - interval '7 days' then
        raise exception 'OFFLINE_BLOCKED: Antrean lebih lama dari 7 hari dan harus diperiksa Owner.';
    end if;

    v_expected_total := round(greatest(coalesce(p_expected_grand_total,0),0),2);

    select coalesce(nullif(s.timezone,''),'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = v_store_id
      and s.deleted_at is null
    limit 1;

    v_timezone := coalesce(v_timezone,'Asia/Makassar');
    v_business_date := (p_queued_at at time zone v_timezone)::date;

    -- Trigger attendance dan financial-close membaca context ini di dalam
    -- transaction database yang sama. Nilainya hilang otomatis setelah RPC.
    perform set_config('ldm.offline_queued_at',p_queued_at::text,true);
    perform set_config('ldm.offline_client_device_id',btrim(p_client_device_id),true);

    -- Fungsi Tahap 8 bersifat idempotent berdasarkan
    -- (store_id, client_transaction_id), jadi retry tidak memotong stok dua kali.
    v_result := public.ldm_complete_sale(
        p_client_transaction_id => p_client_transaction_id,
        p_items => p_items,
        p_manual_discount => p_manual_discount,
        p_payment_method => p_payment_method,
        p_cash_received => p_cash_received,
        p_cash_amount => p_cash_amount,
        p_qris_amount => p_qris_amount,
        p_shift_label => p_shift_label
    );

    v_transaction_id := nullif(v_result ->> 'id','')::uuid;
    v_server_total := round(coalesce(nullif(v_result ->> 'grand_total','')::numeric,0),2);

    -- Harga/promo selalu dihitung ulang oleh server. Jika berubah sejak perangkat
    -- offline, seluruh call di-rollback dan antrean diberi status conflict.
    if abs(v_server_total - v_expected_total) > 0.01 then
        raise exception
            'OFFLINE_CONFLICT_TOTAL: Total lokal % berbeda dari total server %. Periksa perubahan harga/promo.',
            v_expected_total,
            v_server_total;
    end if;

    update public.transactions t
       set was_offline = true,
           origin_client_device_id = btrim(p_client_device_id),
           queued_at = coalesce(t.queued_at,p_queued_at),
           synced_at = now(),
           transacted_at = p_queued_at,
           business_date = v_business_date
     where t.id = v_transaction_id
       and t.store_id = v_store_id;

    update public.stock_movements sm
       set occurred_at = p_queued_at
     where sm.transaction_id = v_transaction_id
       and sm.store_id = v_store_id
       and sm.movement_type = 'sale';

    return v_result || jsonb_build_object(
        'offline_synced', true,
        'queued_at', p_queued_at,
        'synced_at', now(),
        'transacted_at', p_queued_at,
        'business_date', v_business_date,
        'origin_client_device_id', btrim(p_client_device_id)
    );
end;
$$;

revoke all on function public.ldm_sync_offline_sale(
    text,uuid,uuid,timestamptz,uuid,jsonb,numeric,text,numeric,numeric,numeric,text,numeric
) from public, anon;

grant execute on function public.ldm_sync_offline_sale(
    text,uuid,uuid,timestamptz,uuid,jsonb,numeric,text,numeric,numeric,numeric,text,numeric
) to authenticated;

insert into public.ldm_system_meta (key,value)
values
    ('live_sync_stage','16'),
    ('schema_version','16'),
    ('schema_status','offline_queue_reconnect_ready'),
    ('checkout_offline_mode','indexeddb_queue_idempotent_reconnect'),
    ('offline_queue_scope','sales_only'),
    ('offline_queue_max_age','7_days'),
    ('offline_lease_duration','12_hours'),
    ('offline_attendance_validation','queued_transaction_time')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

select key,value,updated_at
from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_version','schema_status','checkout_offline_mode',
    'offline_queue_scope','offline_queue_max_age','offline_lease_duration',
    'offline_attendance_validation'
)
order by key;

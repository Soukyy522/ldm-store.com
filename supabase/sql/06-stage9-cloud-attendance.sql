-- ================================================================
-- LocDailyMar - Live Sync Tahap 9
-- Cloud Attendance + Private Proof Storage + Realtime
-- TANPA SHIFT MANAGEMENT
--
-- Shift 1 / Shift 2 / Full Day hanya disimpan sebagai shift_label
-- pada presensi. Tidak ada shift_sessions / active shift state machine.
-- ================================================================

begin;

-- ------------------------------------------------
-- Foundation checks
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'public.profiles belum ada. Jalankan Tahap 4/5/6.';
    end if;

    if to_regclass('public.transactions') is null then
        raise exception 'public.transactions belum ada. Jalankan Tahap 8.';
    end if;
end
$$;

-- ------------------------------------------------
-- ATTENDANCE
-- ------------------------------------------------
create table if not exists public.attendance (
    id uuid primary key default gen_random_uuid(),

    store_id uuid not null
        references public.stores(id)
        on delete restrict,

    user_id uuid not null
        references auth.users(id)
        on delete restrict,

    username_snapshot text not null,

    attendance_date date not null,

    attendance_type text not null
        check (
            attendance_type in (
                'Masuk',
                'Keluar',
                'Sakit',
                'Izin'
            )
        ),

    -- Ini hanya label kerja, BUKAN Shift Management.
    shift_label text
        check (
            shift_label is null
            or shift_label in (
                'Shift 1',
                'Shift 2',
                'Full Day'
            )
        ),

    proof_path text,
    note text,

    recorded_by uuid not null
        references auth.users(id)
        on delete restrict,

    recorded_at timestamptz not null default now(),

    legacy_source_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,

    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create index if not exists attendance_store_date_idx
on public.attendance(
    store_id,
    attendance_date,
    recorded_at desc
)
where deleted_at is null;

create index if not exists attendance_user_date_idx
on public.attendance(
    store_id,
    user_id,
    attendance_date,
    recorded_at
)
where deleted_at is null;

create unique index if not exists attendance_legacy_source_unique
on public.attendance(
    store_id,
    legacy_source_id
)
where legacy_source_id is not null;

-- Satu Masuk per user per hari.
create unique index if not exists attendance_one_masuk_per_day
on public.attendance(
    store_id,
    user_id,
    attendance_date
)
where attendance_type = 'Masuk'
  and deleted_at is null;

-- Satu Keluar per user per hari.
create unique index if not exists attendance_one_keluar_per_day
on public.attendance(
    store_id,
    user_id,
    attendance_date
)
where attendance_type = 'Keluar'
  and deleted_at is null;

-- Satu status tidak hadir (Sakit/Izin) per user per hari.
create unique index if not exists attendance_one_absence_status_per_day
on public.attendance(
    store_id,
    user_id,
    attendance_date
)
where attendance_type in ('Sakit', 'Izin')
  and deleted_at is null;

drop trigger if exists trg_attendance_touch_row
on public.attendance;

create trigger trg_attendance_touch_row
before update on public.attendance
for each row
execute function public.ldm_touch_row();

-- ------------------------------------------------
-- RLS
-- Base table history:
-- Owner: semua pada store
-- User lain: milik sendiri
-- Status hari ini seluruh akun diberikan lewat RPC khusus,
-- tanpa membuka histori penuh.
-- ------------------------------------------------
alter table public.attendance
enable row level security;

revoke all on public.attendance from anon;
revoke insert, update, delete on public.attendance from authenticated;
grant select on public.attendance to authenticated;

drop policy if exists attendance_select_owner_or_self
on public.attendance;

create policy attendance_select_owner_or_self
on public.attendance
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and deleted_at is null
    and (
        user_id = auth.uid()
        or public.ldm_current_role() = 'owner'
    )
);

-- ------------------------------------------------
-- Private Storage bucket for selfie / permission documents.
-- ------------------------------------------------
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'ldm-attendance-proofs',
    'ldm-attendance-proofs',
    false,
    5242880,
    array[
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
)
on conflict (id)
do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Object path format:
-- store_id/user_id/YYYY-MM-DD/file.jpg

drop policy if exists ldm_attendance_proofs_insert
on storage.objects;

create policy ldm_attendance_proofs_insert
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'ldm-attendance-proofs'
    and (storage.foldername(name))[1] =
        public.ldm_current_store_id()::text
    and (
        (storage.foldername(name))[2] = auth.uid()::text
        or public.ldm_current_role() = 'owner'
    )
);

drop policy if exists ldm_attendance_proofs_select
on storage.objects;

create policy ldm_attendance_proofs_select
on storage.objects
for select
to authenticated
using (
    bucket_id = 'ldm-attendance-proofs'
    and (storage.foldername(name))[1] =
        public.ldm_current_store_id()::text
    and (
        (storage.foldername(name))[2] = auth.uid()::text
        or public.ldm_current_role() = 'owner'
    )
);

drop policy if exists ldm_attendance_proofs_delete
on storage.objects;

create policy ldm_attendance_proofs_delete
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'ldm-attendance-proofs'
    and (storage.foldername(name))[1] =
        public.ldm_current_store_id()::text
    and (
        (storage.foldername(name))[2] = auth.uid()::text
        or public.ldm_current_role() = 'owner'
    )
);

-- ------------------------------------------------
-- Profiles for attendance UI.
-- Returns active same-store usernames only.
-- ------------------------------------------------
create or replace function public.ldm_attendance_profiles()
returns table (
    id uuid,
    username text,
    role text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
    select
        p.id,
        p.username,
        p.role
    from public.profiles p
    where p.store_id = public.ldm_current_store_id()
      and p.active = true
      and p.deleted_at is null
    order by
        case p.role
            when 'owner' then 1
            when 'admin' then 2
            when 'kasir' then 3
            else 4
        end,
        lower(p.username);
$$;

revoke all on function public.ldm_attendance_profiles()
from public, anon;
grant execute on function public.ldm_attendance_profiles()
to authenticated;

-- ------------------------------------------------
-- Today's attendance summary for same store.
-- Non-owner can see status, but proof_path is hidden for other users.
-- ------------------------------------------------
create or replace function public.ldm_attendance_today()
returns table (
    id uuid,
    user_id uuid,
    username text,
    attendance_date date,
    attendance_type text,
    shift_label text,
    note text,
    proof_path text,
    recorded_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
    v_role text;
    v_timezone text;
    v_today date;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    select coalesce(nullif(s.timezone, ''), 'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = v_store_id
      and s.deleted_at is null
    limit 1;

    v_today := (now() at time zone v_timezone)::date;

    return query
    select
        a.id,
        a.user_id,
        a.username_snapshot,
        a.attendance_date,
        a.attendance_type,
        a.shift_label,
        a.note,
        case
            when v_role = 'owner'
                 or a.user_id = auth.uid()
                then a.proof_path
            else null
        end,
        a.recorded_at
    from public.attendance a
    where a.store_id = v_store_id
      and a.attendance_date = v_today
      and a.deleted_at is null
    order by a.recorded_at, a.id;
end;
$$;

revoke all on function public.ldm_attendance_today()
from public, anon;
grant execute on function public.ldm_attendance_today()
to authenticated;

-- ------------------------------------------------
-- Record attendance RPC.
-- Non-owner: self only.
-- Owner: may record for another active profile.
-- ------------------------------------------------
create or replace function public.ldm_record_attendance(
    p_target_user_id uuid,
    p_attendance_type text,
    p_shift_label text default null,
    p_note text default null,
    p_proof_path text default null
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
    v_today date;
    v_username text;
    v_type text;
    v_shift text;
    v_existing_masuk public.attendance%rowtype;
    v_row public.attendance%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null then
        raise exception 'Store profile tidak ditemukan.';
    end if;

    if p_target_user_id is null then
        raise exception 'Target user wajib diisi.';
    end if;

    if p_target_user_id <> auth.uid()
       and v_role <> 'owner' then
        raise exception 'Anda hanya dapat melakukan presensi untuk akun sendiri.';
    end if;

    select p.username
      into v_username
    from public.profiles p
    where p.id = p_target_user_id
      and p.store_id = v_store_id
      and p.active = true
      and p.deleted_at is null
    limit 1;

    if v_username is null then
        raise exception 'Profile target tidak ditemukan atau tidak aktif.';
    end if;

    select coalesce(nullif(s.timezone, ''), 'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = v_store_id
      and s.status = 'active'
      and s.deleted_at is null
    limit 1;

    if v_timezone is null then
        raise exception 'Store tidak aktif.';
    end if;

    v_today := (now() at time zone v_timezone)::date;
    v_type := initcap(lower(btrim(coalesce(p_attendance_type, ''))));

    if v_type not in ('Masuk', 'Keluar', 'Sakit', 'Izin') then
        raise exception 'Jenis presensi tidak valid.';
    end if;

    if v_type in ('Masuk', 'Keluar') then
        v_shift := btrim(coalesce(p_shift_label, ''));

        if v_shift not in ('Shift 1', 'Shift 2', 'Full Day') then
            raise exception 'Shift label harus Shift 1, Shift 2, atau Full Day.';
        end if;
    else
        v_shift := null;
    end if;

    if nullif(btrim(coalesce(p_proof_path, '')), '') is null then
        raise exception 'Bukti foto wajib diunggah.';
    end if;

    if p_proof_path not like
       v_store_id::text || '/' || p_target_user_id::text || '/' || v_today::text || '/%' then
        raise exception 'Path bukti presensi tidak valid.';
    end if;

    -- Serialize per user/day agar dua device tidak membuat presensi ganda.
    perform pg_advisory_xact_lock(
        hashtextextended(
            v_store_id::text || ':' ||
            p_target_user_id::text || ':' ||
            v_today::text,
            0
        )
    );

    if exists (
        select 1
        from public.attendance a
        where a.store_id = v_store_id
          and a.user_id = p_target_user_id
          and a.attendance_date = v_today
          and a.attendance_type in ('Sakit', 'Izin')
          and a.deleted_at is null
    ) then
        raise exception 'Presensi hari ini sudah ditutup dengan status Sakit/Izin.';
    end if;

    if v_type in ('Sakit', 'Izin') then
        if exists (
            select 1
            from public.attendance a
            where a.store_id = v_store_id
              and a.user_id = p_target_user_id
              and a.attendance_date = v_today
              and a.deleted_at is null
        ) then
            raise exception 'Tidak dapat mencatat Sakit/Izin setelah presensi hari ini dimulai.';
        end if;
    elsif v_type = 'Masuk' then
        if exists (
            select 1
            from public.attendance a
            where a.store_id = v_store_id
              and a.user_id = p_target_user_id
              and a.attendance_date = v_today
              and a.attendance_type = 'Masuk'
              and a.deleted_at is null
        ) then
            raise exception 'Absen Masuk hari ini sudah ada.';
        end if;
    elsif v_type = 'Keluar' then
        select a.*
          into v_existing_masuk
        from public.attendance a
        where a.store_id = v_store_id
          and a.user_id = p_target_user_id
          and a.attendance_date = v_today
          and a.attendance_type = 'Masuk'
          and a.deleted_at is null
        order by a.recorded_at desc
        limit 1;

        if v_existing_masuk.id is null then
            raise exception 'Absen Keluar tidak dapat dilakukan sebelum Absen Masuk.';
        end if;

        if exists (
            select 1
            from public.attendance a
            where a.store_id = v_store_id
              and a.user_id = p_target_user_id
              and a.attendance_date = v_today
              and a.attendance_type = 'Keluar'
              and a.deleted_at is null
        ) then
            raise exception 'Absen Keluar hari ini sudah ada.';
        end if;

        -- Keluar selalu mengikuti shift label pada Masuk.
        v_shift := v_existing_masuk.shift_label;
    end if;

    insert into public.attendance (
        store_id,
        user_id,
        username_snapshot,
        attendance_date,
        attendance_type,
        shift_label,
        proof_path,
        note,
        recorded_by,
        recorded_at
    )
    values (
        v_store_id,
        p_target_user_id,
        v_username,
        v_today,
        v_type,
        v_shift,
        p_proof_path,
        nullif(btrim(coalesce(p_note, '')), ''),
        auth.uid(),
        now()
    )
    returning * into v_row;

    return jsonb_build_object(
        'id', v_row.id,
        'user_id', v_row.user_id,
        'username', v_row.username_snapshot,
        'attendance_date', v_row.attendance_date,
        'attendance_type', v_row.attendance_type,
        'shift_label', v_row.shift_label,
        'proof_path', v_row.proof_path,
        'note', v_row.note,
        'recorded_at', v_row.recorded_at
    );
end;
$$;

revoke all on function public.ldm_record_attendance(
    uuid,
    text,
    text,
    text,
    text
) from public, anon;

grant execute on function public.ldm_record_attendance(
    uuid,
    text,
    text,
    text,
    text
) to authenticated;

-- ------------------------------------------------
-- Owner-only legacy migration.
-- p_rows item format:
-- {
--   legacy_source_id,
--   username,
--   attendance_date,
--   attendance_time,
--   attendance_type,
--   shift_label,
--   proof_path,
--   note
-- }
-- ------------------------------------------------
create or replace function public.ldm_import_legacy_attendance(
    p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_timezone text;
    v_item jsonb;
    v_user_id uuid;
    v_username text;
    v_date date;
    v_time time;
    v_type text;
    v_shift text;
    v_proof text;
    v_legacy_source_id text;
    v_recorded_at timestamptz;
    v_count integer := 0;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat migrasi Absensi lama.';
    end if;

    if p_rows is null
       or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows harus berupa JSON array.';
    end if;

    select coalesce(nullif(s.timezone, ''), 'Asia/Makassar')
      into v_timezone
    from public.stores s
    where s.id = v_store_id
      and s.deleted_at is null
    limit 1;

    for v_item in
        select value
        from jsonb_array_elements(p_rows)
    loop
        v_username := btrim(coalesce(v_item ->> 'username', ''));
        v_legacy_source_id := nullif(
            btrim(coalesce(v_item ->> 'legacy_source_id', '')),
            ''
        );

        if v_username = '' then
            raise exception 'Username legacy tidak boleh kosong.';
        end if;

        select p.id
          into v_user_id
        from public.profiles p
        where p.store_id = v_store_id
          and lower(p.username) = lower(v_username)
          and p.active = true
          and p.deleted_at is null
        limit 1;

        if v_user_id is null then
            raise exception 'Profile untuk username % tidak ditemukan.', v_username;
        end if;

        v_date := (v_item ->> 'attendance_date')::date;
        v_time := coalesce(
            nullif(v_item ->> 'attendance_time', '')::time,
            time '00:00'
        );
        v_type := initcap(lower(btrim(coalesce(v_item ->> 'attendance_type', ''))));

        if v_type = 'Hadir' then
            v_type := 'Masuk';
        end if;

        if v_type not in ('Masuk', 'Keluar', 'Sakit', 'Izin') then
            raise exception 'Jenis presensi legacy % tidak valid.', v_type;
        end if;

        if v_type in ('Masuk', 'Keluar') then
            v_shift := nullif(btrim(coalesce(v_item ->> 'shift_label', '')), '');
            if v_shift not in ('Shift 1', 'Shift 2', 'Full Day') then
                v_shift := 'Full Day';
            end if;
        else
            v_shift := null;
        end if;

        v_proof := nullif(btrim(coalesce(v_item ->> 'proof_path', '')), '');

        if v_proof is not null
           and v_proof not like
               v_store_id::text || '/' || v_user_id::text || '/' || v_date::text || '/%' then
            raise exception 'Proof path legacy untuk % tidak valid.', v_username;
        end if;

        v_recorded_at :=
            (v_date + v_time) at time zone v_timezone;

        insert into public.attendance (
            store_id,
            user_id,
            username_snapshot,
            attendance_date,
            attendance_type,
            shift_label,
            proof_path,
            note,
            recorded_by,
            recorded_at,
            legacy_source_id
        )
        values (
            v_store_id,
            v_user_id,
            v_username,
            v_date,
            v_type,
            v_shift,
            v_proof,
            nullif(btrim(coalesce(v_item ->> 'note', '')), ''),
            auth.uid(),
            v_recorded_at,
            v_legacy_source_id
        )
        on conflict (store_id, legacy_source_id)
        where legacy_source_id is not null
        do nothing;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ldm_import_legacy_attendance(jsonb)
from public, anon;
grant execute on function public.ldm_import_legacy_attendance(jsonb)
to authenticated;

-- ------------------------------------------------
-- Owner-only soft delete attendance.
-- Storage file removal is performed through Storage API in frontend.
-- ------------------------------------------------
create or replace function public.ldm_soft_delete_attendance(
    p_attendance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_row public.attendance%rowtype;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_role <> 'owner' then
        raise exception 'Hanya Owner yang dapat menghapus data presensi.';
    end if;

    select *
      into strict v_row
    from public.attendance a
    where a.id = p_attendance_id
      and a.store_id = v_store_id
      and a.deleted_at is null
    for update;

    update public.attendance
       set deleted_at = now(),
           deleted_by = auth.uid()
     where id = v_row.id;

    return jsonb_build_object(
        'id', v_row.id,
        'proof_path', v_row.proof_path,
        'deleted', true
    );
end;
$$;

revoke all on function public.ldm_soft_delete_attendance(uuid)
from public, anon;
grant execute on function public.ldm_soft_delete_attendance(uuid)
to authenticated;

-- ------------------------------------------------
-- Link transactions -> attendance Masuk.
-- Existing Stage 8 rows remain nullable.
-- ------------------------------------------------
alter table public.transactions
add column if not exists attendance_id uuid
    references public.attendance(id)
    on delete restrict;

create index if not exists transactions_attendance_idx
on public.transactions(attendance_id)
where attendance_id is not null;

create or replace function public.ldm_require_active_attendance_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_masuk public.attendance%rowtype;
    v_keluar_at timestamptz;
begin
    select a.*
      into v_masuk
    from public.attendance a
    where a.store_id = new.store_id
      and a.user_id = new.cashier_user_id
      and a.attendance_date = new.business_date
      and a.attendance_type = 'Masuk'
      and a.deleted_at is null
    order by a.recorded_at desc
    limit 1;

    if v_masuk.id is null then
        raise exception 'Checkout ditolak: Absen Masuk cloud hari ini belum tersedia.';
    end if;

    select max(a.recorded_at)
      into v_keluar_at
    from public.attendance a
    where a.store_id = new.store_id
      and a.user_id = new.cashier_user_id
      and a.attendance_date = new.business_date
      and a.attendance_type = 'Keluar'
      and a.deleted_at is null;

    if v_keluar_at is not null
       and v_keluar_at >= v_masuk.recorded_at then
        raise exception 'Checkout ditolak: akun sudah Absen Keluar.';
    end if;

    new.attendance_id := v_masuk.id;

    if nullif(btrim(coalesce(new.shift_label, '')), '') is null then
        new.shift_label := v_masuk.shift_label;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_transactions_require_attendance
on public.transactions;

create trigger trg_transactions_require_attendance
before insert on public.transactions
for each row
execute function public.ldm_require_active_attendance_for_transaction();

-- ------------------------------------------------
-- Realtime
-- ------------------------------------------------
do $$
begin
    if exists (
        select 1
        from pg_publication
        where pubname = 'supabase_realtime'
    ) and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'attendance'
    ) then
        alter publication supabase_realtime
        add table public.attendance;
    end if;
end
$$;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta (key, value)
values
    ('live_sync_stage', '9'),
    ('schema_status', 'cloud_attendance_ready'),
    ('schema_version', '9'),
    ('attendance_authority', 'public.attendance'),
    ('attendance_cache', 'localStorage.dataAbsensi'),
    ('attendance_proof_storage', 'ldm-attendance-proofs'),
    ('attendance_realtime', 'enabled'),
    ('attendance_shift_mode', 'label_only_no_shift_management'),
    ('transaction_attendance_guard', 'enabled')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

commit;

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

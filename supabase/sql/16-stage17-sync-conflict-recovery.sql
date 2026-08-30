-- ============================================================================
-- LocDailyMar TAHAP 17 — Sync Conflict & Recovery Center
-- Baseline wajib: TAHAP 16 + database authority TAHAP 13/15.
-- Aman dijalankan ulang (idempotent). Jalankan melalui Supabase SQL Editor.
-- ============================================================================

begin;

do $$
begin
    if to_regclass('public.transactions') is null
       or to_regclass('public.devices') is null
       or to_regclass('public.audit_events') is null
       or to_regprocedure('public.ldm_sync_offline_sale(text,uuid,uuid,timestamptz,uuid,jsonb,numeric,text,numeric,numeric,numeric,text,numeric)') is null then
        raise exception 'Baseline TAHAP 13/15/16 belum lengkap. Jalankan migrasi tahap sebelumnya terlebih dahulu.';
    end if;
end
$$;

create table if not exists public.sync_conflicts (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,
    device_id uuid references public.devices(id) on delete set null,
    client_device_id text not null,
    queue_id text not null,
    client_transaction_id uuid not null,
    conflict_type text not null check (conflict_type in ('business_conflict','blocked','failed')),
    status text not null default 'open' check (status in ('open','retry_requested','resolved','discarded')),
    error_message text not null,
    queued_at timestamptz,
    payload_digest text,
    display_snapshot jsonb not null default '{}'::jsonb,
    attempt_count integer not null default 1 check (attempt_count >= 1),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    resolution_action text,
    resolution_note text,
    resolved_at timestamptz,
    resolved_by uuid references auth.users(id) on delete set null,
    cloud_transaction_id uuid references public.transactions(id) on delete set null,
    constraint sync_conflicts_store_client_unique unique(store_id,client_transaction_id)
);

create index if not exists sync_conflicts_store_status_time_idx
on public.sync_conflicts(store_id,status,last_seen_at desc);

create index if not exists sync_conflicts_user_device_idx
on public.sync_conflicts(store_id,user_id,client_device_id,last_seen_at desc);

alter table public.sync_conflicts enable row level security;
revoke all on public.sync_conflicts from anon;
revoke insert,update,delete on public.sync_conflicts from authenticated;
grant select on public.sync_conflicts to authenticated;

drop policy if exists sync_conflicts_select_scoped on public.sync_conflicts;
create policy sync_conflicts_select_scoped
on public.sync_conflicts
for select to authenticated
using (
    store_id = public.ldm_current_store_id()
    and (
        public.ldm_current_role() in ('owner','admin')
        or user_id = (select auth.uid())
    )
);

-- Mencatat ringkasan conflict, bukan isi keranjang penuh atau credential.
create or replace function public.ldm_record_sync_conflict(
    p_client_device_id text,
    p_queue_id text,
    p_client_transaction_id uuid,
    p_conflict_type text,
    p_error_message text,
    p_queued_at timestamptz,
    p_payload_digest text default null,
    p_snapshot jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_device_id uuid;
    v_id uuid;
    v_snapshot jsonb;
begin
    if auth.uid() is null or v_store_id is null or v_role not in ('owner','admin','kasir') then
        raise exception 'RECOVERY_BLOCKED: Session/profile tidak valid.';
    end if;
    if btrim(coalesce(p_client_device_id,''))='' or btrim(coalesce(p_queue_id,''))='' or p_client_transaction_id is null then
        raise exception 'RECOVERY_BLOCKED: Identitas queue/device tidak lengkap.';
    end if;
    if p_conflict_type not in ('business_conflict','blocked','failed') then
        raise exception 'RECOVERY_BLOCKED: conflict_type tidak valid.';
    end if;

    select d.id into v_device_id
    from public.devices d
    where d.store_id=v_store_id and d.user_id=auth.uid()
      and d.client_device_id=btrim(p_client_device_id)
      and d.deleted_at is null
    limit 1;
    if v_device_id is null then
        raise exception 'RECOVERY_BLOCKED: Perangkat tidak terdaftar atau bukan milik user/store ini.';
    end if;

    if exists(
        select 1 from public.sync_conflicts c
        where c.store_id=v_store_id and c.client_transaction_id=p_client_transaction_id and c.user_id<>auth.uid()
    ) then
        raise exception 'RECOVERY_BLOCKED: client_transaction_id sudah dimiliki user lain.';
    end if;

    v_snapshot := jsonb_strip_nulls(jsonb_build_object(
        'transaction_code',nullif(p_snapshot->>'transaction_code',''),
        'grand_total',nullif(p_snapshot->>'grand_total','')::numeric,
        'item_count',greatest(coalesce(nullif(p_snapshot->>'item_count','')::integer,0),0),
        'payment_method',nullif(p_snapshot->>'payment_method',''),
        'attempt_count',greatest(coalesce(nullif(p_snapshot->>'attempt_count','')::integer,0),0)
    ));

    insert into public.sync_conflicts(
        store_id,user_id,device_id,client_device_id,queue_id,client_transaction_id,
        conflict_type,status,error_message,queued_at,payload_digest,display_snapshot
    ) values (
        v_store_id,auth.uid(),v_device_id,btrim(p_client_device_id),btrim(p_queue_id),p_client_transaction_id,
        p_conflict_type,'open',left(coalesce(nullif(btrim(p_error_message),''),'Unknown sync error'),1000),
        p_queued_at,left(nullif(btrim(coalesce(p_payload_digest,'')),''),128),v_snapshot
    )
    on conflict(store_id,client_transaction_id) do update set
        device_id=excluded.device_id,
        client_device_id=excluded.client_device_id,
        queue_id=excluded.queue_id,
        conflict_type=excluded.conflict_type,
        error_message=excluded.error_message,
        queued_at=coalesce(public.sync_conflicts.queued_at,excluded.queued_at),
        payload_digest=excluded.payload_digest,
        display_snapshot=excluded.display_snapshot,
        attempt_count=public.sync_conflicts.attempt_count+1,
        last_seen_at=now(),
        status=case when public.sync_conflicts.status in ('resolved','discarded') then public.sync_conflicts.status else 'open' end
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.ldm_record_sync_conflict(text,text,uuid,text,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.ldm_record_sync_conflict(text,text,uuid,text,text,timestamptz,text,jsonb) to authenticated;

-- Owner/Admin dapat meminta retry; user sumber juga boleh retry queue miliknya.
-- Discard/reopen selalu Owner-only dan tercatat pada audit_events.
create or replace function public.ldm_sync_conflict_action(
    p_conflict_id uuid,
    p_action text,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_row public.sync_conflicts%rowtype;
    v_action text := lower(btrim(coalesce(p_action,'')));
    v_note text := left(btrim(coalesce(p_note,'')),500);
    v_username text;
begin
    if auth.uid() is null or v_store_id is null then
        raise exception 'RECOVERY_BLOCKED: Session/profile tidak valid.';
    end if;

    select * into v_row from public.sync_conflicts
    where id=p_conflict_id and store_id=v_store_id
    for update;
    if not found then raise exception 'RECOVERY_NOT_FOUND: Conflict tidak ditemukan pada store ini.'; end if;

    if v_action='retry' then
        if v_role not in ('owner','admin') and v_row.user_id<>auth.uid() then
            raise exception 'RECOVERY_FORBIDDEN: Retry tidak diizinkan.';
        end if;
        if v_row.status in ('resolved','discarded') then
            raise exception 'RECOVERY_INVALID_STATE: Conflict berstatus %.',v_row.status;
        end if;
        update public.sync_conflicts set status='retry_requested',resolution_action='retry',resolution_note=nullif(v_note,''),resolved_at=null,resolved_by=null,last_seen_at=now() where id=v_row.id;
    elsif v_action='discard' then
        if v_role<>'owner' then raise exception 'RECOVERY_FORBIDDEN: Hanya Owner yang dapat discard.'; end if;
        if length(v_note)<5 then raise exception 'RECOVERY_NOTE_REQUIRED: Alasan discard minimal 5 karakter.'; end if;
        if exists(select 1 from public.transactions t where t.store_id=v_store_id and t.client_transaction_id=v_row.client_transaction_id) then
            raise exception 'RECOVERY_INVALID_STATE: Transaksi sudah tersimpan di cloud dan tidak boleh di-discard.';
        end if;
        update public.sync_conflicts set status='discarded',resolution_action='discard',resolution_note=v_note,resolved_at=now(),resolved_by=auth.uid(),last_seen_at=now() where id=v_row.id;
    elsif v_action='reopen' then
        if v_role<>'owner' then raise exception 'RECOVERY_FORBIDDEN: Hanya Owner yang dapat membuka kembali conflict.'; end if;
        update public.sync_conflicts set status='open',resolution_action='reopen',resolution_note=nullif(v_note,''),resolved_at=null,resolved_by=null,last_seen_at=now() where id=v_row.id;
    else
        raise exception 'RECOVERY_BLOCKED: Action harus retry, discard, atau reopen.';
    end if;

    select p.username into v_username from public.profiles p where p.id=auth.uid() limit 1;
    insert into public.audit_events(store_id,actor_user_id,actor_username,actor_role,entity_type,entity_id,action,details)
    values(v_store_id,auth.uid(),coalesce(v_username,'unknown'),v_role,'sync_conflicts',v_row.id::text,'RECOVERY_'||upper(v_action),
        jsonb_strip_nulls(jsonb_build_object('client_transaction_id',v_row.client_transaction_id,'conflict_type',v_row.conflict_type,'note',nullif(v_note,''))));

    return (select to_jsonb(c) from public.sync_conflicts c where c.id=v_row.id);
end;
$$;

revoke all on function public.ldm_sync_conflict_action(uuid,text,text) from public,anon;
grant execute on function public.ldm_sync_conflict_action(uuid,text,text) to authenticated;

-- Dipanggil sesudah queue benar-benar sukses. Tidak dapat menandai resolved
-- tanpa transaksi cloud yang cocok, sehingga status tidak bisa dipalsukan client.
create or replace function public.ldm_mark_sync_conflict_recovered(
    p_client_transaction_id uuid,
    p_cloud_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_store_id uuid := public.ldm_current_store_id();
    v_role text := public.ldm_current_role();
    v_transaction_id uuid;
    v_conflict_id uuid;
begin
    if auth.uid() is null or v_store_id is null then raise exception 'RECOVERY_BLOCKED: Session/profile tidak valid.'; end if;
    select t.id into v_transaction_id from public.transactions t
    where t.store_id=v_store_id and t.client_transaction_id=p_client_transaction_id
      and (p_cloud_transaction_id is null or t.id=p_cloud_transaction_id)
    limit 1;
    if v_transaction_id is null then raise exception 'RECOVERY_NOT_FOUND: Transaksi cloud belum tersedia.'; end if;

    update public.sync_conflicts c set
        status='resolved',resolution_action='synced',resolution_note='Queue berhasil disinkronkan.',
        resolved_at=now(),resolved_by=auth.uid(),cloud_transaction_id=v_transaction_id,last_seen_at=now()
    where c.store_id=v_store_id and c.client_transaction_id=p_client_transaction_id
      and (c.user_id=auth.uid() or v_role in ('owner','admin'))
    returning c.id into v_conflict_id;
    return v_conflict_id;
end;
$$;

revoke all on function public.ldm_mark_sync_conflict_recovered(uuid,uuid) from public,anon;
grant execute on function public.ldm_mark_sync_conflict_recovered(uuid,uuid) to authenticated;

-- Penjaga server: queue yang telah di-discard Owner tidak dapat masuk kembali
-- melalui retry dari perangkat lama. Hanya aktif untuk transaksi context offline.
create or replace function public.ldm_block_discarded_offline_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if nullif(current_setting('ldm.offline_client_device_id',true),'') is not null
       and exists(
           select 1 from public.sync_conflicts c
           where c.store_id=new.store_id and c.client_transaction_id=new.client_transaction_id and c.status='discarded'
       ) then
        raise exception 'OFFLINE_BLOCKED_DISCARDED: Antrean ini telah dibatalkan Owner melalui Recovery Center.';
    end if;
    return new;
end;
$$;

revoke all on function public.ldm_block_discarded_offline_sale() from public,anon,authenticated;
drop trigger if exists trg_block_discarded_offline_sale on public.transactions;
create trigger trg_block_discarded_offline_sale
before insert on public.transactions
for each row execute function public.ldm_block_discarded_offline_sale();

do $$
begin
    if exists(select 1 from pg_publication where pubname='supabase_realtime')
       and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sync_conflicts') then
        alter publication supabase_realtime add table public.sync_conflicts;
    end if;
end
$$;

insert into public.ldm_system_meta(key,value) values
    ('live_sync_stage','17'),
    ('schema_version','17'),
    ('schema_status','sync_conflict_recovery_ready'),
    ('sync_conflict_authority','public.sync_conflicts'),
    ('sync_recovery_roles','owner_admin_user_source'),
    ('sync_recovery_discard_policy','owner_only_server_blocked'),
    ('sync_recovery_payload_policy','digest_and_summary_only')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

select key,value,updated_at from public.ldm_system_meta
where key in ('live_sync_stage','schema_version','schema_status','sync_conflict_authority','sync_recovery_roles','sync_recovery_discard_policy','sync_recovery_payload_policy')
order by key;

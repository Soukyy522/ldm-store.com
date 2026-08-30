-- ================================================================
-- LocDailyMar - Live Sync Tahap 13
-- PRODUCTION HARDENING + AUDIT TRAIL + CLOUD SNAPSHOT + HEALTH CHECK
--
-- Tahap 12 sudah menyelesaikan authority bisnis utama.
-- Tahap 13 tidak mengubah model Shift: Shift 1 / Shift 2 / Full Day
-- tetap hanya shift_label. Tidak ada Shift Management.
-- ================================================================

begin;

-- ------------------------------------------------
-- Preflight
-- ------------------------------------------------
do $$
begin
    if to_regclass('public.transactions') is null
       or to_regclass('public.products') is null
       or to_regclass('public.end_of_day_closings') is null then
        raise exception 'Baseline Tahap 12 belum lengkap.';
    end if;
end
$$;

-- ------------------------------------------------
-- APPEND-ONLY AUDIT EVENTS
-- ------------------------------------------------
create table if not exists public.audit_events (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,

    actor_user_id uuid references auth.users(id) on delete set null,
    actor_username text,
    actor_role text,

    entity_type text not null,
    entity_id text,
    action text not null,
    business_date date,

    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists audit_events_store_time_idx
on public.audit_events(store_id, created_at desc);

create index if not exists audit_events_entity_idx
on public.audit_events(store_id, entity_type, entity_id, created_at desc);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon;
revoke insert, update, delete on public.audit_events from authenticated;
grant select on public.audit_events to authenticated;

drop policy if exists audit_events_select_owner_admin on public.audit_events;
create policy audit_events_select_owner_admin
on public.audit_events
for select
to authenticated
using (
    store_id = public.ldm_current_store_id()
    and public.ldm_current_role() in ('owner','admin')
);

-- ------------------------------------------------
-- Generic audit trigger.
-- Menyimpan metadata ringkas, bukan dump seluruh row.
-- ------------------------------------------------
create or replace function public.ldm_audit_business_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_new jsonb := '{}'::jsonb;
    v_old jsonb := '{}'::jsonb;
    v_row jsonb := '{}'::jsonb;
    v_store_id uuid;
    v_actor_username text;
    v_actor_role text;
    v_business_date date;
    v_entity_id text;
    v_details jsonb;
begin
    if tg_op <> 'DELETE' then
        v_new := to_jsonb(new);
    end if;

    if tg_op <> 'INSERT' then
        v_old := to_jsonb(old);
    end if;

    if tg_op = 'DELETE' then
        v_row := v_old;
    else
        v_row := v_new;
    end if;

    begin
        v_store_id := nullif(v_row ->> 'store_id', '')::uuid;
    exception when others then
        v_store_id := null;
    end;

    if v_store_id is null then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    select p.username, p.role
      into v_actor_username, v_actor_role
    from public.profiles p
    where p.id = auth.uid()
    limit 1;

    begin
        v_business_date := coalesce(
            nullif(v_row ->> 'business_date', '')::date,
            nullif(v_row ->> 'attendance_date', '')::date
        );
    exception when others then
        v_business_date := null;
    end;

    v_entity_id := coalesce(
        nullif(v_row ->> 'id', ''),
        nullif(v_row ->> 'legacy_source_id', ''),
        nullif(v_row ->> 'transaction_code', ''),
        nullif(v_row ->> 'return_code', '')
    );

    v_details := jsonb_strip_nulls(
        jsonb_build_object(
            'status_before', nullif(v_old ->> 'status', ''),
            'status_after', nullif(v_new ->> 'status', ''),
            'username', coalesce(
                nullif(v_row ->> 'username', ''),
                nullif(v_row ->> 'username_snapshot', ''),
                nullif(v_row ->> 'cashier_username', ''),
                nullif(v_row ->> 'created_username', '')
            ),
            'shift_label', nullif(v_row ->> 'shift_label', ''),
            'transaction_code', nullif(v_row ->> 'transaction_code', ''),
            'return_code', nullif(v_row ->> 'return_code', ''),
            'po_number', nullif(v_row ->> 'po_number', ''),
            'gr_number', nullif(v_row ->> 'gr_number', ''),
            'reference_code', nullif(v_row ->> 'reference_code', ''),
            'grand_total', nullif(v_row ->> 'grand_total', ''),
            'total_refund', nullif(v_row ->> 'total_refund', ''),
            'amount', nullif(v_row ->> 'amount', ''),
            'stock_effect_applied', nullif(v_row ->> 'stock_effect_applied', ''),
            'deleted', case
                when nullif(v_new ->> 'deleted_at', '') is not null then true
                else null
            end
        )
    );

    insert into public.audit_events (
        store_id,
        actor_user_id,
        actor_username,
        actor_role,
        entity_type,
        entity_id,
        action,
        business_date,
        details
    )
    values (
        v_store_id,
        auth.uid(),
        coalesce(v_actor_username, 'system'),
        coalesce(v_actor_role, 'system'),
        tg_table_name,
        v_entity_id,
        tg_op,
        v_business_date,
        v_details
    );

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public.ldm_audit_business_change() from public, anon, authenticated;

-- ------------------------------------------------
-- Attach audit to high-level business entities.
-- Ledger/detail rows tidak dipasang trigger agar log tidak meledak.
-- ------------------------------------------------
do $$
declare
    v_table text;
    v_trigger text;
begin
    foreach v_table in array array[
        'profiles',
        'products',
        'transactions',
        'attendance',
        'sales_returns',
        'stock_opname_entries',
        'suppliers',
        'purchase_orders',
        'goods_receipts',
        'cash_movements',
        'shift_closings',
        'end_of_day_closings',
        'operating_expenses',
        'legacy_transactions'
    ]
    loop
        if to_regclass('public.' || v_table) is not null then
            v_trigger := 'trg_audit_' || v_table;
            execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
            execute format(
                'create trigger %I after insert or update or delete on public.%I for each row execute function public.ldm_audit_business_change()',
                v_trigger,
                v_table
            );
        end if;
    end loop;
end
$$;

-- ------------------------------------------------
-- SYSTEM HEALTH RPC
-- Owner/Admin only.
-- ------------------------------------------------
create or replace function public.ldm_system_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_store_id uuid;
    v_role text;
    v_store record;
    v_stock_mismatch integer := 0;
    v_orphan_tx_items integer := 0;
    v_orphan_return_items integer := 0;
    v_orphan_gr_items integer := 0;
    v_duplicate_closing integer := 0;
    v_duplicate_eod integer := 0;
    v_rls_disabled integer := 0;
    v_realtime_missing integer := 0;
    v_pending_returns integer := 0;
    v_pending_opname integer := 0;
    v_pending_po integer := 0;
    v_pending_gr integer := 0;
    v_status text := 'healthy';
    v_counts jsonb;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();

    if v_store_id is null or v_role not in ('owner','admin') then
        raise exception 'Akses health check hanya untuk Owner/Admin.';
    end if;

    select s.* into v_store
    from public.stores s
    where s.id = v_store_id
    limit 1;

    with latest as (
        select distinct on (sm.product_id)
            sm.product_id,
            sm.stock_after
        from public.stock_movements sm
        where sm.store_id = v_store_id
        order by sm.product_id, sm.occurred_at desc, sm.created_at desc, sm.id desc
    )
    select count(*) into v_stock_mismatch
    from public.products p
    left join latest l on l.product_id = p.id
    where p.store_id = v_store_id
      and p.deleted_at is null
      and p.active = true
      and (
          l.product_id is null
          or abs(coalesce(p.legacy_stock_snapshot,0) - coalesce(l.stock_after,0)) > 0.0005
      );

    select count(*) into v_orphan_tx_items
    from public.transaction_items i
    left join public.transactions t on t.id = i.transaction_id
    where i.store_id = v_store_id and t.id is null;

    select count(*) into v_orphan_return_items
    from public.sales_return_items i
    left join public.sales_returns r on r.id = i.return_id
    where i.store_id = v_store_id and r.id is null;

    select count(*) into v_orphan_gr_items
    from public.goods_receipt_items i
    left join public.goods_receipts g on g.id = i.goods_receipt_id
    where i.store_id = v_store_id and g.id is null;

    select count(*) into v_duplicate_closing
    from (
        select business_date, lower(btrim(cashier_username)), lower(btrim(shift_label))
        from public.shift_closings
        where store_id = v_store_id
          and status = 'FINAL'
          and deleted_at is null
        group by business_date, lower(btrim(cashier_username)), lower(btrim(shift_label))
        having count(*) > 1
    ) d;

    select count(*) into v_duplicate_eod
    from (
        select business_date
        from public.end_of_day_closings
        where store_id = v_store_id
          and status = 'FINAL'
          and deleted_at is null
        group by business_date
        having count(*) > 1
    ) d;

    select count(*) into v_rls_disabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
          'profiles','devices','products','transactions','transaction_items','stock_movements',
          'attendance','sales_returns','sales_return_items','cash_movements','stock_opname_entries',
          'suppliers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
          'shift_closings','end_of_day_closings','operating_expenses','legacy_transactions','audit_events'
      ])
      and c.relrowsecurity = false;

    with expected(tablename) as (
        select unnest(array[
            'products','transactions','attendance','sales_returns','stock_opname_entries',
            'suppliers','purchase_orders','goods_receipts','shift_closings',
            'end_of_day_closings','operating_expenses','audit_events'
        ])
    )
    select count(*) into v_realtime_missing
    from expected e
    left join pg_publication_tables p
      on p.pubname = 'supabase_realtime'
     and p.schemaname = 'public'
     and p.tablename = e.tablename
    where p.tablename is null;

    select count(*) into v_pending_returns
    from public.sales_returns
    where store_id = v_store_id and deleted_at is null and status = 'PENDING';

    select count(*) into v_pending_opname
    from public.stock_opname_entries
    where store_id = v_store_id and deleted_at is null and status = 'PENDING';

    select count(*) into v_pending_po
    from public.purchase_orders
    where store_id = v_store_id and deleted_at is null and status in ('Draft','PendingApproval');

    select count(*) into v_pending_gr
    from public.goods_receipts
    where store_id = v_store_id and deleted_at is null and status = 'PendingApproval';

    select jsonb_build_object(
        'profiles_active', (select count(*) from public.profiles where store_id=v_store_id and active=true and deleted_at is null),
        'products_active', (select count(*) from public.products where store_id=v_store_id and active=true and deleted_at is null),
        'transactions', (select count(*) from public.transactions where store_id=v_store_id),
        'stock_movements', (select count(*) from public.stock_movements where store_id=v_store_id),
        'attendance', (select count(*) from public.attendance where store_id=v_store_id and deleted_at is null),
        'returns', (select count(*) from public.sales_returns where store_id=v_store_id and deleted_at is null),
        'stock_opname', (select count(*) from public.stock_opname_entries where store_id=v_store_id and deleted_at is null),
        'suppliers', (select count(*) from public.suppliers where store_id=v_store_id and deleted_at is null),
        'purchase_orders', (select count(*) from public.purchase_orders where store_id=v_store_id and deleted_at is null),
        'goods_receipts', (select count(*) from public.goods_receipts where store_id=v_store_id and deleted_at is null),
        'shift_closings', (select count(*) from public.shift_closings where store_id=v_store_id and deleted_at is null),
        'end_of_day', (select count(*) from public.end_of_day_closings where store_id=v_store_id and deleted_at is null),
        'operating_expenses', (select count(*) from public.operating_expenses where store_id=v_store_id and deleted_at is null),
        'audit_events', (select count(*) from public.audit_events where store_id=v_store_id)
    ) into v_counts;

    if v_store.status <> 'active' or v_rls_disabled > 0 then
        v_status := 'critical';
    elsif v_stock_mismatch > 0
       or v_orphan_tx_items > 0
       or v_orphan_return_items > 0
       or v_orphan_gr_items > 0
       or v_duplicate_closing > 0
       or v_duplicate_eod > 0
       or v_realtime_missing > 0 then
        v_status := 'warning';
    end if;

    return jsonb_build_object(
        'status', v_status,
        'generated_at', now(),
        'store', jsonb_build_object(
            'id', v_store.id,
            'code', v_store.code,
            'name', v_store.name,
            'status', v_store.status,
            'timezone', v_store.timezone,
            'currency', v_store.currency
        ),
        'checks', jsonb_build_object(
            'stock_ledger_mismatch', v_stock_mismatch,
            'orphan_transaction_items', v_orphan_tx_items,
            'orphan_return_items', v_orphan_return_items,
            'orphan_goods_receipt_items', v_orphan_gr_items,
            'duplicate_final_closing', v_duplicate_closing,
            'duplicate_final_eod', v_duplicate_eod,
            'rls_disabled_tables', v_rls_disabled,
            'realtime_missing_tables', v_realtime_missing
        ),
        'pending', jsonb_build_object(
            'returns', v_pending_returns,
            'stock_opname', v_pending_opname,
            'purchase_orders', v_pending_po,
            'goods_receipts', v_pending_gr
        ),
        'counts', v_counts
    );
end;
$$;

revoke all on function public.ldm_system_health() from public, anon;
grant execute on function public.ldm_system_health() to authenticated;

-- ------------------------------------------------
-- OWNER-ONLY CLOUD SNAPSHOT EXPORT
-- JSON database snapshot + Storage manifest.
-- Tidak menyertakan password, service_role, access token, atau file binary.
-- ------------------------------------------------
create or replace function public.ldm_export_store_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
    v_store_id uuid;
    v_role text;
    v_username text;
    v_payload jsonb;
begin
    v_store_id := public.ldm_current_store_id();
    v_role := public.ldm_current_role();
    v_username := public.ldm_current_username();

    if v_store_id is null or v_role <> 'owner' then
        raise exception 'Cloud Snapshot hanya dapat dibuat oleh Owner.';
    end if;

    insert into public.audit_events(
        store_id, actor_user_id, actor_username, actor_role,
        entity_type, entity_id, action, details
    ) values (
        v_store_id, auth.uid(), v_username, v_role,
        'cloud_snapshot', v_store_id::text, 'EXPORT',
        jsonb_build_object('format','LocDailyMarCloudSnapshot','version',1)
    );

    select jsonb_build_object(
        'format', 'LocDailyMarCloudSnapshot',
        'version', 1,
        'stage', 13,
        'created_at', now(),
        'created_by', jsonb_build_object(
            'user_id', auth.uid(),
            'username', v_username,
            'role', v_role
        ),
        'store', (
            select to_jsonb(s)
            from public.stores s
            where s.id = v_store_id
        ),
        'notes', jsonb_build_array(
            'Snapshot berisi data database store dan manifest file Storage.',
            'Binary foto/nota tidak disertakan.',
            'Snapshot bukan auto-restore; restore cloud harus dilakukan secara terkontrol.'
        ),
        'data', jsonb_build_object(
            'profiles', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.profiles x where x.store_id=v_store_id), '[]'::jsonb),
            'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.devices x where x.store_id=v_store_id), '[]'::jsonb),
            'products', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.products x where x.store_id=v_store_id), '[]'::jsonb),
            'transactions', coalesce((select jsonb_agg(to_jsonb(x) order by x.transacted_at) from public.transactions x where x.store_id=v_store_id), '[]'::jsonb),
            'transaction_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.transaction_items x where x.store_id=v_store_id), '[]'::jsonb),
            'stock_movements', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at) from public.stock_movements x where x.store_id=v_store_id), '[]'::jsonb),
            'attendance', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at) from public.attendance x where x.store_id=v_store_id), '[]'::jsonb),
            'sales_returns', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.sales_returns x where x.store_id=v_store_id), '[]'::jsonb),
            'sales_return_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.sales_return_items x where x.store_id=v_store_id), '[]'::jsonb),
            'cash_movements', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at) from public.cash_movements x where x.store_id=v_store_id), '[]'::jsonb),
            'stock_opname_entries', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.stock_opname_entries x where x.store_id=v_store_id), '[]'::jsonb),
            'suppliers', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.suppliers x where x.store_id=v_store_id), '[]'::jsonb),
            'purchase_orders', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.purchase_orders x where x.store_id=v_store_id), '[]'::jsonb),
            'purchase_order_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.purchase_order_items x where x.store_id=v_store_id), '[]'::jsonb),
            'goods_receipts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.goods_receipts x where x.store_id=v_store_id), '[]'::jsonb),
            'goods_receipt_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.goods_receipt_items x where x.store_id=v_store_id), '[]'::jsonb),
            'shift_closings', coalesce((select jsonb_agg(to_jsonb(x) order by x.finalized_at) from public.shift_closings x where x.store_id=v_store_id), '[]'::jsonb),
            'end_of_day_closings', coalesce((select jsonb_agg(to_jsonb(x) order by x.finalized_at) from public.end_of_day_closings x where x.store_id=v_store_id), '[]'::jsonb),
            'operating_expenses', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at) from public.operating_expenses x where x.store_id=v_store_id), '[]'::jsonb),
            'legacy_transactions', coalesce((select jsonb_agg(to_jsonb(x) order by x.imported_at) from public.legacy_transactions x where x.store_id=v_store_id), '[]'::jsonb),
            'audit_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.audit_events x where x.store_id=v_store_id), '[]'::jsonb)
        ),
        'storage_manifest', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'bucket_id', o.bucket_id,
                    'name', o.name,
                    'created_at', o.created_at,
                    'updated_at', o.updated_at,
                    'metadata', o.metadata
                ) order by o.bucket_id, o.name
            )
            from storage.objects o
            where o.bucket_id in ('ldm-attendance-proofs','ldm-expense-receipts')
              and split_part(o.name, '/', 1) = v_store_id::text
        ), '[]'::jsonb)
    ) into v_payload;

    return v_payload;
end;
$$;

revoke all on function public.ldm_export_store_snapshot() from public, anon;
grant execute on function public.ldm_export_store_snapshot() to authenticated;

-- ------------------------------------------------
-- Realtime audit events
-- ------------------------------------------------
do $$
begin
    if exists (select 1 from pg_publication where pubname='supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname='supabase_realtime'
             and schemaname='public'
             and tablename='audit_events'
       ) then
        alter publication supabase_realtime add table public.audit_events;
    end if;
end
$$;

-- ------------------------------------------------
-- Metadata
-- ------------------------------------------------
insert into public.ldm_system_meta(key, value)
values
    ('live_sync_stage','13'),
    ('schema_version','13'),
    ('schema_status','production_hardening_ready'),
    ('audit_authority','public.audit_events'),
    ('cloud_health_rpc','ldm_system_health'),
    ('cloud_snapshot_rpc','ldm_export_store_snapshot'),
    ('cloud_snapshot_restore_mode','manual_controlled_only'),
    ('production_readiness','enabled'),
    ('shift_management','removed')
on conflict (key)
do update set value=excluded.value, updated_at=now();

commit;

select *
from public.ldm_system_meta
where key in (
    'live_sync_stage','schema_version','schema_status','audit_authority',
    'cloud_health_rpc','cloud_snapshot_rpc','cloud_snapshot_restore_mode',
    'production_readiness','shift_management'
)
order by key;

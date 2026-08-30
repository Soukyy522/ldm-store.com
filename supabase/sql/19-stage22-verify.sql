-- LocDailyMar TAHAP 22 - Verifikasi Multi-Toko + Transfer Stok

-- 1. Struktur utama: seluruh hasil harus true.
select
    to_regclass('public.store_networks') is not null as store_networks_ok,
    to_regclass('public.store_network_stores') is not null as network_stores_ok,
    to_regclass('public.store_memberships') is not null as memberships_ok,
    to_regclass('public.active_store_sessions') is not null as active_sessions_ok,
    to_regclass('public.stock_transfers') is not null as transfers_ok,
    to_regclass('public.stock_transfer_items') is not null as transfer_items_ok;

-- 2. RPC: seluruh hasil harus true.
select
    to_regprocedure('public.ldm_my_network_stores()') is not null as list_stores_rpc_ok,
    to_regprocedure('public.ldm_create_branch_store(text,text,boolean)') is not null as create_branch_rpc_ok,
    to_regprocedure('public.ldm_switch_store(uuid,text)') is not null as switch_store_rpc_ok,
    to_regprocedure('public.ldm_create_stock_transfer(uuid,jsonb,text)') is not null as create_transfer_rpc_ok,
    to_regprocedure('public.ldm_send_stock_transfer(uuid)') is not null as send_transfer_rpc_ok,
    to_regprocedure('public.ldm_receive_stock_transfer(uuid)') is not null as receive_transfer_rpc_ok,
    to_regprocedure('public.ldm_cancel_stock_transfer(uuid,text)') is not null as cancel_transfer_rpc_ok;

-- 3. RLS harus aktif.
select relname,relrowsecurity
from pg_class
where oid in (
    'public.store_networks'::regclass,
    'public.store_network_stores'::regclass,
    'public.store_memberships'::regclass,
    'public.active_store_sessions'::regclass,
    'public.stock_transfers'::regclass,
    'public.stock_transfer_items'::regclass
)
order by relname;

-- 4. Setiap profile lama harus mempunyai membership home store.
select p.id,p.username,p.store_id,p.role
from public.profiles p
left join public.store_memberships sm
  on sm.user_id=p.id and sm.store_id=p.store_id
where p.deleted_at is null and sm.user_id is null;
-- Hasil yang benar: 0 baris.

-- 5. Setiap toko harus terhubung ke jaringan.
select s.id,s.code,s.name
from public.stores s
left join public.store_network_stores sns on sns.store_id=s.id
where s.deleted_at is null and sns.store_id is null;
-- Hasil yang benar: 0 baris.

-- 6. Nilai movement transfer harus diterima constraint.
select pg_get_constraintdef(oid) as movement_constraint
from pg_constraint
where conrelid='public.stock_movements'::regclass
  and conname='stock_movements_movement_type_check';

-- 7. Metadata tahap.
select key,value from public.ldm_system_meta
where key in ('live_sync_stage','schema_status','schema_version','store_authority','stock_transfer_authority')
order by key;

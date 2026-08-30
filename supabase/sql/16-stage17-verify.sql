-- TAHAP 17 verification — seluruh kolom status utama diharapkan PASS.

select case when count(*)=7 then 'PASS' else 'FAIL' end as metadata_stage17,count(*) as metadata_count
from public.ldm_system_meta where (key,value) in (values
 ('live_sync_stage','17'),('schema_version','17'),('schema_status','sync_conflict_recovery_ready'),
 ('sync_conflict_authority','public.sync_conflicts'),('sync_recovery_roles','owner_admin_user_source'),
 ('sync_recovery_discard_policy','owner_only_server_blocked'),('sync_recovery_payload_policy','digest_and_summary_only'));

select case when c.relrowsecurity then 'PASS' else 'FAIL' end as sync_conflicts_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='sync_conflicts';

select case when count(*)=1 then 'PASS' else 'FAIL' end as scoped_select_policy
from pg_policies where schemaname='public' and tablename='sync_conflicts' and policyname='sync_conflicts_select_scoped';

select p.proname,
       case when p.prosecdef and exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) x where x='search_path=""') then 'PASS' else 'FAIL' end as hardened
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ldm_record_sync_conflict','ldm_sync_conflict_action','ldm_mark_sync_conflict_recovered','ldm_block_discarded_offline_sale')
order by p.proname;

select case when count(*)=1 then 'PASS' else 'FAIL' end as discarded_server_guard
from pg_trigger where tgrelid='public.transactions'::regclass and tgname='trg_block_discarded_offline_sale' and not tgisinternal;

select status,count(*) as total from public.sync_conflicts group by status order by status;

select case when count(*)=0 then 'PASS' else 'FAIL' end as resolved_without_cloud_transaction,count(*) as invalid_count
from public.sync_conflicts where status='resolved' and cloud_transaction_id is null;

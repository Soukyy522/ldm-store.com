-- LocDailyMar TAHAP 19: FULL QA, SECURITY & PERFORMANCE
-- AUDIT BACA-SAJA. Script ini tidak membuat, mengubah, atau menghapus data.
-- Jalankan melalui Supabase Dashboard > SQL Editor sebagai pemilik project.

-- 1. Semua tabel public yang terekspos seharusnya menggunakan RLS.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
order by c.relrowsecurity,c.relname;

-- 2. Hak tabel untuk anon/authenticated. Pastikan sesuai kebutuhan paling minimum.
select grantee,table_name,string_agg(privilege_type,', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
group by grantee,table_name order by table_name,grantee;

-- 3. Daftar policy RLS dan role yang dicakup.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' order by tablename,policyname;

-- 4. SECURITY DEFINER tanpa search_path tetap berisiko terkena object shadowing.
select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as arguments,
       coalesce(array_to_string(p.proconfig,', '),'(belum ditetapkan)') as configuration
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
order by p.proname;

-- 5. Fungsi public yang dapat dieksekusi PUBLIC/anon. Tinjau apakah memang dibutuhkan.
-- Pada ACL PostgreSQL, grantee OID 0 berarti pseudo-role PUBLIC.
select n.nspname as schema_name,p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       bool_or(x.grantee=0 and x.privilege_type='EXECUTE') as executable_by_public,
       bool_or(r.rolname='anon' and x.privilege_type='EXECUTE') as executable_by_anon
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
left join pg_roles r on r.oid=x.grantee
where n.nspname='public'
group by n.nspname,p.oid,p.proname
having bool_or(x.privilege_type='EXECUTE' and (x.grantee=0 or r.rolname='anon'))
order by p.proname;

-- 6. Ukuran dan statistik scan: seq_scan tinggi pada tabel besar dapat menandakan index perlu ditinjau.
select relname as table_name,n_live_tup,n_dead_tup,seq_scan,idx_scan,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       case when seq_scan+idx_scan=0 then 0 else round(100.0*idx_scan/(seq_scan+idx_scan),2) end as index_scan_percent
from pg_stat_user_tables where schemaname='public'
order by pg_total_relation_size(relid) desc;

-- 7. Index yang belum pernah dipakai sejak statistik terakhir direset (bukan otomatis boleh dihapus).
select relname as table_name,indexrelname as index_name,idx_scan,pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes where schemaname='public' and idx_scan=0
order by pg_relation_size(indexrelid) desc;

-- 8. Foreign key tanpa index berawalan kolom FK. Validasi manual untuk FK multikolom.
select conrelid::regclass as table_name,conname as foreign_key,pg_get_constraintdef(oid) as definition
from pg_constraint c
where contype='f' and connamespace='public'::regnamespace
  and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indkey::smallint[] @> c.conkey)
order by conrelid::regclass::text,conname;

-- 9. Profile tanpa auth.users dan user Auth tanpa profile.
select 'profile_without_auth_user' as issue,count(*) as total
from public.profiles p left join auth.users u on u.id=p.id where u.id is null
union all
select 'auth_user_without_profile',count(*)
from auth.users u left join public.profiles p on p.id=u.id where p.id is null;

-- Catatan akhir:
-- A. Hasil kosong pada query risiko biasanya baik, tetapi tetap periksa konteks aplikasi.
-- B. Jalankan juga Database > Security Advisor dan Performance Advisor di Dashboard Supabase.
-- C. Jangan menghapus policy/index/function hanya berdasarkan audit ini tanpa backup dan uji staging.

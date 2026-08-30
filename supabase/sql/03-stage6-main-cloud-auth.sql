-- ================================================================
-- LocDailyMar - Live Sync Tahap 6
-- Main Login -> Supabase Auth
-- Role Authority -> public.profiles.role
--
-- Prasyarat:
--   Tahap 4 dan Tahap 5 sudah berhasil.
--
-- Tahap ini tidak memindahkan data Barang/transaksi.
-- ================================================================

begin;

do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'public.profiles belum ada. Jalankan Tahap 4.';
    end if;

    if to_regclass('public.devices') is null then
        raise exception 'public.devices belum ada. Jalankan Tahap 4.';
    end if;
end
$$;

-- Pastikan helper Auth hanya dapat digunakan user authenticated.
revoke all on function public.ldm_my_context() from public, anon;
revoke all on function public.ldm_register_device(text, text, text) from public, anon;
revoke all on function public.ldm_my_devices() from public, anon;

grant execute on function public.ldm_my_context() to authenticated;
grant execute on function public.ldm_register_device(text, text, text) to authenticated;
grant execute on function public.ldm_my_devices() to authenticated;

-- Metadata otoritas Auth.
insert into public.ldm_system_meta (key, value)
values
    ('live_sync_stage', '6'),
    ('schema_status', 'main_cloud_auth_ready'),
    ('schema_version', '6'),
    ('auth_mode', 'supabase_auth_primary'),
    ('main_login_mode', 'supabase_auth'),
    ('role_authority', 'public.profiles.role'),
    ('local_role_mode', 'compatibility_cache_only')
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
    'auth_mode',
    'main_login_mode',
    'role_authority',
    'local_role_mode'
)
order by key;

-- LocDailyMar - Live Sync Tahap 3
-- Minimal system metadata used only to verify browser <-> Supabase connectivity.
-- Business tables are intentionally NOT created yet.

begin;

create table if not exists public.ldm_system_meta (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

insert into public.ldm_system_meta (key, value)
values
    ('app_name', 'LocDailyMar'),
    ('live_sync_stage', '3'),
    ('schema_status', 'supabase_connection_ready')
on conflict (key)
do update set
    value = excluded.value,
    updated_at = now();

alter table public.ldm_system_meta enable row level security;

-- Least privilege: browser clients may only SELECT metadata.
revoke all on table public.ldm_system_meta from anon, authenticated;
grant select on table public.ldm_system_meta to anon, authenticated;

-- Recreate a narrow read policy so rerunning this file is safe.
drop policy if exists "ldm_system_meta_read" on public.ldm_system_meta;
create policy "ldm_system_meta_read"
on public.ldm_system_meta
for select
to anon, authenticated
using (true);

commit;

-- Expected manual verification in SQL Editor:
-- select * from public.ldm_system_meta order by key;

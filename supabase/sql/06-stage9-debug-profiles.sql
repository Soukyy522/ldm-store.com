-- LocDailyMar Tahap 9 - DEBUG PROFILE

-- Semua profile + store/status
select
    u.email, p.id, p.username, lower(btrim(p.username)) as normalized_username,
    p.role, p.active, p.deleted_at, p.store_id,
    s.code as store_code, s.name as store_name
from public.profiles p
left join auth.users u on u.id = p.id
left join public.stores s on s.id = p.store_id
order by s.code, lower(p.username);

-- Profile aktif pada LDM-DEFAULT
select
    p.id, p.username, p.role, p.active, p.deleted_at, p.store_id, s.code as store_code
from public.profiles p
join public.stores s on s.id = p.store_id
where s.code = 'LDM-DEFAULT'
  and p.active = true
  and p.deleted_at is null
order by lower(p.username);

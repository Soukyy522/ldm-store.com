-- LocDailyMar Tahap 27 - Verifikasi NIK Karyawan

select
    count(*) as total_profile,
    count(employee_id) as total_punya_nik,
    count(*) filter (where employee_id !~ '^[0-9]{11}$') as format_tidak_valid,
    count(*) - count(distinct (employee_origin_store_id, employee_id)) as duplikat_dalam_store
from public.profiles;

select
    s.code as store_code,
    c.last_number as nomor_karyawan_terakhir,
    count(p.id) as akun_saat_ini
from public.ldm_employee_counters c
join public.stores s on s.id = c.store_id
left join public.profiles p on p.store_id = c.store_id
group by s.code, c.last_number
order by s.code;

select
    p.employee_id as nik_karyawan,
    p.username,
    p.display_name,
    p.role,
    s.code as store_code,
    p.created_at
from public.profiles p
join public.stores s on s.id = p.store_id
order by s.code, p.employee_id;

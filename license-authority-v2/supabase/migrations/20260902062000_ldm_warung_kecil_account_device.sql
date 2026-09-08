-- LocDailyMar 27.4.0
update public.ldm2_plans
set features = case
    when jsonb_typeof(features) <> 'array' then '["cloud_accounts","cloud_devices"]'::jsonb
    else (
      select jsonb_agg(value order by value)
      from (
        select distinct value
        from jsonb_array_elements_text(features || '["cloud_accounts","cloud_devices"]'::jsonb) as t(value)
      ) q
    )
  end,
  max_devices = greatest(coalesce(max_devices,0),2),
  updated_at = now()
where code='WARUNG_KECIL';

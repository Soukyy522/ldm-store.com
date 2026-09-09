-- VERIFY V28.3.2 PUBLIC CONTACT SETTINGS
select
  id,
  whatsapp_enabled,
  whatsapp_number,
  email_enabled,
  email_address,
  support_center_enabled,
  guide_enabled,
  license_enabled,
  revision,
  updated_at
from public.ldm2_public_contact_settings
where id='global';

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name='ldm2_public_contact_settings'
order by grantee, privilege_type;

-- LocDailyMar V28.3.2
-- PUBLIC CONTACT SETTINGS - LICENSE AUTHORITY
-- Jalankan pada project License Authority: vplweadbeujidsoponrl
-- BUKAN pada App Supabase xwzighiqmxemnblzgcrf.

begin;

create table if not exists public.ldm2_public_contact_settings (
  id text primary key default 'global' check (id = 'global'),

  whatsapp_enabled boolean not null default true,
  whatsapp_number varchar(20) not null default '6287874352468',
  whatsapp_display varchar(40) not null default '+62 878-7435-2468',
  whatsapp_label varchar(60) not null default 'WhatsApp Support',
  whatsapp_greeting varchar(240) not null default 'Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar.',

  email_enabled boolean not null default false,
  email_address varchar(160) not null default '',
  email_label varchar(60) not null default 'Email Support',
  email_subject varchar(160) not null default 'Pertanyaan mengenai LocDailyMar',

  support_center_enabled boolean not null default true,
  support_center_label varchar(70) not null default 'Pusat Bantuan & Support',
  guide_enabled boolean not null default true,
  guide_label varchar(70) not null default 'Panduan Pengguna',
  license_enabled boolean not null default true,
  license_label varchar(70) not null default 'Lisensi & Paket',

  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  updated_by_email text null,

  constraint ldm2_public_contact_whatsapp_number_chk check (
    (not whatsapp_enabled) or whatsapp_number ~ '^[0-9]{8,20}$'
  ),
  constraint ldm2_public_contact_email_chk check (
    (not email_enabled) or email_address ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint ldm2_public_contact_at_least_one_channel_chk check (
    whatsapp_enabled or email_enabled or support_center_enabled or guide_enabled or license_enabled
  )
);

comment on table public.ldm2_public_contact_settings is
'Konfigurasi kontak publik LocDailyMar. Tidak menyimpan secret. Perubahan hanya melalui Developer Center terautentikasi.';

alter table public.ldm2_public_contact_settings enable row level security;

-- Browser customer tidak boleh membaca/menulis tabel secara langsung.
-- Public read dilakukan melalui Edge Function ldm-public-contact yang hanya
-- mengembalikan field yang memang publik.
revoke all on table public.ldm2_public_contact_settings from anon, authenticated;
grant select, insert, update on table public.ldm2_public_contact_settings to service_role;

insert into public.ldm2_public_contact_settings (id)
values ('global')
on conflict (id) do nothing;

create or replace function public.ldm2_update_public_contact_settings(
  p_whatsapp_enabled boolean,
  p_whatsapp_number text,
  p_whatsapp_display text,
  p_whatsapp_label text,
  p_whatsapp_greeting text,
  p_email_enabled boolean,
  p_email_address text,
  p_email_label text,
  p_email_subject text,
  p_support_center_enabled boolean,
  p_support_center_label text,
  p_guide_enabled boolean,
  p_guide_label text,
  p_license_enabled boolean,
  p_license_label text,
  p_updated_by_user_id uuid default null,
  p_updated_by_email text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.ldm2_public_contact_settings%rowtype;
  v_wa_number text := regexp_replace(coalesce(p_whatsapp_number,''), '[^0-9]', '', 'g');
  v_email text := lower(trim(coalesce(p_email_address,'')));
begin
  if coalesce(p_whatsapp_enabled,false) and v_wa_number !~ '^[0-9]{8,20}$' then
    raise exception 'Nomor WhatsApp harus menggunakan format internasional berupa 8-20 digit tanpa tanda +.';
  end if;

  if coalesce(p_email_enabled,false) and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Format Email Support tidak valid.';
  end if;

  if not (
    coalesce(p_whatsapp_enabled,false)
    or coalesce(p_email_enabled,false)
    or coalesce(p_support_center_enabled,false)
    or coalesce(p_guide_enabled,false)
    or coalesce(p_license_enabled,false)
  ) then
    raise exception 'Aktifkan minimal satu jalur kontak publik.';
  end if;

  insert into public.ldm2_public_contact_settings (
    id,
    whatsapp_enabled, whatsapp_number, whatsapp_display, whatsapp_label, whatsapp_greeting,
    email_enabled, email_address, email_label, email_subject,
    support_center_enabled, support_center_label,
    guide_enabled, guide_label,
    license_enabled, license_label,
    revision, updated_at, updated_by_user_id, updated_by_email
  ) values (
    'global',
    coalesce(p_whatsapp_enabled,false), left(v_wa_number,20), left(trim(coalesce(p_whatsapp_display,'')),40), left(trim(coalesce(p_whatsapp_label,'')),60), left(trim(coalesce(p_whatsapp_greeting,'')),240),
    coalesce(p_email_enabled,false), left(v_email,160), left(trim(coalesce(p_email_label,'')),60), left(trim(coalesce(p_email_subject,'')),160),
    coalesce(p_support_center_enabled,false), left(trim(coalesce(p_support_center_label,'')),70),
    coalesce(p_guide_enabled,false), left(trim(coalesce(p_guide_label,'')),70),
    coalesce(p_license_enabled,false), left(trim(coalesce(p_license_label,'')),70),
    1, now(), p_updated_by_user_id, lower(trim(coalesce(p_updated_by_email,'')))
  )
  on conflict (id) do update set
    whatsapp_enabled = excluded.whatsapp_enabled,
    whatsapp_number = excluded.whatsapp_number,
    whatsapp_display = excluded.whatsapp_display,
    whatsapp_label = excluded.whatsapp_label,
    whatsapp_greeting = excluded.whatsapp_greeting,
    email_enabled = excluded.email_enabled,
    email_address = excluded.email_address,
    email_label = excluded.email_label,
    email_subject = excluded.email_subject,
    support_center_enabled = excluded.support_center_enabled,
    support_center_label = excluded.support_center_label,
    guide_enabled = excluded.guide_enabled,
    guide_label = excluded.guide_label,
    license_enabled = excluded.license_enabled,
    license_label = excluded.license_label,
    revision = public.ldm2_public_contact_settings.revision + 1,
    updated_at = now(),
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_email = excluded.updated_by_email
  returning * into v_row;

  return jsonb_build_object(
    'version','1.0',
    'revision',v_row.revision,
    'updated_at',v_row.updated_at,
    'whatsapp',jsonb_build_object(
      'enabled',v_row.whatsapp_enabled,
      'number',v_row.whatsapp_number,
      'display',v_row.whatsapp_display,
      'label',v_row.whatsapp_label,
      'greeting',v_row.whatsapp_greeting
    ),
    'email',jsonb_build_object(
      'enabled',v_row.email_enabled,
      'address',v_row.email_address,
      'label',v_row.email_label,
      'subject',v_row.email_subject
    ),
    'support_center',jsonb_build_object('enabled',v_row.support_center_enabled,'label',v_row.support_center_label),
    'guide',jsonb_build_object('enabled',v_row.guide_enabled,'label',v_row.guide_label),
    'license',jsonb_build_object('enabled',v_row.license_enabled,'label',v_row.license_label)
  );
end;
$$;

revoke all on function public.ldm2_update_public_contact_settings(
  boolean,text,text,text,text,boolean,text,text,text,boolean,text,boolean,text,boolean,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.ldm2_update_public_contact_settings(
  boolean,text,text,text,text,boolean,text,text,text,boolean,text,boolean,text,boolean,text,uuid,text
) to service_role;

commit;

# Tahap 14 - Cloud Account Management

Tahap 14 menjadikan `auth.users` + `public.profiles` sebagai authority manajemen akun yang dipakai UI Owner. `localStorage.daftarAkun` hanya compatibility cache.

## Model keamanan

Frontend tidak memakai `service_role`. Auth User baru dibuat dari Supabase Dashboard, lalu Owner menghubungkannya dengan profile melalui `ldm_account_link_existing_auth()`.

Owner dapat mengubah username, display name, role, dan status melalui `ldm_account_update_profile()`. Server melindungi Owner aktif terakhir dan mencegah Owner yang sedang login menonaktifkan/demote dirinya sendiri.

## Password

Password user lain tidak dapat dibaca atau ditetapkan Owner. User dapat mengubah password sendiri melalui Supabase Auth. Recovery memakai `resetPasswordForEmail()` dan halaman `account-password-reset.html`.

## Audit

Perubahan profile otomatis masuk `public.audit_events` melalui audit trigger Tahap 13.

## Realtime

`public.profiles` ditambahkan ke `supabase_realtime`.

## Shift

Tidak ada Shift Management. Shift tetap label saja.

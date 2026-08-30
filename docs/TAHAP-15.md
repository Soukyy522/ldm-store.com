# Tahap 15 - Cloud Devices + Account Automation

## Perbaikan layar putih
`account-management.html` sebelumnya memiliki class `secure-page-pending`, tetapi guard hanya melepas `ldm-cloud-auth-pending`. Tahap 15 melepas keduanya setelah Auth berhasil.

## Hak akses Akun Cloud
- Owner: lihat semua, buat, edit, reset password, hapus/nonaktifkan.
- Admin: baca daftar akun satu store, email user lain disembunyikan, tanpa aksi perubahan.
- Kasir: hanya profile sendiri + ganti password sendiri.

## Device linking
- Semua device BARU, termasuk Owner, masuk `pending`.
- Device yang sudah terdaftar sebelum Tahap 15 mempertahankan status `active`, sehingga Device A tetap dapat melakukan approval.
- Owner membuka `device-management.html`, membuat grup, lalu menekan Hubungkan.
- Owner dapat memutus device menjadi `revoked`.
- Device pending/revoked diarahkan ke `device-access.html`.
- Grup hanya mengorganisasi/gating device. Data tetap live-sync berdasarkan store Supabase, bukan PeerJS/localStorage transfer.

## Auth account automation
Pembuatan/penghapusan Auth User tidak dilakukan dengan secret key di browser. `account-management.html` memanggil Edge Function `ldm-account-admin`.

Delete memiliki dua hasil:
1. `hard_deleted`: tidak ada histori yang memblokir, Auth User benar-benar dihapus.
2. `disabled_preserved_history`: ada foreign-key histori atau pembatas lain, profile dinonaktifkan dan Auth diblokir agar audit bisnis tidak rusak.


## Recovery Device A

Upgrade normal mempertahankan device yang sudah `active`. Pada instalasi fresh, jika semua device termasuk Owner menjadi `pending`, aktifkan satu Device A Owner secara manual dari SQL Editor menggunakan UUID device yang sudah diverifikasi. Setelah itu approval device lain dilakukan dari `device-management.html`.

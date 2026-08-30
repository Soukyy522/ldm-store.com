# Patch 20.1 — Navigasi Global Sesuai Role

Paket ini kembali memakai dasar Tahap 20. Fitur **Kontrol Keuangan / Finance Control tidak disertakan**.

## Tujuan

- Menampilkan Aplikasi & Update, Recovery Center, serta QA & Security pada seluruh halaman operasional.
- Menyamakan menu desktop dan HP.
- Menyembunyikan menu yang tidak boleh digunakan oleh role aktif.
- Menghindari penyalinan aturan navigasi yang berbeda-beda pada setiap HTML.

## Aturan role

| Menu | Owner | Admin | Kasir |
|---|:---:|:---:|:---:|
| Dashboard | Ya | Ya | Ya |
| Absensi | Ya | Ya | Ya |
| Kasir | Ya | Ya | Ya |
| Retur | Ya | Ya | Ya |
| Barang | Ya | Ya | Tidak |
| Supplier | Ya | Ya | Tidak |
| Purchase Order | Ya | Ya | Tidak |
| Goods Receipt | Ya | Ya | Tidak |
| Kartu Stok | Ya | Ya | Ya |
| Stock Opname | Ya | Ya | Ya |
| Laporan | Ya | Ya | Ya |
| Closing Shift | Ya | Ya | Tidak |
| End of Day | Ya | Ya | Tidak |
| Pengeluaran | Ya | Ya | Tidak |
| Backup & Restore | Ya | Ya | Tidak |
| Aplikasi & Update | Ya | Ya | Ya |
| Recovery Center | Ya | Ya | Ya |
| QA & Security | Ya | Tidak | Tidak |

Recovery Center tetap mengikuti otoritas Tahap 17: Owner dapat retry/discard sesuai aturan, Admin dapat retry tetapi tidak discard, dan Kasir hanya melihat konflik miliknya serta dapat retry.

## Cara memasang

1. Gunakan paket lengkap, atau ekstrak paket patch ke folder utama aplikasi.
2. Pertahankan struktur folder `js/global-system-navigation.js`.
3. Izinkan penggantian file HTML dan `service-worker.js` lama.
4. Buka Aplikasi & Update, lalu pasang pembaruan versi `20.1.0`.
5. Login bergantian sebagai Owner, Admin, dan Kasir untuk memeriksa daftar menu.

Jika SQL Finance Control sebelumnya sudah terlanjur dijalankan dan tabelnya juga ingin dihapus, backup database lalu jalankan `optional-cleanup/OPTIONAL-ROLLBACK-STAGE28-FINANCE.sql`. Jangan jalankan file tersebut bila hanya ingin menyembunyikan/menghapus halaman dari aplikasi.

## Keamanan

Penyembunyian menu hanya mengatur antarmuka. Pemeriksaan role pada halaman, RPC, dan RLS Supabase tetap harus aktif agar URL tidak dapat digunakan untuk melewati izin.

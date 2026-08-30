# Tahap 18 - PWA Installation & Safe Update Manager

Tahap 18 membuat LocDailyMar dapat dipasang seperti aplikasi dari browser yang
mendukung PWA. Update tidak diaktifkan otomatis ketika masih ada transaksi
offline atau reservasi stok lokal.

> Catatan historis: Tahap 18 awalnya dibangun langsung dari Tahap 16. Tahap 17 kemudian
> ditambahkan setelah Tahap 19 menggunakan baseline terbaru.

## Alur update aman

1. Browser menemukan `service-worker.js` versi baru.
2. Worker baru selesai mengunduh lalu masuk status `waiting`.
3. PWA Manager menampilkan pemberitahuan, tetapi tidak langsung reload.
4. Saat pengguna menekan **Perbarui**, sistem membaca status IndexedDB queue dan
   reservasi stok perangkat.
5. Jika masih ada data belum sinkron, update ditolak dan pengguna diminta
   reconnect/sinkron dahulu.
6. Jika aman, worker menerima pesan `LDM_SKIP_WAITING`, aktif, lalu halaman
   dimuat ulang satu kali.

## Berkas utama

- `manifest.json`: metadata instalasi, scope, ikon, dan shortcut.
- `assets/icons/*`: ikon 192, 512, dan maskable.
- `js/pwa-manager.js`: install prompt, update detection, queue guard, storage.
- `service-worker.js`: app shell, runtime cache, offline navigation, sync event.
- `pwa-settings.html`: UI instalasi dan diagnostik.
- `offline.html`: fallback halaman ketika navigasi tidak tersedia offline.
- `js/offline-queue.js`: memberi PWA Manager hitungan data belum sinkron.

## Strategi cache

- Navigasi HTML: network-first, kemudian cache, terakhir `offline.html`.
- Aset aplikasi: cache-first dan disimpan dalam runtime cache.
- Request Supabase (`*.supabase.co`): tidak pernah dicache oleh Service Worker.
- Cache lama dengan awalan `ldm-`: dibersihkan saat worker baru aktif.
- Tombol **Bersihkan Cache Aman** hanya menghapus runtime cache bernama
  `ldm-*-runtime-*`; app shell offline, IndexedDB, localStorage, akun, produk,
  dan laporan tetap dipertahankan.

## Batasan

- Service Worker hanya aktif pada HTTPS atau localhost.
- Tombol install ditentukan browser. Safari iOS memakai menu Bagikan lalu
  **Tambahkan ke Layar Utama**.
- PWA bukan pengganti sinkronisasi cloud. Data offline tetap lokal sampai
  status antrean menjadi tersinkron.
- Uji browser langsung tetap wajib setelah GitHub Pages selesai deploy.

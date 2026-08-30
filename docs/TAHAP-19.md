# TAHAP 19 — Full QA, Security & Performance

## Tujuan

Tahap 19 adalah gerbang kualitas sebelum aplikasi dipakai lebih luas. Cakupannya meliputi validitas file frontend, keamanan sesi dan konfigurasi browser, Row Level Security (RLS), status perangkat, antrean offline, PWA, error runtime, dan performa.

## Komponen baru

- `qa-security-performance.html`: panel diagnosis baca-saja khusus Owner.
- `js/security-hardening.js`: referrer policy, hardening tautan eksternal, autocomplete password, dan diagnosis tanpa membocorkan secret.
- `js/qa-runtime.js`: pengukuran LCP, INP, CLS, TTFB, long task, dan error runtime; maksimum 30 snapshot lokal.
- `tools/qa-stage19.mjs`: audit file lokal, sintaks JavaScript, referensi aset, manifest, pola secret, dan masalah tag script.
- `supabase/sql/15-stage19-full-qa-security-performance-audit.sql`: audit RLS, grants, policy, fungsi, index, statistik scan, dan profile orphan. Seluruh query baca-saja.

## Perbaikan baseline

- Menambahkan `style.css`, `setting.js`, dan `employee-id.js` yang sebelumnya direferensikan tetapi tidak tersedia.
- Memperbaiki `kasir.html` agar kode inline tidak berada dalam tag `script` yang juga memiliki `src`.
- Menghapus akun contoh lokal dengan password default dari instalasi browser baru.
- Penyimpanan akun lokal pada Dashboard menggunakan hash, bukan field password plaintext.
- Menambahkan teks alternatif pada preview gambar Absensi.

## Batas aman

Publishable/anon key Supabase memang digunakan browser. `service_role` atau secret key tidak boleh berada di HTML/JavaScript. Panel QA tidak menampilkan nilai key atau token.

RLS wajib aktif pada tabel public yang diakses API, tetapi RLS bukan satu-satunya lapisan: grants dan fungsi RPC tetap harus diperiksa. Hasil query `products` pada panel hanya membuktikan koneksi dan akses user saat itu, bukan membuktikan semua policy benar.

Content Security Policy ketat belum diaktifkan karena halaman lama masih memakai banyak inline script/style/event handler. Memasang CSP ketat sekarang dapat mematikan fitur. Refactor ke file eksternal dan nonce/hash perlu dilakukan pada tahap hardening lanjutan sebelum CSP enforcing dipakai.

## Target performa

- LCP baik: maksimal 2.500 ms.
- INP baik: maksimal 200 ms.
- CLS baik: maksimal 0,1.
- Pengukuran panel adalah data browser saat ini. Gunakan Lighthouse dan data pengguna nyata untuk keputusan produksi.

## Definisi status

- PASS: pemeriksaan saat ini memenuhi syarat.
- WARN: data belum tersedia atau ada risiko yang harus ditinjau.
- FAIL: masalah yang harus diperbaiki sebelum rilis.

TAHAP 17 kemudian diimplementasikan di atas paket TAHAP 19 terbaru sebagai release 19.1.0.

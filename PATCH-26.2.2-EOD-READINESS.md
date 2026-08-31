# LocDailyMar 26.2.2 — Perbaikan EOD Readiness

## Masalah 26.2.1
Menu End of Day memakai syarat tambahan `Shift 1 && Shift 2`. Akibatnya EOD tetap tersembunyi walaupun seluruh akun yang benar-benar bertransaksi sudah Closing Shift, misalnya saat operasional hanya memakai Shift 1 atau Full Day.

## Aturan 26.2.2
EOD sekarang mengikuti pasangan **akun + shift yang benar-benar mempunyai transaksi pada hari tersebut**:

- Transaksi Shift 1 -> Closing Shift 1 akun yang sama wajib selesai.
- Transaksi Shift 2 -> Closing Shift 2 akun yang sama wajib selesai.
- Transaksi Full Day -> Closing Full Day akun yang sama wajib selesai.
- Closing Full Day dapat memenuhi kebutuhan Shift 1/Shift 2 milik akun yang sama.
- Shift yang tidak mempunyai transaksi tidak menjadi syarat EOD.
- Jika belum ada transaksi hari itu, EOD tetap belum tersedia.

Perbaikan diterapkan pada navigasi global, 15 halaman yang memiliki fallback EOD readiness, `eod.html`, PWA cache, dan fungsi server `public.ldm_finalize_end_of_day(text)`.

## SQL wajib
Jalankan pada project **Supabase Cloud Data Toko**:

1. `supabase/sql/26-stage26.2.2-eod-transaction-readiness.sql`
2. `supabase/sql/26-stage26.2.2-eod-transaction-readiness-verify.sql`

SQL patch wajib karena versi 26.2.1 juga masih memaksa Shift 1 + Shift 2 pada fungsi database `ldm_finalize_end_of_day`.

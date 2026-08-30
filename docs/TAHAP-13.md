# Tahap 13 - Production Hardening

Tahap 12 sudah menyelesaikan cloud authority bisnis utama. Tahap 13 menambahkan lapisan operasional untuk penggunaan yang lebih siap produksi.

## Fitur

- Append-only `public.audit_events`
- Audit trigger pada entity bisnis high-level
- `ldm_system_health()` untuk consistency/security checks
- `ldm_export_store_snapshot()` Owner-only
- `cloud-control-center.html`
- Realtime audit events
- Penegasan bahwa backup/restore lama adalah cache lokal, bukan cloud authority

## Audit

Audit mulai merekam event setelah SQL Tahap 13 dipasang. Tahap ini tidak mengarang histori audit untuk operasi sebelum Tahap 13.

## Cloud Snapshot

Snapshot berisi data database store dan manifest file Storage. Binary foto/nota tidak dimasukkan. Credential Auth dan secret juga tidak dimasukkan.

Auto-restore cloud sengaja tidak disediakan karena relasi transaksi, stok, retur, closing, dan ledger harus dipulihkan dalam prosedur recovery yang terkontrol.

## Health

Status `HEALTHY` mengharapkan check berikut bernilai 0:

- stock ledger mismatch
- orphan transaction items
- orphan return items
- orphan goods receipt items
- duplicate final closing
- duplicate final EOD
- RLS disabled tables
- Realtime missing tables

Pending workflow bukan corruption dan ditampilkan terpisah.

## Shift

Tidak ada Shift Management. Shift tetap label saja.

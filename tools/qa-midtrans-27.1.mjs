import fs from "node:fs";
import vm from "node:vm";

const required = [
  "license-authority-v2/supabase/migrations/20260902010000_ldm_midtrans_auto_payment.sql",
  "license-authority-v2/supabase/functions/ldm-license-admin-v2/index.ts",
  "license-authority-v2/supabase/functions/ldm-midtrans-webhook/index.ts",
  "license-authority-v2/supabase/functions/ldm-license-v2/index.ts",
  "license-authority-v2/supabase/config.toml",
  "license-authority-v2/SQL-07-ONBOARDING-MIDTRANS-CUSTOMER.sql",
  "license-authority-v2/SQL-08-VERIFY-MIDTRANS-AUTO.sql",
  "developer-license-v2.html",
  "js/license-v2-admin.js",
  "js/license-v2-admin-config.js",
  "PANDUAN-MIDTRANS-OTOMATIS-27.1.txt",
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`File tidak ditemukan: ${file}`);
}

function requireText(file, markers) {
  const source = fs.readFileSync(file, "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file}: marker tidak ditemukan: ${marker}`);
  }
  return source;
}

if (!failures.length) {
  const sql = requireText(required[0], [
    "create table if not exists public.ldm2_payments",
    "ldm2_create_purchase_order",
    "ldm2_create_renewal_order",
    "ldm2_create_trial_conversion_order",
    "ldm2_apply_midtrans_notification",
    "processed_at is not null",
    "LICENSE_ACTIVATED_BY_PAYMENT",
    "LICENSE_RENEWED_BY_PAYMENT",
    "primary_store_id",
    "network_id",
    "create or replace function public.ldm2_start_trial",
    "DUPLICATE_STORE_CODE_MIGRATED",
  ]);
  if ((sql.match(/\$\$/g) || []).length % 2 !== 0) failures.push("SQL migration: pasangan $$ tidak seimbang.");
  if (!/^begin;[\s\S]*commit;/im.test(sql)) failures.push("SQL migration: transaksi begin/commit tidak lengkap.");

  const admin = requireText(required[1], [
    "MIDTRANS_SERVER_KEY",
    "/snap/v1/transactions",
    'action === "issue" || action === "issue_payment"',
    'action === "renew" || action === "renew_payment"',
    'action === "convert_trial_payment"',
    "ldm2_create_purchase_order",
    "ldm2_create_renewal_order",
  ]);
  const webhook = requireText(required[2], [
    'crypto.subtle.digest("SHA-512"',
    "constantEqual",
    "/status",
    "ldm2_apply_midtrans_notification",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  if (/MIDTRANS_SERVER_KEY\s*[:=]\s*["'][^"']{10,}/.test(`${admin}\n${webhook}`)) {
    failures.push("Server Key Midtrans tampak ditulis langsung pada source code.");
  }

  requireText(required[3], ["LICENSE_PENDING_PAYMENT"]);
  requireText(required[4], ["[functions.ldm-midtrans-webhook]", "verify_jwt = false"]);
  requireText(required[5], ["v_store_id uuid", "v_network_id uuid", "insert into public.stores"]);
  requireText(required[6], ["paid_belum_diproses", "store_id_kosong", "network_id_kosong"]);
  requireText(required[7], ["Generate & Buat Pembayaran", "issue_payment", "renew_payment", "convert_trial_payment", "Store ID", "Network ID", "safeUrl"]);
  requireText(required[10], ["MIDTRANS_SERVER_KEY", "Payment Notification URL", "Sandbox", "SQL-07-ONBOARDING-MIDTRANS-CUSTOMER.sql"]);

  for (const file of ["js/license-v2-admin.js", "js/license-v2-admin-config.js", "service-worker.js"]) {
    try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }); }
    catch (error) { failures.push(`${file}: JavaScript tidak valid: ${error.message}`); }
  }

  const html = fs.readFileSync("developer-license-v2.html", "utf8");
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).filter((source) => source.trim());
  for (const [index, source] of inlineScripts.entries()) {
    try { new vm.Script(source, { filename: `developer-license-v2.html#inline-${index + 1}` }); }
    catch (error) { failures.push(`developer-license-v2.html: JavaScript inline tidak valid: ${error.message}`); }
  }

  if (fs.readFileSync("VERSION.txt", "utf8").trim() !== "27.1.0") failures.push("VERSION.txt bukan 27.1.0.");
  requireText("js/license-v2-config.js", ['appVersion:"27.1.0"']);
  requireText("service-worker.js", ['APP_VERSION = "27.1.0"', "release27-1-0-midtrans-auto"]);
}

if (failures.length) {
  console.error(`QA MIDTRANS 27.1 GAGAL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("QA MIDTRANS 27.1 LULUS: SQL, webhook, Developer Center, onboarding, verifikasi, konfigurasi, dan versi tersedia.");

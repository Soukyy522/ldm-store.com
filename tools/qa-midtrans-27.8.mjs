import fs from "node:fs";
import vm from "node:vm";

const required = [
  "license-authority-v2/supabase/migrations/20260902080000_ldm_midtrans_status_cancel_retry.sql",
  "license-authority-v2/supabase/functions/_shared/ldm-midtrans-operations.ts",
  "license-authority-v2/supabase/functions/ldm-license-admin-v2/index.ts",
  "license-authority-v2/supabase/functions/ldm-public-checkout-v2/index.ts",
  "license-authority-v2/supabase/functions/ldm-midtrans-webhook/index.ts",
  "license-authority-v2/supabase/config.toml",
  "developer-license-v2.html",
  "license.html",
  "js/license-checkout-v2.js",
  "js/license-v2-config.js",
  "service-worker.js",
  "PANDUAN-PERBAIKAN-MIDTRANS-27.8.0.txt",
  "VERSION.txt",
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

function checkJavaScript(file) {
  try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }); }
  catch (error) { failures.push(`${file}: JavaScript tidak valid: ${error.message}`); }
}

function checkInlineHtml(file) {
  const html = fs.readFileSync(file, "utf8");
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).filter((source) => source.trim());
  inline.forEach((source, index) => {
    try { new vm.Script(source, { filename: `${file}#inline-${index + 1}` }); }
    catch (error) { failures.push(`${file}: script inline ${index + 1} tidak valid: ${error.message}`); }
  });
}

if (!failures.length) {
  const sql = requireText(required[0], [
    "ldm2_cancel_pending_payment_local",
    "PAYMENT_CANCELLED_FOR_RETRY",
    "ldm2_create_retry_purchase_order",
    "license_preserved_for_retry",
    "cancelled_at",
    "commit;",
  ]);
  if ((sql.match(/\$\$/g) || []).length % 2 !== 0) failures.push("Migration SQL: pasangan $$ tidak seimbang.");
  if (!/^begin;[\s\S]*commit;/im.test(sql)) failures.push("Migration SQL: BEGIN/COMMIT tidak lengkap.");

  const shared = requireText(required[1], [
    "/status",
    "/cancel",
    "/snap/v1/transactions/${encodeURIComponent(token)}/cancel",
    "transaction\\s+doesn",
    "reconcilePaymentFromMidtrans",
    "cancelPaymentForRetry",
    "ldm2_cancel_pending_payment_local",
  ]);
  if (/MIDTRANS_SERVER_KEY\s*[:=]\s*["'][^"']{10,}/.test(shared)) {
    failures.push("Shared Midtrans: Server Key tampak ditulis langsung pada source code.");
  }

  requireText(required[2], [
    "midtransNotificationUrl",
    '"X-Override-Notification"',
    'action === "sync_payment_status"',
    'action === "retry_purchase_payment"',
    "cancelPaymentForRetry",
  ]);
  requireText(required[3], [
    "midtransNotificationUrl",
    '"X-Override-Notification"',
    "reconcilePaymentFromMidtrans",
    "cancelPaymentForRetry",
    'transaction_status: midtrans_sync.found',
  ]);
  requireText(required[4], ["SHA-512", "/status", "ldm2_apply_midtrans_notification"]);
  requireText(required[5], ["[functions.ldm-midtrans-webhook]", "verify_jwt = false"]);
  requireText(required[6], ["Cek Status Midtrans", "Buat Pembayaran Baru", "retry_purchase_payment", "sync_payment_status"]);
  requireText(required[7], ["license-checkout-v2.js?v=27.8.0"]);
  requireText(required[8], ["ldmPublicCheckoutV278", "snapCallbacks", "onPending", "poll(payment.order_id"]);
  requireText(required[9], ['appVersion:"27.8.0"']);
  requireText(required[10], ['APP_VERSION = "27.8.0"', "release27-8-0-midtrans-status-cancel"]);
  if (fs.readFileSync(required[12], "utf8").trim() !== "27.8.0") failures.push("VERSION.txt bukan 27.8.0.");

  checkJavaScript(required[8]);
  checkJavaScript(required[9]);
  checkJavaScript(required[10]);
  checkInlineHtml(required[6]);
  checkInlineHtml(required[7]);
}

if (failures.length) {
  console.error(`QA MIDTRANS 27.8 GAGAL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("QA MIDTRANS 27.8 LULUS: status reconciliation, webhook override, Core/Snap cancel, retry payment, SQL, UI, dan cache version valid.");

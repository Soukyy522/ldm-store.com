// =============================================================================
// LocDailyMar V28.1.9.2 - Resend full license data transactional email helper
// Server-side only. Never import this file from browser/frontend code.
// =============================================================================

function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}

function clean(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: unknown) {
  const n = Math.round(Number(value || 0));
  return `Rp ${new Intl.NumberFormat("id-ID").format(Number.isFinite(n) ? n : 0)}`;
}

function maskEnd(value: unknown, visible = 4) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  if (s.length <= visible) return "•".repeat(Math.max(4, s.length));
  return `${"•".repeat(Math.min(12, Math.max(6, s.length - visible)))}${s.slice(-visible)}`;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return clean(value, 100);
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Makassar",
      dateStyle: "long",
      timeStyle: "short",
    }).format(d);
  } catch (_) {
    return d.toISOString();
  }
}

export function resendRuntimeHealth() {
  const mode = env("LDM_RESEND_MODE").toLowerCase() || "off";
  return {
    mode,
    enabled: mode === "test" || mode === "production",
    api_key_configured: env("RESEND_API_KEY").startsWith("re_"),
    from_configured: !!env("LDM_RESEND_FROM"),
    test_to_configured: !!env("LDM_RESEND_TEST_TO"),
    reply_to_configured: !!env("LDM_RESEND_REPLY_TO"),
    include_secrets: env("LDM_RESEND_INCLUDE_SECRETS").toLowerCase() === "true",
  };
}

export function resolveResendRecipient(customerEmail: string) {
  const mode = env("LDM_RESEND_MODE").toLowerCase();
  if (mode === "test") return env("LDM_RESEND_TEST_TO");
  if (mode === "production") return clean(customerEmail, 320).toLowerCase();
  return "";
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("LDM_RESEND_FROM");
  const replyTo = env("LDM_RESEND_REPLY_TO");

  if (!apiKey || !apiKey.startsWith("re_")) {
    return { ok: false, status: 0, id: null, error: "RESEND_API_KEY belum dikonfigurasi." };
  }
  if (!from) {
    return { ok: false, status: 0, id: null, error: "LDM_RESEND_FROM belum dikonfigurasi." };
  }
  if (!input.to) {
    return { ok: false, status: 0, id: null, error: "Alamat tujuan email kosong." };
  }

  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (replyTo) body.reply_to = replyTo;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": clean(input.idempotencyKey, 256),
        "User-Agent": "LocDailyMar/28.1.9.2 Supabase-Edge-Function",
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let payload: any = {};
    try { payload = JSON.parse(raw || "{}"); } catch (_) { payload = { raw }; }

    if (!response.ok) {
      const message = clean(payload?.message || payload?.error || raw || `HTTP ${response.status}`, 1500);
      return { ok: false, status: response.status, id: null, error: message, payload };
    }
    return { ok: true, status: response.status, id: clean(payload?.id, 200) || null, error: null, payload };
  } catch (error) {
    return { ok: false, status: 0, id: null, error: clean((error as Error)?.message || error, 1500) };
  }
}

export function buildPaidLicenseEmail(input: {
  customerName: string;
  customerEmail: string;
  orderId: string;
  paymentId: string;
  licenseId: string;
  planName: string;
  planCode: string;
  periodLabel: string;
  amount: number;
  paidAt: string | null;
  expiresAt: string | null;
  storeName: string;
  storeCode: string;
  storeId: string;
  networkId: string;
  appUrl: string;
  guideUrl: string;
  provisionStatus: string;
  rawLicenseKey?: string | null;
}) {
  const includeSecrets = env("LDM_RESEND_INCLUDE_SECRETS").toLowerCase() === "true";
  const vaultUrl = input.appUrl
    ? `${input.appUrl.replace(/\/+$/, "")}/license.html#ownerLicenseVault`
    : "";

  const keyValue = includeSecrets && input.rawLicenseKey
    ? escapeHtml(input.rawLicenseKey)
    : "••••••••••••••••••••";
  const storeCode = includeSecrets ? escapeHtml(input.storeCode) : escapeHtml(maskEnd(input.storeCode, 4));
  const storeId = includeSecrets ? escapeHtml(input.storeId) : escapeHtml(maskEnd(input.storeId, 6));
  const networkId = includeSecrets ? escapeHtml(input.networkId) : escapeHtml(maskEnd(input.networkId, 6));

  const subject = `Pembayaran LocDailyMar berhasil - ${input.planName}`;
  const safeName = escapeHtml(input.customerName || "Owner");
  const secureNote = includeSecrets
    ? "Email ini memuat data lisensi lengkap. Simpan email ini baik-baik pada akun email pribadi yang aman. Jangan meneruskan, mempublikasikan, atau mengirim screenshot bagian License Key, Store Code, Store UUID, dan Network ID kepada orang lain."
    : "Data sensitif sedang disamarkan. Aktifkan mode full license email bila pemilik sistem memang ingin mengirim data lengkap melalui email.";

  const button = vaultUrl
    ? `<a href="${escapeHtml(vaultUrl)}" style="display:inline-block;background:#0f9d58;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Buka Data Lisensi Saya</a>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#243447">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border:1px solid #e5eaf0;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(34,51,68,.08)">
      <div style="background:#0f9d58;color:#fff;padding:24px 28px">
        <div style="font-size:22px;font-weight:800">LocDailyMar</div>
        <div style="margin-top:5px;font-size:13px;opacity:.9">Pembayaran terverifikasi & lisensi aktif</div>
      </div>
      <div style="padding:26px 28px">
        <p style="margin-top:0">Halo <strong>${safeName}</strong>,</p>
        <p>Pembayaran Anda sudah diverifikasi. Detail lisensi telah disiapkan oleh sistem LocDailyMar.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#667085">Order ID</td><td style="padding:8px 0;text-align:right;font-weight:700;word-break:break-all">${escapeHtml(input.orderId)}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Payment ID</td><td style="padding:8px 0;text-align:right;font-weight:700;word-break:break-all">${escapeHtml(input.paymentId)}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">License ID</td><td style="padding:8px 0;text-align:right;font-weight:700;word-break:break-all">${escapeHtml(input.licenseId)}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Paket</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.planName)} (${escapeHtml(input.planCode)})</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Periode</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.periodLabel)}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Nominal</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(money(input.amount))}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Dibayar</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(formatDate(input.paidAt))}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Masa berlaku</td><td style="padding:8px 0;text-align:right;font-weight:700">${input.expiresAt ? escapeHtml(formatDate(input.expiresAt)) : "Tidak terbatas"}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Nama Owner</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.customerName || "-")}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Email Owner</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.customerEmail)}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Nama Toko Utama</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.storeName || "-")}</td></tr>
          <tr><td style="padding:8px 0;color:#667085">Provisioning</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.provisionStatus || "-")}</td></tr>
        </table>
        <div style="margin:20px 0;padding:16px;background:#f7faf8;border:1px solid #b8dfc7;border-radius:12px">
          <div style="font-size:13px;font-weight:800;color:#0f7a45;margin-bottom:12px">DATA LISENSI & IDENTITAS TOKO</div>
          <div style="font-size:12px;color:#667085">License Key</div><div style="font-size:15px;font-weight:800;margin:4px 0 10px;word-break:break-all">${keyValue}</div>
          <div style="font-size:12px;color:#667085">Store Code</div><div style="font-weight:700;margin:4px 0 10px">${storeCode}</div>
          <div style="font-size:12px;color:#667085">Store UUID</div><div style="font-weight:700;margin:4px 0 10px;word-break:break-all">${storeId}</div>
          <div style="font-size:12px;color:#667085">Network ID</div><div style="font-weight:700;margin-top:4px;word-break:break-all">${networkId}</div>
        </div>
        <div style="padding:15px 16px;background:#fff7df;border:1px solid #e7c45b;border-radius:11px;color:#624900;font-size:12px;line-height:1.65">
          <strong style="font-size:13px">CATATAN PENTING - SIMPAN DATA INI BAIK-BAIK</strong><br>
          ${escapeHtml(secureNote)}
          <br><br>
          <strong>Jangan bagikan:</strong> License Key, Store Code, Store UUID, Network ID, password, OTP, token, atau screenshot data sensitif.
          LocDailyMar tidak akan meminta password, OTP, atau token rahasia melalui email.
        </div>
        ${button ? `<div style="margin-top:20px">${button}</div>` : ""}
        ${input.appUrl ? `<p style="margin-top:18px;font-size:12px">Login aplikasi: <a href="${escapeHtml(input.appUrl.replace(/\/+$/, "") + "/index.html")}">${escapeHtml(input.appUrl.replace(/\/+$/, "") + "/index.html")}</a></p>` : ""}
        ${input.guideUrl ? `<p style="margin-top:8px;font-size:12px">Panduan penggunaan: <a href="${escapeHtml(input.guideUrl)}">${escapeHtml(input.guideUrl)}</a></p>` : ""}
      </div>
      <div style="padding:16px 28px;background:#f7f9fb;color:#667085;font-size:11px">Email transactional otomatis dari LocDailyMar. Jangan membalas dengan password, OTP, atau token rahasia.</div>
    </div>
  </div>
</body></html>`;

  const text = [
    "LocDailyMar - Pembayaran berhasil",
    "",
    `Halo ${input.customerName || "Owner"},`,
    `Order ID: ${input.orderId}`,
    `Payment ID: ${input.paymentId}`,
    `License ID: ${input.licenseId}`,
    `Paket: ${input.planName} (${input.planCode})`,
    `Periode: ${input.periodLabel}`,
    `Nominal: ${money(input.amount)}`,
    `Dibayar: ${formatDate(input.paidAt)}`,
    `Nama Owner: ${input.customerName || "-"}`,
    `Email Owner: ${input.customerEmail}`,
    `Nama Toko Utama: ${input.storeName || "-"}`,
    `Masa Berlaku: ${input.expiresAt ? formatDate(input.expiresAt) : "Tidak terbatas"}`,
    "",
    "DATA LISENSI & IDENTITAS TOKO",
    `License Key: ${includeSecrets && input.rawLicenseKey ? input.rawLicenseKey : "DISAMARKAN - mode full license email belum aktif"}`,
    `Store Code: ${includeSecrets ? input.storeCode : maskEnd(input.storeCode, 4)}`,
    `Store UUID: ${includeSecrets ? input.storeId : maskEnd(input.storeId, 6)}`,
    `Network ID: ${includeSecrets ? input.networkId : maskEnd(input.networkId, 6)}`,
    vaultUrl ? `Data Lisensi Saya: ${vaultUrl}` : "",
    input.appUrl ? `Login aplikasi: ${input.appUrl.replace(/\/+$/, "")}/index.html` : "",
    input.guideUrl ? `Panduan: ${input.guideUrl}` : "",
    "",
    "CATATAN PENTING:",
    "Simpan email dan data lisensi ini baik-baik pada akun email pribadi yang aman.",
    "Jangan meneruskan email ini atau membagikan License Key, Store Code, Store UUID, Network ID, password, OTP, token, maupun screenshot data sensitif kepada orang lain.",
    "Password Owner tidak dikirim melalui email ini. Gunakan mekanisme pengaturan/reset password resmi pada aplikasi.",
  ].filter(Boolean).join("\n");

  return { subject, html, text, vaultUrl, includeSecrets };
}

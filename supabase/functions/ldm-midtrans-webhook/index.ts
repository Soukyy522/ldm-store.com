import { createClient } from "npm:@supabase/supabase-js@2";
import { preparePaidOrder, releaseApplicationOwnerReservation } from "../_shared/ldm-license-delivery.ts";

const encoder = new TextEncoder();

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function clean(value: unknown, max = 500) { return String(value || "").trim().slice(0, max); }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
async function sha512(value: string) {
  const digest = await crypto.subtle.digest("SHA-512", encoder.encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function constantEqual(a: string, b: string) {
  const left = encoder.encode(a.toLowerCase());
  const right = encoder.encode(b.toLowerCase());
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
function apiBase() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true"
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}
async function getMidtransStatus(orderId: string, serverKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: {
        "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(data?.status_message || `Midtrans status HTTP ${response.status}`));
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json({ ok: true, service: "LDM_MIDTRANS_WEBHOOK", mode: env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" ? "production" : "sandbox" });
  if (req.method !== "POST") return json({ ok: false, message: "Gunakan POST." }, 405);

  try {
    const serverKey = env("MIDTRANS_SERVER_KEY");
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!serverKey || !supabaseUrl || !serviceKey) return json({ ok: false, message: "Secret webhook belum lengkap." }, 500);

    const raw = await req.text();
    if (!raw || raw.length > 65536) return json({ ok: false, message: "Payload tidak valid." }, 400);
    const notification = JSON.parse(raw);
    const orderId = clean(notification.order_id, 120);
    const statusCode = clean(notification.status_code, 10);
    const grossAmount = clean(notification.gross_amount, 40);
    const signature = clean(notification.signature_key, 300).toLowerCase();
    if (!orderId || !statusCode || !grossAmount || !signature) return json({ ok: false, message: "Field notifikasi tidak lengkap." }, 400);

    const expected = await sha512(`${orderId}${statusCode}${grossAmount}${serverKey}`);
    if (!constantEqual(signature, expected)) {
      console.warn("MIDTRANS_SIGNATURE_INVALID", { orderId });
      return json({ ok: false, message: "Signature Midtrans tidak valid." }, 403);
    }

    // Status API menjadi sumber kebenaran kedua setelah signature webhook.
    const status = await getMidtransStatus(orderId, serverKey);
    if (clean(status.order_id, 120) !== orderId) return json({ ok: false, message: "Order ID hasil verifikasi tidak sesuai." }, 409);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const safeDetail = {
      order_id: clean(status.order_id, 120),
      transaction_id: clean(status.transaction_id, 120),
      transaction_status: clean(status.transaction_status, 40),
      fraud_status: clean(status.fraud_status, 40),
      status_code: clean(status.status_code, 10),
      gross_amount: clean(status.gross_amount, 40),
      currency: clean(status.currency, 10),
      payment_type: clean(status.payment_type, 60),
      transaction_time: clean(status.transaction_time, 60),
      settlement_time: clean(status.settlement_time, 60),
    };
    const amount = Number(status.gross_amount);
    if (!Number.isFinite(amount)) return json({ ok: false, message: "Nominal Midtrans tidak valid." }, 400);

    const { data, error } = await admin.rpc("ldm2_apply_midtrans_notification", {
      p_order_id: orderId,
      p_transaction_id: clean(status.transaction_id, 120) || null,
      p_transaction_status: clean(status.transaction_status, 40),
      p_fraud_status: clean(status.fraud_status, 40) || null,
      p_status_code: clean(status.status_code, 10),
      p_gross_amount: amount,
      p_provider_detail: safeDetail,
    });
    if (error) throw error;
    if (data?.ok === false) {
      const code = String(data?.code || "");
      return json(data, code === "ORDER_NOT_FOUND" ? 404 : 409);
    }

    // Aktivasi lisensi tidak boleh gagal hanya karena provisioning aplikasi sedang bermasalah.
    // Webhook hanya menyiapkan akun/store. License Key tidak pernah dikembalikan ke Midtrans.
    let delivery = null;
    const paymentStatus = String(data?.payment_status || "").toLowerCase();
    if (paymentStatus === "paid") {
      try {
        delivery = await preparePaidOrder(admin, orderId, true);
      } catch (deliveryError) {
        console.error("LDM_CUSTOMER_WEB_RECEIPT_PREPARE", { orderId, error: deliveryError });
        delivery = { eligible: true, completed: false, error: (deliveryError as Error)?.message || "Provisioning receipt gagal." };
      }
    } else if (["cancelled", "expired", "failed"].includes(paymentStatus)) {
      try { await releaseApplicationOwnerReservation(admin, orderId); }
      catch (cleanupError) { console.error("LDM_OWNER_RESERVATION_CLEANUP", { orderId, error: cleanupError }); }
    }

    return json({ ok: true, result: data, delivery });
  } catch (error) {
    console.error("LDM_MIDTRANS_WEBHOOK", error);
    return json({ ok: false, message: (error as Error)?.message || "Webhook gagal diproses." }, 500);
  }
});

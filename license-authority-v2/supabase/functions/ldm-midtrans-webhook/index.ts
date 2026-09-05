import { createClient } from "npm:@supabase/supabase-js@2";
import { preparePaidOrder, releaseApplicationOwnerReservation } from "../_shared/ldm-license-delivery.ts";
import {
  applyVerifiedMidtransStatus,
  cleanMidtrans,
  finishMidtransEvent,
  getMidtransTransactionStatus,
  midtransEventKey,
  midtransRuntimeHealth,
  registerMidtransEvent,
} from "../_shared/ldm-midtrans-operations.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const encoder = new TextEncoder();
function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
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

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "LDM_MIDTRANS_WEBHOOK", runtime: midtransRuntimeHealth() });
  }
  if (req.method !== "POST") return json({ ok: false, message: "Gunakan POST." }, 405);

  let eventKey = "";
  let admin: any = null;
  try {
    const serverKey = env("MIDTRANS_SERVER_KEY");
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!serverKey || !supabaseUrl || !serviceKey) return json({ ok: false, message: "Secret webhook belum lengkap." }, 500);

    const runtime = midtransRuntimeHealth();
    if (!runtime.ok) {
      return json({ ok: false, code: "MIDTRANS_RUNTIME_INVALID", message: runtime.problems.join(" ") }, 500);
    }

    const raw = await req.text();
    if (!raw || raw.length > 65536) return json({ ok: false, message: "Payload tidak valid." }, 400);
    let notification: Record<string, unknown>;
    try { notification = JSON.parse(raw); }
    catch { return json({ ok: false, message: "JSON notifikasi tidak valid." }, 400); }

    const orderId = cleanMidtrans(notification.order_id, 120);
    const statusCode = cleanMidtrans(notification.status_code, 10);
    const grossAmount = cleanMidtrans(notification.gross_amount, 40);
    const signature = cleanMidtrans(notification.signature_key, 300).toLowerCase();
    if (!orderId || !statusCode || !grossAmount || !signature) {
      return json({ ok: false, message: "Field notifikasi tidak lengkap." }, 400);
    }

    admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    eventKey = await midtransEventKey("webhook_raw", notification);

    const expected = await sha512(`${orderId}${statusCode}${grossAmount}${serverKey}`);
    if (!constantEqual(signature, expected)) {
      console.warn("MIDTRANS_SIGNATURE_INVALID", { orderId, eventKey });
      try {
        await registerMidtransEvent(admin, eventKey, orderId, "webhook_invalid_signature", notification, false);
        await finishMidtransEvent(admin, eventKey, false, "Signature Midtrans tidak valid.");
      } catch (logError) {
        console.error("MIDTRANS_INVALID_SIGNATURE_LOG_FAILED", logError);
      }
      return json({ ok: false, code: "MIDTRANS_SIGNATURE_INVALID", message: "Signature Midtrans tidak valid." }, 403);
    }

    // Signature valid, lalu GET Status menjadi sumber kebenaran server-to-server.
    const statusResult = await getMidtransTransactionStatus(orderId);
    if (!statusResult.exists) {
      await registerMidtransEvent(admin, eventKey, orderId, "webhook_verified", notification, true);
      await finishMidtransEvent(admin, eventKey, false, "Transaksi belum ditemukan pada GET Status Midtrans.");
      return json({ ok: false, code: "MIDTRANS_STATUS_NOT_FOUND", message: "Transaksi Midtrans belum ditemukan saat verifikasi." }, 503);
    }
    const status = statusResult.data;
    eventKey = await midtransEventKey("webhook_verified", status);
    if (cleanMidtrans(status.order_id, 120) !== orderId) {
      await registerMidtransEvent(admin, eventKey, orderId, "webhook_verified", status, true);
      await finishMidtransEvent(admin, eventKey, false, "Order ID hasil verifikasi tidak sesuai.");
      return json({ ok: false, code: "MIDTRANS_ORDER_MISMATCH", message: "Order ID hasil verifikasi tidak sesuai." }, 409);
    }

    const { data: payment, error: paymentError } = await admin.from("ldm2_payments")
      .select("id,license_id,order_id,status,provider_status,payment_type,amount,snap_token,processed_at,paid_at")
      .eq("order_id", orderId).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) {
      await registerMidtransEvent(admin, eventKey, orderId, "webhook_verified", status, true);
      await finishMidtransEvent(admin, eventKey, false, "Order LocDailyMar tidak ditemukan.");
      return json({ ok: false, code: "ORDER_NOT_FOUND", message: "Order LocDailyMar tidak ditemukan." }, 404);
    }

    const result = await applyVerifiedMidtransStatus(
      admin,
      payment,
      status,
      "webhook_verified",
      eventKey,
      true,
    );
    const data = result.applied;

    // Core payment + lisensi sudah committed di RPC. Pekerjaan sekunder tidak
    // menahan response webhook, supaya Midtrans menerima 200 secepat mungkin.
    const paymentStatus = String(data?.payment_status || payment.status || "").toLowerCase();
    if (paymentStatus === "paid") {
      EdgeRuntime.waitUntil((async () => {
        try { await preparePaidOrder(admin, orderId, true); }
        catch (deliveryError) {
          console.error("LDM_CUSTOMER_WEB_RECEIPT_PREPARE", { orderId, error: deliveryError });
        }
      })());
    } else if (["cancelled", "expired", "failed"].includes(paymentStatus)) {
      EdgeRuntime.waitUntil((async () => {
        try { await releaseApplicationOwnerReservation(admin, orderId); }
        catch (cleanupError) { console.error("LDM_OWNER_RESERVATION_CLEANUP", { orderId, error: cleanupError }); }
      })());
    }

    return json({
      ok: true,
      duplicate_event: Boolean(result.duplicate_event),
      order_id: orderId,
      payment_status: paymentStatus,
      result: data,
    });
  } catch (error) {
    console.error("LDM_MIDTRANS_WEBHOOK", error);
    if (admin && eventKey) {
      try { await finishMidtransEvent(admin, eventKey, false, (error as Error)?.message || "Webhook gagal diproses."); }
      catch (finishError) { console.error("MIDTRANS_EVENT_FINALIZE_ERROR", finishError); }
    }
    return json({ ok: false, message: (error as Error)?.message || "Webhook gagal diproses." }, 500);
  }
});

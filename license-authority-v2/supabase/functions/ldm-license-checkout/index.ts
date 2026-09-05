import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptLicenseKey, deliverOrder, encryptLicenseKey } from "../_shared/ldm-license-delivery.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const encoder = new TextEncoder();
function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function clean(value: unknown, max = 200) { return String(value || "").trim().slice(0, max); }
function randomHex(bytes = 8) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function orderId() {
  const date = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `LDM-BUY-${date}-${randomHex(4)}`;
}
function licenseKey(plan: string) {
  return `LDM2-${plan.replace("WARUNG_", "W")}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}`;
}
function checkoutToken() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function normalizePhone(value: unknown) {
  let phone = clean(value, 40).replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  if (!phone.startsWith("62")) phone = `62${phone}`;
  return /^62\d{8,13}$/.test(phone) ? phone : "";
}
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("LDM2_ALLOWED_ORIGINS").split(",").map((value) => value.trim()).filter(Boolean);
  const allowNull = env("LDM2_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if ((!origin || origin === "null") && allowNull) return "*";
  return origin && allowed.includes(origin) ? origin : "";
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req) || "null",
    "Access-Control-Allow-Headers": "content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function midtransBase() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true"
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";
}
async function createSnap(input: {
  orderId: string; amount: number; itemName: string;
  customerName: string; customerEmail: string; customerPhone: string;
}) {
  const serverKey = env("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi.");
  const payload: Record<string, unknown> = {
    transaction_details: { order_id: input.orderId, gross_amount: input.amount },
    item_details: [{ id: input.orderId, price: input.amount, quantity: 1, name: input.itemName.slice(0, 50) }],
    customer_details: {
      first_name: input.customerName.slice(0, 50), email: input.customerEmail, phone: input.customerPhone,
    },
    page_expiry: { duration: 24, unit: "hours" },
  };
  const finish = env("MIDTRANS_FINISH_URL");
  if (finish) payload.callbacks = { finish };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${midtransBase()}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
        "Content-Type": "application/json", "Accept": "application/json",
      },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.token || !result?.redirect_url) {
      throw new Error(clean(result?.error_messages?.join?.("; ") || result?.message || `Midtrans HTTP ${response.status}`, 500));
    }
    return { token: String(result.token), redirectUrl: String(result.redirect_url) };
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (env("LDM_ENABLE_LEGACY_CHECKOUT").toLowerCase() !== "true") {
    return json(req, {
      ok: false,
      code: "LEGACY_CHECKOUT_DISABLED",
      message: "Endpoint ldm-license-checkout sudah deprecated. Gunakan ldm-public-checkout-v2.",
    }, 410);
  }
  if (req.method === "GET") return json(req, {
    ok: true, service: "LDM_LICENSE_CHECKOUT", mode: env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" ? "production" : "sandbox",
  });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST." }, 405);
  if (!allowedOrigin(req)) return json(req, { ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Domain aplikasi belum diizinkan." }, 403);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(req, { ok: false, code: "SERVER_CONFIG_INVALID", message: "Konfigurasi server belum lengkap." }, 500);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const rawBody = await req.text();
    if (!rawBody || rawBody.length > 16384) return json(req, { ok: false, code: "PAYLOAD_INVALID", message: "Data checkout tidak valid." }, 400);
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); }
    catch { return json(req, { ok: false, code: "JSON_INVALID", message: "Format data checkout tidak valid." }, 400); }
    const action = clean(body.action, 40).toLowerCase();

    if (action === "status") {
      const requestedOrderId = clean(body.order_id, 80);
      const token = clean(body.checkout_token, 200);
      if (!requestedOrderId || token.length < 32) return json(req, { ok: false, code: "CHECKOUT_CONTEXT_REQUIRED", message: "Data pemeriksaan checkout tidak lengkap." }, 400);
      const { data, error } = await admin.rpc("ldm2_public_checkout_status", {
        p_order_id: requestedOrderId, p_checkout_token_hash_hex: await sha256(token),
      });
      if (error) throw error;
      if (data?.ok === false) return json(req, data, 404);
      const safe = { ...data };
      const ciphertext = String(safe.license_key_ciphertext || "");
      delete safe.license_key_ciphertext;
      if (safe.payment_status === "paid" && ciphertext) {
        safe.license_key = await decryptLicenseKey(ciphertext);
        if (["pending", "failed", "sending"].includes(String(safe.email_delivery_status)) || ["pending", "failed", "sending"].includes(String(safe.whatsapp_delivery_status))) {
          EdgeRuntime.waitUntil(deliverOrder(admin, requestedOrderId));
        }
      }
      return json(req, safe);
    }

    if (action !== "create_checkout") return json(req, { ok: false, code: "ACTION_INVALID", message: "Action checkout tidak dikenal." }, 400);

    const customerName = clean(body.customer_name, 120);
    const customerEmail = clean(body.customer_email, 180).toLowerCase();
    const customerPhone = normalizePhone(body.customer_phone);
    const storeName = clean(body.store_name, 120);
    const storeCode = clean(body.store_code, 30).toUpperCase();
    const planCode = clean(body.plan_code, 40).toUpperCase();
    const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
    const consent = body.consent === true;

    if (customerName.length < 2 || storeName.length < 2) return json(req, { ok: false, code: "NAME_INVALID", message: "Nama customer dan nama toko wajib diisi." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return json(req, { ok: false, code: "EMAIL_INVALID", message: "Alamat email tidak valid." }, 400);
    if (!customerPhone) return json(req, { ok: false, code: "PHONE_INVALID", message: "Nomor WhatsApp harus menggunakan nomor Indonesia yang valid." }, 400);
    if (storeCode && !/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(storeCode)) return json(req, { ok: false, code: "STORE_CODE_INVALID", message: "Store Code hanya boleh berisi huruf, angka, dan tanda strip (3-30 karakter)." }, 400);
    if (!consent) return json(req, { ok: false, code: "CONSENT_REQUIRED", message: "Persetujuan penggunaan email dan WhatsApp diperlukan untuk mengirim data lisensi." }, 400);

    const { data: plan, error: planError } = await admin.from("ldm2_plans")
      .select("code,name,price_monthly,price_yearly,price_lifetime,active")
      .eq("code", planCode).eq("active", true).maybeSingle();
    if (planError) throw planError;
    if (!plan) return json(req, { ok: false, code: "PLAN_INVALID", message: "Paket tidak tersedia." }, 400);
    if (planCode === "LIFETIME" && billingCycle !== "lifetime") return json(req, { ok: false, code: "CYCLE_INVALID", message: "Paket Lifetime harus memakai periode Lifetime." }, 400);
    if (planCode !== "LIFETIME" && !["monthly", "yearly"].includes(billingCycle)) return json(req, { ok: false, code: "CYCLE_INVALID", message: "Pilih periode bulanan atau tahunan." }, 400);
    const amount = Number(billingCycle === "monthly" ? plan.price_monthly : billingCycle === "yearly" ? plan.price_yearly : plan.price_lifetime);
    if (!Number.isSafeInteger(amount) || amount <= 0) return json(req, { ok: false, code: "PRICE_INVALID", message: "Harga paket belum dikonfigurasi." }, 500);

    const newOrderId = orderId();
    const rawLicenseKey = licenseKey(planCode);
    const rawCheckoutToken = checkoutToken();
    const keyCiphertext = await encryptLicenseKey(rawLicenseKey);
    const { data: order, error: orderError } = await admin.rpc("ldm2_create_public_checkout_order", {
      p_order_id: newOrderId,
      p_key_hash_hex: await sha256(rawLicenseKey),
      p_key_prefix: rawLicenseKey.slice(0, 18),
      p_license_key_ciphertext: keyCiphertext,
      p_checkout_token_hash_hex: await sha256(rawCheckoutToken),
      p_customer_name: customerName,
      p_customer_email: customerEmail,
      p_customer_phone: customerPhone,
      p_plan_code: planCode,
      p_billing_cycle: billingCycle,
      p_store_code: storeCode || null,
      p_store_name: storeName,
      p_amount: amount,
      p_activation_url: env("LDM2_ACTIVATION_URL") || env("MIDTRANS_FINISH_URL"),
      p_guide_url: env("LDM2_GUIDE_URL"),
      p_notes: "Checkout customer melalui license.html",
    });
    if (orderError) {
      const status = /Batas pembuatan pembayaran/i.test(orderError.message) ? 429 : 400;
      return json(req, { ok: false, code: status === 429 ? "CHECKOUT_RATE_LIMIT" : "CHECKOUT_REJECTED", message: orderError.message }, status);
    }

    try {
      const snap = await createSnap({
        orderId: newOrderId, amount,
        itemName: `Lisensi LocDailyMar - ${plan.name} (${billingCycle})`,
        customerName, customerEmail, customerPhone,
      });
      const { error: saveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
        p_order_id: newOrderId, p_snap_token: snap.token, p_redirect_url: snap.redirectUrl,
      });
      if (saveError) throw saveError;
      return json(req, {
        ok: true,
        order_id: newOrderId,
        checkout_token: rawCheckoutToken,
        snap_token: snap.token,
        redirect_url: snap.redirectUrl,
        amount,
        plan_code: planCode,
        plan_name: plan.name,
        billing_cycle: billingCycle,
        store_code: order?.store_code,
        payment_status: "pending",
      });
    } catch (paymentError) {
      const message = clean((paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.", 500);
      await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrderId, p_message: message });
      return json(req, { ok: false, code: "MIDTRANS_CREATE_FAILED", message: `Order tersimpan tetapi pembayaran gagal dibuat: ${message}`, order_id: newOrderId }, 502);
    }
  } catch (error) {
    console.error("LDM_LICENSE_CHECKOUT", error);
    return json(req, { ok: false, code: "CHECKOUT_SERVER_ERROR", message: clean((error as Error)?.message || "Server checkout gagal memproses permintaan.", 500) }, 500);
  }
});

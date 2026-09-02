
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clean, encryptLicenseKey, sha256Hex, normalizeWhatsApp, getPaidWebReceipt, preflightApplicationProvisioning,
  reserveApplicationOwnerCredentials, releaseApplicationOwnerReservation,
} from "../_shared/ldm-license-delivery.ts";
import {
  cancelPaymentForRetry, midtransNotificationUrl, reconcilePaymentFromMidtrans,
} from "../_shared/ldm-midtrans-operations.ts";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function randomHex(bytes = 8) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function orderId() {
  const date = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `LDM-PURCHASE-${date}-${randomHex(4)}`;
}
function licenseKey(plan: string) {
  const short = plan.replace("WARUNG_", "W");
  return `LDM2-${short}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}`;
}
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("LDM2_CHECKOUT_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean);
  const allowNull = env("LDM2_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if ((!origin || origin === "null") && allowNull) return "*";
  return origin && allowed.includes(origin) ? origin : "";
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req) || "null",
    "Access-Control-Allow-Headers": "content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
}
async function createMidtransSnap(input: {
  orderId: string; amount: number; itemName: string;
  customerName: string; customerEmail: string; customerPhone: string;
}) {
  const serverKey = env("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum disimpan pada Supabase Secrets.");
  const finish = env("MIDTRANS_FINISH_URL");
  const payload: Record<string, unknown> = {
    transaction_details: { order_id: input.orderId, gross_amount: input.amount },
    item_details: [{ id: input.orderId.slice(0, 50), price: input.amount, quantity: 1, name: input.itemName.slice(0, 50) }],
    customer_details: {
      first_name: input.customerName.slice(0, 50),
      email: input.customerEmail,
      phone: input.customerPhone || undefined,
    },
  };
  if (finish) payload.callbacks = { finish };
  const notificationUrl = midtransNotificationUrl();
  const response = await fetch(`${midtransBase()}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(notificationUrl ? { "X-Override-Notification": notificationUrl } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token || !data?.redirect_url) {
    throw new Error(clean(data?.error_messages?.join?.("; ") || data?.message || `Midtrans HTTP ${response.status}`, 500));
  }
  return { token: String(data.token), redirectUrl: String(data.redirect_url) };
}
function requestIp(req: Request) {
  return clean(
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0] ||
    req.headers.get("x-real-ip") || "unknown",
    120,
  );
}
async function checkRateLimit(admin: any, email: string, req: Request) {
  const fingerprint = await sha256Hex(`${email.toLowerCase()}|${requestIp(req)}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin.from("ldm2_checkout_attempts")
    .select("id", { count: "exact", head: true })
    .eq("fingerprint_hash", fingerprint).gte("created_at", since);
  if (error) throw error;
  if (Number(count || 0) >= 6) throw Object.assign(new Error("Terlalu banyak percobaan checkout. Coba lagi sekitar satu jam."), { status: 429 });
  return fingerprint;
}
async function saveAttempt(admin: any, fingerprint: string, order: string | null) {
  await admin.from("ldm2_checkout_attempts").insert({ fingerprint_hash: fingerprint, order_id: order });
}
function statusToken() {
  return randomHex(24) + randomHex(24);
}
function safePlanCycle(plan: string, cycle: string) {
  if (plan === "LIFETIME") return cycle === "lifetime";
  return ["monthly", "yearly"].includes(cycle);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, message: "Gunakan POST." }, 405);
  if (!allowedOrigin(req)) return json(req, { ok: false, message: "Domain checkout belum diizinkan." }, 403);

  try {
    const url = env("SUPABASE_URL");
    const service = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return json(req, { ok: false, message: "Secret server checkout belum lengkap." }, 500);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 30).toLowerCase();

    if (action === "status") {
      const order = clean(body.order_id, 120);
      const token = clean(body.status_token, 200);
      if (!order || !token) return json(req, { ok: false, message: "Order/token status wajib diisi." }, 400);
      let { data: payment, error: pErr } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,provider_status,billing_cycle,amount,paid_at,processed_at")
        .eq("order_id", order).maybeSingle();
      if (pErr) throw pErr;
      if (!payment) return json(req, { ok: false, message: "Order tidak ditemukan." }, 404);
      const { data: delivery, error: dErr } = await admin.from("ldm2_checkout_deliveries")
        .select("public_status_token_hash,provision_status,completed_at")
        .eq("payment_id", payment.id).maybeSingle();
      if (dErr) throw dErr;
      if (!delivery) return json(req, { ok: false, message: "Status checkout tidak tersedia." }, 404);
      const tokenHash = await sha256Hex(token);
      if (tokenHash !== delivery.public_status_token_hash) return json(req, { ok: false, message: "Token status tidak valid." }, 403);

      // 27.6.1: self-healing status sync. Jika webhook terlambat/gagal,
      // tombol Cek Status melakukan GET Status ke Midtrans lalu menerapkan
      // status aktual ke database License Authority.
      let midtrans_sync: any = null;
      let midtrans_sync_error: string | null = null;
      if (body.sync_midtrans === true && ["pending", "challenge"].includes(String(payment.status || "").toLowerCase())) {
        try {
          midtrans_sync = await reconcilePaymentFromMidtrans(admin, payment, "public_checkout_status");
          const refreshed = await admin.from("ldm2_payments")
            .select("id,license_id,order_id,status,provider_status,billing_cycle,amount,paid_at,processed_at")
            .eq("order_id", order).maybeSingle();
          if (refreshed.error) throw refreshed.error;
          if (refreshed.data) payment = refreshed.data;
        } catch (syncError) {
          console.error("MIDTRANS_STATUS_SYNC", order, syncError);
          midtrans_sync_error = clean((syncError as Error)?.message || "Status Midtrans belum dapat disinkronkan.", 500);
        }
      }

      let receipt: any = null;
      let receiptError: string | null = null;
      if (payment.status === "paid") {
        try { receipt = await getPaidWebReceipt(admin, order); }
        catch (error) {
          console.error("WEB_RECEIPT_ERROR", order, error);
          receiptError = clean((error as Error)?.message || "Data lisensi belum dapat ditampilkan.", 500);
        }
      } else if (["cancelled", "expired", "failed"].includes(String(payment.status || "").toLowerCase())) {
        try { await releaseApplicationOwnerReservation(admin, order); } catch (cleanupError) { console.error("OWNER_RESERVATION_CLEANUP", order, cleanupError); }
      }
      const { data: license } = await admin.from("ldm2_licenses")
        .select("status,plan_code,primary_store_code,primary_store_id,network_id,expires_at")
        .eq("id", payment.license_id).maybeSingle();
      return json(req, {
        ok: true,
        order_id: order,
        payment_status: payment.status,
        provider_status: payment.provider_status,
        paid_at: payment.paid_at,
        license_status: license?.status || null,
        provision_status: receipt?.provision_status || delivery.provision_status,
        receipt,
        receipt_error: receiptError,
        midtrans_sync: midtrans_sync ? {
          transaction_status: midtrans_sync.found
            ? clean(midtrans_sync?.remote?.transaction_status || "", 40)
            : "not_created",
          fraud_status: clean(midtrans_sync?.remote?.fraud_status || "", 40) || null,
          synced: true,
        } : null,
        midtrans_sync_error,
      });
    }

    if (action === "cancel") {
      const order = clean(body.order_id, 120);
      const token = clean(body.status_token, 200);
      if (!order || !token) return json(req, { ok: false, message: "Order/token status wajib diisi." }, 400);

      const { data: payment, error: pErr } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,provider_status,billing_cycle,amount,snap_token,payment_type,paid_at,processed_at")
        .eq("order_id", order).maybeSingle();
      if (pErr) throw pErr;
      if (!payment) return json(req, { ok: false, message: "Order tidak ditemukan." }, 404);

      const { data: delivery, error: dErr } = await admin.from("ldm2_checkout_deliveries")
        .select("public_status_token_hash").eq("payment_id", payment.id).maybeSingle();
      if (dErr) throw dErr;
      if (!delivery) return json(req, { ok: false, message: "Status checkout tidak tersedia." }, 404);
      if (await sha256Hex(token) !== delivery.public_status_token_hash) {
        return json(req, { ok: false, message: "Token status tidak valid." }, 403);
      }

      if (payment.status === "cancelled") {
        try { await releaseApplicationOwnerReservation(admin, order); } catch (cleanupError) { console.error("OWNER_RESERVATION_CLEANUP", order, cleanupError); }
        return json(req, { ok: true, order_id: order, payment_status: "cancelled", already_cancelled: true });
      }
      if (["paid", "refunded"].includes(payment.status) || payment.processed_at) {
        return json(req, { ok: false, code: "PAYMENT_ALREADY_FINAL", message: "Pembayaran sudah diproses dan tidak dapat dibatalkan dari checkout. Transaksi settlement memerlukan proses refund sesuai kebijakan merchant." }, 409);
      }
      if (!["pending", "challenge", "failed", "expired"].includes(payment.status)) {
        return json(req, { ok: false, code: "PAYMENT_NOT_CANCELLABLE", message: `Status pembayaran ${payment.status} tidak dapat dibatalkan.` }, 409);
      }

      const cancelled = await cancelPaymentForRetry(
        admin, payment, "customer", "Customer membatalkan order untuk mengganti metode pembayaran",
      );
      try { await releaseApplicationOwnerReservation(admin, order); } catch (cleanupError) { console.error("OWNER_RESERVATION_CLEANUP", order, cleanupError); }
      return json(req, {
        ok: true,
        order_id: order,
        payment_status: "cancelled",
        provider_status: cancelled?.local?.provider_status || "cancelled",
        message: "Order pembayaran dibatalkan. Kamu dapat membuat order baru dan memilih metode pembayaran lain.",
        result: cancelled.local,
      });
    }

    if (action !== "create") return json(req, { ok: false, message: "Aksi checkout tidak dikenal." }, 400);

    const planCode = clean(body.plan_code, 40).toUpperCase();
    const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
    const customerName = clean(body.customer_name, 120);
    const customerEmail = clean(body.customer_email, 180).toLowerCase();
    const customerPhone = normalizeWhatsApp(clean(body.customer_phone, 40));
    const storeName = clean(body.store_name, 120);
    const storeCode = clean(body.store_code, 30).toUpperCase();
    const ownerPassword = String(body.owner_password ?? "");

    if (customerName.length < 2) return json(req, { ok: false, message: "Nama customer wajib diisi." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return json(req, { ok: false, message: "Email customer tidak valid." }, 400);
    if (!/^62\d{8,15}$/.test(customerPhone)) return json(req, { ok: false, message: "Nomor WhatsApp harus valid, contoh 0812xxxx." }, 400);
    if (storeName.length < 2) return json(req, { ok: false, message: "Nama toko wajib diisi." }, 400);
    if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(storeCode)) {
      return json(req, { ok: false, message: "Store Code harus 3-30 karakter: huruf, angka, atau tanda strip." }, 400);
    }
    if (ownerPassword.length < 8 || ownerPassword.length > 72 || /\s/.test(ownerPassword)
        || !/[a-z]/.test(ownerPassword) || !/[A-Z]/.test(ownerPassword) || !/\d/.test(ownerPassword)) {
      return json(req, { ok: false, message: "Password Owner harus 8-72 karakter, tanpa spasi, dan mengandung huruf besar, huruf kecil, serta angka." }, 400);
    }
    if (!safePlanCycle(planCode, billingCycle)) return json(req, { ok: false, message: "Periode paket tidak sesuai." }, 400);

    const fingerprint = await checkRateLimit(admin, customerEmail, req);

    // Cegah customer membayar dengan Store Code / email Owner yang sudah dipakai di Cloud App.
    // Jika provisioning Cloud belum dikonfigurasi, checkout tetap dapat berjalan dan delivery akan menandainya not_configured.
    const appPreflight = await preflightApplicationProvisioning({ customerEmail, storeCode });
    if (!appPreflight.configured) {
      return json(req, { ok: false, code: "OWNER_PROVISIONING_NOT_CONFIGURED", message: "Pembuatan akun Owner belum dikonfigurasi pada server. Lengkapi LDM_APP_SUPABASE_URL dan LDM_APP_SERVICE_ROLE_KEY terlebih dahulu." }, 503);
    }

    const { data: plan, error: planError } = await admin.from("ldm2_plans")
      .select("code,name,price_monthly,price_yearly,price_lifetime,active")
      .eq("code", planCode).eq("active", true).maybeSingle();
    if (planError) throw planError;
    if (!plan) return json(req, { ok: false, message: "Paket tidak tersedia." }, 400);
    const amount = Number(billingCycle === "monthly" ? plan.price_monthly : billingCycle === "yearly" ? plan.price_yearly : plan.price_lifetime);
    if (!Number.isSafeInteger(amount) || amount <= 0) return json(req, { ok: false, message: "Harga paket belum valid." }, 500);

    // Double-click / refresh: gunakan kembali checkout pending milik email + Store Code yang sama.
    const { data: existing } = await admin.from("ldm2_licenses")
      .select("id,status,customer_email,plan_code,primary_store_code")
      .eq("primary_store_code", storeCode).maybeSingle();
    if (existing) {
      if (!["pending_payment", "cancelled"].includes(existing.status) || String(existing.customer_email).toLowerCase() !== customerEmail) {
        return json(req, { ok: false, code: "STORE_CODE_USED", message: `Store Code ${storeCode} sudah digunakan.` }, 409);
      }
      if (existing.plan_code !== planCode) {
        return json(req, { ok: false, code: "PENDING_PLAN_MISMATCH", message: `Store Code ${storeCode} sudah mempunyai order pending untuk paket ${existing.plan_code}.` }, 409);
      }
      const { data: oldPayment } = await admin.from("ldm2_payments")
        .select("id,order_id,status,snap_token,redirect_url,billing_cycle,amount")
        .eq("license_id", existing.id)
        .in("status", ["pending", "challenge"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (oldPayment?.snap_token && oldPayment.billing_cycle === billingCycle && Number(oldPayment.amount) === amount) {
        const reserved = await reserveApplicationOwnerCredentials({
          customerName, customerEmail, ownerPassword, storeCode, orderId: oldPayment.order_id,
        });
        const newStatusToken = statusToken();
        const { error: tErr } = await admin.from("ldm2_checkout_deliveries")
          .update({ public_status_token_hash: await sha256Hex(newStatusToken), owner_user_id: reserved.userId, provision_status: "pending", provision_error: null })
          .eq("payment_id", oldPayment.id);
        if (tErr) throw tErr;
        await saveAttempt(admin, fingerprint, oldPayment.order_id);
        return json(req, {
          ok: true, reused: true, order_id: oldPayment.order_id, payment_id: oldPayment.id,
          amount: oldPayment.amount, snap_token: oldPayment.snap_token, redirect_url: oldPayment.redirect_url,
          client_key: env("MIDTRANS_CLIENT_KEY"),
          environment: env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" ? "production" : "sandbox",
          status_token: newStatusToken,
        });
      }
      if (oldPayment) {
        return json(req, { ok: false, code: "PENDING_ORDER_EXISTS", message: "Masih ada order pending dengan periode berbeda. Selesaikan atau tunggu order tersebut berakhir." }, 409);
      }

      // Jika order lama sudah failed/expired/cancelled, buat payment baru pada lisensi pending yang sama.
      const { data: previousDelivery, error: prevDeliveryError } = await admin.from("ldm2_checkout_deliveries")
        .select("license_key_ciphertext").eq("license_id", existing.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (prevDeliveryError) throw prevDeliveryError;
      if (!previousDelivery?.license_key_ciphertext) {
        return json(req, { ok: false, code: "PENDING_ORDER_REQUIRES_SUPPORT", message: "Data checkout lama tidak lengkap. Hubungi developer." }, 409);
      }

      const retryOrderId = orderId();
      const { data: retryOrder, error: retryOrderError } = await admin.rpc("ldm2_create_retry_purchase_order", {
        p_order_id: retryOrderId,
        p_license_id: existing.id,
        p_billing_cycle: billingCycle,
        p_amount: amount,
      });
      if (retryOrderError) throw retryOrderError;
      const retryStatusToken = statusToken();
      const { error: retryDeliveryError } = await admin.from("ldm2_checkout_deliveries").insert({
        payment_id: retryOrder.payment_id,
        license_id: existing.id,
        order_id: retryOrderId,
        public_status_token_hash: await sha256Hex(retryStatusToken),
        license_key_ciphertext: previousDelivery.license_key_ciphertext,
      });
      if (retryDeliveryError) throw retryDeliveryError;
      let retryReserved;
      try {
        retryReserved = await reserveApplicationOwnerCredentials({
          customerName, customerEmail, ownerPassword, storeCode, orderId: retryOrderId,
        });
      } catch (reservationError) {
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: retryOrderId, p_message: clean((reservationError as Error)?.message || "Reservasi akun Owner gagal.") });
        throw reservationError;
      }
      const { error: retryOwnerError } = await admin.from("ldm2_checkout_deliveries")
        .update({ owner_user_id: retryReserved.userId, provision_status: "pending", provision_error: null })
        .eq("payment_id", retryOrder.payment_id);
      if (retryOwnerError) throw retryOwnerError;
      await saveAttempt(admin, fingerprint, retryOrderId);

      try {
        const retrySnap = await createMidtransSnap({
          orderId: retryOrderId, amount,
          itemName: `Lisensi LocDailyMar - ${plan.name} (${billingCycle})`,
          customerName, customerEmail, customerPhone,
        });
        const { error: retrySaveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
          p_order_id: retryOrderId, p_snap_token: retrySnap.token, p_redirect_url: retrySnap.redirectUrl,
        });
        if (retrySaveError) throw retrySaveError;
        return json(req, {
          ok: true, retried: true, order_id: retryOrderId, payment_id: retryOrder.payment_id,
          amount, snap_token: retrySnap.token, redirect_url: retrySnap.redirectUrl,
          client_key: env("MIDTRANS_CLIENT_KEY"),
          environment: env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" ? "production" : "sandbox",
          status_token: retryStatusToken,
        });
      } catch (retryPaymentError) {
        const message = clean((retryPaymentError as Error)?.message || "Midtrans gagal membuat pembayaran.");
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: retryOrderId, p_message: message });
        try { await releaseApplicationOwnerReservation(admin, retryOrderId); } catch (_) {}
        return json(req, { ok: false, message: `Retry tersimpan tetapi Midtrans gagal: ${message}`, order_id: retryOrderId }, 502);
      }
    }

    const rawKey = licenseKey(planCode);
    const newOrder = orderId();
    const keyHash = await sha256Hex(rawKey);
    const { data: order, error: orderError } = await admin.rpc("ldm2_create_purchase_order", {
      p_order_id: newOrder,
      p_key_hash_hex: keyHash,
      p_key_prefix: rawKey.slice(0, 18),
      p_customer_name: customerName,
      p_customer_email: customerEmail,
      p_customer_phone: customerPhone,
      p_plan_code: planCode,
      p_billing_cycle: billingCycle,
      p_store_code: storeCode,
      p_store_name: storeName,
      p_amount: amount,
      p_notes: "PUBLIC_CHECKOUT_27_6_OWNER_EMAIL_PASSWORD",
    });
    if (orderError) throw orderError;

    const publicToken = statusToken();
    const { error: deliveryInsertError } = await admin.from("ldm2_checkout_deliveries").insert({
      payment_id: order.payment_id,
      license_id: order.license_id,
      order_id: newOrder,
      public_status_token_hash: await sha256Hex(publicToken),
      license_key_ciphertext: await encryptLicenseKey(rawKey),
    });
    if (deliveryInsertError) throw deliveryInsertError;
    let reserved;
    try {
      reserved = await reserveApplicationOwnerCredentials({
        customerName, customerEmail, ownerPassword, storeCode, orderId: newOrder,
      });
    } catch (reservationError) {
      await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrder, p_message: clean((reservationError as Error)?.message || "Reservasi akun Owner gagal.") });
      throw reservationError;
    }
    const { error: ownerReservationError } = await admin.from("ldm2_checkout_deliveries")
      .update({ owner_user_id: reserved.userId, provision_status: "pending", provision_error: null })
      .eq("payment_id", order.payment_id);
    if (ownerReservationError) throw ownerReservationError;
    await saveAttempt(admin, fingerprint, newOrder);

    try {
      const snap = await createMidtransSnap({
        orderId: newOrder, amount,
        itemName: `Lisensi LocDailyMar - ${plan.name} (${billingCycle})`,
        customerName, customerEmail, customerPhone,
      });
      const { error: saveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
        p_order_id: newOrder, p_snap_token: snap.token, p_redirect_url: snap.redirectUrl,
      });
      if (saveError) throw saveError;
      return json(req, {
        ok: true, order_id: newOrder, payment_id: order.payment_id, amount,
        snap_token: snap.token, redirect_url: snap.redirectUrl,
        client_key: env("MIDTRANS_CLIENT_KEY"),
        environment: env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" ? "production" : "sandbox",
        status_token: publicToken,
      });
    } catch (paymentError) {
      const message = clean((paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.");
      await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrder, p_message: message });
      try { await releaseApplicationOwnerReservation(admin, newOrder); } catch (_) {}
      return json(req, { ok: false, message: `Order tersimpan tetapi Midtrans gagal: ${message}`, order_id: newOrder }, 502);
    }
  } catch (error) {
    console.error("LDM_PUBLIC_CHECKOUT", error);
    const status = Number((error as any)?.status || 500);
    return json(req, {
      ok: false,
      code: clean((error as any)?.code || "CHECKOUT_FAILED", 80),
      message: clean((error as Error)?.message || "Checkout gagal.", 500),
    }, status);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function clean(value: unknown, max = 200) { return String(value || "").trim().slice(0, max); }
function randomHex(bytes = 8) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function orderId(kind: "PURCHASE" | "RENEW") {
  const date = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `LDM-${kind}-${date}-${randomHex(4)}`;
}
function licenseKey(plan: string) {
  const short = plan.replace("WARUNG_", "W");
  return `LDM2-${short}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}`;
}
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("LDM2_ADMIN_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean);
  const allowNull = env("LDM2_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if ((!origin || origin === "null") && allowNull) return "*";
  return origin && allowed.includes(origin) ? origin : "";
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req) || "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";
}
function midtransApiBase() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true"
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}
async function cancelMidtransTransaction(order: string) {
  const serverKey = env("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum disimpan pada Supabase Secrets.");
  const response = await fetch(`${midtransApiBase()}/v2/${encodeURIComponent(order)}/cancel`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || String(data?.transaction_status || "").toLowerCase() !== "cancel") {
    const message = clean(data?.status_message || data?.message || `Midtrans HTTP ${response.status}`, 500);
    throw new Error(`Midtrans belum dapat membatalkan order ini: ${message}`);
  }
  return data;
}
async function createMidtransSnap(input: {
  orderId: string;
  amount: number;
  itemName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${midtransBase()}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.token || !data?.redirect_url) {
      throw new Error(clean(data?.error_messages?.join?.("; ") || data?.message || `Midtrans HTTP ${response.status}`, 500));
    }
    return { token: String(data.token), redirectUrl: String(data.redirect_url) };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, message: "Gunakan POST." }, 405);
  if (!allowedOrigin(req)) return json(req, { ok: false, message: "Domain Developer Center belum diizinkan." }, 403);

  try {
    const url = env("SUPABASE_URL");
    const anon = env("SUPABASE_ANON_KEY");
    const service = env("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("authorization") || "";
    if (!url || !anon || !service) return json(req, { ok: false, message: "Secret server admin belum lengkap." }, 500);
    if (!authorization.toLowerCase().startsWith("bearer ")) return json(req, { ok: false, message: "Login developer diperlukan." }, 401);

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user?.email) return json(req, { ok: false, message: "Sesi developer tidak valid." }, 401);
    const adminEmail = authData.user.email.toLowerCase();
    const admins = env("LDM2_ADMIN_EMAILS").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(adminEmail)) return json(req, { ok: false, message: "Akun ini bukan developer yang diizinkan." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 40).toLowerCase();
    const audit = async (name: string, target: string | null, detail: Record<string, unknown> = {}) => {
      await admin.from("ldm2_admin_audit").insert({
        admin_user_id: authData.user.id,
        admin_email: adminEmail,
        action: name,
        target_license_id: target,
        detail,
      });
    };

    if (action === "dashboard") {
      const nowIso = new Date().toISOString();
      const { error: expiryError } = await admin.from("ldm2_licenses").update({ status: "expired" })
        .eq("status", "active").not("expires_at", "is", null).lte("expires_at", nowIso);
      if (expiryError) throw expiryError;
      const includeArchived = body.include_archived === true;
      let dashboardQuery = admin.from("ldm2_admin_license_overview").select("*")
        .order("created_at", { ascending: false }).limit(1000);
      if (!includeArchived) dashboardQuery = dashboardQuery.is("archived_at", null);
      const { data: rows, error } = await dashboardQuery;
      if (error) throw error;
      const list = rows || [];
      const now = Date.now();
      return json(req, {
        ok: true,
        admin_email: adminEmail,
        summary: {
          total: list.length,
          archived: list.filter((v) => Boolean(v.archived_at)).length,
          active: list.filter((v) => !v.archived_at && v.status === "active" && (!v.expires_at || new Date(v.expires_at).getTime() > now)).length,
          trial: list.filter((v) => !v.archived_at && v.is_trial && v.status === "active" && new Date(v.expires_at).getTime() > now).length,
          suspended: list.filter((v) => !v.archived_at && v.status === "suspended").length,
          expired: list.filter((v) => !v.archived_at && (v.status === "expired" || (v.expires_at && new Date(v.expires_at).getTime() <= now))).length,
          payment_pending: list.filter((v) => !v.archived_at && ["pending", "challenge"].includes(v.latest_payment_status)).length,
        },
        licenses: list,
      });
    }

    if (action === "devices") {
      const licenseId = clean(body.license_id, 80);
      const { data, error } = await admin.from("ldm2_activations")
        .select("id,license_id,device_name,store_code,status,activated_at,last_seen_at,deactivated_at,deactivation_reason,app_version")
        .eq("license_id", licenseId).order("last_seen_at", { ascending: false });
      if (error) throw error;
      return json(req, { ok: true, devices: data || [] });
    }

    if (action === "issue" || action === "issue_payment") {
      const planCode = clean(body.plan_code, 40).toUpperCase();
      const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
      const customerName = clean(body.customer_name, 120);
      const customerEmail = clean(body.customer_email, 180).toLowerCase();
      const customerPhone = clean(body.customer_phone, 40);
      const storeName = clean(body.store_name, 120);
      const storeCode = clean(body.store_code, 30).toUpperCase();

      if (customerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        return json(req, { ok: false, message: "Nama dan email customer wajib valid." }, 400);
      }
      if (storeName.length < 2) return json(req, { ok: false, message: "Nama toko wajib diisi." }, 400);
      if (storeCode && !/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(storeCode)) {
        return json(req, { ok: false, message: "Store Code harus 3-30 karakter: huruf, angka, atau tanda strip." }, 400);
      }

      const { data: plan, error: planError } = await admin.from("ldm2_plans")
        .select("code,name,price_monthly,price_yearly,price_lifetime,active")
        .eq("code", planCode).eq("active", true).maybeSingle();
      if (planError) throw planError;
      if (!plan) return json(req, { ok: false, message: "Paket tidak tersedia." }, 400);
      if (planCode === "LIFETIME" && billingCycle !== "lifetime") return json(req, { ok: false, message: "Paket Lifetime harus memakai siklus Lifetime." }, 400);
      if (planCode !== "LIFETIME" && !["monthly", "yearly"].includes(billingCycle)) return json(req, { ok: false, message: "Pilih periode bulanan atau tahunan." }, 400);

      const amount = Number(billingCycle === "monthly" ? plan.price_monthly : billingCycle === "yearly" ? plan.price_yearly : plan.price_lifetime);
      if (!Number.isSafeInteger(amount) || amount <= 0) return json(req, { ok: false, message: "Harga paket belum valid." }, 500);

      const rawKey = licenseKey(planCode);
      const newOrderId = orderId("PURCHASE");
      const { data: order, error: orderError } = await admin.rpc("ldm2_create_purchase_order", {
        p_order_id: newOrderId,
        p_key_hash_hex: await sha256(rawKey),
        p_key_prefix: rawKey.slice(0, 18),
        p_customer_name: customerName,
        p_customer_email: customerEmail,
        p_customer_phone: customerPhone || null,
        p_plan_code: planCode,
        p_billing_cycle: billingCycle,
        p_store_code: storeCode || null,
        p_store_name: storeName,
        p_amount: amount,
        p_notes: clean(body.notes, 500) || null,
      });
      if (orderError) throw orderError;

      try {
        const snap = await createMidtransSnap({
          orderId: newOrderId,
          amount,
          itemName: `Lisensi LocDailyMar - ${plan.name} (${billingCycle})`,
          customerName,
          customerEmail,
          customerPhone,
        });
        const { error: saveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
          p_order_id: newOrderId,
          p_snap_token: snap.token,
          p_redirect_url: snap.redirectUrl,
        });
        if (saveError) throw saveError;
        await audit("ISSUE_PAYMENT_ORDER", order?.license_id || null, { order_id: newOrderId, plan: planCode, billing_cycle: billingCycle, amount });
        return json(req, {
          ok: true,
          license: { ...order, license_key: rawKey, plan_name: plan.name },
          payment: { order_id: newOrderId, amount, status: "pending", redirect_url: snap.redirectUrl },
        });
      } catch (paymentError) {
        const message = (paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.";
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrderId, p_message: message });
        return json(req, {
          ok: false,
          message: `Order tersimpan, tetapi link Midtrans gagal dibuat: ${message}`,
          license: { ...order, license_key: rawKey, plan_name: plan.name },
          payment: { order_id: newOrderId, amount, status: "pending", redirect_url: null },
        }, 502);
      }
    }

    if (action === "renew" || action === "renew_payment") {
      const licenseId = clean(body.license_id, 80);
      const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
      const { data: license, error: licenseError } = await admin.from("ldm2_admin_license_overview")
        .select("id,plan_code,plan_name,customer_name,customer_email,customer_phone,primary_store_code,primary_store_id,primary_store_name,network_id,status,is_trial")
        .eq("id", licenseId).maybeSingle();
      if (licenseError) throw licenseError;
      if (!license) return json(req, { ok: false, message: "Lisensi tidak ditemukan." }, 404);
      if (license.is_trial) return json(req, { ok: false, message: "Trial harus dibuatkan pembelian lisensi berbayar baru." }, 409);
      if (!["monthly", "yearly"].includes(billingCycle)) return json(req, { ok: false, message: "Pilih perpanjangan bulanan atau tahunan." }, 400);

      const { data: plan, error: planError } = await admin.from("ldm2_plans")
        .select("code,name,price_monthly,price_yearly").eq("code", license.plan_code).maybeSingle();
      if (planError) throw planError;
      if (!plan) return json(req, { ok: false, message: "Paket lisensi tidak tersedia." }, 400);
      const amount = Number(billingCycle === "monthly" ? plan.price_monthly : plan.price_yearly);
      const newOrderId = orderId("RENEW");
      const { data: order, error: orderError } = await admin.rpc("ldm2_create_renewal_order", {
        p_order_id: newOrderId,
        p_license_id: license.id,
        p_billing_cycle: billingCycle,
        p_amount: amount,
      });
      if (orderError) throw orderError;

      try {
        const snap = await createMidtransSnap({
          orderId: newOrderId,
          amount,
          itemName: `Perpanjangan LocDailyMar - ${plan.name} (${billingCycle})`,
          customerName: license.customer_name,
          customerEmail: license.customer_email,
          customerPhone: license.customer_phone || "",
        });
        const { error: saveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
          p_order_id: newOrderId,
          p_snap_token: snap.token,
          p_redirect_url: snap.redirectUrl,
        });
        if (saveError) throw saveError;
        await audit("RENEW_PAYMENT_ORDER", license.id, { order_id: newOrderId, billing_cycle: billingCycle, amount });
        return json(req, { ok: true, license: order, payment: { order_id: newOrderId, amount, status: "pending", redirect_url: snap.redirectUrl } });
      } catch (paymentError) {
        const message = (paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.";
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrderId, p_message: message });
        return json(req, { ok: false, message, license: order, payment: { order_id: newOrderId, amount, status: "pending", redirect_url: null } }, 502);
      }
    }

    if (action === "convert_trial_payment") {
      const licenseId = clean(body.license_id, 80);
      const planCode = clean(body.plan_code, 40).toUpperCase();
      const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
      const { data: license, error: licenseError } = await admin.from("ldm2_admin_license_overview")
        .select("id,customer_name,customer_email,customer_phone,primary_store_code,primary_store_id,primary_store_name,network_id,status,is_trial")
        .eq("id", licenseId).maybeSingle();
      if (licenseError) throw licenseError;
      if (!license?.is_trial) return json(req, { ok: false, message: "Lisensi trial tidak ditemukan." }, 404);

      const { data: plan, error: planError } = await admin.from("ldm2_plans")
        .select("code,name,price_monthly,price_yearly,price_lifetime,active")
        .eq("code", planCode).eq("active", true).maybeSingle();
      if (planError) throw planError;
      if (!plan) return json(req, { ok: false, message: "Paket tujuan tidak tersedia." }, 400);
      if (planCode === "LIFETIME" && billingCycle !== "lifetime") return json(req, { ok: false, message: "Paket Lifetime harus memakai siklus Lifetime." }, 400);
      if (planCode !== "LIFETIME" && !["monthly", "yearly"].includes(billingCycle)) return json(req, { ok: false, message: "Pilih periode bulanan atau tahunan." }, 400);

      const amount = Number(billingCycle === "monthly" ? plan.price_monthly : billingCycle === "yearly" ? plan.price_yearly : plan.price_lifetime);
      if (!Number.isSafeInteger(amount) || amount <= 0) return json(req, { ok: false, message: "Harga paket belum valid." }, 500);
      const rawKey = licenseKey(planCode);
      const newOrderId = orderId("PURCHASE");
      const { data: order, error: orderError } = await admin.rpc("ldm2_create_trial_conversion_order", {
        p_order_id: newOrderId,
        p_license_id: license.id,
        p_key_hash_hex: await sha256(rawKey),
        p_key_prefix: rawKey.slice(0, 18),
        p_plan_code: planCode,
        p_billing_cycle: billingCycle,
        p_amount: amount,
      });
      if (orderError) throw orderError;

      try {
        const snap = await createMidtransSnap({
          orderId: newOrderId,
          amount,
          itemName: `Upgrade Trial LocDailyMar - ${plan.name} (${billingCycle})`,
          customerName: license.customer_name,
          customerEmail: license.customer_email,
          customerPhone: license.customer_phone || "",
        });
        const { error: saveError } = await admin.rpc("ldm2_set_midtrans_checkout", {
          p_order_id: newOrderId,
          p_snap_token: snap.token,
          p_redirect_url: snap.redirectUrl,
        });
        if (saveError) throw saveError;
        await audit("CONVERT_TRIAL_PAYMENT_ORDER", license.id, { order_id: newOrderId, plan: planCode, billing_cycle: billingCycle, amount });
        return json(req, {
          ok: true,
          license: { ...order, license_key: rawKey, plan_name: plan.name },
          payment: { order_id: newOrderId, amount, status: "pending", redirect_url: snap.redirectUrl },
        });
      } catch (paymentError) {
        const message = (paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.";
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrderId, p_message: message });
        return json(req, {
          ok: false,
          message: `Order konversi tersimpan, tetapi link Midtrans gagal dibuat: ${message}`,
          license: { ...order, license_key: rawKey, plan_name: plan.name },
          payment: { order_id: newOrderId, amount, status: "pending", redirect_url: null },
        }, 502);
      }
    }

    if (action === "set_status") {
      const licenseId = clean(body.license_id, 80);
      const status = clean(body.status, 20).toLowerCase();
      if (!["active", "suspended", "cancelled"].includes(status)) return json(req, { ok: false, message: "Status tidak diizinkan." }, 400);
      if (status === "active") {
        const { data: current } = await admin.from("ldm2_licenses").select("status").eq("id", licenseId).maybeSingle();
        if (current?.status === "pending_payment") return json(req, { ok: false, message: "Lisensi menunggu pembayaran dan tidak boleh diaktifkan manual." }, 409);
      }
      const reason = clean(body.reason, 500);
      const { data, error } = await admin.rpc("ldm2_set_license_status", { p_license_id: licenseId, p_status: status, p_reason: reason || null });
      if (error) throw error;
      await audit("SET_LICENSE_STATUS", licenseId, { status, reason });
      return json(req, data);
    }

    if (action === "cancel_pending_payment") {
      const licenseId = clean(body.license_id, 80);
      const { data: payment, error: paymentError } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,payment_type,amount,processed_at")
        .eq("license_id", licenseId)
        .in("status", ["pending", "challenge"])
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json(req, { ok: false, message: "Tidak ada order pembayaran pending/challenge untuk lisensi ini." }, 404);
      if (payment.processed_at) return json(req, { ok: false, message: "Pembayaran sudah diproses dan tidak dapat dibatalkan." }, 409);

      const cancelled = await cancelMidtransTransaction(payment.order_id);
      const { data: applied, error: applyError } = await admin.rpc("ldm2_apply_midtrans_notification", {
        p_order_id: payment.order_id,
        p_transaction_id: clean(cancelled?.transaction_id || "", 160),
        p_transaction_status: "cancel",
        p_fraud_status: clean(cancelled?.fraud_status || "", 40),
        p_status_code: clean(cancelled?.status_code || "200", 20),
        p_gross_amount: Number(payment.amount),
        p_provider_detail: cancelled,
      });
      if (applyError) throw applyError;

      if (payment.payment_type === "purchase") {
        const { data: currentLicense } = await admin.from("ldm2_licenses").select("status").eq("id", licenseId).maybeSingle();
        if (currentLicense?.status === "pending_payment") {
          const { error: cancelLicenseError } = await admin.from("ldm2_licenses").update({ status: "cancelled" }).eq("id", licenseId);
          if (cancelLicenseError) throw cancelLicenseError;
        }
      }
      await audit("CANCEL_PENDING_PAYMENT", licenseId, { order_id: payment.order_id, payment_type: payment.payment_type });
      return json(req, { ok: true, message: "Order pembayaran berhasil dibatalkan.", order_id: payment.order_id, result: applied });
    }

    if (action === "archive_license") {
      const licenseId = clean(body.license_id, 80);
      const reason = clean(body.reason, 500) || "Tidak digunakan lagi";
      const { data, error } = await admin.rpc("ldm2_archive_license", {
        p_license_id: licenseId,
        p_admin_email: adminEmail,
        p_reason: reason,
      });
      if (error) throw error;
      await audit("ARCHIVE_LICENSE", licenseId, { reason });
      return json(req, data);
    }

    if (action === "restore_license") {
      const licenseId = clean(body.license_id, 80);
      const { data, error } = await admin.rpc("ldm2_restore_archived_license", {
        p_license_id: licenseId,
        p_admin_email: adminEmail,
      });
      if (error) throw error;
      await audit("RESTORE_ARCHIVED_LICENSE", licenseId, {});
      return json(req, data);
    }

    if (action === "purge_unused_license") {
      const licenseId = clean(body.license_id, 80);
      const confirmation = clean(body.confirmation, 20).toUpperCase();
      const { data, error } = await admin.rpc("ldm2_purge_unused_license", {
        p_license_id: licenseId,
        p_admin_email: adminEmail,
        p_confirmation: confirmation,
      });
      if (error) throw error;
      return json(req, data);
    }

    if (action === "deactivate_device") {
      const activationId = clean(body.activation_id, 80);
      const reason = clean(body.reason, 500) || "Dinonaktifkan melalui Developer Center";
      const { data, error } = await admin.rpc("ldm2_deactivate_device", { p_activation_id: activationId, p_reason: reason });
      if (error) throw error;
      await audit("DEACTIVATE_DEVICE", null, { activation_id: activationId, reason });
      return json(req, data);
    }

    return json(req, { ok: false, message: "Action admin tidak dikenal." }, 400);
  } catch (error) {
    console.error("LDM_LICENSE_ADMIN_V2", error);
    return json(req, { ok: false, message: (error as Error)?.message || "Server Developer Center gagal memproses permintaan." }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cancelPaymentForRetry, midtransNotificationUrl, reconcilePaymentFromMidtrans,
} from "../_shared/ldm-midtrans-operations.ts";

const encoder = new TextEncoder();
const ADMIN_API_VERSION = "27.9.0-commercial-01.1";

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
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), admin_api_version: ADMIN_API_VERSION }
    : data;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-LDM-Admin-Version": ADMIN_API_VERSION,
    },
  });
}
function midtransBase() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true"
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";
}
function applicationAdminClient() {
  const appUrl = env("LDM_APP_SUPABASE_URL");
  const appService = env("LDM_APP_SERVICE_ROLE_KEY");
  if (!appUrl || !appService) {
    throw new Error("Incident Support belum dikonfigurasi. Isi LDM_APP_SUPABASE_URL dan LDM_APP_SERVICE_ROLE_KEY pada Secrets Developer Center.");
  }
  return createClient(appUrl, appService, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function validIncidentCode(value: unknown) {
  const code = clean(value, 40).toUpperCase();
  if (!/^ERR-\d{8}-[A-F0-9]{10}$/.test(code)) {
    throw Object.assign(new Error("Kode incident tidak valid. Contoh: ERR-20260905-A72C91D083"), { status: 400 });
  }
  return code;
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
    const requestedAction = clean(body.action, 40).toLowerCase();
    const actionAliases: Record<string, string> = {
      sync_payment: "sync_payment_status",
      sync_midtrans_status: "sync_payment_status",
      check_payment_status: "sync_payment_status",
      reconcile_payment: "sync_payment_status",
    };
    const action = actionAliases[requestedAction] || requestedAction;
    const audit = async (name: string, target: string | null, detail: Record<string, unknown> = {}) => {
      await admin.from("ldm2_admin_audit").insert({
        admin_user_id: authData.user.id,
        admin_email: adminEmail,
        action: name,
        target_license_id: target,
        detail,
      });
    };

    if (action === "incident_lookup") {
      const incidentCode = validIncidentCode(body.incident_code);
      const app = applicationAdminClient();
      const { data: incident, error: incidentError } = await app.from("client_error_events")
        .select("id,incident_code,store_id,user_id,username,role,severity,page,action,error_name,message,stack,source_file,line_no,column_no,app_version,device_id,browser,online,viewport,occurrence_count,first_seen_at,last_seen_at,resolved_at,resolution_note,support_status,support_last_action_at,created_at")
        .eq("incident_code", incidentCode).maybeSingle();
      if (incidentError) {
        if (/support_status|support_last_action_at/i.test(incidentError.message || "")) {
          throw new Error("SQL-35-DEVELOPER-INCIDENT-SUPPORT.sql belum dijalankan pada App Supabase.");
        }
        throw incidentError;
      }
      if (!incident) return json(req, { ok: false, message: "Incident tidak ditemukan." }, 404);

      const { data: store, error: storeError } = await app.from("stores")
        .select("id,code,name,status")
        .eq("id", incident.store_id).maybeSingle();
      if (storeError) throw storeError;

      await audit("support_incident_lookup", null, {
        incident_code: incidentCode,
        store_id: incident.store_id,
      });
      return json(req, { ok: true, incident, store: store || null });
    }

    if (action === "incident_support_update") {
      const incidentCode = validIncidentCode(body.incident_code);
      const supportStatus = clean(body.support_status, 20).toLowerCase();
      const note = clean(body.note, 1000);
      if (!["open", "investigating", "resolved"].includes(supportStatus)) {
        return json(req, { ok: false, message: "Status support tidak valid." }, 400);
      }

      const app = applicationAdminClient();
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        support_status: supportStatus,
        support_last_action_at: nowIso,
      };
      if (supportStatus === "resolved") {
        update.resolved_at = nowIso;
        update.resolved_by = null;
        update.resolution_note = note || "Diselesaikan oleh LocDailyMar Support.";
      } else {
        update.resolved_at = null;
        update.resolved_by = null;
        update.resolution_note = null;
      }

      const { data: incident, error: updateError } = await app.from("client_error_events")
        .update(update)
        .eq("incident_code", incidentCode)
        .select("id,incident_code,store_id,support_status,support_last_action_at,resolved_at,resolution_note")
        .maybeSingle();
      if (updateError) {
        if (/support_status|support_last_action_at/i.test(updateError.message || "")) {
          throw new Error("SQL-35-DEVELOPER-INCIDENT-SUPPORT.sql belum dijalankan pada App Supabase.");
        }
        throw updateError;
      }
      if (!incident) return json(req, { ok: false, message: "Incident tidak ditemukan." }, 404);

      await audit("support_incident_update", null, {
        incident_code: incidentCode,
        store_id: incident.store_id,
        support_status: supportStatus,
        note: note ? note.slice(0, 240) : null,
      });
      return json(req, { ok: true, incident });
    }

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
        .select("id,license_id,order_id,status,payment_type,amount,snap_token,processed_at,paid_at")
        .eq("license_id", licenseId)
        .in("status", ["pending", "challenge"])
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json(req, { ok: false, message: "Tidak ada order pembayaran pending/challenge untuk lisensi ini." }, 404);
      if (payment.processed_at) return json(req, { ok: false, message: "Pembayaran sudah diproses dan tidak dapat dibatalkan." }, 409);

      const cancelled = await cancelPaymentForRetry(
        admin, payment, `developer:${adminEmail}`, clean(body.reason, 500) || "Developer membatalkan order agar metode pembayaran dapat diganti",
      );
      await audit("CANCEL_PENDING_PAYMENT", licenseId, {
        order_id: payment.order_id,
        payment_type: payment.payment_type,
        license_preserved_for_retry: payment.payment_type === "purchase",
      });
      return json(req, {
        ok: true,
        message: "Order pembayaran berhasil dibatalkan. Lisensi dan Store Code tetap disimpan agar pembayaran baru dapat dibuat.",
        order_id: payment.order_id,
        result: cancelled.local,
      });
    }

    if (action === "sync_payment_status") {
      const licenseId = clean(body.license_id, 80);
      const { data: payment, error: paymentError } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,payment_type,amount,snap_token,processed_at,paid_at")
        .eq("license_id", licenseId)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json(req, { ok: false, message: "Order pembayaran tidak ditemukan." }, 404);
      if (!["pending", "challenge"].includes(payment.status)) {
        return json(req, { ok: true, order_id: payment.order_id, payment_status: payment.status, already_final: true });
      }
      const result = await reconcilePaymentFromMidtrans(admin, payment, `developer:${adminEmail}`);
      const { data: refreshed, error: refreshError } = await admin.from("ldm2_payments")
        .select("order_id,status,provider_status,paid_at,processed_at")
        .eq("id", payment.id).single();
      if (refreshError) throw refreshError;
      await audit("SYNC_PAYMENT_STATUS", licenseId, {
        order_id: payment.order_id,
        remote_found: result.found,
        payment_status: refreshed.status,
      });
      return json(req, {
        ok: true,
        order_id: payment.order_id,
        payment_status: refreshed.status,
        provider_status: refreshed.provider_status,
        remote_found: result.found,
        message: result.found
          ? `Status Midtrans berhasil disinkronkan: ${refreshed.status}.`
          : "Sesi Snap tersedia, tetapi transaksi Core belum dibuat karena customer belum memilih metode pembayaran.",
      });
    }

    if (action === "retry_purchase_payment") {
      const licenseId = clean(body.license_id, 80);
      const billingCycle = clean(body.billing_cycle, 20).toLowerCase();
      const { data: license, error: licenseError } = await admin.from("ldm2_admin_license_overview")
        .select("id,plan_code,plan_name,customer_name,customer_email,customer_phone,primary_store_code,primary_store_id,primary_store_name,network_id,status,latest_payment_status")
        .eq("id", licenseId).maybeSingle();
      if (licenseError) throw licenseError;
      if (!license || !["pending_payment", "cancelled"].includes(license.status)) {
        return json(req, { ok: false, message: "Retry pembelian hanya tersedia untuk lisensi purchase yang belum aktif." }, 409);
      }
      if (["pending", "challenge"].includes(license.latest_payment_status)) {
        return json(req, { ok: false, message: "Batalkan atau selesaikan order pending sebelumnya terlebih dahulu." }, 409);
      }
      if (license.plan_code === "LIFETIME" && billingCycle !== "lifetime") {
        return json(req, { ok: false, message: "Paket Lifetime harus memakai periode lifetime." }, 400);
      }
      if (license.plan_code !== "LIFETIME" && !["monthly", "yearly"].includes(billingCycle)) {
        return json(req, { ok: false, message: "Pilih periode monthly atau yearly." }, 400);
      }
      const { data: plan, error: planError } = await admin.from("ldm2_plans")
        .select("code,name,price_monthly,price_yearly,price_lifetime,active")
        .eq("code", license.plan_code).eq("active", true).maybeSingle();
      if (planError) throw planError;
      if (!plan) return json(req, { ok: false, message: "Paket lisensi tidak tersedia." }, 400);
      const amount = Number(billingCycle === "monthly" ? plan.price_monthly : billingCycle === "yearly" ? plan.price_yearly : plan.price_lifetime);
      if (!Number.isSafeInteger(amount) || amount <= 0) return json(req, { ok: false, message: "Harga paket belum valid." }, 500);

      const newOrderId = orderId("PURCHASE");
      const { data: order, error: orderError } = await admin.rpc("ldm2_create_retry_purchase_order", {
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
          itemName: `Lisensi LocDailyMar - ${plan.name} (${billingCycle})`,
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
        await audit("RETRY_PURCHASE_PAYMENT", license.id, { order_id: newOrderId, billing_cycle: billingCycle, amount });
        return json(req, {
          ok: true,
          license: {
            ...order,
            plan_name: plan.name,
            store_code: license.primary_store_code,
            store_id: license.primary_store_id,
            network_id: license.network_id,
          },
          payment: { order_id: newOrderId, amount, status: "pending", redirect_url: snap.redirectUrl },
        });
      } catch (paymentError) {
        const message = clean((paymentError as Error)?.message || "Midtrans gagal membuat pembayaran.", 500);
        await admin.rpc("ldm2_mark_payment_error", { p_order_id: newOrderId, p_message: message });
        return json(req, { ok: false, message: `Order retry tersimpan, tetapi Midtrans gagal: ${message}` }, 502);
      }
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

    return json(req, {
      ok: false,
      code: "ADMIN_ACTION_UNKNOWN",
      message: `Action admin tidak dikenal: ${requestedAction || "(kosong)"}. Pastikan Developer Center dan Edge Function memakai versi yang sama.`,
      requested_action: requestedAction || null,
    }, 400);
  } catch (error) {
    console.error("LDM_LICENSE_ADMIN_V2", error);
    const requestedStatus = Number((error as { status?: number })?.status || 500);
    const status = requestedStatus >= 400 && requestedStatus < 600 ? requestedStatus : 500;
    return json(req, { ok: false, message: (error as Error)?.message || "Server Developer Center gagal memproses permintaan." }, status);
  }
});

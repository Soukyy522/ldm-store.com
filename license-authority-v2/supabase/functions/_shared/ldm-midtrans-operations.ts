const encoder = new TextEncoder();

function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}

function clean(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function productionMode() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true";
}

function appBase() {
  return productionMode() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
}

function apiBase() {
  return productionMode() ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}

function serverKey() {
  const value = env("MIDTRANS_SERVER_KEY");
  if (!value) throw new Error("MIDTRANS_SERVER_KEY belum disimpan pada Supabase Secrets.");
  return value;
}

function authHeaders(includeJson = false) {
  const headers: Record<string, string> = {
    "Authorization": `Basic ${btoa(`${serverKey()}:`)}`,
    "Accept": "application/json",
  };
  if (includeJson) headers["Content-Type"] = "application/json";
  return headers;
}

function messages(data: any) {
  const list = Array.isArray(data?.error_messages) ? data.error_messages.join("; ") : "";
  return clean(list || data?.status_message || data?.message || "", 500);
}

function isMissingTransaction(response: Response, data: any) {
  const message = messages(data).toLowerCase();
  return response.status === 404 || String(data?.status_code || "") === "404" ||
    /transaction\s+doesn['’]?t\s+exist|transaction\s+not\s+found|payment\s+not\s+found/.test(message);
}

async function request(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

export function midtransNotificationUrl() {
  const explicit = env("MIDTRANS_NOTIFICATION_URL");
  const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const value = explicit || (supabaseUrl ? `${supabaseUrl}/functions/v1/ldm-midtrans-webhook` : "");
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export async function getMidtransTransactionStatus(orderId: string) {
  const order = clean(orderId, 120);
  if (!order) throw new Error("Order ID Midtrans kosong.");
  const { response, data } = await request(
    `${apiBase()}/v2/${encodeURIComponent(order)}/status`,
    { method: "GET", headers: authHeaders() },
  );
  if (isMissingTransaction(response, data)) {
    return { exists: false, data, http_status: response.status };
  }
  if (!response.ok || Number(data?.status_code || 200) >= 400) {
    const message = messages(data) || `Midtrans status HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, code: "MIDTRANS_STATUS_FAILED", detail: data });
  }
  return { exists: true, data, http_status: response.status };
}

export async function cancelMidtransCoreTransaction(orderId: string) {
  const order = clean(orderId, 120);
  const { response, data } = await request(
    `${apiBase()}/v2/${encodeURIComponent(order)}/cancel`,
    { method: "POST", headers: authHeaders(true) },
  );
  if (isMissingTransaction(response, data)) return { cancelled: false, missing: true, data };
  if (!response.ok || String(data?.transaction_status || "").toLowerCase() !== "cancel") {
    const message = messages(data) || `Midtrans cancel HTTP ${response.status}`;
    throw Object.assign(new Error(`Midtrans belum dapat membatalkan transaksi: ${message}`), {
      status: 409, code: "MIDTRANS_CANCEL_REJECTED", detail: data,
    });
  }
  return { cancelled: true, missing: false, data };
}

export async function cancelMidtransSnapSession(snapToken: string) {
  const token = clean(snapToken, 300);
  if (!token) return { cancelled: false, missing: true, in_progress: false, data: {} };
  const { response, data } = await request(
    `${appBase()}/snap/v1/transactions/${encodeURIComponent(token)}/cancel`,
    { method: "POST", headers: authHeaders(true) },
  );
  const message = messages(data).toLowerCase();
  if (response.ok && (data?.canceled_at || !message)) {
    return { cancelled: true, missing: false, in_progress: false, data };
  }
  if (/already\s+cancel/.test(message)) {
    return { cancelled: true, missing: false, in_progress: false, already_cancelled: true, data };
  }
  if (/token\s+not\s+found/.test(message) || response.status === 404) {
    return { cancelled: false, missing: true, in_progress: false, data };
  }
  if (/transaction\s+is\s+(?:on|in)\s+progress/.test(message)) {
    return { cancelled: false, missing: false, in_progress: true, data };
  }
  throw Object.assign(new Error(`Sesi Snap belum dapat dibatalkan: ${messages(data) || `HTTP ${response.status}`}`), {
    status: 409, code: "MIDTRANS_SNAP_CANCEL_REJECTED", detail: data,
  });
}

function safeProviderDetail(remote: any, source: string) {
  return {
    order_id: clean(remote?.order_id, 120),
    transaction_id: clean(remote?.transaction_id, 160),
    transaction_status: clean(remote?.transaction_status, 40),
    fraud_status: clean(remote?.fraud_status, 40),
    status_code: clean(remote?.status_code, 20),
    gross_amount: clean(remote?.gross_amount, 40),
    currency: clean(remote?.currency, 10),
    payment_type: clean(remote?.payment_type, 60),
    transaction_time: clean(remote?.transaction_time, 60),
    settlement_time: clean(remote?.settlement_time, 60),
    synced_by: source,
  };
}

export async function reconcilePaymentFromMidtrans(admin: any, payment: any, source: string) {
  const statusResult = await getMidtransTransactionStatus(String(payment?.order_id || ""));
  if (!statusResult.exists) {
    return { found: false, remote: null, applied: null, detail: statusResult.data };
  }
  const remote = statusResult.data;
  const order = String(payment?.order_id || "");
  if (clean(remote?.order_id, 120) !== order) {
    throw Object.assign(new Error("Order ID Midtrans tidak sesuai dengan order LocDailyMar."), {
      status: 409, code: "MIDTRANS_ORDER_MISMATCH",
    });
  }
  const remoteAmount = Number(remote?.gross_amount);
  if (!Number.isFinite(remoteAmount) || Math.round(remoteAmount) !== Number(payment?.amount)) {
    throw Object.assign(new Error("Nominal Midtrans tidak sesuai dengan order LocDailyMar."), {
      status: 409, code: "MIDTRANS_AMOUNT_MISMATCH",
    });
  }
  const { data: applied, error } = await admin.rpc("ldm2_apply_midtrans_notification", {
    p_order_id: order,
    p_transaction_id: clean(remote?.transaction_id, 160) || null,
    p_transaction_status: clean(remote?.transaction_status, 40),
    p_fraud_status: clean(remote?.fraud_status, 40) || null,
    p_status_code: clean(remote?.status_code, 20),
    p_gross_amount: remoteAmount,
    p_provider_detail: safeProviderDetail(remote, source),
  });
  if (error) throw error;
  if (applied?.ok === false) {
    throw Object.assign(new Error(clean(applied?.message || "Status Midtrans tidak dapat diterapkan.", 500)), {
      status: 409, code: clean(applied?.code || "MIDTRANS_APPLY_FAILED", 80), detail: applied,
    });
  }
  return { found: true, remote, applied, detail: null };
}

async function currentPayment(admin: any, orderId: string) {
  const { data, error } = await admin.from("ldm2_payments")
    .select("id,license_id,order_id,status,provider_status,payment_type,amount,snap_token,processed_at,paid_at")
    .eq("order_id", orderId).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Order LocDailyMar tidak ditemukan."), { status: 404, code: "ORDER_NOT_FOUND" });
  return data;
}

function ensureNotPaid(payment: any) {
  if (["paid", "refunded"].includes(String(payment?.status || "").toLowerCase()) || payment?.processed_at) {
    throw Object.assign(new Error("Pembayaran sudah berhasil/diproses dan tidak dapat dibatalkan. Gunakan proses refund sesuai kebijakan merchant."), {
      status: 409, code: "PAYMENT_ALREADY_FINAL",
    });
  }
}

export async function cancelPaymentForRetry(admin: any, paymentInput: any, actor: string, reason: string) {
  let payment = paymentInput;
  ensureNotPaid(payment);

  let reconciliation = await reconcilePaymentFromMidtrans(admin, payment, `${actor}_cancel_precheck`);
  payment = await currentPayment(admin, payment.order_id);
  ensureNotPaid(payment);

  let coreResult: any = null;
  let snapResult: any = null;
  const remoteStatus = clean(reconciliation?.remote?.transaction_status, 40).toLowerCase();
  if (reconciliation.found && !["cancel", "expire", "deny", "failure"].includes(remoteStatus)) {
    coreResult = await cancelMidtransCoreTransaction(payment.order_id);
    if (coreResult.cancelled) {
      const cancelled = coreResult.data;
      const { error } = await admin.rpc("ldm2_apply_midtrans_notification", {
        p_order_id: payment.order_id,
        p_transaction_id: clean(cancelled?.transaction_id, 160) || null,
        p_transaction_status: "cancel",
        p_fraud_status: clean(cancelled?.fraud_status, 40) || null,
        p_status_code: clean(cancelled?.status_code || "200", 20),
        p_gross_amount: Number(payment.amount),
        p_provider_detail: { ...cancelled, synced_by: `${actor}_cancel_core` },
      });
      if (error) throw error;
    }
  }

  snapResult = await cancelMidtransSnapSession(payment.snap_token);
  if (snapResult.in_progress && !coreResult?.cancelled) {
    reconciliation = await reconcilePaymentFromMidtrans(admin, payment, `${actor}_cancel_race_check`);
    payment = await currentPayment(admin, payment.order_id);
    ensureNotPaid(payment);
    if (reconciliation.found) {
      coreResult = await cancelMidtransCoreTransaction(payment.order_id);
      if (!coreResult.cancelled && !coreResult.missing) {
        throw Object.assign(new Error("Transaksi Midtrans belum dapat dibatalkan."), { status: 409, code: "MIDTRANS_CANCEL_REJECTED" });
      }
      snapResult = await cancelMidtransSnapSession(payment.snap_token);
    }
  }

  const providerStatus = coreResult?.cancelled ? "cancel" : snapResult?.cancelled ? "snap_cancelled" : "not_created";
  const { data: localResult, error: localError } = await admin.rpc("ldm2_cancel_pending_payment_local", {
    p_order_id: payment.order_id,
    p_actor: clean(actor, 80) || "system",
    p_reason: clean(reason, 500) || "Customer mengganti metode pembayaran",
    p_provider_status: providerStatus,
    p_provider_detail: {
      core_cancelled: Boolean(coreResult?.cancelled),
      core_missing: Boolean(coreResult?.missing),
      snap_cancelled: Boolean(snapResult?.cancelled),
      snap_missing: Boolean(snapResult?.missing),
      snap_in_progress: Boolean(snapResult?.in_progress),
    },
  });
  if (localError) throw localError;
  return { local: localResult, core: coreResult, snap: snapResult, reconciliation };
}

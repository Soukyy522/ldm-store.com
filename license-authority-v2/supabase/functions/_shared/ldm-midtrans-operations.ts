const encoder = new TextEncoder();

function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}

export function cleanMidtrans(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function productionMode() {
  return env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true";
}

export function midtransEnvironment() {
  return productionMode() ? "production" : "sandbox";
}

function appBase() {
  return productionMode() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
}

function apiBase() {
  return productionMode() ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}

function keyKind(value: string) {
  if (!value) return "missing";
  return /^SB-/i.test(value) ? "sandbox" : "production_or_custom";
}

function serverKey() {
  const value = env("MIDTRANS_SERVER_KEY");
  if (!value) throw new Error("MIDTRANS_SERVER_KEY belum disimpan pada Supabase Secrets.");
  if (productionMode() && /^SB-/i.test(value)) {
    throw Object.assign(new Error("Mode Midtrans production aktif tetapi Server Key masih terlihat seperti Sandbox (SB-*)."), {
      code: "MIDTRANS_PRODUCTION_SERVER_KEY_MISMATCH",
    });
  }
  return value;
}

export function midtransClientKey() {
  const value = env("MIDTRANS_CLIENT_KEY");
  if (productionMode() && /^SB-/i.test(value)) {
    throw Object.assign(new Error("Mode Midtrans production aktif tetapi Client Key masih terlihat seperti Sandbox (SB-*)."), {
      code: "MIDTRANS_PRODUCTION_CLIENT_KEY_MISMATCH",
    });
  }
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
  return cleanMidtrans(list || data?.status_message || data?.message || "", 500);
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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
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

export function midtransRuntimeHealth() {
  const server = env("MIDTRANS_SERVER_KEY");
  const client = env("MIDTRANS_CLIENT_KEY");
  const notification = midtransNotificationUrl();
  const problems: string[] = [];
  if (!server) problems.push("MIDTRANS_SERVER_KEY belum ada.");
  if (!client) problems.push("MIDTRANS_CLIENT_KEY belum ada.");
  if (!notification) problems.push("Notification URL HTTPS belum valid.");
  if (productionMode() && /^SB-/i.test(server)) problems.push("Production masih memakai Server Key Sandbox.");
  if (productionMode() && /^SB-/i.test(client)) problems.push("Production masih memakai Client Key Sandbox.");
  return {
    ok: problems.length === 0,
    environment: midtransEnvironment(),
    api_base: apiBase(),
    snap_base: appBase(),
    notification_url: notification || null,
    server_key_configured: Boolean(server),
    server_key_kind: keyKind(server),
    client_key_configured: Boolean(client),
    client_key_kind: keyKind(client),
    finish_url_configured: Boolean(env("MIDTRANS_FINISH_URL")),
    allowed_origins_configured: Boolean(env("LDM2_CHECKOUT_ALLOWED_ORIGINS")),
    problems,
  };
}

export function assertMidtransRuntime(requireClientKey = false) {
  const health = midtransRuntimeHealth();
  serverKey();
  if (requireClientKey && !midtransClientKey()) {
    throw Object.assign(new Error("MIDTRANS_CLIENT_KEY belum disimpan pada Supabase Secrets."), {
      code: "MIDTRANS_CLIENT_KEY_MISSING",
    });
  }
  if (!health.notification_url) {
    throw Object.assign(new Error("MIDTRANS_NOTIFICATION_URL/SUPABASE_URL belum menghasilkan Notification URL HTTPS yang valid."), {
      code: "MIDTRANS_NOTIFICATION_URL_INVALID",
    });
  }
  return health;
}

export async function getMidtransTransactionStatus(orderId: string) {
  assertMidtransRuntime(false);
  const order = cleanMidtrans(orderId, 120);
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
  assertMidtransRuntime(false);
  const order = cleanMidtrans(orderId, 120);
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
  assertMidtransRuntime(false);
  const token = cleanMidtrans(snapToken, 300);
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

export function safeMidtransProviderDetail(remote: any, source: string) {
  return {
    order_id: cleanMidtrans(remote?.order_id, 120),
    transaction_id: cleanMidtrans(remote?.transaction_id, 160),
    transaction_status: cleanMidtrans(remote?.transaction_status, 40),
    fraud_status: cleanMidtrans(remote?.fraud_status, 40),
    status_code: cleanMidtrans(remote?.status_code, 20),
    gross_amount: cleanMidtrans(remote?.gross_amount, 40),
    currency: cleanMidtrans(remote?.currency, 10),
    payment_type: cleanMidtrans(remote?.payment_type, 60),
    transaction_time: cleanMidtrans(remote?.transaction_time, 60),
    settlement_time: cleanMidtrans(remote?.settlement_time, 60),
    synced_by: cleanMidtrans(source, 120),
  };
}

export async function midtransEventKey(source: string, remote: any) {
  const material = [
    cleanMidtrans(source, 80),
    cleanMidtrans(remote?.order_id, 120),
    cleanMidtrans(remote?.transaction_id, 160),
    cleanMidtrans(remote?.transaction_status, 40),
    cleanMidtrans(remote?.fraud_status, 40),
    cleanMidtrans(remote?.status_code, 20),
    cleanMidtrans(remote?.gross_amount, 40),
    cleanMidtrans(remote?.transaction_time, 60),
    cleanMidtrans(remote?.settlement_time, 60),
    cleanMidtrans(remote?.refund_key || remote?.refund_chargeback_id || "", 120),
  ].join("|");
  return await sha256Hex(material);
}

export async function registerMidtransEvent(
  admin: any,
  eventKey: string,
  orderId: string,
  source: string,
  remote: any,
  signatureValid: boolean | null,
) {
  const amount = Number(remote?.gross_amount);
  const { data, error } = await admin.rpc("ldm2_register_midtrans_event", {
    p_event_key: cleanMidtrans(eventKey, 128),
    p_order_id: cleanMidtrans(orderId, 120),
    p_source: cleanMidtrans(source, 80),
    p_transaction_id: cleanMidtrans(remote?.transaction_id, 160) || null,
    p_transaction_status: cleanMidtrans(remote?.transaction_status, 40) || null,
    p_status_code: cleanMidtrans(remote?.status_code, 20) || null,
    p_gross_amount: Number.isFinite(amount) ? amount : null,
    p_signature_valid: signatureValid,
    p_provider_detail: safeMidtransProviderDetail(remote, source),
  });
  if (error) throw error;
  return data;
}

export async function finishMidtransEvent(
  admin: any,
  eventKey: string,
  success: boolean,
  errorMessage: string | null,
  detail: any = {},
) {
  const { error } = await admin.rpc("ldm2_finish_midtrans_event", {
    p_event_key: cleanMidtrans(eventKey, 128),
    p_success: success,
    p_error: errorMessage ? cleanMidtrans(errorMessage, 1000) : null,
    p_provider_detail: detail || {},
  });
  if (error) throw error;
}

export async function applyVerifiedMidtransStatus(
  admin: any,
  payment: any,
  remote: any,
  source: string,
  eventKey?: string,
  signatureValid: boolean | null = null,
) {
  const order = String(payment?.order_id || "");
  if (cleanMidtrans(remote?.order_id, 120) !== order) {
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
  const key = eventKey || await midtransEventKey(source, remote);
  const registered = await registerMidtransEvent(admin, key, order, source, remote, signatureValid);
  if (registered?.already_processed) {
    return { applied: { ok: true, duplicate_event: true }, event_key: key, duplicate_event: true };
  }
  try {
    const { data: applied, error } = await admin.rpc("ldm2_apply_midtrans_notification", {
      p_order_id: order,
      p_transaction_id: cleanMidtrans(remote?.transaction_id, 160) || null,
      p_transaction_status: cleanMidtrans(remote?.transaction_status, 40),
      p_fraud_status: cleanMidtrans(remote?.fraud_status, 40) || null,
      p_status_code: cleanMidtrans(remote?.status_code, 20),
      p_gross_amount: remoteAmount,
      p_provider_detail: safeMidtransProviderDetail(remote, source),
    });
    if (error) throw error;
    if (applied?.ok === false) {
      throw Object.assign(new Error(cleanMidtrans(applied?.message || "Status Midtrans tidak dapat diterapkan.", 500)), {
        status: 409, code: cleanMidtrans(applied?.code || "MIDTRANS_APPLY_FAILED", 80), detail: applied,
      });
    }
    await finishMidtransEvent(admin, key, true, null, { apply_result: applied });
    return { applied, event_key: key, duplicate_event: false };
  } catch (error) {
    try {
      await finishMidtransEvent(admin, key, false, (error as Error)?.message || "Apply Midtrans gagal");
    } catch (finishError) {
      console.error("MIDTRANS_EVENT_FINISH_FAILED", finishError);
    }
    throw error;
  }
}

export async function reconcilePaymentFromMidtrans(admin: any, payment: any, source: string) {
  const order = String(payment?.order_id || "");
  try {
    const statusResult = await getMidtransTransactionStatus(order);
    if (!statusResult.exists) {
      await admin.rpc("ldm2_mark_midtrans_reconciliation", {
        p_order_id: order, p_success: true, p_source: source, p_error: null,
      });
      return { found: false, remote: null, applied: null, detail: statusResult.data };
    }
    const remote = statusResult.data;
    const result = await applyVerifiedMidtransStatus(admin, payment, remote, source);
    const mark = await admin.rpc("ldm2_mark_midtrans_reconciliation", {
      p_order_id: order, p_success: true, p_source: source, p_error: null,
    });
    if (mark.error) throw mark.error;
    return { found: true, remote, applied: result.applied, detail: null, event_key: result.event_key };
  } catch (error) {
    try {
      await admin.rpc("ldm2_mark_midtrans_reconciliation", {
        p_order_id: order,
        p_success: false,
        p_source: source,
        p_error: cleanMidtrans((error as Error)?.message || "Rekonsiliasi Midtrans gagal", 1000),
      });
    } catch (markError) {
      console.error("MIDTRANS_RECONCILE_MARK_FAILED", order, markError);
    }
    throw error;
  }
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
  if (["paid", "refunded", "partially_refunded"].includes(String(payment?.status || "").toLowerCase()) || payment?.processed_at) {
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
  const remoteStatus = cleanMidtrans(reconciliation?.remote?.transaction_status, 40).toLowerCase();
  if (reconciliation.found && !["cancel", "expire", "deny", "failure"].includes(remoteStatus)) {
    coreResult = await cancelMidtransCoreTransaction(payment.order_id);
    if (coreResult.cancelled) {
      const cancelled = coreResult.data;
      const result = await applyVerifiedMidtransStatus(
        admin,
        payment,
        {
          ...cancelled,
          order_id: cancelled?.order_id || payment.order_id,
          gross_amount: cancelled?.gross_amount || String(payment.amount),
          transaction_status: "cancel",
          status_code: cancelled?.status_code || "200",
        },
        `${actor}_cancel_core`,
      );
      if (result.applied?.ok === false) throw new Error("Status cancel Midtrans tidak dapat diterapkan.");
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
    p_actor: cleanMidtrans(actor, 80) || "system",
    p_reason: cleanMidtrans(reason, 500) || "Customer mengganti metode pembayaran",
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

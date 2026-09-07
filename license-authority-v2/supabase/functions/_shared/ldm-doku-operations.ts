// LocDailyMar 27.9.0 - DOKU multi-gateway adapter V23
// DOKU Checkout (Non-SNAP) - server-side only.

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function cleanDoku(value: unknown, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
function productionMode() { return env("DOKU_IS_PRODUCTION").toLowerCase() === "true"; }
export function dokuEnvironment() { return productionMode() ? "production" : "sandbox"; }
export function dokuApiBase() { return productionMode() ? "https://api.doku.com" : "https://api-sandbox.doku.com"; }
export function dokuClientId() { return env("DOKU_CLIENT_ID"); }
export function dokuSecretConfigured() { return Boolean(env("DOKU_SECRET_KEY")); }
export function dokuCallbackUrl() { return env("DOKU_CALLBACK_URL"); }
export function dokuNotificationUrl() {
  const explicit = env("DOKU_NOTIFICATION_URL");
  const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  return explicit || (supabaseUrl ? `${supabaseUrl}/functions/v1/ldm-doku-webhook` : "");
}

function urlHealth(value: string, production: boolean) {
  if (!value) return { ok: false, reason: "missing" };
  try {
    const u = new URL(value);
    if (production && u.protocol !== "https:") return { ok: false, reason: "production_requires_https" };
    if (production && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) {
      return { ok: false, reason: "localhost_not_allowed" };
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
}

export function dokuRuntimeHealth() {
  const production = productionMode();
  const clientId = dokuClientId();
  const secret = env("DOKU_SECRET_KEY");
  const callback = dokuCallbackUrl();
  const notification = dokuNotificationUrl();
  const problems: string[] = [];
  if (!clientId) problems.push("DOKU_CLIENT_ID belum diisi.");
  if (!secret) problems.push("DOKU_SECRET_KEY belum diisi.");
  const callbackHealth = urlHealth(callback, production);
  const notificationHealth = urlHealth(notification, production);
  if (!callbackHealth.ok) problems.push(`DOKU_CALLBACK_URL tidak valid: ${callbackHealth.reason}.`);
  if (!notificationHealth.ok) problems.push(`DOKU_NOTIFICATION_URL tidak valid: ${notificationHealth.reason}.`);
  if (production && /sandbox/i.test(callback)) problems.push("DOKU_CALLBACK_URL Production masih mengandung sandbox.");
  if (production && /sandbox/i.test(notification)) problems.push("DOKU_NOTIFICATION_URL Production masih mengandung sandbox.");
  return {
    ok: problems.length === 0,
    hardening_version: "27.9.0-doku-multi-gateway-v23",
    environment: dokuEnvironment(),
    api_base: dokuApiBase(),
    client_id_configured: Boolean(clientId),
    secret_key_configured: Boolean(secret),
    callback_url_configured: Boolean(callback),
    notification_url_configured: Boolean(notification),
    problems,
  };
}

export function assertDokuRuntime() {
  const health = dokuRuntimeHealth();
  if (!health.ok) {
    throw Object.assign(new Error(`Konfigurasi DOKU belum siap: ${health.problems.join(" ")}`), {
      status: 503, code: "DOKU_RUNTIME_INVALID", health,
    });
  }
  return health;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
async function sha256Base64(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToBase64(new Uint8Array(digest));
}
async function hmacBase64(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return bytesToBase64(new Uint8Array(sig));
}
function constantTimeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
function requestId() { return crypto.randomUUID(); }
function requestTimestamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

async function signedHeaders(method: "GET" | "POST", target: string, bodyText = "", forcedRequestId?: string) {
  const clientId = dokuClientId();
  const secretKey = env("DOKU_SECRET_KEY");
  if (!clientId || !secretKey) throw Object.assign(new Error("DOKU Client ID / Secret Key belum lengkap."), { status: 503 });
  const id = forcedRequestId || requestId();
  const timestamp = requestTimestamp();
  const parts = [
    `Client-Id:${clientId}`,
    `Request-Id:${id}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${target}`,
  ];
  if (method === "POST") parts.push(`Digest:${await sha256Base64(bodyText)}`);
  const component = parts.join("\n");
  const signature = `HMACSHA256=${await hmacBase64(secretKey, component)}`;
  return {
    headers: {
      "Client-Id": clientId,
      "Request-Id": id,
      "Request-Timestamp": timestamp,
      "Signature": signature,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    requestId: id,
    timestamp,
  };
}

async function verifyDokuResponseSignature(response: Response, bodyText: string, target: string, requestIdValue: string) {
  const signature = cleanDoku(response.headers.get("signature"), 500);
  const responseTimestamp = cleanDoku(response.headers.get("response-timestamp"), 80);
  const responseClientId = cleanDoku(response.headers.get("client-id"), 120);
  if (!signature || !responseTimestamp) {
    // Sebagian response/error upstream dapat tidak menandatangani payload.
    // Untuk response sukses Production, signature wajib tersedia.
    if (productionMode() && response.ok) {
      throw Object.assign(new Error("DOKU response sukses tidak memiliki Signature/Response-Timestamp."), { status: 502, code: "DOKU_RESPONSE_SIGNATURE_MISSING" });
    }
    return { ok: false, skipped: true };
  }
  if (responseClientId && responseClientId !== dokuClientId()) {
    throw Object.assign(new Error("DOKU response Client-Id tidak cocok."), { status: 502, code: "DOKU_RESPONSE_CLIENT_MISMATCH" });
  }
  const digest = await sha256Base64(bodyText);
  const component = [
    `Client-Id:${dokuClientId()}`,
    `Request-Id:${requestIdValue}`,
    `Response-Timestamp:${responseTimestamp}`,
    `Request-Target:${target}`,
    `Digest:${digest}`,
  ].join("\n");
  const expected = `HMACSHA256=${await hmacBase64(env("DOKU_SECRET_KEY"), component)}`;
  if (!constantTimeEqual(signature, expected)) {
    throw Object.assign(new Error("Signature response DOKU tidak valid."), { status: 502, code: "DOKU_RESPONSE_SIGNATURE_INVALID" });
  }
  return { ok: true, skipped: false };
}

export async function createDokuCheckout(input: {
  orderId: string; amount: number; itemName: string;
  customerName: string; customerEmail: string; customerPhone: string;
}) {
  assertDokuRuntime();
  const target = "/checkout/v1/payment";
  const notificationUrl = dokuNotificationUrl();
  const dueRaw = Number(env("DOKU_PAYMENT_DUE_MINUTES") || 60);
  const dueMinutes = Number.isFinite(dueRaw) ? Math.max(5, Math.min(1440, Math.floor(dueRaw))) : 60;
  const callback = dokuCallbackUrl();
  const payload: Record<string, any> = {
    order: {
      amount: input.amount,
      invoice_number: input.orderId,
      currency: "IDR",
      callback_url: callback,
      callback_url_result: callback,
      language: "ID",
      auto_redirect: true,
      disable_retry_payment: false,
    },
    payment: { payment_due_date: dueMinutes, type: "SALE" },
    customer: {
      id: input.orderId.slice(0, 50),
      name: input.customerName.slice(0, 255),
      email: input.customerEmail.slice(0, 128),
      phone: input.customerPhone.slice(0, 16),
      country: "ID",
    },
    additional_info: notificationUrl ? { override_notification_url: notificationUrl } : undefined,
  };
  const bodyText = JSON.stringify(payload);
  const signed = await signedHeaders("POST", target, bodyText);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${dokuApiBase()}${target}`, {
      method: "POST", headers: signed.headers, body: bodyText, signal: controller.signal,
    });
    const responseText = await response.text();
    await verifyDokuResponseSignature(response, responseText, target, signed.requestId);
    const data = (() => { try { return responseText ? JSON.parse(responseText) : {}; } catch { return {}; } })();
    const root = data?.response || data;
    const payment = root?.payment || {};
    const url = cleanDoku(payment?.url, 1000);
    const tokenId = cleanDoku(payment?.token_id, 300);
    if (!response.ok || !url || !tokenId) {
      const messages = Array.isArray(data?.error_messages) ? data.error_messages.join("; ")
        : Array.isArray(data?.message) ? data.message.join("; ")
        : cleanDoku(data?.message || data?.error || `DOKU HTTP ${response.status}`, 500);
      throw Object.assign(new Error(`DOKU menolak checkout: ${messages || `HTTP ${response.status}`}`), {
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
        code: "DOKU_CHECKOUT_FAILED",
      });
    }
    return {
      tokenId,
      redirectUrl: url,
      requestId: signed.requestId,
      expiredDate: cleanDoku(payment?.expired_date, 40) || null,
      sessionId: cleanDoku(root?.order?.session_id, 200) || null,
      raw: data,
    };
  } finally { clearTimeout(timeout); }
}

export async function checkDokuStatus(orderId: string) {
  assertDokuRuntime();
  const order = cleanDoku(orderId, 64);
  if (!order) throw Object.assign(new Error("Order ID DOKU wajib diisi."), { status: 400 });
  const target = `/orders/v1/status/${encodeURIComponent(order)}`;
  const signed = await signedHeaders("GET", target);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${dokuApiBase()}${target}`, { method: "GET", headers: signed.headers, signal: controller.signal });
    const responseText = await response.text();
    await verifyDokuResponseSignature(response, responseText, target, signed.requestId);
    const data = (() => { try { return responseText ? JSON.parse(responseText) : {}; } catch { return {}; } })();
    if (response.status === 404) return { found: false, remote: data, requestId: signed.requestId };
    if (!response.ok) {
      const message = Array.isArray(data?.error_messages) ? data.error_messages.join("; ")
        : cleanDoku(data?.message || data?.error || `DOKU HTTP ${response.status}`, 500);
      throw Object.assign(new Error(`DOKU Check Status gagal: ${message}`), { status: 502, code: "DOKU_STATUS_FAILED" });
    }
    return { found: true, remote: data, requestId: signed.requestId };
  } finally { clearTimeout(timeout); }
}

export async function verifyDokuNotification(headers: Headers, rawBody: string, requestTarget: string) {
  const clientId = cleanDoku(headers.get("client-id"), 120);
  const reqId = cleanDoku(headers.get("request-id"), 128);
  const timestamp = cleanDoku(headers.get("request-timestamp"), 80);
  const signature = cleanDoku(headers.get("signature"), 500);
  const expectedClientId = dokuClientId();
  if (!clientId || !reqId || !timestamp || !signature) {
    return { ok: false, reason: "DOKU notification header belum lengkap.", requestId: reqId };
  }
  if (!expectedClientId || clientId !== expectedClientId) {
    return { ok: false, reason: "DOKU Client-Id notification tidak cocok.", requestId: reqId };
  }
  const digest = await sha256Base64(rawBody);
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${reqId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${requestTarget}`,
    `Digest:${digest}`,
  ].join("\n");
  const expected = `HMACSHA256=${await hmacBase64(env("DOKU_SECRET_KEY"), component)}`;
  const valid = constantTimeEqual(signature, expected);
  return { ok: valid, reason: valid ? null : "Signature DOKU tidak valid.", requestId: reqId };
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function dokuEventKey(source: string, remote: any, requestIdValue = "") {
  const order = cleanDoku(remote?.order?.invoice_number, 120);
  const status = cleanDoku(remote?.transaction?.status || remote?.order?.status, 80).toUpperCase();
  const tx = cleanDoku(remote?.transaction?.original_request_id || remote?.transaction?.request_id || "", 160);
  // Duplicate notification dapat memakai Request-Id berbeda. Prioritaskan identitas bisnis
  // order + status + transaction id; Request-Id hanya fallback bila transaksi belum punya id.
  const stableRemoteId = tx || cleanDoku(requestIdValue, 128);
  const seed = [cleanDoku(source, 80), order, status, stableRemoteId].join("|");
  return (await sha256Hex(seed)).slice(0, 128);
}

function amountFromRemote(remote: any) {
  const value = Number(remote?.order?.amount);
  return Number.isFinite(value) ? value : null;
}
function statusFromRemote(remote: any) {
  return cleanDoku(remote?.transaction?.status || remote?.order?.status || "", 60).toUpperCase();
}
function txFromRemote(remote: any) {
  return cleanDoku(remote?.transaction?.original_request_id || remote?.transaction?.request_id || remote?.uuid || "", 160);
}
function safeProviderDetail(remote: any, source: string) {
  return {
    provider: "doku",
    synced_by: cleanDoku(source, 120),
    service_id: cleanDoku(remote?.service?.id, 100) || null,
    acquirer_id: cleanDoku(remote?.acquirer?.id, 100) || null,
    channel_id: cleanDoku(remote?.channel?.id, 100) || null,
    transaction_status: statusFromRemote(remote) || null,
    transaction_date: cleanDoku(remote?.transaction?.date, 80) || null,
    original_request_id: txFromRemote(remote) || null,
  };
}

export async function registerDokuEvent(admin: any, input: {
  eventKey: string; orderId: string; source: string; requestId: string;
  remote: any; signatureValid: boolean;
}) {
  const { data, error } = await admin.rpc("ldm2_register_doku_event", {
    p_event_key: input.eventKey,
    p_order_id: input.orderId,
    p_source: input.source,
    p_request_id: input.requestId || null,
    p_transaction_id: txFromRemote(input.remote) || null,
    p_transaction_status: statusFromRemote(input.remote) || null,
    p_gross_amount: amountFromRemote(input.remote),
    p_signature_valid: input.signatureValid,
    p_provider_detail: safeProviderDetail(input.remote, input.source),
  });
  if (error) throw error;
  return data;
}

export async function finishDokuEvent(admin: any, eventKey: string, success: boolean, errorMessage: string | null, detail: any = {}) {
  const { error } = await admin.rpc("ldm2_finish_doku_event", {
    p_event_key: eventKey, p_success: success, p_error: errorMessage, p_provider_detail: detail || {},
  });
  if (error) throw error;
}

export async function applyDokuRemote(admin: any, remote: any, source: string) {
  const orderId = cleanDoku(remote?.order?.invoice_number, 120);
  if (!orderId) throw Object.assign(new Error("DOKU payload tidak memiliki order.invoice_number."), { status: 400 });
  const { data, error } = await admin.rpc("ldm2_apply_doku_notification", {
    p_order_id: orderId,
    p_transaction_id: txFromRemote(remote) || null,
    p_transaction_status: statusFromRemote(remote),
    p_gross_amount: amountFromRemote(remote),
    p_provider_detail: safeProviderDetail(remote, source),
  });
  if (error) throw error;
  return data;
}

export async function reconcilePaymentFromDoku(admin: any, payment: any, source = "reconcile") {
  const orderId = cleanDoku(payment?.order_id, 120);
  if (!orderId) throw new Error("Order DOKU tidak valid.");
  try {
    const checked = await checkDokuStatus(orderId);
    if (!checked.found) {
      await admin.rpc("ldm2_mark_doku_reconciliation", { p_order_id: orderId, p_success: true, p_source: source, p_error: null });
      return checked;
    }
    await applyDokuRemote(admin, checked.remote, source);
    await admin.rpc("ldm2_mark_doku_reconciliation", { p_order_id: orderId, p_success: true, p_source: source, p_error: null });
    return checked;
  } catch (error) {
    await admin.rpc("ldm2_mark_doku_reconciliation", {
      p_order_id: orderId, p_success: false, p_source: source,
      p_error: cleanDoku((error as Error)?.message || "DOKU reconcile gagal", 1000),
    }).catch(() => null);
    throw error;
  }
}

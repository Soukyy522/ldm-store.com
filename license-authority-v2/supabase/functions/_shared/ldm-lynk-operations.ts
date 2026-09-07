import { clean, env, sha256Hex } from "./ldm-license-delivery.ts";

export function lynkRuntimeHealth() {
  const token = env("LYNK_WEBHOOK_TOKEN");
  const auto = env("LYNK_AUTO_PROCESS").toLowerCase() === "true";
  return {
    ok: token.length >= 32,
    webhook_token_configured: token.length >= 32,
    auto_process: auto,
    success_values: successValues(),
    mappings: {
      transaction_id: env("LYNK_WEBHOOK_TRANSACTION_ID_PATH") || "auto",
      status: env("LYNK_WEBHOOK_STATUS_PATH") || "auto",
      amount: env("LYNK_WEBHOOK_AMOUNT_PATH") || "auto",
      email: env("LYNK_WEBHOOK_EMAIL_PATH") || "auto",
      product: env("LYNK_WEBHOOK_PRODUCT_PATH") || "auto",
    },
  };
}

function getPath(obj: any, path: string) {
  if (!path) return undefined;
  return path.split(".").filter(Boolean).reduce((cur: any, key: string) => cur == null ? undefined : cur[key], obj);
}

function first(obj: any, paths: string[]) {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function mapped(obj: any, envName: string, fallbacks: string[]) {
  const configured = env(envName);
  if (configured) return getPath(obj, configured);
  return first(obj, fallbacks);
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+(?:\.0+)?$/.test(raw)) return Math.round(Number(raw));
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

export function successValues() {
  const vals = (env("LYNK_WEBHOOK_SUCCESS_VALUES") || "success,paid,settlement,completed")
    .split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  return [...new Set(vals)];
}

export function extractLynkPayload(body: any) {
  const transactionId = clean(mapped(body,"LYNK_WEBHOOK_TRANSACTION_ID_PATH",[
    "transaction_id","transaction.id","order.id","order_id","trx_id","data.transaction_id","data.transaction.id","data.order.id"
  ]),180);
  const status = clean(mapped(body,"LYNK_WEBHOOK_STATUS_PATH",[
    "status","transaction.status","order.status","payment.status","data.status","data.transaction.status","data.payment.status"
  ]),100);
  const amount = parseAmount(mapped(body,"LYNK_WEBHOOK_AMOUNT_PATH",[
    "amount","total","gross_amount","transaction.amount","order.amount","payment.amount","data.amount","data.total","data.transaction.amount"
  ]));
  const email = clean(mapped(body,"LYNK_WEBHOOK_EMAIL_PATH",[
    "customer.email","buyer.email","email","order.customer.email","data.customer.email","data.buyer.email","data.email"
  ]),200).toLowerCase();
  const product = clean(mapped(body,"LYNK_WEBHOOK_PRODUCT_PATH",[
    "product.id","product_id","item.id","item.product_id","product.slug","product.name","data.product.id","data.product_id","data.item.id"
  ]),300);
  return { transactionId, status, amount, email, product, statusIsSuccess: successValues().includes(status.toLowerCase()) };
}

function safeEqual(a: string, b: string) {
  const ae = new TextEncoder().encode(a), be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0; for (let i=0;i<ae.length;i++) diff |= ae[i] ^ be[i]; return diff === 0;
}

export function verifyWebhookToken(req: Request) {
  const expected = env("LYNK_WEBHOOK_TOKEN");
  const got = new URL(req.url).searchParams.get("token") || req.headers.get("x-ldm-webhook-token") || "";
  return expected.length >= 32 && safeEqual(expected, got);
}

export function headersToJson(headers: Headers) {
  const result: Record<string,string> = {};
  for (const [k,v] of headers.entries()) {
    if (["authorization","cookie","set-cookie"].includes(k.toLowerCase())) result[k] = "[redacted]";
    else result[k] = clean(v,1000);
  }
  return result;
}

export async function eventKey(rawBody: string, transactionId: string) {
  return transactionId ? `lynk:${transactionId}` : `lynk:sha256:${await sha256Hex(rawBody)}`;
}

export async function registerEvent(admin: any, input: {
  eventKey: string; parsed: any; tokenValid: boolean; autoProcess: boolean; headers: any; body: any;
}) {
  const { data, error } = await admin.rpc("ldm2_register_lynk_event", {
    p_event_key: input.eventKey,
    p_transaction_id: input.parsed.transactionId || null,
    p_event_status: input.parsed.status || null,
    p_customer_email: input.parsed.email || null,
    p_gross_amount: input.parsed.amount,
    p_product_ref: input.parsed.product || null,
    p_token_valid: input.tokenValid,
    p_auto_process_enabled: input.autoProcess,
    p_raw_headers: input.headers || {},
    p_payload: input.body || {},
  });
  if (error) throw error;
  return data;
}

export async function finishEvent(admin: any, input: {
  eventKey: string; orderId?: string | null; matchStatus?: string | null; success: boolean;
  error?: string | null; emailStatus?: string | null; emailError?: string | null;
}) {
  const { error } = await admin.rpc("ldm2_finish_lynk_event", {
    p_event_key: input.eventKey,
    p_order_id: input.orderId || null,
    p_match_status: input.matchStatus || null,
    p_success: input.success,
    p_error: input.error || null,
    p_delivery_email_status: input.emailStatus || null,
    p_delivery_email_error: input.emailError || null,
  });
  if (error) throw error;
}

export async function matchPendingOrder(admin: any, parsed: any) {
  if (!parsed.email || !parsed.amount) return { ok: false, status: "MISSING_EMAIL_OR_AMOUNT", candidates: [] };
  const { data: licenses, error: licenseError } = await admin.from("ldm2_licenses")
    .select("id,customer_email,plan_code,primary_store_code").eq("customer_email", parsed.email);
  if (licenseError) throw licenseError;
  const ids = (licenses || []).map((x: any) => x.id);
  if (!ids.length) return { ok: false, status: "NO_CUSTOMER_ORDER", candidates: [] };
  const since = new Date(Date.now() - 48*60*60*1000).toISOString();
  const { data: payments, error: paymentError } = await admin.from("ldm2_payments")
    .select("id,license_id,order_id,provider,status,amount,plan_code,billing_cycle,created_at,provider_detail")
    .eq("provider","lynk").in("license_id",ids).in("status",["pending","challenge"])
    .eq("amount",Math.round(parsed.amount)).gte("created_at",since).order("created_at",{ascending:false});
  if (paymentError) throw paymentError;
  const candidates = payments || [];
  if (candidates.length === 1) return { ok: true, status: "UNIQUE_EMAIL_AMOUNT_MATCH", order: candidates[0], candidates };
  if (candidates.length > 1) return { ok: false, status: "AMBIGUOUS_MATCH", candidates };

  // V28: jika customer membatalkan order lokal tetapi tetap membayar pada tab Lynk.id,
  // deteksi order CANCELLED unik agar webhook dapat ditandai NEEDS_REFUND_REVIEW.
  const { data: cancelled, error: cancelledError } = await admin.from("ldm2_payments")
    .select("id,license_id,order_id,provider,status,amount,plan_code,billing_cycle,created_at,provider_detail")
    .eq("provider","lynk").in("license_id",ids).eq("status","cancelled")
    .eq("amount",Math.round(parsed.amount)).gte("created_at",since).order("created_at",{ascending:false});
  if (cancelledError) throw cancelledError;
  const cancelledCandidates = cancelled || [];
  if (cancelledCandidates.length === 1) return { ok: true, status: "UNIQUE_CANCELLED_EMAIL_AMOUNT_MATCH", order: cancelledCandidates[0], candidates: cancelledCandidates };
  if (cancelledCandidates.length > 1) return { ok: false, status: "AMBIGUOUS_CANCELLED_MATCH", candidates: cancelledCandidates };
  return { ok: false, status: "NO_PENDING_MATCH", candidates: [] };
}

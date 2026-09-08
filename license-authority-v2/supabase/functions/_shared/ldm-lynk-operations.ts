import { clean, env, sha256Hex } from "./ldm-license-delivery.ts";

type Candidate<T> = { value: T; path: string; score: number };
type Scalar = { path: string; key: string; value: unknown };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const NEGATIVE_STATUS_WORDS = new Set([
  "failed","fail","failure","cancelled","canceled","expired","pending","unpaid",
  "invalid","deny","denied","declined","challenge","waiting","wait","error","rejected"
]);

function uniqueCandidates<T>(items: Candidate<T>[], keyFn: (value: T) => string): Candidate<T>[] {
  const best = new Map<string, Candidate<T>>();
  for (const item of items) {
    const key = keyFn(item.value);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || item.score > prev.score) best.set(key, item);
  }
  return [...best.values()].sort((a,b) => b.score - a.score);
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}

function statusTokens(value: unknown) {
  return normalizeStatus(value).split("_").filter(Boolean);
}

function isExplicitNegativeStatus(value: unknown) {
  return statusTokens(value).some((token) => NEGATIVE_STATUS_WORDS.has(token));
}

export function successValues() {
  const vals = (env("LYNK_WEBHOOK_SUCCESS_VALUES") || "success,successful,paid,settlement,completed,complete,payment_success,payment_successful")
    .split(",").map((v) => normalizeStatus(v)).filter(Boolean);
  return [...new Set(vals)];
}

function statusMatchesSuccess(value: unknown) {
  const normalized = normalizeStatus(value);
  if (!normalized || isExplicitNegativeStatus(normalized)) return false;
  const configured = successValues();
  if (configured.includes(normalized)) return true;
  const tokens = new Set(statusTokens(normalized));
  return configured.some((success) => {
    if (!success) return false;
    if (success.includes("_")) return normalized.includes(success);
    return tokens.has(success);
  });
}

export function lynkRuntimeHealth() {
  const token = env("LYNK_WEBHOOK_TOKEN");
  const auto = env("LYNK_AUTO_PROCESS").toLowerCase() === "true";
  const assumeSuccess = env("LYNK_ASSUME_SUCCESS_WEBHOOK").toLowerCase() === "true";
  return {
    ok: token.length >= 32,
    webhook_token_configured: token.length >= 32,
    auto_process: auto,
    assume_success_webhook: assumeSuccess,
    matching_mode: "mapped_plus_recursive_unique_match",
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
    if (value !== undefined && value !== null && String(value).trim() !== "") return { value, path };
  }
  return undefined;
}

function walkScalars(input: any, maxDepth=8, maxScalars=2500): Scalar[] {
  const out: Scalar[] = [];
  const visit = (value: any, path: string, depth: number) => {
    if (out.length >= maxScalars || depth > maxDepth) return;
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.slice(0,200).forEach((item,index) => visit(item, `${path}[${index}]`, depth+1));
      return;
    }
    if (typeof value === "object") {
      for (const [key,item] of Object.entries(value)) {
        visit(item, path ? `${path}.${key}` : key, depth+1);
        if (out.length >= maxScalars) break;
      }
      return;
    }
    const key = path.replace(/\[\d+\]/g,"").split(".").filter(Boolean).pop() || "";
    out.push({ path, key, value });
  };
  visit(input,"",0);
  return out;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+(?:\.0+)?$/.test(raw)) return Math.round(Number(raw));
  if (!/[0-9]/.test(raw)) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits || digits.length > 15) return null;
  return Number(digits);
}

function emailCandidates(body: any, scalars: Scalar[]): Candidate<string>[] {
  const result: Candidate<string>[] = [];
  const configured = env("LYNK_WEBHOOK_EMAIL_PATH");
  if (configured) {
    const raw = clean(getPath(body,configured),200).toLowerCase();
    if (EMAIL_RE.test(raw)) result.push({value:raw,path:configured,score:1200});
  }
  const known = [
    "customer.email","buyer.email","member.email","user.email","email","order.customer.email",
    "payment.customer.email","transaction.customer.email","data.customer.email","data.buyer.email",
    "data.member.email","data.user.email","data.email","data.order.customer.email"
  ];
  known.forEach((path,index) => {
    const raw = clean(getPath(body,path),200).toLowerCase();
    if (EMAIL_RE.test(raw)) result.push({value:raw,path,score:1100-index});
  });
  for (const scalar of scalars) {
    const raw = String(scalar.value ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(raw)) continue;
    const p = scalar.path.toLowerCase();
    let score = 500;
    if (p.includes("email")) score += 250;
    if (/(customer|buyer|member|user|purchaser|client)/.test(p)) score += 120;
    result.push({value:raw,path:scalar.path,score});
  }
  return uniqueCandidates(result,(value) => value.toLowerCase());
}

function amountCandidates(body: any, scalars: Scalar[]): Candidate<number>[] {
  const result: Candidate<number>[] = [];
  const configured = env("LYNK_WEBHOOK_AMOUNT_PATH");
  if (configured) {
    const value = parseAmount(getPath(body,configured));
    if (value !== null && value > 0) result.push({value,path:configured,score:1200});
  }
  const known = [
    "amount","total","grand_total","grandTotal","gross_amount","grossAmount","paid_amount","payment_amount",
    "transaction.amount","transaction.total","order.amount","order.total","payment.amount","payment.total",
    "data.amount","data.total","data.grand_total","data.grandTotal","data.gross_amount","data.grossAmount",
    "data.transaction.amount","data.payment.amount","data.order.amount"
  ];
  known.forEach((path,index) => {
    const value = parseAmount(getPath(body,path));
    if (value !== null && value > 0) result.push({value,path,score:1100-index});
  });
  for (const scalar of scalars) {
    const p = scalar.path.toLowerCase();
    if (!/(amount|total|gross|price|paid|payment_value|transaction_value|nominal)/.test(p)) continue;
    if (/(fee|tax|admin|discount|affiliate|commission|quantity|qty)/.test(p)) continue;
    const value = parseAmount(scalar.value);
    if (value === null || value <= 0) continue;
    let score = 500;
    if (/(grand.?total|gross.?amount|paid.?amount|payment.?amount)/.test(p)) score += 220;
    else if (/(amount|total)/.test(p)) score += 150;
    result.push({value,path:scalar.path,score});
  }
  return uniqueCandidates(result,(value) => String(value));
}

function statusCandidates(body: any, scalars: Scalar[]): Candidate<string>[] {
  const result: Candidate<string>[] = [];
  const configured = env("LYNK_WEBHOOK_STATUS_PATH");
  if (configured) {
    const value = clean(getPath(body,configured),100);
    if (value) result.push({value,path:configured,score:1200});
  }
  const known = [
    "status","state","event","event_type","type","transaction.status","order.status","payment.status",
    "data.status","data.state","data.event","data.event_type","data.type","data.transaction.status","data.payment.status"
  ];
  known.forEach((path,index) => {
    const value = clean(getPath(body,path),100);
    if (value) result.push({value,path,score:1100-index});
  });
  for (const scalar of scalars) {
    const p = scalar.path.toLowerCase();
    if (!/(status|state|event|type)/.test(p)) continue;
    const value = clean(scalar.value,100);
    if (!value || value.length > 100) continue;
    let score = 450;
    if (/(payment|transaction|order)/.test(p)) score += 160;
    if (/status/.test(p)) score += 120;
    if (statusMatchesSuccess(value)) score += 220;
    result.push({value,path:scalar.path,score});
  }
  return uniqueCandidates(result,(value) => normalizeStatus(value));
}

function transactionIdCandidates(body: any, scalars: Scalar[]): Candidate<string>[] {
  const result: Candidate<string>[] = [];
  const configured = env("LYNK_WEBHOOK_TRANSACTION_ID_PATH");
  if (configured) {
    const value = clean(getPath(body,configured),180);
    if (value) result.push({value,path:configured,score:1200});
  }
  const known = [
    "transaction_id","transaction.id","trx_id","ref_id","refId","reference_id","payment_id",
    "order.id","order_id","invoice_id","data.transaction_id","data.transaction.id","data.ref_id","data.refId",
    "data.order.id","data.order_id","data.payment_id"
  ];
  known.forEach((path,index) => {
    const value = clean(getPath(body,path),180);
    if (value) result.push({value,path,score:1100-index});
  });
  for (const scalar of scalars) {
    const p = scalar.path.toLowerCase();
    if (!/((transaction|trx|payment|invoice|reference|ref|order).*(id|code|number|no)|(^|\.)(refid|ref_id)$)/.test(p)) continue;
    const value = clean(scalar.value,180);
    if (!value || value.length < 4 || value.length > 180) continue;
    result.push({value,path:scalar.path,score:520});
  }
  return uniqueCandidates(result,(value) => value);
}

function productCandidates(body: any, scalars: Scalar[]): Candidate<string>[] {
  const result: Candidate<string>[] = [];
  const configured = env("LYNK_WEBHOOK_PRODUCT_PATH");
  if (configured) {
    const value = clean(getPath(body,configured),300);
    if (value) result.push({value,path:configured,score:1200});
  }
  const known = [
    "product.id","product_id","item.id","item.product_id","product.slug","product.name","item.name",
    "data.product.id","data.product_id","data.item.id","data.product.name","data.item.name"
  ];
  known.forEach((path,index) => {
    const value = clean(getPath(body,path),300);
    if (value) result.push({value,path,score:1100-index});
  });
  for (const scalar of scalars) {
    const p = scalar.path.toLowerCase();
    if (!/(product|item)/.test(p) || !/(id|name|slug|code)/.test(p)) continue;
    const value = clean(scalar.value,300);
    if (value) result.push({value,path:scalar.path,score:450});
  }
  return uniqueCandidates(result,(value) => value.toLowerCase());
}

export function extractLynkPayload(body: any) {
  const scalars = walkScalars(body);
  const emails = emailCandidates(body,scalars);
  const amounts = amountCandidates(body,scalars);
  const statuses = statusCandidates(body,scalars);
  const transactionIds = transactionIdCandidates(body,scalars);
  const products = productCandidates(body,scalars);

  const successCandidate = statuses.find((item) => statusMatchesSuccess(item.value));
  const explicitNegative = statuses.some((item) => isExplicitNegativeStatus(item.value));
  const assumeSuccess = env("LYNK_ASSUME_SUCCESS_WEBHOOK").toLowerCase() === "true";
  const primaryStatus = successCandidate?.value || statuses[0]?.value || "";
  const statusIsSuccess = !!successCandidate || (assumeSuccess && !explicitNegative);

  return {
    transactionId: clean(transactionIds[0]?.value,180),
    status: clean(primaryStatus || (statusIsSuccess ? "success_webhook" : ""),100),
    amount: amounts[0]?.value ?? null,
    email: clean(emails[0]?.value,200).toLowerCase(),
    product: clean(products[0]?.value,300),
    statusIsSuccess,
    explicitNegativeStatus: explicitNegative,
    emailCandidates: emails.slice(0,20),
    amountCandidates: amounts.slice(0,20),
    statusCandidates: statuses.slice(0,20),
    transactionIdCandidates: transactionIds.slice(0,20),
    productCandidates: products.slice(0,20),
  };
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

async function findLicensesByEmails(admin: any, emails: string[]) {
  const map = new Map<string,any>();
  for (const email of emails.slice(0,12)) {
    const { data, error } = await admin.from("ldm2_licenses")
      .select("id,customer_email,plan_code,primary_store_code").eq("customer_email", email);
    if (error) throw error;
    for (const row of data || []) map.set(row.id,row);
  }
  return [...map.values()];
}

async function paymentCandidates(admin: any, input: {
  licenseIds?: string[]; statuses: string[]; amounts: number[]; since: string; until?: string;
}) {
  if (!input.amounts.length) return [];
  let q = admin.from("ldm2_payments")
    .select("id,license_id,order_id,provider,status,amount,plan_code,billing_cycle,created_at,provider_detail,provider_transaction_id")
    .eq("provider","lynk").in("status",input.statuses).gte("created_at",input.since)
    .order("created_at",{ascending:false});
  if (input.until) q = q.lte("created_at",input.until);
  if (input.licenseIds?.length) q = q.in("license_id",input.licenseIds);
  q = input.amounts.length === 1 ? q.eq("amount",input.amounts[0]) : q.in("amount",input.amounts.slice(0,20));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function matchAnchor(value?: string | null) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

export async function matchPendingOrder(admin: any, parsed: any, options?: { anchorTime?: string | null }) {
  const emails = [...new Set((parsed.emailCandidates || []).map((x:any) => String(x.value||"").trim().toLowerCase()).filter(Boolean))];
  if (parsed.email && !emails.includes(parsed.email)) emails.unshift(parsed.email);
  const amounts = [...new Set((parsed.amountCandidates || []).map((x:any) => Math.round(Number(x.value))).filter((n:number) => Number.isFinite(n) && n > 0))];
  if (parsed.amount && !amounts.includes(Math.round(parsed.amount))) amounts.unshift(Math.round(parsed.amount));

  if (!amounts.length) return { ok:false, status:"MISSING_AMOUNT", candidates:[], anchorTime:null };

  // V28.1.7.2:
  // Live webhook memakai waktu sekarang.
  // Replay event lama HARUS memakai waktu event asli, bukan waktu replay saat ini.
  // Tanpa ini, fallback 20 menit selalu gagal untuk event yang direplay beberapa jam kemudian.
  const anchor = matchAnchor(options?.anchorTime);
  const anchorMs = anchor.getTime();
  const since48h = new Date(anchorMs - 48*60*60*1000).toISOString();
  const until5m = new Date(anchorMs + 5*60*1000).toISOString();
  const since20m = new Date(anchorMs - 20*60*1000).toISOString();
  const until2m = new Date(anchorMs + 2*60*1000).toISOString();
  const anchorTime = anchor.toISOString();

  if (emails.length) {
    const licenses = await findLicensesByEmails(admin,emails);
    const ids = licenses.map((x:any) => x.id);
    if (ids.length) {
      const pending = await paymentCandidates(admin,{licenseIds:ids,statuses:["pending","challenge"],amounts,since:since48h,until:until5m});
      if (pending.length === 1) return { ok:true,status:"UNIQUE_PAYLOAD_EMAIL_AMOUNT_MATCH",order:pending[0],candidates:pending,anchorTime };
      if (pending.length > 1) return { ok:false,status:"AMBIGUOUS_EMAIL_AMOUNT_MATCH",candidates:pending,anchorTime };

      const cancelled = await paymentCandidates(admin,{licenseIds:ids,statuses:["cancelled"],amounts,since:since48h,until:until5m});
      if (cancelled.length === 1) return { ok:true,status:"UNIQUE_CANCELLED_EMAIL_AMOUNT_MATCH",order:cancelled[0],candidates:cancelled,anchorTime };
      if (cancelled.length > 1) return { ok:false,status:"AMBIGUOUS_CANCELLED_MATCH",candidates:cancelled,anchorTime };

      const paid = await paymentCandidates(admin,{licenseIds:ids,statuses:["paid"],amounts,since:since48h,until:until5m});
      if (paid.length === 1) return { ok:false,status:"DUPLICATE_PAYMENT_REVIEW",order:paid[0],duplicatePaid:true,candidates:paid,anchorTime };
      if (paid.length > 1) return { ok:false,status:"AMBIGUOUS_PAID_MATCH",candidates:paid,anchorTime };
    }
  }

  // Fallback aman amount-only.
  // PENTING: untuk replay, window dihitung terhadap waktu webhook ASLI.
  // Hanya proses bila TEPAT SATU pending/challenge order dengan nominal yang sama.
  const amountOnly = await paymentCandidates(admin,{statuses:["pending","challenge"],amounts,since:since20m,until:until2m});
  if (amountOnly.length === 1) return { ok:true,status:"UNIQUE_EVENT_TIME_AMOUNT_MATCH",order:amountOnly[0],candidates:amountOnly,anchorTime };
  if (amountOnly.length > 1) return { ok:false,status:"AMBIGUOUS_EVENT_TIME_AMOUNT_MATCH",candidates:amountOnly,anchorTime };

  if (!emails.length) return { ok:false,status:"MISSING_EMAIL_NO_UNIQUE_AMOUNT_MATCH",candidates:[],anchorTime };
  return { ok:false,status:"NO_PENDING_MATCH",candidates:[],anchorTime };
}

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertMidtransRuntime, cancelPaymentForRetry, midtransRuntimeHealth, midtransNotificationUrl,
  reconcilePaymentFromMidtrans, refundMidtransTransaction,
} from "../_shared/ldm-midtrans-operations.ts";

const encoder = new TextEncoder();
const ADMIN_API_VERSION = "27.9.0-commercial-06-refund-v20";

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
    throw new Error("Developer Support belum dikonfigurasi. Isi LDM_APP_SUPABASE_URL dan LDM_APP_SERVICE_ROLE_KEY pada Secrets Developer Center.");
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
function validSupportTicketCode(value: unknown) {
  const code = clean(value, 40).toUpperCase();
  if (!/^SUP-\d{8}-[A-F0-9]{10}$/.test(code)) {
    throw Object.assign(new Error("Kode tiket Support tidak valid. Contoh: SUP-20260905-A72C91D083"), { status: 400 });
  }
  return code;
}
function validPrivacyRequestCode(value: unknown) {
  const code = clean(value, 40).toUpperCase();
  if (!/^PRV-\d{8}-[A-F0-9]{10}$/.test(code)) {
    throw Object.assign(new Error("Kode Privacy Request tidak valid. Contoh: PRV-20260906-A72C91D083"), { status: 400 });
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
  assertMidtransRuntime(true);
  const serverKey = env("MIDTRANS_SERVER_KEY");

  const finish = env("MIDTRANS_FINISH_URL");
  const payload: Record<string, unknown> = {
    transaction_details: { order_id: input.orderId, gross_amount: input.amount },
    item_details: [{ id: input.orderId.slice(0, 50), price: input.amount, quantity: 1, name: input.itemName.slice(0, 50) }],
    customer_details: {
      first_name: input.customerName.slice(0, 50),
      email: input.customerEmail,
      phone: input.customerPhone || undefined,
    },
    page_expiry: { duration: 24, unit: "hours" },
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

    if (action === "midtrans_diagnostics") {
      const runtime = midtransRuntimeHealth();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [pendingQ, staleQ, paidQ, failedQ] = await Promise.all([
        admin.from("ldm2_payments").select("id", { count: "exact", head: true }).in("status", ["pending", "challenge"]),
        admin.from("ldm2_payments").select("id", { count: "exact", head: true }).in("status", ["pending", "challenge"]).lte("created_at", tenMinutesAgo),
        admin.from("ldm2_payments").select("id", { count: "exact", head: true }).eq("status", "paid").gte("paid_at", oneDayAgo),
        admin.from("ldm2_payments").select("id", { count: "exact", head: true }).in("status", ["failed", "expired", "cancelled"]).gte("updated_at", oneDayAgo),
      ]);
      for (const query of [pendingQ, staleQ, paidQ, failedQ]) if (query.error) throw query.error;

      let recentEvents: any[] = [];
      let migrationRequired = false;
      const eventQuery = await admin.from("ldm2_midtrans_events")
        .select("event_key,order_id,source,transaction_status,status_code,signature_valid,receive_count,last_received_at,processed_at,processing_error")
        .order("last_received_at", { ascending: false }).limit(20);
      if (eventQuery.error) {
        if (/ldm2_midtrans_events|does not exist|schema cache/i.test(eventQuery.error.message || "")) migrationRequired = true;
        else throw eventQuery.error;
      } else recentEvents = eventQuery.data || [];

      const paymentQuery = await admin.from("ldm2_payments")
        .select("order_id,status,provider_status,amount,last_reconciled_at,reconcile_attempts,last_reconcile_error,processed_at,paid_at,updated_at")
        .in("status", ["pending", "challenge", "failed", "expired", "cancelled", "partially_refunded", "refunded"])
        .order("updated_at", { ascending: false }).limit(20);
      if (paymentQuery.error && !/last_reconciled_at|reconcile_attempts|schema cache/i.test(paymentQuery.error.message || "")) throw paymentQuery.error;
      if (paymentQuery.error) migrationRequired = true;

      await audit("MIDTRANS_DIAGNOSTICS", null, { environment: runtime.environment, migration_required: migrationRequired });
      return json(req, {
        ok: true,
        runtime,
        migration_required: migrationRequired,
        summary: {
          pending_or_challenge: pendingQ.count || 0,
          pending_over_10_minutes: staleQ.count || 0,
          paid_last_24h: paidQ.count || 0,
          failed_expired_cancelled_last_24h: failedQ.count || 0,
        },
        recent_events: recentEvents,
        recent_nonpaid_payments: paymentQuery.error ? [] : (paymentQuery.data || []),
      });
    }

    if (action === "incident_support_info") {
      return json(req, {
        ok: true,
        support_api_version: "commercial-11-privacy-v1",
        actions: [
          "incident_lookup", "incident_support_update",
          "support_ticket_queue", "support_ticket_lookup", "support_ticket_update",
          "privacy_request_queue", "privacy_request_lookup", "privacy_request_update"
        ]
      });
    }

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
      return json(req, { ok: true, support_api_version: "commercial-01-support-v3", incident, store: store || null });
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

    if (action === "support_ticket_queue") {
      const app = applicationAdminClient();
      const limit = Math.max(1, Math.min(Number(body.limit || 60), 100));
      const requestedStatus = clean(body.status, 30).toLowerCase();
      let query = app.from("support_tickets")
        .select("id,ticket_code,store_id,created_by,created_username,created_role,ticket_type,category,subject,description,related_page,incident_code,app_version,browser,online,status,resolution_note,support_last_action_at,resolved_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (["open", "investigating", "waiting_customer", "resolved", "closed"].includes(requestedStatus)) {
        query = query.eq("status", requestedStatus);
      } else {
        query = query.in("status", ["open", "investigating", "waiting_customer"]);
      }
      const { data: tickets, error: ticketError } = await query;
      if (ticketError) {
        if (/support_tickets/i.test(ticketError.message || "")) {
          throw new Error("SQL-38-CUSTOMER-SUPPORT-REPORTING.sql belum dijalankan pada App Supabase.");
        }
        throw ticketError;
      }
      const storeIds = [...new Set((tickets || []).map((t: any) => String(t.store_id || "")).filter(Boolean))];
      let stores: any[] = [];
      if (storeIds.length) {
        const { data: storeRows, error: storeError } = await app.from("stores").select("id,code,name,status").in("id", storeIds);
        if (storeError) throw storeError;
        stores = storeRows || [];
      }
      const storeMap = new Map(stores.map((st: any) => [String(st.id), st]));
      const rows = (tickets || []).map((t: any) => ({ ...t, store: storeMap.get(String(t.store_id)) || null }));
      await audit("support_ticket_queue", null, { count: rows.length, status: requestedStatus || "active" });
      return json(req, { ok: true, support_api_version: "commercial-12-support-v1", tickets: rows });
    }

    if (action === "support_ticket_lookup") {
      const ticketCode = validSupportTicketCode(body.ticket_code);
      const app = applicationAdminClient();
      const { data: ticket, error: ticketError } = await app.from("support_tickets")
        .select("id,ticket_code,store_id,created_by,created_username,created_role,ticket_type,category,subject,description,related_page,incident_code,app_version,browser,online,status,resolution_note,support_last_action_at,resolved_at,created_at,updated_at")
        .eq("ticket_code", ticketCode).maybeSingle();
      if (ticketError) {
        if (/support_tickets/i.test(ticketError.message || "")) {
          throw new Error("SQL-38-CUSTOMER-SUPPORT-REPORTING.sql belum dijalankan pada App Supabase.");
        }
        throw ticketError;
      }
      if (!ticket) return json(req, { ok: false, message: "Tiket Support tidak ditemukan." }, 404);
      const { data: store, error: storeError } = await app.from("stores").select("id,code,name,status").eq("id", ticket.store_id).maybeSingle();
      if (storeError) throw storeError;
      await audit("support_ticket_lookup", null, { ticket_code: ticketCode, store_id: ticket.store_id });
      return json(req, { ok: true, support_api_version: "commercial-12-support-v1", ticket, store: store || null });
    }

    if (action === "support_ticket_update") {
      const ticketCode = validSupportTicketCode(body.ticket_code);
      const status = clean(body.status, 30).toLowerCase();
      const note = clean(body.note, 2000);
      if (!["open", "investigating", "waiting_customer", "resolved", "closed"].includes(status)) {
        return json(req, { ok: false, message: "Status tiket Support tidak valid." }, 400);
      }
      const app = applicationAdminClient();
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        status,
        support_last_action_at: nowIso,
        resolution_note: note || null,
        resolved_at: ["resolved", "closed"].includes(status) ? nowIso : null,
      };
      const { data: ticket, error: updateError } = await app.from("support_tickets")
        .update(update).eq("ticket_code", ticketCode)
        .select("id,ticket_code,store_id,status,resolution_note,support_last_action_at,resolved_at,updated_at")
        .maybeSingle();
      if (updateError) {
        if (/support_tickets/i.test(updateError.message || "")) {
          throw new Error("SQL-38-CUSTOMER-SUPPORT-REPORTING.sql belum dijalankan pada App Supabase.");
        }
        throw updateError;
      }
      if (!ticket) return json(req, { ok: false, message: "Tiket Support tidak ditemukan." }, 404);
      await audit("support_ticket_update", null, {
        ticket_code: ticketCode,
        store_id: ticket.store_id,
        status,
        note: note ? note.slice(0, 240) : null,
      });
      return json(req, { ok: true, support_api_version: "commercial-12-support-v1", ticket });
    }

    if (action === "privacy_request_queue") {
      const app = applicationAdminClient();
      const limit = Math.max(1, Math.min(Number(body.limit || 60), 100));
      const requestedStatus = clean(body.status, 30).toLowerCase();
      let query = app.from("privacy_requests")
        .select("id,request_code,store_id,requested_by,requester_email,requested_username,requested_role,request_type,data_scope,details,desired_correction,app_version,browser,online,status,response_note,privacy_last_action_at,statutory_due_at,completed_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (["submitted", "verifying", "processing", "waiting_user", "completed", "rejected", "cancelled"].includes(requestedStatus)) {
        query = query.eq("status", requestedStatus);
      } else {
        query = query.in("status", ["submitted", "verifying", "processing", "waiting_user"]);
      }
      const { data: requests, error: requestError } = await query;
      if (requestError) {
        if (/privacy_requests/i.test(requestError.message || "")) {
          throw new Error("SQL-40-PRIVACY-CENTER.sql belum dijalankan pada App Supabase.");
        }
        throw requestError;
      }
      const storeIds = [...new Set((requests || []).map((r: any) => String(r.store_id || "")).filter(Boolean))];
      let stores: any[] = [];
      if (storeIds.length) {
        const { data: storeRows, error: storeError } = await app.from("stores").select("id,code,name,status").in("id", storeIds);
        if (storeError) throw storeError;
        stores = storeRows || [];
      }
      const storeMap = new Map(stores.map((st: any) => [String(st.id), st]));
      const rows = (requests || []).map((r: any) => ({ ...r, store: storeMap.get(String(r.store_id)) || null }));
      await audit("privacy_request_queue", null, { count: rows.length, status: requestedStatus || "active" });
      return json(req, { ok: true, support_api_version: "commercial-11-privacy-v1", requests: rows });
    }

    if (action === "privacy_request_lookup") {
      const requestCode = validPrivacyRequestCode(body.request_code);
      const app = applicationAdminClient();
      const { data: requestRow, error: requestError } = await app.from("privacy_requests")
        .select("id,request_code,store_id,requested_by,requester_email,requested_username,requested_role,request_type,data_scope,details,desired_correction,app_version,browser,online,status,response_note,privacy_last_action_at,statutory_due_at,completed_at,created_at,updated_at")
        .eq("request_code", requestCode).maybeSingle();
      if (requestError) {
        if (/privacy_requests/i.test(requestError.message || "")) {
          throw new Error("SQL-40-PRIVACY-CENTER.sql belum dijalankan pada App Supabase.");
        }
        throw requestError;
      }
      if (!requestRow) return json(req, { ok: false, message: "Privacy Request tidak ditemukan." }, 404);
      const { data: store, error: storeError } = await app.from("stores").select("id,code,name,status").eq("id", requestRow.store_id).maybeSingle();
      if (storeError) throw storeError;
      await audit("privacy_request_lookup", null, { request_code: requestCode, store_id: requestRow.store_id });
      return json(req, { ok: true, support_api_version: "commercial-11-privacy-v1", request: requestRow, store: store || null });
    }

    if (action === "privacy_request_update") {
      const requestCode = validPrivacyRequestCode(body.request_code);
      const status = clean(body.status, 30).toLowerCase();
      const note = clean(body.note, 3000);
      if (!["submitted", "verifying", "processing", "waiting_user", "completed", "rejected"].includes(status)) {
        return json(req, { ok: false, message: "Status Privacy Request tidak valid." }, 400);
      }
      const app = applicationAdminClient();
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        status,
        privacy_last_action_at: nowIso,
        response_note: note || null,
        completed_at: ["completed", "rejected"].includes(status) ? nowIso : null,
      };
      const { data: requestRow, error: updateError } = await app.from("privacy_requests")
        .update(update).eq("request_code", requestCode).neq("status", "cancelled")
        .select("id,request_code,store_id,status,response_note,privacy_last_action_at,statutory_due_at,completed_at,updated_at")
        .maybeSingle();
      if (updateError) {
        if (/privacy_requests/i.test(updateError.message || "")) {
          throw new Error("SQL-40-PRIVACY-CENTER.sql belum dijalankan pada App Supabase.");
        }
        throw updateError;
      }
      if (!requestRow) return json(req, { ok: false, message: "Privacy Request tidak ditemukan." }, 404);
      await audit("privacy_request_update", null, {
        request_code: requestCode,
        store_id: requestRow.store_id,
        status,
        note: note ? note.slice(0, 240) : null,
      });
      return json(req, { ok: true, support_api_version: "commercial-11-privacy-v1", request: requestRow });
    }


    if (action === "refund_overview") {
      const policyResult = await admin.rpc("ldm2_get_refund_policy");
      if (policyResult.error) {
        if (/ldm2_get_refund_policy|does not exist|schema cache/i.test(policyResult.error.message || "")) {
          throw new Error("SQL-42-REFUND-MANAGEMENT-POLICY.sql belum dijalankan pada License Authority.");
        }
        throw policyResult.error;
      }
      const { data: refunds, error: refundError } = await admin.from("ldm2_refunds")
        .select("id,payment_id,license_id,order_id,refund_key,refund_type,amount,reason,status,provider_status,error_message,requested_by_email,requested_at,accepted_at,completed_at,failed_at,updated_at")
        .order("requested_at", { ascending: false }).limit(50);
      if (refundError) {
        if (/ldm2_refunds|does not exist|schema cache/i.test(refundError.message || "")) {
          throw new Error("SQL-42-REFUND-MANAGEMENT-POLICY.sql belum dijalankan pada License Authority.");
        }
        throw refundError;
      }
      const { data: refundRequests, error: requestError } = await admin.from("ldm2_refund_requests")
        .select("id,request_code,payment_id,license_id,order_id,refund_type,requested_amount,reason_category,reason_detail,requester_name,requester_email,status,response_note,linked_refund_key,refund_deadline,created_at,updated_at,completed_at,cancelled_at")
        .order("created_at", { ascending: false }).limit(100);
      if (requestError) {
        if (/ldm2_refund_requests|does not exist|schema cache/i.test(requestError.message || "")) {
          throw new Error("SQL-43-CUSTOMER-REFUND-REQUESTS.sql belum dijalankan pada License Authority.");
        }
        throw requestError;
      }
      await audit("REFUND_OVERVIEW", null, { count: (refunds || []).length, request_count: (refundRequests || []).length });
      return json(req, { ok: true, policy: policyResult.data, refunds: refunds || [], requests: refundRequests || [] });
    }

    if (action === "refund_policy_update") {
      const days = Number(body.refund_window_days);
      const enabled = body.enabled !== false;
      const allowPartial = body.allow_partial_refund !== false;
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        return json(req, { ok: false, message: "Batas refund harus 1-30 hari." }, 400);
      }
      const summary = `Refund dapat diajukan maksimal ${days} hari kalender sejak pembayaran terverifikasi. Refund hanya diproses untuk transaksi yang memenuhi syarat provider dan kebijakan LocDailyMar.`;
      const { data: policy, error: policyError } = await admin.from("ldm2_refund_policy")
        .update({
          enabled,
          refund_window_days: days,
          allow_partial_refund: allowPartial,
          policy_summary: summary,
          policy_version: `2026-09-v20-${days}d`,
          updated_at: new Date().toISOString(),
          updated_by: adminEmail,
        }).eq("id", 1)
        .select("id,enabled,refund_window_days,allow_partial_refund,min_reason_length,policy_version,policy_summary,updated_at,updated_by")
        .maybeSingle();
      if (policyError) {
        if (/ldm2_refund_policy|does not exist|schema cache/i.test(policyError.message || "")) {
          throw new Error("SQL-42-REFUND-MANAGEMENT-POLICY.sql belum dijalankan pada License Authority.");
        }
        throw policyError;
      }
      await audit("REFUND_POLICY_UPDATE", null, { refund_window_days: days, enabled, allow_partial_refund: allowPartial });
      return json(req, { ok: true, policy });
    }

    if (action === "refund_request_update") {
      const requestCode = clean(body.request_code, 40).toUpperCase();
      const status = clean(body.status, 30).toLowerCase();
      const note = clean(body.note, 3000);
      if (!/^RFD-\d{8}-[A-F0-9]{10}$/.test(requestCode)) {
        return json(req, { ok: false, message: "Kode RFD tidak valid." }, 400);
      }
      if (!["reviewing", "waiting_customer", "approved", "rejected"].includes(status)) {
        return json(req, { ok: false, message: "Status review refund tidak valid." }, 400);
      }
      const updated = await admin.rpc("ldm2_update_refund_request", {
        p_request_code: requestCode, p_status: status, p_response_note: note || null, p_linked_refund_key: null,
      });
      if (updated.error) {
        if (/ldm2_update_refund_request|does not exist|schema cache/i.test(updated.error.message || "")) {
          throw new Error("SQL-43-CUSTOMER-REFUND-REQUESTS.sql belum dijalankan pada License Authority.");
        }
        throw updated.error;
      }
      await audit("REFUND_REQUEST_UPDATE", null, { request_code: requestCode, status, note: note ? note.slice(0, 240) : null });
      return json(req, { ok: true, request: updated.data });
    }

    if (action === "refund_preview") {
      const licenseId = clean(body.license_id, 80);
      const { data: payment, error: paymentError } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,provider_status,provider_transaction_id,amount,refund_amount,paid_at,created_at,provider_detail")
        .eq("license_id", licenseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json(req, { ok: false, message: "Pembayaran tidak ditemukan." }, 404);

      const eligibilityResult = await admin.rpc("ldm2_refund_eligibility", { p_payment_id: payment.id });
      if (eligibilityResult.error) {
        if (/ldm2_refund_eligibility|does not exist|schema cache/i.test(eligibilityResult.error.message || "")) {
          throw new Error("SQL-42-REFUND-MANAGEMENT-POLICY.sql belum dijalankan pada License Authority.");
        }
        throw eligibilityResult.error;
      }
      const { data: history, error: historyError } = await admin.from("ldm2_refunds")
        .select("refund_key,refund_type,amount,reason,status,provider_status,error_message,requested_by_email,requested_at,accepted_at,failed_at,updated_at")
        .eq("payment_id", payment.id).order("requested_at", { ascending: false });
      if (historyError) throw historyError;
      await audit("REFUND_PREVIEW", licenseId, { order_id: payment.order_id, eligible: eligibilityResult.data?.eligible === true });
      return json(req, {
        ok: true,
        payment: {
          ...payment,
          provider_payment_method: clean(payment?.provider_detail?.payment_type || "", 60) || null,
        },
        eligibility: eligibilityResult.data,
        history: history || [],
      });
    }

    if (action === "refund_payment") {
      const licenseId = clean(body.license_id, 80);
      let refundType = clean(body.refund_type, 20).toLowerCase();
      let reason = clean(body.reason, 255);
      let requestedAmount = Math.round(Number(body.amount || 0));
      const refundRequestCode = clean(body.refund_request_code, 40).toUpperCase();
      if (!["full", "partial"].includes(refundType)) {
        return json(req, { ok: false, message: "Jenis refund harus full atau partial." }, 400);
      }

      let { data: payment, error: paymentError } = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,provider_status,provider_transaction_id,amount,refund_amount,paid_at,processed_at,provider_detail,created_at")
        .eq("license_id", licenseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json(req, { ok: false, message: "Pembayaran tidak ditemukan." }, 404);

      let linkedRequest: any = null;
      if (refundRequestCode) {
        if (!/^RFD-\d{8}-[A-F0-9]{10}$/.test(refundRequestCode)) {
          return json(req, { ok: false, message: "Kode permintaan refund tidak valid." }, 400);
        }
        const requestResult = await admin.from("ldm2_refund_requests")
          .select("id,request_code,payment_id,license_id,order_id,refund_type,requested_amount,reason_detail,status,response_note")
          .eq("request_code", refundRequestCode).maybeSingle();
        if (requestResult.error) {
          if (/ldm2_refund_requests|does not exist|schema cache/i.test(requestResult.error.message || "")) {
            throw new Error("SQL-43-CUSTOMER-REFUND-REQUESTS.sql belum dijalankan pada License Authority.");
          }
          throw requestResult.error;
        }
        linkedRequest = requestResult.data;
        if (!linkedRequest) return json(req, { ok: false, message: "Permintaan refund customer tidak ditemukan." }, 404);
        if (String(linkedRequest.payment_id) !== String(payment.id) || String(linkedRequest.license_id) !== String(licenseId)) {
          return json(req, { ok: false, message: "Permintaan refund tidak cocok dengan pembayaran/lisensi ini." }, 409);
        }
        if (!["submitted", "reviewing", "waiting_customer", "approved"].includes(String(linkedRequest.status || ""))) {
          return json(req, { ok: false, message: `Permintaan ${refundRequestCode} berstatus ${linkedRequest.status} dan tidak dapat diproses.` }, 409);
        }
        refundType = String(linkedRequest.refund_type || "").toLowerCase();
        requestedAmount = Math.round(Number(linkedRequest.requested_amount || 0));
        reason = clean(linkedRequest.reason_detail || "Permintaan refund customer", 255);
      }

      if (!["paid", "partially_refunded"].includes(String(payment.status || "").toLowerCase())) {
        return json(req, { ok: false, message: `Status ${payment.status || "-"} tidak dapat direfund.` }, 409);
      }

      // Selalu minta status aktual provider sebelum refund. Midtrans Refund API
      // ditujukan untuk transaksi settlement; partial_refund tetap dapat memiliki sisa refundable.
      const sync = await reconcilePaymentFromMidtrans(admin, payment, `developer_refund_precheck:${adminEmail}`);
      const refreshed = await admin.from("ldm2_payments")
        .select("id,license_id,order_id,status,provider_status,provider_transaction_id,amount,refund_amount,paid_at,processed_at,provider_detail,created_at")
        .eq("id", payment.id).maybeSingle();
      if (refreshed.error) throw refreshed.error;
      if (refreshed.data) payment = refreshed.data;
      const remoteStatus = clean(sync?.remote?.transaction_status || payment.provider_status || "", 60).toLowerCase();
      if (!["settlement", "partial_refund"].includes(remoteStatus)) {
        return json(req, {
          ok: false,
          code: "MIDTRANS_REFUND_REQUIRES_SETTLEMENT",
          message: `Refund Midtrans memerlukan transaksi Settlement. Status provider saat ini: ${remoteStatus || "tidak diketahui"}.`,
        }, 409);
      }

      const eligibilityResult = await admin.rpc("ldm2_refund_eligibility", { p_payment_id: payment.id });
      if (eligibilityResult.error) throw eligibilityResult.error;
      const eligibility = eligibilityResult.data || {};
      if (eligibility.eligible !== true) {
        return json(req, { ok: false, code: "REFUND_NOT_ELIGIBLE", message: eligibility.reason || "Transaksi tidak memenuhi kebijakan refund.", eligibility }, 409);
      }
      const remaining = Number(eligibility.remaining_refundable || 0);
      const amount = refundType === "full" ? remaining : requestedAmount;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
        return json(req, { ok: false, message: `Nominal refund harus antara Rp1 dan sisa refundable Rp${remaining.toLocaleString("id-ID")}.` }, 400);
      }

      const providerMethod = clean(sync?.remote?.payment_type || payment?.provider_detail?.payment_type || "", 60).toLowerCase();
      const refundApiMethods = ["credit_card", "gopay", "shopeepay", "dana", "ovo", "qris", "kredivo", "akulaku"];
      if (providerMethod && !refundApiMethods.includes(providerMethod)) {
        return json(req, {
          ok: false,
          code: "REFUND_PROVIDER_UNSUPPORTED",
          message: `Metode pembayaran ${providerMethod.toUpperCase()} tidak mendukung Refund API Midtrans pada konfigurasi saat ini. Lakukan pengembalian dana manual dari merchant dan catat referensinya di Support/Audit.`,
        }, 409);
      }
      if (refundType === "partial" && ["ovo", "shopeepay"].includes(providerMethod)) {
        return json(req, {
          ok: false,
          code: "PARTIAL_REFUND_PROVIDER_UNSUPPORTED",
          message: `Metode ${providerMethod.toUpperCase()} tidak didukung untuk partial refund pada konfigurasi Refund API yang digunakan. Gunakan full refund atau proses sesuai kebijakan provider.`,
        }, 409);
      }

      const keyDate = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const refundKey = `LDM-RF-${keyDate}-${randomHex(5)}`;
      const prepared = await admin.rpc("ldm2_prepare_refund", {
        p_payment_id: payment.id,
        p_refund_key: refundKey,
        p_refund_type: refundType,
        p_amount: amount,
        p_reason: reason,
        p_admin_user_id: authData.user.id,
        p_admin_email: adminEmail,
      });
      if (prepared.error) throw prepared.error;
      if (refundRequestCode) {
        const markProcessing = await admin.rpc("ldm2_update_refund_request", {
          p_request_code: refundRequestCode, p_status: "processing",
          p_response_note: "Permintaan disetujui dan sedang diproses ke payment provider.",
          p_linked_refund_key: refundKey,
        });
        if (markProcessing.error) console.error("REFUND_REQUEST_PROCESSING_MARK_FAILED", refundRequestCode, markProcessing.error);
      }

      try {
        const provider = await refundMidtransTransaction({
          targetId: clean(payment.provider_transaction_id || payment.order_id, 160),
          refundKey,
          amount,
          reason,
        });
        const remote = provider.data || {};
        const finished = await admin.rpc("ldm2_finish_refund", {
          p_refund_key: refundKey,
          p_success: true,
          p_provider_status: clean(remote.transaction_status || "refund", 80),
          p_provider_transaction_id: clean(remote.transaction_id || payment.provider_transaction_id || "", 160) || null,
          p_provider_response: {
            status_code: clean(remote.status_code, 20),
            status_message: clean(remote.status_message, 500),
            transaction_status: clean(remote.transaction_status, 60),
            payment_type: clean(remote.payment_type || providerMethod, 60),
            refund_key: clean(remote.refund_key || refundKey, 120),
            refund_amount: amount,
          },
          p_error: null,
          p_unknown: false,
        });
        if (finished.error) throw finished.error;
        if (refundRequestCode) {
          const doneRequest = await admin.rpc("ldm2_update_refund_request", {
            p_request_code: refundRequestCode, p_status: "completed",
            p_response_note: `Refund sebesar Rp${amount.toLocaleString("id-ID")} telah diterima payment provider.`,
            p_linked_refund_key: refundKey,
          });
          if (doneRequest.error) console.error("REFUND_REQUEST_COMPLETE_MARK_FAILED", refundRequestCode, doneRequest.error);
        }
        await audit("REFUND_PAYMENT", licenseId, {
          order_id: payment.order_id,
          refund_key: refundKey,
          refund_type: refundType,
          amount,
          reason,
          provider_status: clean(remote.transaction_status, 60),
        });
        return json(req, {
          ok: true,
          message: `Refund ${refundType === "full" ? "penuh" : "sebagian"} sebesar Rp${amount.toLocaleString("id-ID")} diterima Midtrans.`,
          refund: finished.data,
          refund_key: refundKey,
          provider_status: clean(remote.transaction_status, 60),
          payment_method: providerMethod || null,
        });
      } catch (refundError) {
        const err = refundError as any;
        const uncertain = err?.name === "AbortError" || /timeout|network|fetch failed|connection/i.test(String(err?.message || ""));
        try {
          await admin.rpc("ldm2_finish_refund", {
            p_refund_key: refundKey,
            p_success: false,
            p_provider_status: clean(err?.detail?.transaction_status || "", 80) || null,
            p_provider_transaction_id: clean(err?.detail?.transaction_id || payment.provider_transaction_id || "", 160) || null,
            p_provider_response: err?.detail && typeof err.detail === "object" ? err.detail : {},
            p_error: clean(err?.message || "Refund Midtrans gagal.", 1000),
            p_unknown: uncertain,
          });
        } catch (markError) {
          console.error("REFUND_MARK_FAILED", refundKey, markError);
        }
        if (refundRequestCode) {
          try {
            await admin.rpc("ldm2_update_refund_request", {
              p_request_code: refundRequestCode, p_status: uncertain ? "processing" : "reviewing",
              p_response_note: uncertain
                ? "Status refund belum dapat dipastikan karena gangguan jaringan. Developer sedang melakukan verifikasi provider."
                : `Refund belum berhasil diproses provider: ${clean(err?.message || "Refund gagal", 500)}`,
              p_linked_refund_key: refundKey,
            });
          } catch (requestMarkError) {
            console.error("REFUND_REQUEST_MARK_FAILED", refundRequestCode, requestMarkError);
          }
        }
        await audit("REFUND_PAYMENT_FAILED", licenseId, {
          order_id: payment.order_id, refund_key: refundKey, refund_type: refundType, amount,
          uncertain, error: clean(err?.message || "Refund gagal", 500),
        });
        if (uncertain) {
          throw Object.assign(new Error("Respons refund tidak dapat dipastikan karena gangguan jaringan/timeout. Jangan membuat refund baru dulu. Periksa Midtrans Dashboard dan riwayat refund dengan refund_key yang sama."), {
            status: 503, code: "REFUND_STATUS_UNKNOWN", detail: { refund_key: refundKey },
          });
        }
        throw refundError;
      }
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

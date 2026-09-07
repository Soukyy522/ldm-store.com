import { createClient } from "npm:@supabase/supabase-js@2";
const encoder = new TextEncoder();
const ADMIN_API_VERSION = "27.9.0-v27-lynk-only";

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
      return json(req,{ok:false,code:"LYNK_REFUND_MANUAL",message:"Pembayaran V27 menggunakan Lynk.id. Refund dana harus diverifikasi dan diproses melalui prosedur Lynk.id/merchant secara manual, lalu status request dicatat di Refund Management."},409);
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
    if (["issue","issue_payment","renew","renew_payment","convert_trial_payment","retry_purchase_payment","cancel_pending_payment","sync_payment_status"].includes(action)) {
      return json(req,{ok:false,code:"LYNK_CHECKOUT_FROM_LICENSE_PAGE",message:"V27 memakai Lynk.id-only. Pembuatan order pembayaran dilakukan dari license.html agar pending order, URL produk Lynk.id, dan webhook tetap konsisten."},409);
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

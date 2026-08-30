import { createClient } from "npm:@supabase/supabase-js@2";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function clean(value: unknown, max = 200) { return String(value || "").trim().slice(0, max); }
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("LDM2_ADMIN_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean);
  const allowNull = env("LDM2_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if ((!origin || origin === "null") && allowNull) return "*";
  return origin && allowed.includes(origin) ? origin : "";
}
function cors(req: Request) { return { "Access-Control-Allow-Origin": allowedOrigin(req) || "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" }; }
function json(req: Request, data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }

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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user?.email) return json(req, { ok: false, message: "Sesi developer tidak valid." }, 401);
    const adminEmail = authData.user.email.toLowerCase();
    const admins = env("LDM2_ADMIN_EMAILS").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(adminEmail)) return json(req, { ok: false, message: "Akun ini bukan developer yang diizinkan." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 40).toLowerCase();
    const audit = async (name: string, target: string | null, detail: Record<string, unknown> = {}) => {
      await admin.from("ldm2_admin_audit").insert({ admin_user_id: authData.user.id, admin_email: adminEmail, action: name, target_license_id: target, detail });
    };

    if (action === "dashboard") {
      const nowIso = new Date().toISOString();
      const { error: expiryError } = await admin.from("ldm2_licenses").update({ status: "expired" })
        .eq("status", "active").not("expires_at", "is", null).lte("expires_at", nowIso);
      if (expiryError) throw expiryError;
      const { data: rows, error } = await admin.from("ldm2_admin_license_overview").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      const list = rows || [];
      const now = Date.now();
      return json(req, { ok: true, admin_email: adminEmail, summary: {
        total: list.length,
        active: list.filter((v) => v.status === "active" && (!v.expires_at || new Date(v.expires_at).getTime() > now)).length,
        trial: list.filter((v) => v.is_trial && v.status === "active" && new Date(v.expires_at).getTime() > now).length,
        suspended: list.filter((v) => v.status === "suspended").length,
        expired: list.filter((v) => v.status === "expired" || (v.expires_at && new Date(v.expires_at).getTime() <= now)).length,
      }, licenses: list });
    }

    if (action === "devices") {
      const licenseId = clean(body.license_id, 80);
      const { data, error } = await admin.from("ldm2_activations").select("id,license_id,device_name,store_code,status,activated_at,last_seen_at,deactivated_at,deactivation_reason,app_version").eq("license_id", licenseId).order("last_seen_at", { ascending: false });
      if (error) throw error;
      return json(req, { ok: true, devices: data || [] });
    }

    if (action === "issue") {
      const plan = clean(body.plan_code, 40).toUpperCase();
      const name = clean(body.customer_name, 120);
      const email = clean(body.customer_email, 180).toLowerCase();
      const phone = clean(body.customer_phone, 40);
      const months = Math.max(1, Math.min(120, Number(body.duration_months || 1)));
      const { data, error } = await admin.rpc("ldm2_issue_license", { p_plan_code: plan, p_customer_name: name, p_customer_email: email, p_customer_phone: phone || null, p_duration_months: months, p_notes: clean(body.notes, 500) || null });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      await audit("ISSUE_LICENSE", row?.license_id || null, { plan, email, months });
      return json(req, { ok: true, license: row });
    }

    if (action === "set_status") {
      const licenseId = clean(body.license_id, 80);
      const status = clean(body.status, 20).toLowerCase();
      if (!["active", "suspended", "cancelled"].includes(status)) return json(req, { ok: false, message: "Status tidak diizinkan." }, 400);
      const reason = clean(body.reason, 500);
      const { data, error } = await admin.rpc("ldm2_set_license_status", { p_license_id: licenseId, p_status: status, p_reason: reason || null });
      if (error) throw error;
      await audit("SET_LICENSE_STATUS", licenseId, { status, reason });
      return json(req, data);
    }

    if (action === "renew") {
      const licenseId = clean(body.license_id, 80);
      const months = Math.max(1, Math.min(120, Number(body.duration_months || 1)));
      const { data, error } = await admin.rpc("ldm2_renew_license", { p_license_id: licenseId, p_duration_months: months });
      if (error) throw error;
      await audit("RENEW_LICENSE", licenseId, { months });
      return json(req, data);
    }

    if (action === "convert_trial") {
      const licenseId = clean(body.license_id, 80);
      const plan = clean(body.plan_code, 40).toUpperCase();
      const months = Math.max(1, Math.min(120, Number(body.duration_months || 1)));
      const { data, error } = await admin.rpc("ldm2_convert_trial", { p_license_id: licenseId, p_plan_code: plan, p_duration_months: months });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      await audit("CONVERT_TRIAL", licenseId, { plan, months });
      return json(req, { ok: true, license: row });
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
    return json(req, { ok: false, message: error?.message || "Server Developer Center gagal memproses permintaan." }, 500);
  }
});

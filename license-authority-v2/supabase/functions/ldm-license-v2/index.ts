import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join(""); }
async function sha(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
function token() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = env("LDM2_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean);
  const allowNull = env("LDM2_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if ((!origin || origin === "null") && allowNull) return "*";
  if (origin && allowed.includes(origin)) return origin;
  return "";
}

function cors(req: Request) {
  const origin = allowedOrigin(req);
  return {
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function clean(value: unknown, max = 200) { return String(value || "").trim().slice(0, max); }
function mapStatus(result: Record<string, unknown>) {
  if (result?.ok === true) return 200;
  const code = String(result?.code || "");
  if (["LICENSE_KEY_INVALID", "ACTIVATION_INVALID"].includes(code)) return 401;
  if (["LICENSE_SUSPENDED", "LICENSE_CANCELLED", "LICENSE_EXPIRED", "PLAN_INACTIVE"].includes(code)) return 403;
  if (["DEVICE_LIMIT_REACHED", "STORE_LIMIT_REACHED", "TRIAL_ALREADY_USED"].includes(code)) return 409;
  return 400;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST." }, 405);
  if (!allowedOrigin(req)) return json(req, { ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Domain aplikasi belum diizinkan developer." }, 403);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const pepper = env("LDM2_DEVICE_PEPPER");
    if (!supabaseUrl || !serviceKey || pepper.length < 32) {
      return json(req, { ok: false, code: "SERVER_CONFIG_INVALID", message: "Konfigurasi server lisensi belum lengkap." }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 30).toLowerCase();

    if (action === "health") {
      const { data, error } = await admin.from("ldm2_plans").select("code,name,description,price_monthly,price_yearly,price_lifetime,max_devices,max_stores,features").eq("active", true).order("sort_order");
      if (error) throw error;
      return json(req, { ok: true, service: "LDM_LICENSE_V2", plans: data, time: new Date().toISOString() });
    }

    const deviceId = clean(body.device_id, 180);
    const storeCode = clean(body.store_code, 80).toUpperCase();
    const deviceName = clean(body.device_name, 100) || "Perangkat";
    const appVersion = clean(body.app_version, 30);
    if (!deviceId || !storeCode) return json(req, { ok: false, code: "DEVICE_CONTEXT_REQUIRED", message: "Device ID dan Store Code wajib tersedia." }, 400);
    const deviceHash = await sha(`${pepper}|device|${deviceId}`);
    const ip = clean(req.headers.get("x-forwarded-for")?.split(",")[0], 80);
    const ipHash = ip ? await sha(`${pepper}|ip|${ip}`) : "";

    if (action === "activate") {
      const licenseKey = clean(body.license_key, 160).toUpperCase().replaceAll(" ", "");
      if (!licenseKey) return json(req, { ok: false, code: "LICENSE_KEY_REQUIRED", message: "License Key wajib diisi." }, 400);
      const rawToken = token();
      const { data, error } = await admin.rpc("ldm2_activate", {
        p_key_hash_hex: await sha(licenseKey), p_activation_token_hash_hex: await sha(rawToken),
        p_device_hash_hex: deviceHash, p_device_name: deviceName, p_store_code: storeCode,
        p_app_version: appVersion || null, p_ip_hash_hex: ipHash || null,
      });
      if (error) throw error;
      const result = data as Record<string, unknown>;
      if (result?.ok === true) return json(req, { ...result, activation_token: rawToken });
      return json(req, result, mapStatus(result));
    }

    if (action === "check") {
      const rawToken = clean(body.activation_token, 250);
      if (!rawToken) return json(req, { ok: false, code: "ACTIVATION_REQUIRED", message: "Aktivasi belum tersedia." }, 401);
      const { data, error } = await admin.rpc("ldm2_check", {
        p_activation_token_hash_hex: await sha(rawToken), p_device_hash_hex: deviceHash,
        p_store_code: storeCode, p_app_version: appVersion || null, p_ip_hash_hex: ipHash || null,
      });
      if (error) throw error;
      const result = data as Record<string, unknown>;
      return json(req, result, mapStatus(result));
    }

    if (action === "start_trial") {
      const name = clean(body.customer_name, 120);
      const email = clean(body.customer_email, 180).toLowerCase();
      const phone = clean(body.customer_phone, 40);
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(req, { ok: false, code: "TRIAL_DATA_INVALID", message: "Nama dan email trial wajib valid." }, 400);
      }
      const rawToken = token();
      const { data, error } = await admin.rpc("ldm2_start_trial", {
        p_customer_name: name, p_customer_email: email, p_customer_phone: phone || null,
        p_email_hash_hex: await sha(`${pepper}|email|${email}`),
        p_trial_identity_hash_hex: await sha(`${pepper}|trial|${deviceId}`),
        p_activation_token_hash_hex: await sha(rawToken), p_device_hash_hex: deviceHash,
        p_device_name: deviceName, p_store_code: storeCode, p_app_version: appVersion || null,
        p_ip_hash_hex: ipHash || null,
      });
      if (error) throw error;
      const result = data as Record<string, unknown>;
      if (result?.ok === true) return json(req, { ...result, activation_token: rawToken });
      return json(req, result, mapStatus(result));
    }

    if (action === "deactivate") {
      const rawToken = clean(body.activation_token, 250);
      const { data, error } = await admin.rpc("ldm2_deactivate_by_token", {
        p_activation_token_hash_hex: await sha(rawToken), p_device_hash_hex: deviceHash, p_store_code: storeCode,
      });
      if (error) throw error;
      const result = data as Record<string, unknown>;
      return json(req, result, result?.ok === true ? 200 : 404);
    }

    return json(req, { ok: false, code: "ACTION_UNKNOWN", message: "Action tidak dikenal." }, 400);
  } catch (error) {
    console.error("LDM_LICENSE_V2", error);
    return json(req, { ok: false, code: "LICENSE_SERVER_ERROR", message: "Server lisensi gagal memproses permintaan." }, 500);
  }
});

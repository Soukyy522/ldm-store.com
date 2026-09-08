import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptLicenseKey, decryptLicenseKey } from "../_shared/ldm-license-delivery.ts";

const encoder = new TextEncoder();
const LICENSE_API_VERSION = "27.9.0-v28.1.8-lifetime-owner-vault";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join(""); }
async function sha(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
function token() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function clean(value: unknown, max = 200) { return String(value ?? "").trim().slice(0, max); }

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
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), license_api_version: LICENSE_API_VERSION }
    : data;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-LDM-License-Version": LICENSE_API_VERSION,
    },
  });
}

function mapStatus(result: Record<string, unknown>) {
  if (result?.ok === true) return 200;
  const code = String(result?.code || "");
  if (["LICENSE_KEY_INVALID", "ACTIVATION_INVALID", "OWNER_AUTH_REQUIRED", "OWNER_SESSION_INVALID"].includes(code)) return 401;
  if (["LICENSE_PENDING_PAYMENT", "LICENSE_SUSPENDED", "LICENSE_CANCELLED", "LICENSE_EXPIRED", "PLAN_INACTIVE", "OWNER_FORBIDDEN"].includes(code)) return 403;
  if (["DEVICE_LIMIT_REACHED", "STORE_LIMIT_REACHED", "TRIAL_ALREADY_USED"].includes(code)) return 409;
  return 400;
}

function maskEnd(value: unknown, keep = 4) {
  const raw = clean(value, 500);
  if (!raw) return "-";
  if (raw.length <= keep) return "••••";
  return `${"•".repeat(Math.min(10, Math.max(4, raw.length - keep)))}${raw.slice(-keep)}`;
}

function bearerToken(req: Request, body: any) {
  const authorization = req.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, "").trim();
  }
  // Compatibility fallback untuk build patch lama. Frontend V28.1.8 memakai header.
  return clean(body?.app_access_token, 5000);
}

function applicationAdminClient() {
  const appUrl = env("LDM_APP_SUPABASE_URL");
  const appService = env("LDM_APP_SERVICE_ROLE_KEY");
  if (!appUrl || !appService) {
    throw Object.assign(
      new Error("Akses Owner belum dikonfigurasi. Secret App Supabase belum lengkap."),
      { code: "OWNER_VAULT_NOT_CONFIGURED", status: 503 },
    );
  }
  return createClient(appUrl, appService, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function authenticatedOwner(accessToken: string) {
  if (!accessToken || accessToken.length < 40) {
    throw Object.assign(new Error("Login Owner diperlukan untuk melihat data lisensi."), {
      code: "OWNER_AUTH_REQUIRED", status: 401,
    });
  }

  const app = applicationAdminClient();
  const { data: userData, error: userError } = await app.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user?.id || !user.email) {
    throw Object.assign(new Error("Sesi Owner tidak valid atau sudah berakhir."), {
      code: "OWNER_SESSION_INVALID", status: 401,
    });
  }

  const { data: profile, error: profileError } = await app.from("profiles")
    .select("id,store_id,username,role,deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.deleted_at || String(profile.role || "").toLowerCase() !== "owner") {
    throw Object.assign(new Error("Panel Data Lisensi hanya tersedia untuk akun Owner."), {
      code: "OWNER_FORBIDDEN", status: 403,
    });
  }

  let primaryOwner = false;
  try {
    const userClient = createClient(env("LDM_APP_SUPABASE_URL"), env("LDM_APP_SERVICE_ROLE_KEY"), {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data } = await userClient.rpc("ldm_primary_owner_context");
    const row = Array.isArray(data) ? data[0] : data;
    primaryOwner = row?.is_primary_owner === true;
  } catch (_) {
    primaryOwner = false;
  }

  return {
    app,
    user,
    profile,
    email: String(user.email).trim().toLowerCase(),
    isPrimaryOwner: primaryOwner,
  };
}

async function ownedLicenses(admin: any, owner: any) {
  const rows = new Map<string, any>();

  if (owner.email) {
    const { data, error } = await admin.from("ldm2_licenses")
      .select("id,customer_name,customer_email,plan_code,status,is_trial,starts_at,expires_at,primary_store_id,primary_store_code,primary_store_name,network_id,created_at,max_devices_override,max_stores_override")
      .eq("customer_email", owner.email)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of data || []) rows.set(String(row.id), row);
  }

  if (owner.profile?.store_id) {
    const { data, error } = await admin.from("ldm2_licenses")
      .select("id,customer_name,customer_email,plan_code,status,is_trial,starts_at,expires_at,primary_store_id,primary_store_code,primary_store_name,network_id,created_at,max_devices_override,max_stores_override")
      .eq("primary_store_id", owner.profile.store_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of data || []) rows.set(String(row.id), row);
  }

  return [...rows.values()].sort((a, b) =>
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

function ownsLicense(owner: any, license: any) {
  if (!license) return false;
  const emailMatch = owner.email &&
    String(license.customer_email || "").trim().toLowerCase() === owner.email;
  const storeMatch = owner.profile?.store_id &&
    String(license.primary_store_id || "") === String(owner.profile.store_id || "");
  return Boolean(emailMatch || storeMatch);
}

async function planMap(admin: any, codes: string[]) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map<string, any>();
  const { data, error } = await admin.from("ldm2_plans")
    .select("code,name,active,max_devices,max_stores,features")
    .in("code", unique);
  if (error) throw error;
  return new Map((data || []).map((p: any) => [String(p.code), p]));
}

async function recoverability(admin: any, licenseIds: string[]) {
  const map = new Map<string, { hasKey: boolean; source: string | null }>();
  if (!licenseIds.length) return map;

  try {
    const { data, error } = await admin.from("ldm2_license_secret_vault")
      .select("license_id,source")
      .in("license_id", licenseIds);
    if (error) throw error;
    for (const row of data || []) {
      map.set(String(row.license_id), { hasKey: true, source: String(row.source || "vault") });
    }
  } catch (error) {
    const msg = String((error as Error)?.message || error);
    if (/ldm2_license_secret_vault|does not exist|relation/i.test(msg)) {
      throw Object.assign(
        new Error("SQL-17-LEGACY-LIFETIME-OWNER-VAULT-V28.1.8.sql belum dijalankan."),
        { code: "OWNER_VAULT_SQL_REQUIRED", status: 503 },
      );
    }
    throw error;
  }

  const missing = licenseIds.filter((id) => !map.has(String(id)));
  if (missing.length) {
    const { data, error } = await admin.from("ldm2_checkout_deliveries")
      .select("license_id")
      .in("license_id", missing);
    if (error) throw error;
    for (const row of data || []) {
      if (!map.has(String(row.license_id))) {
        map.set(String(row.license_id), { hasKey: true, source: "checkout" });
      }
    }
  }

  return map;
}

async function latestPaidPayment(admin: any, licenseId: string) {
  const { data, error } = await admin.from("ldm2_payments")
    .select("id,order_id,payment_type,plan_code,billing_cycle,status,amount,provider,provider_status,provider_transaction_id,paid_at,created_at")
    .eq("license_id", licenseId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

async function recoverLicenseKey(admin: any, licenseId: string) {
  let vault: any = null;
  try {
    const { data, error } = await admin.from("ldm2_license_secret_vault")
      .select("license_key_ciphertext,source,reveal_count")
      .eq("license_id", licenseId)
      .maybeSingle();
    if (error) throw error;
    vault = data;
  } catch (error) {
    const msg = String((error as Error)?.message || error);
    if (/ldm2_license_secret_vault|does not exist|relation/i.test(msg)) {
      throw Object.assign(
        new Error("SQL-17-LEGACY-LIFETIME-OWNER-VAULT-V28.1.8.sql belum dijalankan."),
        { code: "OWNER_VAULT_SQL_REQUIRED", status: 503 },
      );
    }
    throw error;
  }

  if (vault?.license_key_ciphertext) {
    const raw = await decryptLicenseKey(vault.license_key_ciphertext);
    await admin.from("ldm2_license_secret_vault").update({
      last_revealed_at: new Date().toISOString(),
      reveal_count: Number(vault.reveal_count || 0) + 1,
    }).eq("license_id", licenseId);
    return { rawKey: raw, source: String(vault.source || "vault") };
  }

  const { data: deliveries, error: deliveryError } = await admin.from("ldm2_checkout_deliveries")
    .select("license_key_ciphertext,order_id,created_at")
    .eq("license_id", licenseId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (deliveryError) throw deliveryError;
  const delivery = (deliveries || [])[0];

  if (delivery?.license_key_ciphertext) {
    const raw = await decryptLicenseKey(delivery.license_key_ciphertext);
    try {
      await admin.from("ldm2_license_secret_vault").upsert({
        license_id: licenseId,
        license_key_ciphertext: delivery.license_key_ciphertext,
        source: "checkout",
        registered_at: new Date().toISOString(),
        last_revealed_at: new Date().toISOString(),
        reveal_count: 1,
      }, { onConflict: "license_id" });
    } catch (_) {}
    return { rawKey: raw, source: "checkout" };
  }

  return { rawKey: null, source: null };
}

async function storeActivatedKey(admin: any, licenseId: unknown, rawKey: string) {
  const id = clean(licenseId, 80);
  if (!id || !rawKey) return;
  try {
    const ciphertext = await encryptLicenseKey(rawKey);
    await admin.from("ldm2_license_secret_vault").upsert({
      license_id: id,
      license_key_ciphertext: ciphertext,
      source: "activation",
      registered_at: new Date().toISOString(),
    }, { onConflict: "license_id" });
  } catch (error) {
    // Aktivasi tidak boleh gagal hanya karena vault belum siap.
    console.warn("LDM_OWNER_VAULT_CAPTURE_SKIPPED", clean((error as Error)?.message || error, 300));
  }
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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 40).toLowerCase();

    if (action === "health") {
      const { data, error } = await admin.from("ldm2_plans")
        .select("code,name,description,price_monthly,price_yearly,price_lifetime,max_devices,max_stores,features")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;

      const { data: lifetime } = await admin.from("ldm2_plans")
        .select("code,name,active,max_devices,max_stores")
        .eq("code", "LIFETIME")
        .maybeSingle();

      return json(req, {
        ok: true,
        service: "LDM_LICENSE_V2",
        plans: data,
        legacy_lifetime_supported: Boolean(lifetime && lifetime.active === false),
        time: new Date().toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // OWNER LICENSE VAULT
    // Dijalankan sebelum device/store requirement agar Owner dapat membuka
    // riwayat lisensi dari perangkat baru setelah login.
    // -------------------------------------------------------------------------
    if (action === "owner_vault_list") {
      const owner = await authenticatedOwner(bearerToken(req, body));
      const licenses = await ownedLicenses(admin, owner);
      const plans = await planMap(admin, licenses.map((l: any) => String(l.plan_code || "")));
      const keyMap = await recoverability(admin, licenses.map((l: any) => String(l.id)));

      const rows = licenses.map((license: any) => {
        const plan = plans.get(String(license.plan_code)) || {};
        const key = keyMap.get(String(license.id));
        const lifetimeLegacy = String(license.plan_code) === "LIFETIME" && plan.active === false;
        return {
          license_id: license.id,
          plan_code: license.plan_code,
          plan_name: plan.name || license.plan_code,
          status: license.status,
          is_trial: Boolean(license.is_trial),
          starts_at: license.starts_at,
          expires_at: license.expires_at,
          created_at: license.created_at,
          store_name: license.primary_store_name,
          store_code_masked: maskEnd(license.primary_store_code, 4),
          key_masked: key?.hasKey ? "••••••••••••••••••••" : "Belum tersimpan",
          has_recoverable_key: Boolean(key?.hasKey),
          key_source: key?.source || null,
          legacy_lifetime: lifetimeLegacy,
          plan_sales_active: plan.active !== false,
          max_devices: license.max_devices_override || plan.max_devices || null,
          max_stores: license.max_stores_override || plan.max_stores || null,
        };
      });

      return json(req, {
        ok: true,
        owner: {
          email: owner.email,
          username: owner.profile?.username || null,
          is_primary_owner: owner.isPrimaryOwner,
        },
        licenses: rows,
        sensitive_values_returned: false,
        message: rows.length
          ? "Data penting tetap disembunyikan sampai tombol Reveal ditekan."
          : "Belum ada lisensi yang terhubung ke akun Owner ini.",
      });
    }

    if (action === "owner_vault_reveal") {
      const owner = await authenticatedOwner(bearerToken(req, body));
      const licenseId = clean(body.license_id, 80);
      if (!licenseId) {
        return json(req, { ok: false, code: "LICENSE_ID_REQUIRED", message: "License ID wajib diisi." }, 400);
      }

      const { data: license, error: licenseError } = await admin.from("ldm2_licenses")
        .select("id,customer_name,customer_email,plan_code,status,is_trial,starts_at,expires_at,primary_store_id,primary_store_code,primary_store_name,network_id,created_at,max_devices_override,max_stores_override")
        .eq("id", licenseId)
        .maybeSingle();
      if (licenseError) throw licenseError;
      if (!license) return json(req, { ok: false, code: "LICENSE_NOT_FOUND", message: "Lisensi tidak ditemukan." }, 404);
      if (!ownsLicense(owner, license)) {
        return json(req, { ok: false, code: "OWNER_FORBIDDEN", message: "Lisensi ini bukan milik akun Owner yang sedang login." }, 403);
      }

      const plans = await planMap(admin, [String(license.plan_code)]);
      const plan = plans.get(String(license.plan_code)) || {};
      const recovered = await recoverLicenseKey(admin, licenseId);
      const payment = await latestPaidPayment(admin, licenseId);
      const legacyLifetime = String(license.plan_code) === "LIFETIME" && plan.active === false;

      try {
        await admin.from("ldm2_events").insert({
          license_id: licenseId,
          event_type: "OWNER_LICENSE_VAULT_REVEALED",
          detail: {
            owner_email_hash: await sha(owner.email),
            key_available: Boolean(recovered.rawKey),
            key_source: recovered.source,
            legacy_lifetime: legacyLifetime,
          },
        });
      } catch (_) {}

      return json(req, {
        ok: true,
        license: {
          license_id: license.id,
          license_key: recovered.rawKey,
          key_recoverable: Boolean(recovered.rawKey),
          key_source: recovered.source,
          plan_code: license.plan_code,
          plan_name: plan.name || license.plan_code,
          status: license.status,
          is_trial: Boolean(license.is_trial),
          starts_at: license.starts_at,
          expires_at: license.expires_at,
          store_code: license.primary_store_code,
          store_name: license.primary_store_name,
          store_id: license.primary_store_id,
          network_id: license.network_id,
          owner_name: license.customer_name,
          owner_email: license.customer_email,
          legacy_lifetime: legacyLifetime,
          plan_sales_active: plan.active !== false,
          max_devices: license.max_devices_override || plan.max_devices || null,
          max_stores: license.max_stores_override || plan.max_stores || null,
          last_paid_order_id: payment?.order_id || null,
          last_paid_at: payment?.paid_at || null,
          last_billing_cycle: payment?.billing_cycle || null,
          last_amount: payment?.amount ?? null,
        },
        password_recoverable: false,
        password_note: "Password Owner tidak dapat ditampilkan ulang karena Supabase Auth tidak menyimpan password dalam bentuk yang dapat dibaca. Gunakan reset/ganti password bila lupa.",
        recovery_note: recovered.rawKey
          ? null
          : legacyLifetime
            ? "License Key Lifetime lama belum tersimpan di vault. Jika masih memiliki key lama, lakukan aktivasi sekali pada build V28.1.8 agar key didaftarkan terenkripsi untuk reveal berikutnya."
            : "License Key lama belum tersedia dalam penyimpanan terenkripsi. Hubungi developer bila key asli sudah hilang.",
      });
    }

    const deviceId = clean(body.device_id, 180);
    const storeCode = clean(body.store_code, 80).toUpperCase();
    const deviceName = clean(body.device_name, 100) || "Perangkat";
    const appVersion = clean(body.app_version, 30);

    if (!deviceId || !storeCode) {
      return json(req, { ok: false, code: "DEVICE_CONTEXT_REQUIRED", message: "Device ID dan Store Code wajib tersedia." }, 400);
    }

    const deviceHash = await sha(`${pepper}|device|${deviceId}`);
    const ip = clean(req.headers.get("x-forwarded-for")?.split(",")[0], 80);
    const ipHash = ip ? await sha(`${pepper}|ip|${ip}`) : "";

    if (action === "activate") {
      const licenseKey = clean(body.license_key, 160).toUpperCase().replaceAll(" ", "");
      if (!licenseKey) {
        return json(req, { ok: false, code: "LICENSE_KEY_REQUIRED", message: "License Key wajib diisi." }, 400);
      }

      const rawToken = token();
      const { data, error } = await admin.rpc("ldm2_activate", {
        p_key_hash_hex: await sha(licenseKey),
        p_activation_token_hash_hex: await sha(rawToken),
        p_device_hash_hex: deviceHash,
        p_device_name: deviceName,
        p_store_code: storeCode,
        p_app_version: appVersion || null,
        p_ip_hash_hex: ipHash || null,
      });
      if (error) throw error;

      const result = data as Record<string, unknown>;
      if (result?.ok === true) {
        await storeActivatedKey(admin, result.license_id, licenseKey);
        return json(req, { ...result, activation_token: rawToken });
      }
      return json(req, result, mapStatus(result));
    }

    if (action === "check") {
      const rawToken = clean(body.activation_token, 250);
      if (!rawToken) {
        return json(req, { ok: false, code: "ACTIVATION_REQUIRED", message: "Aktivasi belum tersedia." }, 401);
      }

      const { data, error } = await admin.rpc("ldm2_check", {
        p_activation_token_hash_hex: await sha(rawToken),
        p_device_hash_hex: deviceHash,
        p_store_code: storeCode,
        p_app_version: appVersion || null,
        p_ip_hash_hex: ipHash || null,
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
        p_customer_name: name,
        p_customer_email: email,
        p_customer_phone: phone || null,
        p_email_hash_hex: await sha(`${pepper}|email|${email}`),
        p_trial_identity_hash_hex: await sha(`${pepper}|trial|${deviceId}`),
        p_activation_token_hash_hex: await sha(rawToken),
        p_device_hash_hex: deviceHash,
        p_device_name: deviceName,
        p_store_code: storeCode,
        p_app_version: appVersion || null,
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
        p_activation_token_hash_hex: await sha(rawToken),
        p_device_hash_hex: deviceHash,
        p_store_code: storeCode,
      });
      if (error) throw error;

      const result = data as Record<string, unknown>;
      return json(req, result, result?.ok === true ? 200 : 404);
    }

    return json(req, { ok: false, code: "ACTION_UNKNOWN", message: "Action tidak dikenal." }, 400);
  } catch (error) {
    console.error("LDM_LICENSE_V2", error);
    const status = Number((error as any)?.status || 500);
    const code = clean((error as any)?.code || (status >= 500 ? "LICENSE_SERVER_ERROR" : "REQUEST_FAILED"), 80);
    const message = clean((error as Error)?.message || "Server lisensi gagal memproses permintaan.", 600);
    return json(req, { ok: false, code, message }, status);
  }
});

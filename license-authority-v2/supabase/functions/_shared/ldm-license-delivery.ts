
import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}

export function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeWhatsApp(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (digits.startsWith("8")) digits = "62" + digits;
  return digits;
}

export function billingLabel(value: string) {
  const v = String(value || "").toLowerCase();
  if (v === "yearly") return "Tahunan";
  if (v === "lifetime") return "Lifetime";
  return "Bulanan";
}

function bytesToB64(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(value: string) {
  const bin = atob(value);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveAesKey(secret: string) {
  if (secret.length < 24) throw new Error("LDM_CHECKOUT_ENCRYPTION_SECRET minimal 24 karakter.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptLicenseKey(rawKey: string) {
  const key = await deriveAesKey(env("LDM_CHECKOUT_ENCRYPTION_SECRET"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(rawKey));
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(encrypted))}`;
}

export async function decryptLicenseKey(payload: string) {
  const [ivB64, dataB64] = String(payload || "").split(".");
  if (!ivB64 || !dataB64) throw new Error("Ciphertext License Key tidak valid.");
  const key = await deriveAesKey(env("LDM_CHECKOUT_ENCRYPTION_SECRET"));
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(dataB64),
  );
  return decoder.decode(raw);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#_-";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

async function findAuthUserByEmail(app: any, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await app.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw error;
    const found = (data?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email.toLowerCase());
    if (found) return found;
    if ((data?.users || []).length < 500) break;
  }
  return null;
}

export async function preflightApplicationProvisioning(input: { customerEmail: string; storeCode: string }) {
  const appSupabaseUrl = env("LDM_APP_SUPABASE_URL");
  const appServiceKey = env("LDM_APP_SERVICE_ROLE_KEY");
  if (!appSupabaseUrl || !appServiceKey) return { configured: false };
  const app = createClient(appSupabaseUrl, appServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: existingStore, error: storeError } = await app.from("stores")
    .select("id,code,name,deleted_at").eq("code", input.storeCode).is("deleted_at", null).maybeSingle();
  if (storeError) throw storeError;
  if (existingStore) throw Object.assign(new Error(`Store Code ${input.storeCode} sudah digunakan pada Cloud App.`), {
    code: "STORE_CODE_CLOUD_USED", status: 409,
  });
  const existingUser = await findAuthUserByEmail(app, input.customerEmail);
  if (existingUser?.id) {
    const { data: profile, error: profileError } = await app.from("profiles")
      .select("id,store_id,deleted_at").eq("id", existingUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.store_id && !profile?.deleted_at) throw Object.assign(
      new Error("Email Owner sudah terhubung ke toko lain pada Cloud App. Gunakan email lain atau proses melalui developer."),
      { code: "OWNER_EMAIL_CLOUD_USED", status: 409 },
    );
  }
  return { configured: true };
}

async function provisionApplicationOwner(input: {
  customerName: string; customerEmail: string; storeId: string; storeCode: string; storeName: string; networkId: string;
}, includePasswordLink = false) {
  const appSupabaseUrl = env("LDM_APP_SUPABASE_URL");
  const appServiceKey = env("LDM_APP_SERVICE_ROLE_KEY");
  const publicUrl = env("LDM_APP_PUBLIC_URL").replace(/\/+$/, "");
  if (!appSupabaseUrl || !appServiceKey || !publicUrl) {
    return { status: "not_configured", userId: null, passwordSetupUrl: null, error: "Secret provisioning aplikasi belum lengkap." };
  }
  const app = createClient(appSupabaseUrl, appServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let user = await findAuthUserByEmail(app, input.customerEmail);
  if (!user) {
    const { data, error } = await app.auth.admin.createUser({
      email: input.customerEmail,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: { display_name: input.customerName, store_code: input.storeCode },
    });
    if (error) throw error;
    user = data.user;
  }
  if (!user?.id) throw new Error("Auth user aplikasi gagal dibuat.");

  const { data: existingProfile, error: profileReadError } = await app.from("profiles")
    .select("id,store_id").eq("id", user.id).maybeSingle();
  if (profileReadError) throw profileReadError;
  if (existingProfile?.store_id && existingProfile.store_id !== input.storeId) {
    throw new Error("Email customer sudah terhubung ke toko lain pada Cloud App.");
  }

  const { error: storeError } = await app.from("stores").upsert({
    id: input.storeId, code: input.storeCode, name: input.storeName,
    timezone: "Asia/Makassar", currency: "IDR", status: "active", deleted_at: null,
  }, { onConflict: "id" });
  if (storeError) throw storeError;

  const { error: profileError } = await app.from("profiles").upsert({
    id: user.id, store_id: input.storeId, username: "owner", display_name: input.customerName,
    role: "owner", active: true, deleted_at: null, deleted_by: null,
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const networkPayload: Record<string, unknown> = {
    id: input.networkId, code: `NET-${input.storeCode}`, name: `${input.storeName} Network`, active: true,
    created_by: user.id, deleted_at: null, primary_owner_user_id: user.id,
  };
  let { error: networkError } = await app.from("store_networks").upsert(networkPayload, { onConflict: "id" });
  if (networkError && /primary_owner_user_id/i.test(networkError.message || "")) {
    delete networkPayload.primary_owner_user_id;
    ({ error: networkError } = await app.from("store_networks").upsert(networkPayload, { onConflict: "id" }));
  }
  if (networkError) throw networkError;

  const { error: networkStoreError } = await app.from("store_network_stores").upsert({
    network_id: input.networkId, store_id: input.storeId, is_primary: true, active: true,
  }, { onConflict: "store_id" });
  if (networkStoreError) throw networkStoreError;

  const { error: membershipError } = await app.from("store_memberships").upsert({
    user_id: user.id, store_id: input.storeId, role: "owner", active: true, is_default: true, invited_by: user.id,
  }, { onConflict: "user_id,store_id" });
  if (membershipError) throw membershipError;

  let passwordSetupUrl: string | null = null;
  if (includePasswordLink) {
    try {
      const { data: linkData, error: linkError } = await app.auth.admin.generateLink({
        type: "recovery", email: input.customerEmail,
        options: { redirectTo: `${publicUrl}/account-password-reset.html` },
      });
      if (!linkError) passwordSetupUrl = linkData?.properties?.action_link || null;
    } catch (_) { passwordSetupUrl = null; }
  }
  return { status: "ready", userId: user.id, passwordSetupUrl, error: null };
}

async function loadPaidContext(admin: any, orderId: string) {
  const { data: payment, error: paymentError } = await admin.from("ldm2_payments")
    .select("id,license_id,order_id,plan_code,billing_cycle,status,amount,paid_at")
    .eq("order_id", orderId).maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment || payment.status !== "paid") return null;

  const { data: delivery, error: deliveryError } = await admin.from("ldm2_checkout_deliveries")
    .select("*").eq("payment_id", payment.id).maybeSingle();
  if (deliveryError) throw deliveryError;
  if (!delivery) throw new Error("Data receipt checkout tidak ditemukan.");

  const { data: license, error: licenseError } = await admin.from("ldm2_licenses")
    .select("id,customer_name,customer_email,customer_phone,primary_store_id,primary_store_code,primary_store_name,network_id,expires_at,plan_code,status")
    .eq("id", payment.license_id).single();
  if (licenseError) throw licenseError;

  const { data: plan, error: planError } = await admin.from("ldm2_plans")
    .select("name").eq("code", payment.plan_code).single();
  if (planError) throw planError;
  return { payment, delivery, license, plan };
}

export async function preparePaidOrder(admin: any, orderId: string, force = false) {
  const ctx = await loadPaidContext(admin, orderId);
  if (!ctx) return { eligible: false, reason: "PAYMENT_NOT_PAID" };
  const { payment, delivery, license } = ctx;
  if (!force && delivery.provision_status === "ready" && delivery.last_attempt_at &&
      (Date.now() - new Date(delivery.last_attempt_at).getTime()) < 30000) {
    return { eligible: true, throttled: true, provision_status: delivery.provision_status, completed: true };
  }

  let provision: any;
  try {
    provision = await provisionApplicationOwner({
      customerName: license.customer_name, customerEmail: license.customer_email,
      storeId: license.primary_store_id, storeCode: license.primary_store_code,
      storeName: license.primary_store_name, networkId: license.network_id,
    }, false);
  } catch (error) {
    provision = { status: "failed", userId: null, passwordSetupUrl: null, error: clean((error as Error)?.message || error) };
  }

  const completed = provision.status === "ready";
  const { error: updateError } = await admin.from("ldm2_checkout_deliveries").update({
    email_status: "not_configured",
    whatsapp_status: "not_configured",
    email_error: null,
    whatsapp_error: null,
    provision_status: provision.status,
    provision_error: provision.error || null,
    owner_user_id: provision.userId || null,
    last_attempt_at: new Date().toISOString(),
    completed_at: completed ? (delivery.completed_at || new Date().toISOString()) : null,
  }).eq("payment_id", payment.id);
  if (updateError) throw updateError;

  try {
    await admin.from("ldm2_events").insert({
      license_id: payment.license_id,
      event_type: "CUSTOMER_WEB_RECEIPT_READY",
      detail: { order_id: orderId, provision_status: provision.status, delivery_channel: "license_page" },
    });
  } catch (_) {}

  return { eligible: true, provision_status: provision.status, completed, provision_error: provision.error || null };
}

export async function getPaidWebReceipt(admin: any, orderId: string) {
  const ctx = await loadPaidContext(admin, orderId);
  if (!ctx) return null;
  const { payment, delivery, license, plan } = ctx;

  let provision: any;
  try {
    provision = await provisionApplicationOwner({
      customerName: license.customer_name, customerEmail: license.customer_email,
      storeId: license.primary_store_id, storeCode: license.primary_store_code,
      storeName: license.primary_store_name, networkId: license.network_id,
    }, true);
  } catch (error) {
    provision = { status: "failed", userId: null, passwordSetupUrl: null, error: clean((error as Error)?.message || error) };
  }

  await admin.from("ldm2_checkout_deliveries").update({
    email_status: "not_configured", whatsapp_status: "not_configured",
    email_error: null, whatsapp_error: null,
    provision_status: provision.status, provision_error: provision.error || null,
    owner_user_id: provision.userId || null, last_attempt_at: new Date().toISOString(),
    completed_at: provision.status === "ready" ? (delivery.completed_at || new Date().toISOString()) : delivery.completed_at,
  }).eq("payment_id", payment.id);

  const rawKey = await decryptLicenseKey(delivery.license_key_ciphertext);
  const appUrl = (env("LDM_APP_PUBLIC_URL") || env("LDM_PUBLIC_APP_URL") || "").replace(/\/+$/, "");
  const guideUrl = env("LDM_GUIDE_URL") || (appUrl ? `${appUrl}/panduan.html` : "");

  return {
    order_id: orderId,
    plan_name: plan.name,
    plan_code: payment.plan_code,
    billing_cycle: payment.billing_cycle,
    period_label: billingLabel(payment.billing_cycle),
    amount: payment.amount,
    paid_at: payment.paid_at,
    license_key: rawKey,
    store_code: license.primary_store_code,
    store_id: license.primary_store_id,
    network_id: license.network_id,
    expires_at: license.expires_at,
    owner_email: license.customer_email,
    app_url: appUrl || null,
    guide_url: guideUrl || null,
    password_setup_url: provision.passwordSetupUrl || null,
    provision_status: provision.status,
    provision_error: provision.error || null,
  };
}

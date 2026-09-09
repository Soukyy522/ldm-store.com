import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "27.9.0-v28.3.2-public-contact";
const OFFICIAL_ORIGINS = ["https://soukyy522.github.io"];

function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}
function clean(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}
function allowedOrigins() {
  const custom = env("LDM2_PUBLIC_CONTACT_ALLOWED_ORIGINS")
    .split(",").map((v) => v.trim()).filter(Boolean);
  return [...new Set([...OFFICIAL_ORIGINS, ...custom])];
}
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!origin) return "*";
  if (allowedOrigins().includes(origin)) return origin;
  const allowNull = env("LDM2_PUBLIC_CONTACT_ALLOW_NULL_ORIGIN").toLowerCase() === "true";
  if (origin === "null" && allowNull) return "*";
  return "";
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req) || "null",
    "Access-Control-Allow-Headers": "content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-LDM-Public-Contact-Version": API_VERSION,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    if (!allowedOrigin(req)) return json(req, { ok:false, message:"Origin tidak diizinkan." }, 403);
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "GET") return json(req, { ok:false, message:"Gunakan GET." }, 405);
  if (!allowedOrigin(req)) return json(req, { ok:false, message:"Origin tidak diizinkan." }, 403);

  try {
    const url = env("SUPABASE_URL");
    const service = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return json(req, { ok:false, message:"Konfigurasi server belum lengkap." }, 500);

    const admin = createClient(url, service, {
      auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    });

    const { data, error } = await admin.from("ldm2_public_contact_settings")
      .select("whatsapp_enabled,whatsapp_number,whatsapp_display,whatsapp_label,whatsapp_greeting,email_enabled,email_address,email_label,email_subject,support_center_enabled,support_center_label,guide_enabled,guide_label,license_enabled,license_label,revision,updated_at")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      if (/ldm2_public_contact_settings|does not exist|schema cache/i.test(error.message || "")) {
        return json(req, { ok:false, code:"PUBLIC_CONTACT_SQL_MISSING", message:"Konfigurasi kontak publik belum diaktifkan." }, 503);
      }
      throw error;
    }
    if (!data) return json(req, { ok:false, code:"PUBLIC_CONTACT_NOT_FOUND", message:"Konfigurasi kontak publik belum tersedia." }, 404);

    return json(req, {
      ok:true,
      api_version:API_VERSION,
      config:{
        version:"1.0",
        revision:Number(data.revision || 1),
        updated_at:data.updated_at || null,
        whatsapp:{
          enabled:data.whatsapp_enabled === true,
          number:clean(data.whatsapp_number,20).replace(/\D/g,""),
          display:clean(data.whatsapp_display,40),
          label:clean(data.whatsapp_label,60),
          greeting:clean(data.whatsapp_greeting,240),
        },
        email:{
          enabled:data.email_enabled === true,
          address:clean(data.email_address,160).toLowerCase(),
          label:clean(data.email_label,60),
          subject:clean(data.email_subject,160),
        },
        support_center:{enabled:data.support_center_enabled === true,label:clean(data.support_center_label,70)},
        guide:{enabled:data.guide_enabled === true,label:clean(data.guide_label,70)},
        license:{enabled:data.license_enabled === true,label:clean(data.license_label,70)},
      }
    });
  } catch (error) {
    console.error("LDM_PUBLIC_CONTACT", error);
    return json(req, { ok:false, message:"Kontak publik belum dapat dimuat." }, 500);
  }
});

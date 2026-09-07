import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertDokuRuntime, dokuEnvironment, dokuEventKey, dokuRuntimeHealth,
  verifyDokuNotification, registerDokuEvent, finishDokuEvent, applyDokuRemote,
} from "../_shared/ldm-doku-operations.ts";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "LDM_DOKU_WEBHOOK", runtime: dokuRuntimeHealth() });
  }
  if (req.method !== "POST") return json({ ok: false, message: "Gunakan POST." }, 405);

  let eventKey = "";
  let admin: any = null;
  try {
    assertDokuRuntime();
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) return json({ ok: false, message: "Supabase server secret belum lengkap." }, 500);
    admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

    const rawBody = await req.text();
    let body: any = {};
    try { body = JSON.parse(rawBody || "{}"); }
    catch { return json({ ok: false, message: "Body DOKU bukan JSON valid." }, 400); }

    const orderId = String(body?.order?.invoice_number || "").trim();
    if (!orderId) return json({ ok: false, message: "order.invoice_number tidak ditemukan." }, 400);

    const target = new URL(req.url).pathname;
    const verification = await verifyDokuNotification(req.headers, rawBody, target);
    eventKey = await dokuEventKey("webhook", body, verification.requestId || "");

    const registered = await registerDokuEvent(admin, {
      eventKey, orderId, source: "webhook", requestId: verification.requestId || "",
      remote: body, signatureValid: verification.ok,
    });

    if (!verification.ok) {
      await finishDokuEvent(admin, eventKey, false, verification.reason || "Signature DOKU tidak valid.", { environment: dokuEnvironment() });
      return json({ ok: false, message: verification.reason || "Signature DOKU tidak valid." }, 401);
    }

    if (registered?.already_processed) {
      return json({ ok: true, duplicate: true, event_key: eventKey });
    }

    const applied = await applyDokuRemote(admin, body, "doku_webhook");
    await finishDokuEvent(admin, eventKey, true, null, { applied, environment: dokuEnvironment() });
    return json({ ok: true, event_key: eventKey, applied });
  } catch (error) {
    console.error("LDM_DOKU_WEBHOOK", error);
    if (admin && eventKey) {
      try { await finishDokuEvent(admin, eventKey, false, String((error as Error)?.message || error), {}); } catch (_) {}
    }
    return json({ ok: false, message: String((error as Error)?.message || "DOKU webhook gagal.") }, 500);
  }
});

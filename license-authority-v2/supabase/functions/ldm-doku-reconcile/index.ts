import { createClient } from "npm:@supabase/supabase-js@2";
import { preparePaidOrder, releaseApplicationOwnerReservation } from "../_shared/ldm-license-delivery.ts";
import { dokuRuntimeHealth, reconcilePaymentFromDoku } from "../_shared/ldm-doku-operations.ts";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function clean(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function authorized(req: Request) {
  const expected = env("DOKU_RECONCILE_SECRET");
  if (!expected) return false;
  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const custom = String(req.headers.get("x-ldm-reconcile-secret") || "").trim();
  return bearer === expected || custom === expected;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    if (!authorized(req)) return json({ ok: false, message: "Reconcile secret tidak valid." }, 401);
    return json({ ok: true, service: "LDM_DOKU_RECONCILE", runtime: dokuRuntimeHealth() });
  }
  if (req.method !== "POST") return json({ ok: false, message: "Gunakan POST." }, 405);
  if (!authorized(req)) return json({ ok: false, message: "Reconcile secret tidak valid." }, 401);

  try {
    const runtime = dokuRuntimeHealth();
    if (!runtime.ok) return json({ ok: false, code: "DOKU_RUNTIME_INVALID", runtime }, 500);

    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, message: "Secret License Authority belum lengkap." }, 500);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit || 10), 25));
    const minAgeSeconds = Math.max(60, Math.min(Number(body?.min_age_seconds || 120), 86400));
    const maxAgeDays = Math.max(1, Math.min(Number(body?.max_age_days || 7), 30));
    const { data: candidates, error: candidatesError } = await admin.rpc("ldm2_doku_reconciliation_candidates", {
      p_limit: limit,
      p_min_age_seconds: minAgeSeconds,
      p_max_age_days: maxAgeDays,
    });
    if (candidatesError) throw candidatesError;

    const results: any[] = [];
    for (const payment of candidates || []) {
      const orderId = String(payment.order_id || "");
      try {
        const sync = await reconcilePaymentFromDoku(admin, payment, "scheduled_doku_reconcile");
        let localStatus = String(payment.status || "");
        const refreshed = await admin.from("ldm2_payments")
          .select("status,provider_status,processed_at,paid_at,created_at")
          .eq("order_id", orderId).maybeSingle();
        if (refreshed.error) throw refreshed.error;
        if (refreshed.data) localStatus = String(refreshed.data.status || localStatus);

        if (localStatus === "paid") {
          try { await preparePaidOrder(admin, orderId, true); }
          catch (deliveryError) { console.error("DOKU_RECONCILE_PREPARE_PAID_ORDER", orderId, deliveryError); }
        } else if (["cancelled", "expired", "failed"].includes(localStatus)) {
          try { await releaseApplicationOwnerReservation(admin, orderId); }
          catch (cleanupError) { console.error("DOKU_RECONCILE_OWNER_RESERVATION_CLEANUP", orderId, cleanupError); }
        }

        results.push({
          order_id: orderId,
          ok: true,
          remote_found: sync.found,
          remote_status: clean(sync?.remote?.transaction?.status || sync?.remote?.order?.status, 60) || null,
          payment_status: localStatus,
        });
      } catch (error) {
        console.error("DOKU_RECONCILE_ORDER", orderId, error);
        results.push({ order_id: orderId, ok: false, error: clean((error as Error)?.message || "Rekonsiliasi DOKU gagal", 500) });
      }
    }

    const failed = results.filter((item) => !item.ok).length;
    return json({
      ok: failed === 0,
      checked: results.length,
      failed,
      runtime: { environment: runtime.environment },
      results,
    }, failed === results.length && results.length > 0 ? 502 : 200);
  } catch (error) {
    console.error("LDM_DOKU_RECONCILE", error);
    return json({ ok: false, message: clean((error as Error)?.message || "Rekonsiliasi DOKU gagal.", 500) }, 500);
  }
});

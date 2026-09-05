import { createClient } from "npm:@supabase/supabase-js@2";
import { preparePaidOrder, releaseApplicationOwnerReservation } from "../_shared/ldm-license-delivery.ts";
import {
  cleanMidtrans,
  midtransRuntimeHealth,
  reconcilePaymentFromMidtrans,
} from "../_shared/ldm-midtrans-operations.ts";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function authorized(req: Request) {
  const expected = env("MIDTRANS_RECONCILE_SECRET");
  if (!expected) return false;
  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const custom = String(req.headers.get("x-ldm-reconcile-secret") || "").trim();
  return bearer === expected || custom === expected;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    if (!authorized(req)) return json({ ok: false, message: "Reconcile secret tidak valid." }, 401);
    return json({ ok: true, service: "LDM_MIDTRANS_RECONCILE", runtime: midtransRuntimeHealth() });
  }
  if (req.method !== "POST") return json({ ok: false, message: "Gunakan POST." }, 405);
  if (!authorized(req)) return json({ ok: false, message: "Reconcile secret tidak valid." }, 401);

  try {
    const runtime = midtransRuntimeHealth();
    if (!runtime.ok) return json({ ok: false, code: "MIDTRANS_RUNTIME_INVALID", runtime }, 500);

    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, message: "Secret License Authority belum lengkap." }, 500);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit || 10), 25));
    const minAgeSeconds = Math.max(60, Math.min(Number(body?.min_age_seconds || 120), 86400));
    const maxAgeDays = Math.max(1, Math.min(Number(body?.max_age_days || 7), 30));
    const { data: candidates, error: candidatesError } = await admin.rpc("ldm2_midtrans_reconciliation_candidates", {
      p_limit: limit,
      p_min_age_seconds: minAgeSeconds,
      p_max_age_days: maxAgeDays,
    });
    if (candidatesError) throw candidatesError;

    const results: any[] = [];
    for (const payment of candidates || []) {
      const orderId = String(payment.order_id || "");
      try {
        const sync = await reconcilePaymentFromMidtrans(admin, payment, "scheduled_reconcile");
        let localStatus = String(payment.status || "");
        const refreshed = await admin.from("ldm2_payments")
          .select("status,provider_status,processed_at,paid_at,created_at")
          .eq("order_id", orderId).maybeSingle();
        if (refreshed.error) throw refreshed.error;
        if (refreshed.data) localStatus = String(refreshed.data.status || localStatus);

        if (!sync.found && new Date(String(payment.created_at)).getTime() < Date.now() - 26 * 60 * 60 * 1000) {
          const cancelled = await admin.rpc("ldm2_cancel_pending_payment_local", {
            p_order_id: orderId,
            p_actor: "scheduled_reconcile",
            p_reason: "Sesi pembayaran lebih dari 26 jam dan transaksi tidak ditemukan pada Midtrans.",
            p_provider_status: "not_created_expired",
            p_provider_detail: { source: "scheduled_reconcile", remote_found: false },
          });
          if (cancelled.error) throw cancelled.error;
          localStatus = "cancelled";
          try { await releaseApplicationOwnerReservation(admin, orderId); } catch (cleanupError) {
            console.error("RECONCILE_OWNER_RESERVATION_CLEANUP", orderId, cleanupError);
          }
        } else if (localStatus === "paid") {
          try { await preparePaidOrder(admin, orderId, true); }
          catch (deliveryError) { console.error("RECONCILE_PREPARE_PAID_ORDER", orderId, deliveryError); }
        } else if (["cancelled", "expired", "failed"].includes(localStatus)) {
          try { await releaseApplicationOwnerReservation(admin, orderId); }
          catch (cleanupError) { console.error("RECONCILE_OWNER_RESERVATION_CLEANUP", orderId, cleanupError); }
        }

        results.push({
          order_id: orderId,
          ok: true,
          remote_found: sync.found,
          remote_status: cleanMidtrans(sync?.remote?.transaction_status, 40) || null,
          payment_status: localStatus,
        });
      } catch (error) {
        console.error("MIDTRANS_RECONCILE_ORDER", orderId, error);
        results.push({ order_id: orderId, ok: false, error: cleanMidtrans((error as Error)?.message || "Rekonsiliasi gagal", 500) });
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
    console.error("LDM_MIDTRANS_RECONCILE", error);
    return json({ ok: false, message: cleanMidtrans((error as Error)?.message || "Rekonsiliasi Midtrans gagal.", 500) }, 500);
  }
});

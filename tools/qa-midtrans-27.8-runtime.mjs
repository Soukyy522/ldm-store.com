import assert from "node:assert/strict";

globalThis.Deno = {
  env: {
    get(name) {
      const values = {
        MIDTRANS_IS_PRODUCTION: "false",
        MIDTRANS_SERVER_KEY: "SB-Mid-server-test-only",
        SUPABASE_URL: "https://example.supabase.co",
      };
      return values[name] || "";
    },
  },
};

const mod = await import("../license-authority-v2/supabase/functions/_shared/ldm-midtrans-operations.ts");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Midtrans dapat membalas HTTP 200 dengan status_code 404 sebelum customer
// memilih metode pembayaran. Keadaan ini bukan kegagalan checkout.
globalThis.fetch = async () => jsonResponse({
  status_code: "404",
  status_message: "Transaction doesn't exist.",
});
const missing = await mod.getMidtransTransactionStatus("LDM-PURCHASE-TEST-1");
assert.equal(missing.exists, false);

// Pembayaran settlement harus diterapkan ke RPC dan dikenali sebagai remote paid.
let appliedPayload = null;
globalThis.fetch = async () => jsonResponse({
  status_code: "200",
  status_message: "Success",
  order_id: "LDM-PURCHASE-TEST-2",
  transaction_id: "trx-test-2",
  transaction_status: "settlement",
  fraud_status: "accept",
  gross_amount: "69000.00",
  payment_type: "bank_transfer",
});
const settlementAdmin = {
  async rpc(name, payload) {
    assert.equal(name, "ldm2_apply_midtrans_notification");
    appliedPayload = payload;
    return { data: { ok: true, payment_status: "paid", license_status: "active" }, error: null };
  },
};
const settlement = await mod.reconcilePaymentFromMidtrans(settlementAdmin, {
  order_id: "LDM-PURCHASE-TEST-2",
  amount: 69000,
}, "qa_runtime");
assert.equal(settlement.found, true);
assert.equal(settlement.applied.payment_status, "paid");
assert.equal(appliedPayload.p_transaction_status, "settlement");
assert.equal(appliedPayload.p_gross_amount, 69000);

// Bila Core transaction belum ada, cancel harus memakai Snap Session API dan
// tetap menyelesaikan pembatalan lokal agar order baru dapat dibuat.
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).endsWith("/status")) {
    return jsonResponse({ status_code: "404", status_message: "Transaction doesn't exist." });
  }
  if (String(url).includes("/snap/v1/transactions/") && String(url).endsWith("/cancel")) {
    return jsonResponse({ canceled_at: "2026-09-02T12:00:00.000Z" });
  }
  throw new Error(`URL tidak diharapkan: ${url}`);
};

const pendingPayment = {
  id: "payment-test-3",
  license_id: "license-test-3",
  order_id: "LDM-PURCHASE-TEST-3",
  status: "pending",
  provider_status: null,
  payment_type: "purchase",
  amount: 69000,
  snap_token: "snap-token-test-3",
  processed_at: null,
  paid_at: null,
};
const cancelAdmin = {
  from(table) {
    assert.equal(table, "ldm2_payments");
    const query = {
      select() { return query; },
      eq() { return query; },
      async maybeSingle() { return { data: { ...pendingPayment }, error: null }; },
    };
    return query;
  },
  async rpc(name, payload) {
    assert.equal(name, "ldm2_cancel_pending_payment_local");
    assert.equal(payload.p_provider_status, "snap_cancelled");
    return {
      data: {
        ok: true,
        order_id: pendingPayment.order_id,
        payment_status: "cancelled",
        provider_status: "snap_cancelled",
        license_preserved_for_retry: true,
      },
      error: null,
    };
  },
};
const cancelled = await mod.cancelPaymentForRetry(cancelAdmin, pendingPayment, "qa_customer", "Ganti metode");
assert.equal(cancelled.local.payment_status, "cancelled");
assert.equal(cancelled.local.license_preserved_for_retry, true);
assert.equal(calls.some((url) => url.includes("snap/v1/transactions/snap-token-test-3/cancel")), true);

console.log("QA MIDTRANS 27.8 RUNTIME LULUS: not-created, settlement, Snap cancel, dan local retry terverifikasi.");

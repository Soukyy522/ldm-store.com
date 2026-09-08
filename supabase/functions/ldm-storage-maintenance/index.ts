import { createClient } from "npm:@supabase/supabase-js@2";

const FUNCTION_VERSION = "27.9.0-storage-maintenance-v2826";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "x-ldm-device-id",
    "x-ldm-cron-secret",
    "x-supabase-api-version",
  ].join(", "),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-LDM-Function-Version": FUNCTION_VERSION,
    },
  });
}

function getNamedKey(envName: string, fallbackName: string) {
  const direct = Deno.env.get(fallbackName);
  if (direct) return direct;
  const raw = Deno.env.get(envName);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.default || Object.values(parsed)[0] || "");
  } catch {
    return "";
  }
}

function chunks<T>(items: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type FileCandidate = { path?: string; size?: number };

async function removeFiles(admin: any, bucket: string, candidates: FileCandidate[]) {
  const uniqueMap = new Map<string, number>();
  for (const item of candidates || []) {
    const path = String(item?.path || "").trim();
    if (!path) continue;
    uniqueMap.set(path, Math.max(Number(item?.size || 0), uniqueMap.get(path) || 0));
  }

  const paths = [...uniqueMap.keys()];
  if (!paths.length) return { deleted: 0, bytes: 0, requested: 0 };

  let deleted = 0;
  let bytes = 0;
  for (const path of paths) bytes += Number(uniqueMap.get(path) || 0);

  // Semua penghapusan object wajib melalui Storage API. storage.objects hanya dibaca
  // oleh SQL helper service_role, tidak dimutasi langsung.
  for (const batch of chunks(paths, 500)) {
    const { data, error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`${bucket}: ${error.message || String(error)}`);
    deleted += Array.isArray(data) ? data.length : batch.length;
  }

  return { deleted, bytes, requested: paths.length };
}

function arrayFromPlan(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

async function cleanupStore(admin: any, storeId: string, triggerSource: string) {
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin
    .from("storage_cleanup_runs")
    .insert({
      store_id: storeId,
      trigger_source: triggerSource,
      status: "running",
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (runError) {
    throw new Error(`Gagal membuat riwayat cleanup: ${runError.message}`);
  }

  let objectsDeleted = 0;
  let bytesDeleted = 0;
  const detail: Record<string, unknown> = {};

  try {
    const { data: plan, error: planError } = await admin.rpc(
      "ldm_storage_cleanup_plan_store",
      { p_store_id: storeId },
    );

    if (planError) {
      const msg = String(planError.message || planError);
      if (/ldm_storage_cleanup_plan_store|schema cache|function/i.test(msg)) {
        throw new Error(
          "SQL-44 Storage Retention Runtime Hardening belum terpasang atau schema cache belum memuat RPC cleanup plan.",
        );
      }
      throw planError;
    }

    // enabled hanya mengontrol cleanup OTOMATIS/Cron. Manual cleanup tetap boleh
    // memakai batas retensi tersimpan walaupun auto-retention dimatikan.
    if (plan?.enabled !== true && triggerSource === "cron") {
      await admin.from("storage_cleanup_runs").update({
        finished_at: new Date().toISOString(),
        status: "success",
        detail: { skipped: "retention_disabled" },
      }).eq("id", run.id);
      return {
        store_id: storeId,
        status: "skipped_disabled",
        database_rows_deleted: 0,
        storage_objects_deleted: 0,
        storage_bytes_deleted: 0,
      };
    }

    const attendance = arrayFromPlan(plan?.attendance);
    const attendanceRemove = await removeFiles(
      admin,
      "ldm-attendance-proofs",
      attendance,
    );
    objectsDeleted += attendanceRemove.deleted;
    bytesDeleted += attendanceRemove.bytes;

    const attendanceIds = attendance
      .map((row: any) => String(row?.id || "").trim())
      .filter(Boolean);
    if (attendanceIds.length) {
      for (const idBatch of chunks(attendanceIds, 250)) {
        const { error } = await admin
          .from("attendance")
          .update({ proof_path: null })
          .in("id", idBatch);
        if (error) throw error;
      }
    }
    detail.attendance_proofs = {
      candidates: attendance.length,
      removed: attendanceRemove.deleted,
    };

    const expenses = arrayFromPlan(plan?.expenses);
    const expenseRemove = await removeFiles(
      admin,
      "ldm-expense-receipts",
      expenses,
    );
    objectsDeleted += expenseRemove.deleted;
    bytesDeleted += expenseRemove.bytes;

    const expenseIds = expenses
      .map((row: any) => String(row?.id || "").trim())
      .filter(Boolean);
    if (expenseIds.length) {
      for (const idBatch of chunks(expenseIds, 250)) {
        const { error } = await admin
          .from("operating_expenses")
          .update({
            receipt_path: null,
            receipt_name: null,
            receipt_original_size: 0,
          })
          .in("id", idBatch);
        if (error) throw error;
      }
    }
    detail.expense_receipts = {
      candidates: expenses.length,
      removed: expenseRemove.deleted,
    };

    const orphans = arrayFromPlan(plan?.orphan_product_images);
    const orphanRemove = await removeFiles(admin, "ldm-product-images", orphans);
    objectsDeleted += orphanRemove.deleted;
    bytesDeleted += orphanRemove.bytes;
    detail.orphan_product_images = {
      candidates: orphans.length,
      removed: orphanRemove.deleted,
    };

    const { data: dbResult, error: dbError } = await admin.rpc(
      "ldm_cleanup_database_retention_store",
      { p_store_id: storeId },
    );
    if (dbError) throw dbError;

    const dbDeleted = Number(dbResult?.database_rows_deleted || 0);
    detail.database = dbResult || {};

    const { error: updateRunError } = await admin
      .from("storage_cleanup_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        database_rows_deleted: dbDeleted,
        storage_objects_deleted: objectsDeleted,
        storage_bytes_deleted: bytesDeleted,
        detail,
        error_message: null,
      })
      .eq("id", run.id);
    if (updateRunError) throw updateRunError;

    return {
      store_id: storeId,
      status: "success",
      database_rows_deleted: dbDeleted,
      storage_objects_deleted: objectsDeleted,
      storage_bytes_deleted: bytesDeleted,
      detail,
    };
  } catch (error) {
    try {
      await admin.from("storage_cleanup_runs").update({
        finished_at: new Date().toISOString(),
        status: "failed",
        storage_objects_deleted: objectsDeleted,
        storage_bytes_deleted: bytesDeleted,
        detail,
        error_message: error instanceof Error ? error.message : String(error),
      }).eq("id", run.id);
    } catch {
      // Jangan menutupi error cleanup utama hanya karena penulisan log gagal.
    }
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = getNamedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getNamedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("LDM_STORAGE_CRON_SECRET") || "";

  if (!url || !publishableKey || !secretKey) {
    return json({
      ok: false,
      code: "STORAGE_RUNTIME_ENV_MISSING",
      error: "Environment App Supabase belum lengkap pada Edge Function.",
    }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim().toLowerCase();
  const headerSecret = req.headers.get("x-ldm-cron-secret") || "";
  const cronMode = Boolean(cronSecret && headerSecret && headerSecret === cronSecret);
  const authHeader = req.headers.get("Authorization") || "";

  const admin = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  try {
    if (cronMode) {
      if (action && !["cleanup-all-stores", "health", "configure-auto-cleanup"].includes(action)) {
        return json({ ok: false, error: "Action Cron tidak dikenal." }, 400);
      }

      if (action === "health") {
        const { data: scheduler } = await admin.rpc("ldm_storage_auto_cleanup_status");
        return json({
          ok: true,
          mode: "cron",
          version: FUNCTION_VERSION,
          cron_secret_configured: true,
          scheduler: scheduler || null,
        });
      }

      if (action === "configure-auto-cleanup") {
        const functionUrl = `${url}/functions/v1/ldm-storage-maintenance`;
        const { data: configured, error: configureError } = await admin.rpc(
          "ldm_storage_configure_auto_cleanup",
          {
            p_function_url: functionUrl,
            p_cron_secret: cronSecret,
            p_schedule: "17 19 * * *",
          },
        );
        if (configureError) {
          const msg = String(configureError.message || configureError);
          if (/ldm_storage_configure_auto_cleanup|schema cache|function/i.test(msg)) {
            return json({
              ok: false,
              code: "STORAGE_SQL_45_REQUIRED",
              error: "SQL-45 Storage Retention Auto Cleanup V28.2.6 belum dijalankan pada App Supabase.",
              version: FUNCTION_VERSION,
            }, 409);
          }
          throw configureError;
        }
        return json({
          ok: true,
          mode: "cron",
          version: FUNCTION_VERSION,
          scheduler: configured,
        });
      }

      const { data, error } = await admin
        .from("data_retention_settings")
        .select("store_id")
        .eq("enabled", true);
      if (error) throw error;

      const storeIds = (data || []).map((row: any) => String(row.store_id));
      const results = [];
      for (const storeId of storeIds) {
        results.push(await cleanupStore(admin, storeId, "cron"));
      }
      return json({
        ok: true,
        trigger: "cron",
        version: FUNCTION_VERSION,
        stores: results.length,
        results,
      });
    }

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ ok: false, error: "Session Owner/Admin wajib tersedia." }, 401);
    }

    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ ok: false, error: "Session Cloud tidak valid atau sudah kedaluwarsa." }, 401);
    }

    const { data: ctxData, error: ctxError } = await userClient.rpc("ldm_my_context");
    if (ctxError) throw ctxError;
    const ctx = Array.isArray(ctxData) ? ctxData[0] : ctxData;
    const role = String(ctx?.role || "").toLowerCase();
    const storeId = String(ctx?.store_id || "").trim();

    if (!storeId || !["owner", "admin"].includes(role)) {
      return json({ ok: false, error: "Akses pembersihan hanya untuk Owner/Admin." }, 403);
    }

    if (action === "health") {
      const { data: health, error: healthError } = await userClient.rpc(
        "ldm_storage_retention_health",
      );
      if (healthError) {
        const msg = String(healthError.message || healthError);
        if (/ldm_storage_retention_health|schema cache|function/i.test(msg)) {
          return json({
            ok: false,
            code: "STORAGE_SQL_44_REQUIRED",
            error: "SQL-44 Storage Retention Runtime Hardening belum dijalankan pada App Supabase.",
            version: FUNCTION_VERSION,
          }, 409);
        }
        throw healthError;
      }

      return json({
        ok: true,
        version: FUNCTION_VERSION,
        mode: "manual",
        store_id: storeId,
        role,
        runtime: {
          publishable_key_ready: Boolean(publishableKey),
          secret_key_ready: Boolean(secretKey),
          cron_secret_ready: Boolean(cronSecret),
        },
        database: health || {},
        scheduler: health?.scheduler || null,
      });
    }

    if (action === "configure-auto-cleanup") {
      if (role !== "owner") {
        return json({ ok: false, error: "Hanya Owner yang dapat mengaktifkan scheduler otomatis." }, 403);
      }
      if (!cronSecret) {
        return json({
          ok: false,
          code: "STORAGE_CRON_SECRET_MISSING",
          error: "LDM_STORAGE_CRON_SECRET belum dikonfigurasi. Jalankan setup scheduler V28.2.6.",
        }, 409);
      }

      const functionUrl = `${url}/functions/v1/ldm-storage-maintenance`;
      const { data: configured, error: configureError } = await admin.rpc(
        "ldm_storage_configure_auto_cleanup",
        {
          p_function_url: functionUrl,
          p_cron_secret: cronSecret,
          p_schedule: "17 19 * * *",
        },
      );
      if (configureError) {
        const msg = String(configureError.message || configureError);
        if (/ldm_storage_configure_auto_cleanup|schema cache|function/i.test(msg)) {
          return json({
            ok: false,
            code: "STORAGE_SQL_45_REQUIRED",
            error: "SQL-45 Storage Retention Auto Cleanup V28.2.6 belum dijalankan pada App Supabase.",
          }, 409);
        }
        throw configureError;
      }
      return json({
        ok: true,
        trigger: "owner-configure",
        version: FUNCTION_VERSION,
        scheduler: configured,
      });
    }

    if (action !== "cleanup-current-store") {
      return json({ ok: false, error: "Action storage maintenance tidak dikenal." }, 400);
    }

    const result = await cleanupStore(admin, storeId, "manual");
    return json({
      ok: true,
      trigger: "manual",
      version: FUNCTION_VERSION,
      stores: 1,
      results: [result],
    });
  } catch (error) {
    console.error("ldm-storage-maintenance", error);
    return json({
      ok: false,
      code: "STORAGE_MAINTENANCE_FAILED",
      error: error instanceof Error ? error.message : String(error),
      version: FUNCTION_VERSION,
    }, 500);
  }
});

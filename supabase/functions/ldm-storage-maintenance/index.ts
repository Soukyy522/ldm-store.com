import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ldm-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string, legacy?: string) {
  return Deno.env.get(name) || (legacy ? Deno.env.get(legacy) : "") || "";
}

function chunks<T>(items: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function cutoffIso(days: number) {
  return new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
}

async function removeFiles(admin: any, bucket: string, paths: string[]) {
  let deleted = 0;
  let bytes = 0;
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return { deleted, bytes };

  // Ambil ukuran sebelum remove agar laporan cleanup tetap berguna.
  const { data: objects } = await admin
    .schema("storage")
    .from("objects")
    .select("name,metadata")
    .eq("bucket_id", bucket)
    .in("name", unique.slice(0, 1000));
  for (const row of objects || []) bytes += Number(row?.metadata?.size || 0);

  for (const batch of chunks(unique, 500)) {
    const { data, error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw error;
    deleted += Array.isArray(data) ? data.length : batch.length;
  }
  return { deleted, bytes };
}

async function cleanupStore(admin: any, storeId: string, settings: any, triggerSource: string) {
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin
    .from("storage_cleanup_runs")
    .insert({ store_id: storeId, trigger_source: triggerSource, status: "running", started_at: startedAt })
    .select("id")
    .single();
  if (runError) throw runError;

  let objectsDeleted = 0;
  let bytesDeleted = 0;
  const detail: Record<string, unknown> = {};

  try {
    // 1. Foto absensi lama. Record absensi tetap disimpan; hanya proof_path dikosongkan.
    const attendanceCutoff = cutoffIso(Number(settings.attendance_proof_days || 365));
    const { data: attendance, error: attendanceError } = await admin
      .from("attendance")
      .select("id,proof_path,created_at")
      .eq("store_id", storeId)
      .not("proof_path", "is", null)
      .lt("created_at", attendanceCutoff)
      .limit(5000);
    if (attendanceError) throw attendanceError;
    const attendancePaths = (attendance || []).map((r: any) => String(r.proof_path || "")).filter(Boolean);
    const attendanceRemove = await removeFiles(admin, "ldm-attendance-proofs", attendancePaths);
    objectsDeleted += attendanceRemove.deleted;
    bytesDeleted += attendanceRemove.bytes;
    if ((attendance || []).length) {
      await admin.from("attendance").update({ proof_path: null }).in("id", (attendance || []).map((r: any) => r.id));
    }
    detail.attendance_proofs = { rows: (attendance || []).length, removed: attendanceRemove.deleted };

    // 2. Bukti pengeluaran lama. Data nominal/keterangan tetap dipertahankan.
    const expenseCutoff = cutoffIso(Number(settings.expense_receipt_days || 1095));
    const { data: expenses, error: expenseError } = await admin
      .from("operating_expenses")
      .select("id,receipt_path,created_at")
      .eq("store_id", storeId)
      .not("receipt_path", "is", null)
      .lt("created_at", expenseCutoff)
      .limit(5000);
    if (expenseError) throw expenseError;
    const expensePaths = (expenses || []).map((r: any) => String(r.receipt_path || "")).filter(Boolean);
    const expenseRemove = await removeFiles(admin, "ldm-expense-receipts", expensePaths);
    objectsDeleted += expenseRemove.deleted;
    bytesDeleted += expenseRemove.bytes;
    if ((expenses || []).length) {
      await admin.from("operating_expenses")
        .update({ receipt_path: null, receipt_name: null, receipt_original_size: 0 })
        .in("id", (expenses || []).map((r: any) => r.id));
    }
    detail.expense_receipts = { rows: (expenses || []).length, removed: expenseRemove.deleted };

    // 3. Gambar produk yatim / versi lama. File aktif yang masih direferensikan image_path tidak dihapus.
    const orphanCutoff = cutoffIso(Number(settings.orphan_product_image_days || 30));
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("image_path")
      .eq("store_id", storeId)
      .not("image_path", "is", null);
    if (productsError) throw productsError;
    const activePaths = new Set((products || []).map((r: any) => String(r.image_path || "")).filter(Boolean));

    const { data: objects, error: objectsError } = await admin
      .schema("storage")
      .from("objects")
      .select("name,created_at,metadata")
      .eq("bucket_id", "ldm-product-images")
      .like("name", `${storeId}/%`)
      .lt("created_at", orphanCutoff)
      .limit(10000);
    if (objectsError) throw objectsError;

    const orphanRows = (objects || []).filter((row: any) => !activePaths.has(String(row.name || "")));
    const orphanPaths = orphanRows.map((r: any) => String(r.name || "")).filter(Boolean);
    const orphanRemove = await removeFiles(admin, "ldm-product-images", orphanPaths);
    objectsDeleted += orphanRemove.deleted;
    bytesDeleted += orphanRemove.bytes;
    detail.orphan_product_images = { candidates: orphanPaths.length, removed: orphanRemove.deleted };

    // 4. Audit DB dibersihkan melalui fungsi yang sama dengan Cron SQL.
    const { data: dbResult, error: dbError } = await admin.rpc("ldm_cleanup_database_retention_store", { p_store_id: storeId });
    if (dbError) throw dbError;
    const dbDeleted = Number(dbResult?.database_rows_deleted || 0);
    detail.database = dbResult || {};

    await admin.from("storage_cleanup_runs").update({
      finished_at: new Date().toISOString(),
      status: "success",
      database_rows_deleted: dbDeleted,
      storage_objects_deleted: objectsDeleted,
      storage_bytes_deleted: bytesDeleted,
      detail,
    }).eq("id", run.id);

    return { store_id: storeId, status: "success", database_rows_deleted: dbDeleted, storage_objects_deleted: objectsDeleted, storage_bytes_deleted: bytesDeleted, detail };
  } catch (error) {
    await admin.from("storage_cleanup_runs").update({
      finished_at: new Date().toISOString(),
      status: "failed",
      storage_objects_deleted: objectsDeleted,
      storage_bytes_deleted: bytesDeleted,
      detail,
      error_message: error instanceof Error ? error.message : String(error),
    }).eq("id", run.id);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = env("LDM_STORAGE_CRON_SECRET");
  if (!url || !serviceKey) return json({ error: "SUPABASE_URL / SERVICE_ROLE_KEY belum tersedia." }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const headerSecret = req.headers.get("x-ldm-cron-secret") || "";
  const cronMode = Boolean(cronSecret && headerSecret && headerSecret === cronSecret);
  const authHeader = req.headers.get("Authorization") || "";
  let storeIds: string[] = [];
  let triggerSource = cronMode ? "cron" : "manual";

  try {
    if (cronMode) {
      const { data, error } = await admin
        .from("data_retention_settings")
        .select("store_id")
        .eq("enabled", true);
      if (error) throw error;
      storeIds = (data || []).map((r: any) => String(r.store_id));
    } else {
      if (!anonKey || !authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Session Owner/Admin wajib tersedia." }, 401);
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: ctxData, error: ctxError } = await userClient.rpc("ldm_my_context");
      if (ctxError) throw ctxError;
      const ctx = Array.isArray(ctxData) ? ctxData[0] : ctxData;
      const role = String(ctx?.role || "").toLowerCase();
      if (!ctx?.store_id || !["owner", "admin"].includes(role)) return json({ error: "Akses hanya Owner/Admin." }, 403);
      storeIds = [String(ctx.store_id)];
    }

    const results = [];
    for (const storeId of storeIds) {
      let { data: settings } = await admin.from("data_retention_settings").select("*").eq("store_id", storeId).maybeSingle();
      if (!settings) {
        const inserted = await admin.from("data_retention_settings").insert({ store_id: storeId }).select("*").single();
        if (inserted.error) throw inserted.error;
        settings = inserted.data;
      }
      if (settings.enabled !== true) {
        results.push({ store_id: storeId, status: "skipped_disabled" });
        continue;
      }
      results.push(await cleanupStore(admin, storeId, settings, triggerSource));
    }
    return json({ ok: true, trigger: triggerSource, stores: results.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

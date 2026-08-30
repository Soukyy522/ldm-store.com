import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getNamedKey(envName: string, fallbackName: string) {
  const direct = Deno.env.get(fallbackName);
  if (direct) return direct;
  const raw = Deno.env.get(envName);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = getNamedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = getNamedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";

    if (!url || !publishableKey || !secretKey) {
      return json({ error: "Edge Function secret environment belum lengkap." }, 500);
    }
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Auth session wajib tersedia." }, 401);
    }

    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Session Owner tidak valid." }, 401);

    const actor = userData.user;
    const { data: ctxData, error: ctxError } = await userClient.rpc("ldm_my_context");
    if (ctxError) throw ctxError;
    const ctx = Array.isArray(ctxData) ? ctxData[0] : ctxData;
    if (!ctx || String(ctx.role || "").toLowerCase() !== "owner") {
      return json({ error: "Hanya Owner yang dapat mengelola Auth User." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").toLowerCase();

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const username = String(body.username || "").trim();
      const displayName = String(body.display_name || username).trim() || username;
      const role = String(body.role || "kasir").trim().toLowerCase();

      if (!email || !email.includes("@")) return json({ error: "Email tidak valid." }, 400);
      if (password.length < 8) return json({ error: "Password minimal 8 karakter." }, 400);
      if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
        return json({ error: "Username harus 3-50 karakter: huruf, angka, titik, underscore, atau strip." }, 400);
      }
      if (!["owner", "admin", "kasir"].includes(role)) return json({ error: "Role tidak valid." }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, display_name: displayName, ldm_role: role },
      });
      if (createError || !created.user) throw createError || new Error("Auth User gagal dibuat.");

      const newUserId = created.user.id;
      const { error: profileError } = await admin.from("profiles").insert({
        id: newUserId,
        store_id: ctx.store_id,
        username,
        display_name: displayName,
        role,
        active: true,
      });

      if (profileError) {
        await admin.auth.admin.deleteUser(newUserId).catch(() => undefined);
        throw profileError;
      }

      return json({
        ok: true,
        mode: "created",
        user_id: newUserId,
        email,
        username,
        role,
      });
    }

    if (action === "reactivate") {
      const targetUserId = String(body.user_id || "").trim();
      if (!targetUserId) return json({ error: "user_id wajib diisi." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id,store_id,username,display_name,role,active,deleted_at,deleted_by")
        .eq("id", targetUserId)
        .eq("store_id", ctx.store_id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Profile target tidak ditemukan pada store ini." }, 404);
      if (!target.deleted_at) {
        return json({ error: "Akun ini tidak berada dalam arsip akun yang dihapus." }, 409);
      }

      const { data: authTarget, error: authTargetError } =
        await admin.auth.admin.getUserById(targetUserId);
      if (authTargetError || !authTarget?.user) {
        return json({ error: "Auth User akun ini sudah tidak tersedia dan tidak dapat direaktivasi." }, 409);
      }

      const { error: profileReactivateError } = await admin
        .from("profiles")
        .update({ active: true, deleted_at: null, deleted_by: null })
        .eq("id", targetUserId)
        .eq("store_id", ctx.store_id);
      if (profileReactivateError) {
        if (profileReactivateError.code === "23505") {
          return json({
            error: `Username ${target.username} sudah dipakai akun aktif lain. Ubah username akun lain terlebih dahulu.`,
          }, 409);
        }
        throw profileReactivateError;
      }

      const now = new Date().toISOString();
      const existingMeta = authTarget.user.user_metadata || {};
      const { error: authReactivateError } = await admin.auth.admin.updateUserById(
        targetUserId,
        {
          ban_duration: "none",
          user_metadata: {
            ...existingMeta,
            ldm_disabled: false,
            ldm_disabled_at: null,
            ldm_reactivated_at: now,
            ldm_reactivated_by: actor.id,
          },
        },
      );

      if (authReactivateError) {
        await admin
          .from("profiles")
          .update({
            active: target.active,
            deleted_at: target.deleted_at,
            deleted_by: target.deleted_by,
          })
          .eq("id", targetUserId)
          .eq("store_id", ctx.store_id);
        throw authReactivateError;
      }

      return json({
        ok: true,
        mode: "reactivated_preserved_history",
        user_id: targetUserId,
        username: target.username,
        role: target.role,
        devices_require_owner_approval: true,
      });
    }

    if (action === "delete") {
      const targetUserId = String(body.user_id || "").trim();
      if (!targetUserId) return json({ error: "user_id wajib diisi." }, 400);
      if (targetUserId === actor.id) return json({ error: "Owner yang sedang login tidak dapat menghapus dirinya sendiri." }, 400);

      const { data: safety, error: safetyError } = await userClient.rpc(
        "ldm_account_delete_safety",
        { p_user_id: targetUserId },
      );
      if (safetyError) throw safetyError;

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id,store_id,username,display_name,role,active")
        .eq("id", targetUserId)
        .eq("store_id", ctx.store_id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Profile target tidak ditemukan pada store ini." }, 404);

      if (safety?.can_hard_delete === true) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId, false);
        if (!deleteError) {
          return json({ ok: true, mode: "hard_deleted", user_id: targetUserId, username: target.username });
        }
        // Storage ownership or another server-side restriction may still block hard deletion.
      }

      const now = new Date().toISOString();
      const { error: profileDisableError } = await admin
        .from("profiles")
        .update({ active: false, deleted_at: now, deleted_by: actor.id })
        .eq("id", targetUserId)
        .eq("store_id", ctx.store_id);
      if (profileDisableError) throw profileDisableError;

      await admin
        .from("devices")
        .update({ status: "revoked", group_id: null })
        .eq("user_id", targetUserId)
        .eq("store_id", ctx.store_id);

      const { data: authTarget } = await admin.auth.admin.getUserById(targetUserId);
      const existingMeta = authTarget?.user?.user_metadata || {};
      await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: "876000h",
        user_metadata: { ...existingMeta, ldm_disabled: true, ldm_disabled_at: now },
      });

      return json({
        ok: true,
        mode: "disabled_preserved_history",
        user_id: targetUserId,
        username: target.username,
        blockers: safety?.blockers || [],
      });
    }

    return json({ error: "Action tidak dikenal." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || String(error) }, 500);
  }
});

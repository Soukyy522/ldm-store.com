(function(){
    "use strict";

    const CHANNEL = "ldm-production-audit-v13";
    let channel = null;

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function context(){
        if(!window.LDMCloudSession){
            throw new Error("Cloud Session belum tersedia.");
        }
        return await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }

    async function health(){
        const ctx = await context();
        const role = String(ctx.profile.role || "").toLowerCase();
        if(!["owner","admin"].includes(role)){
            throw new Error("Health Check hanya untuk Owner/Admin.");
        }
        const {data,error} = await client().rpc("ldm_system_health");
        if(error) throw error;
        return data;
    }

    async function recentAudit(limit = 100){
        const ctx = await context();
        const role = String(ctx.profile.role || "").toLowerCase();
        if(!["owner","admin"].includes(role)){
            throw new Error("Audit Trail hanya untuk Owner/Admin.");
        }
        const safeLimit = Math.max(1, Math.min(Number(limit)||100, 500));
        const {data,error} = await client()
            .from("audit_events")
            .select("id,actor_username,actor_role,entity_type,entity_id,action,business_date,details,created_at")
            .order("created_at", {ascending:false})
            .limit(safeLimit);
        if(error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function getSnapshot(){
        const ctx = await context();
        if(String(ctx.profile.role || "").toLowerCase() !== "owner"){
            throw new Error("Cloud Snapshot hanya untuk Owner.");
        }
        const {data,error} = await client().rpc("ldm_export_store_snapshot");
        if(error) throw error;
        return data;
    }

    function safeName(value){
        return String(value || "LocDailyMar")
            .replace(/[^a-zA-Z0-9._-]+/g,"-")
            .replace(/-+/g,"-")
            .replace(/^-|-$/g,"") || "LocDailyMar";
    }

    function downloadJSON(payload, filename){
        const text = JSON.stringify(payload, null, 2);
        const blob = new Blob([text], {type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
        return {bytes:new Blob([text]).size, textLength:text.length};
    }

    async function exportSnapshot(){
        const payload = await getSnapshot();
        const date = new Date().toISOString().replace(/[:.]/g,"-");
        const storeCode = safeName(payload && payload.store && payload.store.code);
        const filename = `LocDailyMar-Cloud-Snapshot-${storeCode}-${date}.json`;
        const info = downloadJSON(payload, filename);
        return {payload, filename, ...info};
    }

    async function startRealtime(callback){
        if(channel) return channel;
        const ctx = await context();
        const storeId = ctx.profile.store_id;
        channel = client()
            .channel(CHANNEL)
            .on("postgres_changes", {
                event:"INSERT",
                schema:"public",
                table:"audit_events",
                filter:`store_id=eq.${storeId}`
            }, payload => {
                if(typeof callback === "function") callback(payload);
            })
            .subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel) return;
        try{ await client().removeChannel(channel); }
        finally{ channel = null; }
    }

    window.LDMProduction = Object.freeze({
        health,
        recentAudit,
        getSnapshot,
        exportSnapshot,
        startRealtime,
        stopRealtime
    });
})();

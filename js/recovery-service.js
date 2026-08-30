(function(){
    "use strict";

    const VERSION="17.0.0";
    let channel=null;

    function client(){
        if(!window.LDMSupabase) throw new Error("Supabase client belum tersedia.");
        return window.LDMSupabase.createClient();
    }

    async function context(){
        if(!window.LDMCloudSession) throw new Error("Cloud Session belum tersedia.");
        return window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }

    async function listCloud(options={}){
        const current=await context();
        let query=client().from("sync_conflicts").select("id,store_id,user_id,device_id,client_device_id,queue_id,client_transaction_id,conflict_type,status,error_message,queued_at,display_snapshot,attempt_count,first_seen_at,last_seen_at,resolution_action,resolution_note,resolved_at,resolved_by,cloud_transaction_id").order("last_seen_at",{ascending:false}).limit(Number(options.limit)||200);
        if(options.status && options.status!=="all") query=query.eq("status",options.status);
        const {data,error}=await query;
        if(error) throw error;
        return {context:current,rows:Array.isArray(data)?data:[]};
    }

    async function action(conflictId,actionName,note=""){
        await context();
        const {data,error}=await client().rpc("ldm_sync_conflict_action",{
            p_conflict_id:conflictId,
            p_action:String(actionName||"").toLowerCase(),
            p_note:String(note||"").trim() || null
        });
        if(error) throw error;
        return data;
    }

    async function processRetryRequest(row){
        if(!row || row.status!=="retry_requested" || !window.LDMOfflineQueue) return {ok:false,reason:"not-applicable"};
        const identity=window.LDMCloudSession.getCachedIdentity();
        const currentDevice=window.LDMCloudAuth && window.LDMCloudAuth.getOrCreateDeviceId();
        if(String(row.user_id)!==String(identity.userId||"") || String(row.client_device_id)!==String(currentDevice||"")) return {ok:false,reason:"different-identity"};
        try{
            await window.LDMOfflineQueue.retryByClientTransactionId(row.client_transaction_id,{sync:true,skipCloudAction:true});
            return {ok:true};
        }catch(error){
            console.warn("Recovery retry belum berhasil:",error);
            return {ok:false,reason:error.message||String(error)};
        }
    }

    async function processRemoteDiscard(row){
        if(!row || row.status!=="discarded" || !window.LDMOfflineQueue) return {ok:false,reason:"not-applicable"};
        const identity=window.LDMCloudSession.getCachedIdentity();
        const currentDevice=window.LDMCloudAuth && window.LDMCloudAuth.getOrCreateDeviceId();
        if(String(row.user_id)!==String(identity.userId||"") || String(row.client_device_id)!==String(currentDevice||"")) return {ok:false,reason:"different-identity"};
        return window.LDMOfflineQueue.applyRemoteDiscard(row.client_transaction_id,row.resolution_note);
    }

    async function processPendingRetryRequests(){
        const result=await listCloud({status:"retry_requested"});
        const outputs=[];
        for(const row of result.rows) outputs.push(await processRetryRequest(row));
        return outputs;
    }

    async function processRemoteDecisions(){
        const result=await listCloud({status:"all"});
        const outputs=[];
        for(const row of result.rows){
            if(row.status==="retry_requested") outputs.push(await processRetryRequest(row));
            if(row.status==="discarded") outputs.push(await processRemoteDiscard(row));
        }
        return outputs;
    }

    async function subscribe(callback){
        if(channel) return channel;
        const current=await context();
        const storeId=current.profile.store_id;
        channel=client().channel(`ldm-recovery-v17-${storeId}`)
            .on("postgres_changes",{event:"*",schema:"public",table:"sync_conflicts",filter:`store_id=eq.${storeId}`},async payload=>{
                const row=payload.new||payload.old||{};
                if(row.status==="retry_requested") await processRetryRequest(row);
                if(row.status==="discarded") await processRemoteDiscard(row);
                if(typeof callback==="function") callback(payload);
                window.dispatchEvent(new CustomEvent("ldm-recovery-updated",{detail:payload}));
            })
            .subscribe();
        return channel;
    }

    async function unsubscribe(){
        if(!channel) return;
        await client().removeChannel(channel);
        channel=null;
    }

    function boot(){
        const page=String(location.pathname.split("/").pop()||"").toLowerCase();
        if(!["kasir.html","recovery-center.html"].includes(page)) return;
        const start=()=>{
            subscribe().then(()=>processRemoteDecisions()).catch(error=>{
                if(navigator.onLine) console.warn("Recovery Center Realtime belum aktif:",error);
            });
        };
        if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start,{once:true});
        else start();
    }

    window.LDMRecovery=Object.freeze({version:VERSION,listCloud,action,subscribe,unsubscribe,processRetryRequest,processRemoteDiscard,processPendingRetryRequests,processRemoteDecisions});
    boot();
})();

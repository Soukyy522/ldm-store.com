(function(){
    "use strict";

    const VERSION = "27.9.0-commercial02-onboarding1";

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function ownerContext(){
        if(!window.LDMCloudSession || typeof window.LDMCloudSession.ensureAuthenticated !== "function"){
            throw new Error("Cloud Session belum tersedia.");
        }
        const context = await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        const role = String(context?.profile?.role || "").trim().toLowerCase();
        if(role !== "owner"){
            throw new Error("Setup Awal hanya dapat dikelola Owner.");
        }
        return context;
    }

    async function rpc(name, args){
        await ownerContext();
        const supabase = client();
        const {data,error} = await supabase.rpc(name,args || {});
        if(error) throw error;
        return data || {};
    }

    async function status(){
        return rpc("ldm_onboarding_status");
    }

    async function updateStore({name,timezone}){
        const result = await rpc("ldm_onboarding_update_store",{
            p_name:String(name || "").trim(),
            p_timezone:String(timezone || "Asia/Makassar").trim()
        });
        const store = result?.store || {};
        if(store.name) localStorage.setItem("ldmCloudStoreName",String(store.name));
        document.querySelectorAll("[data-ldm-store-name]").forEach(node=>{node.textContent=String(store.name||"")});
        window.dispatchEvent(new CustomEvent("ldm-onboarding-updated",{detail:result}));
        return result;
    }

    async function setMode(mode){
        const normalized=String(mode||"").trim().toLowerCase();
        const result = await rpc("ldm_onboarding_set_mode",{p_mode:normalized});
        try{
            if(window.LDMStoreMode && typeof window.LDMStoreMode.refreshFromCloud === "function"){
                await window.LDMStoreMode.refreshFromCloud({silent:true});
            }else{
                localStorage.setItem("ldmStoreOperationalMode",normalized);
            }
        }catch(_ignored){
            localStorage.setItem("ldmStoreOperationalMode",normalized);
        }
        window.dispatchEvent(new CustomEvent("ldm-onboarding-updated",{detail:result}));
        return result;
    }

    async function markStep(step, skipped){
        const result = await rpc("ldm_onboarding_mark_step",{
            p_step:String(step||"").trim().toLowerCase(),
            p_skipped:Boolean(skipped)
        });
        window.dispatchEvent(new CustomEvent("ldm-onboarding-updated",{detail:result}));
        return result;
    }

    async function complete(){
        const result = await rpc("ldm_onboarding_complete");
        window.dispatchEvent(new CustomEvent("ldm-onboarding-completed",{detail:result}));
        window.dispatchEvent(new CustomEvent("ldm-onboarding-updated",{detail:result}));
        return result;
    }

    async function reset(){
        const result = await rpc("ldm_onboarding_reset");
        window.dispatchEvent(new CustomEvent("ldm-onboarding-updated",{detail:result}));
        return result;
    }

    function deviceCapabilities(){
        const ua=String(navigator.userAgent||"");
        return {
            online:navigator.onLine !== false,
            print:typeof window.print === "function",
            camera:Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            clipboard:Boolean(navigator.clipboard && navigator.clipboard.writeText),
            serviceWorker:"serviceWorker" in navigator,
            browser:ua.slice(0,180),
            platform:String(navigator.platform||"").slice(0,80)
        };
    }

    window.LDMOnboarding=Object.freeze({
        VERSION,
        ownerContext,
        status,
        updateStore,
        setMode,
        markStep,
        complete,
        reset,
        deviceCapabilities
    });
})();

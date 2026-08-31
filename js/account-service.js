(function(){
    "use strict";

    const CHANNEL_NAME = "ldm-cloud-accounts-v15";
    let channel = null;

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function functionErrorMessage(error,fallback){
        if(error && error.context){
            try{
                const response=typeof error.context.clone==="function"
                    ? error.context.clone()
                    : error.context;
                const payload=await response.json();
                if(payload && (payload.error || payload.message)){
                    return String(payload.error || payload.message);
                }
            }catch(_ignored){}
        }
        return String(error && error.message || fallback);
    }

    async function accountContext(){
        if(!window.LDMCloudSession){
            throw new Error("Cloud Session belum tersedia.");
        }
        const context = await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        const role = String(context.profile.role || "").toLowerCase();
        if(!["owner","admin","kasir"].includes(role)){
            throw new Error("Role akun cloud tidak valid.");
        }
        return context;
    }

    async function ownerContext(){
        const context = await accountContext();
        if(String(context.profile.role || "").toLowerCase() !== "owner"){
            throw new Error("Aksi ini hanya untuk Owner.");
        }
        return context;
    }

    async function listAccounts(){
        await accountContext();
        const {data,error} = await client().rpc("ldm_account_list");
        if(error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function listArchivedAccounts(){
        await ownerContext();
        const {data,error} = await client().rpc("ldm_account_archived_list");
        if(error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function health(){
        await accountContext();
        const {data,error} = await client().rpc("ldm_account_health");
        if(error) throw error;
        return data || {};
    }


    async function invokeAccountAdmin(body){
        await ownerContext();
        const supabase=client();
        let sessionResult=await supabase.auth.getSession();
        let session=sessionResult && sessionResult.data && sessionResult.data.session;
        if(!session){
            const refreshed=await supabase.auth.refreshSession();
            session=refreshed && refreshed.data && refreshed.data.session;
        }
        if(!session || !session.access_token) throw new Error("Session Owner sudah berakhir. Login ulang terlebih dahulu.");
        const cfg=(window.LDMSupabase&&typeof window.LDMSupabase.getConfig==="function")?window.LDMSupabase.getConfig():(window.LDM_SUPABASE_CONFIG||{});
        const base=String(cfg.url||"").replace(/\/$/,"");
        const key=String(cfg.publishableKey||"").trim();
        if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)||!key){
            throw new Error("Konfigurasi Supabase/Edge Function belum lengkap.");
        }
        const endpoint=`${base}/functions/v1/ldm-account-admin`;
        let response;
        try{
            response=await fetch(endpoint,{
                method:"POST",
                cache:"no-store",
                headers:{
                    "Content-Type":"application/json",
                    "Authorization":`Bearer ${session.access_token}`,
                    "apikey":key,
                    "x-client-info":"LocDailyMar/26.3.0"
                },
                body:JSON.stringify(body||{})
            });
        }catch(error){
            throw new Error(`Edge Function ldm-account-admin tidak dapat dijangkau. Pastikan function versi terbaru sudah dideploy dan koneksi internet aktif. Detail: ${error&&error.message?error.message:String(error)}`);
        }
        const text=await response.text();
        let payload={};
        try{payload=text?JSON.parse(text):{}}catch{payload={message:text}}
        if(!response.ok){
            throw new Error(String(payload.error||payload.message||`Edge Function gagal (HTTP ${response.status}).`));
        }
        if(payload&&payload.error)throw new Error(String(payload.error));
        return payload;
    }

    async function setAccountActive(userId,active){
        await ownerContext();
        const {data,error}=await client().rpc("ldm_account_set_active",{
            p_user_id:String(userId||"").trim(),
            p_active:Boolean(active)
        });
        if(error)throw error;
        localStorage.removeItem("ldmAttendanceProfiles");
        window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
        return data||{};
    }

    async function createAccount({email,password,username,displayName,role}){
        const data=await invokeAccountAdmin({
            action:"create",
            email:String(email||"").trim().toLowerCase(),
            password:String(password||""),
            username:String(username||"").trim(),
            display_name:String(displayName||"").trim() || null,
            role:String(role||"kasir").trim().toLowerCase()
        });
        localStorage.removeItem("ldmAttendanceProfiles");
        window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
        return data;
    }

    async function deleteAccount(userId){
        const data=await invokeAccountAdmin({action:"delete",user_id:String(userId||"").trim()});
        localStorage.removeItem("ldmAttendanceProfiles");
        window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
        return data;
    }

    async function reactivateAccount(userId){
        const data=await invokeAccountAdmin({action:"reactivate",user_id:String(userId||"").trim()});
        localStorage.removeItem("ldmAttendanceProfiles");
        window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
        return data;
    }

    async function linkExistingAuth({email,username,displayName,role}){
        await ownerContext();
        const {data,error} = await client().rpc("ldm_account_link_existing_auth",{
            p_email:String(email||"").trim().toLowerCase(),
            p_username:String(username||"").trim(),
            p_display_name:String(displayName||"").trim() || null,
            p_role:String(role||"kasir").trim().toLowerCase()
        });
        if(error) throw error;
        return data;
    }

    async function updateProfile({userId,username,displayName,role,active}){
        const context = await ownerContext();
        const {data,error} = await client().rpc("ldm_account_update_profile",{
            p_user_id:userId,
            p_username:String(username||"").trim(),
            p_display_name:String(displayName||"").trim() || null,
            p_role:String(role||"kasir").trim().toLowerCase(),
            p_active:Boolean(active)
        });
        if(error) throw error;
        if(context.user && context.user.id===userId){
            await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        }
        localStorage.removeItem("ldmAttendanceProfiles");
        return data;
    }

    async function changeOwnPassword(newPassword){
        const password = String(newPassword||"");
        if(password.length<8) throw new Error("Password baru minimal 8 karakter.");
        const {data,error} = await client().auth.updateUser({password});
        if(error) throw error;
        return data;
    }

    function recoveryRedirectURL(){
        return new URL("account-password-reset.html",window.location.href).href;
    }

    async function sendPasswordReset(email){
        await ownerContext();
        const normalized=String(email||"").trim().toLowerCase();
        if(!normalized) throw new Error("Email wajib diisi.");
        const {data,error}=await client().auth.resetPasswordForEmail(normalized,{redirectTo:recoveryRedirectURL()});
        if(error) throw error;
        return data;
    }

    async function startRealtime(callback){
        if(channel) return channel;
        const context=await accountContext();
        const storeId=context.profile.store_id;
        const supabase=client();
        channel=supabase.channel(CHANNEL_NAME).on("postgres_changes",{
            event:"*",schema:"public",table:"profiles",filter:`store_id=eq.${storeId}`
        },payload=>{if(typeof callback==="function") callback(payload)}).subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel)return;
        const supabase=client();
        try{await supabase.removeChannel(channel)}finally{channel=null}
    }

    window.LDMAccounts=Object.freeze({
        accountContext,ownerContext,listAccounts,listArchivedAccounts,health,
        createAccount,deleteAccount,reactivateAccount,setAccountActive,
        linkExistingAuth,updateProfile,changeOwnPassword,sendPasswordReset,
        recoveryRedirectURL,startRealtime,stopRealtime
    });
})();

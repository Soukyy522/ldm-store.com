(function(){
    "use strict";

    const CHANNEL_NAME = "ldm-cloud-accounts-v2829";
    const DEFAULT_TIMEOUT_MS = 15000;
    const CONTEXT_TIMEOUT_MS = 12000;
    let channel = null;

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Layanan Cloud belum siap. Muat ulang aplikasi dan coba kembali.");
        }
        return window.LDMSupabase.createClient();
    }

    function withTimeout(task, ms, message){
        let timer = null;
        return Promise.race([
            Promise.resolve(task),
            new Promise((_, reject)=>{
                timer = window.setTimeout(
                    ()=>reject(new Error(message || "Permintaan terlalu lama diproses.")),
                    Math.max(1000, Number(ms || DEFAULT_TIMEOUT_MS))
                );
            })
        ]).finally(()=>{
            if(timer !== null) window.clearTimeout(timer);
        });
    }

    async function rpc(name, params, label){
        const query = params === undefined
            ? client().rpc(name)
            : client().rpc(name, params);

        const result = await withTimeout(
            query,
            DEFAULT_TIMEOUT_MS,
            `${label || "Data akun"} terlalu lama dimuat. Periksa koneksi lalu coba kembali.`
        );

        if(result && result.error) throw result.error;
        return result ? result.data : null;
    }

    async function invokeAccountAdmin(body){
        if(!window.LDMEdgeFunctionClient || typeof window.LDMEdgeFunctionClient.invoke!=="function"){
            throw new Error("Layanan pengelolaan akun belum siap. Muat ulang aplikasi dan coba kembali.");
        }
        return withTimeout(
            window.LDMEdgeFunctionClient.invoke("ldm-account-admin",{
                body,
                timeoutMs:25000,
                requireAuth:true
            }),
            28000,
            "Layanan pengelolaan akun terlalu lama merespons. Coba kembali."
        );
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
        const message=String(error && error.message || fallback);
        if(/Failed to send a request|Failed to fetch|NetworkError/i.test(message)){
            return "Layanan pengelolaan akun belum dapat dihubungi. Periksa koneksi lalu coba kembali.";
        }
        return message;
    }

    async function accountContext(){
        if(!window.LDMCloudSession || typeof window.LDMCloudSession.ensureAuthenticated !== "function"){
            throw new Error("Sesi akun belum siap. Muat ulang aplikasi dan login kembali.");
        }

        const context = await withTimeout(
            window.LDMCloudSession.ensureAuthenticated({registerDevice:false}),
            CONTEXT_TIMEOUT_MS,
            "Pemeriksaan sesi akun terlalu lama. Muat ulang aplikasi lalu coba kembali."
        );

        const role = String(context?.profile?.role || "").toLowerCase();
        if(!["owner","admin","kasir"].includes(role)){
            throw new Error("Hak akses akun tidak valid.");
        }
        return context;
    }

    async function ownerContext(context){
        const current = context || await accountContext();
        if(String(current?.profile?.role || "").toLowerCase() !== "owner"){
            throw new Error("Aksi ini hanya untuk Owner.");
        }
        return current;
    }

    async function listAccounts(context){
        if(!context) await accountContext();
        const data = await rpc("ldm_account_list", undefined, "Daftar akun");
        return Array.isArray(data) ? data : [];
    }

    async function listArchivedAccounts(context){
        await ownerContext(context);
        const data = await rpc("ldm_account_archived_list", undefined, "Daftar akun dinonaktifkan");
        return Array.isArray(data) ? data : [];
    }

    async function health(context){
        if(!context) await accountContext();
        const data = await rpc("ldm_account_health", undefined, "Ringkasan akun");
        return data || {};
    }

    async function createAccount({email,password,username,displayName,role}){
        await ownerContext();
        try{
            const data = await invokeAccountAdmin({
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
        }catch(error){
            throw new Error(await functionErrorMessage(error,"Akun gagal dibuat."));
        }
    }

    async function deleteAccount(userId){
        await ownerContext();
        try{
            const data = await invokeAccountAdmin({action:"delete",user_id:userId});
            localStorage.removeItem("ldmAttendanceProfiles");
            window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
            return data;
        }catch(error){
            throw new Error(await functionErrorMessage(error,"Akun gagal dihapus."));
        }
    }

    async function reactivateAccount(userId){
        await ownerContext();
        try{
            const data = await invokeAccountAdmin({
                action:"reactivate",
                user_id:String(userId||"").trim()
            });
            localStorage.removeItem("ldmAttendanceProfiles");
            window.dispatchEvent(new CustomEvent("ldm-cloud-accounts-updated"));
            return data;
        }catch(error){
            throw new Error(await functionErrorMessage(error,"Akun gagal diaktifkan kembali."));
        }
    }

    async function linkExistingAuth({email,username,displayName,role}){
        await ownerContext();
        return rpc("ldm_account_link_existing_auth",{
            p_email:String(email||"").trim().toLowerCase(),
            p_username:String(username||"").trim(),
            p_display_name:String(displayName||"").trim() || null,
            p_role:String(role||"kasir").trim().toLowerCase()
        },"Penautan akun");
    }

    async function updateProfile({userId,username,displayName,role,active}){
        const context = await ownerContext();
        const data = await rpc("ldm_account_update_profile",{
            p_user_id:userId,
            p_username:String(username||"").trim(),
            p_display_name:String(displayName||"").trim() || null,
            p_role:String(role||"kasir").trim().toLowerCase(),
            p_active:Boolean(active)
        },"Pembaruan akun");

        if(context.user && context.user.id===userId){
            await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        }
        localStorage.removeItem("ldmAttendanceProfiles");
        return data;
    }

    async function changeOwnPassword(newPassword){
        const password = String(newPassword||"");
        if(password.length<8) throw new Error("Password baru minimal 8 karakter.");

        const result = await withTimeout(
            client().auth.updateUser({password}),
            DEFAULT_TIMEOUT_MS,
            "Perubahan password terlalu lama diproses."
        );
        if(result?.error) throw result.error;
        return result?.data;
    }

    function recoveryRedirectURL(){
        return new URL("account-password-reset.html",window.location.href).href;
    }

    async function sendPasswordReset(email){
        await ownerContext();
        const normalized=String(email||"").trim().toLowerCase();
        if(!normalized) throw new Error("Email wajib diisi.");

        const result=await withTimeout(
            client().auth.resetPasswordForEmail(normalized,{
                redirectTo:recoveryRedirectURL()
            }),
            DEFAULT_TIMEOUT_MS,
            "Permintaan reset password terlalu lama diproses."
        );
        if(result?.error) throw result.error;
        return result?.data;
    }

    async function startRealtime(callback, context){
        if(channel) return channel;

        const current=context || await accountContext();
        const storeId=current.profile.store_id;
        const supabase=client();

        channel=supabase.channel(CHANNEL_NAME).on("postgres_changes",{
            event:"*",
            schema:"public",
            table:"profiles",
            filter:`store_id=eq.${storeId}`
        },payload=>{
            if(typeof callback==="function") callback(payload);
        }).subscribe(status=>{
            window.dispatchEvent(new CustomEvent("ldm-account-realtime-status",{
                detail:{status:String(status||"")}
            }));
        });

        return channel;
    }

    async function stopRealtime(){
        if(!channel)return;
        const supabase=client();
        try{
            await supabase.removeChannel(channel);
        }finally{
            channel=null;
        }
    }

    window.LDMAccounts=Object.freeze({
        accountContext,ownerContext,listAccounts,listArchivedAccounts,health,
        createAccount,deleteAccount,reactivateAccount,
        linkExistingAuth,updateProfile,changeOwnPassword,sendPasswordReset,
        recoveryRedirectURL,startRealtime,stopRealtime,
        withTimeout
    });
})();

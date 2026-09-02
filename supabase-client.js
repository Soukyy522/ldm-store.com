(function(){
    "use strict";

    function getConfig(){
        return window.LDM_SUPABASE_CONFIG || {};
    }

    function isConfigured(){
        const cfg = getConfig();
        return Boolean(
            cfg.url
            && cfg.publishableKey
            && !String(cfg.url).includes("PASTE_")
            && !String(cfg.publishableKey).includes("PASTE_")
        );
    }

    function getOrCreateDeviceHeaderId(){
        const key = "ldmCloudDeviceId";
        let value = localStorage.getItem(key);
        if(value) return value;

        if(window.crypto && typeof window.crypto.randomUUID === "function"){
            value = window.crypto.randomUUID();
        }else{
            const bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            value = Array.from(bytes).map(byte => byte.toString(16).padStart(2,"0")).join("");
        }
        localStorage.setItem(key,value);
        return value;
    }

    function createLdmSupabaseClient(){
        if(!isConfigured()){
            throw new Error(
                "Supabase belum dikonfigurasi. Isi js/supabase-config.js terlebih dahulu."
            );
        }

        if(!window.supabase || typeof window.supabase.createClient !== "function"){
            throw new Error(
                "Library Supabase belum tersedia. Pastikan supabase-js dimuat sebelum js/supabase-client.js."
            );
        }

        if(window.ldmSupabase){
            return window.ldmSupabase;
        }

        const cfg = getConfig();

        window.ldmSupabase = window.supabase.createClient(
            cfg.url,
            cfg.publishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                },
                global: {
                    headers: {
                        "x-ldm-device-id": getOrCreateDeviceHeaderId()
                    }
                }
            }
        );

        return window.ldmSupabase;
    }

    window.LDMSupabase = Object.freeze({
        getConfig,
        isConfigured,
        getOrCreateDeviceHeaderId,
        createClient: createLdmSupabaseClient
    });
})();

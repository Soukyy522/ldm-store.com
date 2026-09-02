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
                }
            }
        );

        return window.ldmSupabase;
    }

    window.LDMSupabase = Object.freeze({
        getConfig,
        isConfigured,
        createClient: createLdmSupabaseClient
    });
})();

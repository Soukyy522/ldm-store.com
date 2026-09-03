(function(){
    "use strict";

    const MODE_KEY = "ldmStoreOperationalMode";
    const STORE_ID_KEY = "ldmCloudStoreId";
    const MODES = Object.freeze({
        cafe: Object.freeze({
            id: "cafe",
            label: "Mode Kafe",
            icon: "☕",
            description: "Menu visual, stok tidak memblokir transaksi, dan indikator stok kritis disederhanakan."
        }),
        warung: Object.freeze({
            id: "warung",
            label: "Mode Warung",
            icon: "🍜",
            description: "Tampilan sederhana untuk barang/menu, transaksi tetap berjalan walau stok sistem habis."
        }),
        retail: Object.freeze({
            id: "retail",
            label: "Mode Toko Ritel",
            icon: "🛒",
            description: "Kontrol stok ketat. Stok habis atau jumlah melebihi stok akan ditolak."
        })
    });

    let currentMode = normalize(localStorage.getItem(MODE_KEY)) || "retail";
    let cloudLoaded = false;

    function normalize(value){
        const v = String(value || "").trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(MODES, v) ? v : null;
    }

    function currentRole(){
        return String(
            localStorage.getItem("userRole") ||
            localStorage.getItem("role") ||
            ""
        ).trim().toLowerCase();
    }

    function currentStoreId(){
        return String(localStorage.getItem(STORE_ID_KEY) || "").trim();
    }

    function applyToDocument(mode){
        if(document.documentElement){
            document.documentElement.dataset.ldmStoreMode = mode;
        }
        if(document.body){
            document.body.dataset.ldmStoreMode = mode;
        }
    }

    function emit(mode, source){
        window.dispatchEvent(new CustomEvent("ldm-store-mode-change", {
            detail: {
                mode,
                config: MODES[mode],
                source: source || "local"
            }
        }));
    }

    function writeLocal(mode, source){
        const normalized = normalize(mode) || "retail";
        const changed = currentMode !== normalized;
        currentMode = normalized;
        localStorage.setItem(MODE_KEY, normalized);
        applyToDocument(normalized);
        if(changed || source === "cloud" || source === "manual"){
            emit(normalized, source);
        }
        return normalized;
    }

    function getMode(){
        return currentMode;
    }

    function getConfig(mode){
        return MODES[normalize(mode) || currentMode] || MODES.retail;
    }

    function isRetail(){
        return currentMode === "retail";
    }

    function isSoftStock(){
        return currentMode === "cafe" || currentMode === "warung";
    }

    function supportsProductImages(){
        return currentMode === "cafe" || currentMode === "warung";
    }

    async function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function refreshFromCloud(options){
        const opts = options || {};
        const storeId = currentStoreId();
        if(!storeId){
            applyToDocument(currentMode);
            return {mode: currentMode, source: "local", skipped: true};
        }

        try{
            const supabase = await client();
            const {data, error} = await supabase
                .from("stores")
                .select("id,operational_mode")
                .eq("id", storeId)
                .maybeSingle();

            if(error) throw error;
            const cloudMode = normalize(data && data.operational_mode);
            if(cloudMode){
                cloudLoaded = true;
                writeLocal(cloudMode, "cloud");
                return {mode: cloudMode, source: "cloud", skipped: false};
            }
        }catch(error){
            if(!opts.silent){
                console.warn("Mode operasional Cloud belum dapat dibaca:", error);
            }
            applyToDocument(currentMode);
            return {mode: currentMode, source: "local", skipped: true, error};
        }

        applyToDocument(currentMode);
        return {mode: currentMode, source: "local", skipped: true};
    }

    async function setMode(mode, options){
        const opts = options || {};
        const normalized = normalize(mode);
        if(!normalized){
            throw new Error("Mode operasional tidak valid.");
        }

        const role = currentRole();
        if(!opts.allowNonOwner && role && role !== "owner"){
            throw new Error("Hanya Owner yang dapat mengubah Mode Operasional toko.");
        }

        const storeId = currentStoreId();
        if(storeId && opts.cloud !== false){
            const supabase = await client();
            const {data, error} = await supabase
                .from("stores")
                .update({operational_mode: normalized})
                .eq("id", storeId)
                .select("operational_mode")
                .maybeSingle();
            if(error) throw error;
            const saved = normalize(data && data.operational_mode) || normalized;
            cloudLoaded = true;
            writeLocal(saved, "manual");
            return saved;
        }

        return writeLocal(normalized, "manual");
    }

    function initialize(){
        applyToDocument(currentMode);
        if(document.readyState === "loading"){
            document.addEventListener("DOMContentLoaded", function(){
                applyToDocument(currentMode);
            }, {once:true});
        }
        window.addEventListener("ldm-cloud-session-ready", function(){
            refreshFromCloud({silent:true});
        });
        window.addEventListener("storage", function(event){
            if(event.key === MODE_KEY){
                writeLocal(event.newValue || "retail", "storage");
            }
        });
    }

    initialize();

    window.LDMStoreMode = Object.freeze({
        MODES,
        MODE_KEY,
        normalize,
        getMode,
        getConfig,
        isRetail,
        isSoftStock,
        supportsProductImages,
        currentRole,
        currentStoreId,
        refreshFromCloud,
        setMode,
        isCloudLoaded: function(){ return cloudLoaded; }
    });
})();

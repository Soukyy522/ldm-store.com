(function(){
    "use strict";

    const APP_VERSION = "27.7.0";
    const SERVICE_WORKER_URL = "./service-worker.js";
    const UNSYNCED_COUNT_KEY = "ldmOfflineUnsyncedCountV16";
    const RESERVATION_KEY = "ldmOfflineStockReservationsV16";
    const CACHE_PREFIX = "ldm-";
    let registration = null;
    let deferredInstallPrompt = null;
    let reloadingForUpdate = false;
    let bootPromise = null;

    const state = {
        supported:"serviceWorker" in navigator, installed:false, installAvailable:false,
        updateAvailable:false, registrationScope:"", workerVersion:"",
        lastCheckedAt:"", message:""
    };

    function isInstalled(){
        return Boolean(
            window.matchMedia && window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true
        );
    }

    function getState(){ return Object.freeze({...state}); }

    function emit(){
        state.installed = isInstalled();
        window.dispatchEvent(new CustomEvent("ldm-pwa-state-changed", {detail:getState()}));
        renderControls();
    }

    function numeric(value){
        const number = Number(value || 0);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function reservationQuantity(){
        try{
            const parsed = JSON.parse(localStorage.getItem(RESERVATION_KEY) || "{}");
            if(!parsed || typeof parsed !== "object") return 0;
            const identity = [
                localStorage.getItem("ldmCloudStoreId") || "",
                localStorage.getItem("ldmCloudUserId") || "",
                localStorage.getItem("ldmCloudDeviceId") || ""
            ].join(":");
            let products = {};
            if(parsed.version === 2 && parsed.identities){
                products = parsed.identities[identity] && parsed.identities[identity].products || {};
            }else if(parsed.identity === identity && parsed.products){
                products = parsed.products;
            }
            return Object.values(products).reduce((total, value) => total + numeric(value), 0);
        }catch(error){ return 0; }
    }

    async function getQueueRisk(){
        let unsynced = numeric(localStorage.getItem(UNSYNCED_COUNT_KEY));
        let source = "localStorage";
        if(window.LDMOfflineQueue && typeof window.LDMOfflineQueue.stats === "function"){
            try{
                const queueStats = await window.LDMOfflineQueue.stats();
                unsynced = numeric(queueStats && queueStats.unsynced);
                source = "IndexedDB";
            }catch(error){ /* Gunakan hitungan cadangan. */ }
        }
        const reservedItems = reservationQuantity();
        return {safe:unsynced === 0 && reservedItems === 0,unsynced,reservedItems,source};
    }

    function watchRegistration(reg){
        registration = reg;
        state.registrationScope = reg.scope || "";
        if(reg.waiting){
            state.updateAvailable = true;
            state.message = "Versi baru siap dipasang.";
        }
        reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            if(!worker) return;
            state.message = "Versi baru sedang diunduh…";
            emit();
            worker.addEventListener("statechange", () => {
                if(worker.state === "installed" && navigator.serviceWorker.controller){
                    state.updateAvailable = true;
                    state.message = "Versi baru siap dipasang.";
                    emit();
                }
            });
        });
        emit();
        return reg;
    }

    async function register(){
        if(bootPromise) return bootPromise;
        bootPromise = (async () => {
            state.installed = isInstalled();
            if(!state.supported || !/^https?:$/.test(location.protocol)){
                state.message = "Service Worker membutuhkan HTTPS atau localhost.";
                emit();
                return null;
            }
            try{
                const reg = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
                    scope:"./",updateViaCache:"none"
                });
                watchRegistration(reg);
                state.message = reg.waiting ? "Versi baru siap dipasang." : "PWA aktif.";
                emit();
                return reg;
            }catch(error){
                state.message = `Pendaftaran PWA gagal: ${error.message || error}`;
                emit();
                console.warn("PWA Manager Tahap 19:", error);
                return null;
            }
        })();
        return bootPromise.finally(() => {
            // Izinkan percobaan ulang jika pendaftaran pertama gagal sementara.
            if(!registration) bootPromise = null;
        });
    }

    async function install(){
        if(isInstalled()) return {ok:true,installed:true,message:"Aplikasi sudah terpasang."};
        if(!deferredInstallPrompt){
            return {ok:false,installed:false,message:"Menu instalasi belum tersedia. Di iPhone/iPad, gunakan Bagikan → Tambahkan ke Layar Utama."};
        }
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        state.installAvailable = false;
        emit();
        return {ok:choice.outcome === "accepted",installed:choice.outcome === "accepted",outcome:choice.outcome};
    }

    async function checkForUpdate(){
        const reg = registration || await register();
        if(!reg) return {ok:false,updateAvailable:false,message:state.message};
        try{
            await reg.update();
            state.lastCheckedAt = new Date().toISOString();
            state.updateAvailable = Boolean(reg.waiting);
            state.message = reg.waiting ? "Versi baru siap dipasang." : "Aplikasi sudah menggunakan versi terbaru.";
            emit();
            return {ok:true,updateAvailable:state.updateAvailable,message:state.message};
        }catch(error){
            state.message = `Pemeriksaan pembaruan gagal: ${error.message || error}`;
            emit();
            return {ok:false,updateAvailable:false,message:state.message};
        }
    }

    async function applyUpdate(){
        const reg = registration || await register();
        if(!reg || !reg.waiting) return {ok:false,reason:"no-update",message:"Belum ada versi baru yang menunggu."};
        const risk = await getQueueRisk();
        if(!risk.safe){
            const message = `Pembaruan ditunda: masih ada ${risk.unsynced} antrean transaksi atau ${risk.reservedItems} reservasi stok lokal. Sambungkan internet dan sinkronkan terlebih dahulu.`;
            state.message = message;
            emit();
            return {ok:false,reason:"queue-not-empty",risk,message};
        }
        state.message = "Menerapkan versi baru…";
        emit();
        reg.waiting.postMessage({type:"LDM_SKIP_WAITING"});
        return {ok:true,message:state.message};
    }

    async function getStorageInfo(){
        const info = {supported:false,usage:0,quota:0,persisted:null};
        if(!navigator.storage) return info;
        info.supported = true;
        if(typeof navigator.storage.estimate === "function"){
            const estimate = await navigator.storage.estimate();
            info.usage = numeric(estimate.usage);
            info.quota = numeric(estimate.quota);
        }
        if(typeof navigator.storage.persisted === "function") info.persisted = await navigator.storage.persisted();
        return info;
    }

    async function requestPersistentStorage(){
        if(!navigator.storage || typeof navigator.storage.persist !== "function"){
            return {ok:false,persisted:false,message:"Browser tidak menyediakan fitur penyimpanan persisten."};
        }
        const persisted = await navigator.storage.persist();
        return {ok:persisted,persisted,message:persisted ? "Penyimpanan persisten diizinkan." : "Browser belum memberikan izin penyimpanan persisten."};
    }

    async function clearCachesSafely(){
        if(!navigator.onLine) return {ok:false,reason:"offline",message:"Cache tidak dibersihkan saat perangkat offline."};
        const risk = await getQueueRisk();
        if(!risk.safe) return {ok:false,reason:"queue-not-empty",risk,message:"Cache tidak dibersihkan karena masih ada data offline yang belum sinkron."};
        const keys = await caches.keys();
        // App shell dipertahankan agar Kasir/fallback tetap siap offline.
        const targets = keys.filter(key => key.startsWith(CACHE_PREFIX) && key.includes("-runtime-"));
        await Promise.all(targets.map(key => caches.delete(key)));
        let localCompacted = false;
        if(window.LDMStorage && typeof window.LDMStorage.reclaimSpace === "function"){
            try{ localCompacted = window.LDMStorage.reclaimSpace() === true; }catch(error){}
        }
        return {ok:true,deleted:targets,localCompacted,message:`${targets.length} runtime cache dibersihkan${localCompacted?" dan cache localStorage lama diperkecil":""}. App shell, IndexedDB, dan transaksi offline tidak dihapus.`};
    }

    function ensureStyle(){
        if(document.getElementById("ldmPwaManagerStyle")) return;
        const style = document.createElement("style");
        style.id = "ldmPwaManagerStyle";
        style.textContent = ".ldm-pwa-chip{position:fixed;left:16px;bottom:16px;z-index:99990;border:0;border-radius:999px;padding:11px 16px;background:#0f9d58;color:#fff;font:700 13px system-ui;box-shadow:0 8px 24px #0003;cursor:pointer}.ldm-pwa-update{position:fixed;left:16px;right:16px;bottom:16px;z-index:99991;max-width:760px;margin:auto;padding:14px 16px;border-radius:14px;background:#0d2240;color:#fff;box-shadow:0 10px 30px #0005;display:flex;align-items:center;gap:12px;font:600 13px system-ui}.ldm-pwa-update span{flex:1}.ldm-pwa-update button{border:0;border-radius:9px;padding:9px 13px;background:#ffc107;color:#0d2240;font-weight:800;cursor:pointer}.ldm-pwa-update .later{background:#ffffff22;color:#fff}";
        document.head.appendChild(style);
    }

    function renderControls(){
        if(!document.body) return;
        ensureStyle();
        document.getElementById("ldmPwaInstallChip")?.remove();
        document.getElementById("ldmPwaUpdateBanner")?.remove();
        if(state.installAvailable && !isInstalled()){
            const button = document.createElement("button");
            button.id = "ldmPwaInstallChip";
            button.className = "ldm-pwa-chip";
            button.type = "button";
            button.textContent = "📲 Pasang Aplikasi";
            button.addEventListener("click", async () => {
                const result = await install();
                if(!result.ok && result.message) alert(result.message);
            });
            document.body.appendChild(button);
        }
        if(state.updateAvailable){
            const banner = document.createElement("div");
            banner.id = "ldmPwaUpdateBanner";
            banner.className = "ldm-pwa-update";
            banner.innerHTML = '<span>Versi baru LocDailyMar tersedia.</span><button type="button" class="later">Nanti</button><button type="button" class="apply">Perbarui</button>';
            banner.querySelector(".later").onclick = () => banner.remove();
            banner.querySelector(".apply").onclick = async event => {
                event.currentTarget.disabled = true;
                const result = await applyUpdate();
                if(!result.ok){ event.currentTarget.disabled = false; alert(result.message); }
            };
            document.body.appendChild(banner);
        }
    }

    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        state.installAvailable = true;
        state.message = "Aplikasi siap dipasang.";
        emit();
    });
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        state.installAvailable = false;
        state.installed = true;
        state.message = "Aplikasi berhasil dipasang.";
        emit();
    });
    if("serviceWorker" in navigator){
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if(reloadingForUpdate) return;
            reloadingForUpdate = true;
            location.reload();
        });
        navigator.serviceWorker.addEventListener("message", event => {
            if(event.data && event.data.type === "LDM_SW_VERSION"){
                state.workerVersion = String(event.data.version || "");
                emit();
            }
        });
    }

    window.LDMPWA = Object.freeze({
        version:APP_VERSION,register,install,checkForUpdate,applyUpdate,getState,
        getStorageInfo,requestPersistentStorage,clearCachesSafely,getQueueRisk,isInstalled
    });

    const start = () => register().then(reg => {
        if(reg && navigator.serviceWorker.controller){
            navigator.serviceWorker.controller.postMessage({type:"LDM_GET_VERSION"});
        }
    });
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true});
    else start();
})();

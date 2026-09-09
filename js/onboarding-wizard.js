(function(){
    "use strict";

    let state=null;
    let selectedMode="retail";
    let loading=false;

    const $=id=>document.getElementById(id);
    const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

    function message(text,type){
        const node=$("setupMessage");
        if(!node)return;
        node.textContent=String(text||"");
        node.className=`setup-message ${type||""}`.trim();
    }

    function setBusy(flag,label){
        loading=Boolean(flag);
        document.querySelectorAll("button[data-setup-action]").forEach(btn=>{btn.disabled=loading});
        const node=$("setupBusy");
        if(node){
            node.hidden=!loading;
            node.textContent=loading ? String(label||"Menyimpan...") : "";
        }
    }

    function modeLabel(mode){
        return mode==="cafe"?"☕ Kafe":mode==="warung"?"🍜 Warung":"🛒 Toko Ritel";
    }

    function stepReady(key){
        return Boolean(state?.steps?.[key]?.ready);
    }

    function stepClass(key){
        return stepReady(key)?"setup-step done":"setup-step";
    }

    function stepBadge(key){
        return stepReady(key)?'<span class="step-status done">✓ Selesai</span>':'<span class="step-status pending">Belum selesai</span>';
    }

    function renderCapabilities(caps){
        const node=$("deviceResult");
        if(!node)return;
        const rows=[
            ["Internet",caps.online?"Tersambung":"Offline",caps.online],
            ["Cetak browser",caps.print?"Tersedia":"Tidak tersedia",caps.print],
            ["Kamera browser",caps.camera?"Didukung":"Tidak terdeteksi",caps.camera],
            ["Service Worker",caps.serviceWorker?"Didukung":"Tidak didukung",caps.serviceWorker],
            ["Clipboard",caps.clipboard?"Didukung":"Terbatas",caps.clipboard]
        ];
        node.innerHTML=rows.map(([name,value,ok])=>`<div class="device-check"><span>${esc(name)}</span><strong class="${ok?'ok':'warn'}">${ok?'✓':'!'} ${esc(value)}</strong></div>`).join("");
        node.hidden=false;
    }

    function render(){
        if(!state)return;
        const store=state.store||{};
        selectedMode=String(store.operational_mode||"retail");

        const progress=Math.max(0,Math.min(100,Number(state.progress_percent||0)));
        $("progressFill").style.width=`${progress}%`;
        $("progressText").textContent=`${Number(state.ready_count||0)} dari ${Number(state.total_steps||6)} langkah · ${progress}%`;
        $("storeContext").textContent=`${store.name||"Toko"} · ${store.code||"-"}`;

        $("storeName").value=store.name||"";
        $("storeCode").value=store.code||"";
        $("storeTimezone").value=store.timezone||"Asia/Makassar";

        document.querySelectorAll("[data-mode]").forEach(card=>{
            card.classList.toggle("selected",card.dataset.mode===selectedMode);
            card.setAttribute("aria-pressed",card.dataset.mode===selectedMode?"true":"false");
        });
        $("selectedModeText").textContent=modeLabel(selectedMode);

        const counts=state.counts||{};
        $("productCount").textContent=String(counts.products||0);
        $("accountCount").textContent=String(counts.accounts||0);
        $("transactionCount").textContent=String(counts.transactions||0);
        $("deviceCount").textContent=String(counts.devices||0);

        const ids={profile:"stepProfile",mode:"stepMode",product:"stepProduct",team:"stepTeam",device:"stepDevice",sale:"stepSale"};
        Object.entries(ids).forEach(([key,id])=>{
            const el=$(id); if(!el)return;
            el.className=stepClass(key);
            const status=el.querySelector("[data-step-status]");
            if(status)status.outerHTML=stepBadge(key).replace('<span ','<span data-step-status ');
        });

        const team=state.steps?.team||{};
        $("teamNote").textContent=team.skipped ? "Langkah tim dilewati untuk sekarang." : (Number(counts.accounts||0)>1 ? "Akun tambahan sudah terdeteksi." : "Saat ini baru terdeteksi akun Owner.");
        const device=state.steps?.device||{};
        const localPeripheral=window.LDMPeripheralSetup?.status?.();
        $("deviceNote").textContent=device.skipped
            ? "Setup perangkat dilewati untuk sekarang."
            : (device.checked
                ? "Printer & Scanner sudah dikonfirmasi pada Setup Awal."
                : (localPeripheral?.complete
                    ? "Perangkat lokal sudah siap. Tekan Tandai Perangkat Siap pada bagian Printer & Scanner untuk menyinkronkan progress Cloud."
                    : "Printer/scanner pada perangkat ini belum selesai disiapkan."));
        const sale=state.steps?.sale||{};
        $("saleNote").textContent=sale.skipped ? "Transaksi pertama dilewati untuk sekarang." : (Number(counts.transactions||0)>0 ? "Transaksi toko sudah terdeteksi." : "Belum ada transaksi pada toko ini.");

        const allReady=Number(state.ready_count||0)>=Number(state.total_steps||6);
        $("btnFinish").disabled=!allReady || Boolean(state.completed) || loading;
        $("btnFinish").textContent=state.completed?"✓ Setup Sudah Selesai":"Selesaikan Setup";
        $("finishHint").textContent=state.completed
            ? `Setup selesai${state.completed_at?` pada ${new Date(state.completed_at).toLocaleString('id-ID')}`:""}.`
            : allReady ? "Semua langkah siap. Simpan penyelesaian setup." : "Selesaikan semua langkah wajib atau gunakan opsi Lewati pada langkah opsional.";

        const legacy=$("legacyBanner");
        if(legacy){
            legacy.hidden=!Boolean(state.legacy_completed);
        }
        const done=$("completedBanner");
        if(done){
            done.hidden=!Boolean(state.completed && !state.legacy_completed);
        }
    }

    async function refresh(silent){
        if(loading)return;
        try{
            if(!silent)message("Memeriksa progress Setup Awal...","");
            state=await window.LDMOnboarding.status();
            render();
            if(!silent)message("Progress berhasil diperbarui.","ok");
        }catch(error){
            console.warn("Setup Awal belum dapat dimuat:",error);
            message((error&&error.message)||"Setup Awal belum dapat dimuat.","error");
            const fatal=$("setupUnavailable");
            if(fatal){
                fatal.hidden=false;
                fatal.innerHTML=`<strong>Setup Awal belum tersedia.</strong><span>${esc((error&&error.message)||"Jalankan SQL-37-ONBOARDING-SETUP-WIZARD.sql pada App Supabase.")}</span>`;
            }
        }
    }

    async function saveProfile(){
        const name=$("storeName").value.trim();
        const timezone=$("storeTimezone").value;
        setBusy(true,"Menyimpan profil toko...");
        try{
            state=await window.LDMOnboarding.updateStore({name,timezone});
            render();
            message("Profil toko disimpan.","ok");
        }catch(error){message(error.message||String(error),"error")}
        finally{setBusy(false);render()}
    }

    async function saveMode(){
        setBusy(true,"Menyimpan mode operasional...");
        try{
            state=await window.LDMOnboarding.setMode(selectedMode);
            render();
            message(`${modeLabel(selectedMode)} disimpan sebagai mode toko.`,"ok");
        }catch(error){message(error.message||String(error),"error")}
        finally{setBusy(false);render()}
    }

    async function mark(step,skipped){
        setBusy(true,skipped?"Menyimpan pilihan Lewati...":"Memeriksa langkah...");
        try{
            state=await window.LDMOnboarding.markStep(step,skipped);
            render();
            message(skipped?"Langkah ditandai Lewati untuk sekarang.":"Langkah berhasil dikonfirmasi.","ok");
        }catch(error){message(error.message||String(error),"error")}
        finally{setBusy(false);render()}
    }

    async function deviceCheck(){
        const caps=window.LDMOnboarding.deviceCapabilities();
        renderCapabilities(caps);
        const peripheral=window.LDMPeripheralSetup?.status?.();
        if(peripheral?.complete){
            message("Browser siap dan konfigurasi printer/scanner lokal sudah selesai. Tekan Tandai Perangkat Siap untuk menyinkronkan progress Cloud.","ok");
        }else{
            message("Pemeriksaan browser selesai. Lanjutkan pengujian printer dan scanner pada bagian yang sama di bawah ini.","ok");
        }
    }

    async function finish(){
        if(!confirm("Tandai Setup Awal toko ini selesai? Progress tetap dapat dilihat kembali dari menu Setup Awal."))return;
        setBusy(true,"Menyelesaikan Setup Awal...");
        try{
            state=await window.LDMOnboarding.complete();
            render();
            message("Setup Awal selesai. Toko siap melanjutkan operasional.","ok");
        }catch(error){message(error.message||String(error),"error")}
        finally{setBusy(false);render()}
    }

    async function reset(){
        if(!confirm("Jalankan ulang checklist Setup Awal? Data barang, akun, dan transaksi TIDAK akan dihapus."))return;
        setBusy(true,"Mengulang checklist...");
        try{
            state=await window.LDMOnboarding.reset();
            render();
            message("Checklist diulang. Data bisnis tetap aman dan akan dideteksi otomatis.","ok");
        }catch(error){message(error.message||String(error),"error")}
        finally{setBusy(false);render()}
    }

    function bind(){
        document.querySelectorAll("[data-mode]").forEach(card=>card.addEventListener("click",()=>{
            selectedMode=card.dataset.mode;
            document.querySelectorAll("[data-mode]").forEach(c=>c.classList.toggle("selected",c===card));
            $("selectedModeText").textContent=modeLabel(selectedMode);
        }));
        $("btnSaveProfile")?.addEventListener("click",saveProfile);
        $("btnSaveMode")?.addEventListener("click",saveMode);
        $("btnRefresh")?.addEventListener("click",()=>refresh(false));
        $("btnSkipTeam")?.addEventListener("click",()=>mark("team",true));
        $("btnDeviceCheck")?.addEventListener("click",deviceCheck);
        $("btnSkipDevice")?.addEventListener("click",()=>mark("device",true));
        $("btnConfirmSale")?.addEventListener("click",()=>mark("sale",false));
        $("btnSkipSale")?.addEventListener("click",()=>mark("sale",true));
        $("btnFinish")?.addEventListener("click",finish);
        $("btnReset")?.addEventListener("click",reset);
        $("btnResetLegacy")?.addEventListener("click",reset);
        window.addEventListener("focus",()=>refresh(true));
        document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh(true)});
        window.addEventListener("ldm-onboarding-updated",event=>{if(event.detail){state=event.detail;render()}});
    }

    async function init(){
        if(!window.LDMOnboarding){message("Modul Setup Awal belum tersedia.","error");return}
        bind();
        try{
            await window.LDMOnboarding.ownerContext();
            await refresh(true);
            message("Setup Awal siap digunakan.","ok");
        }catch(error){
            message(error.message||String(error),"error");
        }
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
    else init();
})();

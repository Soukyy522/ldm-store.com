(function(){
    "use strict";

    const $=id=>document.getElementById(id);
    const fmt=n=>Number(n||0).toLocaleString("id-ID");
    const FUNCTION_NAME="ldm-storage-maintenance";

    function bytes(v){
        let n=Number(v||0);
        if(!n) return "0 B";
        const u=["B","KB","MB","GB","TB"];
        const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),u.length-1);
        return `${(n/Math.pow(1024,i)).toFixed(i?1:0)} ${u[i]}`;
    }

    function log(message,tone="info"){
        const el=$("log");
        if(!el) return;
        el.dataset.tone=tone;
        el.textContent=`${new Date().toLocaleString("id-ID")} · ${message}`;
    }

    function client(){
        if(!window.LDMSupabase) throw new Error("Layanan Cloud belum siap.");
        return window.LDMSupabase.createClient();
    }

    async function ensureSession(){
        if(!window.LDMCloudSession || typeof window.LDMCloudSession.ensureAuthenticated!=="function"){
            throw new Error("Cloud Session belum tersedia.");
        }
        return window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }


    function applyRoleUi(context){
        const role=String(context?.profile?.role||context?.role||"").toLowerCase();
        const canEdit=role==="owner";
        ["retentionEnabled","auditDays","attendanceDays","expenseDays","orphanDays"].forEach(id=>{
            const el=$(id);
            if(el) el.disabled=!canEdit;
        });
        const save=$("saveBtn");
        if(save){
            save.style.display=canEdit?"inline-block":"none";
            save.disabled=!canEdit;
        }
        const schedule=$("scheduleBtn");
        if(schedule){
            schedule.style.display=canEdit?"inline-block":"none";
            schedule.disabled=!canEdit;
        }
        const roleHint=$("policyRoleHint");
        if(roleHint){
            roleHint.textContent=canEdit
                ?"Owner dapat mengubah kebijakan retensi."
                :"Admin dapat melihat kebijakan dan menjalankan cleanup, tetapi perubahan kebijakan hanya dapat dilakukan Owner.";
        }
        return role;
    }

    async function rpc(name,args={}){
        await ensureSession();
        const {data,error}=await client().rpc(name,args);
        if(error) throw error;
        return data;
    }

    function setRuntimeBadge(text,state="neutral"){
        const badge=$("runtimeBadge");
        if(!badge) return;
        badge.textContent=text;
        badge.dataset.state=state;
    }

    function setHealthDetails(items){
        const box=$("healthDetails");
        if(!box) return;
        box.innerHTML=items.map(({label,value,state})=>`<div class="health-row"><span>${label}</span><strong class="${state||""}">${value}</strong></div>`).join("");
    }

    async function edgeInvoke(action){
        await ensureSession();
        if(!window.LDMEdgeFunctionClient || typeof window.LDMEdgeFunctionClient.invoke!=="function"){
            throw new Error("Layanan server belum siap.");
        }
        return window.LDMEdgeFunctionClient.invoke(FUNCTION_NAME,{
            body:{action},
            timeoutMs:30000,
            requireAuth:true
        });
    }

    async function checkHealth({silent=false}={}){
        const button=$("healthBtn");
        if(button) button.disabled=true;
        setRuntimeBadge("Memeriksa…","checking");
        try{
            const sqlHealth=await rpc("ldm_storage_retention_health");
            const edgeHealth=await edgeInvoke("health");
            const buckets=sqlHealth?.buckets||{};
            const allBuckets=Boolean(buckets.product_images&&buckets.attendance_proofs&&buckets.expense_receipts);
            const cronSecretReady=Boolean(edgeHealth?.runtime?.cron_secret_ready);
            const scheduler=sqlHealth?.scheduler||edgeHealth?.scheduler||{};
            const schedulerReady=Boolean(scheduler?.configured&&scheduler?.active);
            const manualReady=Boolean(
                sqlHealth?.cleanup_plan_rpc_ready
                &&sqlHealth?.database_cleanup_rpc_ready
                &&sqlHealth?.settings_rpc_ready
                &&sqlHealth?.overview_rpc_ready
                &&allBuckets
                &&edgeHealth?.ok
            );
            const allReady=Boolean(manualReady&&cronSecretReady&&schedulerReady);

            setRuntimeBadge(
                allReady?"Siap Otomatis":manualReady?"Manual Siap · Auto Belum":"Perlu perhatian",
                allReady?"good":manualReady?"warn":"bad"
            );

            setHealthDetails([
                {label:"Layanan Pembersihan",value:edgeHealth?.version||"Tersambung",state:"good"},
                {label:"Konfigurasi Retensi",value:sqlHealth?.database_cleanup_rpc_ready&&sqlHealth?.settings_rpc_ready&&sqlHealth?.overview_rpc_ready?"Siap":"Belum lengkap",state:sqlHealth?.database_cleanup_rpc_ready&&sqlHealth?.settings_rpc_ready&&sqlHealth?.overview_rpc_ready?"good":"bad"},
                {label:"Cleanup plan",value:sqlHealth?.cleanup_plan_rpc_ready?"Siap":"Belum siap",state:sqlHealth?.cleanup_plan_rpc_ready?"good":"bad"},
                {label:"Penyimpanan File",value:allBuckets?"3/3 tersedia":"Ada ruang penyimpanan file yang belum tersedia",state:allBuckets?"good":"bad"},
                {label:"Kredensial Jadwal",value:cronSecretReady?"Terkonfigurasi":"Belum dikonfigurasi",state:cronSecretReady?"good":"warn"},
                {label:"Scheduler harian",value:schedulerReady?"Aktif":"Belum aktif",state:schedulerReady?"good":"warn"}
            ]);

            const schedStatus=$("schedulerStatus");
            const schedSchedule=$("schedulerSchedule");
            const schedLast=$("schedulerLastRun");
            const schedStore=$("schedulerLastStoreRun");
            if(schedStatus)schedStatus.textContent=schedulerReady?"Aktif":"Belum aktif";
            if(schedStatus)schedStatus.className=schedulerReady?"good":"warn";
            if(schedSchedule)schedSchedule.textContent=scheduler?.schedule_label||scheduler?.schedule||"Belum dijadwalkan";
            if(schedLast)schedLast.textContent=scheduler?.last_cron_started_at
                ?`${new Date(scheduler.last_cron_started_at).toLocaleString("id-ID")} · ${scheduler.last_cron_status||"-"}`
                :"Belum pernah berjalan";
            if(schedStore)schedStore.textContent=scheduler?.last_store_cleanup_at
                ?`${new Date(scheduler.last_store_cleanup_at).toLocaleString("id-ID")} · ${scheduler.last_store_cleanup_status||"-"}`
                :"Belum pernah berjalan";

            if(!silent){
                log(
                    allReady
                        ?"Pembersihan manual dan scheduler otomatis terverifikasi."
                        :manualReady
                            ?"Pembersihan manual siap, tetapi scheduler otomatis belum aktif."
                            :"Kesiapan pembersihan belum lengkap. Periksa rincian di atas.",
                    allReady?"success":"warn"
                );
            }
            return manualReady;
        }catch(error){
            setRuntimeBadge("Tidak tersambung","bad");
            setHealthDetails([{label:"Masalah",value:String(error?.message||error),state:"bad"}]);
            if(!silent) log(`Pemeriksaan gagal: ${error?.message||error}`,"error");
            return false;
        }finally{
            if(button) button.disabled=false;
        }
    }

    async function load(){
        try{
            const context=await ensureSession();
            applyRoleUi(context);
            const [settings,overview]=await Promise.all([
                rpc("ldm_get_retention_settings"),
                rpc("ldm_storage_overview")
            ]);

            $("retentionEnabled").checked=settings.enabled!==false;
            $("auditDays").value=settings.audit_days||180;
            $("attendanceDays").value=settings.attendance_proof_days||365;
            $("expenseDays").value=settings.expense_receipt_days||1095;
            $("orphanDays").value=settings.orphan_product_image_days||30;

            $("storageTotal").textContent=bytes(overview.storage_bytes);
            $("objectCount").textContent=fmt(overview.storage_objects);
            $("productBytes").textContent=bytes(overview.product_image_bytes);
            $("attendanceBytes").textContent=bytes(overview.attendance_proof_bytes);
            $("expenseBytes").textContent=bytes(overview.expense_receipt_bytes);

            const rows=overview.rows||{};
            $("rowsProducts").textContent=fmt(rows.products);
            $("rowsTransactions").textContent=fmt(rows.transactions);
            $("rowsItems").textContent=fmt(rows.transaction_items);
            $("rowsStock").textContent=fmt(rows.stock_movements);
            $("rowsAttendance").textContent=fmt(rows.attendance);
            $("rowsAudit").textContent=fmt(rows.audit_events);

            const mode=window.LDMStoreMode?.getConfig?.()||{icon:"🛒",label:"Mode Toko Ritel"};
            $("storeMode").textContent=`${mode.icon} ${mode.label}`;

            const {data,error}=await client()
                .from("storage_cleanup_runs")
                .select("started_at,trigger_source,status,database_rows_deleted,storage_objects_deleted,storage_bytes_deleted,error_message")
                .order("started_at",{ascending:false})
                .limit(20);
            if(error) throw error;

            $("historyRows").innerHTML=(data||[]).length
                ?(data||[]).map(row=>{
                    const statusClass=row.status==="success"?"good":row.status==="failed"?"bad":"warn";
                    const title=row.error_message?` title="${String(row.error_message).replace(/[&<>\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[ch]))}"`:"";
                    return `<tr><td>${new Date(row.started_at).toLocaleString("id-ID")}</td><td>${row.trigger_source}</td><td class="${statusClass}"${title}>${row.status}</td><td>${fmt(row.database_rows_deleted)}</td><td>${fmt(row.storage_objects_deleted)}</td><td>${bytes(row.storage_bytes_deleted)}</td></tr>`;
                }).join("")
                :'<tr><td colspan="6">Belum ada riwayat cleanup.</td></tr>';

            log("Ringkasan penyimpanan berhasil dimuat.","success");
            checkHealth({silent:true});
        }catch(error){
            log(`Gagal memuat: ${error?.message||error}`,"error");
        }
    }

    async function savePolicy(){
        const button=$("saveBtn");
        button.disabled=true;
        try{
            await rpc("ldm_update_retention_settings",{
                p_enabled:$("retentionEnabled").checked,
                p_audit_days:Number($("auditDays").value),
                p_attendance_proof_days:Number($("attendanceDays").value),
                p_expense_receipt_days:Number($("expenseDays").value),
                p_orphan_product_image_days:Number($("orphanDays").value)
            });
            log("Kebijakan retensi berhasil disimpan.","success");
            await load();
        }catch(error){
            log(`Gagal menyimpan: ${error?.message||error}`,"error");
            alert(error?.message||error);
        }finally{
            button.disabled=false;
        }
    }

    async function configureScheduler(){
        const button=$("scheduleBtn");
        if(button)button.disabled=true;
        log("Mengaktifkan scheduler cleanup otomatis…");
        try{
            await ensureSession();
            if(!window.LDMEdgeFunctionClient || typeof window.LDMEdgeFunctionClient.invoke!=="function"){
                throw new Error("Layanan server belum siap.");
            }

            /*
             * Browser tidak pernah menerima LDM_STORAGE_CRON_SECRET.
             * Konfigurasi scheduler dari UI hanya tersedia jika Edge Function
             * sudah punya secret dan action backend mengizinkan Owner.
             */
            const data=await window.LDMEdgeFunctionClient.invoke(FUNCTION_NAME,{
                body:{action:"configure-auto-cleanup"},
                timeoutMs:30000,
                requireAuth:true
            });

            log(`Scheduler otomatis aktif. ${data?.scheduler?.schedule_label||"Cleanup harian dijadwalkan."}`,"success");
            await checkHealth({silent:false});
        }catch(error){
            const message=String(error?.message||error);
            log(`Scheduler belum dapat diaktifkan: ${message}`,"error");
            alert(
                message+"\n\nKonfigurasi jadwal otomatis belum siap. Hubungi Tim Support untuk menyelesaikan konfigurasi."
            );
        }finally{
            if(button)button.disabled=false;
        }
    }

    async function cleanupNow(){
        const autoEnabled=Boolean($("retentionEnabled")?.checked);
        const autoNote=autoEnabled
            ? ""
            : " Retensi otomatis sedang nonaktif, tetapi pembersihan manual tetap akan memakai batas hari yang tersimpan.";
        if(!confirm(`Jalankan pembersihan sekarang? Data bisnis inti tidak dihapus, tetapi file/data teknis yang sudah melewati batas retensi akan dihapus permanen.${autoNote}`)) return;

        const button=$("cleanupBtn");
        button.disabled=true;
        log("Memeriksa kesiapan layanan pembersihan sebelum proses dimulai…");
        try{
            const ready=await checkHealth({silent:true});
            if(!ready){
                throw new Error("Kesiapan pembersihan belum lengkap. Tekan 'Periksa Kesiapan' dan selesaikan komponen yang ditandai merah.");
            }

            const data=await edgeInvoke("cleanup-current-store");
            const result=Array.isArray(data?.results)?data.results[0]:null;
            log(`Pembersihan selesai. Data teknis: ${fmt(result?.database_rows_deleted)} item, file: ${fmt(result?.storage_objects_deleted)} (${bytes(result?.storage_bytes_deleted)}).`,"success");
            await load();
        }catch(error){
            const message=String(error?.message||error);
            log(`Cleanup gagal: ${message}`,"error");
            alert(message);
        }finally{
            button.disabled=false;
        }
    }

    function bind(){
        $("saveBtn").addEventListener("click",savePolicy);
        $("cleanupBtn").addEventListener("click",cleanupNow);
        $("refreshBtn").addEventListener("click",load);
        $("healthBtn").addEventListener("click",()=>checkHealth({silent:false}));
        $("scheduleBtn")?.addEventListener("click",configureScheduler);
        addEventListener("ldm-store-mode-change",()=>{
            const mode=window.LDMStoreMode?.getConfig?.();
            if(mode) $("storeMode").textContent=`${mode.icon} ${mode.label}`;
        });
    }

    function start(){bind();load();}
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start,{once:true});
    else start();
})();

(function(){
    "use strict";

    const $ = id => document.getElementById(id);
    let currentRows = [];

    function esc(value){
        return String(value == null ? "" : value)
            .replace(/&/g,"&amp;")
            .replace(/</g,"&lt;")
            .replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;")
            .replace(/'/g,"&#039;");
    }

    function fmtDate(value){
        if(!value) return "-";
        const d = new Date(value);
        if(Number.isNaN(d.getTime())) return String(value);
        return new Intl.DateTimeFormat("id-ID",{
            dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Makassar"
        }).format(d);
    }

    function fmtBytes(value){
        const n = Number(value || 0);
        if(!Number.isFinite(n) || n <= 0) return "0 KB";
        const units=["B","KB","MB","GB"];
        let x=n,i=0;
        while(x>=1024 && i<units.length-1){x/=1024;i++}
        return `${x.toFixed(i===0?0:1)} ${units[i]}`;
    }

    function status(text,type){
        const node=$("monitorStatus");
        if(!node)return;
        node.textContent=text||"";
        node.className=`monitor-status ${type||""}`;
    }

    function client(){
        if(window.ldmSupabase) return window.ldmSupabase;
        if(window.LDMSupabase && window.LDMSupabase.isConfigured && window.LDMSupabase.isConfigured()){
            return window.LDMSupabase.createClient();
        }
        throw new Error("Supabase belum dikonfigurasi.");
    }

    function severityLabel(value){
        const v=String(value||"error").toLowerCase();
        return `<span class="severity severity-${esc(v)}">${esc(v.toUpperCase())}</span>`;
    }

    function supportLabel(value){
        const v=String(value||"open").toLowerCase();
        const label=v==="investigating"?"SUPPORT: INVESTIGASI":v==="resolved"?"SUPPORT: SELESAI":"SUPPORT: BELUM DITANGANI";
        return `<span class="support-status support-${esc(v)}">${label}</span>`;
    }

    function renderRows(rows){
        currentRows = Array.isArray(rows) ? rows : [];
        const tbody=$("monitorTableBody");
        if(!tbody)return;
        if(!currentRows.length){
            tbody.innerHTML='<tr><td colspan="8" class="empty-cell">Tidak ada incident pada filter ini.</td></tr>';
            return;
        }
        tbody.innerHTML=currentRows.map(row => `
            <tr>
                <td><button class="incident-link" data-copy="${esc(row.incident_code)}" title="Salin kode">${esc(row.incident_code)}</button><div>${supportLabel(row.support_status)}</div></td>
                <td>${severityLabel(row.severity)}</td>
                <td><strong>${esc(row.page||"-")}</strong><div class="muted">${esc(row.action||"-")}</div></td>
                <td><div class="message-cell">${esc(row.message||"-")}</div></td>
                <td>${Number(row.occurrence_count||1).toLocaleString("id-ID")}x</td>
                <td>${esc(row.username||"-")}<div class="muted">${esc(row.role||"-")}</div></td>
                <td>${esc(fmtDate(row.last_seen_at))}</td>
                <td>
                    <button class="btn-small" data-detail="${esc(row.id)}">Detail</button>
                    ${row.resolved_at
                        ? `<button class="btn-small" data-reopen="${esc(row.id)}">Buka Lagi</button>`
                        : `<button class="btn-small btn-resolve" data-resolve="${esc(row.id)}">Selesai</button>`}
                </td>
            </tr>`).join("");
    }

    function renderSummary(data){
        data=data||{};
        $("statOpen").textContent=Number(data.open_count||0).toLocaleString("id-ID");
        $("stat24h").textContent=Number(data.last_24h||0).toLocaleString("id-ID");
        $("stat7d").textContent=Number(data.last_7d||0).toLocaleString("id-ID");
        $("statStorage").textContent=fmtBytes(data.table_bytes||0);
        $("retentionText").textContent=`Retensi aktif: ${Number(data.retention_days||30)} hari`;
    }

    async function load(){
        status("Memuat incident...","loading");
        try{
            const sb=client();
            const statusValue=$("filterStatus").value;
            const days=Number($("filterDays").value||30);
            const [summaryRes,listRes]=await Promise.all([
                sb.rpc("ldm_client_error_summary",{p_days:days}),
                sb.rpc("ldm_list_client_errors",{p_status:statusValue,p_limit:100,p_days:days})
            ]);
            if(summaryRes.error) throw summaryRes.error;
            if(listRes.error) throw listRes.error;
            renderSummary(summaryRes.data);
            renderRows(listRes.data);
            status(`Terakhir diperbarui ${fmtDate(new Date().toISOString())}`,"ok");
        }catch(error){
            renderRows([]);
            status(error && error.message ? error.message : "Gagal memuat Monitoring Error.","error");
        }
    }

    function showDetail(id){
        const row=currentRows.find(item => String(item.id)===String(id));
        if(!row)return;
        const detail=$("detailContent");
        detail.innerHTML=`
            <div class="detail-grid">
                <div><span>Kode Incident</span><strong>${esc(row.incident_code)}</strong></div>
                <div><span>Status Incident</span><strong>${row.resolved_at?"Selesai":"Terbuka"}</strong></div>
                <div><span>Status Support</span><strong>${row.support_status==="investigating"?"Sedang Diinvestigasi":row.support_status==="resolved"?"Selesai":"Belum Ditangani"}</strong></div>
                <div><span>Severity</span><strong>${esc(row.severity||"error")}</strong></div>
                <div><span>Terjadi</span><strong>${Number(row.occurrence_count||1)}x</strong></div>
                <div><span>Halaman</span><strong>${esc(row.page||"-")}</strong></div>
                <div><span>Aksi</span><strong>${esc(row.action||"-")}</strong></div>
                <div><span>User</span><strong>${esc(row.username||"-")} · ${esc(row.role||"-")}</strong></div>
                <div><span>Versi</span><strong>${esc(row.app_version||"-")}</strong></div>
                <div><span>Online</span><strong>${row.online===true?"Ya":row.online===false?"Tidak":"-"}</strong></div>
                <div><span>Viewport</span><strong>${esc(row.viewport||"-")}</strong></div>
            </div>
            <h4>Pesan</h4><pre>${esc(row.message||"-")}</pre>
            <h4>Stack</h4><pre>${esc(row.stack||"Stack tidak tersedia.")}</pre>
            <h4>Browser</h4><pre>${esc(row.browser||"-")}</pre>
            ${row.resolution_note?`<h4>Catatan Penyelesaian</h4><pre>${esc(row.resolution_note)}</pre>`:""}
        `;
        $("detailModal").classList.add("open");
    }

    async function resolve(id,resolved){
        const note = resolved ? prompt("Catatan penyelesaian (opsional):","") : "";
        if(note === null && resolved) return;
        try{
            const result=await client().rpc("ldm_resolve_client_error",{
                p_id:id,p_resolved:Boolean(resolved),p_note:note||null
            });
            if(result.error) throw result.error;
            await load();
        }catch(error){
            alert(error && error.message ? error.message : "Gagal mengubah status incident.");
        }
    }

    function testError(){
        if(!window.LDMErrorMonitor){
            alert("Error Monitor belum tersedia pada halaman ini.");
            return;
        }
        window.LDMErrorMonitor.test();
        status("Error uji dikirim. Tunggu sebentar lalu tekan Refresh.","ok");
        setTimeout(load,1800);
    }

    document.addEventListener("click",function(event){
        const copy=event.target.closest("[data-copy]");
        if(copy){
            navigator.clipboard && navigator.clipboard.writeText(copy.dataset.copy).catch(()=>{});
            status(`Kode ${copy.dataset.copy} disalin.`,"ok");
            return;
        }
        const detail=event.target.closest("[data-detail]");
        if(detail){showDetail(detail.dataset.detail);return}
        const done=event.target.closest("[data-resolve]");
        if(done){resolve(done.dataset.resolve,true);return}
        const reopen=event.target.closest("[data-reopen]");
        if(reopen){resolve(reopen.dataset.reopen,false);return}
        if(event.target.closest("[data-close-detail]")) $("detailModal").classList.remove("open");
    });

    document.addEventListener("DOMContentLoaded",function(){
        $("btnRefresh").addEventListener("click",load);
        $("btnTestError").addEventListener("click",testError);
        $("filterStatus").addEventListener("change",load);
        $("filterDays").addEventListener("change",load);
        load();
    });
})();

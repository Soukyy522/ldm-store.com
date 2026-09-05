(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const APP_VERSION=String(window.LDM_APP_VERSION||"27.9.0");
  function client(){
    if(window.ldmSupabase) return window.ldmSupabase;
    if(window.LDMSupabase && window.LDMSupabase.isConfigured && window.LDMSupabase.isConfigured()) return window.LDMSupabase.createClient();
    throw new Error("Supabase belum dikonfigurasi.");
  }
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function fmt(v){if(!v)return "-"; const d=new Date(v); if(Number.isNaN(d.getTime()))return String(v); return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Makassar"}).format(d)}
  function incidentLabel(v){v=String(v||"open").toLowerCase(); return v==="investigating"?"Sedang Diinvestigasi":v==="resolved"?"Selesai":"Belum Ditangani"}
  function ticketStatus(v){v=String(v||"open").toLowerCase();return({open:"Terbuka",investigating:"Sedang Diinvestigasi",waiting_customer:"Menunggu Customer",resolved:"Selesai",closed:"Ditutup"})[v]||v}
  function typeLabel(v){return({issue:"Masalah / Bug",feedback:"Saran / Feedback",question:"Pertanyaan"})[String(v||"")]||v||"-"}
  function categoryLabel(v){return({kasir:"Kasir & Transaksi",barang_stok:"Barang & Stok",laporan:"Laporan",akun_absensi:"Akun & Absensi",printer_scanner:"Printer & Scanner",multi_store:"Multi-Toko / Transfer",lisensi_pembayaran:"Lisensi & Pembayaran",aplikasi_update:"Aplikasi & Update",saran_fitur:"Saran Fitur",lainnya:"Lainnya"})[String(v||"")]||v||"-"}
  function setMsg(id,t,type){const n=$(id);if(!n)return;n.textContent=t||"";n.className=`support-message ${type||""}`}
  function browserSummary(){const ua=String(navigator.userAgent||"").replace(/\s+/g," ").trim();return ua.slice(0,480)}
  function validIncident(code){return !code || /^ERR-\d{8}-[A-F0-9]{10}$/.test(code)}
  function clearForm(){
    $("ticketType").value="issue";$("ticketCategory").value="kasir";$("ticketSubject").value="";$("ticketDescription").value="";$("ticketIncident").value="";$("ticketChars").textContent="0";$("ticketSuccess").classList.remove("show");setMsg("ticketMessage","");
  }
  function prefillRelatedPage(){
    try{if(!document.referrer)return;const u=new URL(document.referrer);if(u.origin!==location.origin)return;const p=(u.pathname.split("/").pop()||"").trim();if(p && p!=="support-center.html") $("ticketRelatedPage").value=p.slice(0,160)}catch{}
  }
  async function submitTicket(){
    const type=$("ticketType").value;
    const category=$("ticketCategory").value;
    const subject=String($("ticketSubject").value||"").trim();
    const description=String($("ticketDescription").value||"").trim();
    const related=String($("ticketRelatedPage").value||"").trim();
    const incident=String($("ticketIncident").value||"").trim().toUpperCase();$("ticketIncident").value=incident;
    if(subject.length<4){setMsg("ticketMessage","Judul laporan minimal 4 karakter.","error");return}
    if(description.length<15){setMsg("ticketMessage","Deskripsi laporan minimal 15 karakter.","error");return}
    if(!validIncident(incident)){setMsg("ticketMessage","Format kode incident tidak valid. Contoh: ERR-20260905-A72C91D083","error");return}
    const btn=$("btnSubmitTicket");btn.disabled=true;setMsg("ticketMessage","Mengirim laporan ke Support...","");
    try{
      const {data,error}=await client().rpc("ldm_create_support_ticket",{
        p_ticket_type:type,p_category:category,p_subject:subject,p_description:description,
        p_related_page:related||null,p_incident_code:incident||null,p_app_version:APP_VERSION,
        p_browser:browserSummary(),p_online:navigator.onLine===true
      });
      if(error)throw error;
      const code=String(data&&data.ticket_code||"");
      $("createdTicketCode").textContent=code||"-";$("ticketSuccess").classList.add("show");
      setMsg("ticketMessage","Laporan berhasil dikirim. Simpan kode tiket untuk referensi.","ok");
      await loadTickets();
    }catch(e){setMsg("ticketMessage",e&&e.message?e.message:"Gagal mengirim laporan Support.","error")}
    finally{btn.disabled=false}
  }
  function renderTickets(rows){
    const host=$("ticketsList");
    if(!Array.isArray(rows)||!rows.length){host.innerHTML='<div class="empty">Belum ada tiket Support pada akun/toko ini.</div>';return}
    host.innerHTML=rows.map(t=>{
      const st=String(t.status||"open").toLowerCase();
      const note=t.resolution_note?`<div class="ticket-note"><strong>Catatan Support:</strong><br>${esc(t.resolution_note)}</div>`:"";
      return `<article class="ticket"><div class="ticket-top"><div><div class="ticket-code-small">${esc(t.ticket_code)}</div><div class="ticket-title">${esc(t.subject)}</div></div><button class="btn btn-soft js-copy-ticket" data-code="${esc(t.ticket_code)}">📋 Salin</button></div><div class="ticket-meta"><span class="badge st-${esc(st)}">${esc(ticketStatus(st))}</span><span class="badge tag">${esc(typeLabel(t.ticket_type))}</span><span class="badge tag">${esc(categoryLabel(t.category))}</span>${t.incident_code?`<span class="badge tag">${esc(t.incident_code)}</span>`:""}</div><div class="help" style="margin-top:8px">Dibuat ${esc(fmt(t.created_at))}${t.support_last_action_at?` · Update Support ${esc(fmt(t.support_last_action_at))}`:""}${t.created_username?` · ${esc(t.created_username)}`:""}</div>${note}</article>`
    }).join("");
    host.querySelectorAll(".js-copy-ticket").forEach(btn=>btn.addEventListener("click",()=>copyText(btn.dataset.code,"ticketListMessage")));
  }
  async function loadTickets(){
    setMsg("ticketListMessage","Memuat riwayat tiket...","");
    try{const {data,error}=await client().rpc("ldm_my_support_tickets",{p_limit:40});if(error)throw error;renderTickets(data);setMsg("ticketListMessage","","")}
    catch(e){$("ticketsList").innerHTML='<div class="empty">Riwayat tiket belum dapat dimuat.</div>';setMsg("ticketListMessage",e&&e.message?e.message:"Gagal memuat tiket.","error")}
  }
  async function copyText(value,msgId){if(!value)return;try{await navigator.clipboard.writeText(value);setMsg(msgId,`Kode ${value} disalin.`,`ok`)}catch{setMsg(msgId,"Clipboard tidak tersedia. Salin kode secara manual.","error")}}
  async function lookupIncident(){
    const code=String($("incidentCode").value||"").trim().toUpperCase(); $("incidentCode").value=code;$("result").hidden=true;
    if(!/^ERR-\d{8}-[A-F0-9]{10}$/.test(code)){setMsg("supportMessage","Format kode incident tidak valid. Contoh: ERR-20260905-A72C91D083","error");return}
    const btn=$("btnLookup"); btn.disabled=true; setMsg("supportMessage","Mengecek status incident...","");
    try{
      const {data,error}=await client().rpc("ldm_my_incident_status",{p_incident_code:code});if(error)throw error;
      $("rCode").textContent=data.incident_code||code;$("rSupport").textContent=incidentLabel(data.support_status);$("rIncident").textContent=data.incident_status==="resolved"?"Selesai":"Terbuka";$("rPage").textContent=data.page||"-";$("rAction").textContent=data.action||"-";$("rCount").textContent=`${Number(data.occurrence_count||1)}x`;$("rLast").textContent=fmt(data.last_seen_at);$("rSupportTime").textContent=fmt(data.support_last_action_at);$("rVersion").textContent=data.app_version||"-";$("resolutionBox").hidden=!data.resolution_note;$("resolutionNote").textContent=data.resolution_note||"";$("result").hidden=false;setMsg("supportMessage","Status incident ditemukan untuk toko aktif.","ok");
      if(!$("ticketIncident").value)$("ticketIncident").value=code;
    }catch(e){setMsg("supportMessage",e&&e.message?e.message:"Gagal mengecek incident.","error")}
    finally{btn.disabled=false}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    prefillRelatedPage();
    $("ticketDescription").addEventListener("input",()=>{$("ticketChars").textContent=String($("ticketDescription").value.length)});
    $("btnSubmitTicket").addEventListener("click",submitTicket);$("btnClearTicket").addEventListener("click",clearForm);$("btnReloadTicketList").addEventListener("click",loadTickets);$("btnRefreshTickets").addEventListener("click",loadTickets);$("btnCopyTicket").addEventListener("click",()=>copyText($("createdTicketCode").textContent,"ticketMessage"));
    $("btnLookup").addEventListener("click",lookupIncident);$("incidentCode").addEventListener("keydown",e=>{if(e.key==="Enter")lookupIncident()});$("btnCopy").addEventListener("click",()=>copyText($("rCode").textContent||$("incidentCode").value,"supportMessage"));
    const updateMonitoringButton=()=>{const role=String((window.LDMCloudSession&&window.LDMCloudSession.getCurrentRole&&window.LDMCloudSession.getCurrentRole())||"").toLowerCase();const mon=$("btnMonitoring");if(mon)mon.style.display=(role==="owner"||role==="admin")?"inline-flex":"none";};
    updateMonitoringButton();
    loadTickets();
    window.addEventListener("ldm-license-v2-authorized",()=>{updateMonitoringButton();loadTickets();},{once:true});
  });
})();

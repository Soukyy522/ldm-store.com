(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const APP_VERSION=String(window.LDM_APP_VERSION||"27.9.0");
  const CHECKOUT_STORAGE_KEYS=["ldmPublicCheckoutV281","ldmPublicCheckoutV28","ldmPublicCheckoutV27","ldmPublicCheckoutV261","ldmPublicCheckoutV26","ldmPublicCheckoutV25","ldmPublicCheckoutV278","ldmPublicCheckoutV276","ldmPublicCheckoutV273","ldmPublicCheckoutV272"];
  let currentRefundContext=null;
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
  function money(v){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0))}
  function refundStatusLabel(v){return({submitted:"Diajukan",reviewing:"Sedang Diverifikasi",waiting_customer:"Menunggu Informasi",approved:"Disetujui",processing:"Sedang Diproses",completed:"Refund Selesai",rejected:"Ditolak",cancelled:"Dibatalkan"})[String(v||"").toLowerCase()]||String(v||"-")}
  function readCheckoutContext(){
    for(const key of CHECKOUT_STORAGE_KEYS){
      try{const value=JSON.parse(localStorage.getItem(key)||"null");if(value?.order_id&&value?.status_token)return {order_id:String(value.order_id),status_token:String(value.status_token)}}catch{}
    }
    return null;
  }
  function checkoutUrl(){
    const base=window.LDM_LICENSE_V2_CONFIG||{};
    const url=String(base.checkoutUrl||"").trim()||String(base.serverUrl||"").replace(/\/ldm-license-v2\/?$/i,"/ldm-public-checkout-v2");
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ldm-public-checkout-v2$/i.test(url))throw new Error("URL Public Checkout belum dikonfigurasi.");
    return url;
  }
  async function callCheckout(payload){
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(checkoutUrl(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.ok===false){const e=new Error(data?.message||`Refund HTTP ${response.status}`);e.code=data?.code||"REFUND_REQUEST_FAILED";e.data=data;throw e}
      return data;
    }finally{clearTimeout(timeout)}
  }
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
  function refundRoleAllowed(){
    // V28.1: refund dapat diajukan dari browser/perangkat yang menyimpan order_id + status_token.
    // Owner login tetap didukung, tetapi public checkout token adalah otorisasi utama untuk order customer.
    const role=String((window.LDMCloudSession&&window.LDMCloudSession.getCurrentRole&&window.LDMCloudSession.getCurrentRole())||"").toLowerCase();
    return role==="owner" || !!readCheckoutContext();
  }
  function setRefundInputsDisabled(disabled){
    ["refundReasonDetail","refundRequestConfirm","btnSubmitRefundRequest"].forEach(id=>{const n=$(id);if(n)n.disabled=disabled});
  }
  function renderRefundRequestStatus(r){
    const box=$("refundExistingRequest");if(!box)return;
    if(!r){box.hidden=true;box.innerHTML="";return}
    const active=["submitted","reviewing","waiting_customer","approved","processing"].includes(String(r.status||""));
    box.hidden=false;
    box.innerHTML=`<div class="ticket-top"><div><div class="refund-request-code">${esc(r.request_code||"-")}</div><div class="ticket-title">${esc(refundStatusLabel(r.status))}</div></div>${["submitted","waiting_customer"].includes(String(r.status||""))?`<button class="btn btn-soft" id="btnCancelRefundRequest">Batalkan Request</button>`:""}</div><div class="ticket-meta"><span class="badge tag">Refund LYNK.ID</span><span class="badge tag">${esc(money(r.requested_amount))}</span></div><div class="help" style="margin-top:8px">Diajukan ${esc(fmt(r.created_at))}${r.updated_at?` · Update ${esc(fmt(r.updated_at))}`:""}</div>${r.response_note?`<div class="ticket-note"><strong>Catatan Developer:</strong><br>${esc(r.response_note)}</div>`:""}`;
    const cancel=$("btnCancelRefundRequest");if(cancel)cancel.addEventListener("click",cancelRefundRequest);
    if(active)setRefundInputsDisabled(true);
  }
  function renderRefundContext(d){
    currentRefundContext=d;
    const section=$("refundRequestSection"),form=$("refundRequestFormWrap"),expired=$("refundExpiredNote"),info=$("refundInfoGrid"),state=$("refundContextMessage");
    if(!section)return;
    section.hidden=false;
    const p=d.payment||{},e=d.eligibility||{},l=d.license||{},r=d.request||null;
    $("refundPolicyBadge").textContent=`Ketentuan LYNK.ID · ${Number(e.refund_window_hours||24)} jam`;
    $("refundOrderId").textContent=p.order_id||"-";
    $("refundPaymentStatus").textContent=String(p.status||"-").toUpperCase();
    $("refundPaymentAmount").textContent=money(p.amount);
    $("refundRemainingAmount").textContent=money(e.remaining_refundable||0);
    $("refundPaidAt").textContent=fmt(p.paid_at);
    $("refundDeadline").textContent=fmt(e.refund_deadline);
    $("refundPlan").textContent=l.plan_code||"-";
    const delivery=$("refundDeliveryStatus");if(delivery)delivery.textContent=String(e.delivery_provision_status||"belum diketahui").toUpperCase();
    info.hidden=false;
    renderRefundRequestStatus(r);
    expired.hidden=true;
    if(e.eligible===true){
      state.className="refund-state ok";
      state.textContent=`✅ Masih dalam batas ${Number(e.refund_window_hours||24)} jam LYNK.ID. Form ini hanya untuk klaim bahwa lisensi/layanan belum diterima. Batas: ${fmt(e.refund_deadline)}.`;
      form.hidden=false;setRefundInputsDisabled(false);
      $("refundRequestAmount").value=String(Number(e.remaining_refundable||0));
      if(e.delivery_evidence_available===true){
        state.className="refund-state warn";
        state.textContent+=` Sistem LocDailyMar mencatat status delivery ${String(e.delivery_provision_status||"ready").toUpperCase()}; LYNK.ID dapat meminta bukti penyerahan dari Kreator saat menilai klaim.`;
      }
      if(r&&["submitted","reviewing","waiting_customer","approved","processing"].includes(String(r.status||"")))setRefundInputsDisabled(true);
    }else{
      form.hidden=true;
      const deadline=e.refund_deadline?new Date(e.refund_deadline).getTime():0;
      const isExpired=deadline&&Date.now()>deadline;
      if(isExpired){state.className="refund-state warn";state.textContent="Batas refund kepada LYNK.ID sudah lewat 24 jam.";expired.hidden=false;$("refundExpiredText").textContent=`Batas LYNK.ID berakhir pada ${fmt(e.refund_deadline)}. Sesuai ketentuan publik LYNK.ID, klaim belum menerima produk/layanan setelah 24 jam harus disampaikan langsung kepada LocDailyMar sebagai Kreator.`}
      else{state.className="refund-state off";state.textContent=e.reason||"Pembayaran ini tidak memenuhi jalur refund LYNK.ID."}
    }
  }
  function updateRefundAmountMode(){
    if(!currentRefundContext)return;
    const e=currentRefundContext.eligibility||{};
    const input=$("refundRequestAmount");if(input)input.value=String(Number(e.remaining_refundable||0));
  }
  async function loadRefundContext(){
    const section=$("refundRequestSection");if(!section)return;
    if(!refundRoleAllowed()){section.hidden=true;return}
    const last=readCheckoutContext();if(!last){section.hidden=true;return}
    section.hidden=false;$("refundContextMessage").className="refund-state info";$("refundContextMessage").textContent="Memeriksa transaksi pembayaran terakhir dan kebijakan refund…";$("refundRequestFormWrap").hidden=true;$("refundInfoGrid").hidden=true;$("refundExpiredNote").hidden=true;
    try{const d=await callCheckout({action:"refund_context",order_id:last.order_id,status_token:last.status_token});renderRefundContext(d)}catch(e){$("refundContextMessage").className="refund-state off";$("refundContextMessage").textContent=e?.message||"Kelayakan refund belum dapat diperiksa.";$("refundRequestFormWrap").hidden=true}
  }
  async function submitRefundRequest(){
    if(!currentRefundContext?.eligibility?.eligible){setMsg("refundRequestMessage","Pembayaran tidak memenuhi syarat refund.","error");return}
    if(!$("refundRequestConfirm").checked){setMsg("refundRequestMessage","Centang persetujuan kebijakan refund terlebih dahulu.","error");return}
    const last=readCheckoutContext();if(!last){setMsg("refundRequestMessage","Data order checkout tidak ditemukan pada perangkat ini.","error");return}
    const type="full",detail=String($("refundReasonDetail").value||"").trim(),category="not_delivered";
    if(detail.length<20){setMsg("refundRequestMessage","Jelaskan produk/layanan yang belum diterima minimal 20 karakter.","error");return}
    const remaining=Number(currentRefundContext.eligibility.remaining_refundable||0);const amount=remaining;
    const btn=$("btnSubmitRefundRequest");btn.disabled=true;btn.textContent="Mengirim Permintaan…";setMsg("refundRequestMessage","Mengirim permintaan refund ke Developer Support…","");
    try{const d=await callCheckout({action:"refund_request_create",order_id:last.order_id,status_token:last.status_token,refund_type:type,amount,reason_category:category,reason_detail:detail});setMsg("refundRequestMessage",`Permintaan ${d.request?.request_code||"RFD"} berhasil dibuat. Pantau statusnya pada card ini.`,"ok");await loadRefundContext()}
    catch(e){setMsg("refundRequestMessage",e?.message||"Permintaan refund gagal dikirim.","error")}
    finally{btn.disabled=false;btn.textContent="↩️ Catat Permintaan Refund 24 Jam"}
  }
  async function cancelRefundRequest(){
    const r=currentRefundContext?.request,last=readCheckoutContext();if(!r?.request_code||!last)return;if(!confirm(`Batalkan permintaan ${r.request_code}?`))return;
    try{await callCheckout({action:"refund_request_cancel",order_id:last.order_id,status_token:last.status_token,request_code:r.request_code});setMsg("refundRequestMessage","Permintaan refund dibatalkan.","ok");await loadRefundContext()}catch(e){setMsg("refundRequestMessage",e?.message||"Gagal membatalkan permintaan refund.","error")}
  }

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
    const refundType=$("refundRequestType");if(refundType)refundType.addEventListener("change",updateRefundAmountMode);
    const refundReason=$("refundReasonDetail");if(refundReason)refundReason.addEventListener("input",()=>{$("refundReasonChars").textContent=String(refundReason.value.length)});
    const submitRefund=$("btnSubmitRefundRequest");if(submitRefund)submitRefund.addEventListener("click",submitRefundRequest);
    const refreshRefund=$("btnRefreshRefundContext");if(refreshRefund)refreshRefund.addEventListener("click",loadRefundContext);
    loadRefundContext();
    window.addEventListener("ldm-license-v2-authorized",()=>{updateMonitoringButton();loadTickets();loadRefundContext();},{once:true});
  });
})();

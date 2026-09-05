(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const APP_VERSION=String(window.LDM_APP_VERSION||"27.9.0");
  function client(){
    if(window.ldmSupabase)return window.ldmSupabase;
    if(window.LDMSupabase&&window.LDMSupabase.isConfigured&&window.LDMSupabase.isConfigured())return window.LDMSupabase.createClient();
    throw new Error("Supabase belum dikonfigurasi.");
  }
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function fmt(v){if(!v)return "-";const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Makassar"}).format(d)}
  function setMsg(id,text,type=""){const n=$(id);if(!n)return;n.textContent=text||"";n.className=`privacy-message ${type||""}`}
  function browserSummary(){return String(navigator.userAgent||"").replace(/\s+/g," ").trim().slice(0,480)}
  function typeLabel(v){return({access_copy:"Akses / Salinan Data",correction:"Koreksi Data",restriction:"Pembatasan Pemrosesan",deletion:"Penghapusan / Pemusnahan",withdraw_consent:"Penarikan Persetujuan",portability:"Portabilitas Data",automated_decision_objection:"Keberatan Keputusan Otomatis",other:"Lainnya"})[String(v||"")]||v||"-"}
  function scopeLabel(v){return({account_profile:"Akun & Profil",attendance:"Absensi",device_session:"Perangkat & Sesi",support_security:"Support & Keamanan",business_activity:"Aktivitas Bisnis Terkait Akun",all_personal_data:"Seluruh Data Pribadi Saya",other:"Lainnya"})[String(v||"")]||v||"-"}
  function statusLabel(v){return({submitted:"Diajukan",verifying:"Verifikasi",processing:"Diproses",waiting_user:"Menunggu Anda",completed:"Selesai",rejected:"Ditolak",cancelled:"Dibatalkan"})[String(v||"submitted")]||v}
  function validCode(v){return /^PRV-\d{8}-[A-F0-9]{10}$/.test(String(v||""))}
  function updateCorrectionField(){const yes=$("privacyRequestType").value==="correction";$("correctionField").hidden=!yes;if(!yes)$("privacyCorrection").value=""}
  function clearForm(){$("privacyRequestType").value="access_copy";$("privacyDataScope").value="account_profile";$("privacyDetails").value="";$("privacyCorrection").value="";$("privacyConfirm").checked=false;$("privacyChars").textContent="0";$("privacySuccess").classList.remove("show");setMsg("privacyMessage","");updateCorrectionField()}
  async function copyText(value,msgId){if(!value)return;try{await navigator.clipboard.writeText(value);setMsg(msgId,`Kode ${value} disalin.`,"ok")}catch{setMsg(msgId,"Clipboard tidak tersedia. Salin kode secara manual.","error")}}
  async function submitPrivacy(){
    const type=$("privacyRequestType").value,scope=$("privacyDataScope").value;
    const details=String($("privacyDetails").value||"").trim(),correction=String($("privacyCorrection").value||"").trim();
    if(details.length<15){setMsg("privacyMessage","Penjelasan permintaan minimal 15 karakter.","error");return}
    if(type==="correction"&&correction.length<3){setMsg("privacyMessage","Tuliskan data yang seharusnya untuk permintaan koreksi.","error");return}
    if(!$("privacyConfirm").checked){setMsg("privacyMessage","Centang konfirmasi bahwa request hanya terkait data pribadi Anda sendiri.","error");return}
    const btn=$("btnSubmitPrivacy");btn.disabled=true;setMsg("privacyMessage","Mengirim Privacy Request...","");
    try{
      const {data,error}=await client().rpc("ldm_create_privacy_request",{p_request_type:type,p_data_scope:scope,p_details:details,p_desired_correction:correction||null,p_app_version:APP_VERSION,p_browser:browserSummary(),p_online:navigator.onLine===true});
      if(error)throw error;
      const code=String(data&&data.request_code||"");$("createdPrivacyCode").textContent=code||"-";$("privacySuccess").classList.add("show");setMsg("privacyMessage","Permintaan berhasil dicatat. Simpan kode PRV untuk referensi.","ok");await loadRequests();
    }catch(e){setMsg("privacyMessage",e&&e.message?e.message:"Gagal mengirim Privacy Request.","error")}
    finally{btn.disabled=false}
  }
  async function cancelRequest(code){
    if(!validCode(code))return;
    if(!confirm(`Batalkan Privacy Request ${code}?`))return;
    setMsg("privacyListMessage",`Membatalkan ${code}...`,"");
    try{const {error}=await client().rpc("ldm_cancel_privacy_request",{p_request_code:code});if(error)throw error;setMsg("privacyListMessage",`${code} dibatalkan.`,"ok");await loadRequests()}catch(e){setMsg("privacyListMessage",e&&e.message?e.message:"Gagal membatalkan request.","error")}
  }
  function renderRequests(rows){
    const host=$("privacyRequestsList");
    if(!Array.isArray(rows)||!rows.length){host.innerHTML='<div class="empty">Belum ada Privacy Request pada akun ini.</div>';return}
    host.innerHTML=rows.map(r=>{
      const st=String(r.status||"submitted").toLowerCase();
      const canCancel=["submitted","waiting_user"].includes(st);
      const due=r.statutory_due_at?`<span class="badge tag deadline">Target ${esc(fmt(r.statutory_due_at))}</span>`:"";
      const correction=r.desired_correction?`<div class="response-note" style="background:#f8faf9;border-color:#e3ebe7"><b>Data yang diminta untuk dikoreksi:</b><br>${esc(r.desired_correction)}</div>`:"";
      const note=r.response_note?`<div class="response-note"><b>Catatan Privacy Support:</b><br>${esc(r.response_note)}</div>`:"";
      return `<article class="request"><div class="request-top"><div><code>${esc(r.request_code)}</code><div class="request-title">${esc(typeLabel(r.request_type))}</div></div><div class="actions" style="margin:0"><button class="btn btn-soft js-copy-prv" data-code="${esc(r.request_code)}">📋 Salin</button>${canCancel?`<button class="btn btn-danger js-cancel-prv" data-code="${esc(r.request_code)}">Batalkan</button>`:""}</div></div><div class="meta"><span class="badge st-${esc(st)}">${esc(statusLabel(st))}</span><span class="badge tag">${esc(scopeLabel(r.data_scope))}</span>${due}</div><div class="help" style="margin-top:9px">Dibuat ${esc(fmt(r.created_at))}${r.privacy_last_action_at?` · Update ${esc(fmt(r.privacy_last_action_at))}`:""}</div><div style="margin-top:9px;white-space:pre-wrap;font-size:12px;line-height:1.55">${esc(r.details||"")}</div>${correction}${note}</article>`
    }).join("");
    host.querySelectorAll(".js-copy-prv").forEach(b=>b.onclick=()=>copyText(b.dataset.code,"privacyListMessage"));
    host.querySelectorAll(".js-cancel-prv").forEach(b=>b.onclick=()=>cancelRequest(b.dataset.code));
  }
  async function loadRequests(){
    setMsg("privacyListMessage","Memuat riwayat Privacy Request...","");
    try{const {data,error}=await client().rpc("ldm_my_privacy_requests",{p_limit:40});if(error)throw error;renderRequests(data);setMsg("privacyListMessage","")}
    catch(e){$("privacyRequestsList").innerHTML='<div class="empty">Riwayat Privacy Request belum dapat dimuat.</div>';setMsg("privacyListMessage",e&&e.message?e.message:"Gagal memuat Privacy Request.","error")}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    $("privacyRequestType").addEventListener("change",updateCorrectionField);$("privacyDetails").addEventListener("input",()=>{$("privacyChars").textContent=String($("privacyDetails").value.length)});
    $("btnSubmitPrivacy").addEventListener("click",submitPrivacy);$("btnClearPrivacy").addEventListener("click",clearForm);$("btnRefreshPrivacy").addEventListener("click",loadRequests);$("btnCopyPrivacyCode").addEventListener("click",()=>copyText($("createdPrivacyCode").textContent,"privacyMessage"));
    updateCorrectionField();loadRequests();window.addEventListener("ldm-license-v2-authorized",loadRequests,{once:true});
  });
})();

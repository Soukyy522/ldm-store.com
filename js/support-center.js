(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  function client(){
    if(window.ldmSupabase) return window.ldmSupabase;
    if(window.LDMSupabase && window.LDMSupabase.isConfigured && window.LDMSupabase.isConfigured()) return window.LDMSupabase.createClient();
    throw new Error("Supabase belum dikonfigurasi.");
  }
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function fmt(v){if(!v)return "-"; const d=new Date(v); if(Number.isNaN(d.getTime()))return String(v); return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Makassar"}).format(d)}
  function label(v){v=String(v||"open").toLowerCase(); return v==="investigating"?"Sedang Diinvestigasi":v==="resolved"?"Selesai":"Belum Ditangani"}
  function setMsg(t,type){const n=$("supportMessage"); n.textContent=t||""; n.className=`support-message ${type||""}`}
  async function lookup(){
    const code=String($("incidentCode").value||"").trim().toUpperCase(); $("incidentCode").value=code;
    $("result").hidden=true;
    if(!/^ERR-\d{8}-[A-F0-9]{10}$/.test(code)){setMsg("Format kode incident tidak valid. Contoh: ERR-20260905-A72C91D083","error");return}
    const btn=$("btnLookup"); btn.disabled=true; setMsg("Mengecek status incident...","loading");
    try{
      const {data,error}=await client().rpc("ldm_my_incident_status",{p_incident_code:code});
      if(error) throw error;
      $("rCode").textContent=data.incident_code||code;
      $("rSupport").textContent=label(data.support_status);
      $("rIncident").textContent=data.incident_status==="resolved"?"Selesai":"Terbuka";
      $("rPage").textContent=data.page||"-";
      $("rAction").textContent=data.action||"-";
      $("rCount").textContent=`${Number(data.occurrence_count||1)}x`;
      $("rLast").textContent=fmt(data.last_seen_at);
      $("rSupportTime").textContent=fmt(data.support_last_action_at);
      $("rVersion").textContent=data.app_version||"-";
      $("resolutionBox").hidden=!data.resolution_note;
      $("resolutionNote").textContent=data.resolution_note||"";
      $("result").hidden=false;
      setMsg("Status incident ditemukan untuk toko aktif.","ok");
    }catch(e){setMsg(e&&e.message?e.message:"Gagal mengecek incident.","error")}
    finally{btn.disabled=false}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    $("btnLookup").addEventListener("click",lookup);
    $("incidentCode").addEventListener("keydown",e=>{if(e.key==="Enter")lookup()});
    $("btnCopy").addEventListener("click",async()=>{const v=$("rCode").textContent||$("incidentCode").value; if(!v)return; try{await navigator.clipboard.writeText(v);setMsg(`Kode ${v} disalin.`,"ok")}catch{setMsg("Clipboard tidak tersedia. Salin kode secara manual.","error")}});
    const role=String((window.LDMCloudSession&&window.LDMCloudSession.getCurrentRole&&window.LDMCloudSession.getCurrentRole())||"").toLowerCase();
    const mon=$("btnMonitoring"); if(mon) mon.style.display=(role==="owner"||role==="admin")?"inline-flex":"none";
  });
})();

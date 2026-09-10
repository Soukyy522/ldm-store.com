(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const role=()=>String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
  function datePartsWita(){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Makassar",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    return Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  }
  const today=()=>{const d=datePartsWita();return `${d.year}-${d.month}-${d.day}`;};
  let attendanceRuleRequest=0;

  function insertWorkforceLinks(){
    if($("ldmWorkforceQuickLinks"))return;
    const anchor=document.querySelector(".absen-grid")||document.querySelector(".main-content");
    if(!anchor)return;
    const wrap=document.createElement("div");
    wrap.id="ldmWorkforceQuickLinks";
    wrap.className="ldm-workforce-quick-links";
    wrap.innerHTML=`${role()==="owner"?'<a class="ldm-exception-link owner" href="master-shift.html">🗓️ Master Shift <span aria-hidden="true">→</span></a>':""}<a class="ldm-exception-link" href="ketidakhadiran.html">📋 Ketidakhadiran <span aria-hidden="true">→</span></a>`;
    anchor.parentNode.insertBefore(wrap,anchor);
  }

  async function selectedAttendanceUser(){
    const username=$("selectAkunAbsen")?.value;
    if(!username||!window.LDMAttendance)return null;
    const profiles=window.LDMAttendance.readProfilesCache?window.LDMAttendance.readProfilesCache():[];
    return profiles.find(profile=>String(profile.username||"").trim().toLowerCase()===String(username).trim().toLowerCase())||null;
  }

  function ensureScheduleBanner(){
    if($("ldmScheduleRule"))return $("ldmScheduleRule");
    const form=$("formAbsensi");
    if(!form)return null;
    const banner=document.createElement("div");
    banner.id="ldmScheduleRule";
    banner.className="ldm-schedule-rule";
    form.insertBefore(banner,form.firstElementChild);
    return banner;
  }

  async function applyAttendanceScheduleRule(){
    const request=++attendanceRuleRequest;
    const banner=ensureScheduleBanner();
    const submit=$("btnSubmitAbsen");
    const shift=$("selectShift");
    if(!banner||!submit||!shift||!window.LDMWorkforce)return;
    const profile=await selectedAttendanceUser();
    if(!profile){banner.className="ldm-schedule-rule";shift.disabled=false;return;}

    try{
      const rule=await window.LDMWorkforce.scheduleForUser({userId:profile.id,date:today()});
      if(request!==attendanceRuleRequest)return;
      if(!rule.found){
        if(rule.is_primary_owner){
          banner.className="ldm-schedule-rule show off";
          banner.textContent="Owner Pusat: jadwal hari ini opsional. Pilih shift secara manual bila ingin melakukan presensi.";
          shift.disabled=false;submit.disabled=false;
        }else{
          banner.className="ldm-schedule-rule show blocked";
          banner.textContent="Jadwal kerja hari ini belum diatur Owner. Presensi ditolak sampai jadwal tersedia di Master Shift.";
          shift.disabled=true;submit.disabled=true;
        }
        return;
      }
      if(rule.status==="OFF"){
        banner.className="ldm-schedule-rule show off";
        banner.textContent="Hari ini Libur terjadwal. Tidak ada kewajiban presensi dan tidak akan muncul sebagai ketidakhadiran.";
        shift.disabled=true;submit.disabled=true;return;
      }
      if(rule.status==="ANNUAL_LEAVE"){
        banner.className="ldm-schedule-rule show off";
        banner.textContent="Hari ini Cuti Tahunan. Tidak ada kewajiban presensi dan tidak akan muncul sebagai ketidakhadiran.";
        shift.disabled=true;submit.disabled=true;return;
      }
      shift.value=rule.shift_label||"Shift 1";
      shift.disabled=true;submit.disabled=false;
      banner.className="ldm-schedule-rule show work";
      banner.textContent=`Jadwal hari ini: ${rule.shift_label} · ${rule.planned_start_time||"-"} - ${rule.planned_end_time||"-"} WITA · toleransi ${Number(rule.grace_minutes)||0} menit. Shift dikunci sesuai Master Shift.`;
    }catch(error){
      banner.className="ldm-schedule-rule show blocked";
      banner.textContent="Jadwal belum dapat diverifikasi. Muat ulang halaman sebelum melakukan presensi.";
      submit.disabled=true;shift.disabled=true;
    }
  }

  function bindAttendanceRule(){
    $("selectAkunAbsen")?.addEventListener("change",applyAttendanceScheduleRule);
    $("selectJenisAbsen")?.addEventListener("change",applyAttendanceScheduleRule);
    window.addEventListener("ldm-attendance-profiles-updated",applyAttendanceScheduleRule);
    window.addEventListener("ldm-attendance-ready",applyAttendanceScheduleRule);
    setTimeout(applyAttendanceScheduleRule,400);
  }

  function boot(){
    insertWorkforceLinks();
    bindAttendanceRule();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  window.LDMAttendanceWorkforceUI=Object.freeze({refreshScheduleRule:applyAttendanceScheduleRule});
})();

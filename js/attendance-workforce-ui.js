(function(){
  "use strict";

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const role=()=>String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
  function datePartsWita(){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Makassar",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const map=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    return {year:map.year,month:map.month,day:map.day};
  }
  const monthNow=()=>{const d=datePartsWita();return `${d.year}-${d.month}`;};
  const today=()=>{const d=datePartsWita();return `${d.year}-${d.month}-${d.day}`;};
  const reasonLabel=value=>({LUPA_ABSEN:"Lupa melakukan absensi",KENDALA_PERANGKAT:"Kendala perangkat",KENDALA_JARINGAN:"Kendala jaringan",KEADAAN_DARURAT:"Keadaan darurat",LAINNYA:"Lainnya"}[value]||value||"-");

  let stores=[];
  let accounts=[];
  let selectedAccount=null;
  let scheduleRows=[];
  let managerRequest=0;
  let attendanceRuleRequest=0;

  function notify(message,type=""){
    const box=$("ldmWorkforceMessage");
    if(!box)return;
    box.className=`ldm-workforce-notice ${type}`.trim();
    box.textContent=message;
  }

  function insertExceptionLink(){
    if($("ldmExceptionPageLink"))return;
    const anchor=document.querySelector(".absen-grid")||document.querySelector(".main-content");
    if(!anchor)return;
    const link=document.createElement("a");
    link.id="ldmExceptionPageLink";
    link.className="ldm-exception-link";
    link.href="attendance-exception.html";
    link.innerHTML='🗒️ Form Alasan Tidak Absensi <span aria-hidden="true">→</span>';
    anchor.parentNode.insertBefore(link,anchor);
  }

  function managementMarkup(){
    return `
      <section class="ldm-workforce-card" id="ldmWorkforcePanel" hidden>
        <div class="ldm-workforce-head">
          <div>
            <h3>🗓️ Jadwal Shift & Cuti Karyawan</h3>
            <p>Owner mengatur jadwal per bulan. Selain Owner Pusat, setiap akun wajib memiliki status untuk seluruh tanggal: kerja, libur, atau cuti tahunan.</p>
          </div>
          <span class="ldm-workforce-badge">Owner Only</span>
        </div>

        <div class="ldm-workforce-grid">
          <div class="ldm-workforce-field"><label>Cabang</label><select id="ldmWorkforceStore"></select></div>
          <div class="ldm-workforce-field"><label>Bulan</label><input id="ldmWorkforceMonth" type="month"></div>
          <div class="ldm-workforce-field wide"><label>Akun Karyawan</label><select id="ldmWorkforceUser"></select></div>
          <div class="ldm-workforce-field"><label>Hak Cuti Tahunan</label><input id="ldmLeaveEntitlement" type="number" min="0" max="366" value="0"></div>
          <div class="ldm-workforce-field"><label>Tahun Hak Cuti</label><input id="ldmLeaveYear" type="number" min="2020" max="2100"></div>
          <div class="ldm-workforce-field wide"><label>Status Cuti</label><div id="ldmLeaveSummary" class="ldm-workforce-notice">Pilih akun untuk melihat hak cuti.</div></div>
        </div>

        <div class="ldm-workforce-actions">
          <button type="button" class="ldm-workforce-btn secondary" id="ldmSaveLeave">Simpan Hak Cuti</button>
          <button type="button" class="ldm-workforce-btn secondary" id="ldmReloadSchedule">Muat Jadwal Bulan</button>
        </div>

        <div class="ldm-workforce-notice" style="margin-top:16px"><strong>Template cepat:</strong> pilih hari kerja, shift, dan jam. Tombol Terapkan Template akan membuat satu bulan penuh lalu setiap tanggal masih dapat diedit manual.</div>
        <div class="ldm-workforce-grid">
          <div class="ldm-workforce-field wide"><label>Hari kerja</label><div class="ldm-workforce-weekdays" id="ldmWeekdays">
            ${[[1,"Sen"],[2,"Sel"],[3,"Rab"],[4,"Kam"],[5,"Jum"],[6,"Sab"],[0,"Min"]].map(([v,l])=>`<label><input type="checkbox" value="${v}" ${v!==0?"checked":""}> ${l}</label>`).join("")}
          </div></div>
          <div class="ldm-workforce-field"><label>Shift Default</label><select id="ldmTemplateShift"><option>Shift 1</option><option>Shift 2</option><option>Full Day</option></select></div>
          <div class="ldm-workforce-field"><label>Jam Masuk</label><input id="ldmTemplateStart" type="time" value="08:00"></div>
          <div class="ldm-workforce-field"><label>Jam Keluar</label><input id="ldmTemplateEnd" type="time" value="16:00"></div>
          <div class="ldm-workforce-field"><label>Toleransi terlambat</label><input id="ldmTemplateGrace" type="number" min="0" max="240" value="30"></div>
        </div>
        <div class="ldm-workforce-actions">
          <button type="button" class="ldm-workforce-btn secondary" id="ldmApplyTemplate">Terapkan Template Bulan</button>
          <button type="button" class="ldm-workforce-btn" id="ldmSaveSchedule">Simpan Jadwal Bulan</button>
          <button type="button" class="ldm-workforce-btn danger" id="ldmClearSchedule" hidden>Kosongkan Jadwal Owner Pusat</button>
        </div>
        <div id="ldmWorkforceMessage" class="ldm-workforce-notice">Pilih akun, lalu muat atau buat jadwal.</div>
        <div class="ldm-workforce-table-wrap"><table class="ldm-workforce-table"><thead><tr><th>Tanggal</th><th>Hari</th><th>Status</th><th>Shift</th><th>Masuk</th><th>Keluar</th><th>Toleransi</th><th>Catatan</th></tr></thead><tbody id="ldmScheduleBody"></tbody></table></div>
      </section>`;
  }

  function injectManagement(){
    if(role()!=="owner" || $("ldmWorkforcePanel"))return;
    const target=$("ownerAttendancePanel")||document.querySelector(".clock-banner");
    if(!target)return;
    target.insertAdjacentHTML("afterend",managementMarkup());
    $("ldmWorkforcePanel").hidden=false;
    $("ldmWorkforceMonth").value=monthNow();
    $("ldmLeaveYear").value=Number(monthNow().slice(0,4));

    $("ldmWorkforceStore").addEventListener("change",loadAccounts);
    $("ldmWorkforceMonth").addEventListener("change",()=>{
      $("ldmLeaveYear").value=Number($("ldmWorkforceMonth").value.slice(0,4));
      loadAccounts();
    });
    $("ldmLeaveYear").addEventListener("change",loadAccounts);
    $("ldmWorkforceUser").addEventListener("change",()=>selectAccount(true));
    $("ldmSaveLeave").addEventListener("click",saveLeave);
    $("ldmReloadSchedule").addEventListener("click",loadSchedule);
    $("ldmApplyTemplate").addEventListener("click",applyTemplate);
    $("ldmSaveSchedule").addEventListener("click",saveSchedule);
    $("ldmClearSchedule").addEventListener("click",clearSchedule);
  }

  function daysInMonth(month){
    const [y,m]=String(month).split("-").map(Number);
    return new Date(Date.UTC(y,m,0)).getUTCDate();
  }

  function dayName(date){
    return new Intl.DateTimeFormat("id-ID",{weekday:"short",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));
  }

  function rowDefault(date,status="OFF",shift="Shift 1",start="08:00",end="16:00",grace=30,note=""){
    return {date,status,shift:status==="WORK"?shift:null,start:status==="WORK"?start:null,end:status==="WORK"?end:null,grace:Number(grace)||0,note:note||""};
  }

  function renderRows(){
    const body=$("ldmScheduleBody");
    if(!body)return;
    if(!scheduleRows.length){body.innerHTML='<tr><td colspan="8">Belum ada jadwal yang dimuat.</td></tr>';return;}
    body.innerHTML=scheduleRows.map((r,index)=>{
      const isWork=r.status==="WORK";
      const cls=r.status==="OFF"?"is-off":r.status==="ANNUAL_LEAVE"?"is-leave":"";
      return `<tr class="${cls}" data-row="${index}">
        <td><strong>${esc(r.date)}</strong></td><td>${esc(dayName(r.date))}</td>
        <td><select data-field="status"><option value="WORK" ${r.status==="WORK"?"selected":""}>Kerja</option><option value="OFF" ${r.status==="OFF"?"selected":""}>Libur</option><option value="ANNUAL_LEAVE" ${r.status==="ANNUAL_LEAVE"?"selected":""}>Cuti Tahunan</option></select></td>
        <td><select data-field="shift" ${isWork?"":"disabled"}><option ${r.shift==="Shift 1"?"selected":""}>Shift 1</option><option ${r.shift==="Shift 2"?"selected":""}>Shift 2</option><option ${r.shift==="Full Day"?"selected":""}>Full Day</option></select></td>
        <td><input data-field="start" type="time" value="${esc(r.start||"")}" ${isWork?"":"disabled"}></td>
        <td><input data-field="end" type="time" value="${esc(r.end||"")}" ${isWork?"":"disabled"}></td>
        <td><input data-field="grace" type="number" min="0" max="240" value="${Number(r.grace)||0}" ${isWork?"":"disabled"}></td>
        <td><input data-field="note" maxlength="180" value="${esc(r.note||"")}" placeholder="Opsional"></td>
      </tr>`;
    }).join("");

    body.querySelectorAll("tr[data-row]").forEach(tr=>{
      const index=Number(tr.dataset.row);
      tr.querySelectorAll("[data-field]").forEach(input=>input.addEventListener("change",()=>{
        const field=input.dataset.field;
        let value=input.value;
        if(field==="grace")value=Number(value)||0;
        scheduleRows[index][field]=value;
        if(field==="status"){
          if(value!=="WORK"){
            scheduleRows[index].shift=null;scheduleRows[index].start=null;scheduleRows[index].end=null;
          }else{
            scheduleRows[index].shift=scheduleRows[index].shift||$("ldmTemplateShift").value;
            scheduleRows[index].start=scheduleRows[index].start||$("ldmTemplateStart").value;
            scheduleRows[index].end=scheduleRows[index].end||$("ldmTemplateEnd").value;
            scheduleRows[index].grace=Number($("ldmTemplateGrace").value)||30;
          }
          renderRows();
        }
      }));
    });
  }

  async function loadStores(){
    if(role()!=="owner")return;
    stores=await window.LDMWorkforce.stores();
    const select=$("ldmWorkforceStore");
    select.innerHTML=stores.map(s=>`<option value="${esc(s.store_id)}">${esc(s.store_name)} (${esc(s.store_code)})${s.is_primary?" · Pusat":""}</option>`).join("");
    const current=localStorage.getItem("ldmCloudStoreId");
    if(current && stores.some(s=>s.store_id===current))select.value=current;
    await loadAccounts();
  }

  async function loadAccounts(){
    const storeId=$("ldmWorkforceStore")?.value;
    if(!storeId)return;
    const year=Number($("ldmLeaveYear")?.value)||new Date().getFullYear();
    try{
      accounts=await window.LDMWorkforce.accounts({storeId,year});
      const select=$("ldmWorkforceUser");
      select.innerHTML=accounts.map(a=>`<option value="${esc(a.user_id)}">${esc(a.display_name||a.username)} · ${esc(a.role)}${a.is_primary_owner?" · Owner Pusat":""}</option>`).join("");
      await selectAccount(true);
    }catch(error){
      notify(error.message||String(error),"danger");
    }
  }

  async function selectAccount(load=true){
    const id=$("ldmWorkforceUser")?.value;
    selectedAccount=accounts.find(a=>a.user_id===id)||null;
    if(!selectedAccount){renderRows();return;}
    $("ldmLeaveEntitlement").value=Number(selectedAccount.entitled_days)||0;
    $("ldmLeaveSummary").textContent=`Hak ${Number(selectedAccount.entitled_days)||0} hari · terpakai ${Number(selectedAccount.used_leave_days)||0} hari · sisa ${Number(selectedAccount.remaining_leave_days)||0} hari.`;
    $("ldmClearSchedule").hidden=!selectedAccount.is_primary_owner;
    notify(selectedAccount.is_primary_owner?"Owner Pusat boleh memiliki jadwal kosong. Jika jadwal diisi, aturan shift tetap diberlakukan pada tanggal tersebut.":"Jadwal akun ini wajib lengkap untuk seluruh tanggal pada bulan yang dipilih.",selectedAccount.is_primary_owner?"warning":"");
    if(load)await loadSchedule();
  }

  async function loadSchedule(){
    const request=++managerRequest;
    if(!selectedAccount)return;
    try{
      const rows=await window.LDMWorkforce.scheduleMonth({storeId:$("ldmWorkforceStore").value,userId:selectedAccount.user_id,month:$("ldmWorkforceMonth").value});
      if(request!==managerRequest)return;
      scheduleRows=rows.map(r=>({date:r.schedule_date,status:r.schedule_status,shift:r.shift_label,start:r.planned_start_time?String(r.planned_start_time).slice(0,5):null,end:r.planned_end_time?String(r.planned_end_time).slice(0,5):null,grace:Number(r.grace_minutes)||30,note:r.note||""}));
      renderRows();
      notify(scheduleRows.length?`Jadwal ${scheduleRows.length} tanggal berhasil dimuat.`:(selectedAccount.is_primary_owner?"Belum ada jadwal. Untuk Owner Pusat ini diperbolehkan.":"Belum ada jadwal. Terapkan template lalu simpan satu bulan penuh."),scheduleRows.length?"success":"warning");
    }catch(error){notify(error.message||String(error),"danger");}
  }

  function applyTemplate(){
    if(!selectedAccount)return;
    const month=$("ldmWorkforceMonth").value;
    const workdays=new Set([...$("ldmWeekdays").querySelectorAll('input[type="checkbox"]:checked')].map(x=>Number(x.value)));
    const shift=$("ldmTemplateShift").value;
    const start=$("ldmTemplateStart").value;
    const end=$("ldmTemplateEnd").value;
    const grace=Number($("ldmTemplateGrace").value)||0;
    if(!start||!end){notify("Jam masuk dan jam keluar template wajib diisi.","danger");return;}
    const count=daysInMonth(month);
    scheduleRows=[];
    for(let d=1;d<=count;d++){
      const date=`${month}-${String(d).padStart(2,"0")}`;
      const dow=new Date(`${date}T00:00:00Z`).getUTCDay();
      scheduleRows.push(rowDefault(date,workdays.has(dow)?"WORK":"OFF",shift,start,end,grace,""));
    }
    renderRows();
    notify("Template satu bulan dibuat. Periksa tanggal libur/cuti lalu simpan.","success");
  }

  async function saveLeave(){
    if(!selectedAccount)return;
    const button=$("ldmSaveLeave");button.disabled=true;
    try{
      const result=await window.LDMWorkforce.setLeaveEntitlement({storeId:$("ldmWorkforceStore").value,userId:selectedAccount.user_id,year:Number($("ldmLeaveYear").value),days:Number($("ldmLeaveEntitlement").value)});
      notify(`Hak cuti disimpan: ${result.entitled_days} hari, terpakai ${result.used_days} hari, sisa ${result.remaining_days} hari.`,"success");
      await loadAccounts();
    }catch(error){notify(error.message||String(error),"danger");}finally{button.disabled=false;}
  }

  function payloadRows(){
    return scheduleRows.map(r=>({date:r.date,status:r.status,shift:r.status==="WORK"?r.shift:null,start:r.status==="WORK"?r.start:null,end:r.status==="WORK"?r.end:null,grace:r.status==="WORK"?Number(r.grace)||0:0,note:r.note||""}));
  }

  async function saveSchedule(){
    if(!selectedAccount)return;
    if(!scheduleRows.length && !selectedAccount.is_primary_owner){notify("Jadwal karyawan wajib diisi satu bulan penuh.","danger");return;}
    const workInvalid=scheduleRows.find(r=>r.status==="WORK"&&(!r.shift||!r.start||!r.end));
    if(workInvalid){notify(`Tanggal ${workInvalid.date}: shift, jam masuk, dan jam keluar wajib lengkap.`,"danger");return;}
    const button=$("ldmSaveSchedule");button.disabled=true;
    try{
      const result=await window.LDMWorkforce.saveMonth({storeId:$("ldmWorkforceStore").value,userId:selectedAccount.user_id,month:$("ldmWorkforceMonth").value,rows:payloadRows()});
      notify(`Jadwal tersimpan: ${result.rows} tanggal. Sisa cuti tahunan ${result.leave_remaining} hari.`,"success");
      await loadAccounts();
    }catch(error){notify(error.message||String(error),"danger");}finally{button.disabled=false;}
  }

  async function clearSchedule(){
    if(!selectedAccount?.is_primary_owner)return;
    const ok=window.confirm("Kosongkan jadwal Owner Pusat untuk bulan ini? Owner Pusat tetap dapat absensi dengan memilih shift secara manual.");
    if(!ok)return;
    try{
      await window.LDMWorkforce.saveMonth({storeId:$("ldmWorkforceStore").value,userId:selectedAccount.user_id,month:$("ldmWorkforceMonth").value,rows:[]});
      scheduleRows=[];renderRows();notify("Jadwal Owner Pusat dikosongkan untuk bulan ini.","success");
    }catch(error){notify(error.message||String(error),"danger");}
  }

  async function selectedAttendanceUser(){
    const username=$("selectAkunAbsen")?.value;
    if(!username || !window.LDMAttendance)return null;
    const profiles=window.LDMAttendance.readProfilesCache?window.LDMAttendance.readProfilesCache():[];
    return profiles.find(p=>String(p.username||"").trim().toLowerCase()===String(username).trim().toLowerCase())||null;
  }

  function ensureScheduleBanner(){
    if($("ldmScheduleRule"))return $("ldmScheduleRule");
    const form=$("formAbsensi");if(!form)return null;
    const div=document.createElement("div");div.id="ldmScheduleRule";div.className="ldm-schedule-rule";
    form.insertBefore(div,form.firstElementChild);
    return div;
  }

  async function applyAttendanceScheduleRule(){
    const request=++attendanceRuleRequest;
    const banner=ensureScheduleBanner();
    const submit=$("btnSubmitAbsen");
    const shift=$("selectShift");
    if(!banner||!submit||!shift)return;
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
          banner.textContent="Jadwal kerja hari ini belum diatur Owner. Presensi ditolak sampai jadwal tersedia.";
          shift.disabled=true;submit.disabled=true;
        }
        return;
      }
      if(rule.status==="OFF"){
        banner.className="ldm-schedule-rule show off";
        banner.textContent="Hari ini adalah Libur terjadwal. Tidak ada kewajiban presensi dan tidak akan muncul peringatan tidak absen.";
        shift.disabled=true;submit.disabled=true;return;
      }
      if(rule.status==="ANNUAL_LEAVE"){
        banner.className="ldm-schedule-rule show off";
        banner.textContent="Hari ini adalah Cuti Tahunan. Tidak ada kewajiban presensi dan tidak akan muncul peringatan tidak absen.";
        shift.disabled=true;submit.disabled=true;return;
      }
      shift.value=rule.shift_label||"Shift 1";
      shift.disabled=true;submit.disabled=false;
      banner.className="ldm-schedule-rule show work";
      banner.textContent=`Jadwal hari ini: ${rule.shift_label} · ${rule.planned_start_time||"-"} - ${rule.planned_end_time||"-"} WITA · toleransi masuk ${Number(rule.grace_minutes)||0} menit. Shift dikunci sesuai jadwal.`;
    }catch(error){
      banner.className="ldm-schedule-rule show blocked";
      banner.textContent="Jadwal belum dapat diverifikasi. Muat ulang halaman sebelum melakukan presensi.";
      submit.disabled=true;shift.disabled=true;
    }
  }

  function bindAttendanceRule(){
    const user=$("selectAkunAbsen");
    const type=$("selectJenisAbsen");
    if(user)user.addEventListener("change",applyAttendanceScheduleRule);
    if(type)type.addEventListener("change",applyAttendanceScheduleRule);
    window.addEventListener("ldm-attendance-profiles-updated",applyAttendanceScheduleRule);
    window.addEventListener("ldm-attendance-ready",applyAttendanceScheduleRule);
    setTimeout(applyAttendanceScheduleRule,400);
  }

  async function boot(){
    if(!window.LDMWorkforce)return;
    insertExceptionLink();
    injectManagement();
    bindAttendanceRule();
    if(role()==="owner"){
      try{await loadStores();}catch(error){notify(error.message||String(error),"danger");}
    }
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();

  window.LDMAttendanceWorkforceUI=Object.freeze({
    refreshScheduleRule:applyAttendanceScheduleRule,
    refreshOwnerManager:loadStores,
    reasonLabel
  });
})();

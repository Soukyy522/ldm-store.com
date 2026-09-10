(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const role=()=>String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
  const nowParts=()=>{
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Makassar",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    return Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  };
  const monthNow=()=>{const p=nowParts();return `${p.year}-${p.month}`;};
  const dayName=date=>new Intl.DateTimeFormat("id-ID",{weekday:"short",day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));

  let stores=[];
  let accounts=[];
  let selectedAccount=null;
  let scheduleRows=[];
  let requestId=0;

  function notify(text,type=""){
    const box=$("masterMessage");
    if(!box)return;
    box.className=`wf-notice ${type}`.trim();
    box.textContent=text;
  }

  function deny(){
    document.body.innerHTML='<main class="wf-shell wf-access-denied"><section class="wf-card"><h2>🔒 Akses Owner Diperlukan</h2><p>Master Shift hanya dapat dibuka oleh role Owner.</p><a class="wf-link-btn soft" href="dashboard.html">Kembali ke Dashboard</a></section></main>';
  }

  function daysInMonth(month){
    const [year,monthNumber]=String(month||"").split("-").map(Number);
    return year&&monthNumber?new Date(Date.UTC(year,monthNumber,0)).getUTCDate():0;
  }

  function rowDefault(date,status="OFF",shift="Shift 1",start="08:00",end="16:00",grace=30,note=""){
    return {date,status,shift:status==="WORK"?shift:null,start:status==="WORK"?start:null,end:status==="WORK"?end:null,grace:Number(grace)||0,note:note||""};
  }

  function updateStats(){
    const work=scheduleRows.filter(r=>r.status==="WORK").length;
    const off=scheduleRows.filter(r=>r.status==="OFF").length;
    const leave=scheduleRows.filter(r=>r.status==="ANNUAL_LEAVE").length;
    $("statWork").textContent=work;
    $("statOff").textContent=off;
    $("statLeave").textContent=leave;
    $("statLeaveRight").textContent=Number(selectedAccount?.entitled_days)||0;
    $("statLeaveRemain").textContent=Number(selectedAccount?.remaining_leave_days)||0;
  }

  function renderRows(){
    const body=$("masterScheduleBody");
    if(!scheduleRows.length){
      body.innerHTML='<tr><td colspan="5">Belum ada jadwal. Gunakan Template Cepat untuk membuat jadwal satu bulan.</td></tr>';
      updateStats();
      return;
    }
    body.innerHTML=scheduleRows.map((row,index)=>{
      const work=row.status==="WORK";
      const cls=row.status==="OFF"?"is-off":row.status==="ANNUAL_LEAVE"?"is-leave":"";
      return `<tr class="${cls}" data-row="${index}">
        <td class="wf-date"><strong>${esc(String(row.date).slice(8,10))}</strong><small>${esc(dayName(row.date))}</small></td>
        <td><select data-field="status"><option value="WORK" ${row.status==="WORK"?"selected":""}>Kerja</option><option value="OFF" ${row.status==="OFF"?"selected":""}>Libur</option><option value="ANNUAL_LEAVE" ${row.status==="ANNUAL_LEAVE"?"selected":""}>Cuti Tahunan</option></select></td>
        <td><select data-field="shift" ${work?"":"disabled"}><option ${row.shift==="Shift 1"?"selected":""}>Shift 1</option><option ${row.shift==="Shift 2"?"selected":""}>Shift 2</option><option ${row.shift==="Full Day"?"selected":""}>Full Day</option></select></td>
        <td><div class="wf-time-pair"><input data-field="start" type="time" value="${esc(row.start||"")}" ${work?"":"disabled"}><span>–</span><input data-field="end" type="time" value="${esc(row.end||"")}" ${work?"":"disabled"}></div></td>
        <td><input data-field="note" maxlength="180" value="${esc(row.note||"")}" placeholder="Opsional"></td>
      </tr>`;
    }).join("");

    body.querySelectorAll("tr[data-row]").forEach(tr=>{
      const index=Number(tr.dataset.row);
      tr.querySelectorAll("[data-field]").forEach(input=>input.addEventListener("change",()=>{
        const field=input.dataset.field;
        scheduleRows[index][field]=input.value;
        if(field==="status"){
          if(input.value!=="WORK"){
            scheduleRows[index].shift=null;
            scheduleRows[index].start=null;
            scheduleRows[index].end=null;
          }else{
            scheduleRows[index].shift=scheduleRows[index].shift||$("masterTemplateShift").value;
            scheduleRows[index].start=scheduleRows[index].start||$("masterTemplateStart").value;
            scheduleRows[index].end=scheduleRows[index].end||$("masterTemplateEnd").value;
            scheduleRows[index].grace=Number($("masterTemplateGrace").value)||30;
          }
          renderRows();
        }else{
          updateStats();
        }
      }));
    });
    updateStats();
  }

  async function loadStores(){
    stores=await window.LDMWorkforce.stores();
    const select=$("masterStore");
    select.innerHTML=stores.map(store=>`<option value="${esc(store.store_id)}">${esc(store.store_name)} (${esc(store.store_code)})${store.is_primary?" · Pusat":""}</option>`).join("");
    const current=localStorage.getItem("ldmCloudStoreId");
    if(current&&stores.some(store=>store.store_id===current))select.value=current;
    await loadAccounts();
  }

  async function loadAccounts(preferredUserId=""){
    const storeId=$("masterStore").value;
    if(!storeId)return;
    const year=Number(String($("masterMonth").value||monthNow()).slice(0,4));
    $("masterLeaveYear").value=String(year);
    accounts=await window.LDMWorkforce.accounts({storeId,year});
    const select=$("masterUser");
    select.innerHTML=accounts.map(account=>`<option value="${esc(account.user_id)}">${esc(account.display_name||account.username)} · ${esc(account.role)}${account.is_primary_owner?" · Owner Pusat":""}</option>`).join("");
    if(preferredUserId&&accounts.some(account=>account.user_id===preferredUserId))select.value=preferredUserId;
    await selectAccount(true);
  }

  async function selectAccount(loadSchedule=true){
    selectedAccount=accounts.find(account=>account.user_id===$("masterUser").value)||null;
    if(!selectedAccount){
      scheduleRows=[];
      renderRows();
      $("masterLeaveSummary").textContent="Tidak ada akun aktif pada cabang ini.";
      return;
    }
    $("masterLeaveDays").value=Number(selectedAccount.entitled_days)||0;
    $("masterLeaveSummary").textContent=`Hak ${Number(selectedAccount.entitled_days)||0} hari · terpakai ${Number(selectedAccount.used_leave_days)||0} hari · sisa ${Number(selectedAccount.remaining_leave_days)||0} hari.`;
    $("masterClear").hidden=!selectedAccount.is_primary_owner;
    updateStats();
    notify(selectedAccount.is_primary_owner?"Jadwal akun Owner Pusat bersifat opsional. Bila diisi, aturan shift tetap diberlakukan.":"Jadwal akun ini wajib lengkap untuk seluruh tanggal pada bulan yang dipilih.",selectedAccount.is_primary_owner?"warning":"");
    if(loadSchedule)await loadScheduleMonth();
  }

  async function loadScheduleMonth(){
    if(!selectedAccount)return;
    const currentRequest=++requestId;
    try{
      const rows=await window.LDMWorkforce.scheduleMonth({storeId:$("masterStore").value,userId:selectedAccount.user_id,month:$("masterMonth").value});
      if(currentRequest!==requestId)return;
      scheduleRows=rows.map(row=>({
        date:row.schedule_date,status:row.schedule_status,shift:row.shift_label,
        start:row.planned_start_time?String(row.planned_start_time).slice(0,5):null,
        end:row.planned_end_time?String(row.planned_end_time).slice(0,5):null,
        grace:Number(row.grace_minutes)||30,note:row.note||""
      }));
      renderRows();
      notify(scheduleRows.length?`Jadwal ${scheduleRows.length} tanggal berhasil dimuat.`:(selectedAccount.is_primary_owner?"Belum ada jadwal. Untuk Owner Pusat ini diperbolehkan.":"Belum ada jadwal. Gunakan Template Cepat lalu simpan."),scheduleRows.length?"success":"warning");
    }catch(error){notify(error.message||String(error),"danger");}
  }

  function applyTemplate(){
    if(!selectedAccount){notify("Pilih akun terlebih dahulu.","danger");return;}
    const month=$("masterMonth").value;
    const start=$("masterTemplateStart").value;
    const end=$("masterTemplateEnd").value;
    if(!month||!start||!end){notify("Bulan, jam masuk, dan jam keluar wajib diisi.","danger");return;}
    const checked=new Set([...$("masterWeekdays").querySelectorAll('input[type="checkbox"]:checked')].map(input=>Number(input.value)));
    const shift=$("masterTemplateShift").value;
    const grace=Number($("masterTemplateGrace").value)||0;
    const total=daysInMonth(month);
    scheduleRows=[];
    for(let day=1;day<=total;day++){
      const date=`${month}-${String(day).padStart(2,"0")}`;
      const weekDay=new Date(`${date}T00:00:00Z`).getUTCDay();
      scheduleRows.push(rowDefault(date,checked.has(weekDay)?"WORK":"OFF",shift,start,end,grace,""));
    }
    renderRows();
    notify("Template selesai dibuat. Ubah tanggal khusus bila ada Libur atau Cuti, lalu Simpan Jadwal Bulan.","success");
  }

  function payloadRows(){
    return scheduleRows.map(row=>({
      date:row.date,status:row.status,
      shift:row.status==="WORK"?row.shift:null,
      start:row.status==="WORK"?row.start:null,
      end:row.status==="WORK"?row.end:null,
      grace:row.status==="WORK"?Number(row.grace)||Number($("masterTemplateGrace").value)||0:0,
      note:row.note||""
    }));
  }

  async function saveSchedule(){
    if(!selectedAccount)return;
    const expected=daysInMonth($("masterMonth").value);
    if(!selectedAccount.is_primary_owner&&scheduleRows.length!==expected){notify(`Jadwal wajib lengkap ${expected} tanggal untuk bulan ini.`,"danger");return;}
    const invalid=scheduleRows.find(row=>row.status==="WORK"&&(!row.shift||!row.start||!row.end));
    if(invalid){notify(`Tanggal ${invalid.date}: shift, jam masuk, dan jam keluar wajib lengkap.`,"danger");return;}
    const button=$("masterSave");button.disabled=true;
    try{
      const result=await window.LDMWorkforce.saveMonth({storeId:$("masterStore").value,userId:selectedAccount.user_id,month:$("masterMonth").value,rows:payloadRows()});
      notify(`Jadwal tersimpan: ${result.rows} tanggal. Sisa cuti tahunan ${result.leave_remaining} hari.`,"success");
      await loadAccounts(selectedAccount.user_id);
    }catch(error){notify(error.message||String(error),"danger");}
    finally{button.disabled=false;}
  }

  async function saveLeave(){
    if(!selectedAccount)return;
    const button=$("masterSaveLeave");button.disabled=true;
    try{
      const result=await window.LDMWorkforce.setLeaveEntitlement({storeId:$("masterStore").value,userId:selectedAccount.user_id,year:Number($("masterLeaveYear").value),days:Number($("masterLeaveDays").value)});
      notify(`Hak cuti disimpan: ${result.entitled_days} hari · terpakai ${result.used_days} · sisa ${result.remaining_days}.`,"success");
      await loadAccounts(selectedAccount.user_id);
    }catch(error){notify(error.message||String(error),"danger");}
    finally{button.disabled=false;}
  }

  async function clearSchedule(){
    if(!selectedAccount?.is_primary_owner)return;
    if(!window.confirm("Kosongkan jadwal akun Owner Pusat untuk bulan ini?"))return;
    try{
      await window.LDMWorkforce.saveMonth({storeId:$("masterStore").value,userId:selectedAccount.user_id,month:$("masterMonth").value,rows:[]});
      scheduleRows=[];renderRows();notify("Jadwal Owner Pusat dikosongkan untuk bulan ini.","success");
    }catch(error){notify(error.message||String(error),"danger");}
  }

  function bind(){
    $("masterStore").addEventListener("change",()=>loadAccounts().catch(error=>notify(error.message||String(error),"danger")));
    $("masterMonth").addEventListener("change",()=>loadAccounts(selectedAccount?.user_id||"").catch(error=>notify(error.message||String(error),"danger")));
    $("masterUser").addEventListener("change",()=>selectAccount(true));
    $("masterReload").addEventListener("click",()=>loadStores().catch(error=>notify(error.message||String(error),"danger")));
    $("masterApplyTemplate").addEventListener("click",applyTemplate);
    $("masterSave").addEventListener("click",saveSchedule);
    $("masterSaveLeave").addEventListener("click",saveLeave);
    $("masterClear").addEventListener("click",clearSchedule);
  }

  async function boot(){
    if(!window.LDMWorkforce)return;
    $("masterMonth").value=monthNow();
    $("masterLeaveYear").value=monthNow().slice(0,4);
    try{
      await window.LDMWorkforce.context();
      if(role()!=="owner"){deny();return;}
      bind();
      await loadStores();
    }catch(error){
      if(/OWNER_REQUIRED|FORBIDDEN|role Owner/i.test(String(error?.message||error))){deny();return;}
      notify("Master Shift belum dapat dimuat. "+(error.message||String(error)),"danger");
    }
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();

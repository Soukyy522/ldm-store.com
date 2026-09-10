(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const role=()=>String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
  const roleLabel=value=>({owner:"Owner",admin:"Admin",kasir:"Kasir"}[String(value||"").toLowerCase()]||value||"-");
  const reasonLabel=value=>({
    SAKIT_KONDISI:"Sakit / kondisi kesehatan",
    KEPERLUAN_KELUARGA:"Keperluan keluarga mendesak",
    KENDALA_TRANSPORTASI:"Kendala transportasi / perjalanan",
    KENDALA_SISTEM:"Kendala perangkat, jaringan, atau sistem absensi",
    LUPA_KELALAIAN:"Lupa / kelalaian melakukan absensi",
    KEADAAN_DARURAT:"Keadaan darurat",
    LAINNYA:"Lainnya",
    LUPA_ABSEN:"Lupa / kelalaian melakukan absensi",
    KENDALA_PERANGKAT:"Kendala perangkat, jaringan, atau sistem absensi",
    KENDALA_JARINGAN:"Kendala perangkat, jaringan, atau sistem absensi"
  }[value]||value||"-");
  const statusLabel=value=>value==="REVIEWED"?"Sudah Ditinjau":"Dikirim";
  const dateID=value=>{
    if(!value)return "-";
    const date=new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    return new Intl.DateTimeFormat("id-ID",{dateStyle:"long",timeZone:"UTC"}).format(date);
  };
  const time=value=>value?String(value).slice(0,5):"-";
  let candidateRows=[];
  let myRows=[];

  function message(text,type=""){
    const box=$("absenceMessage");
    box.className=`wf-notice ${type}`.trim();
    box.textContent=text;
  }

  function updateStats(){
    $("absenceCandidateCount").textContent=candidateRows.filter(row=>!row.explanation_status).length;
    $("absenceSubmittedCount").textContent=myRows.filter(row=>row.status!=="REVIEWED").length;
    $("absenceReviewedCount").textContent=myRows.filter(row=>row.status==="REVIEWED").length;
    $("absenceRole").textContent=roleLabel(role());
  }

  async function loadCandidates(){
    candidateRows=await window.LDMWorkforce.explanationCandidates(62);
    const select=$("absenceDate");
    select.innerHTML=candidateRows.map(row=>`<option value="${esc(row.attendance_date)}" ${row.explanation_status?"disabled":""}>${esc(dateID(row.attendance_date))} · ${esc(row.shift_label||"-")} ${esc(time(row.planned_start_time))}-${esc(time(row.planned_end_time))}${row.explanation_status?` · ${esc(statusLabel(row.explanation_status))}`:""}</option>`).join("");
    const available=candidateRows.some(row=>!row.explanation_status);
    $("absenceSubmit").disabled=!available;
    if(!available)message("Tidak ada jadwal kerja terlewat yang perlu dijelaskan. Hari Libur dan Cuti Tahunan tidak dimasukkan.");
    else message(`${candidateRows.filter(row=>!row.explanation_status).length} tanggal kerja tersedia untuk dijelaskan.`);
    updateStats();
  }

  async function loadMine(){
    myRows=await window.LDMWorkforce.myExplanations();
    $("absenceMine").innerHTML=myRows.length?myRows.map(row=>`<article class="wf-item"><div class="wf-item-head"><div><h3>${esc(dateID(row.attendance_date))}</h3><small>${esc(reasonLabel(row.reason_category))}</small></div><span class="wf-tag ${row.status==="REVIEWED"?"reviewed":""}">${esc(statusLabel(row.status))}</span></div><p>${esc(row.explanation)}</p>${row.review_note?`<p><strong>Catatan Owner:</strong> ${esc(row.review_note)}</p>`:""}</article>`).join(""):'<div class="wf-empty">Belum ada pengajuan ketidakhadiran.</div>';
    updateStats();
  }

  async function submit(event){
    event.preventDefault();
    const button=$("absenceSubmit");
    button.disabled=true;
    try{
      await window.LDMWorkforce.submitExplanation({date:$("absenceDate").value,reason:$("absenceReason").value,explanation:$("absenceText").value});
      $("absenceText").value="";
      message("Penjelasan ketidakhadiran berhasil dikirim ke Owner yang berwenang.","success");
      await Promise.all([loadCandidates(),loadMine()]);
      if(role()==="owner")await loadInbox();
    }catch(error){message(error.message||String(error),"danger");}
    finally{button.disabled=!$("absenceDate").value;}
  }

  async function loadOwnerStores(){
    if(role()!=="owner")return;
    $("absenceOwnerInbox").hidden=false;
    const stores=await window.LDMWorkforce.stores();
    const select=$("absenceStore");
    const all=stores.length>1?'<option value="">Semua cabang</option>':"";
    select.innerHTML=all+stores.map(store=>`<option value="${esc(store.store_id)}">${esc(store.store_name)} (${esc(store.store_code)})${store.is_primary?" · Pusat":""}</option>`).join("");
    if(stores.length===1){select.value=stores[0].store_id;$("absenceScope").textContent="Cabang Ini";}else{$("absenceScope").textContent="Semua Cabang";}
    await loadInbox();
  }

  async function loadInbox(){
    if(role()!=="owner")return;
    const storeId=$("absenceStore").value||null;
    try{
      const rows=await window.LDMWorkforce.explanationInbox({storeId});
      $("absenceInbox").innerHTML=rows.length?rows.map(row=>`<article class="wf-item"><div class="wf-item-head"><div><h3>${esc(row.display_name||row.username)} · ${esc(row.store_name)}</h3><small>${esc(dateID(row.attendance_date))} · ${esc(row.shift_label||"-")} ${esc(time(row.planned_start_time))}-${esc(time(row.planned_end_time))}</small></div><span class="wf-tag ${row.status==="REVIEWED"?"reviewed":""}">${esc(statusLabel(row.status))}</span></div><div class="wf-tags"><span class="wf-tag">${esc(reasonLabel(row.reason_category))}</span><span class="wf-tag">${esc(roleLabel(row.role))}</span><span class="wf-tag">${esc(row.store_code)}</span></div><p>${esc(row.explanation)}</p>${row.review_note?`<p><strong>Catatan review:</strong> ${esc(row.review_note)}</p>`:""}${row.status!=="REVIEWED"?`<div class="wf-actions" style="margin-top:10px"><button class="wf-btn primary" type="button" data-review="${esc(row.id)}">Tandai Ditinjau</button></div>`:""}</article>`).join(""):'<div class="wf-empty">Tidak ada pengajuan pada cakupan cabang ini.</div>';
      $("absenceInbox").querySelectorAll("[data-review]").forEach(button=>button.addEventListener("click",()=>review(button.dataset.review)));
    }catch(error){$("absenceInbox").innerHTML=`<div class="wf-notice danger">${esc(error.message||String(error))}</div>`;}
  }

  async function review(id){
    const note=window.prompt("Catatan review Owner (opsional):","");
    if(note===null)return;
    try{
      await window.LDMWorkforce.reviewExplanation({id,note});
      await Promise.all([loadInbox(),loadMine()]);
    }catch(error){window.alert(error.message||String(error));}
  }

  async function boot(){
    if(!window.LDMWorkforce)return;
    try{
      await window.LDMWorkforce.context();
      $("absenceForm").addEventListener("submit",submit);
      $("absenceReload").addEventListener("click",loadInbox);
      $("absenceStore").addEventListener("change",()=>{loadInbox();$("absenceScope").textContent=$("absenceStore").value?"Cabang Dipilih":"Semua Cabang";});
      await Promise.all([loadCandidates(),loadMine()]);
      await loadOwnerStores();
    }catch(error){message("Halaman Ketidakhadiran belum dapat dimuat. "+(error.message||String(error)),"danger");}
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();

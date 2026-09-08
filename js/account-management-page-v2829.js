(function(){
  "use strict";

  let currentContext=null;
  let accounts=[];
  let archivedAccounts=[];
  let selected=null;
  let currentRole="";
  let refreshPromise=null;
  let realtimeStarted=false;
  let realtimeTimer=null;

  const $=id=>document.getElementById(id);

  function esc(value){
    return String(value??"").replace(/[&<>"']/g,char=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[char]);
  }

  function fmt(value){
    if(!value)return "-";
    try{
      return new Intl.DateTimeFormat("id-ID",{
        year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",
        timeZone:"Asia/Makassar"
      }).format(new Date(value))+" WITA";
    }catch{
      return String(value);
    }
  }

  function showMessage(text,type="success"){
    const box=$("message");
    if(!box)return;
    box.style.display="block";
    box.className="card "+(type==="error"?"error":"successbox");
    box.textContent=text;
  }

  function hideMessage(){
    const box=$("message");
    if(box)box.style.display="none";
  }

  function stat(label,value){
    return `<div class="stat"><span>${esc(label)}</span><strong>${esc(value ?? 0)}</strong></div>`;
  }

  function renderHealth(data){
    const host=$("stats");
    if(!host)return;
    const h=data||{};
    host.innerHTML=[
      stat("Total Akun",h.total_profiles),
      stat("Aktif",h.active_profiles),
      stat("Nonaktif",h.inactive_profiles),
      stat("Owner Aktif",h.active_owners),
      stat("Admin Aktif",h.active_admins),
      stat("Kasir Aktif",h.active_cashiers)
    ].join("");
  }

  function renderHealthUnavailable(){
    const host=$("stats");
    if(!host)return;
    host.innerHTML=[
      stat("Total Akun","-"),
      stat("Aktif","-"),
      stat("Nonaktif","-"),
      stat("Owner Aktif","-"),
      stat("Admin Aktif","-"),
      stat("Kasir Aktif","-")
    ].join("");
  }

  function applyRole(){
    const owner=currentRole==="owner";

    document.querySelectorAll(".owner-only").forEach(element=>{
      if(!owner){
        element.style.display="none";
        return;
      }
      element.style.display=element.classList.contains("card")?"block":"inline-flex";
    });

    const access=$("accessNote");
    if(access){
      access.textContent=owner
        ?"Owner: dapat melihat, membuat, mengedit, menonaktifkan, dan mengaktifkan kembali akun."
        :currentRole==="admin"
          ?"Admin: dapat melihat daftar akun toko. Perubahan akun hanya dapat dilakukan Owner."
          :"Kasir: hanya melihat akun sendiri dan dapat mengganti password sendiri.";
    }

    const note=$("listNote");
    if(note){
      note.textContent=owner
        ?"Memuat daftar akun toko…"
        :currentRole==="admin"
          ?"Memuat daftar akun toko…"
          :"Memuat akun yang sedang digunakan…";
    }
  }

  function setAccountLoading(text="Memuat daftar akun…"){
    const body=$("accountBody");
    const note=$("listNote");
    if(note)note.textContent=text;
    if(body)body.innerHTML=`<tr><td colspan="7" class="muted">${esc(text)}</td></tr>`;
  }

  function setArchivedLoading(text="Memuat akun dinonaktifkan…"){
    const body=$("archivedBody");
    if(body)body.innerHTML=`<tr><td colspan="7" class="muted">${esc(text)}</td></tr>`;
  }

  function renderAccounts(){
    const body=$("accountBody");
    const note=$("listNote");
    if(!body)return;

    if(!accounts.length){
      body.innerHTML='<tr><td colspan="7" class="muted">Tidak ada akun yang dapat ditampilkan.</td></tr>';
      if(note)note.textContent="0 akun ditemukan.";
      return;
    }

    body.innerHTML=accounts.map((account,index)=>{
      const actions=currentRole==="owner"
        ? `<div class="row-actions">
             <button onclick="openEdit(${index})">Edit</button>
             <button class="secondary" onclick="sendReset(${index})">Reset</button>
             <button class="danger" onclick="deleteAt(${index})">Hapus</button>
           </div>`
        : '<span class="muted">Hanya lihat</span>';

      return `<tr>
        <td><strong>${esc(account.username)}</strong><br><span class="muted">${esc(account.display_name||"")}</span></td>
        <td><strong>${esc(account.employee_id||"-")}</strong></td>
        <td>${esc(account.email||"Disembunyikan")}</td>
        <td><span class="badge role">${esc(String(account.role||"").toUpperCase())}</span></td>
        <td><span class="badge ${account.active?"on":"off"}">${account.active?"AKTIF":"NONAKTIF"}</span></td>
        <td>${esc(fmt(account.last_sign_in_at))}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("");

    if(note){
      note.textContent=`${accounts.length} akun ditemukan.`;
    }
  }

  function renderAccountError(error){
    const body=$("accountBody");
    const note=$("listNote");
    const message=String(error?.message||error||"Daftar akun gagal dimuat.");
    if(note)note.textContent="Daftar akun belum dapat dimuat.";
    if(body){
      body.innerHTML=`<tr><td colspan="7">
        <div class="notice" style="margin:4px 0">
          <strong>Daftar akun belum dapat dimuat.</strong><br>
          ${esc(message)}<br>
          <button type="button" style="margin-top:8px" onclick="refreshAll()">↻ Coba Lagi</button>
        </div>
      </td></tr>`;
    }
  }

  function renderArchivedAccounts(){
    const body=$("archivedBody");
    const count=$("archivedCount");
    if(count)count.textContent=`${archivedAccounts.length} akun`;
    if(!body)return;

    if(!archivedAccounts.length){
      body.innerHTML='<tr><td colspan="7" class="muted">Tidak ada akun dinonaktifkan yang dapat diaktifkan kembali.</td></tr>';
      return;
    }

    body.innerHTML=archivedAccounts.map((account,index)=>`<tr>
      <td><strong>${esc(account.username)}</strong><br><span class="muted">${esc(account.display_name||"")}</span></td>
      <td><strong>${esc(account.employee_id||"-")}</strong></td>
      <td>${esc(account.email||"-")}</td>
      <td><span class="badge role">${esc(String(account.role||"").toUpperCase())}</span></td>
      <td>${esc(fmt(account.deleted_at))}</td>
      <td><span class="badge ${account.is_banned?"off":"on"}">${account.is_banned?"DIBLOKIR":"TIDAK DIBLOKIR"}</span></td>
      <td><button class="success" onclick="reactivateAt(${index})">Aktifkan Kembali</button></td>
    </tr>`).join("");
  }

  function renderArchivedError(error){
    const body=$("archivedBody");
    if(!body)return;
    body.innerHTML=`<tr><td colspan="7" class="muted">Akun dinonaktifkan belum dapat dimuat. ${esc(error?.message||error||"")}</td></tr>`;
  }

  async function doRefresh(){
    hideMessage();
    setAccountLoading();
    renderHealthUnavailable();

    if($("archivedBody"))setArchivedLoading();

    if(!window.LDMAccounts){
      const error=new Error("Layanan Management Akun belum siap. Muat ulang aplikasi.");
      renderAccountError(error);
      showMessage("❌ "+error.message,"error");
      return;
    }

    try{
      currentContext=await window.LDMAccounts.accountContext();
      currentRole=String(currentContext?.profile?.role||"").toLowerCase();
      applyRole();

      const identity=$("identity");
      if(identity){
        identity.textContent=[
          currentContext?.profile?.store_name||"LocDailyMar",
          currentContext?.profile?.store_code||"-",
          `${currentContext?.profile?.username||"-"} (${currentRole.toUpperCase()})`
        ].join(" • ");
      }

      const accountPromise=window.LDMAccounts.listAccounts(currentContext);
      const healthPromise=window.LDMAccounts.health(currentContext);
      const archivedPromise=currentRole==="owner"
        ? window.LDMAccounts.listArchivedAccounts(currentContext)
        : Promise.resolve([]);

      const [accountResult,healthResult,archivedResult]=await Promise.allSettled([
        accountPromise,healthPromise,archivedPromise
      ]);

      if(accountResult.status==="fulfilled"){
        accounts=accountResult.value||[];
        renderAccounts();
      }else{
        accounts=[];
        renderAccountError(accountResult.reason);
        showMessage("❌ "+String(accountResult.reason?.message||accountResult.reason||"Daftar akun gagal dimuat."),"error");
      }

      if(healthResult.status==="fulfilled"){
        renderHealth(healthResult.value);
      }else{
        renderHealthUnavailable();
      }

      if(currentRole==="owner"){
        if(archivedResult.status==="fulfilled"){
          archivedAccounts=archivedResult.value||[];
          renderArchivedAccounts();
        }else{
          archivedAccounts=[];
          renderArchivedError(archivedResult.reason);
        }
      }else{
        archivedAccounts=[];
      }

      if(!realtimeStarted){
        startRealtime().catch(()=>undefined);
      }
    }catch(error){
      accounts=[];
      archivedAccounts=[];
      renderAccountError(error);
      renderHealthUnavailable();
      const access=$("accessNote");
      if(access)access.textContent="Hak akses belum dapat diverifikasi.";
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  async function refreshAll(){
    if(refreshPromise)return refreshPromise;
    refreshPromise=doRefresh().finally(()=>{refreshPromise=null;});
    return refreshPromise;
  }

  async function startRealtime(){
    if(realtimeStarted || !currentContext)return;
    realtimeStarted=true;

    window.addEventListener("ldm-account-realtime-status",event=>{
      const value=String(event?.detail?.status||"").toUpperCase();
      const node=$("realtime");
      if(!node)return;
      if(value==="SUBSCRIBED")node.textContent="Pembaruan langsung: aktif";
      else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(value))node.textContent="Pembaruan langsung: terputus";
      else node.textContent="Pembaruan langsung: menyambung…";
    });

    try{
      await window.LDMAccounts.startRealtime(()=>{
        window.clearTimeout(realtimeTimer);
        realtimeTimer=window.setTimeout(()=>refreshAll(),350);
      },currentContext);
    }catch(error){
      realtimeStarted=false;
      const node=$("realtime");
      if(node)node.textContent="Pembaruan langsung: tidak aktif";
    }
  }

  async function createAccount(){
    const button=$("btnCreate");
    if(button)button.disabled=true;
    try{
      const result=await window.LDMAccounts.createAccount({
        email:$("newEmail").value,
        password:$("newPassword").value,
        username:$("newUsername").value,
        displayName:$("newDisplay").value,
        role:$("newRole").value
      });

      showMessage(`✅ Akun berhasil dibuat.\nNIK Karyawan: ${result.employee_id||"dibuat otomatis"}`);
      ["newEmail","newPassword","newUsername","newDisplay"].forEach(id=>{$(id).value="";});
      await refreshAll();
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }finally{
      if(button)button.disabled=false;
    }
  }

  function openEdit(index){
    selected=accounts[index];
    if(!selected)return;
    $("editEmail").textContent=selected.email||"";
    $("editUsername").value=selected.username||"";
    $("editDisplay").value=selected.display_name||"";
    $("editRole").value=selected.role||"kasir";
    $("editActive").value=selected.active?"true":"false";
    $("editModal").classList.add("open");
  }

  function closeEdit(){
    $("editModal").classList.remove("open");
    selected=null;
  }

  async function saveEdit(){
    if(!selected)return;
    try{
      await window.LDMAccounts.updateProfile({
        userId:selected.user_id,
        username:$("editUsername").value,
        displayName:$("editDisplay").value,
        role:$("editRole").value,
        active:$("editActive").value==="true"
      });
      closeEdit();
      showMessage("✅ Akun berhasil diperbarui.");
      await refreshAll();
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  async function sendReset(index){
    selected=accounts[index];
    await sendResetSelected();
    selected=null;
  }

  async function sendResetSelected(){
    if(!selected||!selected.email)return;
    try{
      await window.LDMAccounts.sendPasswordReset(selected.email);
      showMessage("✅ Email reset password berhasil diminta.");
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  async function deleteAt(index){
    selected=accounts[index];
    await deleteSelected();
    selected=null;
  }

  async function deleteSelected(){
    if(!selected)return;
    if(!window.confirm(
      `Hapus akun ${selected.username}?\n\nJika akun mempunyai histori, akses akun akan dinonaktifkan agar histori tetap aman.`
    ))return;

    try{
      const result=await window.LDMAccounts.deleteAccount(selected.user_id);
      closeEdit();
      showMessage(
        result.mode==="hard_deleted"
          ?"✅ Akun berhasil dihapus."
          :"✅ Akses akun dinonaktifkan. Histori lama tetap dipertahankan."
      );
      await refreshAll();
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  async function reactivateAt(index){
    const target=archivedAccounts[index];
    if(!target)return;

    if(!window.confirm(
      `Aktifkan kembali akun ${target.username}?\n\nHistori lama tetap dipertahankan. Perangkat perlu disetujui kembali oleh Owner.`
    ))return;

    try{
      await window.LDMAccounts.reactivateAccount(target.user_id);
      showMessage("✅ Akun berhasil diaktifkan kembali. Setujui ulang perangkat melalui menu Perangkat Toko.");
      await refreshAll();
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  async function changePassword(){
    const password=$("ownPassword").value;
    const confirmation=$("ownPassword2").value;
    if(password!==confirmation){
      showMessage("❌ Konfirmasi password tidak sama.","error");
      return;
    }

    try{
      await window.LDMAccounts.changeOwnPassword(password);
      $("ownPassword").value="";
      $("ownPassword2").value="";
      showMessage("✅ Password akun berhasil diubah.");
    }catch(error){
      showMessage("❌ "+String(error?.message||error),"error");
    }
  }

  Object.assign(window,{
    refreshAll,createAccount,openEdit,closeEdit,saveEdit,
    sendReset,sendResetSelected,deleteAt,deleteSelected,
    reactivateAt,changePassword
  });

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",refreshAll,{once:true});
  }else{
    refreshAll();
  }
})();

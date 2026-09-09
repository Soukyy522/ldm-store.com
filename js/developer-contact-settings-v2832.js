(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const DEFAULT={
    whatsapp:{enabled:true,number:"6287874352468",display:"+62 878-7435-2468",label:"WhatsApp Support",greeting:"Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar."},
    email:{enabled:false,address:"",label:"Email Support",subject:"Pertanyaan mengenai LocDailyMar"},
    support_center:{enabled:true,label:"Pusat Bantuan & Support"},guide:{enabled:true,label:"Panduan Pengguna"},license:{enabled:true,label:"Lisensi & Paket"}
  };
  let lastServerConfig=null;

  function clean(v,m){return String(v||"").trim().slice(0,m)}
  function phone(v){return String(v||"").replace(/\D/g,"").slice(0,20)}
  function validEmail(v){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

  function formData(){return {
    whatsapp:{enabled:$("waEnabled").checked,number:phone($("waNumber").value),display:clean($("waDisplay").value,40),label:clean($("waLabel").value,60),greeting:clean($("waGreeting").value,240)},
    email:{enabled:$("emailEnabled").checked,address:clean($("supportEmail").value,160).toLowerCase(),label:clean($("emailLabel").value,60),subject:clean($("emailSubject").value,160)},
    support_center:{enabled:$("supportEnabled").checked,label:clean($("supportLabel").value,70)},
    guide:{enabled:$("guideEnabled").checked,label:clean($("guideLabel").value,70)},
    license:{enabled:$("licenseEnabled").checked,label:clean($("licenseLabel").value,70)}
  }}
  function validate(d){
    if(d.whatsapp.enabled&&!/^\d{8,20}$/.test(d.whatsapp.number))throw new Error("Nomor WhatsApp harus 8-20 digit format internasional, contoh 628123456789.");
    if(d.email.enabled&&(!d.email.address||!validEmail(d.email.address)))throw new Error("Alamat Email Support tidak valid.");
    if(d.whatsapp.enabled&&(!d.whatsapp.label||!d.whatsapp.greeting))throw new Error("Label dan pesan pembuka WhatsApp wajib diisi.");
    if(d.email.enabled&&(!d.email.label||!d.email.subject))throw new Error("Label dan subjek Email wajib diisi.");
    if(!d.whatsapp.enabled&&!d.email.enabled&&!d.support_center.enabled&&!d.guide.enabled&&!d.license.enabled)throw new Error("Aktifkan minimal satu jalur kontak publik.");
  }
  function showMessage(text,type="ok"){$("message").textContent=text||"";$("message").className=`message show ${type}`}
  function status(text){$("serverStatus").textContent=text||""}

  function renderForm(d){
    const c=d||DEFAULT;
    $("waEnabled").checked=!!c.whatsapp?.enabled;$("waNumber").value=c.whatsapp?.number||"";$("waDisplay").value=c.whatsapp?.display||"";$("waLabel").value=c.whatsapp?.label||"";$("waGreeting").value=c.whatsapp?.greeting||"";
    $("emailEnabled").checked=!!c.email?.enabled;$("supportEmail").value=c.email?.address||"";$("emailLabel").value=c.email?.label||"";$("emailSubject").value=c.email?.subject||"";
    $("supportEnabled").checked=!!c.support_center?.enabled;$("supportLabel").value=c.support_center?.label||"";
    $("guideEnabled").checked=!!c.guide?.enabled;$("guideLabel").value=c.guide?.label||"";
    $("licenseEnabled").checked=!!c.license?.enabled;$("licenseLabel").value=c.license?.label||"";
    renderPreview(false);
  }
  function renderPreview(notify=true){
    try{
      const d=formData();validate(d);const cards=[];
      if(d.whatsapp.enabled)cards.push(`<div class="preview-card"><b>💬 ${esc(d.whatsapp.label)}</b><span>${esc(d.whatsapp.display||d.whatsapp.number)}</span></div>`);
      if(d.email.enabled)cards.push(`<div class="preview-card"><b>✉️ ${esc(d.email.label)}</b><span>${esc(d.email.address)}</span></div>`);
      if(d.support_center.enabled)cards.push(`<div class="preview-card"><b>🛟 ${esc(d.support_center.label)}</b><span>Pusat Bantuan</span></div>`);
      if(d.guide.enabled)cards.push(`<div class="preview-card"><b>📘 ${esc(d.guide.label)}</b><span>Panduan</span></div>`);
      if(d.license.enabled)cards.push(`<div class="preview-card"><b>🔑 ${esc(d.license.label)}</b><span>Lisensi</span></div>`);
      $("contactPreview").innerHTML=cards.join("");
      $("configPreview").textContent=JSON.stringify(d,null,2);
      if(notify)showMessage("Preview diperbarui.","ok");
    }catch(e){showMessage(String(e?.message||e),"err")}
  }

  async function loadServer(){
    status("Memuat konfigurasi server…");
    try{
      const result=await LDMLicenseV2Admin.call("public_contact_get");
      lastServerConfig=result.config||null;renderForm(lastServerConfig||DEFAULT);
      const revision=Number(result.config?.revision||0);const when=result.config?.updated_at?new Date(result.config.updated_at).toLocaleString("id-ID"):"-";
      status(`Aktif di server · revisi ${revision||"-"} · diperbarui ${when}${result.updated_by_email?` · oleh ${result.updated_by_email}`:""}`);
      showMessage("Konfigurasi kontak server berhasil dimuat.","ok");
    }catch(e){status("Konfigurasi server belum dapat dimuat.");showMessage(String(e?.message||e),"err")}
  }

  async function saveServer(){
    const btn=$("saveBtn");btn.disabled=true;
    try{
      const d=formData();validate(d);
      if(!confirm("Simpan pengaturan kontak ini sebagai konfigurasi global untuk seluruh customer?"))return;
      status("Menyimpan konfigurasi global…");
      const result=await LDMLicenseV2Admin.call("public_contact_update",{config:d});
      lastServerConfig=result.config||d;renderForm(lastServerConfig);
      const revision=Number(result.config?.revision||0);const when=result.config?.updated_at?new Date(result.config.updated_at).toLocaleString("id-ID"):"sekarang";
      status(`Aktif di server · revisi ${revision||"-"} · diperbarui ${when}`);
      showMessage("Pengaturan tersimpan. Homepage customer akan membaca konfigurasi baru saat dibuka atau dimuat ulang.","ok");
    }catch(e){status("Penyimpanan gagal. Konfigurasi aktif sebelumnya tidak diubah.");showMessage(String(e?.message||e),"err")}
    finally{btn.disabled=false}
  }

  async function testPublic(){
    const fallback=window.LDMPublicContactConfig||{};const url=String(fallback?.remote?.url||"").trim();
    if(!url){showMessage("URL layanan kontak publik belum dikonfigurasi.","err");return}
    const btn=$("testPublicBtn");btn.disabled=true;
    try{
      const response=await fetch(url,{cache:"no-store",credentials:"omit"});const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)throw new Error(data?.message||`HTTP ${response.status}`);
      showMessage(`Layanan publik aktif. Revisi yang dibaca customer: ${data.config?.revision||"-"}.`,"ok");
    }catch(e){showMessage(`Uji layanan publik gagal: ${String(e?.message||e)}`,"err")}
    finally{btn.disabled=false}
  }

  function showApp(active){$("loginBox").style.display=active?"none":"block";$("developerContactApp").style.display=active?"block":"none";$("logoutBtn").style.display=active?"inline-block":"none"}
  async function login(){
    try{$("loginMessage").textContent="";$("loginMessage").className="message";await LDMLicenseV2Admin.login($("email").value,$("password").value);showApp(true);await loadServer()}
    catch(e){$("loginMessage").textContent=String(e?.message||e);$("loginMessage").className="message show err"}
  }
  async function logout(){await LDMLicenseV2Admin.logout();showApp(false)}
  function fillDefault(){if(confirm("Isi form dengan nilai default? Ini belum mengubah server sampai tombol Simpan ditekan."))renderForm(DEFAULT)}

  function init(){
    $("loginBtn").onclick=login;$("logoutBtn").onclick=logout;$("previewBtn").onclick=()=>renderPreview(true);$("saveBtn").onclick=saveServer;$("reloadBtn").onclick=loadServer;$("testPublicBtn").onclick=testPublic;$("resetBtn").onclick=fillDefault;
    (async()=>{
      try{
        if(!LDMLicenseV2Admin.configured()){$("loginMessage").textContent="Konfigurasi Developer Center belum tersedia.";$("loginMessage").className="message show err";return}
        const session=await LDMLicenseV2Admin.session();showApp(!!session);if(session)await loadServer();
      }catch(e){$("loginMessage").textContent=String(e?.message||e);$("loginMessage").className="message show err"}
    })();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

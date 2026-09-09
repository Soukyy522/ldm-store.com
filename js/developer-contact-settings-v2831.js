(function(){
  "use strict";
  const $=id=>document.getElementById(id);

  const DEFAULT={
    whatsapp:{enabled:true,number:"6287874352468",display:"+62 878-7435-2468",label:"WhatsApp Support",greeting:"Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar."},
    email:{enabled:false,address:"",label:"Email Support",subject:"Pertanyaan mengenai LocDailyMar"},
    support_center:{enabled:true,label:"Pusat Bantuan & Support"},
    guide:{enabled:true,label:"Panduan Pengguna"},
    license:{enabled:true,label:"Lisensi & Paket"}
  };

  function deepCopy(v){return JSON.parse(JSON.stringify(v))}
  function current(){
    const raw=window.LDMPublicContactConfig||DEFAULT;
    return {
      whatsapp:{...DEFAULT.whatsapp,...(raw.whatsapp||{})},
      email:{...DEFAULT.email,...(raw.email||{})},
      support_center:{...DEFAULT.support_center,...(raw.support_center||{})},
      guide:{...DEFAULT.guide,...(raw.guide||{})},
      license:{...DEFAULT.license,...(raw.license||{})}
    };
  }
  function clean(v,m){return String(v||"").trim().slice(0,m)}
  function phone(v){return String(v||"").replace(/\D/g,"").slice(0,20)}
  function email(v){return String(v||"").trim().toLowerCase().slice(0,160)}
  function validEmail(v){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}

  function formData(){
    return {
      whatsapp:{enabled:$("waEnabled").checked,number:phone($("waNumber").value),display:clean($("waDisplay").value,40),label:clean($("waLabel").value,60),greeting:clean($("waGreeting").value,240)},
      email:{enabled:$("emailEnabled").checked,address:email($("supportEmail").value),label:clean($("emailLabel").value,60),subject:clean($("emailSubject").value,160)},
      support_center:{enabled:$("supportEnabled").checked,label:clean($("supportLabel").value,70)},
      guide:{enabled:$("guideEnabled").checked,label:clean($("guideLabel").value,70)},
      license:{enabled:$("licenseEnabled").checked,label:clean($("licenseLabel").value,70)}
    };
  }

  function validate(data){
    if(data.whatsapp.enabled&&data.whatsapp.number.length<8)throw new Error("Nomor WhatsApp aktif tetapi nomor internasional belum valid.");
    if(data.email.enabled&&!data.email.address)throw new Error("Email diaktifkan tetapi alamat email masih kosong.");
    if(!validEmail(data.email.address))throw new Error("Format alamat email tidak valid.");
    if(!data.whatsapp.enabled&&!data.email.enabled&&!data.support_center.enabled&&!data.guide.enabled&&!data.license.enabled){
      throw new Error("Aktifkan minimal satu jalur kontak.");
    }
  }

  function renderForm(data){
    $("waEnabled").checked=!!data.whatsapp.enabled;
    $("waNumber").value=data.whatsapp.number||"";
    $("waDisplay").value=data.whatsapp.display||"";
    $("waLabel").value=data.whatsapp.label||"";
    $("waGreeting").value=data.whatsapp.greeting||"";
    $("emailEnabled").checked=!!data.email.enabled;
    $("supportEmail").value=data.email.address||"";
    $("emailLabel").value=data.email.label||"";
    $("emailSubject").value=data.email.subject||"";
    $("supportEnabled").checked=!!data.support_center.enabled;
    $("supportLabel").value=data.support_center.label||"";
    $("guideEnabled").checked=!!data.guide.enabled;
    $("guideLabel").value=data.guide.label||"";
    $("licenseEnabled").checked=!!data.license.enabled;
    $("licenseLabel").value=data.license.label||"";
    renderPreview();
  }

  function configSource(data){
    validate(data);
    const payload={
      version:"1.0",
      whatsapp:data.whatsapp,
      email:data.email,
      support_center:data.support_center,
      guide:data.guide,
      license:data.license
    };
    return `(function(){\n  "use strict";\n  window.LDMPublicContactConfig = Object.freeze(${JSON.stringify(payload,null,2)});\n})();\n`;
  }

  function message(text,type="ok"){
    $("message").textContent=text||"";
    $("message").className=`message show ${type}`;
  }

  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

  function renderPreview(){
    try{
      const data=formData(); validate(data);
      const cards=[];
      if(data.whatsapp.enabled)cards.push(`<div class="preview-card"><b>💬 ${esc(data.whatsapp.label||"WhatsApp")}</b><span>${esc(data.whatsapp.display||data.whatsapp.number)}</span></div>`);
      if(data.email.enabled)cards.push(`<div class="preview-card"><b>✉️ ${esc(data.email.label||"Email")}</b><span>${esc(data.email.address)}</span></div>`);
      if(data.support_center.enabled)cards.push(`<div class="preview-card"><b>🛟 ${esc(data.support_center.label||"Pusat Bantuan")}</b><span>support-center.html</span></div>`);
      if(data.guide.enabled)cards.push(`<div class="preview-card"><b>📘 ${esc(data.guide.label||"Panduan")}</b><span>panduan.html</span></div>`);
      if(data.license.enabled)cards.push(`<div class="preview-card"><b>🔑 ${esc(data.license.label||"Lisensi")}</b><span>license.html</span></div>`);
      $("contactPreview").innerHTML=cards.join("");
      $("configPreview").textContent=configSource(data);
      message("Preview konfigurasi diperbarui.","ok");
    }catch(e){message(String(e?.message||e),"err")}
  }

  function downloadConfig(){
    try{
      const source=configSource(formData());
      const url=URL.createObjectURL(new Blob([source],{type:"text/javascript;charset=utf-8"}));
      const a=document.createElement("a");
      a.href=url;a.download="public-contact-config.js";document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      message("File public-contact-config.js berhasil dibuat. Replace file lama di folder js lalu Commit & Push.","ok");
    }catch(e){message(String(e?.message||e),"err")}
  }

  async function copyConfig(){
    try{await navigator.clipboard.writeText(configSource(formData()));message("Isi konfigurasi berhasil disalin.","ok")}
    catch(e){message(String(e?.message||e),"err")}
  }

  function showApp(active){
    $("loginBox").style.display=active?"none":"block";
    $("developerContactApp").style.display=active?"block":"none";
    $("logoutBtn").style.display=active?"inline-block":"none";
  }

  async function login(){
    try{
      $("loginMessage").textContent="";$("loginMessage").className="message";
      await LDMLicenseV2Admin.login($("email").value,$("password").value);
      showApp(true);renderForm(current());
    }catch(e){$("loginMessage").textContent=String(e?.message||e);$("loginMessage").className="message show err"}
  }

  async function logout(){await LDMLicenseV2Admin.logout();showApp(false)}
  function reset(){if(confirm("Kembalikan form ke konfigurasi default LocDailyMar?"))renderForm(deepCopy(DEFAULT))}

  function init(){
    $("loginBtn").onclick=login;$("logoutBtn").onclick=logout;$("previewBtn").onclick=renderPreview;$("downloadBtn").onclick=downloadConfig;$("copyBtn").onclick=copyConfig;$("resetBtn").onclick=reset;
    (async()=>{
      try{
        if(!LDMLicenseV2Admin.configured()){ $("loginMessage").textContent="Konfigurasi Developer Center belum tersedia.";$("loginMessage").className="message show err";return }
        const session=await LDMLicenseV2Admin.session();showApp(!!session);if(session)renderForm(current());
      }catch(e){$("loginMessage").textContent=String(e?.message||e);$("loginMessage").className="message show err"}
    })();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

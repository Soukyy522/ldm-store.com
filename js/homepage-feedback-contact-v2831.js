(function(){
  "use strict";

  const DEFAULTS={
    whatsapp:{enabled:true,number:"6287874352468",display:"+62 878-7435-2468",label:"WhatsApp Support",greeting:"Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar."},
    email:{enabled:false,address:"",label:"Email Support",subject:"Pertanyaan mengenai LocDailyMar"},
    support_center:{enabled:true,label:"Pusat Bantuan & Support"},
    guide:{enabled:true,label:"Panduan Pengguna"},
    license:{enabled:true,label:"Lisensi & Paket"}
  };

  const $=id=>document.getElementById(id);
  const CATEGORY_LABELS={
    saran_fitur:"Saran Fitur",
    tampilan:"Tampilan & Kemudahan",
    operasional:"Alur Operasional",
    paket:"Paket & Lisensi",
    lainnya:"Lainnya"
  };

  function clean(value,max){return String(value||"").replace(/\s+/g," ").trim().slice(0,max)}
  function bool(value,fallback=true){return typeof value==="boolean"?value:fallback}
  function sanitizePhone(value){return String(value||"").replace(/\D/g,"").slice(0,20)}
  function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim())}

  function config(){
    const raw=window.LDMPublicContactConfig||{};
    return {
      whatsapp:{
        enabled:bool(raw?.whatsapp?.enabled,DEFAULTS.whatsapp.enabled),
        number:sanitizePhone(raw?.whatsapp?.number)||DEFAULTS.whatsapp.number,
        display:clean(raw?.whatsapp?.display,40)||DEFAULTS.whatsapp.display,
        label:clean(raw?.whatsapp?.label,60)||DEFAULTS.whatsapp.label,
        greeting:clean(raw?.whatsapp?.greeting,240)||DEFAULTS.whatsapp.greeting
      },
      email:{
        enabled:bool(raw?.email?.enabled,DEFAULTS.email.enabled)&&validEmail(raw?.email?.address),
        address:clean(raw?.email?.address,160),
        label:clean(raw?.email?.label,60)||DEFAULTS.email.label,
        subject:clean(raw?.email?.subject,160)||DEFAULTS.email.subject
      },
      support_center:{
        enabled:bool(raw?.support_center?.enabled,true),
        label:clean(raw?.support_center?.label,70)||DEFAULTS.support_center.label
      },
      guide:{
        enabled:bool(raw?.guide?.enabled,true),
        label:clean(raw?.guide?.label,70)||DEFAULTS.guide.label
      },
      license:{
        enabled:bool(raw?.license?.enabled,true),
        label:clean(raw?.license?.label,70)||DEFAULTS.license.label
      }
    };
  }

  function setMessage(text,type="info"){
    const box=$("feedbackMessageBox");
    if(!box)return;
    box.textContent=text||"";
    box.className=`feedback-message show ${type}`;
  }

  function values(){
    return {
      name:clean($("feedbackName")?.value,80),
      category:clean($("feedbackCategory")?.value,40)||"saran_fitur",
      subject:clean($("feedbackSubject")?.value,120),
      message:String($("feedbackMessage")?.value||"").trim().slice(0,1500)
    };
  }

  function validate(data){
    if(data.subject.length<4){setMessage("Judul masukan minimal 4 karakter.","error");return false}
    if(data.message.length<10){setMessage("Masukan minimal 10 karakter.","error");return false}
    return true;
  }

  function feedbackText(data){
    return [
      "Halo Tim LocDailyMar, saya ingin memberikan Feedback & Masukan.",
      "",
      `Kategori: ${CATEGORY_LABELS[data.category]||"Lainnya"}`,
      `Judul: ${data.subject}`,
      data.name?`Nama: ${data.name}`:"",
      "",
      "Masukan:",
      data.message,
      "",
      "Dikirim dari Homepage LocDailyMar."
    ].filter(Boolean).join("\n");
  }

  function openWhatsApp(event){
    event?.preventDefault();
    const cfg=config();
    if(!cfg.whatsapp.enabled){setMessage("WhatsApp Support sedang tidak ditampilkan. Gunakan jalur kontak lain yang tersedia.","info");return}
    const data=values(); if(!validate(data))return;
    window.open(`https://wa.me/${cfg.whatsapp.number}?text=${encodeURIComponent(feedbackText(data))}`,"_blank","noopener,noreferrer");
    setMessage("Membuka WhatsApp dengan masukan yang sudah disiapkan.","ok");
  }

  function openEmail(){
    const cfg=config();
    if(!cfg.email.enabled){setMessage("Email Support belum tersedia. Gunakan jalur kontak lain.","info");return}
    const data=values(); if(!validate(data))return;
    const subject=`${cfg.email.subject} · ${CATEGORY_LABELS[data.category]||"Feedback"} · ${data.subject}`;
    window.location.href=`mailto:${encodeURIComponent(cfg.email.address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(feedbackText(data))}`;
    setMessage("Membuka aplikasi email dengan masukan yang sudah disiapkan.","ok");
  }

  function openSupportCenter(){
    const cfg=config();
    if(!cfg.support_center.enabled){setMessage("Pusat Bantuan sedang tidak ditampilkan. Gunakan jalur kontak lain.","info");return}
    const data=values(); if(!validate(data))return;
    const category=data.category==="saran_fitur"?"saran_fitur":data.category==="paket"?"lisensi_pembayaran":"lainnya";
    const params=new URLSearchParams({type:"feedback",category,subject:data.subject,description:data.message,source:"homepage"});
    if(data.name)params.set("name",data.name);
    setMessage("Membuka Pusat Bantuan dengan form feedback yang sudah diisi.","ok");
    window.location.href=`support-center.html?${params.toString()}#ticketForm`;
  }

  async function copyNumber(){
    const cfg=config();
    const number=cfg.whatsapp.display||cfg.whatsapp.number;
    try{await navigator.clipboard.writeText(number);setMessage("Nomor WhatsApp Support berhasil disalin.","ok")}
    catch{setMessage(`Nomor WhatsApp Support: ${number}`,"info")}
  }

  function applyConfig(){
    const cfg=config();

    const waLink=$("contactWhatsAppLink");
    if(waLink){
      waLink.hidden=!cfg.whatsapp.enabled;
      if(cfg.whatsapp.enabled)waLink.href=`https://wa.me/${cfg.whatsapp.number}?text=${encodeURIComponent(cfg.whatsapp.greeting)}`;
    }
    if($("contactWhatsAppLabel"))$("contactWhatsAppLabel").textContent=cfg.whatsapp.label;
    if($("contactWhatsAppNumber"))$("contactWhatsAppNumber").textContent=cfg.whatsapp.display;
    if($("contactNumberBox"))$("contactNumberBox").hidden=!cfg.whatsapp.enabled;
    if($("feedbackWhatsAppBtn"))$("feedbackWhatsAppBtn").hidden=!cfg.whatsapp.enabled;

    const emailLink=$("contactEmailLink");
    if(emailLink){
      emailLink.hidden=!cfg.email.enabled;
      if(cfg.email.enabled)emailLink.href=`mailto:${encodeURIComponent(cfg.email.address)}?subject=${encodeURIComponent(cfg.email.subject)}`;
    }
    if($("contactEmailLabel"))$("contactEmailLabel").textContent=cfg.email.label;
    if($("contactEmailAddress"))$("contactEmailAddress").textContent=cfg.email.address;
    if($("feedbackEmailBtn"))$("feedbackEmailBtn").hidden=!cfg.email.enabled;

    if($("contactSupportLink"))$("contactSupportLink").hidden=!cfg.support_center.enabled;
    if($("contactSupportLabel"))$("contactSupportLabel").textContent=cfg.support_center.label;
    if($("contactGuideLink"))$("contactGuideLink").hidden=!cfg.guide.enabled;
    if($("contactGuideLabel"))$("contactGuideLabel").textContent=cfg.guide.label;
    if($("contactLicenseLink"))$("contactLicenseLink").hidden=!cfg.license.enabled;
    if($("contactLicenseLabel"))$("contactLicenseLabel").textContent=cfg.license.label;
  }

  function init(){
    applyConfig();
    $("homepageFeedbackForm")?.addEventListener("submit",openWhatsApp);
    $("feedbackEmailBtn")?.addEventListener("click",openEmail);
    $("feedbackSupportBtn")?.addEventListener("click",openSupportCenter);
    $("copyContactNumber")?.addEventListener("click",copyNumber);
    $("feedbackMessage")?.addEventListener("input",()=>{
      if($("feedbackChars"))$("feedbackChars").textContent=String($("feedbackMessage").value.length);
    });
  }

  window.LDMHomepageContact=Object.freeze({config,applyConfig});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

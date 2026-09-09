(function(){
  "use strict";

  const $=id=>document.getElementById(id);
  const CATEGORY_LABELS={
    saran_fitur:"Saran Fitur",tampilan:"Tampilan & Kemudahan",operasional:"Alur Operasional",paket:"Paket & Lisensi",lainnya:"Lainnya"
  };
  const FALLBACK=window.LDMPublicContactConfig||{};
  let activeConfig=null;
  let loadPromise=null;

  function clean(value,max){return String(value||"").replace(/\s+/g," ").trim().slice(0,max)}
  function bool(value,fallback=true){return typeof value==="boolean"?value:fallback}
  function phone(value){return String(value||"").replace(/\D/g,"").slice(0,20)}
  function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim())}

  function normalize(raw,base=FALLBACK){
    const b=base||{};
    const wa=raw?.whatsapp||{}, bwa=b?.whatsapp||{};
    const em=raw?.email||{}, bem=b?.email||{};
    const sp=raw?.support_center||{}, bsp=b?.support_center||{};
    const gd=raw?.guide||{}, bgd=b?.guide||{};
    const lc=raw?.license||{}, blc=b?.license||{};
    const result={
      version:clean(raw?.version||b?.version||"1.0",20),
      revision:Number(raw?.revision||0)||0,
      updated_at:raw?.updated_at||null,
      remote:{
        enabled:bool(b?.remote?.enabled,true),
        url:clean(b?.remote?.url,500),
        timeout_ms:Math.max(2000,Math.min(Number(b?.remote?.timeout_ms||7000),15000))
      },
      whatsapp:{
        enabled:bool(wa.enabled,bool(bwa.enabled,true)),
        number:phone(wa.number)||phone(bwa.number),
        display:clean(wa.display,40)||clean(bwa.display,40),
        label:clean(wa.label,60)||clean(bwa.label,60)||"WhatsApp Support",
        greeting:clean(wa.greeting,240)||clean(bwa.greeting,240)||"Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar."
      },
      email:{
        enabled:bool(em.enabled,bool(bem.enabled,false)),
        address:clean(em.address,160).toLowerCase()||clean(bem.address,160).toLowerCase(),
        label:clean(em.label,60)||clean(bem.label,60)||"Email Support",
        subject:clean(em.subject,160)||clean(bem.subject,160)||"Pertanyaan mengenai LocDailyMar"
      },
      support_center:{enabled:bool(sp.enabled,bool(bsp.enabled,true)),label:clean(sp.label,70)||clean(bsp.label,70)||"Pusat Bantuan & Support"},
      guide:{enabled:bool(gd.enabled,bool(bgd.enabled,true)),label:clean(gd.label,70)||clean(bgd.label,70)||"Panduan Pengguna"},
      license:{enabled:bool(lc.enabled,bool(blc.enabled,true)),label:clean(lc.label,70)||clean(blc.label,70)||"Lisensi & Paket"}
    };
    if(result.email.enabled&&!validEmail(result.email.address)) result.email.enabled=false;
    if(result.whatsapp.enabled&&!/^\d{8,20}$/.test(result.whatsapp.number)) result.whatsapp.enabled=false;
    return result;
  }

  function setMessage(text,type="info"){
    const box=$("feedbackMessageBox"); if(!box)return;
    box.textContent=text||""; box.className=`feedback-message show ${type}`;
  }

  function values(){return {
    name:clean($("feedbackName")?.value,80),category:clean($("feedbackCategory")?.value,40)||"saran_fitur",
    subject:clean($("feedbackSubject")?.value,120),message:String($("feedbackMessage")?.value||"").trim().slice(0,1500)
  }}
  function validate(data){
    if(data.subject.length<4){setMessage("Judul masukan minimal 4 karakter.","error");return false}
    if(data.message.length<10){setMessage("Masukan minimal 10 karakter.","error");return false}
    return true;
  }
  function feedbackText(data){return [
    "Halo Tim LocDailyMar, saya ingin memberikan Feedback & Masukan.","",
    `Kategori: ${CATEGORY_LABELS[data.category]||"Lainnya"}`,`Judul: ${data.subject}`,data.name?`Nama: ${data.name}`:"","",
    "Masukan:",data.message,"","Dikirim dari Homepage LocDailyMar."
  ].filter(Boolean).join("\n")}

  function cfg(){return activeConfig||normalize(FALLBACK,FALLBACK)}

  function applyConfig(){
    const c=cfg();
    const waLink=$("contactWhatsAppLink");
    if(waLink){waLink.hidden=!c.whatsapp.enabled;if(c.whatsapp.enabled)waLink.href=`https://wa.me/${c.whatsapp.number}?text=${encodeURIComponent(c.whatsapp.greeting)}`}
    if($("contactWhatsAppLabel"))$("contactWhatsAppLabel").textContent=c.whatsapp.label;
    if($("contactWhatsAppNumber"))$("contactWhatsAppNumber").textContent=c.whatsapp.display||c.whatsapp.number;
    if($("contactNumberBox"))$("contactNumberBox").hidden=!c.whatsapp.enabled;
    if($("feedbackWhatsAppBtn"))$("feedbackWhatsAppBtn").hidden=!c.whatsapp.enabled;

    const emailLink=$("contactEmailLink");
    if(emailLink){emailLink.hidden=!c.email.enabled;if(c.email.enabled)emailLink.href=`mailto:${c.email.address}?subject=${encodeURIComponent(c.email.subject)}`}
    if($("contactEmailLabel"))$("contactEmailLabel").textContent=c.email.label;
    if($("contactEmailAddress"))$("contactEmailAddress").textContent=c.email.address;
    if($("feedbackEmailBtn"))$("feedbackEmailBtn").hidden=!c.email.enabled;

    if($("contactSupportLink"))$("contactSupportLink").hidden=!c.support_center.enabled;
    if($("contactSupportLabel"))$("contactSupportLabel").textContent=c.support_center.label;
    if($("contactGuideLink"))$("contactGuideLink").hidden=!c.guide.enabled;
    if($("contactGuideLabel"))$("contactGuideLabel").textContent=c.guide.label;
    if($("contactLicenseLink"))$("contactLicenseLink").hidden=!c.license.enabled;
    if($("contactLicenseLabel"))$("contactLicenseLabel").textContent=c.license.label;
  }

  async function loadRemote(force=false){
    if(loadPromise&&!force)return loadPromise;
    loadPromise=(async()=>{
      const fallback=normalize(FALLBACK,FALLBACK);
      activeConfig=fallback; applyConfig();
      if(!fallback.remote.enabled||!fallback.remote.url)return activeConfig;
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),fallback.remote.timeout_ms);
      try{
        const response=await fetch(fallback.remote.url,{method:"GET",headers:{"Accept":"application/json"},cache:"no-store",signal:controller.signal,credentials:"omit"});
        const payload=await response.json().catch(()=>null);
        if(!response.ok||!payload?.ok||!payload?.config)throw new Error("remote unavailable");
        activeConfig=normalize(payload.config,fallback); applyConfig();
        window.dispatchEvent(new CustomEvent("ldm-public-contact-updated",{detail:{revision:activeConfig.revision,source:"server"}}));
        return activeConfig;
      }catch(_error){
        activeConfig=fallback; applyConfig();
        window.dispatchEvent(new CustomEvent("ldm-public-contact-updated",{detail:{revision:0,source:"fallback"}}));
        return activeConfig;
      }finally{clearTimeout(timer)}
    })().finally(()=>{loadPromise=null});
    return loadPromise;
  }

  function openWhatsApp(event){
    event?.preventDefault(); const c=cfg();
    if(!c.whatsapp.enabled){setMessage("WhatsApp Support sedang tidak tersedia. Gunakan jalur kontak lain.","info");return}
    const data=values(); if(!validate(data))return;
    window.open(`https://wa.me/${c.whatsapp.number}?text=${encodeURIComponent(feedbackText(data))}`,"_blank","noopener,noreferrer");
    setMessage("Membuka WhatsApp dengan masukan yang sudah disiapkan.","ok");
  }
  function openEmail(){
    const c=cfg();
    if(!c.email.enabled){setMessage("Email Support sedang tidak tersedia. Gunakan jalur kontak lain.","info");return}
    const data=values(); if(!validate(data))return;
    const subject=`${c.email.subject} · ${CATEGORY_LABELS[data.category]||"Feedback"} · ${data.subject}`;
    window.location.href=`mailto:${c.email.address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(feedbackText(data))}`;
    setMessage("Membuka aplikasi email dengan masukan yang sudah disiapkan.","ok");
  }
  function openSupportCenter(){
    const c=cfg(); if(!c.support_center.enabled){setMessage("Pusat Bantuan sedang tidak tersedia.","info");return}
    const data=values(); if(!validate(data))return;
    const category=data.category==="saran_fitur"?"saran_fitur":data.category==="paket"?"lisensi_pembayaran":"lainnya";
    const params=new URLSearchParams({type:"feedback",category,subject:data.subject,description:data.message,source:"homepage"});
    if(data.name)params.set("name",data.name);
    window.location.href=`support-center.html?${params.toString()}#ticketForm`;
  }
  async function copyNumber(){
    const c=cfg(),number=c.whatsapp.display||c.whatsapp.number;
    try{await navigator.clipboard.writeText(number);setMessage("Nomor WhatsApp Support berhasil disalin.","ok")}
    catch{setMessage(`Nomor WhatsApp Support: ${number}`,"info")}
  }

  function init(){
    activeConfig=normalize(FALLBACK,FALLBACK); applyConfig();
    $("homepageFeedbackForm")?.addEventListener("submit",openWhatsApp);
    $("feedbackEmailBtn")?.addEventListener("click",openEmail);
    $("feedbackSupportBtn")?.addEventListener("click",openSupportCenter);
    $("copyContactNumber")?.addEventListener("click",copyNumber);
    $("feedbackMessage")?.addEventListener("input",()=>{if($("feedbackChars"))$("feedbackChars").textContent=String($("feedbackMessage").value.length)});
    loadRemote();
  }

  window.LDMHomepageContact=Object.freeze({config:cfg,applyConfig,refresh:()=>loadRemote(true)});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

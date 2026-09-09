(function(){
  "use strict";

  const DEFAULT_PUBLIC_CONTACT_URL = "https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-public-contact";

  function cleanUrl(value){
    const raw=String(value||"").trim();
    if(!raw)return "";
    try{
      const parsed=new URL(raw,window.location.href);
      if(!/^https?:$/i.test(parsed.protocol))return "";
      return parsed.href.replace(/\/$/,"");
    }catch(_error){return ""}
  }

  function resolvePublicContactUrl(){
    const configured=cleanUrl(window.LDMPublicContactConfig?.remote?.url);
    if(configured)return {url:configured,source:"public-contact-config"};

    const admin=window.LDM_LICENSE_V2_ADMIN_CONFIG||{};
    const supabaseUrl=cleanUrl(admin.supabaseUrl);
    if(supabaseUrl)return {url:`${supabaseUrl}/functions/v1/ldm-public-contact`,source:"license-admin-supabase-url"};

    const adminFunction=cleanUrl(admin.adminFunctionUrl);
    if(adminFunction&&/\/functions\/v1\/ldm-license-admin-v2$/i.test(adminFunction)){
      return {url:adminFunction.replace(/\/ldm-license-admin-v2$/i,"/ldm-public-contact"),source:"license-admin-function-url"};
    }

    return {url:DEFAULT_PUBLIC_CONTACT_URL,source:"built-in-safe-fallback"};
  }

  window.LDMPublicContactConfig = Object.freeze({
    version: "1.1",
    build: "27.9.0-v28.3.3",
    remote: Object.freeze({
      enabled: true,
      url: DEFAULT_PUBLIC_CONTACT_URL,
      timeout_ms: 7000
    }),
    whatsapp: Object.freeze({
      enabled: true,
      number: "6287874352468",
      display: "+62 878-7435-2468",
      label: "WhatsApp Support",
      greeting: "Halo Tim LocDailyMar, saya ingin bertanya mengenai layanan LocDailyMar."
    }),
    email: Object.freeze({
      enabled: false,
      address: "",
      label: "Email Support",
      subject: "Pertanyaan mengenai LocDailyMar"
    }),
    support_center: Object.freeze({enabled:true,label:"Pusat Bantuan & Support"}),
    guide: Object.freeze({enabled:true,label:"Panduan Pengguna"}),
    license: Object.freeze({enabled:true,label:"Lisensi & Paket"})
  });

  window.LDMPublicContactRuntime = Object.freeze({
    version:"28.3.3",
    defaultUrl:DEFAULT_PUBLIC_CONTACT_URL,
    resolveUrl:resolvePublicContactUrl
  });
})();

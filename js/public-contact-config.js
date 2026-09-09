(function(){
  "use strict";
  window.LDMPublicContactConfig = Object.freeze({
    version: "1.0",
    remote: Object.freeze({
      enabled: true,
      url: "https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-public-contact",
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
})();

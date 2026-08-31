(function(){
    "use strict";
    window.LDM_LICENSE_V2_CONFIG=Object.freeze({
        enabled:true,
        serverUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-license-v2",
        developerWhatsApp:"6283117590286",
        appVersion:"26.2.2",
        requestTimeoutMs:8000,
        onlineCacheMinutes:2,
        offlineGraceHours:24,
        activationPage:"license.html",
        plans:Object.freeze({
            WARUNG_KECIL:{name:"Warung Kecil",monthly:69000,yearly:699000,devices:2,stores:1},
            WARUNG_SEDERHANA:{name:"Warung Sederhana",monthly:129000,yearly:1299000,devices:3,stores:1,trialDays:14},
            TOKO:{name:"Toko",monthly:249000,yearly:2499000,devices:10,stores:5},
            LIFETIME:{name:"Lifetime",lifetime:7499000,devices:15,stores:8}
        })
    });
})();

(function(){
    "use strict";
    window.LDM_LICENSE_V2_CONFIG=Object.freeze({
        enabled:true,
        serverUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-license-v2",
        checkoutUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-public-checkout-v2",
        lynkOrderUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-lynk-order",
        developerWhatsApp:"6287874352468",

        // V27: Lynk.id adalah satu-satunya jalur pembayaran.
        checkoutMode:"lynk",
        manualPaymentLabel:"Bayar via Lynk.id",

        // WAJIB DIISI dengan URL PRODUK/CHECKOUT Lynk.id milikmu.
        // Buat 9 produk: 3 paket x 3 periode (bulanan, tahunan, 2 tahun).
        lynkCheckoutLinks:Object.freeze({
            WARUNG_KECIL:Object.freeze({monthly:"",yearly:"",two_year:""}),
            WARUNG_SEDERHANA:Object.freeze({monthly:"",yearly:"",two_year:""}),
            TOKO:Object.freeze({monthly:"",yearly:"",two_year:""})
        }),

        appVersion:"27.9.0-v27",
        requestTimeoutMs:8000,
        onlineCacheMinutes:2,
        offlineGraceHours:24,
        activationPage:"license.html",
        plans:Object.freeze({
            WARUNG_KECIL:{name:"Warung Kecil",monthly:69000,yearly:699000,two_year:1398000,devices:2,stores:1},
            WARUNG_SEDERHANA:{name:"Warung Sederhana",monthly:129000,yearly:1299000,two_year:2598000,devices:3,stores:1,trialDays:14},
            TOKO:{name:"Toko",monthly:249000,yearly:2499000,two_year:4998000,devices:10,stores:5}
        })
    });
})();

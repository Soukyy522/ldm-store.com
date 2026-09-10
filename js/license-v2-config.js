(function(){
    "use strict";
    window.LDM_LICENSE_V2_CONFIG=Object.freeze({
        enabled:true,
        serverUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-license-v2",
        checkoutUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-public-checkout-v2",
        lynkOrderUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-lynk-order",
        developerWhatsApp:"6287874352468",
        publicAppUrl:"https://locdaily.github.io",
        loginUrl:"https://locdaily.github.io/index.html",
        guideUrl:"https://locdaily.github.io/panduan.html",
        passwordResetUrl:"https://locdaily.github.io/account-password-reset.html",

        // V27: Lynk.id adalah satu-satunya jalur pembayaran.
        checkoutMode:"lynk",
        manualPaymentLabel:"Bayar via Lynk.id",

        // WAJIB DIISI dengan URL PRODUK/CHECKOUT Lynk.id milikmu.
        // Buat 9 produk: 3 paket x 3 periode (bulanan, tahunan, 2 tahun).
        lynkCheckoutLinks:Object.freeze({
            WARUNG_KECIL:Object.freeze({monthly:"https://lynk.id/locdaily/px0ed6p8jkk0/checkout",yearly:"https://lynk.id/locdaily/zk2leorw6332/checkout",two_year:"https://lynk.id/locdaily/nlke51p5079z/checkout"}),
            WARUNG_SEDERHANA:Object.freeze({monthly:"https://lynk.id/locdaily/zo6jkyg7o67e/checkout",yearly:"https://lynk.id/locdaily/m0gjodzx3kn7/checkout",two_year:"https://lynk.id/locdaily/e36ojydz3z72/checkout"}),
            TOKO:Object.freeze({monthly:"https://lynk.id/locdaily/9xro4wkxep8z/checkout",yearly:"https://lynk.id/locdaily/669ekq3znom1/checkout",two_year:"https://lynk.id/locdaily/jdm3revj0n7x/checkout"})
        }),

        appVersion:"27.9.0-v28.3.9",
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

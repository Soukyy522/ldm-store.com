(function(){
    "use strict";
    window.LDM_LICENSE_V2_CONFIG=Object.freeze({
        enabled:true,
        serverUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-license-v2",
        checkoutUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-public-checkout-v2",
        lynkOrderUrl:"https://vplweadbeujidsoponrl.supabase.co/functions/v1/ldm-lynk-order",
        developerWhatsApp:"6283117590286",

        // V26.1: Lynk.id menjadi jalur pembayaran utama dengan pending order backend + webhook otomatis.
        // Hasil lisensi hanya ditampilkan di license.html. Tidak ada Resend atau pengiriman email otomatis.
        // Midtrans dan DOKU tetap tersimpan di source/backend, tetapi tidak ditampilkan ke customer.
        checkoutMode:"lynk",
        showPaymentGatewaySelector:false,
        manualPaymentLabel:"Bayar via Lynk.id",

        // Tempel URL PRODUK/CHECKOUT Lynk.id milikmu di sini.
        // Gunakan URL HTTPS dari lynk.id. Jangan menaruh password/API secret apa pun di file frontend ini.
        lynkCheckoutLinks:Object.freeze({
            WARUNG_KECIL:Object.freeze({monthly:"",yearly:""}),
            WARUNG_SEDERHANA:Object.freeze({monthly:"",yearly:""}),
            TOKO:Object.freeze({monthly:"",yearly:""}),
            LIFETIME:Object.freeze({lifetime:""})
        }),

        appVersion:"27.9.0-v26.1",
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

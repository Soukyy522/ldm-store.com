(function(){
    "use strict";
    const STORAGE_KEY="ldmLicenseCheckoutContextV1";

    function config(){ return window.LDM_LICENSE_CHECKOUT_CONFIG||{}; }
    function configured(){
        const c=config();
        return Boolean(c.enabled&&/^https:\/\/.+\/functions\/v1\/ldm-license-checkout$/i.test(c.checkoutUrl||"")&&!/^GANTI_/i.test(c.midtransClientKey||""));
    }
    async function request(payload){
        const c=config();
        if(!configured()) throw Object.assign(new Error("Checkout Midtrans belum dikonfigurasi oleh developer."),{code:"CHECKOUT_NOT_CONFIGURED"});
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),Number(c.requestTimeoutMs)||20000);
        try{
            const response=await fetch(c.checkoutUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"});
            const data=await response.json().catch(()=>({}));
            if(!response.ok||data.ok===false){
                throw Object.assign(new Error(data.message||`Checkout HTTP ${response.status}`),{code:data.code||`HTTP_${response.status}`,status:response.status,data});
            }
            return data;
        }catch(error){
            if(error&&error.name==="AbortError") throw Object.assign(new Error("Server checkout terlalu lama merespons."),{code:"CHECKOUT_TIMEOUT"});
            throw error;
        }finally{clearTimeout(timer)}
    }
    function loadSnap(){
        if(window.snap&&typeof window.snap.pay==="function") return Promise.resolve(window.snap);
        const c=config();
        if(!configured()) return Promise.reject(Object.assign(new Error("Client Key Midtrans belum diisi."),{code:"CHECKOUT_NOT_CONFIGURED"}));
        return new Promise((resolve,reject)=>{
            const old=document.getElementById("ldm-midtrans-snap");
            if(old){old.addEventListener("load",()=>resolve(window.snap),{once:true});old.addEventListener("error",()=>reject(new Error("Snap Midtrans gagal dimuat.")),{once:true});return}
            const script=document.createElement("script");
            script.id="ldm-midtrans-snap";
            script.src=c.production?"https://app.midtrans.com/snap/snap.js":"https://app.sandbox.midtrans.com/snap/snap.js";
            script.dataset.clientKey=c.midtransClientKey;
            script.onload=()=>window.snap?resolve(window.snap):reject(new Error("Snap Midtrans tidak tersedia."));
            script.onerror=()=>reject(new Error("Snap Midtrans gagal dimuat. Periksa koneksi internet."));
            document.head.appendChild(script);
        });
    }
    function saveContext(value){sessionStorage.setItem(STORAGE_KEY,JSON.stringify(value||{}))}
    function context(){try{return JSON.parse(sessionStorage.getItem(STORAGE_KEY)||"null")}catch(_){return null}}
    function clearContext(){sessionStorage.removeItem(STORAGE_KEY)}
    async function createCheckout(payload){return request({action:"create_checkout",...payload})}
    async function status(orderId,checkoutToken){return request({action:"status",order_id:orderId,checkout_token:checkoutToken})}
    async function pay(checkout,callbacks){
        const snap=await loadSnap();
        snap.pay(checkout.snap_token,callbacks||{});
    }
    window.LDMLicenseCheckout=Object.freeze({configured,createCheckout,status,pay,saveContext,context,clearContext});
})();

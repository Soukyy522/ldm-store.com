(function(){
    "use strict";
    const TOKEN_KEY="ldmLicenseV2ActivationToken";
    const DEVICE_KEY="ldmLicenseV2DeviceId";
    const CONTEXT_KEY="ldmLicenseV2Context";
    const CACHE_KEY="ldmLicenseV2Cache";
    const cfg=()=>window.LDM_LICENSE_V2_CONFIG||{};

    function uuid(){
        if(crypto.randomUUID)return crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]%16;return(c==="x"?r:(r&3)|8).toString(16)});
    }
    function deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=uuid();localStorage.setItem(DEVICE_KEY,id)}return id}
    function read(key,fallback=null){try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch(error){return fallback}}
    function activationContext(){return read(CONTEXT_KEY,{})||{}}
    function storeCode(){return String(localStorage.getItem("ldmCloudStoreCode")||activationContext().store_code||"").trim().toUpperCase()}
    function deviceName(){return String(localStorage.getItem("ldmLicenseV2DeviceName")||`${navigator.platform||"Perangkat"} · ${navigator.userAgent.includes("Mobile")?"HP":"Desktop"}`).slice(0,100)}
    function configured(){const url=String(cfg().serverUrl||"");return /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ldm-license-v2$/i.test(url)&&!url.includes("GANTI-")}
    function clearCache(){localStorage.removeItem(CACHE_KEY)}
    function clearActivation(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(CONTEXT_KEY);clearCache()}
    function saveSuccess(data,tokenValue){
        if(tokenValue)localStorage.setItem(TOKEN_KEY,tokenValue);
        const context={license_id:data.license_id,plan_code:data.plan_code,plan_name:data.plan_name,store_code:data.store_code,is_trial:Boolean(data.is_trial),expires_at:data.expires_at||null};
        localStorage.setItem(CONTEXT_KEY,JSON.stringify(context));
        const cache={data:{...data,activation_token:undefined},checkedAt:Date.now()};
        localStorage.setItem(CACHE_KEY,JSON.stringify(cache));
        window.dispatchEvent(new CustomEvent("ldm-license-v2-ready",{detail:data}));
        return data;
    }
    async function call(action,payload={}){
        if(!cfg().enabled)return {ok:true,bypass:true,features:["*"]};
        if(!configured())throw Object.assign(new Error("Alamat server lisensi belum dikonfigurasi oleh developer."),{code:"LICENSE_CONFIG_REQUIRED"});
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),Number(cfg().requestTimeoutMs)||8000);
        try{
            const response=await fetch(cfg().serverUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                action,device_id:deviceId(),device_name:deviceName(),store_code:String(payload.store_code||storeCode()).trim().toUpperCase(),app_version:cfg().appVersion||"",...payload
            }),signal:controller.signal,cache:"no-store"});
            const data=await response.json().catch(()=>({ok:false,code:"INVALID_SERVER_RESPONSE",message:"Jawaban server lisensi tidak valid."}));
            if(!response.ok||data.ok===false){const error=new Error(data.message||`Server lisensi merespons ${response.status}.`);error.code=data.code||`HTTP_${response.status}`;error.status=response.status;error.data=data;throw error}
            return data;
        }catch(error){
            if(error.name==="AbortError")throw Object.assign(new Error("Server lisensi tidak merespons dalam batas waktu 8 detik."),{code:"LICENSE_TIMEOUT"});
            if(error instanceof TypeError)throw Object.assign(new Error("Tidak dapat menghubungi server lisensi. Periksa internet, URL server, dan CORS."),{code:"LICENSE_NETWORK_ERROR"});
            throw error;
        }finally{clearTimeout(timer)}
    }
    function expiryValid(data){return !data?.expires_at||new Date(data.expires_at).getTime()>Date.now()}
    function usableCache(maxAgeMs){const cache=read(CACHE_KEY);return cache&&cache.data?.ok&&expiryValid(cache.data)&&(Date.now()-Number(cache.checkedAt||0)<=maxAgeMs)?cache:null}
    async function check(options={}){
        if(!cfg().enabled)return {ok:true,bypass:true,features:["*"]};
        const token=localStorage.getItem(TOKEN_KEY);
        const code=storeCode();
        if(!token||!code)throw Object.assign(new Error("Aplikasi belum memiliki aktivasi lisensi dan Store Code."),{code:"ACTIVATION_REQUIRED"});
        const fresh=usableCache((Number(cfg().onlineCacheMinutes)||2)*60*1000);
        if(fresh&&!options.force)return fresh.data;
        try{return saveSuccess(await call("check",{activation_token:token,store_code:code}))}
        catch(error){
            if(["LICENSE_NETWORK_ERROR","LICENSE_TIMEOUT"].includes(error.code)){
                const offline=usableCache((Number(cfg().offlineGraceHours)||24)*60*60*1000);
                if(offline)return {...offline.data,offline_grace:true};
            }
            throw error;
        }
    }
    async function activate(values){
        const code=String(values.store_code||"").trim().toUpperCase();
        if(!code)throw Object.assign(new Error("Store Code wajib diisi."),{code:"STORE_CODE_REQUIRED"});
        clearCache();
        const data=await call("activate",{license_key:String(values.license_key||"").trim(),store_code:code});
        return saveSuccess(data,data.activation_token);
    }
    async function startTrial(values){
        const code=String(values.store_code||"").trim().toUpperCase();
        const data=await call("start_trial",{customer_name:values.customer_name,customer_email:values.customer_email,customer_phone:values.customer_phone||"",store_code:code});
        return saveSuccess(data,data.activation_token);
    }
    async function deactivate(){
        const activationToken=localStorage.getItem(TOKEN_KEY);
        if(activationToken&&configured())await call("deactivate",{activation_token:activationToken}).catch(()=>undefined);
        clearActivation();
        return {ok:true};
    }
    function hasFeature(feature,data){const features=Array.isArray(data?.features)?data.features:[];return features.includes("*")||!feature||features.includes(feature)}
    function whatsappUrl(message){const phone=String(cfg().developerWhatsApp||"").replace(/\D/g,"");return phone?`https://wa.me/${phone}?text=${encodeURIComponent(message)}`:"#"}
    window.LDMLicenseV2={configured,deviceId,deviceName,storeCode,activationContext,check,activate,startTrial,deactivate,clearActivation,clearCache,hasFeature,whatsappUrl,call,keys:{TOKEN_KEY,DEVICE_KEY,CONTEXT_KEY,CACHE_KEY}};
})();

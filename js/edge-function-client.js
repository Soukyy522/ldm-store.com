(function(){
    "use strict";

    function cfg(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.getConfig !== "function"){
            throw new Error("Konfigurasi layanan Cloud belum tersedia.");
        }
        return window.LDMSupabase.getConfig() || {};
    }

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Layanan Cloud belum siap.");
        }
        return window.LDMSupabase.createClient();
    }

    function deploymentHint(functionName){
        return `Layanan server belum siap. Hubungi Developer bila masalah berlanjut.`;
    }

    async function invoke(functionName,{body={},timeoutMs=20000,requireAuth=true,headers={}}={}){
        const name=String(functionName||"").trim();
        if(!/^[a-z0-9][a-z0-9-]*$/i.test(name)){
            throw new Error("Nama layanan server tidak valid.");
        }

        const config=cfg();
        const base=String(config.url||"").replace(/\/+$/g,"");
        const key=String(config.publishableKey||"").trim();
        if(!base || !key){
            throw new Error("Konfigurasi layanan Cloud belum lengkap.");
        }

        let token="";
        if(requireAuth){
            const {data,error}=await client().auth.getSession();
            if(error) throw error;
            token=String(data?.session?.access_token||"").trim();
            if(!token){
                throw new Error("Session Cloud tidak tersedia. Login ulang lalu coba lagi.");
            }
        }

        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),Math.max(3000,Number(timeoutMs)||20000));
        const deviceId=window.LDMSupabase?.getOrCreateDeviceHeaderId?.();
        const requestHeaders={
            "Content-Type":"application/json",
            "apikey":key,
            ...(token?{"Authorization":`Bearer ${token}`}:{ }),
            ...(deviceId?{"x-ldm-device-id":String(deviceId)}:{ }),
            ...headers
        };

        try{
            const response=await fetch(`${base}/functions/v1/${name}`,{
                method:"POST",
                headers:requestHeaders,
                body:JSON.stringify(body||{}),
                cache:"no-store",
                credentials:"omit",
                signal:controller.signal
            });

            const text=await response.text();
            let payload=null;
            if(text){
                try{payload=JSON.parse(text)}catch(_){payload={raw:text}}
            }
            payload=payload||{};

            if(!response.ok || payload.ok===false){
                let message=String(payload.error||payload.message||`HTTP ${response.status}`);
                if(response.status===404){
                    message=`Layanan server ${name} belum tersedia. Hubungi Developer.`;
                }else if(response.status===401){
                    message=`Sesi login ditolak oleh layanan server. Login ulang. Jika tetap terjadi, hubungi Developer.`;
                }else if(response.status===403){
                    message=String(payload.error||payload.message||"Akun ini tidak mempunyai hak untuk menjalankan aksi tersebut.");
                }else if(response.status>=500 && !payload.error && !payload.message){
                    message=`Layanan server mengalami gangguan. Coba kembali beberapa saat lagi atau hubungi Support.`;
                }
                const error=new Error(message);
                error.status=response.status;
                error.payload=payload;
                error.functionName=name;
                throw error;
            }

            return payload;
        }catch(error){
            if(error && error.name==="AbortError"){
                throw new Error(`Layanan server tidak merespons tepat waktu. Periksa koneksi dan coba kembali.`);
            }
            if(error instanceof TypeError || /Failed to fetch|Failed to send a request|NetworkError/i.test(String(error?.message||error))){
                throw new Error(`Tidak dapat menghubungi layanan server. Periksa koneksi internet dan coba kembali.`);
            }
            throw error;
        }finally{
            clearTimeout(timer);
        }
    }

    window.LDMEdgeFunctionClient=Object.freeze({invoke});
})();

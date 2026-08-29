(function(){
    "use strict";
    let started = false;
    async function boot(){
        if(started) return;
        started = true;
        try{
            if(!window.LDMProcurement){
                throw new Error("procurement-service.js belum termuat.");
            }
            const result = await window.LDMProcurement.bootstrap();
            window.dispatchEvent(new CustomEvent("ldm-procurement-ready",{detail:result}));
        }catch(error){
            started = false;
            console.warn("Cloud Procurement bootstrap:",error);
            window.dispatchEvent(new CustomEvent("ldm-procurement-bootstrap-error",{
                detail:{message:error.message || String(error)}
            }));
        }
    }
    if(document.readyState === "loading"){
        document.addEventListener("DOMContentLoaded",boot,{once:true});
    }else{
        boot();
    }
})();

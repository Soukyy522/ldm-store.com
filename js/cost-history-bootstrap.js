(function(){
    "use strict";
    let started=false;
    async function boot(){
        if(started) return;
        started=true;
        try{
            if(!window.LDMCostHistory) throw new Error("cost-history-service.js belum termuat.");
            const result=await window.LDMCostHistory.bootstrap();
            window.dispatchEvent(new CustomEvent("ldm-cost-history-ready",{detail:result}));
        }catch(error){
            started=false;
            console.warn("Cost History bootstrap dilewati:",error);
        }
    }
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
    else boot();
})();

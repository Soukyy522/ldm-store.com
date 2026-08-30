(function(){
    "use strict";

    let started = false;

    async function boot(){
        if(started){
            return;
        }

        started = true;

        try{
            if(
                !window.LDMReporting ||
                typeof window.LDMReporting.bootstrap !== "function"
            ){
                throw new Error("reporting-service.js belum termuat.");
            }

            const result = await window.LDMReporting.bootstrap();

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-reporting-ready",
                    {detail:result}
                )
            );
        }catch(error){
            started = false;
            console.warn("Cloud Reporting bootstrap:",error);

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-reporting-bootstrap-error",
                    {
                        detail:{
                            message:error && error.message
                                ? error.message
                                : String(error)
                        }
                    }
                )
            );
        }
    }

    if(document.readyState === "loading"){
        document.addEventListener(
            "DOMContentLoaded",
            boot,
            {once:true}
        );
    }else{
        boot();
    }
})();

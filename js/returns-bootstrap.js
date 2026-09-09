(function(){
    "use strict";

    let started = false;

    async function boot(){
        if(started){
            return;
        }

        started = true;

        try{
            if(!window.LDMReturns){
                throw new Error(
                    "returns-service.js belum termuat."
                );
            }

            const result =
                await window.LDMReturns.bootstrap();

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-returns-ready",
                    {detail:result}
                )
            );

        }catch(error){
            started = false;

            console.warn(
                "Cloud Retur bootstrap:",
                error
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-returns-bootstrap-error",
                    {
                        detail:{
                            message:
                                error.message ||
                                String(error)
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
(function(){
    "use strict";

    let started = false;

    async function boot(){
        if(started){
            return;
        }

        started = true;

        try{
            if(!window.LDMStockOpname){
                throw new Error(
                    "stock-opname-service.js belum termuat."
                );
            }

            const result =
                await window.LDMStockOpname.bootstrap();

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-stock-opname-ready",
                    {detail:result}
                )
            );

        }catch(error){
            started = false;

            console.warn(
                "Cloud Stock Opname bootstrap:",
                error
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-stock-opname-bootstrap-error",
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
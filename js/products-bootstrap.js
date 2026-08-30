(function(){
    "use strict";

    let started =
        false;

    async function boot(){
        if(started){
            return;
        }

        started =
            true;

        try{
            if(!window.LDMProducts){
                throw new Error(
                    "products-service.js belum termuat."
                );
            }

            const result =
                await window.LDMProducts
                    .bootstrap();

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-products-ready",
                    {
                        detail:
                            result
                    }
                )
            );

        }catch(error){
            started =
                false;

            console.warn(
                "Cloud Products bootstrap:",
                error
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-products-bootstrap-error",
                    {
                        detail: {
                            message:
                                error.message
                                ||
                                String(error)
                        }
                    }
                )
            );
        }
    }

    if(
        document.readyState ===
        "loading"
    ){
        document.addEventListener(
            "DOMContentLoaded",
            boot,
            {
                once:
                    true
            }
        );
    }else{
        boot();
    }
})();

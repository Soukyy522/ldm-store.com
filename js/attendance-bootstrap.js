(function(){
    "use strict";

    let started = false;

    async function boot(){
        if(started){
            return;
        }

        started = true;

        try{
            if(!window.LDMAttendance){
                throw new Error(
                    "attendance-service.js belum termuat."
                );
            }

            const result =
                await window.LDMAttendance
                    .bootstrap();

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-attendance-ready",
                    {
                        detail:result
                    }
                )
            );

        }catch(error){
            started = false;

            console.warn(
                "Cloud Attendance bootstrap:",
                error
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-attendance-bootstrap-error",
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
            {
                once:true
            }
        );
    }else{
        boot();
    }
})();

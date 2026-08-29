(function(){
    "use strict";

    function refresh(){
        window.dispatchEvent(new CustomEvent("ldm-settings-ready", {
            detail:{version:"19.0.0"}
        }));
        return true;
    }

    window.LDMSettings = Object.freeze({version:"19.0.0",refresh});
    if(document.readyState === "loading"){
        document.addEventListener("DOMContentLoaded", refresh, {once:true});
    }else{
        refresh();
    }
})();

(function(){
    "use strict";

    const VERSION = "19.0.0";
    const HISTORY_KEY = "ldmQaRuntimeV19";
    const MAX_HISTORY = 30;
    const current = {
        version:VERSION,page:location.pathname.split("/").pop() || "index.html",
        startedAt:new Date().toISOString(),errors:0,rejections:0,longTasks:0,
        longestTask:0,lcp:0,cls:0,inp:0,ttfb:0,domContentLoaded:0,load:0,
        resources:0,transferBytes:0
    };

    function safeMessage(value){
        return String(value || "")
            .replace(/[?#].*$/g,"")
            .replace(/(?:sb_secret_|service_role)[A-Za-z0-9._-]*/gi,"[REDACTED]")
            .slice(0,180);
    }

    function observe(type,handler,options={}){
        try{
            const observer = new PerformanceObserver(list => list.getEntries().forEach(handler));
            observer.observe({type,buffered:true,...options});
        }catch(error){ /* Browser belum mendukung metric tersebut. */ }
    }

    observe("largest-contentful-paint",entry => { current.lcp = Math.round(entry.startTime); });
    observe("layout-shift",entry => { if(!entry.hadRecentInput) current.cls += Number(entry.value || 0); });
    observe("longtask",entry => {
        current.longTasks += 1;
        current.longestTask = Math.max(current.longestTask,Math.round(entry.duration || 0));
    });
    observe("event",entry => {
        if(entry.interactionId) current.inp = Math.max(current.inp,Math.round(entry.duration || 0));
    },{durationThreshold:40});

    window.addEventListener("error",event => {
        current.errors += 1;
        current.lastError = safeMessage(event.message || event.error && event.error.message);
    });
    window.addEventListener("unhandledrejection",event => {
        current.rejections += 1;
        current.lastRejection = safeMessage(event.reason && event.reason.message || event.reason);
    });

    function snapshot(){
        const navigation = performance.getEntriesByType("navigation")[0];
        if(navigation){
            current.ttfb = Math.round(navigation.responseStart || 0);
            current.domContentLoaded = Math.round(navigation.domContentLoadedEventEnd || 0);
            current.load = Math.round(navigation.loadEventEnd || performance.now());
        }
        const resources = performance.getEntriesByType("resource");
        current.resources = resources.length;
        current.transferBytes = Math.round(resources.reduce((sum,row) => sum + Number(row.transferSize || 0),0));
        current.cls = Number(current.cls.toFixed(4));
        return {...current,capturedAt:new Date().toISOString()};
    }

    function history(){
        try{
            const rows = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            return Array.isArray(rows) ? rows : [];
        }catch(error){ return []; }
    }

    function persist(){
        const rows = history();
        rows.unshift(snapshot());
        localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(0,MAX_HISTORY)));
    }

    window.addEventListener("pagehide",persist,{once:true});
    window.LDMQuality = Object.freeze({version:VERSION,snapshot,history,clear:()=>localStorage.removeItem(HISTORY_KEY)});
})();

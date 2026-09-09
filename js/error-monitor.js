(function(){
    "use strict";

    const VERSION = "27.9.0-monitor-4";
    const QUEUE_LIMIT = 20;
    const DEDUPE_MS = 30000;
    const queue = [];
    const recent = new Map();
    let flushing = false;
    let consolePatched = false;

    function safeText(value, max){
        const text = String(value == null ? "" : value);
        return text.length > max ? text.slice(0,max) : text;
    }

    function redact(value, max){
        let text = safeText(value,max);
        text = text
            .replace(/\b(?:sb_secret_|service_role)[A-Za-z0-9._-]+/gi,"[REDACTED_SECRET]")
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED]")
            .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,"[REDACTED_JWT]")
            .replace(/(password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]");
        return text;
    }

    function pageName(){
        try{
            return decodeURIComponent(location.pathname.split("/").pop() || "index.html");
        }catch(_){
            return location.pathname.split("/").pop() || "index.html";
        }
    }

    function appVersion(){
        return String(window.LDM_APP_VERSION || "27.9.0");
    }

    function deviceId(){
        try{
            if(window.LDMSupabase && typeof window.LDMSupabase.getOrCreateDeviceHeaderId === "function"){
                return safeText(window.LDMSupabase.getOrCreateDeviceHeaderId(),140);
            }
            return safeText(localStorage.getItem("ldmCloudDeviceId") || "",140);
        }catch(_){
            return "";
        }
    }

    function normalizeError(error){
        if(error instanceof Error){
            return {
                error_name: safeText(error.name || "Error",160),
                message: redact(error.message || "Unknown client error",1200),
                stack: redact(error.stack || "",7000)
            };
        }
        if(typeof error === "string"){
            return {error_name:"Error",message:redact(error,1200),stack:""};
        }
        try{
            return {
                error_name:"Error",
                message:redact(JSON.stringify(error),1200),
                stack:""
            };
        }catch(_){
            return {error_name:"Error",message:"Unknown client error",stack:""};
        }
    }

    function fingerprintOf(payload){
        return [payload.page,payload.action,payload.error_name,payload.message,payload.source_file,payload.line_no].join("|");
    }

    function pruneRecent(){
        const now = Date.now();
        for(const [key,time] of recent.entries()){
            if(now - time > DEDUPE_MS) recent.delete(key);
        }
    }

    function enqueue(payload){
        pruneRecent();
        const fp = fingerprintOf(payload);
        const last = recent.get(fp) || 0;
        if(Date.now() - last < DEDUPE_MS) return;
        recent.set(fp,Date.now());

        if(queue.length >= QUEUE_LIMIT) queue.shift();
        queue.push(payload);
        setTimeout(flush,0);
    }

    function eventPayload(error, options){
        options = options || {};
        const normalized = normalizeError(error);
        return {
            severity: ["warning","error","critical"].includes(String(options.severity||"").toLowerCase())
                ? String(options.severity).toLowerCase()
                : "error",
            page: safeText(options.page || pageName(),220),
            action: safeText(options.action || "client_runtime",180),
            error_name: safeText(options.error_name || normalized.error_name,160),
            message: options.message != null
                ? redact(options.message,1200)
                : normalized.message,
            stack: normalized.stack,
            source_file: safeText(options.source_file || "",500),
            line_no: Number.isFinite(Number(options.line_no)) ? Number(options.line_no) : null,
            column_no: Number.isFinite(Number(options.column_no)) ? Number(options.column_no) : null,
            app_version: safeText(appVersion(),80),
            device_id: deviceId(),
            browser: redact(navigator.userAgent || "",700),
            online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
            viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`
        };
    }

    async function getClient(){
        try{
            if(window.ldmSupabase) return window.ldmSupabase;
            if(window.LDMSupabase && window.LDMSupabase.isConfigured && window.LDMSupabase.isConfigured()){
                return window.LDMSupabase.createClient();
            }
        }catch(_){ }
        return null;
    }

    async function canSend(client){
        try{
            if(!client || !client.auth || typeof client.auth.getSession !== "function") return false;
            const result = await client.auth.getSession();
            return Boolean(result && result.data && result.data.session && result.data.session.user);
        }catch(_){
            return false;
        }
    }

    async function flush(){
        if(flushing || !queue.length) return;
        flushing = true;
        try{
            const client = await getClient();
            if(!(await canSend(client))) return;

            while(queue.length){
                const payload = queue[0];
                let result;
                try{
                    result = await client.rpc("ldm_report_client_error",{p_event:payload});
                }catch(_){
                    break;
                }
                if(result && result.error) break;

                queue.shift();
                const data = result && result.data ? result.data : null;
                if(data && data.incident_code){
                    window.dispatchEvent(new CustomEvent("ldm:error-reported",{detail:data}));
                }
            }
        }finally{
            flushing = false;
        }
    }

    function capture(error, options){
        try{ enqueue(eventPayload(error,options)); }catch(_){ }
    }

    window.addEventListener("error", function(event){
        try{
            if(event && event.error){
                capture(event.error,{
                    action:"window.onerror",
                    severity:"error",
                    source_file:event.filename || "",
                    line_no:event.lineno,
                    column_no:event.colno
                });
                return;
            }
            const target = event && event.target;
            if(target && target !== window && (target.tagName === "SCRIPT" || target.tagName === "LINK")){
                capture(new Error(`Resource gagal dimuat: ${target.src || target.href || target.tagName}`),{
                    action:"resource_load",
                    severity:"warning",
                    source_file:target.src || target.href || ""
                });
            }
        }catch(_){ }
    },true);

    window.addEventListener("unhandledrejection", function(event){
        capture(event && event.reason ? event.reason : new Error("Unhandled Promise Rejection"),{
            action:"unhandledrejection",
            severity:"error"
        });
    });

    function patchConsole(){
        if(consolePatched || !window.console || typeof console.error !== "function") return;
        consolePatched = true;
        const original = console.error.bind(console);
        console.error = function(){
            try{
                const args = Array.from(arguments);
                const firstError = args.find(item => item instanceof Error);
                const text = args.map(item => {
                    if(item instanceof Error) return `${item.name}: ${item.message}`;
                    if(typeof item === "string") return item;
                    try{return JSON.stringify(item)}catch(_){return String(item)}
                }).join(" ");
                capture(firstError || new Error(safeText(text || "console.error",1200)),{
                    action:"console.error",
                    severity:"error"
                });
            }catch(_){ }
            return original.apply(console,arguments);
        };
    }

    patchConsole();
    window.addEventListener("online",flush);
    document.addEventListener("visibilitychange",function(){
        if(document.visibilityState === "visible") flush();
    });
    setTimeout(flush,2500);

    window.LDMErrorMonitor = Object.freeze({
        version: VERSION,
        capture,
        flush,
        pendingCount: () => queue.length,
        test: () => capture("Uji Monitoring LocDailyMar — event sintetis, bukan error aplikasi.",{
            action:"monitoring_test",
            severity:"warning",
            error_name:"MonitoringTest",
            message:"Uji Monitoring LocDailyMar — event sintetis, bukan error aplikasi."
        })
    });
})();

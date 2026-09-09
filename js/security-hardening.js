(function(){
    "use strict";

    const VERSION = "19.0.0";

    function ensureReferrerPolicy(){
        if(document.querySelector('meta[name="referrer"]')) return;
        const meta = document.createElement("meta");
        meta.name = "referrer";
        meta.content = "strict-origin-when-cross-origin";
        document.head.appendChild(meta);
    }

    function hardenExternalLinks(root){
        (root || document).querySelectorAll('a[target="_blank"]').forEach(link => {
            const rel = new Set(String(link.rel || "").split(/\s+/).filter(Boolean));
            rel.add("noopener");
            rel.add("noreferrer");
            link.rel = Array.from(rel).join(" ");
        });
    }

    function hardenForms(root){
        (root || document).querySelectorAll('input[type="password"]').forEach(input => {
            if(!input.autocomplete){
                input.autocomplete = /new|confirm|ulang/i.test(input.id + " " + input.name)
                    ? "new-password"
                    : "current-password";
            }
        });
    }

    function plaintextLegacyPasswords(){
        try{
            const accounts = JSON.parse(localStorage.getItem("daftarAkun") || "[]");
            if(!Array.isArray(accounts)) return 0;
            return accounts.filter(account => account && typeof account.password === "string" && account.password.length > 0).length;
        }catch(error){
            return 0;
        }
    }

    function diagnostics(){
        const cfg = window.LDM_SUPABASE_CONFIG || {};
        const key = String(cfg.publishableKey || "");
        const mixed = Array.from(document.querySelectorAll("script[src],link[href],img[src]"))
            .map(node => node.src || node.href || "")
            .filter(url => /^http:\/\//i.test(url));
        return {
            version:VERSION,
            secureContext:window.isSecureContext || location.hostname === "localhost",
            https:location.protocol === "https:" || location.hostname === "localhost",
            framed:window.top !== window.self,
            referrerPolicy:document.querySelector('meta[name="referrer"]')?.content || "",
            mixedContentCount:mixed.length,
            externalBlankWithoutNoopener:document.querySelectorAll('a[target="_blank"]:not([rel~="noopener"])').length,
            plaintextLegacyPasswords:plaintextLegacyPasswords(),
            supabaseConfigured:Boolean(cfg.url && key),
            publishableKeyLooksSafe:Boolean(key && (/^sb_publishable_/i.test(key) || /^eyJ/i.test(key))) && !/service_role|secret/i.test(key)
        };
    }

    function boot(){
        hardenExternalLinks(document);
        hardenForms(document);
        window.dispatchEvent(new CustomEvent("ldm-security-ready", {detail:diagnostics()}));
    }

    ensureReferrerPolicy();
    window.LDMSecurity = Object.freeze({version:VERSION,diagnostics,hardenExternalLinks,hardenForms});
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
    else boot();
})();

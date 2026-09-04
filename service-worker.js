"use strict";

const APP_VERSION = "27.9.0";
const CACHE_PREFIX = "ldm-";
const SHELL_CACHE = `${CACHE_PREFIX}release27-9-0-commercial-monitoring-support-v2-shell-v2`;
const RUNTIME_CACHE = `${CACHE_PREFIX}release27-9-0-commercial-monitoring-support-v2-runtime-v2`;
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

const APP_SHELL = [
    "./", "./homepage.html", "./index.html", "./dashboard.html", "./kasir.html", "./barang.html", "./Purchase-Order.html", "./goods.receipt.html", "./multi-store.html",
    "./pwa-settings.html", "./penyimpanan.html", "./monitoring-error.html", "./account-management.html", "./device-management.html", "./panduan.html", "./owner-control-center.html", "./recovery-center.html", "./qa-security-performance.html", "./license.html", "./license-v2.html", "./developer-license.html", "./developer-license-v2.html", "./developer-incident-support.html", "./offline.html", "./manifest.json", "./icon.png",
    "./assets/icons/icon-192.png", "./assets/icons/icon-512.png", "./assets/brand/locdailymar-logo.png",
    "./assets/icons/maskable-512.png", "./style.css", "./css/global-responsive-navigation.css", "./css/help-center.css", "./css/multi-store-dashboard-theme.css", "./css/central-catalog-control.css", "./setting.js", "./employee-id.js",
    "./js/pwa-manager.js", "./js/local-time.js", "./js/error-monitor.js", "./js/error-monitor-admin.js", "./js/user-guide.js", "./js/storage-engine.js", "./js/storage-quota-guard.js", "./js/storage-health-monitor.js", "./js/security-hardening.js", "./js/qa-runtime.js", "./js/recovery-service.js", "./js/global-system-navigation.js", "./js/primary-owner-service.js", "./js/central-catalog-control.js",
    "./js/license-v2-config.js", "./js/license-v2-client.js", "./js/license-checkout-v2.js", "./js/license-v2-guard.js", "./js/license-v2-admin-config.js", "./js/license-v2-admin.js",
    "./js/offline-queue.js", "./js/supabase-config.js", "./js/supabase-client.js", "./js/account-service.js", "./js/device-service.js",
    "./js/cloud-auth.js", "./js/cloud-session.js", "./js/cloud-session-guard.js",
    "./js/unit-conversion.js", "./js/promo-pricing.js", "./js/multi-store-service.js", "./js/store-mode.js", "./js/product-visuals.js", "./css/store-modes.css", "./js/products-service.js", "./js/products-bootstrap.js",
    "./js/procurement-service.js", "./js/procurement-bootstrap.js",
    "./js/transactions-service.js", "./js/reporting-service.js", "./js/dashboard-report-source.js", "./js/attendance-service.js",
    "./js/attendance-bootstrap.js", SUPABASE_CDN
];

async function cacheOne(cache, url){
    try{
        const response = await fetch(url, {cache:"reload"});
        if(response.ok || response.type === "opaque") await cache.put(url, response.clone());
    }catch(error){
        // Satu resource eksternal yang gagal tidak membatalkan instalasi PWA.
    }
}

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.allSettled(APP_SHELL.map(url => cacheOne(cache, url)));
        // Aktivasi menunggu persetujuan PWA Manager setelah antrean offline aman.
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

function isSupabaseApi(url){ return /\.supabase\.co$/i.test(url.hostname); }

async function cacheFirst(request){
    const cached = await caches.match(request, {ignoreSearch:true});
    if(cached) return cached;
    const response = await fetch(request);
    if(response.ok || response.type === "opaque"){
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
    }
    return response;
}

async function networkFirstNavigation(request){
    try{
        const response = await fetch(request);
        if(response.ok){
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response.clone());
        }
        return response;
    }catch(error){
        const exact = await caches.match(request, {ignoreSearch:true});
        if(exact) return exact;
        return (await caches.match("./offline.html", {ignoreSearch:true})) || new Response(
            "Halaman belum tersedia offline.",
            {status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}}
        );
    }
}

async function networkFirstAsset(request){
    try{
        const response=await fetch(request,{cache:"no-store"});
        if(response.ok){
            const cache=await caches.open(RUNTIME_CACHE);
            await cache.put(request,response.clone());
        }
        return response;
    }catch(error){
        return (await caches.match(request,{ignoreSearch:true})) || new Response("Resource lisensi belum tersedia.",{status:503});
    }
}

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    if(request.method !== "GET" || isSupabaseApi(url)) return;
    if(request.mode === "navigate"){
        event.respondWith(networkFirstNavigation(request));
        return;
    }
    if(
        url.origin === self.location.origin &&
        /\/js\/(?:local-time|global-system-navigation|error-monitor|error-monitor-admin|license-checkout-v2|license-v2-(?:config|client|guard|admin-config|admin)|reporting-(?:service|bootstrap))\.js$/i.test(url.pathname)
    ){
        event.respondWith(networkFirstAsset(request));
        return;
    }
    if(url.origin === self.location.origin || url.hostname === "cdn.jsdelivr.net"){
        event.respondWith(cacheFirst(request));
    }
});

self.addEventListener("sync", event => {
    if(event.tag !== "ldm-offline-sales-v16") return;
    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({type:"window",includeUncontrolled:true});
        clients.forEach(client => client.postMessage({type:"LDM_SYNC_REQUEST"}));
    })());
});

self.addEventListener("message", event => {
    const data = event.data || {};
    if(data.type === "LDM_SKIP_WAITING") self.skipWaiting();
    if(data.type === "LDM_GET_VERSION" && event.source){
        event.source.postMessage({type:"LDM_SW_VERSION",version:APP_VERSION});
    }
});

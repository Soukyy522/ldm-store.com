(function(){
    "use strict";
    const VERSION="27.9.0-commercial04-integrated3";
    const PREFIX="ldmPeripheralSetupV1:";
    const DEFAULTS=Object.freeze({
        version:1,
        terminalName:"Kasir Utama",
        receiptWidth:"58",
        printerEnabled:true,
        printerMode:"browser",
        printerTestRequestedAt:null,
        printerTestedAt:null,
        scannerEnabled:true,
        scannerMode:"keyboard",
        scannerTestedAt:null,
        scannerLastCode:"",
        cameraCheckedAt:null,
        completedAt:null,
        updatedAt:null
    });
    function storeId(){
        return String(localStorage.getItem("ldmCloudStoreId")||"default").trim()||"default";
    }
    function key(){return PREFIX+storeId()}
    function safeParse(raw){try{return JSON.parse(raw)}catch(_){return null}}
    function getSettings(){return {...DEFAULTS,...(safeParse(localStorage.getItem(key()))||{})}}
    function saveSettings(patch){
        const next={...getSettings(),...(patch||{}),updatedAt:new Date().toISOString()};
        localStorage.setItem(key(),JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("ldm-peripheral-settings-changed",{detail:next}));
        return next;
    }
    function reset(){localStorage.removeItem(key());window.dispatchEvent(new CustomEvent("ldm-peripheral-settings-changed",{detail:getSettings()}));return getSettings()}
    function capabilities(){
        return {
            online:navigator.onLine!==false,
            print:typeof window.print==="function",
            keyboard:true,
            camera:Boolean(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia),
            barcodeDetector:"BarcodeDetector" in window,
            serviceWorker:"serviceWorker" in navigator,
            userAgent:String(navigator.userAgent||"").slice(0,180)
        };
    }
    function status(settings=getSettings()){
        const printerReady=settings.printerEnabled===false||Boolean(settings.printerTestedAt);
        const scannerReady=settings.scannerEnabled===false||Boolean(settings.scannerTestedAt);
        return {printerReady,scannerReady,complete:printerReady&&scannerReady,settings};
    }
    function receiptMetrics(width){
        return String(width)==="80"?{page:"80mm",content:"72mm",windowWidth:520}:{page:"58mm",content:"50mm",windowWidth:400};
    }
    function escHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
    function receiptTextConfig(){
        const custom=safeParse(localStorage.getItem("strukConfig"))||{};
        const header=safeParse(localStorage.getItem("headerConfig"))||{};
        const store=String(localStorage.getItem("ldmCloudStoreName")||"LocDailyMar").trim();
        return {
            namaToko:String(custom.namaToko||header.judul||store||"LocDailyMar POS").trim(),
            subHeader:String(custom.subHeader||header.subJudul||"").trim(),
            footer:String(custom.footer||"-- Terima Kasih --").trim()
        };
    }
    function multilineHtml(value){return escHtml(value).replace(/\r?\n/g,"<br>")}
    function openPrintTest(settings=getSettings()){
        const metrics=receiptMetrics(settings.receiptWidth);
        const w=window.open("","ldm_receipt_test",`height=680,width=${metrics.windowWidth}`);
        if(!w) throw new Error("Popup cetak diblokir browser. Izinkan popup untuk LocDailyMar lalu coba lagi.");
        const text=receiptTextConfig();
        const terminal=String(settings.terminalName||"Kasir");
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tes Printer LocDailyMar</title><style>@page{size:${metrics.page} auto;margin:0}html,body{margin:0;padding:0;width:${metrics.page}}body{font-family:monospace;font-size:11px}.receipt{width:${metrics.content};margin:0 auto;padding:2mm 0}.c{text-align:center}.sub{font-size:10px;line-height:1.35}.line{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between;gap:8px}h3{font-size:13px;margin:0 0 3px}</style></head><body><div class="receipt"><div class="c"><h3>${escHtml(text.namaToko)}</h3>${text.subHeader?`<div class="sub">${multilineHtml(text.subHeader)}</div>`:""}<div>TES PRINTER LOCDAILYMAR</div><div>${escHtml(terminal)}</div></div><div class="line"></div><div class="row"><span>Lebar Kertas</span><b>${metrics.page}</b></div><div class="row"><span>Item Uji</span><span>Rp 10.000</span></div><div class="row"><b>TOTAL</b><b>Rp 10.000</b></div><div class="line"></div><div class="c sub">${multilineHtml(text.footer||"-- Terima Kasih --")}</div></div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
        w.document.close();
        return true;
    }
    window.LDMPeripheralSetup=Object.freeze({VERSION,getSettings,saveSettings,reset,capabilities,status,receiptMetrics,openPrintTest});
})();

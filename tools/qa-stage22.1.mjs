import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const failures=[];
const required=[
    "multi-store.html",
    "dashboard.html",
    "js/global-system-navigation.js",
    "css/global-responsive-navigation.css",
    "css/multi-store-dashboard-theme.css",
    "service-worker.js",
    "docs/PATCH-22.1-NAVIGASI-RESPONSIVE.md"
];

for(const file of required){
    if(!fs.existsSync(path.join(root,file)))failures.push(`File tidak ditemukan: ${file}`);
}

for(const file of ["js/global-system-navigation.js","service-worker.js"]){
    try{new vm.Script(fs.readFileSync(path.join(root,file),"utf8"),{filename:file})}
    catch(error){failures.push(`${file}: ${error.message}`)}
}

const multiStore=fs.readFileSync(path.join(root,"multi-store.html"),"utf8");
for(const match of multiStore.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    if(!match[1].trim())continue;
    try{new vm.Script(match[1],{filename:"multi-store-inline.js"})}
    catch(error){failures.push(`multi-store.html: ${error.message}`)}
}

const markers=[
    [multiStore,"data-ldm-menu-toggle","Hamburger Multi-Toko"],
    [multiStore,"css/multi-store-dashboard-theme.css?v=22.1","CSS tema Multi-Toko"],
    [multiStore,"global-system-navigation.js?v=22.1","Navigasi global Multi-Toko"],
    [fs.readFileSync(path.join(root,"dashboard.html"),"utf8"),'page:"multi-store.html"',"Multi-Toko pada Mega Menu Dashboard"],
    [fs.readFileSync(path.join(root,"js/global-system-navigation.js"),"utf8"),"ldm-global-mega-grid","Generator Mega Menu"],
    [fs.readFileSync(path.join(root,"js/global-system-navigation.js"),"utf8"),"ldm-global-mobile-drawer","Generator hamburger drawer"],
    [fs.readFileSync(path.join(root,"css/global-responsive-navigation.css"),"utf8"),"@media (min-width:900px)","Breakpoint desktop"],
    [fs.readFileSync(path.join(root,"css/global-responsive-navigation.css"),"utf8"),"@media (max-width:899px)","Breakpoint mobile"],
    [fs.readFileSync(path.join(root,"service-worker.js"),"utf8"),'APP_VERSION = "22.1.0"',"Versi PWA"]
];

for(const [content,marker,label] of markers){
    if(!content.includes(marker))failures.push(`${label} tidak ditemukan.`);
}

const navPages=[];
for(const entry of fs.readdirSync(root)){
    if(!entry.toLowerCase().endsWith(".html"))continue;
    const content=fs.readFileSync(path.join(root,entry),"utf8");
    if(content.includes("global-system-navigation.js"))navPages.push([entry,content]);
}
for(const [file,content] of navPages){
    if(!content.includes("global-system-navigation.js?v=22.1"))failures.push(`${file}: cache-buster navigasi belum 22.1.`);
}

if(process.env.LDM_QA_BASE_URL){
    try{
        const {chromium}=createRequire(import.meta.url)("playwright");
        const browser=await chromium.launch({headless:true});
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        await page.addInitScript(()=>{
            localStorage.setItem("userRole","owner");
            localStorage.setItem("activeUsername","qa-owner");
            localStorage.setItem("ldmCloudStoreName","Toko QA");
            localStorage.setItem("headerConfig",JSON.stringify({judul:"LocDailyMar QA",subJudul:"Operasional Toko",warnaBgHeader:"#0d2240",warnaSubJudul:"#ffc107",bgPrimary:"#f4f6f9",bgSecondary:"#ffffff",darkMode:false}));
        });
        await page.route("**/*",route=>{
            const url=new URL(route.request().url());
            if(url.hostname==="127.0.0.1"||url.hostname==="localhost")route.continue();
            else route.abort();
        });
        await page.goto(`${process.env.LDM_QA_BASE_URL.replace(/\/$/,"")}/multi-store.html`,{waitUntil:"domcontentloaded",timeout:15000});
        await page.waitForTimeout(800);
        if(await page.locator("#ldmGlobalMegaNav").count()!==1)failures.push("Browser desktop: Mega Menu tidak terbentuk.");
        if(await page.locator("#ldmGlobalMegaNav .ldm-global-link").count()<15)failures.push("Browser desktop: daftar menu Owner tidak lengkap.");
        await page.setViewportSize({width:390,height:844});
        await page.locator("[data-ldm-menu-toggle]").first().click();
        if(!await page.locator("#ldmGlobalMobileDrawer").evaluate(node=>node.classList.contains("open")))failures.push("Browser mobile: drawer tidak terbuka.");
        await browser.close();
    }catch(error){failures.push(`Browser QA: ${error.message}`)}
}

if(failures.length){
    console.error(`PATCH 22.1 QA: FAIL ${failures.length}`);
    failures.forEach(item=>console.error(`- ${item}`));
    process.exit(1);
}

console.log(`PATCH 22.1 QA: PASS (${navPages.length} halaman navigasi)`);

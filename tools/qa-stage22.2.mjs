import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const failures=[];
const required=[
    "dashboard.html",
    "eod.html",
    "js/global-system-navigation.js",
    "css/global-responsive-navigation.css",
    "service-worker.js",
    "docs/PATCH-22.2-NAVIGASI-GLOBAL-EOD.md"
];

for(const file of required){
    if(!fs.existsSync(path.join(root,file)))failures.push(`File tidak ditemukan: ${file}`);
}

for(const file of ["js/global-system-navigation.js","service-worker.js"]){
    try{new vm.Script(fs.readFileSync(path.join(root,file),"utf8"),{filename:file})}
    catch(error){failures.push(`${file}: ${error.message}`)}
}

const navJs=fs.readFileSync(path.join(root,"js/global-system-navigation.js"),"utf8");
const navCss=fs.readFileSync(path.join(root,"css/global-responsive-navigation.css"),"utf8");
const sw=fs.readFileSync(path.join(root,"service-worker.js"),"utf8");
const dashboard=fs.readFileSync(path.join(root,"dashboard.html"),"utf8");

const markers=[
    [navJs,'const NAV_VERSION="22.2"',"Versi navigasi"],
    [navJs,'requiresEodReady:true',"Gate EOD"],
    [navJs,'calculateEodReadiness',"Perhitungan readiness EOD"],
    [navJs,'buildMega',"Mega Menu global"],
    [navJs,'buildMobileDrawer',"Drawer global HP"],
    [navJs,'"multi-store.html"',"Menu Multi-Toko"],
    [navCss,'html.ldm-global-nav-ready .nav-bar',"Legacy sidebar fallback"],
    [navCss,'html:not([data-ldm-eod-ready="true"]) a[href="eod.html"]',"CSS hide EOD"],
    [navCss,'@media (min-width:900px)',"Breakpoint desktop"],
    [navCss,'@media (max-width:899px)',"Breakpoint HP"],
    [navCss,'html.ldm-global-nav-ready .main-content',"Normalisasi layout"],
    [sw,'APP_VERSION = "22.2.0"',"Versi PWA"],
    [dashboard,'page:"eod.html"',"EOD masih tercatat pada source Dashboard"]
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
    if(!content.includes("global-system-navigation.js?v=22.2"))failures.push(`${file}: cache-buster navigasi belum 22.2.`);
}
if(navPages.length<20)failures.push(`Halaman navigasi terdeteksi terlalu sedikit: ${navPages.length}`);

/* Unit test logika EOD tanpa browser. Boot DOM sengaja tidak dijalankan. */
try{
    const data=new Map();
    const localStorage={
        getItem:key=>data.has(key)?data.get(key):null,
        setItem:(key,value)=>data.set(key,String(value)),
        removeItem:key=>data.delete(key),
        clear:()=>data.clear()
    };
    const fakeDocument={
        readyState:"loading",
        addEventListener(){},
        querySelectorAll(){return []},
        documentElement:{dataset:{},style:{setProperty(){},},setAttribute(){},classList:{add(){},toggle(){}}},
        body:{classList:{toggle(){},remove(){},add(){}}}
    };
    const fakeWindow={addEventListener(){},setInterval(){return 0},dispatchEvent(){}};
    const sandbox={
        window:fakeWindow,
        document:fakeDocument,
        localStorage,
        location:{pathname:"/dashboard.html"},
        matchMedia:()=>({matches:false}),
        CustomEvent:function(){},
        setTimeout(){},
        console,
        Date
    };
    vm.runInNewContext(navJs,sandbox,{filename:"global-system-navigation.js"});
    const api=fakeWindow.LDMGlobalNavigation;
    if(!api)throw new Error("API navigasi global tidak diekspor");

    const now=new Date(Date.now()+8*60*60*1000);
    const today=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-${String(now.getUTCDate()).padStart(2,"0")}`;
    localStorage.setItem("laporan",JSON.stringify([{tanggal:today,kasir:"kasir1"},{tanggal:today,kasir:"kasir2"}]));
    localStorage.setItem("shiftClosingLog","[]");
    if(api.calculateEodReadiness().ready!==false)failures.push("EOD harus belum ready sebelum Closing Shift.");

    localStorage.setItem("shiftClosingLog",JSON.stringify([
        {tanggal:today,kasir:"kasir1",shift:"Shift 1"},
        {tanggal:today,kasir:"kasir2",shift:"Shift 2"}
    ]));
    if(api.calculateEodReadiness().ready!==true)failures.push("EOD harus ready setelah seluruh Closing Shift lengkap.");
}catch(error){
    failures.push(`Unit EOD: ${error.message}`);
}

if(failures.length){
    console.error(`PATCH 22.2 QA: FAIL ${failures.length}`);
    failures.forEach(item=>console.error(`- ${item}`));
    process.exit(1);
}
console.log(`PATCH 22.2 QA: PASS (${navPages.length} halaman navigasi)`);

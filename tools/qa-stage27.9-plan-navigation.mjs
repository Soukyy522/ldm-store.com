import fs from "node:fs";
import vm from "node:vm";

const failures=[];
const navJs=fs.readFileSync("js/global-system-navigation.js","utf8");
const guardJs=fs.readFileSync("js/license-v2-guard.js","utf8");
const barang=fs.readFileSync("barang.html","utf8");
const sw=fs.readFileSync("service-worker.js","utf8");

for(const [name,source] of [["navigasi",navJs],["guard",guardJs],["service worker",sw]]){
    try{new vm.Script(source,{filename:name})}
    catch(error){failures.push(`${name}: sintaks tidak valid (${error.message})`)}
}

const fakeWindow={
    LDM_LICENSE_V2_CONFIG:{enabled:true},
    LDMLicenseV2:{hasFeature:(feature,data)=>!feature||data?.features?.includes("*")||data?.features?.includes(feature)},
    addEventListener(){},
    setInterval(){return 0},
    dispatchEvent(){}
};
const fakeDocument={
    readyState:"loading",
    addEventListener(){},
    querySelectorAll(){return []},
    documentElement:{dataset:{},style:{setProperty(){}},setAttribute(){},classList:{add(){},toggle(){}}},
    body:{classList:{toggle(){},remove(){},add(){}}}
};
const sandbox={
    window:fakeWindow,
    document:fakeDocument,
    localStorage:{getItem(){return null}},
    location:{pathname:"/barang.html"},
    matchMedia:()=>({matches:false}),
    CustomEvent:function(){},
    setTimeout(){},
    console,
    Date
};

try{
    vm.runInNewContext(navJs,sandbox,{filename:"global-system-navigation.js"});
    const api=fakeWindow.LDMGlobalNavigation;
    if(!api?.getVisibleRoutes)throw new Error("API pengujian menu tidak tersedia");

    const pages=()=>api.getVisibleRoutes("owner",true).map(route=>route.page.toLowerCase());
    const expectPresent=(list,page,label)=>{if(!list.includes(page.toLowerCase()))failures.push(`${label}: ${page} seharusnya tampil`)};
    const expectAbsent=(list,page,label)=>{if(list.includes(page.toLowerCase()))failures.push(`${label}: ${page} seharusnya terkunci`)};

    fakeWindow.LDM_LICENSE_V2_STATE=null;
    const pending=pages();
    if(pending.some(page=>!['license.html','panduan.html'].includes(page))){
        failures.push("Sebelum lisensi siap, menu berfitur harus fail-closed.");
    }

    fakeWindow.LDM_LICENSE_V2_STATE={plan_code:"WARUNG_KECIL",features:[
        "dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns",
        "shift_closing","backup_restore","basic_promo","cloud_accounts","cloud_devices"
    ]};
    const kecil=pages();
    for(const page of ["dashboard.html","barang.html","kartu-stok.html","stock-opname.html","laporan.html","account-management.html","device-management.html"]){
        expectPresent(kecil,page,"Warung Kecil");
    }
    for(const page of ["supplier.html","purchase-order.html","goods.receipt.html","pengeluaran.html","multi-store.html","eod.html","pwa-settings.html","recovery-center.html","qa-security-performance.html","owner-control-center.html"]){
        expectAbsent(kecil,page,"Warung Kecil");
    }

    fakeWindow.LDM_LICENSE_V2_STATE={plan_code:"WARUNG_SEDERHANA",features:[
        "dashboard","pos","inventory","stock_card","stock_opname","reports","attendance","returns",
        "shift_closing","backup_restore","basic_promo","advanced_promo","expenses","suppliers",
        "purchase_order","goods_receipt","cloud_accounts","cloud_devices","recovery_center","app_update"
    ]};
    const sederhana=pages();
    for(const page of ["supplier.html","purchase-order.html","goods.receipt.html","pengeluaran.html","pwa-settings.html","recovery-center.html"]){
        expectPresent(sederhana,page,"Warung Sederhana");
    }
    for(const page of ["multi-store.html","eod.html","qa-security-performance.html","owner-control-center.html"]){
        expectAbsent(sederhana,page,"Warung Sederhana");
    }

    fakeWindow.LDM_LICENSE_V2_STATE={plan_code:"TOKO",features:["*"]};
    const semua=pages();
    for(const page of ["supplier.html","multi-store.html","eod.html","qa-security-performance.html","owner-control-center.html"]){
        expectPresent(semua,page,"Paket semua fitur");
    }
}catch(error){
    failures.push(`Runtime menu: ${error.message}`);
}

const markers=[
    [navJs,'const NAV_VERSION="27.9.0"',"versi navigasi"],
    [navJs,'feature:"suppliers"',"pemetaan Supplier"],
    [navJs,'feature:"multi_store"',"pemetaan Multi-Toko"],
    [navJs,'if(!licenseFeatureAllowed(route.feature))return false',"filter fitur sebelum render"],
    [navJs,'window.addEventListener("ldm-license-v2-authorized"',"render ulang sesudah otorisasi"],
    [guardJs,'[data-license-locked="true"]{display:none!important}',"CSS menu terkunci"],
    [guardJs,'if(allowed)link.removeAttribute("data-license-locked")',"pemulihan menu setelah upgrade"],
    [barang,'global-system-navigation.js?v=27.9.0',"cache-buster barang"],
    [sw,'APP_VERSION = "27.9.0"',"versi service worker"],
    [sw,'local-time|global-system-navigation|license-checkout-v2',"navigasi network-first"]
];
for(const [source,marker,label] of markers){
    if(!source.includes(marker))failures.push(`${label} tidak ditemukan`);
}

if(failures.length){
    console.error(`PATCH 27.9 QA: FAIL (${failures.length})`);
    failures.forEach(item=>console.error(`- ${item}`));
    process.exit(1);
}

console.log("PATCH 27.9 QA: PASS");
console.log("- Warung Kecil: menu di luar paket tersembunyi");
console.log("- Warung Sederhana: menu tingkat Toko tersembunyi");
console.log("- Lisensi belum siap: navigasi berfitur fail-closed");
console.log("- Paket semua fitur: seluruh menu yang sesuai role tersedia");

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];

function expect(file,pattern,message){
    if(!pattern.test(read(file)))failures.push(`${file}: ${message}`);
}
function reject(file,pattern,message){
    if(pattern.test(read(file)))failures.push(`${file}: ${message}`);
}
function checkInlineScripts(file){
    const html=read(file);
    const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map(match=>match[1]).filter(code=>code.trim());
    scripts.forEach((code,index)=>{
        try{new vm.Script(code,{filename:`${file}:inline-${index+1}`});}
        catch(error){failures.push(`${file}: JavaScript inline tidak valid - ${error.message}`);}
    });
}

expect("owner-control-center.html",/Update Data Barang Cabang Lain/,"panel katalog pusat belum tersedia");
expect("owner-control-center.html",/Stok tetap terpisah untuk setiap cabang/,"batas sinkron stok tidak dijelaskan");
expect("js/primary-owner-service.js",/ldm_primary_owner_sync_all_catalog/,"RPC sinkron semua belum dipakai");
expect("js/products-service.js",/central_catalog_locked/,"sinkron lokal Owner Cabang belum dihentikan");
expect("barang.html",/data-ldm-catalog-editor="false"/,"kontrol edit katalog cabang belum disembunyikan");
expect("supabase/sql/24-stage26-central-product-catalog-sync.sql",/ldm_guard_central_product_catalog/,"guard katalog server belum tersedia");
expect("supabase/sql/24-stage26-central-product-catalog-sync.sql",/new\.purchase_price\s*:=\s*old\.purchase_price/,"harga beli cabang belum dipertahankan saat GR");
expect("supabase/sql/24-stage26-central-product-catalog-sync.sql",/legacy_stock_snapshot,last_expiry_date,[\s\S]+v_source\.purchase_price,v_source\.sale_price,0,null/s,"produk baru cabang harus mulai dengan stok 0");
reject("supabase/sql/24-stage26-central-product-catalog-sync.sql",/set\s+legacy_stock_snapshot\s*=\s*v_source\.legacy_stock_snapshot/i,"sinkron katalog tidak boleh menimpa stok cabang");
reject("supabase/sql/24-stage26-central-product-catalog-sync.sql",/grant\s+(?:select,)?insert|grant\s+update|grant\s+delete/i,"hak mutasi tabel products tidak boleh dibuka");

checkInlineScripts("barang.html");
checkInlineScripts("owner-control-center.html");

for(const file of [
    "js/primary-owner-service.js",
    "js/central-catalog-control.js",
    "js/products-service.js",
    "service-worker.js"
]){
    try{new vm.Script(read(file),{filename:file});}
    catch(error){failures.push(`${file}: JavaScript tidak valid - ${error.message}`);}
}

if(failures.length){
    console.error(`QA 26 GAGAL (${failures.length})`);
    failures.forEach(item=>console.error(`- ${item}`));
    process.exit(1);
}

console.log("QA 26 LULUS: katalog pusat, penguncian Owner Cabang, stok per toko, UI, dan JavaScript sesuai.");

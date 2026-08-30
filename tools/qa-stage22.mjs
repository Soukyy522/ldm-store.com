import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root=path.resolve(new URL("..",import.meta.url).pathname);
const required=[
    "multi-store.html","js/multi-store-service.js","js/supabase-client.js",
    "supabase/sql/19-stage22-multi-store-stock-transfer.sql",
    "supabase/sql/19-stage22-verify.sql","docs/TAHAP-22.md"
];
const failures=[];
for(const file of required){if(!fs.existsSync(path.join(root,file))) failures.push(`File tidak ada: ${file}`)}

for(const file of ["js/multi-store-service.js","js/supabase-client.js","js/global-system-navigation.js","service-worker.js"]){
    const code=fs.readFileSync(path.join(root,file),"utf8");
    try{new vm.Script(code,{filename:file})}catch(error){failures.push(`${file}: ${error.message}`)}
}

const html=fs.readFileSync(path.join(root,"multi-store.html"),"utf8");
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    if(!match[1].trim()) continue;
    try{new vm.Script(match[1],{filename:"multi-store-inline.js"})}catch(error){failures.push(`multi-store.html: ${error.message}`)}
}

const sql=fs.readFileSync(path.join(root,"supabase/sql/19-stage22-multi-store-stock-transfer.sql"),"utf8");
const markers=[
    "create table if not exists public.store_memberships",
    "create table if not exists public.active_store_sessions",
    "create table if not exists public.stock_transfers",
    "create table if not exists public.stock_transfer_items",
    "create or replace function public.ldm_current_store_id()",
    "create or replace function public.ldm_switch_store",
    "create or replace function public.ldm_send_stock_transfer",
    "create or replace function public.ldm_receive_stock_transfer",
    "'transfer_out'","'transfer_in'","enable row level security"
];
for(const marker of markers){if(!sql.toLowerCase().includes(marker.toLowerCase())) failures.push(`Marker SQL tidak ada: ${marker}`)}
if((sql.match(/\$\$/g)||[]).length%2!==0) failures.push("Dollar quote SQL tidak seimbang.");
if(!/x-ldm-device-id/i.test(fs.readFileSync(path.join(root,"js/supabase-client.js"),"utf8"))) failures.push("Header device tidak tersedia.");
if(!/multi-store\.html/.test(fs.readFileSync(path.join(root,"service-worker.js"),"utf8"))) failures.push("Multi-store belum masuk PWA shell.");

if(failures.length){console.error(`TAHAP 22 QA: FAIL ${failures.length}`);failures.forEach(item=>console.error(`- ${item}`));process.exit(1)}
console.log("TAHAP 22 QA: PASS");

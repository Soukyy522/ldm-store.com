#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root=path.resolve(process.argv[2]||process.cwd()),fail=[],pass=[],warn=[];
const check=(ok,label,detail="")=>(ok?pass:fail).push({label,detail});
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const required=["recovery-center.html","js/recovery-service.js","js/offline-queue.js","supabase-stage17-recovery-test.html","supabase/sql/16-stage17-sync-conflict-recovery.sql","supabase/sql/16-stage17-verify.sql","TAHAP-17-PANDUAN.txt","docs/TAHAP-17.md"];
required.forEach(file=>check(fs.existsSync(path.join(root,file)),`File ${file}`));

for(const file of ["js/recovery-service.js","js/offline-queue.js","service-worker.js","js/pwa-manager.js"]){try{new vm.Script(read(file),{filename:file});pass.push({label:`Sintaks ${file}`,detail:"valid"});}catch(error){fail.push({label:`Sintaks ${file}`,detail:error.message});}}

const queue=read("js/offline-queue.js"),recovery=read("js/recovery-service.js"),dashboard=read("dashboard.html"),kasir=read("kasir.html"),sw=read("service-worker.js"),sql=read("supabase/sql/16-stage17-sync-conflict-recovery.sql");
for(const api of ["recordCloudConflict","retryItem","retryByClientTransactionId","discardItem","applyRemoteDiscard"])check(queue.includes(api),`Offline Queue API ${api}`);
check(queue.includes('!["synced","discarded"].includes(row.status)'),"Queue discarded dikeluarkan dari sync aktif");
check(recovery.includes("processRemoteDecisions"),"Realtime retry/discard processor");
check(kasir.includes('js/recovery-service.js?v=17.0'),"Kasir memuat Recovery Realtime");
check(dashboard.includes('href="recovery-center.html"'),"Navigasi HP Recovery Center");
check(dashboard.includes('{page:"recovery-center.html"'),"Navigasi desktop Recovery Center");
check(sw.includes('"./recovery-center.html"')&&sw.includes('"./js/recovery-service.js"'),"Recovery tersedia dalam PWA App Shell");
check(sw.includes('APP_VERSION = "19.1.0"'),"Versi PWA 19.1.0");

for(const marker of ["create table if not exists public.sync_conflicts","alter table public.sync_conflicts enable row level security","ldm_record_sync_conflict","ldm_sync_conflict_action","ldm_mark_sync_conflict_recovered","ldm_block_discarded_offline_sale","trg_block_discarded_offline_sale","set search_path = ''","revoke all on function"]){check(sql.toLowerCase().includes(marker.toLowerCase()),`SQL marker ${marker}`);}
check(!/service_role|sb_secret_/i.test([queue,recovery,dashboard,kasir].join("\n")),"Tidak ada pola secret di frontend Stage 17");

const report={stage:17,version:"19.1.0",summary:{pass:pass.length,warn:warn.length,fail:fail.length},pass,warn,fail};
if(process.argv.includes("--json"))console.log(JSON.stringify(report,null,2));else{console.log(`TAHAP 17 QA — PASS ${pass.length} | WARN ${warn.length} | FAIL ${fail.length}`);for(const [title,rows] of [["FAIL",fail],["WARN",warn],["PASS",pass]]){if(rows.length){console.log(`\n${title}`);rows.forEach(row=>console.log(`- ${row.label}${row.detail?`: ${row.detail}`:""}`));}}}
process.exitCode=fail.length?1:0;

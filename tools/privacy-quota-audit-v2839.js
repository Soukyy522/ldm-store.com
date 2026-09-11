"use strict";
const fs=require("fs"),path=require("path"); const root=path.resolve(__dirname,".."); let bad=0;
function read(r){return fs.readFileSync(path.join(root,r),"utf8")}
function ok(c,m){console.log(`${c?"PASS":"FAIL"} ${m}`); if(!c)bad++}
const privacy=read("privacy-center.html"), pjs=read("js/privacy-center.js"), d=read("device-management.html"), ds=read("js/device-service.js"), ms=read("multi-store.html"), mjs=read("js/multi-store-service.js"), sw=read("service-worker.js"), cfg=read("js/license-v2-config.js"), sql=read("supabase/sql/28-stage28-license-entitlement-quota-hardening-V28.3.9-FIX1.sql"), la=read("license-authority-v2/SQL-20-LICENSE-QUOTA-ACTIVATION-HARDENING-V28.3.9.sql"), del=read("license-authority-v2/supabase/functions/_shared/ldm-license-delivery.ts");
ok(privacy.includes("Data Akun")||privacy.includes("Data Akun & Customer"),"Privacy Center menampilkan snapshot akun");
ok(pjs.includes("ldm_my_license_quota"),"Privacy Center membaca RPC kuota server");
ok(sql.includes("DEVICE_LIMIT_REACHED")&&sql.includes("count(distinct d.client_device_id)"),"Device quota hard-enforced server-side");
ok(sql.includes("STORE_LIMIT_REACHED")&&sql.includes("ldm_create_branch_store_v2"),"Store quota hard-enforced server-side");
ok(sql.includes("drop function if exists public.ldm_my_network_stores_v2();"),"FIX-1 PostgreSQL 42P13 terpasang");
ok(!sql.toLowerCase().includes("drop function if exists public.ldm_my_network_stores_v2() cascade"),"FIX-1 tidak memakai CASCADE");
ok(d.includes("LDMDevices.quota")&&ds.includes("ldm_my_license_quota")&&ds.includes("quota,startRealtime"),"Device Management menampilkan kuota server melalui device-service");
ok(ms.includes("ldm_my_license_quota")||mjs.includes("ldm_my_license_quota"),"Multi-Store membaca kuota server");
ok(la.includes("v_device_already_active")&&la.includes("v_pair_active"),"License Authority hardening reaktivasi/device sama tersedia");
ok(del.includes("syncApplicationEntitlement")&&del.includes("license_max_devices")&&del.includes("license_max_stores"),"Entitlement License Authority disinkron ke App Supabase");
ok(sw.includes('27.9.0-v28.3.9')&&sw.includes('privacy-quota-v28-3-9'),"Service Worker/PWA cache V28.3.9");
ok(cfg.includes('appVersion:"27.9.0-v28.3.9"'),"Frontend license config V28.3.9");
if(bad){console.error(`AUDIT GAGAL: ${bad} pemeriksaan.`);process.exit(1)} console.log("AUDIT LULUS: Privacy + Device/Store quota V28.3.9 konsisten pada source.");

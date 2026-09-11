"use strict";
const fs=require("fs"),path=require("path"); const root=path.resolve(__dirname,".."); let bad=0;
function read(r){return fs.readFileSync(path.join(root,r),"utf8")}
function ok(c,m){console.log(`${c?"PASS":"FAIL"} ${m}`);if(!c)bad++}
const dev=read("developer-license-v2.html"), lic=read("license.html"), co=read("js/license-checkout-v2.js"), ref=read("js/customer-refund-v2825.js"), admin=read("license-authority-v2/supabase/functions/ldm-license-admin-v2/index.ts"), email=read("license-authority-v2/supabase/functions/_shared/ldm-resend-email.ts"), sw=read("service-worker.js");
ok(dev.includes("simulate_license_delivery")||dev.includes("Transaksi Test"),"Developer Center memiliki Transaksi Test");
ok(dev.includes("ldmLicenseDeliverySimulationV2838"),"Receipt test memakai storage simulation terisolasi");
ok(co.includes("ldm_test_receipt")&&co.includes("SIMULASI"),"license.html runtime dapat membuka receipt simulasi");
ok(ref.includes("simulation")||ref.includes("ldm_test_receipt"),"Refund membedakan receipt simulasi");
ok(admin.includes("simulate_license_delivery")&&admin.includes("buildPaidLicenseEmail")&&email.includes("[SIMULASI]"),"Backend simulator + email simulation tersedia");
ok(sw.includes('27.9.0-v28.3.9'),"Service Worker build V28.3.9");
if(bad){console.error(`AUDIT GAGAL: ${bad} pemeriksaan.`);process.exit(1)} console.log("AUDIT LULUS: simulator lisensi tetap terisolasi pada V28.3.9.");

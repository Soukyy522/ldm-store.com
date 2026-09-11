"use strict";
const fs=require("fs");
const path=require("path");
const ROOT=path.resolve(__dirname,"..");
const ORIGIN="https://locdaily.github.io";
let fail=0;
function read(rel){return fs.readFileSync(path.join(ROOT,rel),"utf8");}
function ok(cond,msg){if(cond)console.log("[OK] "+msg);else{console.error("[FAIL] "+msg);fail++;}}

const html=read("license.html");
ok(html.includes("Pembayaran Berhasil · Serah Terima Data Lisensi"),"Judul serah-terima tampil di license.html");
for(const id of ["receiptPaymentState","receiptPaidAt","receiptLicenseKey","receiptStoreCode","receiptStoreId","receiptNetworkId","receiptOwnerEmail","receiptExpires","receiptProvisionNote","receiptDeliveryNote"]){ok(html.includes(`id="${id}"`),`Receipt memiliki ${id}`);}
ok(html.includes("Data Lisensi Saya"),"Fallback Data Lisensi Saya tersedia");

const checkout=read("js/license-checkout-v2.js");
ok(checkout.includes("recoverPaidReceipt"),"Recovery receipt PAID tersedia");
ok(checkout.includes("for(let i=0;i<5;i++)"),"Retry receipt dibatasi 5 kali");
ok(checkout.includes("data.receipt_error"),"Receipt error ditampilkan ke customer");
ok(checkout.includes('checkoutPanel.hidden=false'),"Parent checkout dibuka ketika receipt dirender");
ok(checkout.includes('panel.hidden=false;panel.classList.add("open")'),"Order terakhir membuka panel saat restore");
ok(checkout.includes("receiptDeliveryNote"),"Status Resend ditampilkan pada receipt");
ok(checkout.includes("safePublicAppLink"),"Link Login/Panduan tetap di-hardening");
ok(!checkout.includes("localStorage.setItem(STORAGE_KEY,JSON.stringify({\n      license_key"),"License Key tidak disimpan plaintext di checkout localStorage");

const cfg=read("js/license-v2-config.js");
ok(cfg.includes(`publicAppUrl:"${ORIGIN}"`),"Origin frontend lisensi benar");
const sw=read("service-worker.js");
ok(sw.includes("27.9.0-v28.3.7"),"Service Worker build V28.3.7");
ok(sw.includes("license-receipt-recovery-v28-3-7"),"Shell cache V28.3.7");
const pwa=read("js/pwa-manager.js");
ok(pwa.includes("27.9.0-v28.3.7"),"PWA manager build V28.3.7");

if(fail){console.error(`\nAUDIT GAGAL: ${fail} pemeriksaan.`);process.exit(1);}
console.log("\nAUDIT LULUS: receipt lisensi V28.3.7 siap diuji end-to-end.");

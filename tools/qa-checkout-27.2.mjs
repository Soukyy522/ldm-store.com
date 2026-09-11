import fs from "node:fs";
import vm from "node:vm";

const required=[
  "license.html","js/license-checkout-config.js","js/license-checkout.js",
  "license-authority-v2/supabase/functions/ldm-license-checkout/index.ts",
  "license-authority-v2/supabase/functions/ldm-midtrans-webhook/index.ts",
  "license-authority-v2/supabase/functions/_shared/ldm-license-delivery.ts",
  "license-authority-v2/supabase/migrations/20260902020000_ldm_public_checkout_delivery.sql",
  "PANDUAN-CHECKOUT-MIDTRANS-EMAIL-WHATSAPP-27.2.txt"
];
const fail=[];
for(const file of required) if(!fs.existsSync(file)) fail.push(`File tidak ada: ${file}`);

const html=fs.readFileSync("license.html","utf8");
for(const marker of ["checkoutModal","checkoutName","checkoutPhone","checkoutEmail","checkoutStoreCode","checkoutCycle","checkoutPay","checkoutResult","LDMLicenseCheckout.createCheckout"]){
  if(!html.includes(marker)) fail.push(`license.html tidak memiliki ${marker}`);
}
const inline=[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).join("\n");
try{new vm.Script(inline)}catch(error){fail.push(`JavaScript inline invalid: ${error.message}`)}

for(const file of ["js/license-checkout-config.js","js/license-checkout.js"]){
  try{new vm.Script(fs.readFileSync(file,"utf8"),{filename:file})}catch(error){fail.push(`${file}: ${error.message}`)}
}
const frontend=html+fs.readFileSync("js/license-checkout-config.js","utf8")+fs.readFileSync("js/license-checkout.js","utf8");
for(const secret of ["MIDTRANS_SERVER_KEY","SUPABASE_SERVICE_ROLE_KEY","RESEND_API_KEY","WHATSAPP_ACCESS_TOKEN","LDM2_DELIVERY_ENCRYPTION_KEY"]){
  if(frontend.includes(secret)) fail.push(`Nama secret server muncul di frontend: ${secret}`);
}

const sql=fs.readFileSync("license-authority-v2/supabase/migrations/20260902020000_ldm_public_checkout_delivery.sql","utf8");
for(const marker of ["ldm2_create_public_checkout_order","ldm2_public_checkout_status","ldm2_claim_delivery","ldm2_finish_delivery","checkout_token_hash","license_key_ciphertext"]){
  if(!sql.includes(marker)) fail.push(`Migration tidak memiliki ${marker}`);
}
if((sql.match(/\$\$/g)||[]).length%2) fail.push("Pasangan $$ pada migration tidak seimbang");
if(!/revoke all on function[\s\S]+from public,anon,authenticated/i.test(sql)) fail.push("RPC checkout belum direvoke dari role publik");

const checkout=fs.readFileSync("license-authority-v2/supabase/functions/ldm-license-checkout/index.ts","utf8");
const webhook=fs.readFileSync("license-authority-v2/supabase/functions/ldm-midtrans-webhook/index.ts","utf8");
for(const marker of ["MIDTRANS_SERVER_KEY","ldm2_create_public_checkout_order","encryptLicenseKey","checkout_token"]){if(!checkout.includes(marker))fail.push(`Checkout Edge tidak memiliki ${marker}`)}
for(const marker of ["constantEqual","getMidtransStatus","ldm2_apply_midtrans_notification","deliverOrder","EdgeRuntime.waitUntil"]){if(!webhook.includes(marker))fail.push(`Webhook tidak memiliki ${marker}`)}

if(fail.length){console.error(fail.map(x=>`FAIL: ${x}`).join("\n"));process.exit(1)}
console.log(`QA checkout 27.2: LULUS (${required.length} file, keamanan frontend, alur webhook, SQL marker, dan JavaScript)`);

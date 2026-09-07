import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, encryptLicenseKey, normalizeWhatsApp, preflightApplicationProvisioning, sha256Hex } from "../_shared/ldm-license-delivery.ts";

function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function randomHex(bytes=8) { return [...crypto.getRandomValues(new Uint8Array(bytes))].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase(); }
function orderId() { const d=new Date().toISOString().replace(/\D/g,"").slice(0,12); return `LDMLY${d}${randomHex(4)}`; }
function statusToken() { return randomHex(24)+randomHex(24); }
function licenseKey(plan:string) { const short=plan.replace("WARUNG_","W"); return `LDM2-${short}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}`; }
function allowedOrigin(req: Request) {
  const origin=req.headers.get("origin")||"";
  const allowed=env("LDM2_CHECKOUT_ALLOWED_ORIGINS").split(",").map(v=>v.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : "";
}
function cors(req: Request) { return {"Access-Control-Allow-Origin":allowedOrigin(req)||"null","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}; }
function json(req:Request,data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function safePlanCycle(plan:string,cycle:string){return ["WARUNG_KECIL","WARUNG_SEDERHANA","TOKO"].includes(plan) && ["monthly","yearly","two_year"].includes(cycle);}
function safeLynkUrl(raw:string){try{const u=new URL(raw);const h=u.hostname.toLowerCase();return u.protocol==="https:"&&(h==="lynk.id"||h==="www.lynk.id")?u.href:""}catch{return ""}}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return json(req,{ok:false,message:"Gunakan POST."},405);
  if(!allowedOrigin(req))return json(req,{ok:false,message:"Domain checkout belum diizinkan."},403);
  try{
    const url=env("SUPABASE_URL"),service=env("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!service)return json(req,{ok:false,message:"Secret server belum lengkap."},500);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>({}));
    const planCode=clean(body.plan_code,40).toUpperCase();
    const billingCycle=clean(body.billing_cycle,20).toLowerCase();
    const customerName=clean(body.customer_name,120);
    const customerEmail=clean(body.customer_email,180).toLowerCase();
    const customerPhone=normalizeWhatsApp(clean(body.customer_phone,40));
    const storeName=clean(body.store_name,120);
    const storeCode=clean(body.store_code,30).toUpperCase();
    const checkoutUrl=safeLynkUrl(clean(body.checkout_url,600));
    if(!customerName||!customerEmail||!storeName||!storeCode||!checkoutUrl)return json(req,{ok:false,message:"Data checkout Lynk.id belum lengkap."},400);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))return json(req,{ok:false,message:"Email Owner tidak valid."},400);
    if(!safePlanCycle(planCode,billingCycle))return json(req,{ok:false,message:"Paket/periode tidak valid."},400);
    if(!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(storeCode))return json(req,{ok:false,message:"Store Code harus 3-30 karakter: huruf kapital, angka, atau tanda strip."},400);

    await preflightApplicationProvisioning({customerEmail,storeCode});
    const {data:amount,error:priceError}=await admin.rpc("ldm2_expected_price",{p_plan_code:planCode,p_billing_cycle:billingCycle});
    if(priceError)throw priceError;

    const rawKey=licenseKey(planCode),newOrderId=orderId(),publicToken=statusToken();
    const {data:order,error:orderError}=await admin.rpc("ldm2_create_purchase_order",{
      p_order_id:newOrderId,p_key_hash_hex:await sha256Hex(rawKey),p_key_prefix:rawKey.slice(0,18),
      p_customer_name:customerName,p_customer_email:customerEmail,p_customer_phone:customerPhone,
      p_plan_code:planCode,p_billing_cycle:billingCycle,p_store_code:storeCode,p_store_name:storeName,
      p_amount:Number(amount),p_notes:"PUBLIC_CHECKOUT_V27_LYNK_ONLY_3_PLAN"
    });
    if(orderError)throw orderError;
    const providerSet=await admin.rpc("ldm2_set_payment_provider",{p_order_id:newOrderId,p_provider:"lynk"});
    if(providerSet.error)throw providerSet.error;
    const lynkSet=await admin.rpc("ldm2_set_lynk_order",{p_order_id:newOrderId,p_checkout_url:checkoutUrl,p_provider_detail:{source:"license_html_v27_lynk_only"}});
    if(lynkSet.error)throw lynkSet.error;
    const {error:deliveryError}=await admin.from("ldm2_checkout_deliveries").insert({
      payment_id:order.payment_id,license_id:order.license_id,order_id:newOrderId,
      public_status_token_hash:await sha256Hex(publicToken),license_key_ciphertext:await encryptLicenseKey(rawKey),
      email_status:"not_configured",whatsapp_status:"not_configured",provision_status:"pending"
    });
    if(deliveryError)throw deliveryError;
    return json(req,{ok:true,order_id:newOrderId,payment_id:order.payment_id,status_token:publicToken,payment_gateway:"lynk",amount:Number(amount),redirect_url:checkoutUrl,auto_delivery:true});
  }catch(error){
    console.error("LDM_LYNK_ORDER",error);
    return json(req,{ok:false,message:clean((error as Error)?.message||"Order Lynk.id gagal dibuat.",500)},500);
  }
});

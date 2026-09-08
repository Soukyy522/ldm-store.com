import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, sha256Hex, getPaidWebReceipt, releaseApplicationOwnerReservation } from "../_shared/ldm-license-delivery.ts";

function env(name:string){return String(Deno.env.get(name)||"").trim()}
function randomHex(bytes=5){return [...crypto.getRandomValues(new Uint8Array(bytes))].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()}
function allowedOrigin(req:Request){const origin=req.headers.get("origin")||"";const allowed=env("LDM2_CHECKOUT_ALLOWED_ORIGINS").split(",").map(v=>v.trim()).filter(Boolean);return origin&&allowed.includes(origin)?origin:""}
function cors(req:Request){return {"Access-Control-Allow-Origin":allowedOrigin(req)||"null","Access-Control-Allow-Headers":"content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}}
function json(req:Request,data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
async function verifiedPayment(admin:any,order:string,token:string){
  if(!order||!token)throw Object.assign(new Error("Order/token status wajib diisi."),{status:400});
  const {data:payment,error}=await admin.from("ldm2_payments").select("id,license_id,order_id,provider,status,provider_status,provider_transaction_id,billing_cycle,amount,refund_amount,paid_at,processed_at,provider_detail,redirect_url,created_at").eq("order_id",order).maybeSingle();
  if(error)throw error;if(!payment)throw Object.assign(new Error("Order tidak ditemukan."),{status:404});
  if(String(payment.provider||"").toLowerCase()!=="lynk")throw Object.assign(new Error("Order ini bukan pembayaran Lynk.id aktif."),{status:409});
  const {data:delivery,error:dErr}=await admin.from("ldm2_checkout_deliveries").select("public_status_token_hash,provision_status,completed_at").eq("payment_id",payment.id).maybeSingle();
  if(dErr)throw dErr;if(!delivery)throw Object.assign(new Error("Status checkout tidak tersedia."),{status:404});
  if(await sha256Hex(token)!==delivery.public_status_token_hash)throw Object.assign(new Error("Token status tidak valid."),{status:403});
  return {payment,delivery};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return json(req,{ok:false,message:"Gunakan POST."},405);
  if(!allowedOrigin(req))return json(req,{ok:false,message:"Domain checkout belum diizinkan."},403);
  try{
    const url=env("SUPABASE_URL"),service=env("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service)return json(req,{ok:false,message:"Secret server checkout belum lengkap."},500);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});const body=await req.json().catch(()=>({}));const action=clean(body.action,40).toLowerCase();

    if(action==="gateway_config")return json(req,{ok:true,default_gateway:"lynk",gateways:[{id:"lynk",label:"Lynk.id",enabled:true,mode:"hosted_checkout"}]});

    if(action==="refund_policy"){
      const result=await admin.rpc("ldm2_get_refund_policy");
      if(result.error&&/ldm2_get_refund_policy|does not exist|schema cache/i.test(result.error.message||""))return json(req,{ok:true,policy:{enabled:true,refund_window_days:3,allow_partial_refund:true,min_reason_length:10,policy_version:"fallback-v1"},migration_required:true});
      if(result.error)throw result.error;return json(req,{ok:true,policy:result.data,migration_required:false});
    }

    if(action==="status"){
      const order=clean(body.order_id,120),token=clean(body.status_token,200);const {payment,delivery}=await verifiedPayment(admin,order,token);
      let receipt=null,receiptError=null;
      if(payment.status==="paid"){try{receipt=await getPaidWebReceipt(admin,order)}catch(e){receiptError=clean((e as Error)?.message||"Data lisensi belum dapat ditampilkan.",500)}}
      else if(["cancelled","expired","failed"].includes(String(payment.status||"").toLowerCase())){try{await releaseApplicationOwnerReservation(admin,order)}catch(_e){}}
      const {data:license}=await admin.from("ldm2_licenses").select("status,plan_code,primary_store_code,primary_store_id,network_id,expires_at").eq("id",payment.license_id).maybeSingle();
      return json(req,{ok:true,order_id:order,payment_status:payment.status,payment_gateway:"lynk",provider_status:payment.provider_status,redirect_url:payment.redirect_url||null,paid_at:payment.paid_at,license_status:license?.status||null,provision_status:receipt?.provision_status||delivery.provision_status,receipt,receipt_error:receiptError,can_cancel:["pending","challenge"].includes(String(payment.status||"").toLowerCase()),can_refund:["paid","partially_refunded"].includes(String(payment.status||"").toLowerCase())});
    }

    if(action==="cancel_order"){
      const order=clean(body.order_id,120),token=clean(body.status_token,200);
      const {payment}=await verifiedPayment(admin,order,token);
      if(["paid","partially_refunded","refunded"].includes(String(payment.status||"").toLowerCase())){
        return json(req,{ok:false,code:"PAYMENT_ALREADY_PAID",message:"Pembayaran sudah terverifikasi sehingga order tidak dapat dibatalkan. Gunakan proses refund.",refund_available:true},409);
      }
      const cancelled=await admin.rpc("ldm2_cancel_public_order",{p_order_id:order});
      if(cancelled.error){
        if(/ldm2_cancel_public_order|does not exist|schema cache/i.test(cancelled.error.message||""))return json(req,{ok:false,code:"CANCEL_SQL_MISSING",message:"SQL Cancel Order V28 belum dijalankan pada License Authority."},503);
        throw cancelled.error;
      }
      try{await releaseApplicationOwnerReservation(admin,order)}catch(_e){}
      return json(req,{ok:true,message:"Order LocDailyMar berhasil dibatalkan. Tutup checkout Lynk.id dan jangan lakukan pembayaran pada order tersebut.",order_id:order,payment_status:"cancelled",result:cancelled.data});
    }

    if(["refund_context","refund_request_create","refund_request_cancel"].includes(action)){
      const order=clean(body.order_id,120),token=clean(body.status_token,200);const {payment}=await verifiedPayment(admin,order,token);
      const eligibilityResult=await admin.rpc("ldm2_refund_eligibility",{p_payment_id:payment.id});
      if(eligibilityResult.error){if(/ldm2_refund_eligibility|does not exist|schema cache/i.test(eligibilityResult.error.message||""))return json(req,{ok:false,code:"REFUND_SQL_MISSING",message:"SQL Refund Management belum dijalankan."},503);throw eligibilityResult.error}
      const eligibility=eligibilityResult.data||{};
      const {data:license,error:lErr}=await admin.from("ldm2_licenses").select("id,customer_name,customer_email,customer_phone,plan_code,primary_store_code,primary_store_name,status").eq("id",payment.license_id).maybeSingle();if(lErr)throw lErr;
      const rq=await admin.from("ldm2_refund_requests").select("id,request_code,payment_id,license_id,order_id,refund_type,requested_amount,reason_category,reason_detail,status,response_note,linked_refund_key,refund_deadline,created_at,updated_at,completed_at,cancelled_at").eq("payment_id",payment.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(rq.error&&/ldm2_refund_requests|does not exist|schema cache/i.test(rq.error.message||""))return json(req,{ok:false,code:"REFUND_REQUEST_SQL_MISSING",message:"SQL Customer Refund Requests belum dijalankan."},503);if(rq.error)throw rq.error;const existing=rq.data||null;
      if(action==="refund_context")return json(req,{ok:true,payment:{id:payment.id,order_id:payment.order_id,status:payment.status,provider_status:payment.provider_status,amount:payment.amount,refund_amount:payment.refund_amount||0,paid_at:payment.paid_at,created_at:payment.created_at,payment_method:"Lynk.id"},license:license?{customer_name:license.customer_name,plan_code:license.plan_code,store_code:license.primary_store_code,store_name:license.primary_store_name,license_status:license.status}:null,eligibility,request:existing});
      if(action==="refund_request_create"){
        if(eligibility.eligible!==true)return json(req,{ok:false,code:"REFUND_NOT_ELIGIBLE",message:eligibility.reason||"Pembayaran tidak memenuhi kebijakan refund.",eligibility},409);
        if(existing&&["submitted","reviewing","waiting_customer","approved","processing"].includes(String(existing.status||"")))return json(req,{ok:false,code:"REFUND_REQUEST_ACTIVE",message:`Permintaan ${existing.request_code} masih aktif.`,request:existing},409);
        const refundType=clean(body.refund_type,20).toLowerCase(),requestedAmount=Math.round(Number(body.amount||0)),category=clean(body.reason_category,40).toLowerCase(),detail=clean(body.reason_detail,1500),requestCode=`RFD-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomHex(5)}`;
        const created=await admin.rpc("ldm2_create_customer_refund_request",{p_payment_id:payment.id,p_request_code:requestCode,p_refund_type:refundType,p_requested_amount:requestedAmount,p_reason_category:category,p_reason_detail:detail});if(created.error)throw created.error;return json(req,{ok:true,message:"Permintaan refund berhasil dikirim ke Developer Support.",request:created.data});
      }
      const requestCode=clean(body.request_code,40).toUpperCase();if(!/^RFD-\d{8}-[A-F0-9]{10}$/.test(requestCode))return json(req,{ok:false,message:"Kode permintaan refund tidak valid."},400);
      const cancelled=await admin.rpc("ldm2_cancel_customer_refund_request",{p_payment_id:payment.id,p_request_code:requestCode});if(cancelled.error)throw cancelled.error;return json(req,{ok:true,message:"Permintaan refund dibatalkan.",request:cancelled.data});
    }

    return json(req,{ok:false,code:"ACTION_NOT_SUPPORTED",message:"Aksi checkout tidak tersedia pada mode Lynk.id-only."},400);
  }catch(error){console.error("LDM_PUBLIC_CHECKOUT_LYNK_ONLY",error);return json(req,{ok:false,code:clean((error as any)?.code||"CHECKOUT_FAILED",80),message:clean((error as Error)?.message||"Checkout gagal.",500)},Number((error as any)?.status||500))}
});

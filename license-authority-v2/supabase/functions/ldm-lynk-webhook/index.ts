import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, env, preparePaidOrder } from "../_shared/ldm-license-delivery.ts";
import { eventKey, extractLynkPayload, finishEvent, headersToJson, lynkRuntimeHealth, matchPendingOrder, registerEvent, verifyWebhookToken } from "../_shared/ldm-lynk-operations.ts";

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}

Deno.serve(async(req)=>{
  if(req.method==="GET")return json({ok:true,service:"LDM_LYNK_WEBHOOK",runtime:lynkRuntimeHealth(),delivery:{mode:"license_page_only",email_provider:null}});
  if(req.method!=="POST")return json({ok:false,message:"Gunakan POST."},405);
  let admin:any=null,event="";
  try{
    const supabaseUrl=env("SUPABASE_URL"),serviceRole=env("SUPABASE_SERVICE_ROLE_KEY");
    if(!supabaseUrl||!serviceRole)return json({ok:false,message:"Supabase server secret belum lengkap."},500);
    admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
    const raw=await req.text();
    let body:any={};try{body=JSON.parse(raw||"{}")}catch{return json({ok:false,message:"Payload webhook bukan JSON valid."},400)}
    const parsed=extractLynkPayload(body);
    const tokenValid=verifyWebhookToken(req);
    const autoProcess=env("LYNK_AUTO_PROCESS").toLowerCase()==="true";
    event=await eventKey(raw,parsed.transactionId);
    const registered=await registerEvent(admin,{eventKey:event,parsed,tokenValid,autoProcess,headers:headersToJson(req.headers),body});

    if(!tokenValid){
      await finishEvent(admin,{eventKey:event,success:false,matchStatus:"TOKEN_INVALID",error:"Token URL webhook tidak valid."});
      return json({ok:false,message:"Webhook token tidak valid."},401);
    }

    if(!autoProcess){
      await finishEvent(admin,{eventKey:event,success:false,matchStatus:"CAPTURE_ONLY",error:"Payload tersimpan. AUTO_PROCESS masih false sampai mapping webhook diverifikasi."});
      return json({ok:true,captured:true,auto_process:false,event_key:event,parsed});
    }

    if(!parsed.statusIsSuccess){
      await finishEvent(admin,{eventKey:event,success:false,matchStatus:"NOT_SUCCESS_STATUS",error:`Status webhook belum termasuk status sukses: ${parsed.status||"(kosong)"}`});
      return json({ok:true,ignored:true,reason:"NOT_SUCCESS_STATUS",status:parsed.status||null});
    }

    const match=await matchPendingOrder(admin,parsed);
    if(!match.ok||!match.order){
      await finishEvent(admin,{eventKey:event,success:false,matchStatus:match.status,error:`Webhook tidak memiliki satu pending order yang unik. Kandidat: ${match.candidates?.length||0}.`});
      return json({ok:true,captured:true,processed:false,match_status:match.status,candidates:match.candidates?.length||0},202);
    }

    const {data:applied,error:applyError}=await admin.rpc("ldm2_apply_lynk_payment",{
      p_order_id:match.order.order_id,p_transaction_id:parsed.transactionId||null,p_event_status:parsed.status,
      p_gross_amount:parsed.amount,p_provider_detail:{synced_by:"lynk_webhook",product_ref:parsed.product||null,event_key:event}
    });
    if(applyError)throw applyError;
    if(applied?.ok===false){
      const code=String(applied?.code||"UNKNOWN");
      const afterCancel=code==="ORDER_CANCELLED_PAYMENT_REVIEW";
      await finishEvent(admin,{
        eventKey:event,orderId:match.order.order_id,success:false,
        matchStatus:afterCancel?"PAYMENT_AFTER_CANCEL_REVIEW":"APPLY_REJECTED",
        error:afterCancel?"Pembayaran terdeteksi setelah customer membatalkan order. Jangan aktifkan lisensi; lakukan review/refund manual.":`Payment apply ditolak: ${code}`
      });
      return json({ok:true,captured:true,processed:false,review_required:afterCancel,apply:applied},202);
    }

    let provision:any=null;
    try{provision=await preparePaidOrder(admin,match.order.order_id,false)}
    catch(provisionError){
      provision={eligible:true,completed:false,provision_status:"failed",provision_error:clean((provisionError as Error)?.message||provisionError,1000)};
    }
    await finishEvent(admin,{
      eventKey:event,orderId:match.order.order_id,matchStatus:match.status,success:true
    });
    return json({
      ok:true,processed:true,order_id:match.order.order_id,apply:applied,
      delivery:{mode:"license_page_only",email_sent:false},
      provision:{status:provision?.provision_status||null,completed:!!provision?.completed,error:provision?.provision_error||null}
    });
  }catch(error){
    console.error("LDM_LYNK_WEBHOOK",error);
    if(admin&&event){try{await finishEvent(admin,{eventKey:event,success:false,matchStatus:"ERROR",error:clean((error as Error)?.message||error,1500)})}catch(_){}}
    return json({ok:false,message:clean((error as Error)?.message||"Webhook Lynk.id gagal.",500)},500);
  }
});

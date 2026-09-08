import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, env, paidEmailRuntimeHealth, preparePaidOrder } from "../_shared/ldm-license-delivery.ts";
import { eventKey, extractLynkPayload, finishEvent, headersToJson, lynkRuntimeHealth, matchPendingOrder, registerEvent, verifyWebhookToken } from "../_shared/ldm-lynk-operations.ts";

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}

async function processEvent(admin:any,req:Request,input:{body:any;raw:string;eventKeyOverride?:string|null;replay?:boolean;matchAnchorTime?:string|null}){
  const parsed=extractLynkPayload(input.body);
  const tokenValid=verifyWebhookToken(req);
  const autoProcess=env("LYNK_AUTO_PROCESS").toLowerCase()==="true";
  const event=input.eventKeyOverride||await eventKey(input.raw,parsed.transactionId);

  await registerEvent(admin,{eventKey:event,parsed,tokenValid,autoProcess,headers:headersToJson(req.headers),body:input.body});

  if(!tokenValid){
    await finishEvent(admin,{eventKey:event,success:false,matchStatus:"TOKEN_INVALID",error:"Token URL webhook tidak valid."});
    return json({ok:false,message:"Webhook token tidak valid."},401);
  }

  if(!autoProcess){
    await finishEvent(admin,{eventKey:event,success:false,matchStatus:"CAPTURE_ONLY",error:"Payload tersimpan. LYNK_AUTO_PROCESS masih false."});
    return json({ok:true,captured:true,auto_process:false,event_key:event,parsed});
  }

  if(!parsed.statusIsSuccess){
    const statusList=(parsed.statusCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10);
    await finishEvent(admin,{eventKey:event,success:false,matchStatus:"NOT_SUCCESS_STATUS",error:`Status webhook belum dikenali sebagai sukses: ${parsed.status||"(kosong)"}`});
    return json({ok:true,ignored:true,reason:"NOT_SUCCESS_STATUS",status:parsed.status||null,status_candidates:statusList},202);
  }

  const match=await matchPendingOrder(admin,parsed,{anchorTime:input.matchAnchorTime||null});
  if(!match.ok||!match.order){
    const duplicate=match.status==="DUPLICATE_PAYMENT_REVIEW"&&match.order;
    await finishEvent(admin,{
      eventKey:event,
      orderId:duplicate?match.order.order_id:null,
      success:false,
      matchStatus:match.status,
      error:duplicate
        ?"Pembayaran tambahan terdeteksi untuk order yang sudah PAID. Jangan aktifkan lisensi kedua; lakukan review/refund duplikat."
        :`Webhook tidak memiliki satu pending order yang unik. Kandidat: ${match.candidates?.length||0}.`
    });
    return json({
      ok:true,captured:true,processed:false,review_required:!!duplicate,
      match_status:match.status,candidates:match.candidates?.length||0,
      diagnostics:{
        anchor_time:match.anchorTime||input.matchAnchorTime||null,
        emails:(parsed.emailCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10),
        amounts:(parsed.amountCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10),
        statuses:(parsed.statusCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10),
        transaction_ids:(parsed.transactionIdCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10),
        products:(parsed.productCandidates||[]).map((x:any)=>({path:x.path,value:x.value})).slice(0,10)
      }
    },202);
  }

  const order=match.order;
  const matchedAmount=Math.round(Number(order.amount));
  const tx=parsed.transactionId||null;
  const eventStatus=parsed.status||"success_webhook";

  const {data:applied,error:applyError}=await admin.rpc("ldm2_apply_lynk_payment",{
    p_order_id:order.order_id,p_transaction_id:tx,p_event_status:eventStatus,
    p_gross_amount:matchedAmount,
    p_provider_detail:{
      synced_by:input.replay?"lynk_webhook_replay":"lynk_webhook",
      product_ref:parsed.product||null,event_key:event,match_status:match.status,
      detected_emails:(parsed.emailCandidates||[]).map((x:any)=>x.value).slice(0,10),
      detected_amounts:(parsed.amountCandidates||[]).map((x:any)=>x.value).slice(0,10)
    }
  });
  if(applyError)throw applyError;
  if(applied?.ok===false){
    const code=String(applied?.code||"UNKNOWN");
    const afterCancel=code==="ORDER_CANCELLED_PAYMENT_REVIEW";
    await finishEvent(admin,{
      eventKey:event,orderId:order.order_id,success:false,
      matchStatus:afterCancel?"PAYMENT_AFTER_CANCEL_REVIEW":"APPLY_REJECTED",
      error:afterCancel?"Pembayaran terdeteksi setelah customer membatalkan order. Jangan aktifkan lisensi; lakukan review/refund manual.":`Payment apply ditolak: ${code}`
    });
    return json({ok:true,captured:true,processed:false,review_required:afterCancel,apply:applied},202);
  }

  let provision:any=null;
  try{provision=await preparePaidOrder(admin,order.order_id,false)}
  catch(provisionError){provision={eligible:true,completed:false,provision_status:"failed",provision_error:clean((provisionError as Error)?.message||provisionError,1000)};}

  await finishEvent(admin,{eventKey:event,orderId:order.order_id,matchStatus:match.status,success:true});
  return json({
    ok:true,processed:true,replay:!!input.replay,order_id:order.order_id,apply:applied,
    match_status:match.status,
    delivery:{mode:"license_page+resend",email_status:provision?.email_status||null,email_sent:!!provision?.email_sent,email_message_id:provision?.email_message_id||null,email_error:provision?.email_error||null,email_mode:provision?.email_mode||null},
    provision:{status:provision?.provision_status||null,completed:!!provision?.completed,error:provision?.provision_error||null}
  });
}

Deno.serve(async(req)=>{
  if(req.method==="GET")return json({ok:true,service:"LDM_LYNK_WEBHOOK",runtime:lynkRuntimeHealth(),delivery:{mode:"license_page+resend",email_provider:"resend",resend:paidEmailRuntimeHealth()}});
  if(req.method!=="POST")return json({ok:false,message:"Gunakan POST."},405);

  let admin:any=null;
  try{
    const supabaseUrl=env("SUPABASE_URL"),serviceRole=env("SUPABASE_SERVICE_ROLE_KEY");
    if(!supabaseUrl||!serviceRole)return json({ok:false,message:"Supabase server secret belum lengkap."},500);
    admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

    const url=new URL(req.url);
    const replayMode=url.searchParams.get("mode")==="replay";

    if(replayMode){
      if(!verifyWebhookToken(req))return json({ok:false,message:"Webhook token tidak valid."},401);
      const rawRequest=await req.text();
      let requestBody:any={};
      try{requestBody=JSON.parse(rawRequest||"{}")}catch{return json({ok:false,message:"Body replay bukan JSON valid."},400)}
      const requestedEvent=clean(requestBody?.event_key,160);
      if(!requestedEvent)return json({ok:false,message:"event_key wajib diisi untuk replay."},400);
      const {data:stored,error}=await admin.from("ldm2_lynk_events").select("event_key,payload,processed_at,auto_match_status,first_received_at,last_received_at").eq("event_key",requestedEvent).maybeSingle();
      if(error)throw error;
      if(!stored)return json({ok:false,message:"Event webhook tidak ditemukan."},404);
      if(stored.processed_at)return json({ok:true,replayed:false,reason:"ALREADY_PROCESSED",event_key:requestedEvent});
      const storedBody=stored.payload||{};
      return await processEvent(admin,req,{body:storedBody,raw:JSON.stringify(storedBody),eventKeyOverride:requestedEvent,replay:true,matchAnchorTime:stored.first_received_at||stored.last_received_at||null});
    }

    const raw=await req.text();
    let body:any={};
    try{body=JSON.parse(raw||"{}")}catch{return json({ok:false,message:"Payload webhook bukan JSON valid."},400)}
    return await processEvent(admin,req,{body,raw,replay:false});
  }catch(error){
    console.error("LDM_LYNK_WEBHOOK",error);
    return json({ok:false,message:clean((error as Error)?.message||"Webhook Lynk.id gagal.",500)},500);
  }
});

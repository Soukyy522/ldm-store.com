import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, env, preparePaidOrder } from "../_shared/ldm-license-delivery.ts";
import { resendRuntimeHealth, sendResendEmail } from "../_shared/ldm-resend-email.ts";

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}

function safeEqual(a:string,b:string){
  const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);
  if(aa.length!==bb.length)return false;
  let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
function authorized(req:Request){
  const expected=env("LDM_RESEND_TEST_TOKEN");
  const got=new URL(req.url).searchParams.get("token")||req.headers.get("x-ldm-resend-test-token")||"";
  return expected.length>=32&&safeEqual(expected,got);
}

Deno.serve(async(req)=>{
  if(req.method==="GET")return json({ok:true,service:"LDM_RESEND_TEST",resend:resendRuntimeHealth()});
  if(req.method!=="POST")return json({ok:false,message:"Gunakan POST."},405);
  if(!authorized(req))return json({ok:false,message:"Test token tidak valid."},401);

  try{
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action||"test",40).toLowerCase();

    if(action==="test"){
      const to=env("LDM_RESEND_TEST_TO");
      if(!to)return json({ok:false,message:"LDM_RESEND_TEST_TO belum dikonfigurasi."},400);

      // V28.1.9.3
      // Test manual HARUS mempunyai idempotency key unik per percobaan.
      // Versi lama memakai key per jam, sehingga test kedua dalam jam yang sama
      // tetapi body berubah (mis. mode test -> production) menghasilkan Resend 409.
      const requestedRunId=clean(body?.test_run_id,120);
      const testRunId=requestedRunId || crypto.randomUUID();

      const health=resendRuntimeHealth();
      const result=await sendResendEmail({
        to,
        subject:"[TEST] LocDailyMar + Resend berhasil tersambung",
        html:`<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:24px"><h2 style="color:#0f9d58">LocDailyMar</h2><p>Jika email ini sampai, koneksi <strong>Supabase Edge Function → Resend</strong> berhasil.</p><p>Mode saat ini: <strong>${health.mode}</strong></p><p>Test Run ID: <code>${testRunId}</code></p><p>Pengujian ini tidak membuat transaksi, tidak mengaktifkan lisensi, dan tidak mengubah payment.</p></div>`,
        text:`LocDailyMar + Resend berhasil tersambung. Mode: ${health.mode}. Test Run ID: ${testRunId}. Test ini tidak membuat transaksi atau mengubah payment.`,
        idempotencyKey:`ldm-resend-connectivity-test/${testRunId}`,
      });
      return json({
        ok:result.ok,
        action:"test",
        test_run_id:testRunId,
        to,
        status:result.status,
        message_id:result.id||null,
        error:result.error||null,
        resend:resendRuntimeHealth()
      },result.ok?200:502);
    }

    if(action==="retry_order"){
      const orderId=clean(body?.order_id,160);
      if(!orderId)return json({ok:false,message:"order_id wajib diisi."},400);

      const requestedRetryRunId=clean(body?.retry_run_id,120);
      const retryRunId=requestedRetryRunId || crypto.randomUUID();

      const supabaseUrl=env("SUPABASE_URL"),serviceRole=env("SUPABASE_SERVICE_ROLE_KEY");
      if(!supabaseUrl||!serviceRole)return json({ok:false,message:"Supabase server secret belum lengkap."},500);

      const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

      // V28.1.9.4:
      // Manual retry harus FORCE. Versi lama memakai force=false sehingga
      // delivery yang sudah berstatus sent dapat di-skip dan tidak benar-benar
      // mengirim email baru.
      const result=await preparePaidOrder(admin,orderId,true,retryRunId);

      return json({
        ok:true,
        action:"retry_order",
        order_id:orderId,
        retry_run_id:retryRunId,
        result
      });
    }

    return json({ok:false,message:"Action tidak dikenal."},400);
  }catch(error){
    console.error("LDM_RESEND_TEST",error);
    return json({ok:false,message:clean((error as Error)?.message||error,1000)},500);
  }
});

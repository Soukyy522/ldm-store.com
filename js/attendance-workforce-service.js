(function(){
  "use strict";

  function client(){
    if(!window.LDMSupabase || typeof window.LDMSupabase.createClient!=="function"){
      throw new Error("Layanan Cloud belum siap.");
    }
    return window.LDMSupabase.createClient();
  }

  async function auth(){
    if(!window.LDMCloudSession || typeof window.LDMCloudSession.ensureAuthenticated!=="function"){
      throw new Error("Cloud Session belum tersedia.");
    }
    return window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
  }

  async function rpc(name,args={}){
    await auth();
    const {data,error}=await client().rpc(name,args);
    if(error)throw error;
    return data;
  }

  function one(data){
    return Array.isArray(data)?(data[0]||null):(data||null);
  }

  async function stores(){
    const data=await rpc("ldm_workforce_stores");
    return Array.isArray(data)?data:[];
  }

  async function accounts({storeId,year}={}){
    if(!storeId)throw new Error("Cabang wajib dipilih.");
    const data=await rpc("ldm_workforce_accounts",{
      p_store_id:storeId,
      p_year:Number(year)||new Date().getFullYear()
    });
    return Array.isArray(data)?data:[];
  }

  async function scheduleMonth({storeId,userId,month}={}){
    if(!storeId||!userId||!month)throw new Error("Cabang, akun, dan bulan wajib dipilih.");
    const data=await rpc("ldm_workforce_schedule_month",{
      p_store_id:storeId,
      p_user_id:userId,
      p_month:`${String(month).slice(0,7)}-01`
    });
    return Array.isArray(data)?data:[];
  }

  async function saveMonth({storeId,userId,month,rows}={}){
    if(!storeId||!userId||!month)throw new Error("Cabang, akun, dan bulan wajib dipilih.");
    return rpc("ldm_workforce_save_month_schedule",{
      p_store_id:storeId,
      p_user_id:userId,
      p_month:`${String(month).slice(0,7)}-01`,
      p_rows:Array.isArray(rows)?rows:[]
    });
  }

  async function setLeaveEntitlement({storeId,userId,year,days,note=""}={}){
    return rpc("ldm_workforce_set_leave_entitlement",{
      p_store_id:storeId,
      p_user_id:userId,
      p_year:Number(year),
      p_entitled_days:Number(days),
      p_note:String(note||"").trim()||null
    });
  }

  async function scheduleForUser({userId,date}={}){
    if(!userId||!date)throw new Error("User dan tanggal jadwal wajib tersedia.");
    return one(await rpc("ldm_workforce_schedule_for_user",{
      p_target_user_id:userId,
      p_date:date
    }))||{};
  }

  async function expectedStatus({storeId,date}={}){
    if(!storeId||!date)throw new Error("Cabang dan tanggal wajib tersedia.");
    const data=await rpc("ldm_workforce_expected_status",{
      p_store_id:storeId,
      p_date:date
    });
    return Array.isArray(data)?data:[];
  }

  async function explanationCandidates(days=62){
    const data=await rpc("ldm_attendance_explanation_candidates",{p_days:Number(days)||62});
    return Array.isArray(data)?data:[];
  }

  async function submitExplanation({date,reason,explanation}={}){
    return rpc("ldm_attendance_submit_explanation",{
      p_attendance_date:date,
      p_reason_category:reason,
      p_explanation:String(explanation||"").trim()
    });
  }

  async function myExplanations(){
    const data=await rpc("ldm_attendance_my_explanations");
    return Array.isArray(data)?data:[];
  }

  async function explanationInbox({storeId=null}={}){
    const data=await rpc("ldm_attendance_explanation_inbox",{p_store_id:storeId||null});
    return Array.isArray(data)?data:[];
  }

  async function reviewExplanation({id,note=""}={}){
    return rpc("ldm_attendance_review_explanation",{
      p_explanation_id:id,
      p_review_note:String(note||"").trim()||null
    });
  }

  async function context(){
    return auth();
  }

  window.LDMWorkforce=Object.freeze({
    context,stores,accounts,scheduleMonth,saveMonth,setLeaveEntitlement,
    scheduleForUser,expectedStatus,explanationCandidates,submitExplanation,
    myExplanations,explanationInbox,reviewExplanation
  });
})();

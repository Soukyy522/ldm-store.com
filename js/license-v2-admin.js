(function(){
  "use strict";
  const cfg=()=>window.LDM_LICENSE_V2_ADMIN_CONFIG||{};
  let client=null;
  function configured(){return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(cfg().supabaseUrl||""))&&!String(cfg().supabaseUrl).includes("GANTI-")&&!String(cfg().supabasePublishableKey||"").startsWith("GANTI_")}
  function supabase(){if(!configured())throw new Error("Konfigurasi Developer Center belum diisi.");if(!client)client=window.supabase.createClient(cfg().supabaseUrl,cfg().supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});return client}
  async function session(){const {data,error}=await supabase().auth.getSession();if(error)throw error;return data.session||null}
  async function login(email,password){const {data,error}=await supabase().auth.signInWithPassword({email,password});if(error)throw error;return data.session}
  async function logout(){await supabase().auth.signOut()}
  async function call(action,payload={}){const s=await session();if(!s)throw Object.assign(new Error("Silakan login sebagai developer."),{status:401});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(cfg().requestTimeoutMs)||10000);try{const res=await fetch(cfg().adminFunctionUrl,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${s.access_token}`,"apikey":cfg().supabasePublishableKey},body:JSON.stringify({action,...payload}),signal:controller.signal,cache:"no-store"});const data=await res.json().catch(()=>({ok:false,message:"Jawaban server tidak valid."}));if(!res.ok||data.ok===false)throw Object.assign(new Error(data.message||`HTTP ${res.status}`),{status:res.status,data});return data}catch(e){if(e.name==="AbortError")throw new Error("Server admin tidak merespons dalam 10 detik.");throw e}finally{clearTimeout(timer)}}
  window.LDMLicenseV2Admin={configured,supabase,session,login,logout,call};
})();

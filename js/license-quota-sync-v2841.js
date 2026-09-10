(function(){
  "use strict";

  function client(){
    if(window.ldmSupabase)return window.ldmSupabase;
    if(window.LDMSupabase?.createClient)return window.LDMSupabase.createClient();
    throw new Error("Layanan akun belum siap.");
  }

  function role(){
    try{
      const raw=String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
      if(raw)return raw;
    }catch(_){ }
    return "";
  }

  async function sessionToken(){
    try{
      const {data,error}=await client().auth.getSession();
      if(error)throw error;
      return String(data?.session?.access_token||"");
    }catch(_){
      return "";
    }
  }

  async function read(){
    const {data,error}=await client().rpc("ldm_my_license_quota");
    if(error)throw error;
    return data&&typeof data==="object"?data:null;
  }

  function ready(q){
    return Boolean(q&&q.quota_synced===true&&!q.quota_stale&&Number(q.max_devices||0)>0&&Number(q.max_stores||0)>0);
  }

  async function syncOwnerQuota(){
    if(!window.LDMLicenseV2?.call)return {ok:false,skipped:true};
    const token=await sessionToken();
    if(!token)return {ok:false,skipped:true};
    const context=window.LDMLicenseV2.activationContext?.()||{};
    const tokenKey=window.LDMLicenseV2?.keys?.TOKEN_KEY;
    const activationToken=tokenKey?String(localStorage.getItem(tokenKey)||""):"";
    try{
      return await window.LDMLicenseV2.call("owner_quota_sync",{
        license_id:String(context.license_id||""),
        activation_token:activationToken
      },{authorization:token,timeoutMs:15000});
    }catch(error){
      const code=String(error?.code||error?.data?.code||"");
      if(["PRIMARY_OWNER_REQUIRED","OWNER_FORBIDDEN","OWNER_AUTH_REQUIRED","OWNER_SESSION_INVALID"].includes(code)){
        return {ok:false,skipped:true,code};
      }
      return {ok:false,skipped:false,code,error};
    }
  }

  async function refresh(options={}){
    const allowSync=options.allowSync!==false;
    let quota=null;
    let readError=null;
    try{quota=await read()}catch(error){readError=error}
    if(ready(quota)||!allowSync)return {quota,error:readError,sync:null,ready:ready(quota)};

    let sync=null;
    const currentRole=role();
    if(currentRole==="owner"||!currentRole){
      sync=await syncOwnerQuota();
      if(sync?.ok===true||sync?.synced===true){
        await new Promise(resolve=>setTimeout(resolve,180));
        try{quota=await read();readError=null}catch(error){readError=error}
      }
    }
    return {quota,error:readError,sync,ready:ready(quota)};
  }

  window.LDMLicenseQuotaSync=Object.freeze({read,ready,refresh,syncOwnerQuota});
})();

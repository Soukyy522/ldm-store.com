(function(){
    "use strict";
    let channel=null;
    function client(){
        if(!window.LDMSupabase) throw new Error("Supabase client belum tersedia.");
        return window.LDMSupabase.createClient();
    }
    async function ownerContext(){
        const c=await window.LDMCloudSession.ensureAuthenticated({registerDevice:true});
        if(String(c.profile.role||"").toLowerCase()!=="owner") throw new Error("Manajemen perangkat hanya untuk Owner.");
        return c;
    }
    async function currentAccess(){
        await window.LDMCloudSession.ensureAuthenticated({registerDevice:true});
        return await window.LDMCloudAuth.getCurrentDeviceAccess();
    }
    async function listDevices(){await ownerContext();const {data,error}=await client().rpc("ldm_device_owner_list");if(error)throw error;return Array.isArray(data)?data:[]}
    async function listGroups(){await ownerContext();const {data,error}=await client().rpc("ldm_device_group_list");if(error)throw error;return Array.isArray(data)?data:[]}
    async function createGroup(name){await ownerContext();const {data,error}=await client().rpc("ldm_device_group_create",{p_name:String(name||"").trim()});if(error)throw error;return data}
    async function deleteGroup(id){await ownerContext();const {data,error}=await client().rpc("ldm_device_group_delete",{p_group_id:id});if(error)throw error;return data}
    async function approve(deviceId,groupId){await ownerContext();const {data,error}=await client().rpc("ldm_device_approve",{p_device_id:deviceId,p_group_id:groupId||null});if(error)throw error;return data}
    async function revoke(deviceId){await ownerContext();const {data,error}=await client().rpc("ldm_device_revoke",{p_device_id:deviceId});if(error)throw error;return data}
    async function startRealtime(callback){
        if(channel)return channel;const c=await ownerContext();const supabase=client();const storeId=c.profile.store_id;
        channel=supabase.channel("ldm-device-management-v15")
            .on("postgres_changes",{event:"*",schema:"public",table:"devices",filter:`store_id=eq.${storeId}`},p=>callback&&callback(p))
            .on("postgres_changes",{event:"*",schema:"public",table:"device_groups",filter:`store_id=eq.${storeId}`},p=>callback&&callback(p))
            .subscribe();return channel;
    }
    window.LDMDevices=Object.freeze({ownerContext,currentAccess,listDevices,listGroups,createGroup,deleteGroup,approve,revoke,startRealtime});
})();

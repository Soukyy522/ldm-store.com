(function(){
    "use strict";

    let channel = null;

    function client(){
        if(!window.LDMSupabase) throw new Error("Supabase client belum tersedia.");
        return window.LDMSupabase.createClient();
    }

    function deviceId(){
        if(window.LDMSupabase && typeof window.LDMSupabase.getOrCreateDeviceHeaderId === "function"){
            return window.LDMSupabase.getOrCreateDeviceHeaderId();
        }
        if(window.LDMCloudAuth && typeof window.LDMCloudAuth.getOrCreateDeviceId === "function"){
            return window.LDMCloudAuth.getOrCreateDeviceId();
        }
        return localStorage.getItem("ldmCloudDeviceId") || "";
    }

    async function authenticated(){
        if(!window.LDMCloudSession) throw new Error("Cloud Session belum tersedia.");
        return window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }

    async function rpc(name,args={}){
        await authenticated();
        const {data,error}=await client().rpc(name,args);
        if(error) throw error;
        return data;
    }

    async function listStores(){
        const data=await rpc("ldm_my_network_stores");
        return Array.isArray(data) ? data : [];
    }

    async function createBranch(options={}){
        return rpc("ldm_create_branch_store",{
            p_code:String(options.code||"").trim(),
            p_name:String(options.name||"").trim(),
            p_copy_products:options.copyProducts!==false
        });
    }

    async function listStaff(){
        const data=await rpc("ldm_branch_staff_list");
        return Array.isArray(data) ? data : [];
    }

    async function transferStaff(options={}){
        if(navigator.onLine===false){
            throw new Error("Pemindahan karyawan membutuhkan koneksi internet.");
        }
        return rpc("ldm_transfer_staff_branch",{
            p_user_id:String(options.userId||"").trim(),
            p_destination_store_id:String(options.destinationStoreId||"").trim(),
            p_destination_role:String(options.role||"").trim().toLowerCase()||null,
            p_keep_source_access:Boolean(options.keepSourceAccess)
        });
    }

    async function offlineQueueSafe(){
        if(!window.LDMOfflineQueue || typeof window.LDMOfflineQueue.stats!=="function") return true;
        const info=await window.LDMOfflineQueue.stats();
        return Number(info && info.unsynced || 0)===0;
    }

    function platform(){
        return String(navigator.userAgent||navigator.platform||"Browser").slice(0,500);
    }

    async function prepareStoreDevice(storeId){
        return rpc("ldm_prepare_store_device",{
            p_store_id:storeId,
            p_client_device_id:deviceId(),
            p_device_name:`LocDailyMar - ${navigator.platform||"Browser"}`,
            p_platform:platform()
        });
    }

    const STORE_CACHE_KEYS=[
        "dataBarang","dataLaporan","laporan","laporanHistory","riwayatTransaksi",
        "dataPurchaseOrder","dataGoodsReceipt","dataSupplier","operasional",
        "selectedSupplierForPO","selectedTransactionForReturn","goodsReceiptSourcePO",
        "approvedPOForGoodsReceiptLastUpdate","purchaseOrderLastUpdate","goodsReceiptLastUpdate",
        "supplierLastUpdate","ldmProductsLastSyncAt"
    ];

    function clearStoreCaches(){
        STORE_CACHE_KEYS.forEach(key=>localStorage.removeItem(key));
        if(window.LDMOfflineQueue && typeof window.LDMOfflineQueue.clearLease==="function"){
            window.LDMOfflineQueue.clearLease();
        }
    }

    async function switchStore(storeId){
        if(navigator.onLine===false) throw new Error("Pergantian toko membutuhkan koneksi internet.");
        if(!(await offlineQueueSafe())){
            throw new Error("Masih ada transaksi Offline Queue yang belum selesai. Sinkronkan terlebih dahulu sebelum pindah toko.");
        }

        const status=await prepareStoreDevice(storeId);
        if(String(status).toLowerCase()!=="active"){
            throw new Error("Perangkat ini masih menunggu persetujuan Owner pada toko tujuan.");
        }

        const result=await rpc("ldm_switch_store",{
            p_store_id:storeId,
            p_client_device_id:deviceId()
        });
        clearStoreCaches();
        await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        window.dispatchEvent(new CustomEvent("ldm-active-store-changed",{detail:result}));
        return result;
    }

    async function transferCandidates(destinationStoreId){
        const data=await rpc("ldm_transfer_product_candidates",{p_destination_store_id:destinationStoreId});
        return Array.isArray(data) ? data : [];
    }

    async function createTransfer(destinationStoreId,items,note=""){
        if(navigator.onLine===false) throw new Error("Transfer stok hanya dapat dibuat saat online.");
        return rpc("ldm_create_stock_transfer",{
            p_destination_store_id:destinationStoreId,
            p_items:(Array.isArray(items)?items:[]).map(item=>({
                source_product_id:item.source_product_id,
                qty:Number(item.qty)||0
            })),
            p_note:String(note||"").trim()||null
        });
    }

    async function sendTransfer(id){
        if(navigator.onLine===false) throw new Error("Pengiriman transfer membutuhkan koneksi internet.");
        return rpc("ldm_send_stock_transfer",{p_transfer_id:id});
    }

    async function receiveTransfer(id){
        if(navigator.onLine===false) throw new Error("Penerimaan transfer membutuhkan koneksi internet.");
        return rpc("ldm_receive_stock_transfer",{p_transfer_id:id});
    }

    async function cancelTransfer(id,reason){
        return rpc("ldm_cancel_stock_transfer",{p_transfer_id:id,p_reason:String(reason||"").trim()});
    }

    async function listTransfers(limit=100){
        const data=await rpc("ldm_stock_transfer_list",{p_limit:Number(limit)||100});
        return Array.isArray(data) ? data : [];
    }

    async function startRealtime(callback){
        if(channel) return channel;
        await authenticated();
        channel=client().channel("ldm-multi-store-transfer-v22")
            .on("postgres_changes",{event:"*",schema:"public",table:"stock_transfers"},payload=>{
                if(typeof callback==="function") callback(payload);
            })
            .subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel) return;
        try{await client().removeChannel(channel)}finally{channel=null}
    }

    window.LDMMultiStore=Object.freeze({
        listStores,createBranch,listStaff,transferStaff,prepareStoreDevice,switchStore,offlineQueueSafe,
        transferCandidates,createTransfer,sendTransfer,receiveTransfer,cancelTransfer,
        listTransfers,startRealtime,stopRealtime,clearStoreCaches
    });
})();

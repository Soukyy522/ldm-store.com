(function(){
    "use strict";

    const CACHE_KEY = "ldmPurchasePriceHistory";
    const ENABLED_KEY = "ldmPurchasePriceHistoryEnabled";
    const LAST_SYNC_KEY = "ldmPurchasePriceHistoryLastSyncAt";
    const CHANNEL_NAME = "ldm-purchase-price-history-v19-1-2";

    let channel = null;

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient !== "function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function context(){
        if(!window.LDMCloudSession || typeof window.LDMCloudSession.ensureAuthenticated !== "function"){
            throw new Error("Cloud Session belum tersedia.");
        }
        return await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }

    function number(value,fallback=0){
        const n=Number(value);
        return Number.isFinite(n)?n:fallback;
    }

    function normalize(value){
        return String(value||"").trim().toLowerCase();
    }

    function isUUID(value){
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));
    }

    function readCache(){
        try{
            const parsed=JSON.parse(localStorage.getItem(CACHE_KEY)||"[]");
            return Array.isArray(parsed)?parsed:[];
        }catch(error){
            return [];
        }
    }

    function setCache(rows){
        const mapped=(Array.isArray(rows)?rows:[]).map(row=>({
            id:row.id,
            productId:row.product_id,
            purchasePrice:number(row.purchase_price),
            effectiveAt:row.effective_at,
            businessDate:row.business_date,
            source:row.source||""
        })).sort((a,b)=>Date.parse(a.effectiveAt||0)-Date.parse(b.effectiveAt||0));

        localStorage.setItem(CACHE_KEY,JSON.stringify(mapped));
        localStorage.setItem(ENABLED_KEY,"true");
        localStorage.setItem(LAST_SYNC_KEY,String(Date.now()));
        window.dispatchEvent(new CustomEvent("ldm-cost-history-updated",{detail:{count:mapped.length}}));
        return mapped;
    }

    async function fetchAll(){
        await context();
        const {data,error}=await client().rpc("ldm_visible_cost_history");
        if(error)throw error;
        return Array.isArray(data)?data:[];
    }

    async function refreshCache(){
        const rows=await fetchAll();
        return setCache(rows);
    }

    function transactionTime(transaction){
        const direct=transaction?.timestamp||transaction?.transacted_at||transaction?.transactedAt;
        if(direct){
            const ms=Date.parse(direct);
            if(Number.isFinite(ms)) return ms;
        }

        const date=String(transaction?.tanggal||transaction?.business_date||transaction?.date||"").trim();
        const time=String(transaction?.waktu||transaction?.time||"23:59:59").trim();
        if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
            const normalizedTime=/^\d{2}:\d{2}:\d{2}$/.test(time)
                ? time
                : (/^\d{2}:\d{2}$/.test(time)?`${time}:00`:"23:59:59");
            const ms=Date.parse(`${date}T${normalizedTime}+08:00`);
            if(Number.isFinite(ms)) return ms;
        }
        return Date.now();
    }

    function resolveProductId(item,masterBarang=[]){
        const direct=[item?.productId,item?.product_id,item?.id].find(isUUID);
        if(direct) return String(direct);

        const barcode=String(item?.barcode||item?.barcode_snapshot||"").trim();
        if(barcode){
            const found=(masterBarang||[]).find(product=>String(product?.barcode||"").trim()===barcode);
            if(found && isUUID(found.id)) return String(found.id);
        }

        const name=normalize(item?.nama||item?.namaBarang||item?.product_name_snapshot||item?.title);
        if(name){
            const found=(masterBarang||[]).find(product=>normalize(product?.nama||product?.namaBarang||product?.name)===name);
            if(found && isUUID(found.id)) return String(found.id);
        }
        return null;
    }

    function explicitSnapshot(item){
        const positiveFields=[
            "costPriceSnapshot",
            "cost_price_snapshot",
            "hargaBeli",
            "modal",
            "hpp"
        ];
        for(const key of positiveFields){
            if(Object.prototype.hasOwnProperty.call(item||{},key)){
                const value=Number(item[key]);
                if(Number.isFinite(value) && value>0){
                    return {found:true,value,source:"transaction_snapshot"};
                }
            }
        }

        // Cloud transaction item mempunyai snapshot eksplisit. Nilai 0 tetap
        // dianggap snapshot sah dan tidak boleh diganti oleh harga master hari ini.
        if(item && (item.cloudItemId || item.transactionItemId)){
            const value=Number(item.hargaBeli ?? item.cost_price_snapshot ?? 0);
            if(Number.isFinite(value) && value>=0){
                return {found:true,value,source:"cloud_transaction_snapshot"};
            }
        }
        return {found:false,value:0,source:""};
    }

    function resolve({item,transaction,masterBarang=[]}={}){
        const snapshot=explicitSnapshot(item||{});
        if(snapshot.found) return snapshot;

        const productId=resolveProductId(item||{},masterBarang);
        const target=transactionTime(transaction||{});
        if(productId){
            const rows=readCache().filter(row=>row.productId===productId && Date.parse(row.effectiveAt||0)<=target);
            if(rows.length){
                const latest=rows[rows.length-1];
                return {
                    found:true,
                    value:number(latest.purchasePrice),
                    source:"purchase_price_history",
                    effectiveAt:latest.effectiveAt,
                    businessDate:latest.businessDate
                };
            }
        }

        // Compatibility terakhir untuk data legacy yang dibuat sebelum fitur
        // histori tersedia. Ini bukan rekonstruksi historis yang terjamin.
        const barcode=String(item?.barcode||"").trim();
        const name=normalize(item?.nama||item?.namaBarang||item?.title);
        const current=(masterBarang||[]).find(product=>
            (barcode && String(product?.barcode||"").trim()===barcode)
            || (name && normalize(product?.nama||product?.namaBarang||product?.name)===name)
        );
        const fallback=Number(current?.hargaBeli ?? current?.purchase_price ?? 0);
        if(Number.isFinite(fallback) && fallback>=0){
            return {found:true,value:fallback,source:"legacy_current_price_fallback"};
        }

        return {found:false,value:0,source:"missing"};
    }

    async function startRealtime(){
        if(channel) return channel;
        const ctx=await context();
        if(String(ctx?.profile?.role||"").toLowerCase()!=="owner") return null;
        const storeId=ctx.profile.store_id;
        const supabase=client();
        channel=supabase.channel(CHANNEL_NAME)
            .on("postgres_changes",{
                event:"*",schema:"public",table:"purchase_price_history",
                filter:`store_id=eq.${storeId}`
            },async()=>{
                try{ await refreshCache(); }
                catch(error){ console.warn("Refresh histori Harga Beli gagal:",error); }
            })
            .subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel) return;
        const supabase=client();
        try{ await supabase.removeChannel(channel); }
        finally{ channel=null; }
    }

    async function bootstrap(){
        const ctx=await context();
        if(String(ctx?.profile?.role||"").toLowerCase()!=="owner"){
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(ENABLED_KEY);
            return {enabled:false,count:0,role:ctx?.profile?.role||""};
        }
        const cache=await refreshCache();
        await startRealtime();
        return {enabled:true,count:cache.length,role:"owner"};
    }

    window.LDMCostHistory=Object.freeze({
        readCache,
        fetchAll,
        refreshCache,
        resolve,
        startRealtime,
        stopRealtime,
        bootstrap
    });
})();

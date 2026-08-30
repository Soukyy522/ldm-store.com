(function(){
    "use strict";
    let contextCache=null;
    let contextPromise=null;

    function client(){
        if(!window.LDMSupabase?.createClient)throw new Error("Supabase client belum tersedia.");
        return window.LDMSupabase.createClient();
    }
    async function auth(){
        if(!window.LDMCloudSession)throw new Error("Cloud Session belum tersedia.");
        return window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
    }
    async function rpc(name,args={}){
        await auth();
        const {data,error}=await client().rpc(name,args);
        if(error)throw error;
        return data;
    }
    async function context(force=false){
        if(contextCache&&!force)return contextCache;
        if(contextPromise&&!force)return contextPromise;
        contextPromise=(async()=>{
            const data=await rpc("ldm_primary_owner_context");
            const row=Array.isArray(data)?data[0]:data;
            contextCache=row||{is_primary_owner:false};
            window.LDM_PRIMARY_OWNER_CONTEXT=contextCache;
            window.dispatchEvent(new CustomEvent("ldm-primary-owner-ready",{detail:contextCache}));
            return contextCache;
        })();
        try{return await contextPromise}finally{contextPromise=null}
    }
    function isPrimaryOwner(){
        return contextCache?.is_primary_owner===true;
    }
    async function report({storeId=null,dateFrom,dateTo,limit=500}={}){
        return rpc("ldm_primary_owner_network_report",{
            p_store_id:storeId||null,p_date_from:dateFrom,p_date_to:dateTo,
            p_detail_limit:Number(limit)||500
        });
    }
    async function accounts(){return rpc("ldm_primary_owner_accounts")}
    async function updateAccount(value={}){
        return rpc("ldm_primary_owner_update_account",{
            p_user_id:value.userId,p_store_id:value.storeId,
            p_username:String(value.username||"").trim(),
            p_display_name:String(value.displayName||"").trim()||null,
            p_role:String(value.role||"kasir").toLowerCase(),
            p_active:Boolean(value.active)
        });
    }

    function addPrivacyStyle(){
        if(document.getElementById("ldmPrimaryOwnerPrivacy"))return;
        const style=document.createElement("style");
        style.id="ldmPrimaryOwnerPrivacy";
        style.textContent=`
        html[data-ldm-primary-owner="false"] .owner-purchase-value,
        html[data-ldm-primary-owner="false"] .profit-text,
        html[data-ldm-primary-owner="false"] .card.profit,
        html[data-ldm-primary-owner="false"] [data-sensitive-finance],
        html[data-ldm-primary-owner="false"] [data-primary-owner-only],
        html[data-ldm-primary-owner="false"] #monthlyProfit,
        html[data-ldm-primary-owner="false"] #ownerProfit,
        html[data-ldm-primary-owner="false"] #profitBersih,
        html[data-ldm-primary-owner="false"] #inputHargaBeliGR{display:none!important}
        .ldm-finance-restricted{display:none!important}
        `;
        document.head.appendChild(style);
    }
    function hideSensitiveFields(){
        if(isPrimaryOwner())return;
        const ids=["hargaBeli","editHargaBeli","inputHargaBeliGR"];
        ids.forEach(id=>{
            const node=document.getElementById(id);
            if(!node)return;
            node.disabled=true;
            const wrapper=node.closest(".field,.form-group,.input-group,.form-row")||node;
            wrapper.classList.add("ldm-finance-restricted");
        });
        document.querySelectorAll("th,label,h2,h3,h4,strong,span").forEach(node=>{
            const text=String(node.textContent||"").trim().toLowerCase();
            if(/^(harga beli|hpp|profit bersih|profit setelah hpp|margin keuntungan)$/.test(text)){
                const target=node.closest("th,.field,.form-group,.card,.summary-item")||node;
                target.classList.add("ldm-finance-restricted");
            }
        });
    }
    function sanitizeKnownCaches(){
        const keys=[
            "dataBarang","dataPurchaseOrder","dataGoodsReceipt","dataStockOpname",
            "laporan","dataLaporan","riwayatTransaksi","laporanHistory"
        ];
        const sensitive=new Set([
            "purchase_price","package_purchase_price","purchase_price_before",
            "cost_price_snapshot","unit_cost_snapshot","nominal_snapshot","line_subtotal","total_value",
            "hargaBeli","hargaBeliDasar","hargaBeliSebelum","subtotal","totalNilai",
            "purchasePrice","unitCostSnapshot","hargaModal","hpp","grossProfit","netProfit",
            "profitBersih","profitSetelahHpp"
        ]);
        const clean=value=>{
            if(Array.isArray(value))return value.map(clean);
            if(!value||typeof value!=="object")return value;
            Object.keys(value).forEach(key=>{
                if(sensitive.has(key))value[key]=0;
                else value[key]=clean(value[key]);
            });
            return value;
        };
        keys.forEach(key=>{
            try{
                const raw=localStorage.getItem(key);
                if(!raw)return;
                localStorage.setItem(key,JSON.stringify(clean(JSON.parse(raw))));
            }catch(error){}
        });
        localStorage.removeItem("ldmPurchasePriceHistory");
        localStorage.removeItem("ldmPurchasePriceHistoryEnabled");
    }
    function applyPrivacy(ctx){
        addPrivacyStyle();
        const allowed=ctx?.is_primary_owner===true;
        document.documentElement.dataset.ldmPrimaryOwner=String(allowed);
        if(!allowed){
            sanitizeKnownCaches();
            hideSensitiveFields();
            const observer=new MutationObserver(()=>hideSensitiveFields());
            observer.observe(document.documentElement,{subtree:true,childList:true});
            setTimeout(()=>observer.disconnect(),15000);
        }
    }
    async function initialize(){
        try{const ctx=await context();applyPrivacy(ctx);return ctx}
        catch(error){
            document.documentElement.dataset.ldmPrimaryOwner="false";
            addPrivacyStyle();hideSensitiveFields();
            console.warn("Konteks Owner Utama belum tersedia:",error);
            return {is_primary_owner:false,error:error.message||String(error)};
        }
    }

    window.LDMPrimaryOwner=Object.freeze({
        context,isPrimaryOwner,report,accounts,updateAccount,applyPrivacy,initialize
    });
})();

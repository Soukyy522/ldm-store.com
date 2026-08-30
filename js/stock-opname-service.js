(function(){
    "use strict";

    const CACHE_KEY = "dataStockOpname";
    const ENABLED_KEY = "ldmStockOpnameCloudEnabled";
    const LAST_SYNC_KEY = "ldmStockOpnameLastSyncAt";
    const CHANNEL = "ldm-stock-opname-realtime-v10";

    let channel = null;
    let syncTimer = null;

    function client(){
        if(
            !window.LDMSupabase ||
            typeof window.LDMSupabase.createClient !== "function"
        ){
            throw new Error("Supabase client belum tersedia.");
        }

        return window.LDMSupabase.createClient();
    }

    function createUUID(){
        if(
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ){
            return window.crypto.randomUUID();
        }

        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        const hex = Array.from(bytes)
            .map(b => b.toString(16).padStart(2,"0"))
            .join("");

        return [
            hex.slice(0,8),
            hex.slice(8,12),
            hex.slice(12,16),
            hex.slice(16,20),
            hex.slice(20)
        ].join("-");
    }

    function isEnabled(){
        return localStorage.getItem(
            ENABLED_KEY
        ) === "true";
    }

    function hasLegacyUnmigrated(){
        return safeArray(CACHE_KEY).some(
            row => row && !row._cloud
        );
    }

    function safeArray(key){
        try{
            const data = JSON.parse(
                localStorage.getItem(key) || "[]"
            );
            return Array.isArray(data) ? data : [];
        }catch(error){
            return [];
        }
    }

    async function ensureAuth(){
        if(!window.LDMCloudSession){
            throw new Error("Cloud Session belum tersedia.");
        }

        return await window.LDMCloudSession
            .ensureAuthenticated({
                registerDevice:false
            });
    }

    function rowToLegacy(row){
        const products = safeArray("dataBarang");
        const index = products.findIndex(
            product =>
                String(product.id || "") ===
                String(row.product_id || "")
        );

        let status = "Pending";

        if(row.status === "APPROVED"){
            status = "Tervalidasi";
        }else if(row.status === "REJECTED"){
            status = "Ditolak";
        }else if(row.status === "CANCELLED"){
            status = "Dibatalkan";
        }

        return {
            id:row.id,
            tanggal:row.business_date,
            namaBarang:row.product_name_snapshot || "Barang",
            barcode:row.barcode_snapshot || "-",
            satuan:row.unit_snapshot || "Pcs",
            barangIndex:index,
            productId:row.product_id,
            stokSistem:Number(row.system_stock_snapshot || 0),
            stokFisik:Number(row.physical_stock || 0),
            selisih:Number(row.difference_snapshot || 0),
            nominal:Number(row.nominal_snapshot || 0),
            keterangan:row.note || "-",
            petugas:row.created_username || "-",
            status,
            legacyImported:Boolean(row.legacy_imported),
            stockEffectApplied:Boolean(row.stock_effect_applied),
            appliedStockBefore:
                row.applied_stock_before === null
                    ? null
                    : Number(row.applied_stock_before),
            appliedStockAfter:
                row.applied_stock_after === null
                    ? null
                    : Number(row.applied_stock_after),
            approvedBy:row.approved_username || null,
            approvedAt:row.approved_at || null,
            rejectedBy:row.rejected_username || null,
            rejectReason:row.reject_reason || "",
            cancelledBy:row.cancelled_username || null,
            cancelReason:row.cancel_reason || "",
            _cloud:{
                id:row.id,
                version:Number(row.version || 1)
            }
        };
    }

    async function refreshCache(){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc("ldm_visible_stock_opname");

        if(error){
            throw error;
        }

        const rows = (
            Array.isArray(data) ? data : []
        ).map(rowToLegacy);

        if(
            !isEnabled() &&
            hasLegacyUnmigrated()
        ){
            return safeArray(CACHE_KEY);
        }

        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify(rows)
        );

        localStorage.setItem(
            ENABLED_KEY,
            "true"
        );

        localStorage.setItem(
            LAST_SYNC_KEY,
            String(Date.now())
        );

        window.dispatchEvent(
            new CustomEvent(
                "ldm-stock-opname-cache-updated",
                {
                    detail:{
                        count:rows.length
                    }
                }
            )
        );

        return rows;
    }

    async function submit({
        businessDate,
        items,
        directApprove
    }){
        await ensureAuth();

        if(
            !isEnabled() &&
            hasLegacyUnmigrated()
        ){
            throw new Error(
                "Data Stock Opname lama belum dimigrasikan. Jalankan halaman Migrasi Tahap 10 sebagai Owner terlebih dahulu."
            );
        }

        const payload = (
            Array.isArray(items) ? items : []
        ).map((item,index) => {
            const productId =
                item.productId ||
                item.id ||
                null;

            if(!productId){
                throw new Error(
                    `Barang ${item.namaBarang || "-"} belum memiliki UUID cloud.`
                );
            }

            return {
                product_id:productId,
                physical_stock:Number(item.stokFisik),
                note:item.keterangan || "",
                client_item_id:
                    String(item.id || index)
            };
        });

        if(payload.length === 0){
            throw new Error(
                "Lembar Stock Opname kosong."
            );
        }

        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_submit_stock_opname",
            {
                p_client_batch_id:createUUID(),
                p_business_date:
                    businessDate || null,
                p_items:payload,
                p_direct_approve:
                    Boolean(directApprove)
            }
        );

        if(error){
            throw error;
        }

        if(
            window.LDMProducts &&
            typeof window.LDMProducts.refreshCache === "function"
        ){
            await window.LDMProducts.refreshCache();
        }

        await refreshCache();

        return data;
    }

    async function approve(entryId){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_approve_stock_opname",
            {
                p_entry_id:entryId
            }
        );

        if(error){
            throw error;
        }

        if(
            window.LDMProducts &&
            typeof window.LDMProducts.refreshCache === "function"
        ){
            await window.LDMProducts.refreshCache();
        }

        await refreshCache();

        return data;
    }

    async function reject(entryId, reason){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_reject_stock_opname",
            {
                p_entry_id:entryId,
                p_reason:
                    reason || "Ditolak Owner"
            }
        );

        if(error){
            throw error;
        }

        await refreshCache();
        return data;
    }

    async function cancel(entryId, reason){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_cancel_stock_opname",
            {
                p_entry_id:entryId,
                p_reason:
                    reason || "Dibatalkan Owner"
            }
        );

        if(error){
            throw error;
        }

        if(
            window.LDMProducts &&
            typeof window.LDMProducts.refreshCache === "function"
        ){
            await window.LDMProducts.refreshCache();
        }

        await refreshCache();
        return data;
    }

    async function softDelete(entryId){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_soft_delete_stock_opname",
            {
                p_entry_id:entryId
            }
        );

        if(error){
            throw error;
        }

        await refreshCache();
        return data;
    }

    async function migrateLegacy(items = null){
        const context = await ensureAuth();

        if(
            String(context.profile.role || "")
                .toLowerCase() !== "owner"
        ){
            throw new Error(
                "Migrasi Stock Opname legacy hanya dapat dilakukan Owner."
            );
        }

        const source = Array.isArray(items)
            ? items
            : safeArray(CACHE_KEY);

        const legacy = source.filter(
            row => row && !row._cloud
        );

        if(legacy.length === 0){
            return {processed:0};
        }

        const payload = legacy.map((row,index) => ({
            legacy_source_id:
                `dataStockOpname:${String(row.id || index)}`,
            business_date:
                row.tanggal,
            barcode:
                row.barcode || "",
            name:
                row.namaBarang || "",
            unit:
                row.satuan || "Pcs",
            system_stock:
                Number(row.stokSistem || 0),
            physical_stock:
                Number(row.stokFisik || 0),
            difference:
                Number(row.selisih || 0),
            nominal:
                Number(row.nominal || 0),
            note:
                row.keterangan || "",
            created_username:
                row.petugas || "",
            status:
                row.status || "Pending",
            created_at:
                row.createdAt || ""
        }));

        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_import_legacy_stock_opname",
            {
                p_rows:payload
            }
        );

        if(error){
            throw error;
        }

        localStorage.setItem(
            ENABLED_KEY,
            "true"
        );

        await refreshCache();

        return {
            processed:Number(data || 0)
        };
    }

    function scheduleSync(){
        clearTimeout(syncTimer);
        syncTimer = setTimeout(
            async () => {
                try{
                    await refreshCache();

                    if(
                        window.LDMProducts &&
                        typeof window.LDMProducts.refreshCache === "function"
                    ){
                        await window.LDMProducts.refreshCache();
                    }
                }catch(error){
                    console.error(
                        "Realtime Stock Opname refresh gagal:",
                        error
                    );
                }
            },
            120
        );
    }

    async function startRealtime(){
        if(channel){
            return channel;
        }

        const context = await ensureAuth();
        const storeId = context.profile.store_id;
        const supabase = client();

        channel = supabase
            .channel(CHANNEL)
            .on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table:"stock_opname_entries",
                    filter:`store_id=eq.${storeId}`
                },
                scheduleSync
            )
            .on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table:"stock_movements",
                    filter:`store_id=eq.${storeId}`
                },
                scheduleSync
            )
            .subscribe();

        return channel;
    }

    async function bootstrap(){
        await refreshCache();
        await startRealtime();

        return {
            count:safeArray(CACHE_KEY).length
        };
    }

    window.LDMStockOpname = Object.freeze({
        createUUID,
        isEnabled,
        hasLegacyUnmigrated,
        refreshCache,
        submit,
        approve,
        reject,
        cancel,
        softDelete,
        migrateLegacy,
        startRealtime,
        bootstrap
    });
})();

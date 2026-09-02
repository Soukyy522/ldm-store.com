(function(){
    "use strict";

    const CACHE_KEY =
        "dataBarang";

    const ENABLED_KEY =
        "ldmProductsCloudEnabled";

    const LAST_SYNC_KEY =
        "ldmProductsLastSyncAt";

    const CHANNEL_NAME =
        "ldm-products-realtime-v7";

    let channel =
        null;

    let syncTimer =
        null;

    function client(){
        if(
            !window.LDMSupabase ||
            typeof window.LDMSupabase.createClient !==
                "function"
        ){
            throw new Error(
                "Supabase client belum tersedia."
            );
        }

        return window.LDMSupabase
            .createClient();
    }

    function normalizeNumber(
        value,
        fallback = 0
    ){
        const n =
            Number(value);

        return Number.isFinite(n)
            ? n
            : fallback;
    }

    function rowToLegacy(row){
        const item = {
            id:
                row.id,
            barcode:
                row.barcode || "",
            nama:
                row.name || "",
            kategori:
                row.category || "General",
            stok:
                normalizeNumber(
                    row.legacy_stock_snapshot,
                    0
                ),
            hargaBeli:
                normalizeNumber(
                    row.purchase_price,
                    0
                ),
            harga:
                normalizeNumber(
                    row.sale_price,
                    0
                ),
            satuan:
                row.unit || "Pcs",
            satuanDasar:
                row.unit || "Pcs",
            satuanBeli:
                row.purchase_unit || row.unit || "Pcs",
            konversiBeli:
                Math.max(
                    normalizeNumber(row.purchase_unit_factor,1),
                    0.001
                ),
            expiredTerakhir:
                row.last_expiry_date || "",
            _cloud: {
                version:
                    normalizeNumber(
                        row.version,
                        1
                    ),
                updatedAt:
                    row.updated_at || null
            }
        };

        const hasPromo =
            Boolean(
                row.promo_active
                ||
                row.promo_price !== null
                ||
                row.promo_start_date
                ||
                row.promo_end_date
            );

        if(hasPromo){
            item.promo = {
                aktif:
                    Boolean(
                        row.promo_active
                    ),
                hargaPromo:
                    normalizeNumber(
                        row.promo_price,
                        0
                    ),
                minQty:
                    Math.max(
                        1,
                        normalizeNumber(
                            row.promo_min_qty,
                            1
                        )
                    ),
                tglMulai:
                    row.promo_start_date || "",
                tglSelesai:
                    row.promo_end_date || ""
            };
        }

        return item;
    }

    function setCache(
        rows
    ){
        let legacy =
            (
                Array.isArray(rows)
                    ? rows
                    : []
            )
            .map(rowToLegacy);

        if(
            window.LDMOfflineQueue &&
            typeof window.LDMOfflineQueue.applyReservationsToProducts === "function"
        ){
            legacy = window.LDMOfflineQueue.applyReservationsToProducts(legacy);
        }

        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify(
                legacy
            )
        );

        localStorage.setItem(
            LAST_SYNC_KEY,
            String(
                Date.now()
            )
        );

        if(legacy.length > 0){
            localStorage.setItem(
                ENABLED_KEY,
                "true"
            );
        }

        window.dispatchEvent(
            new CustomEvent(
                "ldm-products-cache-updated",
                {
                    detail: {
                        count:
                            legacy.length
                    }
                }
            )
        );

        return legacy;
    }

    function readCache(){
        try{
            const raw =
                localStorage.getItem(
                    CACHE_KEY
                );

            const parsed =
                raw
                    ? JSON.parse(raw)
                    : [];

            return Array.isArray(parsed)
                ? parsed
                : [];
        }catch(error){
            console.warn(
                "Cache dataBarang rusak:",
                error
            );

            return [];
        }
    }

    function isEnabled(){
        return localStorage.getItem(
            ENABLED_KEY
        ) === "true";
    }

    async function fetchAll(){
        const supabase =
            client();

        const {
            data,
            error
        } =
            await supabase
                .from("products")
                .select(
                    [
                        "id",
                        "store_id",
                        "barcode",
                        "name",
                        "category",
                        "unit",
                        "purchase_unit",
                        "purchase_unit_factor",
                        "purchase_price",
                        "sale_price",
                        "legacy_stock_snapshot",
                        "last_expiry_date",
                        "promo_active",
                        "promo_price",
                        "promo_min_qty",
                        "promo_start_date",
                        "promo_end_date",
                        "active",
                        "version",
                        "created_at",
                        "updated_at"
                    ].join(",")
                )
                .eq(
                    "active",
                    true
                )
                .order(
                    "name",
                    {
                        ascending:
                            true
                    }
                );

        if(error){
            throw error;
        }

        return Array.isArray(data)
            ? data
            : [];
    }

    async function refreshCache(){
        const rows =
            await fetchAll();

        return setCache(
            rows
        );
    }

    async function getContext(){
        if(
            !window.LDMCloudSession
        ){
            throw new Error(
                "Cloud Session belum tersedia."
            );
        }

        return await window
            .LDMCloudSession
            .ensureAuthenticated({
                registerDevice:
                    false
            });
    }

    async function migrateLocal(
        items = null
    ){
        const context =
            await getContext();

        if(
            String(
                context.profile.role
            ).toLowerCase()
            !== "owner"
        ){
            throw new Error(
                "Hanya Owner yang dapat migrasi Master Barang."
            );
        }

        const source =
            Array.isArray(items)
                ? items
                : readCache();

        if(source.length === 0){
            throw new Error(
                "dataBarang lokal kosong."
            );
        }

        const supabase =
            client();

        const {
            data,
            error
        } =
            await supabase.rpc(
                "ldm_sync_products_stage20",
                {
                    p_products:
                        source
                }
            );

        if(error){
            throw error;
        }

        localStorage.setItem(
            ENABLED_KEY,
            "true"
        );

        const cache =
            await refreshCache();

        return {
            processed:
                normalizeNumber(
                    data,
                    source.length
                ),
            cache
        };
    }

    async function syncPresentProducts(
        items
    ){
        if(!isEnabled()){
            return {
                skipped:
                    true,
                reason:
                    "cloud_not_enabled"
            };
        }

        const context =
            await getContext();

        if(
            String(
                context.profile.role
            ).toLowerCase()
            !== "owner"
        ){
            return {
                skipped:
                    true,
                reason:
                    "owner_required"
            };
        }

        const source =
            Array.isArray(items)
                ? items
                : readCache();

        const supabase =
            client();

        const {
            data,
            error
        } =
            await supabase.rpc(
                "ldm_sync_products_stage20",
                {
                    p_products:
                        source
                }
            );

        if(error){
            throw error;
        }

        await refreshCache();

        return {
            skipped:
                false,
            processed:
                normalizeNumber(
                    data,
                    source.length
                )
        };
    }

    function scheduleSync(
        items,
        delay = 300
    ){
        if(!isEnabled()){
            return;
        }

        clearTimeout(
            syncTimer
        );

        const snapshot =
            JSON.parse(
                JSON.stringify(
                    Array.isArray(items)
                        ? items
                        : readCache()
                )
            );

        syncTimer =
            setTimeout(
                async function(){
                    try{
                        await syncPresentProducts(
                            snapshot
                        );
                    }catch(error){
                        console.error(
                            "Cloud product sync gagal:",
                            error
                        );

                        window.dispatchEvent(
                            new CustomEvent(
                                "ldm-products-sync-error",
                                {
                                    detail: {
                                        message:
                                            error.message
                                            ||
                                            String(error)
                                    }
                                }
                            )
                        );
                    }
                },
                delay
            );
    }

    async function softDelete(
        productId
    ){
        if(!productId){
            return false;
        }

        const context =
            await getContext();

        if(
            String(
                context.profile.role
            ).toLowerCase()
            !== "owner"
        ){
            throw new Error(
                "Hanya Owner yang dapat menghapus Master Barang."
            );
        }

        const supabase =
            client();

        const {
            data,
            error
        } =
            await supabase.rpc(
                "ldm_soft_delete_product",
                {
                    p_product_id:
                        productId
                }
            );

        if(error){
            throw error;
        }

        await refreshCache();

        return Boolean(data);
    }

    async function startRealtime(){
        if(channel){
            return channel;
        }

        const context =
            await getContext();

        const storeId =
            context.profile.store_id;

        if(!storeId){
            throw new Error(
                "store_id cloud tidak tersedia."
            );
        }

        const supabase =
            client();

        channel =
            supabase
                .channel(
                    CHANNEL_NAME
                )
                .on(
                    "postgres_changes",
                    {
                        event:
                            "*",
                        schema:
                            "public",
                        table:
                            "products",
                        filter:
                            `store_id=eq.${storeId}`
                    },
                    async function(){
                        try{
                            await refreshCache();
                        }catch(error){
                            console.error(
                                "Realtime refresh produk gagal:",
                                error
                            );
                        }
                    }
                )
                .subscribe();

        return channel;
    }

    async function stopRealtime(){
        if(!channel){
            return;
        }

        const supabase =
            client();

        try{
            await supabase
                .removeChannel(
                    channel
                );
        }finally{
            channel = null;
        }
    }

    async function bootstrap(){
        const context =
            await getContext();

        const rows =
            await fetchAll();

        if(rows.length > 0){
            localStorage.setItem(
                ENABLED_KEY,
                "true"
            );

            setCache(
                rows
            );
        }

        await startRealtime();

        return {
            context,
            count:
                rows.length,
            enabled:
                isEnabled()
        };
    }

    window.LDMProducts =
        Object.freeze({
            readCache,
            isEnabled,
            fetchAll,
            refreshCache,
            migrateLocal,
            syncPresentProducts,
            scheduleSync,
            softDelete,
            startRealtime,
            stopRealtime,
            bootstrap
        });
})();

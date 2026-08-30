(function(){
    "use strict";

    const RETURNS_CACHE = "dataRetur";
    const TX_CACHE = "ldmReturnTransactions";
    const ENABLED_KEY = "ldmReturnsCloudEnabled";
    const LAST_SYNC_KEY = "ldmReturnsLastSyncAt";
    const CHANNEL = "ldm-returns-realtime-v10";

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
        return safeArray(RETURNS_CACHE).some(
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

    function formatWITA(value){
        if(!value){
            return {date:"",time:""};
        }

        const d = new Date(value);
        if(!Number.isFinite(d.getTime())){
            return {date:"",time:""};
        }

        const parts = new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:"Asia/Makassar",
                year:"numeric",
                month:"2-digit",
                day:"2-digit",
                hour:"2-digit",
                minute:"2-digit",
                second:"2-digit",
                hour12:false
            }
        ).formatToParts(d);

        const map = {};
        parts.forEach(part => {
            if(part.type !== "literal"){
                map[part.type] = part.value;
            }
        });

        return {
            date:`${map.year}-${map.month}-${map.day}`,
            time:`${map.hour}:${map.minute}:${map.second}`
        };
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

    function txRowToLegacy(row){
        const local = formatWITA(row.transacted_at);

        return {
            id: row.id,
            cloudId: row.id,
            kodeTransaksi: row.transaction_code,
            kasir: row.cashier_username || "",
            shift: row.shift_label || "",
            shiftLabel: row.shift_label || "",
            tanggal: row.business_date || local.date,
            waktu: local.time,
            waktu_teks:
                `${row.business_date || local.date} ${local.time}`,
            metode: row.payment_method,
            total: Number(row.grand_total || 0),
            subtotal: Number(row.subtotal || 0),
            diskonManual: Number(row.manual_discount || 0),
            cloudStatus: row.status,
            keranjang: (
                Array.isArray(row.items)
                    ? row.items
                    : []
            ).map(item => ({
                transactionItemId: item.id,
                productId: item.product_id,
                id: item.product_id,
                barcode: item.barcode || "",
                nama: item.name || "",
                satuan: item.unit || "Pcs",
                qty: Number(item.qty || 0),
                jumlah: Number(item.qty || 0),
                harga: Number(item.unit_price || 0),
                subtotal: Number(item.line_subtotal || 0)
            })),
            _cloudReturnSource:true
        };
    }

    async function refreshTransactions(){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_returnable_transactions",
            {
                p_limit:500
            }
        );

        if(error){
            throw error;
        }

        const rows = Array.isArray(data)
            ? data
            : [];

        const legacy = rows.map(txRowToLegacy);

        localStorage.setItem(
            TX_CACHE,
            JSON.stringify(legacy)
        );

        window.dispatchEvent(
            new CustomEvent(
                "ldm-return-transactions-updated",
                {
                    detail:{
                        count:legacy.length
                    }
                }
            )
        );

        return legacy;
    }

    function returnRowToLegacy(row){
        const created = formatWITA(row.created_at);
        const approved = formatWITA(row.approved_at);

        const items = (
            Array.isArray(row.sales_return_items)
                ? row.sales_return_items
                : []
        ).map(item => ({
            cloudItemId:item.id,
            transactionItemId:item.transaction_item_id,
            productId:item.product_id,
            barcode:item.barcode_snapshot || "",
            nama:item.product_name_snapshot || "Barang",
            satuan:item.unit_snapshot || "Pcs",
            qtyBeli:0,
            qtyRetur:Number(item.qty || 0),
            harga:Number(item.refund_unit_price || 0),
            nilaiRetur:Number(item.refund_amount || 0),
            alasan:item.reason || "",
            kembaliKeStok:Boolean(item.restock)
        }));

        return {
            cloudId:row.id,
            returId:row.return_code,
            transaksiId:row.transaction_code_snapshot,
            transaksiRawId:row.transaction_id,
            tanggal:created.date,
            waktu:created.time,
            createdAt:row.created_at,
            dibuatOleh:row.created_username,
            rolePembuat:"",
            kasirAsli:row.original_cashier_snapshot || "",
            shiftIdAsli:"",
            items,
            totalRetur:Number(row.total_refund || 0),
            metodeRefund:row.refund_method,
            refundShiftId:"",
            refundContextKey:
                row.refund_username
                    ? `ABS|${row.refund_username}|${row.refund_shift_label || "Shift 1"}`
                    : "",
            refundKasir:row.refund_username || "",
            refundShift:row.refund_shift_label || "",
            catatan:row.note || "",
            status:String(row.status || "PENDING").toUpperCase(),
            approvedBy:row.approved_username || null,
            approvedAt:row.approved_at || null,
            approvedTanggal:approved.date || null,
            rejectedBy:row.rejected_username || null,
            rejectedAt:row.rejected_at || null,
            rejectReason:row.reject_reason || "",
            cancelledBy:row.cancelled_username || null,
            cancelledAt:row.cancelled_at || null,
            cancelReason:row.cancel_reason || "",
            wasApprovedBeforeCancel:
                String(row.status || "").toUpperCase() === "CANCELLED"
                && Boolean(row.stock_effect_applied) === false
                && Boolean(row.approved_at),
            legacyImported:Boolean(row.legacy_imported),
            stockEffectApplied:Boolean(row.stock_effect_applied),
            versiRetur:10,
            _cloud:{
                id:row.id,
                version:Number(row.version || 1)
            }
        };
    }

    function syncLegacyCashMutations(rows){
        const existing = safeArray("mutasiKasShift")
            .filter(item => !item._cloudStage10Return);

        const generated = rows
            .filter(row =>
                String(row.status || "").toUpperCase() === "APPROVED"
                &&
                String(row.metodeRefund || "").toLowerCase() === "tunai"
            )
            .map(row => ({
                id:`CLOUD-RETURN-${row.cloudId}`,
                tanggal:row.approvedTanggal || row.tanggal,
                waktu:formatWITA(row.approvedAt).time || row.waktu,
                kasir:row.refundKasir || "",
                shift:row.refundShift || "",
                shiftId:"",
                jenis:"keluar",
                nominal:Number(row.totalRetur || 0),
                keterangan:`Refund Retur ${row.returId}`,
                sumber:"retur",
                returId:row.returId,
                createdBy:row.approvedBy || row.dibuatOleh || "",
                closingId:null,
                _cloudStage10Return:true
            }));

        localStorage.setItem(
            "mutasiKasShift",
            JSON.stringify([
                ...generated,
                ...existing
            ])
        );
    }

    async function syncReturnStockMovements(){
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_visible_stock_movements",
            {p_movement_types:["return","return_cancel"],p_limit:1000}
        );

        if(error){
            throw error;
        }

        const products = safeArray("dataBarang");
        const existing = safeArray("kartuStokMutasi")
            .filter(item => !item._cloudStage10Return);

        const generated = (
            Array.isArray(data) ? data : []
        ).map(row => {
            const product = products.find(
                item => String(item.id || "") === String(row.product_id)
            ) || {};

            const local = formatWITA(row.occurred_at);
            const isCancel =
                row.movement_type === "return_cancel";

            return {
                id:`CLOUD-${row.id}`,
                timestamp:new Date(row.occurred_at).getTime(),
                tanggal:local.date,
                waktu:local.time,
                barcode:product.barcode || "",
                namaBarang:product.nama || "",
                barangIndex:products.findIndex(
                    item => String(item.id || "") === String(row.product_id)
                ),
                productId:row.product_id,
                jenis:
                    isCancel
                        ? "retur_cancelled"
                        : "retur_penjualan",
                sumber:
                    isCancel
                        ? "retur_cancel"
                        : "retur",
                referensi:row.reference_code || row.source_id || "",
                delta:Number(row.quantity_change || 0),
                stokSebelum:Number(row.stock_before || 0),
                stokSesudah:Number(row.stock_after || 0),
                keterangan:
                    row.note ||
                    (
                        isCancel
                            ? "Pembatalan retur"
                            : "Retur penjualan"
                    ),
                petugas:"",
                _cloudStage10Return:true
            };
        });

        localStorage.setItem(
            "kartuStokMutasi",
            JSON.stringify([
                ...generated,
                ...existing
            ])
        );

        return generated;
    }

    async function refreshCache(){
        await ensureAuth();

        const supabase = client();
        const {data,error} = await supabase
            .from("sales_returns")
            .select(
                "id,client_return_id,return_code,transaction_id,transaction_code_snapshot,original_cashier_snapshot,created_username,refund_method,refund_username,refund_shift_label,note,total_refund,status,approved_username,approved_at,rejected_username,rejected_at,reject_reason,cancelled_username,cancelled_at,cancel_reason,legacy_imported,stock_effect_applied,created_at,version,sales_return_items(id,transaction_item_id,product_id,product_name_snapshot,barcode_snapshot,unit_snapshot,qty,refund_unit_price,refund_amount,reason,restock)"
            )
            .order(
                "created_at",
                {ascending:false}
            )
            .limit(1000);

        if(error){
            throw error;
        }

        const rows = (
            Array.isArray(data) ? data : []
        ).map(returnRowToLegacy);

        if(
            !isEnabled() &&
            hasLegacyUnmigrated()
        ){
            return safeArray(RETURNS_CACHE);
        }

        localStorage.setItem(
            RETURNS_CACHE,
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

        syncLegacyCashMutations(rows);

        try{
            await syncReturnStockMovements();
        }catch(error){
            console.warn(
                "Sinkron kartu stok retur gagal:",
                error
            );
        }

        window.dispatchEvent(
            new CustomEvent(
                "ldm-returns-cache-updated",
                {
                    detail:{
                        count:rows.length
                    }
                }
            )
        );

        return rows;
    }

    function transactionIdFrom(tx){
        return (
            tx &&
            (
                tx.cloudId ||
                (
                    typeof tx.id === "string" &&
                    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(tx.id)
                        ? tx.id
                        : null
                )
            )
        ) || null;
    }

    async function submit({
        transaction,
        items,
        refundMethod,
        refundUsername,
        note
    }){
        await ensureAuth();

        if(
            !isEnabled() &&
            hasLegacyUnmigrated()
        ){
            throw new Error(
                "Data Retur lama belum dimigrasikan. Jalankan halaman Migrasi Tahap 10 sebagai Owner terlebih dahulu."
            );
        }

        const transactionId =
            transactionIdFrom(transaction);

        if(!transactionId){
            throw new Error(
                "Transaksi belum memiliki UUID cloud. Retur Tahap 10 hanya memproses transaksi cloud Tahap 8+."
            );
        }

        const payload = (
            Array.isArray(items) ? items : []
        ).map(item => ({
            transaction_item_id:
                item.transactionItemId,
            qty:Number(item.qtyRetur || item.qty || 0),
            reason:item.alasan || item.reason || "",
            restock:
                item.kembaliKeStok !== false
        }));

        if(
            payload.length === 0 ||
            payload.some(
                item =>
                    !item.transaction_item_id ||
                    !(item.qty > 0)
            )
        ){
            throw new Error(
                "Item retur cloud tidak valid atau transaction_item_id tidak tersedia."
            );
        }

        const supabase = client();
        const clientReturnId = createUUID();

        const {data,error} = await supabase.rpc(
            "ldm_submit_return",
            {
                p_client_return_id:clientReturnId,
                p_transaction_id:transactionId,
                p_items:payload,
                p_refund_method:
                    refundMethod || "Tunai",
                p_refund_username:
                    refundUsername,
                p_note:
                    note || null
            }
        );

        if(error){
            throw error;
        }

        await refreshCache();

        return data;
    }

    async function approve(returnId, refundUsername){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_approve_return",
            {
                p_return_id:returnId,
                p_refund_username:refundUsername
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

    async function reject(returnId, reason){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_reject_return",
            {
                p_return_id:returnId,
                p_reason:reason || "Data tidak sesuai"
            }
        );

        if(error){
            throw error;
        }

        await refreshCache();
        return data;
    }

    async function cancel(returnId, reason){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_cancel_return",
            {
                p_return_id:returnId,
                p_reason:reason || "Retur dibatalkan"
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

    async function softDelete(returnId){
        await ensureAuth();
        const supabase = client();

        const {data,error} = await supabase.rpc(
            "ldm_soft_delete_return",
            {
                p_return_id:returnId
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
                "Migrasi Retur legacy hanya dapat dilakukan Owner."
            );
        }

        const source = Array.isArray(items)
            ? items
            : safeArray(RETURNS_CACHE);

        const legacy = source.filter(
            row => row && !row._cloud
        );

        if(legacy.length === 0){
            return {processed:0};
        }

        const payload = legacy.map((row,index) => ({
            legacy_source_id:
                `dataRetur:${String(row.returId || row.id || index)}`,
            return_code:
                row.returId || null,
            transaction_code:
                row.transaksiId || "LEGACY",
            original_cashier:
                row.kasirAsli || "",
            created_username:
                row.dibuatOleh || "",
            refund_method:
                row.metodeRefund || "Tunai",
            refund_username:
                row.refundKasir || "",
            refund_shift_label:
                row.refundShift || "",
            note:
                row.catatan || "",
            total_refund:
                Number(row.totalRetur || 0),
            status:
                String(row.status || "PENDING").toUpperCase(),
            approved_username:
                row.approvedBy || "",
            approved_at:
                row.approvedAt || "",
            rejected_username:
                row.rejectedBy || "",
            rejected_at:
                row.rejectedAt || "",
            reject_reason:
                row.rejectReason || "",
            cancelled_username:
                row.cancelledBy || "",
            cancelled_at:
                row.cancelledAt || "",
            cancel_reason:
                row.cancelReason || "",
            created_at:
                row.createdAt || "",
            items:(
                Array.isArray(row.items)
                    ? row.items
                    : []
            ).map(item => ({
                barcode:item.barcode || "",
                name:item.nama || item.namaBarang || "Barang",
                unit:item.satuan || "Pcs",
                qty:Number(item.qtyRetur || 0),
                unit_price:Number(item.harga || 0),
                refund_amount:Number(item.nilaiRetur || 0),
                reason:item.alasan || "",
                restock:item.kembaliKeStok !== false
            }))
        }));

        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_import_legacy_returns",
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
                    await Promise.all([
                        refreshCache(),
                        refreshTransactions()
                    ]);
                }catch(error){
                    console.error(
                        "Realtime Return refresh gagal:",
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
                    table:"sales_returns",
                    filter:`store_id=eq.${storeId}`
                },
                scheduleSync
            )
            .on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table:"sales_return_items",
                    filter:`store_id=eq.${storeId}`
                },
                scheduleSync
            )
            .on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table:"cash_movements",
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
        await ensureAuth();

        await Promise.all([
            refreshTransactions(),
            refreshCache()
        ]);

        await startRealtime();

        return {
            returns:safeArray(RETURNS_CACHE).length,
            transactions:safeArray(TX_CACHE).length
        };
    }

    window.LDMReturns = Object.freeze({
        createUUID,
        isEnabled,
        hasLegacyUnmigrated,
        refreshTransactions,
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

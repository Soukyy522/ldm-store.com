(function(){
    "use strict";

    const REALTIME_CHANNEL =
        "ldm-transactions-realtime-v8";

    let channel = null;

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

    function createUUID(){
        if(
            window.crypto &&
            typeof window.crypto.randomUUID ===
                "function"
        ){
            return window.crypto.randomUUID();
        }

        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);

        bytes[6] =
            (bytes[6] & 0x0f) | 0x40;
        bytes[8] =
            (bytes[8] & 0x3f) | 0x80;

        const hex = Array
            .from(bytes)
            .map(
                b => b
                    .toString(16)
                    .padStart(2, "0")
            )
            .join("");

        return [
            hex.slice(0,8),
            hex.slice(8,12),
            hex.slice(12,16),
            hex.slice(16,20),
            hex.slice(20)
        ].join("-");
    }

    function number(value, fallback = 0){
        const n = Number(value);
        return Number.isFinite(n)
            ? n
            : fallback;
    }

    function resolveProductId(item){
        if(item && item.productId){
            return item.productId;
        }

        if(item && item.id){
            return item.id;
        }

        let cache = [];

        try{
            const parsed = JSON.parse(
                localStorage.getItem(
                    "dataBarang"
                ) || "[]"
            );

            cache = Array.isArray(parsed)
                ? parsed
                : [];
        }catch(error){
            cache = [];
        }

        const barcode = String(
            item && item.barcode || ""
        ).trim();

        const name = String(
            item && item.nama || ""
        )
            .trim()
            .toLowerCase();

        const product = cache.find(
            row =>
                (
                    barcode &&
                    String(row.barcode || "").trim() ===
                        barcode
                )
                ||
                (
                    name &&
                    String(row.nama || "")
                        .trim()
                        .toLowerCase() ===
                        name
                )
        );

        return product && product.id
            ? product.id
            : null;
    }

    function buildItems(cart){
        if(!Array.isArray(cart)){
            return [];
        }

        return cart.map(
            item => {
                const productId =
                    resolveProductId(item);

                if(!productId){
                    throw new Error(
                        `Barang ${item && item.nama ? item.nama : "-"} belum memiliki UUID cloud. Jalankan migrasi Master Barang Tahap 7.`
                    );
                }

                const qty = number(
                    item.qty,
                    0
                );

                if(qty <= 0){
                    throw new Error(
                        "Qty transaksi tidak valid."
                    );
                }

                return {
                    product_id:
                        productId,
                    qty:
                        qty
                };
            }
        );
    }

    function businessDate(value){
        if(window.LDMLocalTime) return window.LDMLocalTime.dateKey(value);
        const date=value instanceof Date?value:new Date(value||Date.now());
        const pad=v=>String(v).padStart(2,"0");
        return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    }

    function displaySnapshot(options, clientTransactionId, queuedAt){
        const cart = Array.isArray(options.items) ? options.items : [];
        const items = buildItems(cart).map((rpcItem,index) => {
            const item = cart[index] || {};
            const qty = number(rpcItem.qty,0);
            const normalPrice = Math.max(0,number(item.hargaNormal,number(item.harga,0)));
            const unitPrice = Math.max(0,number(item.harga,normalPrice));
            return {
                product_id:rpcItem.product_id,
                barcode:String(item.barcode || ""),
                nama:String(item.nama || ""),
                satuan:String(item.satuan || "Pcs"),
                qty,
                hargaBeli:Math.max(0,number(item.hargaBeli,0)),
                hargaNormal:normalPrice,
                harga:unitPrice,
                subtotal:Math.round(unitPrice * qty * 100) / 100,
                diskon:Math.round(Math.max(0,(normalPrice - unitPrice) * qty) * 100) / 100
            };
        });

        const normalSubtotal = items.reduce((sum,item) => sum + item.hargaNormal * item.qty,0);
        const subtotal = items.reduce((sum,item) => sum + item.subtotal,0);
        const productDiscount = Math.max(0,normalSubtotal - subtotal);
        const manualDiscount = Math.max(0,number(options.manualDiscount,0));
        const grandTotal = Math.max(0,subtotal - manualDiscount);
        const codeDate = businessDate(queuedAt).replace(/-/g,"").slice(2);

        return {
            transaction_code:`OFF-${codeDate}-${clientTransactionId.replace(/-/g,"").slice(0,8).toUpperCase()}`,
            client_transaction_id:clientTransactionId,
            queued_at:queuedAt,
            business_date:businessDate(queuedAt),
            payment_method:options.paymentMethod || "Tunai",
            shift_label:options.shiftLabel || null,
            normal_subtotal:Math.round(normalSubtotal * 100) / 100,
            subtotal:Math.round(subtotal * 100) / 100,
            product_discount:Math.round(productDiscount * 100) / 100,
            manual_discount:Math.round(manualDiscount * 100) / 100,
            total_discount:Math.round((productDiscount + manualDiscount) * 100) / 100,
            grand_total:Math.round(grandTotal * 100) / 100,
            cash_received:Math.max(0,number(options.cashReceived,0)),
            cash_amount:Math.max(0,number(options.cashAmount,0)),
            qris_amount:Math.max(0,number(options.qrisAmount,0)),
            change_amount:Math.max(0,number(options.cashReceived,0) - grandTotal),
            items
        };
    }

    function rpcPayload(options, snapshot){
        return {
            p_client_transaction_id:snapshot.client_transaction_id,
            p_items:snapshot.items.map(item => ({product_id:item.product_id,qty:item.qty})),
            p_manual_discount:snapshot.manual_discount,
            p_payment_method:snapshot.payment_method,
            p_cash_received:snapshot.cash_received,
            p_cash_amount:snapshot.cash_amount,
            p_qris_amount:snapshot.qris_amount,
            p_shift_label:snapshot.shift_label,
            p_expected_grand_total:snapshot.grand_total
        };
    }

    function offlineResult(snapshot, queueItem){
        const lease = window.LDMOfflineQueue.validLease();
        return {
            id:null,
            local_id:`offline:${queueItem.queue_id}`,
            client_transaction_id:snapshot.client_transaction_id,
            transaction_code:snapshot.transaction_code,
            business_date:snapshot.business_date,
            transacted_at:snapshot.queued_at,
            cashier_username:lease ? lease.username : localStorage.getItem("username") || "",
            shift_label:snapshot.shift_label,
            payment_method:snapshot.payment_method,
            normal_subtotal:snapshot.normal_subtotal,
            subtotal:snapshot.subtotal,
            product_discount:snapshot.product_discount,
            manual_discount:snapshot.manual_discount,
            total_discount:snapshot.total_discount,
            grand_total:snapshot.grand_total,
            cash_received:snapshot.cash_received,
            cash_amount:snapshot.cash_amount,
            qris_amount:snapshot.qris_amount,
            change_amount:snapshot.change_amount,
            status:"pending_sync",
            items:snapshot.items,
            offline_queued:true,
            offline_queue_id:queueItem.queue_id,
            queued_at:snapshot.queued_at
        };
    }

    async function queueCheckout(options, clientTransactionId){
        if(!window.LDMOfflineQueue){
            throw new Error("Modul Offline Queue belum tersedia.");
        }
        const lease = window.LDMOfflineQueue.validLease();
        if(!lease){
            throw new Error("Mode offline belum aktif. Login online dari perangkat yang sudah disetujui diperlukan terlebih dahulu.");
        }

        const queuedAt = new Date().toISOString();
        const snapshot = displaySnapshot(options,clientTransactionId,queuedAt);
        const queueItem = await window.LDMOfflineQueue.enqueueSale({
            client_transaction_id:clientTransactionId,
            user_id:lease.user_id,
            store_id:lease.store_id,
            client_device_id:lease.client_device_id,
            queued_at:queuedAt,
            rpc_payload:rpcPayload(options,snapshot),
            display_snapshot:snapshot
        });
        return offlineResult(snapshot,queueItem);
    }

    async function directCheckout(options, clientTransactionId){
        await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        const snapshot = displaySnapshot(options,clientTransactionId,new Date().toISOString());
        const payload = rpcPayload(options,snapshot);
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_complete_sale", {
            p_client_transaction_id:payload.p_client_transaction_id,
            p_items:payload.p_items,
            p_manual_discount:payload.p_manual_discount,
            p_payment_method:payload.p_payment_method,
            p_cash_received:payload.p_cash_received,
            p_cash_amount:payload.p_cash_amount,
            p_qris_amount:payload.p_qris_amount,
            p_shift_label:payload.p_shift_label
        });
        if(error){
            throw error;
        }
        if(!data || !data.id){
            throw new Error("Supabase tidak mengembalikan transaksi yang valid.");
        }
        return data;
    }

    async function checkout(options){
        if(!options){
            throw new Error(
                "Payload checkout kosong."
            );
        }

        if(!window.LDMCloudSession){
            throw new Error(
                "Cloud Session belum tersedia."
            );
        }

        const clientTransactionId =
            options.clientTransactionId ||
            createUUID();

        // Validasi produk/qty dilakukan sebelum request atau enqueue.
        buildItems(options.items);

        if(navigator.onLine === false){
            return queueCheckout(options,clientTransactionId);
        }

        try{
            return await directCheckout(options,clientTransactionId);
        }catch(error){
            if(
                window.LDMOfflineQueue &&
                window.LDMOfflineQueue.isRetryableNetworkError(error) &&
                window.LDMOfflineQueue.validLease()
            ){
                return queueCheckout(options,clientTransactionId);
            }
            throw error;
        }
    }

    async function recentTransactions(limit = 30){
        const supabase = client();

        const safeLimit = Math.min(
            100,
            Math.max(
                1,
                Number(limit) || 30
            )
        );

        const {
            data,
            error
        } = await supabase
            .from("transactions")
            .select(
                [
                    "id",
                    "client_transaction_id",
                    "transaction_code",
                    "cashier_username",
                    "shift_label",
                    "business_date",
                    "transacted_at",
                    "payment_method",
                    "normal_subtotal",
                    "subtotal",
                    "product_discount",
                    "manual_discount",
                    "total_discount",
                    "grand_total",
                    "cash_received",
                    "cash_amount",
                    "qris_amount",
                    "change_amount",
                    "status"
                ].join(",")
            )
            .order(
                "transacted_at",
                {
                    ascending:
                        false
                }
            )
            .limit(safeLimit);

        if(error){
            throw error;
        }

        return Array.isArray(data)
            ? data
            : [];
    }

    async function recentMovements(limit = 50){
        const supabase = client();

        const safeLimit = Math.min(
            200,
            Math.max(
                1,
                Number(limit) || 50
            )
        );

        const {
            data,
            error
        } = await supabase.rpc(
            "ldm_visible_stock_movements",
            {p_movement_types:null,p_limit:safeLimit}
        );

        if(error){
            throw error;
        }

        return Array.isArray(data)
            ? data
            : [];
    }

    async function voidSale(
        transactionId,
        reason = "Void transaksi"
    ){
        const supabase = client();

        const {
            data,
            error
        } = await supabase.rpc(
            "ldm_void_sale",
            {
                p_transaction_id:
                    transactionId,
                p_reason:
                    reason
            }
        );

        if(error){
            throw error;
        }

        return data;
    }

    async function startRealtime(callback){
        if(channel){
            return channel;
        }

        if(!window.LDMCloudSession){
            throw new Error(
                "Cloud Session belum tersedia."
            );
        }

        const context =
            await window.LDMCloudSession
                .ensureAuthenticated({
                    registerDevice:
                        false
                });

        const storeId =
            context.profile.store_id;

        const supabase = client();

        channel = supabase
            .channel(
                REALTIME_CHANNEL
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "transactions",
                    filter:
                        `store_id=eq.${storeId}`
                },
                payload => {
                    if(
                        typeof callback ===
                        "function"
                    ){
                        callback(
                            "transactions",
                            payload
                        );
                    }
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "stock_movements",
                    filter:
                        `store_id=eq.${storeId}`
                },
                payload => {
                    if(
                        typeof callback ===
                        "function"
                    ){
                        callback(
                            "stock_movements",
                            payload
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

        const supabase = client();

        try{
            await supabase.removeChannel(
                channel
            );
        }finally{
            channel = null;
        }
    }

    window.LDMTransactions =
        Object.freeze({
            createUUID,
            buildItems,
            checkout,
            recentTransactions,
            recentMovements,
            voidSale,
            startRealtime,
            stopRealtime
        });
})();

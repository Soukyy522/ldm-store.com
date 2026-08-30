(function(){
    "use strict";

    const DB_NAME = "locdailymar-offline-v16";
    const DB_VERSION = 1;
    const STORE_NAME = "operations";
    const LEASE_KEY = "ldmOfflineLeaseV16";
    const LAST_SYNC_KEY = "ldmOfflineLastSyncAt";
    const RESERVATION_KEY = "ldmOfflineStockReservationsV16";
    const MAX_LEASE_AGE_MS = 12 * 60 * 60 * 1000;
    const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
    const ALLOWED_OFFLINE_PAGES = new Set(["kasir.html"]);

    let dbPromise = null;
    let syncPromise = null;
    let reconnectTimer = null;
    let widget = null;

    function now(){
        return Date.now();
    }

    function pageName(){
        return String(location.pathname.split("/").pop() || "index.html")
            .toLowerCase();
    }

    function uuid(){
        if(window.crypto && typeof window.crypto.randomUUID === "function"){
            return window.crypto.randomUUID();
        }

        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
        return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
    }

    function clone(value){
        return JSON.parse(JSON.stringify(value));
    }

    function openDatabase(){
        if(dbPromise){
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(){
                const db = request.result;
                if(!db.objectStoreNames.contains(STORE_NAME)){
                    const store = db.createObjectStore(STORE_NAME, {keyPath:"queue_id"});
                    store.createIndex("status", "status", {unique:false});
                    store.createIndex("created_at_ms", "created_at_ms", {unique:false});
                    store.createIndex("identity", ["store_id","user_id","client_device_id"], {unique:false});
                    store.createIndex("client_transaction_id", "client_transaction_id", {unique:true});
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("IndexedDB tidak dapat dibuka."));
            request.onblocked = () => reject(new Error("Upgrade IndexedDB terblokir tab lain. Tutup tab LocDailyMar lain lalu coba lagi."));
        });

        return dbPromise;
    }

    async function runStore(mode, executor){
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, mode);
            const store = transaction.objectStore(STORE_NAME);
            let result;

            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error || new Error("Operasi IndexedDB gagal."));
            transaction.onabort = () => reject(transaction.error || new Error("Operasi IndexedDB dibatalkan."));

            try{
                result = executor(store, transaction);
            }catch(error){
                transaction.abort();
                reject(error);
            }
        });
    }

    async function put(item){
        await runStore("readwrite", store => store.put(item));
        return item;
    }

    async function remove(queueId){
        await runStore("readwrite", store => store.delete(queueId));
    }

    async function all(){
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, "readonly");
            const request = transaction.objectStore(STORE_NAME).getAll();
            request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
            request.onerror = () => reject(request.error || new Error("Antrean offline gagal dibaca."));
        });
    }

    function cachedIdentity(){
        if(window.LDMCloudSession && typeof window.LDMCloudSession.getCachedIdentity === "function"){
            return window.LDMCloudSession.getCachedIdentity();
        }

        return {
            source: localStorage.getItem("ldmAuthSource"),
            username: localStorage.getItem("username"),
            role: localStorage.getItem("userRole"),
            userId: localStorage.getItem("ldmCloudUserId"),
            storeId: localStorage.getItem("ldmCloudStoreId"),
            storeCode: localStorage.getItem("ldmCloudStoreCode")
        };
    }

    function currentClientDeviceId(){
        if(window.LDMCloudAuth && typeof window.LDMCloudAuth.getOrCreateDeviceId === "function"){
            return window.LDMCloudAuth.getOrCreateDeviceId();
        }
        return localStorage.getItem("ldmCloudDeviceId") || "";
    }

    function readLease(){
        try{
            const parsed = JSON.parse(localStorage.getItem(LEASE_KEY) || "null");
            return parsed && typeof parsed === "object" ? parsed : null;
        }catch(error){
            return null;
        }
    }

    function clearLease(){
        localStorage.removeItem(LEASE_KEY);
    }

    function rememberVerifiedContext(context, deviceAccess){
        if(!context || !context.user || !context.profile || !deviceAccess){
            return false;
        }

        if(String(deviceAccess.status || "").toLowerCase() !== "active"){
            clearLease();
            return false;
        }

        const verifiedAt = now();
        const lease = {
            version: 16,
            user_id: String(context.user.id || ""),
            username: String(context.profile.username || ""),
            role: String(context.profile.role || "").toLowerCase(),
            store_id: String(context.profile.store_id || ""),
            store_code: String(context.profile.store_code || ""),
            store_name: String(context.profile.store_name || ""),
            client_device_id: String(deviceAccess.client_device_id || currentClientDeviceId()),
            device_id: String(deviceAccess.device_id || ""),
            device_status: "active",
            verified_at_ms: verifiedAt,
            expires_at_ms: verifiedAt + MAX_LEASE_AGE_MS
        };

        if(!lease.user_id || !lease.store_id || !lease.client_device_id){
            return false;
        }

        localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
        return true;
    }

    function validLease(){
        const lease = readLease();
        const identity = cachedIdentity();

        if(!lease || lease.version !== 16 || lease.device_status !== "active"){
            return null;
        }
        if(Number(lease.expires_at_ms || 0) <= now()){
            return null;
        }
        if(String(identity.userId || "") !== String(lease.user_id || "")){
            return null;
        }
        if(String(identity.storeId || "") !== String(lease.store_id || "")){
            return null;
        }
        if(String(currentClientDeviceId()) !== String(lease.client_device_id || "")){
            return null;
        }
        return lease;
    }

    function errorText(error){
        return String(error && (error.message || error.details || error.hint) || error || "");
    }

    function isRetryableNetworkError(error){
        if(navigator.onLine === false){
            return true;
        }

        const status = Number(error && (error.status || error.statusCode) || 0);
        if(status === 0 || status === 408 || status === 425 || status === 429 || status >= 500){
            return true;
        }

        return /failed to fetch|networkerror|network request|load failed|fetch failed|connection|timeout|socket|offline|ERR_INTERNET_DISCONNECTED/i
            .test(errorText(error));
    }

    function offlineContextForError(error){
        if(!ALLOWED_OFFLINE_PAGES.has(pageName()) || !isRetryableNetworkError(error)){
            return null;
        }

        const lease = validLease();
        if(!lease){
            return null;
        }

        return {
            offline: true,
            lease,
            user: {id:lease.user_id},
            profile: {
                id: lease.user_id,
                username: lease.username,
                role: lease.role,
                store_id: lease.store_id,
                store_code: lease.store_code,
                store_name: lease.store_name,
                active: true
            },
            deviceAccess: {
                device_id: lease.device_id,
                client_device_id: lease.client_device_id,
                status: "active"
            }
        };
    }

    function reservationIdentity(){
        const identity = cachedIdentity();
        return [
            String(identity.storeId || ""),
            String(identity.userId || ""),
            String(currentClientDeviceId() || "")
        ].join(":");
    }

    function readReservations(){
        try{
            const value = JSON.parse(localStorage.getItem(RESERVATION_KEY) || "null");
            if(value && value.version === 2 && value.identities){
                const current = value.identities[reservationIdentity()];
                return current && current.products ? current.products : {};
            }
            // Kompatibilitas jika browser sempat memakai build awal Tahap 16.
            if(value && value.identity === reservationIdentity() && value.products){
                return value.products;
            }
            return {};
        }catch(error){
            return {};
        }
    }

    function writeReservations(products){
        let value;
        try{
            value = JSON.parse(localStorage.getItem(RESERVATION_KEY) || "null");
        }catch(error){
            value = null;
        }
        if(!value || value.version !== 2 || !value.identities){
            value = {version:2,identities:{}};
        }
        value.identities[reservationIdentity()] = {
            updated_at_ms:now(),
            products:products || {}
        };
        localStorage.setItem(RESERVATION_KEY, JSON.stringify(value));
    }

    function addReservations(items){
        const reservations = readReservations();
        (Array.isArray(items) ? items : []).forEach(item => {
            const productId = String(item.product_id || item.productId || item.id || "");
            if(!productId){
                return;
            }
            reservations[productId] = (Number(reservations[productId]) || 0) + Math.max(0,Number(item.qty) || 0);
        });
        writeReservations(reservations);
    }

    function rebuildReservations(rows){
        const reservations = {};
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const items = row.rpc_payload && row.rpc_payload.p_items || [];
            items.forEach(item => {
                const productId = String(item.product_id || "");
                if(productId){
                    reservations[productId] = (Number(reservations[productId]) || 0) + Math.max(0,Number(item.qty) || 0);
                }
            });
        });
        writeReservations(reservations);
    }

    function applyReservationsToProducts(products){
        const reservations = readReservations();
        return (Array.isArray(products) ? products : []).map(product => {
            const qty = Math.max(0,Number(reservations[String(product.id || "")]) || 0);
            if(qty > 0){
                product.stok = Math.max(0,(Number(product.stok) || 0) - qty);
                product._offlineReservedQty = qty;
            }else{
                delete product._offlineReservedQty;
            }
            return product;
        });
    }

    function applyLocalStockDelta(items){
        let products;
        try{
            products = JSON.parse(localStorage.getItem("dataBarang") || "[]");
        }catch(error){
            products = [];
        }
        if(!Array.isArray(products)){
            products = [];
        }

        (Array.isArray(items) ? items : []).forEach(item => {
            const productId = String(item.product_id || item.productId || item.id || "");
            const product = products.find(row => String(row.id || row.productId || "") === productId);
            if(!product){
                return;
            }
            const qty = Math.max(0, Number(item.qty) || 0);
            product.stok = Math.max(0, (Number(product.stok) || 0) - qty);
            product._offlineReservedQty = (Number(product._offlineReservedQty) || 0) + qty;
        });

        localStorage.setItem("dataBarang", JSON.stringify(products));
        window.dispatchEvent(new CustomEvent("ldm-products-cache-updated", {detail:{offline:true,count:products.length}}));
    }

    async function enqueueSale(input){
        const lease = validLease();
        if(!lease){
            throw new Error("Mode offline belum diizinkan. Perangkat harus pernah login online dan berstatus aktif dalam 12 jam terakhir.");
        }

        if(String(input.user_id || "") !== lease.user_id || String(input.store_id || "") !== lease.store_id){
            throw new Error("Identitas transaksi offline tidak sesuai dengan lease perangkat.");
        }
        if(String(input.client_device_id || "") !== lease.client_device_id){
            throw new Error("Perangkat transaksi offline tidak sesuai dengan lease aktif.");
        }

        const timestamp = now();
        const item = {
            queue_id: input.queue_id || uuid(),
            operation_type: "sale",
            client_transaction_id: String(input.client_transaction_id || ""),
            store_id: lease.store_id,
            user_id: lease.user_id,
            username: lease.username,
            client_device_id: lease.client_device_id,
            queued_at: input.queued_at || new Date(timestamp).toISOString(),
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            next_attempt_at_ms: timestamp,
            attempt_count: 0,
            status: "pending",
            last_error: null,
            rpc_payload: clone(input.rpc_payload || {}),
            display_snapshot: clone(input.display_snapshot || {})
        };

        if(!item.client_transaction_id){
            throw new Error("client_transaction_id antrean offline kosong.");
        }

        await put(item);
        addReservations(item.rpc_payload.p_items || []);
        applyLocalStockDelta(item.rpc_payload.p_items || []);
        await notifyChanged();
        requestBackgroundSync();
        return item;
    }

    async function stats(){
        const rows = await all();
        const identity = cachedIdentity();
        const current = rows.filter(row =>
            String(row.store_id) === String(identity.storeId || "") &&
            String(row.user_id) === String(identity.userId || "") &&
            String(row.client_device_id) === String(currentClientDeviceId())
        );
        const counts = {total:current.length,pending:0,syncing:0,synced:0,failed:0,conflict:0,blocked:0,discarded:0};
        current.forEach(row => {
            if(Object.prototype.hasOwnProperty.call(counts, row.status)){
                counts[row.status] += 1;
            }
        });
        counts.unsynced = counts.pending + counts.syncing + counts.failed + counts.conflict + counts.blocked;
        return counts;
    }

    async function currentRows(){
        const rows = await all();
        const identity = cachedIdentity();
        return rows
            .filter(row =>
                String(row.store_id) === String(identity.storeId || "") &&
                String(row.user_id) === String(identity.userId || "") &&
                String(row.client_device_id) === String(currentClientDeviceId())
            )
            .sort((a,b) => Number(a.created_at_ms) - Number(b.created_at_ms));
    }

    function classifyFailure(error){
        const message = errorText(error);
        if(isRetryableNetworkError(error)){
            return "pending";
        }
        if(/OFFLINE_CONFLICT|stok .*tidak cukup|total offline|harga|promo|diskon|absen|closing shift|end of day|sudah FINAL/i.test(message)){
            return "conflict";
        }
        if(/perangkat.*tidak aktif|device.*tidak aktif|store_id.*tidak sesuai|user.*tidak sesuai|profile.*tidak valid|session|JWT|not authenticated/i.test(message)){
            return "blocked";
        }
        return "failed";
    }

    async function mark(item, status, error){
        const updated = Object.assign({}, item, {
            status,
            updated_at_ms: now(),
            last_error: error ? errorText(error).slice(0,1000) : null
        });
        if(status === "pending"){
            updated.next_attempt_at_ms = now() + Math.min(5 * 60 * 1000, Math.pow(2, Math.min(updated.attempt_count || 1, 8)) * 1000);
        }
        await put(updated);
        return updated;
    }

    async function payloadDigest(value){
        const text = JSON.stringify(value || {});
        if(window.crypto && window.crypto.subtle && window.TextEncoder){
            const bytes = new TextEncoder().encode(text);
            const digest = await window.crypto.subtle.digest("SHA-256", bytes);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
        }
        let hash = 2166136261;
        for(let index=0; index<text.length; index+=1){
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash,16777619);
        }
        return `fnv1a-${(hash>>>0).toString(16).padStart(8,"0")}`;
    }

    function conflictTypeForStatus(status){
        if(status === "conflict") return "business_conflict";
        if(status === "blocked") return "blocked";
        return "failed";
    }

    async function recordCloudConflict(item,status,error){
        if(!navigator.onLine || !["conflict","blocked","failed"].includes(status)) return item;
        const supabase = window.LDMSupabase && window.LDMSupabase.createClient();
        if(!supabase) return item;
        const snapshot = item.display_snapshot || {};
        const {data,error:rpcError} = await supabase.rpc("ldm_record_sync_conflict",{
            p_client_device_id:item.client_device_id,
            p_queue_id:item.queue_id,
            p_client_transaction_id:item.client_transaction_id,
            p_conflict_type:conflictTypeForStatus(status),
            p_error_message:errorText(error).slice(0,1000),
            p_queued_at:item.queued_at,
            p_payload_digest:await payloadDigest(item.rpc_payload),
            p_snapshot:{
                transaction_code:snapshot.transaction_code || null,
                grand_total:Number(snapshot.grand_total || item.rpc_payload?.p_expected_grand_total || 0),
                item_count:Array.isArray(item.rpc_payload?.p_items) ? item.rpc_payload.p_items.length : 0,
                payment_method:item.rpc_payload?.p_payment_method || null,
                attempt_count:Number(item.attempt_count || 0)
            }
        });
        if(rpcError) throw rpcError;
        const updated = Object.assign({},item,{cloud_conflict_id:String(data || item.cloud_conflict_id || "")});
        await put(updated);
        return updated;
    }

    async function markCloudRecovered(item){
        if(!navigator.onLine || !window.LDMSupabase) return;
        try{
            const {error} = await window.LDMSupabase.createClient().rpc("ldm_mark_sync_conflict_recovered",{
                p_client_transaction_id:item.client_transaction_id,
                p_cloud_transaction_id:item.cloud_transaction_id || null
            });
            if(error && !/ldm_mark_sync_conflict_recovered|schema cache/i.test(errorText(error))) throw error;
        }catch(error){
            console.warn("Penutupan conflict cloud ditunda:",errorText(error));
        }
    }

    async function verifyReconnectIdentity(){
        if(!navigator.onLine){
            throw new Error("Perangkat masih offline.");
        }
        if(!window.LDMCloudSession || !window.LDMCloudAuth){
            throw new Error("Helper Cloud Auth belum tersedia.");
        }

        const context = await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        const access = await window.LDMCloudAuth.getCurrentDeviceAccess();
        if(String(access && access.status || "").toLowerCase() !== "active"){
            throw new Error("Perangkat tidak aktif. Sinkronisasi dihentikan sampai Owner menyetujuinya kembali.");
        }
        rememberVerifiedContext(context, access);
        return {context, access};
    }

    async function sendSale(item){
        const supabase = window.LDMSupabase.createClient();
        const payload = item.rpc_payload || {};
        const {data,error} = await supabase.rpc("ldm_sync_offline_sale", {
            p_client_device_id: item.client_device_id,
            p_queued_store_id: item.store_id,
            p_queued_user_id: item.user_id,
            p_queued_at: item.queued_at,
            p_client_transaction_id: item.client_transaction_id,
            p_items: payload.p_items,
            p_manual_discount: payload.p_manual_discount,
            p_payment_method: payload.p_payment_method,
            p_cash_received: payload.p_cash_received,
            p_cash_amount: payload.p_cash_amount,
            p_qris_amount: payload.p_qris_amount,
            p_shift_label: payload.p_shift_label,
            p_expected_grand_total: payload.p_expected_grand_total
        });
        if(error){
            throw error;
        }
        if(!data || !data.id){
            throw new Error("Server tidak mengembalikan hasil sinkronisasi transaksi yang valid.");
        }
        return data;
    }

    async function refreshProductsAfterSync(){
        const pending = (await currentRows()).filter(row => !["synced","discarded"].includes(row.status));
        rebuildReservations(pending);

        if(!window.LDMProducts || typeof window.LDMProducts.refreshCache !== "function"){
            return;
        }
        try{
            await window.LDMProducts.refreshCache();
        }catch(error){
            console.warn("Refresh stok setelah reconnect gagal:", error);
        }
    }

    async function cleanup(){
        const cutoff = now() - SYNCED_RETENTION_MS;
        const rows = await all();
        for(const row of rows){
            if(["synced","discarded"].includes(row.status) && Number(row.updated_at_ms || 0) < cutoff){
                await remove(row.queue_id);
            }
        }
    }

    async function performSync(options){
        const force = Boolean(options && options.force);
        let verified;
        try{
            verified = await verifyReconnectIdentity();
        }catch(identityError){
            const identity = cachedIdentity();
            const affected = (await all()).filter(row =>
                String(row.store_id) === String(identity.storeId || "") &&
                String(row.user_id) === String(identity.userId || "") &&
                String(row.client_device_id) === String(currentClientDeviceId()) &&
                !["synced","discarded"].includes(row.status)
            );
            for(const row of affected){
                let blocked = await mark(row,"blocked",identityError);
                try{ blocked = await recordCloudConflict(blocked,"blocked",identityError); }
                catch(recordError){ console.warn("Conflict identity belum tercatat di cloud:",errorText(recordError)); }
            }
            await notifyChanged();
            throw identityError;
        }
        const identity = cachedIdentity();
        const rows = (await all())
            .filter(row =>
                String(row.store_id) === String(identity.storeId || "") &&
                String(row.user_id) === String(identity.userId || "") &&
                String(row.client_device_id) === String(currentClientDeviceId()) &&
                !["synced","discarded"].includes(row.status)
            )
            .sort((a,b) => Number(a.created_at_ms) - Number(b.created_at_ms));

        let synced = 0;
        let stoppedByNetwork = false;

        for(let item of rows){
            if(!force && ["conflict","blocked","failed"].includes(item.status)){
                continue;
            }
            if(!force && Number(item.next_attempt_at_ms || 0) > now()){
                continue;
            }
            if(String(item.store_id) !== String(verified.context.profile.store_id) || String(item.user_id) !== String(verified.context.user.id)){
                await mark(item, "blocked", new Error("Identitas antrean berbeda dari akun/store yang sedang login."));
                continue;
            }

            item = Object.assign({}, item, {
                status:"syncing",
                attempt_count:(Number(item.attempt_count) || 0) + 1,
                updated_at_ms:now(),
                last_error:null
            });
            await put(item);
            await notifyChanged();

            try{
                const cloudResult = await sendSale(item);
                const completed = Object.assign({}, item, {
                    status:"synced",
                    updated_at_ms:now(),
                    synced_at:new Date().toISOString(),
                    cloud_transaction_id:cloudResult.id,
                    cloud_transaction_code:cloudResult.transaction_code,
                    last_error:null
                });
                await put(completed);
                await markCloudRecovered(completed);
                synced += 1;
                window.dispatchEvent(new CustomEvent("ldm-offline-sale-synced", {
                    detail:{queueItem:clone(completed),cloudResult:clone(cloudResult)}
                }));
            }catch(error){
                const status = classifyFailure(error);
                let failed = await mark(item, status, error);
                if(["conflict","blocked","failed"].includes(status)){
                    try{
                        failed = await recordCloudConflict(failed,status,error);
                    }catch(recordError){
                        failed = Object.assign({},failed,{cloud_record_error:errorText(recordError).slice(0,500)});
                        await put(failed);
                    }
                }
                window.dispatchEvent(new CustomEvent("ldm-offline-sale-sync-error", {
                    detail:{queueItem:clone(failed),status,message:errorText(error)}
                }));
                if(status === "pending"){
                    stoppedByNetwork = true;
                    break;
                }
            }
        }

        if(synced > 0){
            localStorage.setItem(LAST_SYNC_KEY, String(now()));
            await refreshProductsAfterSync();
        }
        await cleanup();
        await notifyChanged();
        return {synced,stoppedByNetwork,remaining:(await stats()).unsynced};
    }

    async function rowForCurrentIdentity(queueId){
        const rows = await currentRows();
        const row = rows.find(item => String(item.queue_id) === String(queueId));
        if(!row) throw new Error("Antrean tidak ditemukan pada akun dan perangkat ini.");
        return row;
    }

    async function ensureConflictRecorded(item){
        if(item.cloud_conflict_id) return item;
        return recordCloudConflict(item,["conflict","blocked","failed"].includes(item.status)?item.status:"failed",item.last_error || "Pemulihan manual diminta.");
    }

    async function retryItem(queueId,options={}){
        if(!navigator.onLine) throw new Error("Retry membutuhkan koneksi internet.");
        let item = await rowForCurrentIdentity(queueId);
        if(["synced","discarded","syncing"].includes(item.status)) throw new Error(`Status ${item.status} tidak dapat di-retry.`);
        if(["conflict","blocked","failed"].includes(item.status)){
            item = await ensureConflictRecorded(item);
            if(item.cloud_conflict_id && options.skipCloudAction !== true){
                const {error} = await window.LDMSupabase.createClient().rpc("ldm_sync_conflict_action",{
                    p_conflict_id:item.cloud_conflict_id,p_action:"retry",p_note:"Retry dari perangkat sumber."
                });
                if(error) throw error;
            }
        }
        item = Object.assign({},item,{status:"pending",last_error:null,next_attempt_at_ms:now(),updated_at_ms:now(),recovery_requested_at:new Date().toISOString()});
        await put(item);await notifyChanged();
        if(options.sync === false) return item;
        return syncNow({force:true});
    }

    async function retryByClientTransactionId(clientTransactionId,options={}){
        const item = (await currentRows()).find(row => String(row.client_transaction_id) === String(clientTransactionId));
        if(!item) return {ok:false,reason:"not-on-this-device"};
        return retryItem(item.queue_id,options);
    }

    async function discardItem(queueId,reason){
        const note = String(reason || "").trim();
        if(note.length < 5) throw new Error("Alasan discard minimal 5 karakter.");
        if(!navigator.onLine) throw new Error("Discard harus dilakukan saat online agar tercatat di cloud.");
        const verified = await verifyReconnectIdentity();
        if(String(verified.context.profile.role || "").toLowerCase() !== "owner") throw new Error("Hanya Owner yang dapat membatalkan antrean konflik.");
        let item = await rowForCurrentIdentity(queueId);
        if(["synced","discarded","syncing"].includes(item.status)) throw new Error(`Status ${item.status} tidak dapat di-discard.`);
        item = await ensureConflictRecorded(item);
        if(!item.cloud_conflict_id) throw new Error("Conflict cloud belum berhasil dibuat.");
        const {error} = await window.LDMSupabase.createClient().rpc("ldm_sync_conflict_action",{
            p_conflict_id:item.cloud_conflict_id,p_action:"discard",p_note:note
        });
        if(error) throw error;
        const discarded = Object.assign({},item,{status:"discarded",discard_reason:note,discarded_at:new Date().toISOString(),updated_at_ms:now(),last_error:null});
        await put(discarded);
        await refreshProductsAfterSync();
        await notifyChanged();
        return discarded;
    }

    async function applyRemoteDiscard(clientTransactionId,reason){
        const item = (await currentRows()).find(row => String(row.client_transaction_id) === String(clientTransactionId));
        if(!item) return {ok:false,reason:"not-on-this-device"};
        if(item.status === "synced") return {ok:false,reason:"already-synced"};
        if(item.status === "discarded") return {ok:true,item};
        const discarded = Object.assign({},item,{
            status:"discarded",
            discard_reason:String(reason||"Dibatalkan Owner melalui Recovery Center.").slice(0,500),
            discarded_at:new Date().toISOString(),
            updated_at_ms:now(),
            last_error:null
        });
        await put(discarded);
        await refreshProductsAfterSync();
        await notifyChanged();
        return {ok:true,item:discarded};
    }

    async function syncNow(options){
        if(syncPromise){
            return syncPromise;
        }

        const runner = async () => {
            if(navigator.locks && typeof navigator.locks.request === "function"){
                return navigator.locks.request("ldm-offline-sync-v16", {ifAvailable:true}, lock => {
                    if(!lock){
                        return {synced:0,skipped:"another_tab"};
                    }
                    return performSync(options || {});
                });
            }
            return performSync(options || {});
        };

        syncPromise = runner().finally(() => {
            syncPromise = null;
        });
        return syncPromise;
    }

    function scheduleReconnect(delay){
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            syncNow({force:false}).catch(error => {
                if(!isRetryableNetworkError(error)){
                    console.warn("Reconnect offline queue:", error);
                }
                notifyChanged();
            });
        }, Math.max(250, Number(delay) || 1000));
    }

    function requestBackgroundSync(){
        if(!navigator.serviceWorker){
            return;
        }
        navigator.serviceWorker.ready.then(registration => {
            if(registration.sync && typeof registration.sync.register === "function"){
                return registration.sync.register("ldm-offline-sales-v16");
            }
        }).catch(() => undefined);
    }

    function statusLabel(counts){
        if(!navigator.onLine){
            return `Offline — ${counts.unsynced} menunggu`;
        }
        if(counts.syncing){
            return `Menyinkronkan — ${counts.syncing}`;
        }
        if(counts.conflict || counts.blocked || counts.failed){
            return `Perlu diperiksa — ${counts.conflict + counts.blocked + counts.failed}`;
        }
        if(counts.pending){
            return `Online — ${counts.pending} menunggu`;
        }
        return "Online — Tersinkron";
    }

    function ensureWidget(){
        if(widget || pageName() !== "kasir.html" || !document.body){
            return widget;
        }

        const style = document.createElement("style");
        style.id = "ldmOfflineQueueStyle";
        style.textContent = [
            ".ldm-offline-widget{position:fixed;right:12px;bottom:12px;z-index:99990;border:0;border-radius:999px;padding:9px 13px;font:700 12px/1.2 system-ui;box-shadow:0 8px 28px #0003;cursor:pointer;color:#fff;background:#059669}",
            ".ldm-offline-widget.offline{background:#dc2626}.ldm-offline-widget.waiting{background:#d97706}.ldm-offline-widget.problem{background:#7c3aed}",
            ".ldm-offline-panel{position:fixed;inset:0;z-index:99995;background:#0008;display:flex;align-items:center;justify-content:center;padding:16px}",
            ".ldm-offline-card{width:min(680px,100%);max-height:85vh;overflow:auto;background:#fff;color:#172033;border-radius:16px;padding:18px;box-shadow:0 24px 70px #0005;font-family:system-ui}",
            ".ldm-offline-row{border:1px solid #dbe3ef;border-radius:10px;padding:10px;margin-top:8px;font-size:12px}.ldm-offline-row strong{font-size:13px}",
            ".ldm-offline-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.ldm-offline-actions button{border:0;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer}.ldm-sync-btn{background:#0f9d58;color:white}.ldm-close-btn{background:#e5e7eb;color:#172033}",
            ".ldm-offline-error{color:#b91c1c;white-space:pre-wrap;margin-top:5px}.ldm-offline-muted{color:#64748b}"
        ].join("");
        document.head.appendChild(style);

        widget = document.createElement("button");
        widget.type = "button";
        widget.className = "ldm-offline-widget";
        widget.textContent = "Memeriksa sinkronisasi…";
        widget.addEventListener("click", showPanel);
        document.body.appendChild(widget);
        return widget;
    }

    async function renderWidget(){
        const target = ensureWidget();
        if(!target){
            return;
        }
        try{
            const counts = await stats();
            target.textContent = statusLabel(counts);
            target.className = "ldm-offline-widget";
            if(!navigator.onLine){
                target.classList.add("offline");
            }else if(counts.conflict || counts.blocked || counts.failed){
                target.classList.add("problem");
            }else if(counts.unsynced){
                target.classList.add("waiting");
            }
        }catch(error){
            target.textContent = "Antrean offline bermasalah";
            target.className = "ldm-offline-widget problem";
        }
    }

    function escapeHtml(value){
        return String(value == null ? "" : value)
            .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
    }

    async function showPanel(){
        const existing = document.getElementById("ldmOfflinePanel");
        if(existing){
            existing.remove();
        }
        const rows = await currentRows();
        const panel = document.createElement("div");
        panel.id = "ldmOfflinePanel";
        panel.className = "ldm-offline-panel";
        panel.innerHTML = `<div class="ldm-offline-card"><h2 style="margin:0 0 6px">Offline Queue + Reconnect</h2><p class="ldm-offline-muted" style="margin:0">Data berstatus tersinkron/discarded disimpan 7 hari sebagai jejak lokal.</p><div id="ldmOfflineRows"></div><div class="ldm-offline-actions"><button class="ldm-sync-btn" id="ldmSyncNow">Sinkronkan Sekarang</button><button class="ldm-close-btn" id="ldmRecoveryCenter">Recovery Center</button><button class="ldm-close-btn" id="ldmClosePanel">Tutup</button></div></div>`;
        document.body.appendChild(panel);
        const list = panel.querySelector("#ldmOfflineRows");
        list.innerHTML = rows.length ? rows.map(row => {
            const snapshot = row.display_snapshot || {};
            const total = Number(snapshot.grand_total || 0).toLocaleString("id-ID");
            return `<div class="ldm-offline-row"><strong>${escapeHtml(snapshot.transaction_code || row.client_transaction_id)}</strong><br><span>Status: ${escapeHtml(row.status)} · Total Rp ${total} · Percobaan ${Number(row.attempt_count)||0}</span>${row.last_error ? `<div class="ldm-offline-error">${escapeHtml(row.last_error)}</div>` : ""}</div>`;
        }).join("") : '<p class="ldm-offline-muted">Tidak ada transaksi dalam antrean perangkat ini.</p>';
        panel.querySelector("#ldmClosePanel").onclick = () => panel.remove();
        panel.querySelector("#ldmRecoveryCenter").onclick = () => { window.location.href="recovery-center.html"; };
        panel.querySelector("#ldmSyncNow").onclick = async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = "Menyinkronkan…";
            try{
                await syncNow({force:true});
                panel.remove();
                await showPanel();
            }catch(error){
                button.disabled = false;
                button.textContent = "Coba Lagi";
                alert(errorText(error));
            }
        };
    }

    async function notifyChanged(){
        await renderWidget();
        const detail = await stats().catch(() => null);
        if(detail){
            // Salinan kecil untuk halaman yang tidak membuka IndexedDB queue.
            // PWA Manager tetap membaca IndexedDB langsung jika modul ini tersedia.
            localStorage.setItem("ldmOfflineUnsyncedCountV16", String(Number(detail.unsynced) || 0));
        }
        window.dispatchEvent(new CustomEvent("ldm-offline-queue-updated", {detail}));
    }

    function registerServiceWorker(){
        if(!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)){
            return;
        }
        if(window.LDMPWA && typeof window.LDMPWA.register === "function"){
            window.LDMPWA.register();
            return;
        }
        navigator.serviceWorker.register("service-worker.js", {scope:"./",updateViaCache:"none"})
            .catch(error => console.warn("Service Worker LocDailyMar gagal didaftarkan:", error));
    }

    function boot(){
        registerServiceWorker();
        if(navigator.storage && typeof navigator.storage.persist === "function"){
            navigator.storage.persist().catch(() => false);
        }
        const start = () => {
            ensureWidget();
            notifyChanged();
            cleanup().catch(() => undefined);
            if(navigator.onLine){
                scheduleReconnect(1500);
            }
        };
        if(document.readyState === "loading"){
            document.addEventListener("DOMContentLoaded", start, {once:true});
        }else{
            start();
        }

        window.addEventListener("online", () => {
            notifyChanged();
            scheduleReconnect(800);
        });
        window.addEventListener("offline", notifyChanged);
        window.addEventListener("storage", event => {
            if(["ldmCloudUserId","ldmCloudStoreId",LEASE_KEY].includes(event.key)){
                notifyChanged();
            }
        });
        navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", event => {
            if(event.data && event.data.type === "LDM_SYNC_REQUEST"){
                scheduleReconnect(250);
            }
        });
    }

    window.LDMOfflineQueue = Object.freeze({
        uuid,
        readLease,
        validLease,
        clearLease,
        rememberVerifiedContext,
        isRetryableNetworkError,
        offlineContextForError,
        enqueueSale,
        readReservations,
        applyReservationsToProducts,
        stats,
        list:currentRows,
        retryItem,
        retryByClientTransactionId,
        discardItem,
        applyRemoteDiscard,
        recordCloudConflict,
        syncNow,
        scheduleReconnect,
        showPanel,
        notifyChanged
    });

    boot();
})();

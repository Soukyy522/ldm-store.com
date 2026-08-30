(function(){
    "use strict";

    const KEYS = Object.freeze({
        suppliers:"dataSupplier",
        purchaseOrders:"dataPurchaseOrder",
        goodsReceipts:"dataGoodsReceipt"
    });

    const FLAGS = Object.freeze({
        suppliers:"ldmSuppliersCloudEnabled",
        purchaseOrders:"ldmPurchaseOrdersCloudEnabled",
        goodsReceipts:"ldmGoodsReceiptsCloudEnabled"
    });

    const LAST_SYNC_KEY = "ldmProcurementLastSyncAt";
    const CHANNEL = "ldm-procurement-realtime-v11";

    let channel = null;
    let refreshTimer = null;

    function client(){
        if(
            !window.LDMSupabase ||
            typeof window.LDMSupabase.createClient !== "function"
        ){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    async function ensureAuth(){
        if(!window.LDMCloudSession){
            throw new Error("Cloud Session belum tersedia.");
        }
        return await window.LDMCloudSession.ensureAuthenticated({
            registerDevice:false
        });
    }

    function safeArray(key){
        try{
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        }catch(error){
            return [];
        }
    }

    function isEnabled(flag){
        return localStorage.getItem(flag) === "true";
    }

    function hasLegacy(key){
        return safeArray(key).some(row => row && !row._cloud);
    }

    function createUUID(){
        if(window.crypto && typeof window.crypto.randomUUID === "function"){
            return window.crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const h = Array.from(bytes).map(v => v.toString(16).padStart(2,"0")).join("");
        return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");
    }

    function normalizeName(value){
        return String(value || "")
            .normalize("NFKC")
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g,"")
            .replace(/\s+/g," ")
            .trim()
            .toLowerCase();
    }

    function isoTime(value){
        if(!value) return "";
        const date = new Date(value);
        if(!Number.isFinite(date.getTime())) return "";
        return new Intl.DateTimeFormat("id-ID",{
            timeZone:"Asia/Makassar",
            hour:"2-digit",
            minute:"2-digit",
            second:"2-digit",
            hour12:false
        }).format(date).replace(/\./g,":");
    }

    function supplierRowToLegacy(row){
        return {
            id:row.id,
            kode:row.code || "",
            nama:row.name || "",
            sales:row.contact_person || "",
            telepon:row.phone || "",
            whatsapp:row.whatsapp || "",
            email:row.email || "",
            alamat:row.address || "",
            tempoHari:Number(row.payment_term_days || 0),
            kategori:row.category || "",
            catatan:row.note || "",
            aktif:row.active !== false,
            createdAt:row.created_at || null,
            updatedAt:row.updated_at || null,
            _cloud:{
                id:row.id,
                version:Number(row.version || 1)
            }
        };
    }

    function poRowToLegacy(row,items){
        const mappedItems = (items || []).map(item => ({
            id:item.id,
            productId:item.product_id,
            keyBarang:item.barcode_snapshot || item.product_id || item.id,
            barangIndex:findProductIndex(item.product_id,item.barcode_snapshot),
            barcode:item.barcode_snapshot || "",
            namaBarang:item.product_name_snapshot || "Barang",
            kategori:item.category_snapshot || "",
            satuan:item.purchase_unit_snapshot || item.unit_snapshot || "Pcs",
            satuanDasar:item.unit_snapshot || "Pcs",
            faktorKonversi:Number(item.unit_factor_snapshot || 1),
            stokSnapshot:Number(item.stock_snapshot || 0),
            qtyOrdered:Number(item.purchase_qty_ordered ?? (Number(item.qty_ordered || 0) / Number(item.unit_factor_snapshot || 1))),
            qtyOrderedBase:Number(item.qty_ordered || 0),
            qtyReceived:Number(item.purchase_qty_received ?? (Number(item.qty_received || 0) / Number(item.unit_factor_snapshot || 1))),
            qtyReceivedBase:Number(item.qty_received || 0),
            hargaBeli:Number(item.package_purchase_price ?? (Number(item.purchase_price || 0) * Number(item.unit_factor_snapshot || 1))),
            hargaBeliDasar:Number(item.purchase_price || 0),
            subtotal:Number(item.line_subtotal || 0),
            _cloud:{id:item.id}
        }));

        return {
            id:row.id,
            nomorPO:row.po_number,
            tanggal:row.order_date,
            estimasiTiba:row.estimated_arrival || "",
            supplierId:row.supplier_id,
            supplier:row.supplier_name_snapshot || "",
            kontakSupplier:row.supplier_contact_snapshot || "",
            referensi:row.reference || "",
            catatan:row.note || "",
            status:row.status,
            approvalStatus:row.approval_status || "",
            approvedBy:row.approved_username || "",
            approvedAt:row.approved_at || "",
            petugas:row.created_username || "-",
            rolePetugas:row.created_role || "-",
            createdAt:row.created_at || null,
            updatedAt:row.updated_at || null,
            totalJenis:Number(row.total_item_types || mappedItems.length),
            totalQty:mappedItems.reduce((sum,item) => sum + Number(item.qtyOrdered || 0),0),
            totalQtyBase:Number(row.total_qty || 0),
            totalReceived:mappedItems.reduce((sum,item) => sum + Number(item.qtyReceived || 0),0),
            totalReceivedBase:Number(row.total_received || 0),
            totalNilai:Number(row.total_value || 0),
            legacyImported:Boolean(row.legacy_imported),
            historyOnly:Boolean(row.history_only),
            items:mappedItems,
            _cloud:{
                id:row.id,
                clientId:row.client_po_id,
                version:Number(row.version || 1)
            }
        };
    }

    function grRowToLegacy(row,items){
        const mappedItems = (items || []).map(item => ({
            id:item.id,
            productId:item.product_id,
            barangIndex:findProductIndex(item.product_id,item.barcode_snapshot),
            barcode:item.barcode_snapshot || "",
            namaBarang:item.product_name_snapshot || "Barang",
            kategori:item.category_snapshot || "",
            satuan:item.purchase_unit_snapshot || item.unit_snapshot || "Pcs",
            satuanDasar:item.unit_snapshot || "Pcs",
            faktorKonversi:Number(item.unit_factor_snapshot || 1),
            stokSebelum:item.stock_before === null ? 0 : Number(item.stock_before || 0),
            qtyDiterima:Number(item.purchase_qty_received ?? (Number(item.qty_received || 0) / Number(item.unit_factor_snapshot || 1))),
            qtyDiterimaBase:Number(item.qty_received || 0),
            stokSesudah:item.stock_after === null ? 0 : Number(item.stock_after || 0),
            hargaBeliSebelum:Number(item.purchase_price_before || 0),
            hargaBeli:Number(item.package_purchase_price ?? (Number(item.purchase_price || 0) * Number(item.unit_factor_snapshot || 1))),
            hargaBeliDasar:Number(item.purchase_price || 0),
            subtotal:Number(item.line_subtotal || 0),
            expiredDate:item.expiry_date || "",
            _cloud:{id:item.id}
        }));

        return {
            id:row.id,
            nomorGR:row.gr_number,
            tanggal:row.business_date,
            createdAt:row.created_at || row.received_at || null,
            waktu:isoTime(row.received_at || row.created_at),
            supplierId:row.supplier_id,
            supplier:row.supplier_name_snapshot || "",
            suratJalan:row.delivery_note_number || "",
            purchaseOrderId:row.purchase_order_id || null,
            purchaseOrderNo:row.purchase_order_number_snapshot || "",
            catatan:row.note || "",
            petugas:row.created_username || "-",
            rolePetugas:row.created_role || "-",
            status:row.status,
            approvalStatus:row.approval_status || "",
            approvedBy:row.approved_username || "",
            approvedAt:row.approved_at || "",
            cancelledBy:row.cancelled_username || "",
            cancelledAt:row.cancelled_at || "",
            totalJenis:Number(row.total_item_types || mappedItems.length),
            totalQty:mappedItems.reduce((sum,item) => sum + Number(item.qtyDiterima || 0),0),
            totalQtyBase:Number(row.total_qty || 0),
            totalNilai:Number(row.total_value || 0),
            stockEffectApplied:Boolean(row.stock_effect_applied),
            stockEffectReversed:Boolean(row.stock_effect_reversed),
            legacyImported:Boolean(row.legacy_imported),
            historyOnly:Boolean(row.history_only),
            items:mappedItems,
            _cloud:{
                id:row.id,
                clientId:row.client_gr_id,
                version:Number(row.version || 1)
            }
        };
    }

    function findProductIndex(productId,barcode){
        const products = safeArray("dataBarang");
        let index = products.findIndex(row => String(row.id || "") === String(productId || ""));
        if(index < 0 && barcode){
            index = products.findIndex(row => String(row.barcode || "") === String(barcode));
        }
        return index;
    }

    function resolveProductId(item){
        const direct = item && (item.productId || item.product_id);
        if(direct && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(direct))){
            return String(direct);
        }

        const products = safeArray("dataBarang");
        const barcode = String(item && item.barcode || "").trim();
        if(barcode){
            const byBarcode = products.find(row => String(row.barcode || "").trim() === barcode);
            if(byBarcode && byBarcode.id) return String(byBarcode.id);
        }

        const index = Number(item && item.barangIndex);
        if(Number.isInteger(index) && products[index] && products[index].id){
            return String(products[index].id);
        }

        const wanted = normalizeName(item && (item.namaBarang || item.nama || item.name));
        const byName = products.find(row => normalizeName(row.nama) === wanted);
        if(byName && byName.id) return String(byName.id);

        throw new Error(`Barang ${item && (item.namaBarang || item.nama) || "-"} belum mempunyai UUID cloud.`);
    }

    function resolveSupplierByName(name){
        const wanted = normalizeName(name);
        return safeArray(KEYS.suppliers).find(
            row => row && row.aktif !== false && normalizeName(row.nama) === wanted
        ) || null;
    }

    function setCache(key,flag,rows,force){
        if(!force && !isEnabled(flag) && hasLegacy(key) && rows.length === 0){
            return safeArray(key);
        }
        localStorage.setItem(key,JSON.stringify(rows));
        localStorage.setItem(flag,"true");
        localStorage.setItem(LAST_SYNC_KEY,String(Date.now()));
        return rows;
    }

    function dispatch(section,count){
        window.dispatchEvent(new CustomEvent("ldm-procurement-cache-updated",{
            detail:{section,count}
        }));
    }

    async function refreshSuppliers(options={}){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase
            .from("suppliers")
            .select("id,store_id,code,name,contact_person,phone,whatsapp,email,address,payment_term_days,category,note,active,created_at,updated_at,version")
            .order("name",{ascending:true});
        if(error) throw error;
        const rows = (data || []).map(supplierRowToLegacy);
        const cache = setCache(KEYS.suppliers,FLAGS.suppliers,rows,options.force === true);
        dispatch("suppliers",cache.length);
        return cache;
    }

    async function refreshPurchaseOrders(options={}){
        await ensureAuth();
        const supabase = client();
        const [{data:headers,error:headerError},{data:items,error:itemError}] = await Promise.all([
            supabase.from("purchase_orders")
                .select("id,store_id,client_po_id,po_number,order_date,estimated_arrival,supplier_id,supplier_name_snapshot,supplier_contact_snapshot,reference,note,status,approval_status,created_username,created_role,approved_username,approved_at,total_item_types,total_qty,total_received,total_value,legacy_imported,history_only,created_at,updated_at,version")
                .order("created_at",{ascending:false})
                .limit(2000),
            supabase.from("purchase_order_items")
                .select("id,purchase_order_id,product_id,product_name_snapshot,barcode_snapshot,category_snapshot,unit_snapshot,purchase_unit_snapshot,unit_factor_snapshot,stock_snapshot,qty_ordered,qty_received,purchase_qty_ordered,purchase_qty_received,purchase_price,package_purchase_price,line_subtotal,legacy_item_id")
                .limit(10000)
        ]);
        if(headerError) throw headerError;
        if(itemError) throw itemError;
        const grouped = new Map();
        (items || []).forEach(item => {
            const list = grouped.get(item.purchase_order_id) || [];
            list.push(item);
            grouped.set(item.purchase_order_id,list);
        });
        const rows = (headers || []).map(row => poRowToLegacy(row,grouped.get(row.id) || []));
        const cache = setCache(KEYS.purchaseOrders,FLAGS.purchaseOrders,rows,options.force === true);
        dispatch("purchaseOrders",cache.length);
        return cache;
    }

    async function refreshGoodsReceipts(options={}){
        await ensureAuth();
        const supabase = client();
        const [{data:headers,error:headerError},{data:items,error:itemError}] = await Promise.all([
            supabase.from("goods_receipts")
                .select("id,store_id,client_gr_id,gr_number,business_date,received_at,supplier_id,supplier_name_snapshot,delivery_note_number,purchase_order_id,purchase_order_number_snapshot,note,status,approval_status,created_username,created_role,approved_username,approved_at,cancelled_username,cancelled_at,total_item_types,total_qty,total_value,stock_effect_applied,stock_effect_reversed,legacy_imported,history_only,created_at,updated_at,version")
                .order("created_at",{ascending:false})
                .limit(2000),
            supabase.from("goods_receipt_items")
                .select("id,goods_receipt_id,product_id,purchase_order_item_id,product_name_snapshot,barcode_snapshot,category_snapshot,unit_snapshot,purchase_unit_snapshot,unit_factor_snapshot,qty_received,purchase_qty_received,purchase_price_before,purchase_price,package_purchase_price,line_subtotal,expiry_date,stock_before,stock_after,stock_effect_applied,legacy_item_id")
                .limit(10000)
        ]);
        if(headerError) throw headerError;
        if(itemError) throw itemError;
        const grouped = new Map();
        (items || []).forEach(item => {
            const list = grouped.get(item.goods_receipt_id) || [];
            list.push(item);
            grouped.set(item.goods_receipt_id,list);
        });
        const rows = (headers || []).map(row => grRowToLegacy(row,grouped.get(row.id) || []));
        const cache = setCache(KEYS.goodsReceipts,FLAGS.goodsReceipts,rows,options.force === true);
        dispatch("goodsReceipts",cache.length);
        return cache;
    }

    async function refreshAll(options={}){
        const suppliers = await refreshSuppliers(options);
        const purchaseOrders = await refreshPurchaseOrders(options);
        const goodsReceipts = await refreshGoodsReceipts(options);
        return {suppliers,purchaseOrders,goodsReceipts};
    }

    function assertMigrated(section){
        const key = KEYS[section];
        const flag = FLAGS[section];
        if(!isEnabled(flag) && hasLegacy(key)){
            throw new Error(`Data ${key} lama belum dimigrasikan. Jalankan halaman Migrasi Tahap 11 sebagai Owner terlebih dahulu.`);
        }
    }

    async function saveSupplier(payload){
        await ensureAuth();
        assertMigrated("suppliers");
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_save_supplier",{
            p_supplier_id:payload.id || null,
            p_code:payload.code || "",
            p_name:payload.name || "",
            p_contact_person:payload.contactPerson || null,
            p_phone:payload.phone || null,
            p_whatsapp:payload.whatsapp || null,
            p_email:payload.email || null,
            p_address:payload.address || null,
            p_payment_term_days:Number(payload.paymentTermDays || 0),
            p_category:payload.category || null,
            p_note:payload.note || null,
            p_active:payload.active !== false
        });
        if(error) throw error;
        localStorage.setItem(FLAGS.suppliers,"true");
        await refreshSuppliers({force:true});
        return data;
    }

    async function deleteSupplier(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_soft_delete_supplier",{p_supplier_id:id});
        if(error) throw error;
        await refreshSuppliers({force:true});
        return data;
    }

    async function savePurchaseOrder(payload){
        await ensureAuth();
        assertMigrated("purchaseOrders");
        assertMigrated("suppliers");
        const supplier = payload.supplierId
            ? safeArray(KEYS.suppliers).find(row => String(row.id) === String(payload.supplierId))
            : resolveSupplierByName(payload.supplier);
        if(!supplier) throw new Error("Supplier harus dipilih dari Master Supplier Cloud yang aktif.");

        const items = (payload.items || []).map((item,index) => ({
            product_id:resolveProductId(item),
            qty:Number(item.qtyOrderedBase ?? (Number(item.qtyOrdered || item.qty || 0) * Number(item.faktorKonversi || 1))),
            purchase_price:Number(item.hargaBeliDasar ?? (Number(item.hargaBeli || item.purchasePrice || 0) / Number(item.faktorKonversi || 1))),
            client_item_id:String(item.id || index)
        }));

        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_save_purchase_order",{
            p_purchase_order_id:payload.id || null,
            p_client_po_id:payload.clientId || createUUID(),
            p_po_number:payload.poNumber,
            p_order_date:payload.orderDate || null,
            p_estimated_arrival:payload.estimatedArrival || null,
            p_supplier_id:supplier.id,
            p_supplier_contact:payload.supplierContact || null,
            p_reference:payload.reference || null,
            p_note:payload.note || null,
            p_requested_status:payload.status || "Draft",
            p_items:items
        });
        if(error) throw error;
        localStorage.setItem(FLAGS.purchaseOrders,"true");
        await refreshPurchaseOrders({force:true});
        return data;
    }

    async function approvePurchaseOrder(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_approve_purchase_order",{p_purchase_order_id:id});
        if(error) throw error;
        await refreshPurchaseOrders({force:true});
        return data;
    }

    async function cancelPurchaseOrder(id,reason){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_cancel_purchase_order",{
            p_purchase_order_id:id,
            p_reason:reason || null
        });
        if(error) throw error;
        await refreshPurchaseOrders({force:true});
        return data;
    }

    async function deletePurchaseOrder(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_soft_delete_purchase_order",{p_purchase_order_id:id});
        if(error) throw error;
        await refreshPurchaseOrders({force:true});
        return data;
    }

    async function submitGoodsReceipt(payload){
        await ensureAuth();
        assertMigrated("goodsReceipts");
        assertMigrated("suppliers");
        const supplier = payload.supplierId
            ? safeArray(KEYS.suppliers).find(row => String(row.id) === String(payload.supplierId))
            : resolveSupplierByName(payload.supplier);
        if(!supplier) throw new Error("Supplier harus dipilih dari Master Supplier Cloud yang aktif.");

        const items = (payload.items || []).map((item,index) => ({
            product_id:resolveProductId(item),
            qty:Number(item.qtyDiterimaBase ?? (Number(item.qtyDiterima || item.qty || 0) * Number(item.faktorKonversi || 1))),
            purchase_price:Number(item.hargaBeliDasar ?? (Number(item.hargaBeli || item.purchasePrice || 0) / Number(item.faktorKonversi || 1))),
            expiry_date:item.expiredDate || null,
            client_item_id:String(item.id || index)
        }));

        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_submit_goods_receipt",{
            p_client_gr_id:payload.clientId || createUUID(),
            p_gr_number:payload.grNumber,
            p_business_date:payload.businessDate || null,
            p_supplier_id:supplier.id,
            p_delivery_note_number:payload.deliveryNote,
            p_purchase_order_id:payload.purchaseOrderId || null,
            p_note:payload.note || null,
            p_items:items
        });
        if(error) throw error;
        localStorage.setItem(FLAGS.goodsReceipts,"true");
        await refreshAll({force:true});
        if(window.LDMProducts && typeof window.LDMProducts.refreshCache === "function"){
            await window.LDMProducts.refreshCache();
        }
        return data;
    }

    async function approveGoodsReceipt(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_approve_goods_receipt",{p_goods_receipt_id:id});
        if(error) throw error;
        await refreshAll({force:true});
        if(window.LDMProducts && typeof window.LDMProducts.refreshCache === "function"){
            await window.LDMProducts.refreshCache();
        }
        return data;
    }

    async function cancelGoodsReceipt(id,reason){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_cancel_goods_receipt",{
            p_goods_receipt_id:id,
            p_reason:reason || null
        });
        if(error) throw error;
        await refreshAll({force:true});
        if(window.LDMProducts && typeof window.LDMProducts.refreshCache === "function"){
            await window.LDMProducts.refreshCache();
        }
        return data;
    }

    function legacySupplierPayload(rows){
        return (rows || []).filter(row => row && !row._cloud).map((row,index) => ({
            id:String(row.id || index),
            legacy_source_id:`supplier:${String(row.id || index)}`,
            code:row.kode || "",
            name:row.nama || "",
            contact_person:row.sales || "",
            phone:row.telepon || "",
            whatsapp:row.whatsapp || "",
            email:row.email || "",
            address:row.alamat || "",
            payment_term_days:Number(row.tempoHari || 0),
            category:row.kategori || "",
            note:row.catatan || "",
            active:row.aktif !== false,
            created_at:row.createdAt || null
        }));
    }

    function legacyPOPayload(rows){
        return (rows || []).filter(row => row && !row._cloud).map((row,index) => ({
            id:String(row.id || index),
            legacy_source_id:`po:${String(row.id || index)}`,
            po_number:row.nomorPO || "",
            order_date:row.tanggal || null,
            estimated_arrival:row.estimasiTiba || null,
            supplier:row.supplier || "",
            supplier_contact:row.kontakSupplier || "",
            reference:row.referensi || "",
            note:row.catatan || "",
            status:row.status || "Draft",
            approval_status:row.approvalStatus || "",
            created_username:row.petugas || "legacy",
            created_role:row.rolePetugas || "legacy",
            approved_username:row.approvedBy || "",
            approved_at:row.approvedAt || null,
            created_at:row.createdAt || null,
            items:(Array.isArray(row.items) ? row.items : []).map((item,itemIndex) => ({
                legacy_item_id:String(item.id || itemIndex),
                barcode:item.barcode || "",
                name:item.namaBarang || item.nama || "Legacy Item",
                category:item.kategori || "",
                unit:item.satuan || "Pcs",
                stock_snapshot:Number(item.stokSnapshot || 0),
                qty_ordered:Number(item.qtyOrdered || item.qty || 0),
                qty_received:Number(item.qtyReceived || 0),
                purchase_price:Number(item.hargaBeli || 0)
            }))
        }));
    }

    function legacyGRPayload(rows){
        return (rows || []).filter(row => row && !row._cloud).map((row,index) => ({
            id:String(row.id || index),
            legacy_source_id:`gr:${String(row.id || index)}`,
            gr_number:row.nomorGR || "",
            business_date:row.tanggal || null,
            supplier:row.supplier || "",
            delivery_note:row.suratJalan || "-",
            purchase_order_no:row.purchaseOrderNo || "",
            note:row.catatan || "",
            status:row.status || "Accepted",
            approval_status:row.approvalStatus || "",
            created_username:row.petugas || "legacy",
            created_role:row.rolePetugas || "legacy",
            approved_username:row.approvedBy || "",
            approved_at:row.approvedAt || null,
            created_at:row.createdAt || null,
            items:(Array.isArray(row.items) ? row.items : []).map((item,itemIndex) => ({
                legacy_item_id:String(item.id || itemIndex),
                barcode:item.barcode || "",
                name:item.namaBarang || item.nama || "Legacy Item",
                category:item.kategori || "",
                unit:item.satuan || "Pcs",
                qty:Number(item.qtyDiterima || item.qty || 0),
                purchase_price_before:Number(item.hargaBeliSebelum || 0),
                purchase_price:Number(item.hargaBeli || 0),
                expiry_date:item.expiredDate || null,
                stock_before:item.stokSebelum === undefined ? null : Number(item.stokSebelum),
                stock_after:item.stokSesudah === undefined ? null : Number(item.stokSesudah)
            }))
        }));
    }

    async function migrateLegacy(){
        const context = await ensureAuth();
        if(String(context.profile.role || "").toLowerCase() !== "owner"){
            throw new Error("Hanya Owner yang dapat menjalankan migrasi Tahap 11.");
        }

        const oldSuppliers = safeArray(KEYS.suppliers).filter(row => row && !row._cloud);
        const oldPO = safeArray(KEYS.purchaseOrders).filter(row => row && !row._cloud);
        const oldGR = safeArray(KEYS.goodsReceipts).filter(row => row && !row._cloud);
        const supabase = client();

        let supplierCount = 0;
        let poCount = 0;
        let grCount = 0;

        if(oldSuppliers.length){
            const {data,error} = await supabase.rpc("ldm_import_legacy_suppliers",{
                p_rows:legacySupplierPayload(oldSuppliers)
            });
            if(error) throw error;
            supplierCount = Number(data || 0);
        }
        localStorage.setItem(FLAGS.suppliers,"true");
        await refreshSuppliers({force:true});

        if(oldPO.length){
            const {data,error} = await supabase.rpc("ldm_import_legacy_purchase_orders",{
                p_rows:legacyPOPayload(oldPO)
            });
            if(error) throw error;
            poCount = Number(data || 0);
        }
        localStorage.setItem(FLAGS.purchaseOrders,"true");
        await refreshPurchaseOrders({force:true});

        if(oldGR.length){
            const {data,error} = await supabase.rpc("ldm_import_legacy_goods_receipts",{
                p_rows:legacyGRPayload(oldGR)
            });
            if(error) throw error;
            grCount = Number(data || 0);
        }
        localStorage.setItem(FLAGS.goodsReceipts,"true");
        await refreshGoodsReceipts({force:true});

        return {
            suppliers:supplierCount,
            purchaseOrders:poCount,
            goodsReceipts:grCount
        };
    }

    function scheduleRefresh(){
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            try{
                await refreshAll({force:true});
                if(window.LDMProducts && typeof window.LDMProducts.refreshCache === "function"){
                    await window.LDMProducts.refreshCache();
                }
            }catch(error){
                console.error("Realtime Procurement refresh gagal:",error);
            }
        },250);
    }

    async function startRealtime(){
        if(channel) return channel;
        const context = await ensureAuth();
        const storeId = context.profile.store_id;
        const supabase = client();
        channel = supabase.channel(CHANNEL);
        ["suppliers","purchase_orders","purchase_order_items","goods_receipts","goods_receipt_items"]
            .forEach(table => {
                channel.on("postgres_changes",{
                    event:"*",
                    schema:"public",
                    table,
                    filter:`store_id=eq.${storeId}`
                },scheduleRefresh);
            });
        channel.subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel) return;
        const supabase = client();
        await supabase.removeChannel(channel);
        channel = null;
    }

    async function bootstrap(){
        await ensureAuth();
        const result = await refreshAll({force:false});
        await startRealtime();
        return result;
    }

    window.LDMProcurement = Object.freeze({
        createUUID,
        normalizeName,
        safeArray,
        resolveSupplierByName,
        refreshSuppliers,
        refreshPurchaseOrders,
        refreshGoodsReceipts,
        refreshAll,
        saveSupplier,
        deleteSupplier,
        savePurchaseOrder,
        approvePurchaseOrder,
        cancelPurchaseOrder,
        deletePurchaseOrder,
        submitGoodsReceipt,
        approveGoodsReceipt,
        cancelGoodsReceipt,
        migrateLegacy,
        startRealtime,
        stopRealtime,
        bootstrap,
        flags:FLAGS,
        keys:KEYS
    });
})();

(function(){
    "use strict";

    const ENABLED_KEY = "ldmReportingCloudEnabled";
    const LAST_SYNC_KEY = "ldmReportingLastSyncAt";
    const EXPENSE_BUCKET = "ldm-expense-receipts";
    const CHANNEL_NAME = "ldm-reporting-realtime-v12";

    const TX_KEYS = [
        "laporan",
        "dataLaporan",
        "riwayatTransaksi",
        "laporanHistory"
    ];

    let channel = null;
    let refreshTimer = null;
    let refreshingPromise = null;

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
        if(
            !window.LDMCloudSession ||
            typeof window.LDMCloudSession.ensureAuthenticated !== "function"
        ){
            throw new Error("Cloud Session belum tersedia.");
        }

        return await window.LDMCloudSession.ensureAuthenticated({
            registerDevice:false
        });
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
            .map(value => value.toString(16).padStart(2,"0"))
            .join("");

        return [
            hex.slice(0,8),
            hex.slice(8,12),
            hex.slice(12,16),
            hex.slice(16,20),
            hex.slice(20)
        ].join("-");
    }

    function stableNumericId(value){
        const text = String(value || "");
        let hash = 2166136261;

        for(let i=0;i<text.length;i++){
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash,16777619);
        }

        return Math.abs(hash >>> 0) || 1;
    }

    function safeArray(key){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(key) || "[]"
            );
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function safeObject(key){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(key) || "{}"
            );
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : {};
        }catch(error){
            return {};
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

    function dateTimeToISO(date,time){
        const d = String(date || "").trim();
        const t = String(time || "00:00:00").trim() || "00:00:00";

        if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){
            return null;
        }

        // LocDailyMar memakai WITA (+08:00).
        return `${d}T${/^\d{2}:\d{2}:\d{2}$/.test(t) ? t : `${t}:00`}+08:00`;
    }

    function parseLegacyDate(row){
        return String(
            row && (
                row.tanggal ||
                row.business_date ||
                row.date ||
                ""
            ) || ""
        ).trim();
    }

    function parseLegacyTime(row){
        return String(
            row && (
                row.waktu ||
                row.time ||
                "00:00:00"
            ) || "00:00:00"
        ).trim();
    }

    function parseNumber(value){
        const n = Number(value || 0);
        return Number.isFinite(n) ? n : 0;
    }

    async function fetchAllRows(table,select,options = {}){
        const supabase = client();
        const pageSize = 1000;
        const rows = [];
        let from = 0;

        while(true){
            let query = supabase
                .from(table)
                .select(select)
                .range(from,from + pageSize - 1);

            if(options.eq){
                Object.entries(options.eq).forEach(([column,value]) => {
                    query = query.eq(column,value);
                });
            }

            if(options.isNull){
                options.isNull.forEach(column => {
                    query = query.is(column,null);
                });
            }

            if(options.order){
                query = query.order(
                    options.order.column,
                    {
                        ascending:options.order.ascending !== false
                    }
                );
            }

            const {data,error} = await query;

            if(error){
                throw error;
            }

            const page = Array.isArray(data) ? data : [];
            rows.push(...page);

            if(page.length < pageSize){
                break;
            }

            from += pageSize;
        }

        return rows;
    }

    function transactionItemToLegacy(item){
        const qty = parseNumber(item.qty);
        const harga = parseNumber(item.unit_price);
        const normal = parseNumber(item.normal_unit_price || item.unit_price);

        return {
            transactionItemId:item.id,
            cloudItemId:item.id,
            productId:item.product_id,
            id:item.product_id,
            barcode:item.barcode_snapshot || "",
            nama:item.product_name_snapshot || "Barang",
            namaBarang:item.product_name_snapshot || "Barang",
            satuan:item.unit_snapshot || "Pcs",
            qty,
            jumlah:qty,
            harga,
            hargaAwal:normal,
            hargaNormal:normal,
            hargaBeli:parseNumber(item.cost_price_snapshot),
            subtotal:parseNumber(item.line_subtotal),
            diskon:parseNumber(item.line_discount),
            lineDiscount:parseNumber(item.line_discount)
        };
    }

    function transactionRowToLegacy(row,items){
        const local = formatWITA(row.transacted_at);
        const id = stableNumericId(`tx:${row.id}`);
        const mappedItems = (items || []).map(transactionItemToLegacy);

        return {
            id,
            cloudId:row.id,
            cloudTransactionId:row.id,
            clientTransactionId:row.client_transaction_id,
            kodeTransaksi:row.transaction_code,
            kasir:row.cashier_username || "",
            username:row.cashier_username || "",
            shift:row.shift_label || "",
            shiftLabel:row.shift_label || "",
            attendanceId:row.attendance_id || null,
            tanggal:row.business_date || local.date,
            waktu:local.time,
            timestamp:row.transacted_at,
            waktu_teks:`${row.business_date || local.date} ${local.time}`,
            metode:row.payment_method || "Tunai",
            metodePembayaran:row.payment_method || "Tunai",
            normalSubtotal:parseNumber(row.normal_subtotal),
            subtotal:parseNumber(row.subtotal),
            diskonProduk:parseNumber(row.product_discount),
            diskonManual:parseNumber(row.manual_discount),
            totalDiskon:parseNumber(row.total_discount),
            total:parseNumber(row.grand_total),
            grandTotal:parseNumber(row.grand_total),
            bayar:parseNumber(row.cash_received),
            cashReceived:parseNumber(row.cash_received),
            bayarCash:parseNumber(row.cash_amount),
            cash:parseNumber(row.cash_amount),
            bayarQris:parseNumber(row.qris_amount),
            qris:parseNumber(row.qris_amount),
            nonTunai:parseNumber(row.qris_amount),
            kembalian:parseNumber(row.change_amount),
            status:row.status,
            cloudStatus:row.status,
            keranjang:mappedItems,
            items:mappedItems,
            _cloudStage12:true
        };
    }

    function legacyTransactionRowToLegacy(row){
        const payload = row.payload && typeof row.payload === "object"
            ? {...row.payload}
            : {};

        const id = stableNumericId(`legacy-tx:${row.id}`);

        return {
            ...payload,
            id,
            cloudLegacyId:row.id,
            kodeTransaksi:
                row.transaction_code ||
                payload.kodeTransaksi ||
                `LEGACY-${String(row.id).slice(0,8)}`,
            kasir:
                row.cashier_username ||
                payload.kasir ||
                payload.username ||
                "",
            shift:
                row.shift_label ||
                payload.shift ||
                "",
            tanggal:
                row.business_date ||
                parseLegacyDate(payload),
            metode:
                row.payment_method ||
                payload.metode ||
                payload.metodePembayaran ||
                "",
            total:
                parseNumber(
                    row.grand_total ||
                    payload.total ||
                    payload.grandTotal
                ),
            grandTotal:
                parseNumber(
                    row.grand_total ||
                    payload.total ||
                    payload.grandTotal
                ),
            _cloudLegacy:true,
            _historyOnly:true
        };
    }

    function isLocalLegacyTransaction(row){
        return Boolean(
            row &&
            !row._cloudStage12 &&
            !row.cloudId &&
            !row.cloudLegacyId
        );
    }

    function isLocalLegacyRow(row){
        return Boolean(
            row &&
            !row._cloudStage12 &&
            !row.cloudId
        );
    }

    function hasLegacyPending(){
        return Boolean(
            safeArray("laporan").some(isLocalLegacyTransaction) ||
            safeArray("shiftClosingLog").some(isLocalLegacyRow) ||
            safeArray("endOfDayLog").some(isLocalLegacyRow) ||
            safeArray("operasional").some(isLocalLegacyRow) ||
            safeArray("mutasiKasShift").some(row =>
                row &&
                !row._cloudStage12 &&
                !row.cloudId &&
                !row._cloudStage10Return &&
                row.sumber !== "retur"
            )
        );
    }

    async function refreshProfiles(){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc("ldm_attendance_profiles");
        if(error){
            throw error;
        }

        const profiles = (Array.isArray(data) ? data : []).map(row => ({
            id:row.id,
            username:row.username,
            role:row.role
        }));

        localStorage.setItem(
            "ldmAttendanceProfiles",
            JSON.stringify(profiles)
        );

        return profiles;
    }

    async function refreshTransactions(){
        await ensureAuth();

        const localPending = isEnabled()
            ? []
            : safeArray("laporan").filter(isLocalLegacyTransaction);

        const [transactions,items,legacyRows] = await Promise.all([
            fetchAllRows(
                "transactions",
                "id,client_transaction_id,transaction_code,cashier_user_id,cashier_username,attendance_id,shift_label,business_date,transacted_at,payment_method,normal_subtotal,subtotal,product_discount,manual_discount,total_discount,grand_total,cash_received,cash_amount,qris_amount,change_amount,status",
                {
                    order:{column:"transacted_at",ascending:true}
                }
            ),
            fetchAllRows(
                "transaction_items",
                "id,transaction_id,product_id,barcode_snapshot,product_name_snapshot,unit_snapshot,qty,cost_price_snapshot,normal_unit_price,unit_price,line_discount,line_subtotal",
                {
                    order:{column:"created_at",ascending:true}
                }
            ),
            fetchAllRows(
                "legacy_transactions",
                "id,legacy_source_id,transaction_code,business_date,cashier_username,shift_label,payment_method,grand_total,payload,imported_at",
                {
                    isNull:["deleted_at"],
                    order:{column:"business_date",ascending:true}
                }
            )
        ]);

        const itemMap = new Map();
        items.forEach(item => {
            if(!itemMap.has(item.transaction_id)){
                itemMap.set(item.transaction_id,[]);
            }
            itemMap.get(item.transaction_id).push(item);
        });

        const cloudRows = transactions
            .filter(row => String(row.status || "").toLowerCase() === "completed")
            .map(row => transactionRowToLegacy(row,itemMap.get(row.id) || []));

        const legacy = legacyRows.map(legacyTransactionRowToLegacy);

        const codes = new Set(
            cloudRows
                .map(row => String(row.kodeTransaksi || "").trim())
                .filter(Boolean)
        );

        const cloudAndImported = [
            ...legacy.filter(row => !codes.has(String(row.kodeTransaksi || "").trim())),
            ...cloudRows
        ];

        const knownCodes = new Set(
            cloudAndImported
                .map(row => String(row.kodeTransaksi || "").trim())
                .filter(Boolean)
        );

        const merged = [
            ...localPending.filter(row =>
                !knownCodes.has(String(row.kodeTransaksi || "").trim())
            ),
            ...cloudAndImported
        ].sort((a,b) => {
            const left = `${a.tanggal || ""} ${a.waktu || ""}`;
            const right = `${b.tanggal || ""} ${b.waktu || ""}`;
            return left.localeCompare(right);
        });

        TX_KEYS.forEach(key => {
            localStorage.setItem(key,JSON.stringify(merged));
        });

        return merged;
    }

    function closingRowToLegacy(row){
        const local = formatWITA(row.finalized_at);
        return {
            id:stableNumericId(`closing:${row.id}`),
            cloudId:row.id,
            tanggal:row.business_date || local.date,
            waktu:local.time,
            kasir:row.cashier_username || "",
            shift:row.shift_label || "",
            modalAwal:parseNumber(row.opening_cash),
            penjualanKotor:parseNumber(row.gross_sales),
            returTotal:parseNumber(row.approved_returns),
            totalOmzet:parseNumber(row.net_sales),
            tunaiSistem:parseNumber(row.cash_sales),
            nonTunaiSistem:parseNumber(row.noncash_sales),
            mutasiKasMasuk:parseNumber(row.cash_in),
            mutasiKasKeluar:parseNumber(row.cash_out),
            mutasiKasNet:parseNumber(row.cash_in) - parseNumber(row.cash_out),
            ekspektasiTunaiFisik:parseNumber(row.expected_cash),
            tunaiFisik:parseNumber(row.physical_cash),
            selisih:parseNumber(row.cash_difference),
            catatan:row.note || "",
            finalizedBy:row.finalized_username || "",
            role:row.finalized_role || "",
            finalizedAt:row.finalized_at,
            status:row.status,
            perhitunganModalTerpisah:true,
            versiClosing:12,
            legacyImported:Boolean(row.legacy_imported),
            _cloudStage12:true
        };
    }

    async function refreshClosings(){
        await ensureAuth();
        const localPending = isEnabled()
            ? []
            : safeArray("shiftClosingLog").filter(isLocalLegacyRow);
        const rows = await fetchAllRows(
            "shift_closings",
            "id,business_date,cashier_username,shift_label,opening_cash,gross_sales,approved_returns,net_sales,cash_sales,noncash_sales,cash_in,cash_out,expected_cash,physical_cash,cash_difference,transaction_count,note,status,finalized_username,finalized_role,finalized_at,legacy_imported",
            {
                isNull:["deleted_at"],
                order:{column:"finalized_at",ascending:false}
            }
        );

        const activeCloud = rows
            .filter(row => row.status === "FINAL")
            .map(closingRowToLegacy);

        const cloudKeys = new Set(
            activeCloud.map(row =>
                `${row.tanggal}|${String(row.kasir).toLowerCase()}|${String(row.shift).toLowerCase()}`
            )
        );

        const active = [
            ...localPending.filter(row =>
                !cloudKeys.has(
                    `${row.tanggal}|${String(row.kasir || "").toLowerCase()}|${String(row.shift || "").toLowerCase()}`
                )
            ),
            ...activeCloud
        ];

        localStorage.setItem(
            "shiftClosingLog",
            JSON.stringify(active)
        );

        const daily = {};
        active.forEach(row => {
            if(!daily[row.tanggal]){
                daily[row.tanggal] = [];
            }
            daily[row.tanggal].push(row);
        });

        localStorage.setItem(
            "shiftClosingDailyLogs",
            JSON.stringify(daily)
        );

        return active;
    }

    function eodRowToLegacy(row){
        const local = formatWITA(row.finalized_at);
        return {
            id:stableNumericId(`eod:${row.id}`),
            cloudId:row.id,
            tanggal:row.business_date || local.date,
            waktu:local.time,
            finalizedBy:row.finalized_username || "",
            role:row.finalized_role || "",
            omzetSistem:parseNumber(row.system_net_sales),
            penjualanSistem:parseNumber(row.system_net_sales),
            omzetClosing:parseNumber(row.closing_net_sales),
            selisihOmzet:parseNumber(row.sales_difference),
            tunaiSistem:parseNumber(row.cash_sales),
            nonTunai:parseNumber(row.noncash_sales),
            mutasiMasuk:parseNumber(row.cash_in),
            mutasiKasMasuk:parseNumber(row.cash_in),
            mutasiKeluar:parseNumber(row.cash_out),
            mutasiKasKeluar:parseNumber(row.cash_out),
            expectedCash:parseNumber(row.expected_cash),
            ekspektasiTunaiFisik:parseNumber(row.expected_cash),
            tunaiFisik:parseNumber(row.physical_cash),
            selisihTunai:parseNumber(row.cash_difference),
            modalAwal:parseNumber(row.opening_cash),
            operasional:parseNumber(row.operating_expense_total),
            closingCount:Number(row.closing_count || 0),
            jumlahClosing:Number(row.closing_count || 0),
            note:row.note || "",
            catatan:row.note || "",
            accounts:Array.isArray(row.accounts_snapshot) ? row.accounts_snapshot : [],
            status:row.status,
            finalizedAt:row.finalized_at,
            legacyImported:Boolean(row.legacy_imported),
            _cloudStage12:true
        };
    }

    async function refreshEOD(){
        await ensureAuth();
        const localPending = isEnabled()
            ? []
            : safeArray("endOfDayLog").filter(isLocalLegacyRow);
        const rows = await fetchAllRows(
            "end_of_day_closings",
            "id,business_date,system_net_sales,closing_net_sales,sales_difference,cash_sales,noncash_sales,cash_in,cash_out,expected_cash,physical_cash,cash_difference,opening_cash,operating_expense_total,closing_count,note,accounts_snapshot,status,finalized_username,finalized_role,finalized_at,legacy_imported",
            {
                isNull:["deleted_at"],
                order:{column:"finalized_at",ascending:false}
            }
        );

        const activeCloud = rows
            .filter(row => row.status === "FINAL")
            .map(eodRowToLegacy);

        const cloudDates = new Set(activeCloud.map(row => row.tanggal));
        const active = [
            ...localPending.filter(row => !cloudDates.has(parseLegacyDate(row))),
            ...activeCloud
        ];

        localStorage.setItem(
            "endOfDayLog",
            JSON.stringify(active)
        );

        return active;
    }

    async function signedReceiptURL(path){
        if(!path){
            return "";
        }

        const supabase = client();
        const {data,error} = await supabase
            .storage
            .from(EXPENSE_BUCKET)
            .createSignedUrl(path,3600);

        if(error){
            console.warn("Signed URL nota gagal:",error);
            return "";
        }

        return data && data.signedUrl
            ? data.signedUrl
            : "";
    }

    async function expenseRowToLegacy(row){
        const local = formatWITA(row.occurred_at);
        const receiptURL = row.receipt_path
            ? await signedReceiptURL(row.receipt_path)
            : "";

        return {
            id:stableNumericId(`expense:${row.id}`),
            cloudId:row.id,
            clientExpenseId:row.client_expense_id || null,
            tanggal:row.business_date || local.date,
            waktu:local.time,
            ket:row.description || "",
            nominal:parseNumber(row.amount),
            kategori:row.category || "Operasional",
            tujuan:row.target || "",
            referensi:row.reference || "",
            notaGambar:receiptURL,
            notaPath:row.receipt_path || "",
            notaNama:row.receipt_name || "",
            notaUkuranAsli:Number(row.receipt_original_size || 0),
            dibuatOleh:row.created_username || "",
            role:row.created_role || "",
            legacyImported:Boolean(row.legacy_imported),
            versiPengeluaran:12,
            _cloudStage12:true
        };
    }

    async function refreshExpenses(){
        await ensureAuth();
        const localPending = isEnabled()
            ? []
            : safeArray("operasional").filter(isLocalLegacyRow);
        const rows = await fetchAllRows(
            "operating_expenses",
            "id,client_expense_id,business_date,occurred_at,description,category,target,reference,amount,receipt_path,receipt_name,receipt_original_size,created_username,created_role,legacy_imported",
            {
                isNull:["deleted_at"],
                order:{column:"occurred_at",ascending:false}
            }
        );

        const mappedCloud = [];
        for(const row of rows){
            mappedCloud.push(await expenseRowToLegacy(row));
        }

        const mapped = [
            ...localPending,
            ...mappedCloud
        ];

        localStorage.setItem(
            "operasional",
            JSON.stringify(mapped)
        );

        return mapped;
    }

    function cashMovementToLegacy(row){
        const local = formatWITA(row.occurred_at);
        const isReturn = row.source_type === "sales_return";
        const isExpense = row.source_type === "operating_expense";
        const source = isReturn
            ? "retur"
            : (isExpense ? "pengeluaran" : "manual-closing");

        return {
            id:stableNumericId(`cash:${row.id}`),
            cloudId:row.id,
            tanggal:local.date,
            waktu:local.time,
            kasir:row.username_snapshot || "",
            shift:row.shift_label || "",
            shiftId:"",
            jenis:row.direction === "in" ? "masuk" : "keluar",
            nominal:parseNumber(row.amount),
            keterangan:
                row.note ||
                row.reference_code ||
                (isReturn ? "Refund Retur" : "Mutasi Kas"),
            sumber:source,
            sourceType:row.source_type,
            refId:row.source_id || null,
            closingId:row.closing_id
                ? stableNumericId(`closing:${row.closing_id}`)
                : null,
            cloudClosingId:row.closing_id || null,
            status:row.status,
            _cloudStage12:true
        };
    }

    async function refreshCashMovements(){
        await ensureAuth();
        const localPending = isEnabled()
            ? []
            : safeArray("mutasiKasShift").filter(row =>
                row &&
                !row._cloudStage12 &&
                !row.cloudId &&
                !row._cloudStage10Return &&
                row.sumber !== "retur"
            );
        const rows = await fetchAllRows(
            "cash_movements",
            "id,direction,amount,username_snapshot,shift_label,source_type,source_id,reference_code,note,status,occurred_at,closing_id",
            {
                eq:{status:"active"},
                order:{column:"occurred_at",ascending:true}
            }
        );

        const mapped = [
            ...localPending,
            ...rows.map(cashMovementToLegacy)
        ];
        localStorage.setItem(
            "mutasiKasShift",
            JSON.stringify(mapped)
        );

        return mapped;
    }

    async function refreshAll(){
        if(refreshingPromise){
            return refreshingPromise;
        }

        refreshingPromise = (async () => {
            await ensureAuth();

            const result = {};
            result.profiles = await refreshProfiles();
            result.transactions = await refreshTransactions();

            if(
                window.LDMReturns &&
                typeof window.LDMReturns.refreshCache === "function"
            ){
                try{
                    result.returns = await window.LDMReturns.refreshCache();
                }catch(error){
                    console.warn("Refresh Retur Tahap 12 dilewati:",error);
                }
            }

            [
                result.closings,
                result.eod,
                result.expenses,
                result.cashMovements
            ] = await Promise.all([
                refreshClosings(),
                refreshEOD(),
                refreshExpenses(),
                refreshCashMovements()
            ]);

            if(!hasLegacyPending()){
                localStorage.setItem(ENABLED_KEY,"true");
            }
            localStorage.setItem(LAST_SYNC_KEY,String(Date.now()));

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-reporting-cache-updated",
                    {
                        detail:{
                            transactions:result.transactions.length,
                            closings:result.closings.length,
                            eod:result.eod.length,
                            expenses:result.expenses.length,
                            cashMovements:result.cashMovements.length
                        }
                    }
                )
            );

            return result;
        })().finally(() => {
            refreshingPromise = null;
        });

        return refreshingPromise;
    }

    function dataURLToBlob(dataURL){
        const parts = String(dataURL || "").split(",");
        if(parts.length !== 2){
            throw new Error("Format gambar Nota tidak valid.");
        }

        const match = parts[0].match(/data:([^;]+);base64/i);
        if(!match){
            throw new Error("Foto Nota bukan Base64 yang valid.");
        }

        const binary = atob(parts[1]);
        const bytes = new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++){
            bytes[i] = binary.charCodeAt(i);
        }

        return {
            blob:new Blob([bytes],{type:match[1]}),
            mime:match[1]
        };
    }

    function extensionForMime(mime){
        if(mime === "image/png") return "png";
        if(mime === "image/webp") return "webp";
        return "jpg";
    }

    async function uploadExpenseReceipt({
        dataURL,
        businessDate,
        fileName
    }){
        if(!dataURL){
            return null;
        }

        const context = await ensureAuth();
        const converted = dataURLToBlob(dataURL);

        if(converted.blob.size > 5 * 1024 * 1024){
            throw new Error("Ukuran Nota melebihi batas 5 MB.");
        }

        const ext = extensionForMime(converted.mime);
        const safeName = String(fileName || "nota")
            .replace(/[^a-zA-Z0-9._-]+/g,"-")
            .slice(0,50);

        const path = [
            context.profile.store_id,
            context.user.id,
            businessDate,
            `expense-${createUUID()}-${safeName || "nota"}.${ext}`
        ].join("/");

        const supabase = client();
        const {error} = await supabase
            .storage
            .from(EXPENSE_BUCKET)
            .upload(
                path,
                converted.blob,
                {
                    contentType:converted.mime,
                    cacheControl:"3600",
                    upsert:false
                }
            );

        if(error){
            throw error;
        }

        return path;
    }

    async function removeExpenseReceipt(path){
        if(!path){
            return;
        }

        try{
            const supabase = client();
            const {error} = await supabase
                .storage
                .from(EXPENSE_BUCKET)
                .remove([path]);
            if(error){
                throw error;
            }
        }catch(error){
            console.warn("Cleanup Nota Storage gagal:",error);
        }
    }

    async function addManualCashMovement({username,shift,direction="out",amount,note}){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_add_manual_cash_movement",
            {
                p_username:username,
                p_shift_label:shift,
                p_direction:direction,
                p_amount:Number(amount || 0),
                p_note:note || null
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function reverseManualCashMovement(id,reason="Dibatalkan dari Closing Shift"){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_reverse_manual_cash_movement",
            {
                p_movement_id:id,
                p_reason:reason
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function finalizeShiftClosing({username,shift,openingCash,physicalCash,note}){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_finalize_shift_closing",
            {
                p_cashier_username:username,
                p_shift_label:shift,
                p_opening_cash:Number(openingCash || 0),
                p_physical_cash:Number(physicalCash || 0),
                p_note:note || null
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function voidShiftClosing(id,reason="Dibatalkan Owner"){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_void_shift_closing",
            {
                p_closing_id:id,
                p_reason:reason
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function finalizeEOD(note){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_finalize_end_of_day",
            {
                p_note:note || null
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function voidEOD(id,reason="Dibatalkan Owner"){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_void_end_of_day",
            {
                p_eod_id:id,
                p_reason:reason
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function voidSale(id,reason="Void dari Laporan"){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_reporting_void_sale",
            {
                p_transaction_id:id,
                p_reason:reason
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function archiveLegacyTransaction(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_soft_delete_legacy_transaction",
            {
                p_id:id
            }
        );
        if(error) throw error;
        await refreshAll();
        return data;
    }

    async function saveExpense({
        clientExpenseId,
        businessDate,
        description,
        category,
        target,
        reference,
        amount,
        receiptDataURL,
        receiptName,
        receiptOriginalSize
    }){
        await ensureAuth();

        const clientId = clientExpenseId || createUUID();
        let receiptPath = null;

        try{
            if(receiptDataURL){
                receiptPath = await uploadExpenseReceipt({
                    dataURL:receiptDataURL,
                    businessDate,
                    fileName:receiptName
                });
            }

            const supabase = client();
            const {data,error} = await supabase.rpc(
                "ldm_save_operating_expense",
                {
                    p_client_expense_id:clientId,
                    p_business_date:businessDate,
                    p_description:description,
                    p_category:category || null,
                    p_target:target || null,
                    p_reference:reference || null,
                    p_amount:Number(amount || 0),
                    p_receipt_path:receiptPath,
                    p_receipt_name:receiptName || null,
                    p_receipt_original_size:Number(receiptOriginalSize || 0)
                }
            );

            if(error){
                throw error;
            }

            await refreshAll();
            return data;
        }catch(error){
            if(receiptPath){
                await removeExpenseReceipt(receiptPath);
            }
            throw error;
        }
    }

    async function deleteExpense(id){
        await ensureAuth();
        const supabase = client();
        const {data,error} = await supabase.rpc(
            "ldm_soft_delete_operating_expense",
            {
                p_expense_id:id
            }
        );
        if(error) throw error;

        if(data && data.receipt_path){
            await removeExpenseReceipt(data.receipt_path);
        }

        await refreshAll();
        return data;
    }

    function scheduleRefresh(){
        if(refreshTimer){
            clearTimeout(refreshTimer);
        }

        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            try{
                await refreshAll();
            }catch(error){
                console.error("Realtime Reporting refresh gagal:",error);
            }
        },350);
    }

    async function startRealtime(){
        if(channel){
            return channel;
        }

        const context = await ensureAuth();
        const storeId = context.profile.store_id;
        const supabase = client();

        channel = supabase.channel(CHANNEL_NAME);

        [
            "transactions",
            "transaction_items",
            "sales_returns",
            "sales_return_items",
            "cash_movements",
            "shift_closings",
            "end_of_day_closings",
            "operating_expenses",
            "legacy_transactions"
        ].forEach(table => {
            channel = channel.on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table,
                    filter:`store_id=eq.${storeId}`
                },
                scheduleRefresh
            );
        });

        channel.subscribe();
        return channel;
    }

    async function stopRealtime(){
        if(!channel){
            return;
        }

        const supabase = client();
        try{
            await supabase.removeChannel(channel);
        }finally{
            channel = null;
        }
    }

    async function bootstrap(){
        const context = await ensureAuth();
        const result = await refreshAll();
        await startRealtime();
        return {context,result};
    }

    function isEnabled(){
        return localStorage.getItem(ENABLED_KEY) === "true";
    }

    async function rpcImport(name,payload){
        const supabase = client();
        const {data,error} = await supabase.rpc(name,{p_rows:payload});
        if(error) throw error;
        return Number(data || 0);
    }

    function normalizeLegacyTransaction(row,index){
        const date = parseLegacyDate(row);
        const code = String(
            row.kodeTransaksi ||
            row.transaction_code ||
            `LEGACY-${date || "DATE"}-${index + 1}`
        ).trim();

        return {
            legacy_source_id:`local-tx:${String(row.id || row.timestamp || `${code}:${index}`)}`,
            transaction_code:code,
            business_date:date,
            cashier_username:String(row.kasir || row.username || row.user || "").trim(),
            shift_label:String(row.shift || row.shiftLabel || "").trim() || null,
            payment_method:String(row.metode || row.metodePembayaran || "").trim() || null,
            grand_total:parseNumber(row.total || row.grandTotal || row.totalHarga),
            payload:row
        };
    }

    function normalizeLegacyClosing(row,index){
        return {
            legacy_source_id:`local-closing:${String(row.id || `${row.tanggal}:${row.kasir}:${row.shift}:${index}`)}`,
            business_date:parseLegacyDate(row),
            cashier_username:String(row.kasir || "").trim(),
            shift_label:String(row.shift || "Full Day").trim(),
            opening_cash:parseNumber(row.modalAwal),
            gross_sales:parseNumber(row.penjualanKotor || row.totalOmzet),
            approved_returns:parseNumber(row.returTotal),
            net_sales:parseNumber(row.totalOmzet),
            cash_sales:parseNumber(row.tunaiSistem),
            noncash_sales:parseNumber(row.nonTunaiSistem),
            cash_in:parseNumber(row.mutasiKasMasuk),
            cash_out:parseNumber(row.mutasiKasKeluar),
            expected_cash:parseNumber(row.ekspektasiTunaiFisik),
            physical_cash:parseNumber(row.tunaiFisik),
            cash_difference:parseNumber(row.selisih),
            transaction_count:Number(row.transactionCount || 0),
            note:row.catatan || null,
            finalized_username:row.finalizedBy || row.dibuatOleh || null,
            finalized_role:row.role || null,
            finalized_at:row.finalizedAt || dateTimeToISO(parseLegacyDate(row),parseLegacyTime(row)),
            snapshot:row
        };
    }

    function normalizeLegacyEOD(row,index){
        return {
            legacy_source_id:`local-eod:${String(row.id || `${row.tanggal}:${index}`)}`,
            business_date:parseLegacyDate(row),
            system_net_sales:parseNumber(row.omzetSistem || row.omzetClosing),
            closing_net_sales:parseNumber(row.omzetClosing),
            sales_difference:parseNumber(row.selisihOmzet),
            cash_sales:parseNumber(row.tunaiSistem),
            noncash_sales:parseNumber(row.nonTunai),
            cash_in:parseNumber(row.mutasiMasuk),
            cash_out:parseNumber(row.mutasiKeluar),
            expected_cash:parseNumber(row.expectedCash),
            physical_cash:parseNumber(row.tunaiFisik),
            cash_difference:parseNumber(row.selisihTunai),
            opening_cash:parseNumber(row.modalAwal),
            operating_expense_total:parseNumber(row.operasional),
            closing_count:Number(row.closingCount || 0),
            note:row.note || row.catatan || null,
            accounts_snapshot:Array.isArray(row.accounts) ? row.accounts : [],
            finalized_username:row.finalizedBy || null,
            finalized_role:row.role || null,
            finalized_at:row.finalizedAt || dateTimeToISO(parseLegacyDate(row),parseLegacyTime(row)),
            snapshot:row
        };
    }

    async function migrateLegacyExpenses(rows){
        const context = await ensureAuth();
        const payload = [];
        const uploaded = [];

        try{
            for(let index=0;index<rows.length;index++){
                const row = rows[index];
                if(row && (row._cloudStage12 || row.cloudId)){
                    continue;
                }

                const date = parseLegacyDate(row);
                let receiptPath = null;

                if(
                    row &&
                    row.notaGambar &&
                    String(row.notaGambar).startsWith("data:image/")
                ){
                    receiptPath = await uploadExpenseReceipt({
                        dataURL:row.notaGambar,
                        businessDate:date,
                        fileName:row.notaNama || `legacy-${index + 1}`
                    });
                    uploaded.push(receiptPath);
                }

                payload.push({
                    legacy_source_id:`local-expense:${String(row.id || `${date}:${index}`)}`,
                    business_date:date,
                    occurred_at:dateTimeToISO(date,parseLegacyTime(row)),
                    description:String(row.ket || row.description || "Pengeluaran Legacy").trim(),
                    category:row.kategori || null,
                    target:row.tujuan || null,
                    reference:row.referensi || null,
                    amount:parseNumber(row.nominal || row.amount),
                    receipt_path:receiptPath,
                    receipt_name:row.notaNama || null,
                    receipt_original_size:Number(row.notaUkuranAsli || 0),
                    created_username:row.dibuatOleh || context.profile.username,
                    created_role:row.role || "owner"
                });
            }

            if(payload.length === 0){
                return 0;
            }

            return await rpcImport("ldm_import_legacy_expenses",payload);
        }catch(error){
            if(uploaded.length){
                try{
                    const supabase = client();
                    await supabase.storage.from(EXPENSE_BUCKET).remove(uploaded);
                }catch(cleanupError){
                    console.warn("Cleanup nota migrasi gagal:",cleanupError);
                }
            }
            throw error;
        }
    }

    async function migrateLegacyCash(rows){
        const payload = (rows || [])
            .filter(row => row && !row._cloudStage12 && !row.cloudId && row.sumber !== "retur")
            .map((row,index) => ({
                legacy_source_id:`local-cash:${String(row.id || `${row.tanggal}:${row.kasir}:${row.shift}:${index}`)}`,
                business_date:parseLegacyDate(row),
                time:parseLegacyTime(row),
                username:String(row.kasir || row.username || "").trim(),
                shift_label:String(row.shift || "").trim() || null,
                direction:String(row.jenis || "keluar").toLowerCase() === "masuk" ? "in" : "out",
                amount:parseNumber(row.nominal),
                reference_code:row.refId ? String(row.refId) : null,
                note:row.keterangan || null
            }));

        if(payload.length === 0){
            return 0;
        }

        return await rpcImport("ldm_import_legacy_cash_movements",payload);
    }

    async function migrateLegacy({transactions,closings,eod,expenses,cashMovements}){
        const context = await ensureAuth();
        if(String(context.profile.role || "").toLowerCase() !== "owner"){
            throw new Error("Hanya Owner yang dapat menjalankan migrasi Tahap 12.");
        }

        const txRows = (transactions || [])
            .filter(row => row && !row._cloudStage12 && !row.cloudId && !row.cloudLegacyId)
            .map(normalizeLegacyTransaction)
            .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.business_date));

        const closeRows = (closings || [])
            .filter(row => row && !row._cloudStage12 && !row.cloudId)
            .map(normalizeLegacyClosing)
            .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.business_date) && row.cashier_username);

        const eodRows = (eod || [])
            .filter(row => row && !row._cloudStage12 && !row.cloudId)
            .map(normalizeLegacyEOD)
            .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.business_date));

        const result = {
            transactions:txRows.length
                ? await rpcImport("ldm_import_legacy_transactions",txRows)
                : 0,
            closings:closeRows.length
                ? await rpcImport("ldm_import_legacy_shift_closings",closeRows)
                : 0,
            eod:eodRows.length
                ? await rpcImport("ldm_import_legacy_eod",eodRows)
                : 0,
            expenses:await migrateLegacyExpenses(expenses || []),
            cashMovements:await migrateLegacyCash(cashMovements || [])
        };

        localStorage.setItem(ENABLED_KEY,"true");
        await refreshAll();
        return result;
    }

    window.LDMReporting = Object.freeze({
        createUUID,
        stableNumericId,
        isEnabled,
        hasLegacyPending,
        safeArray,
        safeObject,
        formatWITA,
        refreshProfiles,
        refreshTransactions,
        refreshClosings,
        refreshEOD,
        refreshExpenses,
        refreshCashMovements,
        refreshAll,
        addManualCashMovement,
        reverseManualCashMovement,
        finalizeShiftClosing,
        voidShiftClosing,
        finalizeEOD,
        voidEOD,
        voidSale,
        archiveLegacyTransaction,
        saveExpense,
        deleteExpense,
        migrateLegacy,
        startRealtime,
        stopRealtime,
        bootstrap
    });
})();

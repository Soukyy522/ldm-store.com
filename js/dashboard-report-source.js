(function(){
    "use strict";

    const VERSION = "27.7.2";
    const LOCAL_KEYS = ["laporan", "dataLaporan", "riwayatTransaksi", "laporanHistory"];
    const MAX_RANGE_ROWS = 50000;

    function safeParseArray(raw){
        if(!raw) return [];
        try{
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : [];
        }catch(_){
            return [];
        }
    }

    function dateOf(row){
        const direct = String(
            row?.tanggal ||
            row?.business_date ||
            row?.tgl ||
            row?.date ||
            ""
        ).slice(0,10);
        if(/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

        const raw = row?.waktu_teks || row?.waktu || row?.created_at || row?.transacted_at || "";
        const match = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
    }

    function inRange(row, fromDate, toDate){
        const date = dateOf(row);
        if(!date) return false;
        if(fromDate && date < fromDate) return false;
        if(toDate && date > toDate) return false;
        return true;
    }

    function localRows(fromDate, toDate){
        for(const key of LOCAL_KEYS){
            const rows = safeParseArray(localStorage.getItem(key));
            if(rows.length){
                return rows.filter(row => inRange(row, fromDate, toDate));
            }
        }
        return [];
    }

    async function cloudRows(fromDate, toDate){
        if(!window.LDMReporting || typeof window.LDMReporting.fetchAllReportTransactions !== "function"){
            throw new Error("Cloud Reporting belum siap.");
        }
        return window.LDMReporting.fetchAllReportTransactions({
            fromDate: fromDate || null,
            toDate: toDate || null,
            pageSize: 500
        });
    }

    async function indexedDbRows(fromDate, toDate){
        if(!window.LDMStorageDB || typeof window.LDMStorageDB.getTransactions !== "function"){
            throw new Error("IndexedDB transaksi belum siap.");
        }
        await window.LDMStorageDB.ready();
        return window.LDMStorageDB.getTransactions({
            fromDate: fromDate || "",
            toDate: toDate || "",
            limit: MAX_RANGE_ROWS,
            newestFirst: false
        });
    }

    async function mirrorToIndexedDB(rows){
        if(!Array.isArray(rows) || !rows.length) return;
        if(!window.LDMStorageDB || typeof window.LDMStorageDB.putTransactions !== "function") return;
        try{
            await window.LDMStorageDB.putTransactions(rows, { cleanup: false });
        }catch(error){
            console.warn("[LocDailyMar] Dashboard tidak dapat memperbarui arsip IndexedDB:", error);
        }
    }

    async function loadRange(options = {}){
        const fromDate = String(options.fromDate || "").slice(0,10);
        const toDate = String(options.toDate || "").slice(0,10);
        const preferCloud = options.preferCloud !== false;
        let cloudError = null;

        if(preferCloud && navigator.onLine !== false){
            try{
                const rows = await cloudRows(fromDate, toDate);
                await mirrorToIndexedDB(rows);
                return { rows, source: "cloud", fromDate, toDate };
            }catch(error){
                cloudError = error;
                console.warn("[LocDailyMar] Dashboard Cloud Reporting gagal, fallback IndexedDB:", error);
            }
        }

        try{
            const rows = await indexedDbRows(fromDate, toDate);
            if(rows.length || navigator.onLine === false){
                return { rows, source: "indexeddb", fromDate, toDate, cloudError };
            }
        }catch(error){
            console.warn("[LocDailyMar] Dashboard IndexedDB gagal, fallback localStorage:", error);
        }

        return {
            rows: localRows(fromDate, toDate),
            source: "local",
            fromDate,
            toDate,
            cloudError
        };
    }

    window.LDMDashboardReports = Object.freeze({
        version: VERSION,
        loadRange,
        localRows
    });
})();

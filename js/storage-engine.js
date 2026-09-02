(function () {
    'use strict';

    if (window.LDMStorageDB) return;

    const VERSION = '27.7.1';
    const DB_NAME = 'locdailymar-storage-v27';
    const DB_VERSION = 2;
    const SNAPSHOT_STORE = 'snapshots';
    const META_STORE = 'meta';
    const TRANSACTION_STORE = 'transactions';
    const TRANSACTION_ARCHIVE_MAX = 50000;
    const TRANSACTION_RETENTION_DAYS = 365;
    const MIGRATION_KEY = 'legacy-localstorage-migration-v27';

    /*
     * Key besar/bernilai yang disalin ke IndexedDB. Salinan localStorage
     * tetap dipertahankan sementara sebagai compatibility cache karena
     * sejumlah halaman lama masih membacanya secara sinkron.
     */
    const MIRROR_KEYS = new Set([
        'laporan',
        'dataLaporan',
        'riwayatTransaksi',
        'laporanHistory',
        'dataBarang',
        'dataPurchaseOrder',
        'dataGoodsReceipt',
        'dataRetur',
        'dataStockOpname',
        'dataAbsensi',
        'kartuStokMutasi',
        'mutasiKasShift',
        'auditLog',
        'shiftClosingLog',
        'endOfDayLog',
        'backupRestoreHistory',
        'ldmPurchasePriceHistory',
        'ldmStage19QaHistoryV1'
    ]);

    const memory = new Map();
    let dbPromise = null;
    let readyPromise = null;

    function byteLength(value) {
        try {
            return new Blob([String(value ?? '')]).size;
        } catch (_) {
            return String(value ?? '').length * 2;
        }
    }

    function clone(value) {
        if (value == null) return value;
        try { return structuredClone(value); } catch (_) {}
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function openDatabase() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('IndexedDB tidak didukung browser ini.'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
                    const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
                    store.createIndex('updated_at_ms', 'updated_at_ms', { unique: false });
                    store.createIndex('source', 'source', { unique: false });
                }

                if (!db.objectStoreNames.contains(META_STORE)) {
                    db.createObjectStore(META_STORE, { keyPath: 'key' });
                }


                if (!db.objectStoreNames.contains(TRANSACTION_STORE)) {
                    const txStore = db.createObjectStore(TRANSACTION_STORE, { keyPath: 'key' });
                    txStore.createIndex('business_date', 'business_date', { unique: false });
                    txStore.createIndex('transacted_at_ms', 'transacted_at_ms', { unique: false });
                    txStore.createIndex('updated_at_ms', 'updated_at_ms', { unique: false });
                    txStore.createIndex('transaction_code', 'transaction_code', { unique: false });
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error || new Error('IndexedDB gagal dibuka.'));
            request.onblocked = () => reject(new Error('Upgrade IndexedDB terblokir tab LocDailyMar lain. Tutup tab lain lalu coba kembali.'));
        });

        return dbPromise;
    }

    async function transact(storeName, mode, executor) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let result;

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('Transaksi IndexedDB gagal.'));
            tx.onabort = () => reject(tx.error || new Error('Transaksi IndexedDB dibatalkan.'));

            try {
                result = executor(store, tx);
            } catch (error) {
                try { tx.abort(); } catch (_) {}
                reject(error);
            }
        });
    }

    async function requestResult(request, fallbackMessage) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error(fallbackMessage || 'IndexedDB request gagal.'));
        });
    }

    async function putMeta(key, value) {
        await transact(META_STORE, 'readwrite', store => {
            store.put({ key: String(key), value: clone(value), updated_at_ms: Date.now() });
        });
        return value;
    }

    async function getMeta(key, fallback = null) {
        const db = await openDatabase();
        const tx = db.transaction(META_STORE, 'readonly');
        const result = await requestResult(tx.objectStore(META_STORE).get(String(key)), 'Metadata IndexedDB gagal dibaca.');
        return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : fallback;
    }

    async function putRaw(key, rawValue, options = {}) {
        const storageKey = String(key);
        const value = String(rawValue ?? '');
        const record = {
            key: storageKey,
            value,
            bytes: byteLength(value),
            source: String(options.source || 'application'),
            protected: options.protected === true,
            updated_at_ms: Date.now()
        };

        memory.set(storageKey, value);

        await transact(SNAPSHOT_STORE, 'readwrite', store => {
            store.put(record);
        });

        window.dispatchEvent(new CustomEvent('ldm:indexeddb-snapshot-updated', {
            detail: { key: storageKey, bytes: record.bytes, source: record.source }
        }));

        return record;
    }

    async function putJSON(key, value, options = {}) {
        return putRaw(key, JSON.stringify(value), options);
    }

    async function getRecord(key) {
        const storageKey = String(key);
        const db = await openDatabase();
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const result = await requestResult(tx.objectStore(SNAPSHOT_STORE).get(storageKey), 'Snapshot IndexedDB gagal dibaca.');
        if (result && typeof result.value === 'string') memory.set(storageKey, result.value);
        return result || null;
    }

    async function getRaw(key, fallback = null) {
        const storageKey = String(key);
        if (memory.has(storageKey)) return memory.get(storageKey);
        const record = await getRecord(storageKey);
        return record && typeof record.value === 'string' ? record.value : fallback;
    }

    async function getJSON(key, fallback = null) {
        const raw = await getRaw(key, null);
        if (raw == null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
    }

    function peekRaw(key, fallback = null) {
        const storageKey = String(key);
        return memory.has(storageKey) ? memory.get(storageKey) : fallback;
    }

    function peekJSON(key, fallback = null) {
        const raw = peekRaw(key, null);
        if (raw == null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
    }

    async function remove(key) {
        const storageKey = String(key);
        memory.delete(storageKey);
        await transact(SNAPSHOT_STORE, 'readwrite', store => store.delete(storageKey));
        return true;
    }

    async function list() {
        const db = await openDatabase();
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const rows = await requestResult(tx.objectStore(SNAPSHOT_STORE).getAll(), 'Daftar snapshot IndexedDB gagal dibaca.');
        return (Array.isArray(rows) ? rows : []).map(row => ({
            key: row.key,
            bytes: Number(row.bytes || 0),
            source: row.source || '',
            protected: row.protected === true,
            updated_at_ms: Number(row.updated_at_ms || 0)
        }));
    }

    async function stats() {
        const rows = await list();
        return {
            database: DB_NAME,
            version: DB_VERSION,
            snapshots: rows.length,
            bytes: rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
            rows
        };
    }

    async function estimate() {
        const result = {
            supported: Boolean(navigator.storage),
            usage: 0,
            quota: 0,
            percent: 0,
            persisted: null
        };

        if (!navigator.storage) return result;

        if (typeof navigator.storage.estimate === 'function') {
            const info = await navigator.storage.estimate();
            result.usage = Number(info.usage || 0);
            result.quota = Number(info.quota || 0);
            result.percent = result.quota > 0 ? (result.usage / result.quota) * 100 : 0;
        }

        if (typeof navigator.storage.persisted === 'function') {
            try { result.persisted = await navigator.storage.persisted(); } catch (_) {}
        }

        return result;
    }

    async function requestPersistentStorage() {
        if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
            return { ok: false, persisted: false, message: 'Browser tidak menyediakan Persistent Storage API.' };
        }

        let persisted = false;
        try { persisted = await navigator.storage.persist(); } catch (_) { persisted = false; }
        return {
            ok: persisted,
            persisted,
            message: persisted
                ? 'Penyimpanan persisten aktif. Browser akan lebih melindungi data aplikasi dari eviction otomatis.'
                : 'Browser belum memberikan penyimpanan persisten. Aplikasi tetap dapat memakai IndexedDB.'
        };
    }

    async function migrateFromLocalStorage(options = {}) {
        const force = options.force === true;
        const previous = await getMeta(MIGRATION_KEY, null).catch(() => null);
        if (previous && !force) return { ...previous, skipped: true };

        const migrated = [];
        const failed = [];
        let bytes = 0;

        for (const key of MIRROR_KEYS) {
            const value = localStorage.getItem(key);
            if (value == null || value === '') continue;

            try {
                const record = await putRaw(key, value, { source: 'legacy-localStorage-migration' });
                migrated.push(key);
                bytes += Number(record.bytes || 0);
            } catch (error) {
                failed.push({ key, message: String(error && error.message || error) });
            }
        }

        const result = {
            version: VERSION,
            migrated_at: new Date().toISOString(),
            migrated,
            failed,
            bytes
        };
        await putMeta(MIGRATION_KEY, result);

        window.dispatchEvent(new CustomEvent('ldm:indexeddb-migration-complete', { detail: result }));
        return result;
    }

    async function hydrateMemory() {
        const db = await openDatabase();
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const rows = await requestResult(tx.objectStore(SNAPSHOT_STORE).getAll(), 'IndexedDB gagal dimuat ke memory cache.');
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (row && typeof row.key === 'string' && typeof row.value === 'string') {
                memory.set(row.key, row.value);
            }
        });
        return memory.size;
    }


    function parseTransactionTime(row) {
        const candidates = [
            row && row.transacted_at,
            row && row.timestamp,
            row && row.waktu_teks,
            row && row.tanggal
        ];

        for (const value of candidates) {
            if (value == null || value === '') continue;
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            const parsed = new Date(value).getTime();
            if (Number.isFinite(parsed)) return parsed;
        }
        return Date.now();
    }

    function transactionArchiveKey(row, index = 0) {
        const value = row && (
            row.cloudId ||
            row.cloudTransactionId ||
            row.cloudLegacyId ||
            row.clientTransactionId ||
            row.client_transaction_id ||
            row.kodeTransaksi ||
            row.transaction_code ||
            row.id
        );
        return String(value || `local-${parseTransactionTime(row)}-${index}`);
    }

    function transactionArchiveRecord(row, index = 0) {
        const payload = clone(row || {});
        const timeMs = parseTransactionTime(payload);
        const date = String(
            payload.tanggal ||
            payload.business_date ||
            ''
        ).slice(0, 10);
        const code = String(
            payload.kodeTransaksi ||
            payload.transaction_code ||
            ''
        );
        return {
            key: transactionArchiveKey(payload, index),
            business_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
            transacted_at_ms: timeMs,
            transaction_code: code,
            payload,
            updated_at_ms: Date.now()
        };
    }

    async function putTransactions(rows, options = {}) {
        const source = Array.isArray(rows) ? rows : [];
        if (!source.length) return { written: 0 };
        await ready();
        const records = source.map(transactionArchiveRecord);
        await transact(TRANSACTION_STORE, 'readwrite', store => {
            records.forEach(record => store.put(record));
        });
        if (options.cleanup !== false) {
            await cleanupTransactions(options).catch(error => {
                console.warn('[LocDailyMar] Cleanup transaction archive dilewati:', error);
            });
        }
        return { written: records.length };
    }

    async function replaceTransactions(rows, options = {}) {
        const source = Array.isArray(rows) ? rows : [];
        await ready();

        const maxRecords = Math.max(
            1000,
            Number(options.maxRecords || TRANSACTION_ARCHIVE_MAX) || TRANSACTION_ARCHIVE_MAX
        );
        const retentionDays = Math.max(
            1,
            Number(options.retentionDays || TRANSACTION_RETENTION_DAYS) || TRANSACTION_RETENTION_DAYS
        );
        const cutoff = Date.now() - retentionDays * 86400000;

        let kept = source.filter(row => parseTransactionTime(row) >= cutoff);
        if (kept.length > maxRecords) {
            kept = kept
                .slice()
                .sort((a, b) => parseTransactionTime(a) - parseTransactionTime(b))
                .slice(-maxRecords);
        }
        const records = kept.map(transactionArchiveRecord);

        await transact(TRANSACTION_STORE, 'readwrite', store => {
            store.clear();
            records.forEach(record => store.put(record));
        });

        await putMeta('transaction-archive-policy', {
            version: VERSION,
            max_records: maxRecords,
            retention_days: retentionDays,
            records: records.length,
            updated_at: new Date().toISOString()
        });

        window.dispatchEvent(new CustomEvent('ldm:transaction-archive-updated', {
            detail: { records: records.length, maxRecords, retentionDays }
        }));

        return { records: records.length, maxRecords, retentionDays };
    }

    async function getTransactions(options = {}) {
        await ready();
        const db = await openDatabase();
        const tx = db.transaction(TRANSACTION_STORE, 'readonly');
        const records = await requestResult(
            tx.objectStore(TRANSACTION_STORE).getAll(),
            'Arsip transaksi IndexedDB gagal dibaca.'
        );

        const fromDate = String(options.fromDate || '').slice(0, 10);
        const toDate = String(options.toDate || '').slice(0, 10);
        const newestFirst = options.newestFirst === true;
        const limit = Math.max(1, Math.min(
            Number(options.limit || TRANSACTION_ARCHIVE_MAX) || TRANSACTION_ARCHIVE_MAX,
            TRANSACTION_ARCHIVE_MAX
        ));

        let filtered = (Array.isArray(records) ? records : []).filter(record => {
            const date = String(record.business_date || '');
            if (fromDate && date && date < fromDate) return false;
            if (toDate && date && date > toDate) return false;
            return true;
        });

        filtered.sort((a, b) => Number(a.transacted_at_ms || 0) - Number(b.transacted_at_ms || 0));
        if (newestFirst) filtered.reverse();
        if (filtered.length > limit) filtered = filtered.slice(0, limit);

        return filtered.map(record => clone(record.payload));
    }

    async function transactionStats() {
        await ready();
        const db = await openDatabase();
        const tx = db.transaction(TRANSACTION_STORE, 'readonly');
        const rows = await requestResult(
            tx.objectStore(TRANSACTION_STORE).getAll(),
            'Statistik arsip transaksi gagal dibaca.'
        );
        const records = Array.isArray(rows) ? rows : [];
        const times = records.map(row => Number(row.transacted_at_ms || 0)).filter(Number.isFinite);
        let oldest = null;
        let newest = null;
        times.forEach(value => {
            if (oldest == null || value < oldest) oldest = value;
            if (newest == null || value > newest) newest = value;
        });
        return {
            database: DB_NAME,
            store: TRANSACTION_STORE,
            count: records.length,
            maxRecords: TRANSACTION_ARCHIVE_MAX,
            retentionDays: TRANSACTION_RETENTION_DAYS,
            oldestAt: oldest != null ? new Date(oldest).toISOString() : null,
            newestAt: newest != null ? new Date(newest).toISOString() : null
        };
    }

    async function cleanupTransactions(options = {}) {
        await ready();
        const rows = await getTransactions({ limit: TRANSACTION_ARCHIVE_MAX, newestFirst: false });
        return replaceTransactions(rows, options);
    }

    async function verify() {
        const token = `verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const key = '__ldm_storage_verify__';
        await putRaw(key, token, { source: 'verification' });
        const readBack = await getRaw(key, null);
        await remove(key);
        return {
            ok: readBack === token,
            message: readBack === token
                ? 'IndexedDB baca/tulis berhasil.'
                : 'Verifikasi IndexedDB gagal.'
        };
    }

    async function init() {
        await openDatabase();
        await hydrateMemory();
        const migration = await migrateFromLocalStorage().catch(error => ({
            migrated: [],
            failed: [{ key: '*', message: String(error && error.message || error) }],
            bytes: 0
        }));
        window.dispatchEvent(new CustomEvent('ldm:indexeddb-ready', {
            detail: { version: VERSION, migration, memoryKeys: memory.size }
        }));
        return { version: VERSION, migration, memoryKeys: memory.size };
    }

    function ready() {
        if (!readyPromise) readyPromise = init();
        return readyPromise;
    }

    function mirrorRaw(key, value, options = {}) {
        const storageKey = String(key);
        if (!MIRROR_KEYS.has(storageKey) && options.force !== true) return Promise.resolve(null);
        return ready()
            .then(() => putRaw(storageKey, value, options))
            .catch(error => {
                console.warn('[LocDailyMar] Mirror IndexedDB gagal:', storageKey, error);
                return null;
            });
    }

    window.LDMStorageDB = Object.freeze({
        version: VERSION,
        database: DB_NAME,
        mirrorKeys: Array.from(MIRROR_KEYS),
        ready,
        putRaw,
        putJSON,
        mirrorRaw,
        getRaw,
        getJSON,
        peekRaw,
        peekJSON,
        remove,
        list,
        stats,
        estimate,
        requestPersistentStorage,
        migrateFromLocalStorage,
        verify,
        getMeta,
        putTransactions,
        replaceTransactions,
        getTransactions,
        transactionStats,
        cleanupTransactions,
        transactionArchiveMax: TRANSACTION_ARCHIVE_MAX,
        transactionRetentionDays: TRANSACTION_RETENTION_DAYS
    });

    ready().catch(error => {
        console.warn('[LocDailyMar] Storage Engine 27.7.1 tidak dapat diinisialisasi:', error);
        window.dispatchEvent(new CustomEvent('ldm:indexeddb-error', {
            detail: { message: String(error && error.message || error) }
        }));
    });
})();

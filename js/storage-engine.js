(function () {
    'use strict';

    if (window.LDMStorageDB) return;

    const VERSION = '27.7.0';
    const DB_NAME = 'locdailymar-storage-v27';
    const DB_VERSION = 1;
    const SNAPSHOT_STORE = 'snapshots';
    const META_STORE = 'meta';
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
        getMeta
    });

    ready().catch(error => {
        console.warn('[LocDailyMar] Storage Engine 27.7 tidak dapat diinisialisasi:', error);
        window.dispatchEvent(new CustomEvent('ldm:indexeddb-error', {
            detail: { message: String(error && error.message || error) }
        }));
    });
})();

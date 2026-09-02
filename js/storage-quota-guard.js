(function () {
    'use strict';

    if (window.LDMStorageQuotaGuard) return;

    const VERSION = '27.7.1';
    const nativeSetItem = Storage.prototype.setItem;
    const nativeGetItem = Storage.prototype.getItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    const TRANSACTION_CACHE_KEYS = new Set([
        'laporan',
        'dataLaporan',
        'riwayatTransaksi',
        'laporanHistory'
    ]);

    function mirrorToIndexedDB(key, value, protectedValue) {
        if (TRANSACTION_CACHE_KEYS.has(String(key))) return;
        try {
            if (window.LDMStorageDB && typeof window.LDMStorageDB.mirrorRaw === 'function') {
                window.LDMStorageDB.mirrorRaw(String(key), String(value), {
                    source: 'storage-quota-guard',
                    protected: protectedValue === true
                });
            }
        } catch (_) {}
    }

    /*
     * Cache/history yang boleh dipangkas karena sumber utamanya sudah berada
     * di cloud atau bersifat compatibility cache. Data terbaru dipertahankan.
     */
    const ARRAY_POLICIES = {
        laporan: { limit: 200, emergency: 50, keep: 'tail' },
        dataLaporan: { limit: 200, emergency: 50, keep: 'tail' },
        riwayatTransaksi: { limit: 200, emergency: 50, keep: 'tail' },
        laporanHistory: { limit: 200, emergency: 50, keep: 'tail' },
        auditLog: { limit: 1000, emergency: 200, keep: 'tail' },
        shiftClosingLog: { limit: 365, emergency: 90, keep: 'head' },
        endOfDayLog: { limit: 365, emergency: 90, keep: 'head' },
        backupRestoreHistory: { limit: 100, emergency: 30, keep: 'head' },
        ldmStage19QaHistoryV1: { limit: 100, emergency: 30, keep: 'head' }
    };

    const OBJECT_DATE_POLICIES = {
        shiftClosingDailyLogs: { limit: 365, emergency: 90 },
        passClosingMap: { limit: 365, emergency: 90 }
    };

    /*
     * Data operasional penting tidak pernah dipangkas otomatis.
     * Jika penulisannya gagal, guard hanya membersihkan cache aman lalu retry.
     * Bila tetap penuh, error diteruskan agar aplikasi tidak diam-diam
     * kehilangan transaksi/data yang belum aman di cloud.
     */
    const PROTECTED_KEYS = new Set([
        'pendingTransactions',
        'ldmOfflineQueueV16',
        'ldmOfflineStockReservationsV16',
        'dataBarang',
        'dataPurchaseOrder',
        'dataGoodsReceipt',
        'dataRetur',
        'dataStockOpname',
        'dataAbsensi',
        'kartuStokMutasi',
        'mutasiKasShift',
        'daftarAkun'
    ]);

    function isQuotaError(error) {
        return !!error && (
            error.name === 'QuotaExceededError' ||
            error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            error.code === 22 ||
            error.code === 1014
        );
    }

    function parseJSON(text) {
        try { return JSON.parse(text); } catch (_) { return null; }
    }

    function trimArray(value, policy, emergency) {
        const rows = Array.isArray(value) ? value : null;
        if (!rows) return null;

        const limit = Math.max(
            1,
            Number(emergency ? policy.emergency : policy.limit) || 1
        );

        if (rows.length <= limit) return rows;
        return policy.keep === 'head'
            ? rows.slice(0, limit)
            : rows.slice(-limit);
    }

    function trimDateMap(value, policy, emergency) {
        if (!value || Array.isArray(value) || typeof value !== 'object') {
            return null;
        }

        const limit = Math.max(
            1,
            Number(emergency ? policy.emergency : policy.limit) || 1
        );

        const keys = Object.keys(value).sort().reverse();
        if (keys.length <= limit) return value;

        const kept = {};
        keys.slice(0, limit).forEach(key => {
            kept[key] = value[key];
        });

        return kept;
    }

    function normalizeValue(key, value, emergency) {
        const text = String(value);

        if (PROTECTED_KEYS.has(key)) {
            return text;
        }

        const parsed = parseJSON(text);

        if (ARRAY_POLICIES[key]) {
            const trimmed = trimArray(
                parsed,
                ARRAY_POLICIES[key],
                emergency
            );

            if (trimmed) {
                return JSON.stringify(trimmed);
            }
        }

        if (OBJECT_DATE_POLICIES[key]) {
            const trimmed = trimDateMap(
                parsed,
                OBJECT_DATE_POLICIES[key],
                emergency
            );

            if (trimmed) {
                return JSON.stringify(trimmed);
            }
        }

        return text;
    }

    function compactExistingKey(key, emergency) {
        if (PROTECTED_KEYS.has(key)) return false;

        const current = nativeGetItem.call(
            window.localStorage,
            key
        );

        if (current == null) return false;

        const compacted = normalizeValue(
            key,
            current,
            emergency
        );

        if (compacted === current) return false;

        nativeSetItem.call(
            window.localStorage,
            key,
            compacted
        );

        return true;
    }

    function reclaimSpace() {
        let changed = false;

        Object.keys(ARRAY_POLICIES).forEach(key => {
            try {
                changed =
                    compactExistingKey(key, true) ||
                    changed;
            } catch (_) {}
        });

        Object.keys(OBJECT_DATE_POLICIES).forEach(key => {
            try {
                changed =
                    compactExistingKey(key, true) ||
                    changed;
            } catch (_) {}
        });

        return changed;
    }

    function dispatch(name, detail) {
        try {
            window.dispatchEvent(
                new CustomEvent(name, { detail })
            );
        } catch (_) {}
    }

    function setItemSafe(key, value) {
        const storageKey = String(key);

        // Simpan payload penuh ke IndexedDB terlebih dahulu sebagai storage besar.
        // localStorage di bawah ini hanya compatibility cache yang boleh dibatasi.
        mirrorToIndexedDB(
            storageKey,
            value,
            PROTECTED_KEYS.has(storageKey)
        );

        let normalized = normalizeValue(
            storageKey,
            value,
            false
        );

        try {
            nativeSetItem.call(
                window.localStorage,
                storageKey,
                normalized
            );
            return true;
        } catch (error) {
            if (!isQuotaError(error)) throw error;

            console.warn(
                '[LocDailyMar] localStorage penuh. Cache aman sedang diperkecil.',
                storageKey
            );

            reclaimSpace();

            normalized = normalizeValue(
                storageKey,
                value,
                true
            );

            try {
                nativeSetItem.call(
                    window.localStorage,
                    storageKey,
                    normalized
                );

                dispatch(
                    'ldm:storage-quota-recovered',
                    {
                        key: storageKey,
                        protected:
                            PROTECTED_KEYS.has(storageKey)
                    }
                );

                return true;
            } catch (retryError) {
                if (isQuotaError(retryError)) {
                    dispatch(
                        'ldm:storage-quota-full',
                        {
                            key: storageKey,
                            protected:
                                PROTECTED_KEYS.has(storageKey)
                        }
                    );
                }

                throw retryError;
            }
        }
    }

    /*
     * Melindungi kode lama di seluruh halaman tanpa perlu mengubah ratusan
     * pemanggilan localStorage.setItem() satu per satu.
     */
    Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage) {
            return setItemSafe(key, value);
        }

        return nativeSetItem.call(
            this,
            key,
            value
        );
    };

    async function estimate() {
        if (
            !navigator.storage ||
            typeof navigator.storage.estimate !== 'function'
        ) {
            return null;
        }

        try {
            const result =
                await navigator.storage.estimate();

            const usage =
                Number(result.usage || 0);
            const quota =
                Number(result.quota || 0);

            return {
                usage,
                quota,
                percent:
                    quota > 0
                        ? (usage / quota) * 100
                        : 0
            };
        } catch (_) {
            return null;
        }
    }

    window.LDMStorage = {
        version: VERSION,
        setItem: setItemSafe,

        setJSON(key, value) {
            return setItemSafe(
                key,
                JSON.stringify(value)
            );
        },

        getJSON(key, fallback) {
            const parsed = parseJSON(
                nativeGetItem.call(
                    window.localStorage,
                    String(key)
                ) || ''
            );

            return parsed == null
                ? fallback
                : parsed;
        },

        removeItem(key) {
            nativeRemoveItem.call(
                window.localStorage,
                String(key)
            );
        },

        reclaimSpace,
        estimate,
        isQuotaError,

        async indexedDBStats() {
            if (!window.LDMStorageDB || typeof window.LDMStorageDB.stats !== 'function') return null;
            return window.LDMStorageDB.stats();
        },

        async migrateToIndexedDB(options) {
            if (!window.LDMStorageDB || typeof window.LDMStorageDB.migrateFromLocalStorage !== 'function') {
                return { skipped: true, reason: 'storage-engine-unavailable' };
            }
            return window.LDMStorageDB.migrateFromLocalStorage(options || {});
        },

        protectedKeys:
            Array.from(PROTECTED_KEYS),

        policies: {
            arrays:
                Object.keys(ARRAY_POLICIES),
            dateMaps:
                Object.keys(OBJECT_DATE_POLICIES)
        }
    };

    window.LDMStorageQuotaGuard = true;
})();

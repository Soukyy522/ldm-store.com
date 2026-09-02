(function () {
    'use strict';

    if (window.LDMStorageHealth) return;

    const VERSION = '27.7.1';
    const WARNING_PERCENT = 80;
    const HIGH_PERCENT = 90;
    const CRITICAL_PERCENT = 97;
    const CHECK_INTERVAL_MS = 2 * 60 * 1000;

    let state = {
        supported: false,
        usage: 0,
        quota: 0,
        percent: 0,
        persisted: null,
        level: 'unknown',
        checkedAt: 0
    };
    let timer = null;

    function levelFor(percent) {
        if (!Number.isFinite(percent)) return 'unknown';
        if (percent >= CRITICAL_PERCENT) return 'critical';
        if (percent >= HIGH_PERCENT) return 'high';
        if (percent >= WARNING_PERCENT) return 'warning';
        return 'normal';
    }

    function formatBytes(value) {
        const amount = Number(value || 0);
        if (!amount) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
        return `${(amount / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
    }

    function removeBanner() {
        document.getElementById('ldmStorageHealthBanner')?.remove();
    }

    function renderBanner() {
        if (!document.body) return;
        removeBanner();
        if (!['warning', 'high', 'critical'].includes(state.level)) return;

        const banner = document.createElement('div');
        banner.id = 'ldmStorageHealthBanner';
        const isCritical = state.level === 'critical';
        const isHigh = state.level === 'high';
        banner.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:16px',
            'z-index:100000',
            'max-width:390px',
            'padding:13px 14px',
            'border-radius:13px',
            `background:${isCritical ? '#7f1d1d' : isHigh ? '#92400e' : '#0d2240'}`,
            'color:#fff',
            'box-shadow:0 12px 32px #0004',
            'font:600 13px/1.45 system-ui,sans-serif'
        ].join(';');

        const title = isCritical
            ? 'Penyimpanan perangkat kritis'
            : isHigh
                ? 'Penyimpanan hampir penuh'
                : 'Penyimpanan mulai tinggi';
        const action = navigator.onLine
            ? 'Sinkronkan data dan buka Aplikasi & Update untuk membersihkan cache aman.'
            : 'Jangan menambah banyak transaksi offline sebelum perangkat kembali online.';

        banner.innerHTML = `
            <div style="font-weight:800;margin-bottom:3px">${title} · ${state.percent.toFixed(1)}%</div>
            <div style="opacity:.92">${formatBytes(state.usage)} dari ${formatBytes(state.quota)} terpakai. ${action}</div>
            <div style="display:flex;gap:8px;margin-top:9px">
                <a href="pwa-settings.html" style="color:#0d2240;background:#fff;padding:7px 10px;border-radius:8px;text-decoration:none;font-weight:800">Kelola Storage</a>
                <button type="button" data-close style="border:0;background:#ffffff22;color:#fff;padding:7px 10px;border-radius:8px;font-weight:800;cursor:pointer">Tutup</button>
            </div>`;
        banner.querySelector('[data-close]').onclick = () => banner.remove();
        document.body.appendChild(banner);
    }

    async function check(options = {}) {
        let info = null;
        try {
            if (window.LDMStorageDB && typeof window.LDMStorageDB.estimate === 'function') {
                info = await window.LDMStorageDB.estimate();
            } else if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                const estimate = await navigator.storage.estimate();
                let persisted = null;
                if (typeof navigator.storage.persisted === 'function') {
                    try { persisted = await navigator.storage.persisted(); } catch (_) {}
                }
                info = {
                    supported: true,
                    usage: Number(estimate.usage || 0),
                    quota: Number(estimate.quota || 0),
                    persisted
                };
                info.percent = info.quota > 0 ? (info.usage / info.quota) * 100 : 0;
            }
        } catch (_) {}

        if (!info) {
            state = { ...state, supported: false, level: 'unknown', checkedAt: Date.now() };
            return { ...state };
        }

        state = {
            supported: info.supported !== false,
            usage: Number(info.usage || 0),
            quota: Number(info.quota || 0),
            percent: Number(info.percent || 0),
            persisted: info.persisted == null ? null : info.persisted === true,
            level: levelFor(Number(info.percent || 0)),
            checkedAt: Date.now()
        };

        window.dispatchEvent(new CustomEvent('ldm:storage-health-changed', { detail: { ...state } }));
        if (options.render !== false) renderBanner();
        return { ...state };
    }

    function getState() { return { ...state }; }
    function isCritical() { return state.level === 'critical'; }

    function start() {
        if (timer) return;
        const run = () => check().catch(() => {});
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run, { once: true });
        } else {
            run();
        }
        timer = setInterval(run, CHECK_INTERVAL_MS);
    }

    window.addEventListener('ldm:storage-quota-full', () => {
        check().catch(() => {});
        if (document.body) renderBanner();
    });
    window.addEventListener('online', () => check().catch(() => {}));

    window.LDMStorageHealth = Object.freeze({
        version: VERSION,
        check,
        getState,
        isCritical,
        thresholds: Object.freeze({ warning: WARNING_PERCENT, high: HIGH_PERCENT, critical: CRITICAL_PERCENT })
    });

    start();
})();

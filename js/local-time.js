(function (global) {
    "use strict";

    const pad = value => String(value).padStart(2, "0");

    function asDate(value) {
        if (value instanceof Date) return new Date(value.getTime());
        if (value === undefined || value === null || value === "") return new Date();
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : new Date();
    }

    function timeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
        } catch (_error) {
            return "Local";
        }
    }

    function offsetMinutes(value) {
        return -asDate(value).getTimezoneOffset();
    }

    function zoneLabel(value) {
        const zone = timeZone();
        const offset = offsetMinutes(value);
        if (/Asia\/(Jakarta|Pontianak)/i.test(zone) || offset === 420) return "WIB";
        if (/Asia\/(Makassar|Ujung_Pandang)/i.test(zone) || offset === 480) return "WITA";
        if (/Asia\/Jayapura/i.test(zone) || offset === 540) return "WIT";
        const sign = offset >= 0 ? "+" : "-";
        const absolute = Math.abs(offset);
        return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
    }

    function dateKey(value) {
        const date = asDate(value);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function timeKey(value, includeSeconds = true) {
        const date = asDate(value);
        const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        return includeSeconds ? `${base}:${pad(date.getSeconds())}` : base;
    }

    function dateTimeParts(value) {
        return { date: dateKey(value), time: timeKey(value), zone: zoneLabel(value) };
    }

    function previousDateKey(value) {
        const date = asDate(value);
        date.setDate(date.getDate() - 1);
        return dateKey(date);
    }

    function startOfDay(value) {
        const date = asDate(value);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function nextMidnight(value) {
        const date = startOfDay(value);
        date.setDate(date.getDate() + 1);
        return date;
    }

    function millisecondsUntilNextMidnight(value) {
        const now = asDate(value);
        return Math.max(0, nextMidnight(now).getTime() - now.getTime());
    }

    function localDateTimeToISO(dateValue, timeValue) {
        const date = String(dateValue || "").trim();
        let time = String(timeValue || "00:00:00").trim() || "00:00:00";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        if (/^\d{2}:\d{2}$/.test(time)) time += ":00";
        if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;

        const [year, month, day] = date.split("-").map(Number);
        const [hour, minute, second] = time.split(":").map(Number);
        const local = new Date(year, month - 1, day, hour, minute, second, 0);
        if (!Number.isFinite(local.getTime())) return null;
        return local.toISOString();
    }

    function formatDate(value, options) {
        return new Intl.DateTimeFormat("id-ID", options || {
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(asDate(value));
    }

    function formatTime(value, options) {
        return new Intl.DateTimeFormat("id-ID", options || {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(asDate(value)).replace(/\./g, ":");
    }

    function formatDateTime(value, options) {
        return new Intl.DateTimeFormat("id-ID", options || {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(asDate(value));
    }

    function refreshZoneLabels(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const label = zoneLabel();
        scope.querySelectorAll("[data-local-zone]").forEach(element => {
            element.textContent = label;
        });
    }

    function replaceFixedZoneText(root) {
        const label = zoneLabel();
        if (label === "WITA" || typeof document === "undefined") return;
        const scope = root && root.nodeType ? root : document.body;
        if (!scope) return;

        if (scope.nodeType === Node.TEXT_NODE) {
            if (/\bWITA\b/.test(scope.nodeValue || "")) {
                scope.nodeValue = scope.nodeValue.replace(/\bWITA\b/g, label);
            }
            return;
        }

        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            if (/\bWITA\b/.test(node.nodeValue || "")) {
                node.nodeValue = node.nodeValue.replace(/\bWITA\b/g, label);
            }
        });
    }

    global.LDMLocalTime = Object.freeze({
        timeZone,
        zoneLabel,
        offsetMinutes,
        dateKey,
        timeKey,
        dateTimeParts,
        previousDateKey,
        startOfDay,
        nextMidnight,
        millisecondsUntilNextMidnight,
        localDateTimeToISO,
        formatDate,
        formatTime,
        formatDateTime,
        refreshZoneLabels,
        replaceFixedZoneText
    });

    if (typeof document !== "undefined") {
        document.addEventListener("DOMContentLoaded", () => {
            refreshZoneLabels(document);
            replaceFixedZoneText(document.body);
            const observer = new MutationObserver(records => {
                records.forEach(record => {
                    record.addedNodes.forEach(node => replaceFixedZoneText(node));
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });

            let activeLocalDate = dateKey();
            setInterval(() => {
                const nextLocalDate = dateKey();
                if (nextLocalDate === activeLocalDate) return;
                const previousLocalDate = activeLocalDate;
                activeLocalDate = nextLocalDate;
                global.dispatchEvent(new CustomEvent("ldm:local-day-changed", {
                    detail: {
                        previousDate: previousLocalDate,
                        currentDate: nextLocalDate,
                        zone: zoneLabel()
                    }
                }));
            }, 1000);
        });
    }
})(window);

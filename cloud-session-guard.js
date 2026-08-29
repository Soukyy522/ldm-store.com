(function(){
    "use strict";

    const root =
        document.documentElement;

    root.classList.add(
        "ldm-cloud-auth-pending"
    );

    function addPendingStyle(){
        if(
            document.getElementById(
                "ldmCloudAuthPendingStyle"
            )
        ){
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "ldmCloudAuthPendingStyle";

        style.textContent =
            "html.ldm-cloud-auth-pending body{visibility:hidden!important;}";

        document.head.appendChild(
            style
        );
    }

    addPendingStyle();

    function hasCachedOfflineLease(){
        try{
            const lease = JSON.parse(
                localStorage.getItem("ldmOfflineLeaseV16") || "null"
            );
            return Boolean(
                lease &&
                lease.version === 16 &&
                lease.device_status === "active" &&
                Number(lease.expires_at_ms || 0) > Date.now() &&
                String(lease.user_id || "") === String(localStorage.getItem("ldmCloudUserId") || "") &&
                String(lease.store_id || "") === String(localStorage.getItem("ldmCloudStoreId") || "") &&
                String(lease.client_device_id || "") === String(localStorage.getItem("ldmCloudDeviceId") || "")
            );
        }catch(error){
            return false;
        }
    }

    function failAuth(
        error
    ){
        console.error(
            "Cloud Auth Guard:",
            error
        );

        const retryableNetworkFailure =
            window.LDMOfflineQueue &&
            typeof window.LDMOfflineQueue.isRetryableNetworkError === "function"
                ? window.LDMOfflineQueue.isRetryableNetworkError(error)
                : navigator.onLine === false || /failed to fetch|network|offline|connection|timeout/i.test(String(error && error.message || error || ""));

        const preserveOfflineLease = Boolean(
            retryableNetworkFailure &&
            (
                (
                    window.LDMOfflineQueue &&
                    typeof window.LDMOfflineQueue.validLease === "function" &&
                    window.LDMOfflineQueue.validLease()
                )
                || hasCachedOfflineLease()
            )
        );

        if(!preserveOfflineLease){
            try{
                if(
                    window.LDMCloudSession
                ){
                    window.LDMCloudSession
                        .clearCompatibilityCache();
                }
            }catch(cacheError){
                console.warn(
                    cacheError
                );
            }
        }

        const message =
            encodeURIComponent(
                error &&
                error.message
                    ? error.message
                    : "Session cloud tidak valid."
            );

        root.classList.remove(
            "ldm-cloud-auth-pending",
            "secure-page-pending"
        );

        if(preserveOfflineLease){
            window.location.replace(
                "kasir.html?offlineFallback=1"
            );
            return;
        }

        window.location.replace(
            `index.html?cloudAuthError=${message}`
        );
    }

    function patchLogoutFunctions(){
        if(
            !window.LDMCloudSession
        ){
            return;
        }

        const cloudLogout =
            function(){
                return window
                    .LDMCloudSession
                    .logout(
                        "index.html"
                    );
            };

        [
            "secureLogout",
            "logout",
            "logoutSession"
        ].forEach(
            name => {
                if(
                    typeof window[name] ===
                    "function"
                ){
                    window[name] =
                        cloudLogout;
                }
            }
        );
    }

    async function boot(){
        if(
            !window.LDMSupabase ||
            !window.LDMSupabase
                .isConfigured()
        ){
            throw new Error(
                "Supabase belum dikonfigurasi."
            );
        }

        if(
            !window.LDMCloudSession
        ){
            throw new Error(
                "Cloud Session helper tidak termuat."
            );
        }

        const context =
            await window.LDMCloudSession
                .ensureAuthenticated({
                    registerDevice:
                        true
                });

        const role =
            window.LDMCloudSession
                .normalizeRole(
                    context.profile.role
                );

        if(
            ![
                "owner",
                "admin",
                "kasir"
            ].includes(role)
        ){
            throw new Error(
                "Role profile cloud tidak valid."
            );
        }

        const pageName =
            String(
                window.location.pathname
                    .split("/")
                    .pop() || ""
            ).toLowerCase();

        if(
            pageName !== "device-access.html" &&
            window.LDMCloudAuth &&
            typeof window.LDMCloudAuth.getCurrentDeviceAccess ===
                "function"
        ){
            const deviceAccess =
                await window.LDMCloudAuth
                    .getCurrentDeviceAccess();

            const deviceStatus =
                String(
                    deviceAccess &&
                    deviceAccess.status ||
                    "unknown"
                ).toLowerCase();

            if(deviceStatus !== "active"){
                root.classList.remove(
                    "ldm-cloud-auth-pending",
                    "secure-page-pending"
                );

                window.location.replace(
                    "device-access.html"
                );

                return context;
            }

            if(
                window.LDMOfflineQueue &&
                typeof window.LDMOfflineQueue.rememberVerifiedContext === "function"
            ){
                window.LDMOfflineQueue.rememberVerifiedContext(
                    context,
                    deviceAccess
                );
            }
        }

        patchLogoutFunctions();

        root.classList.remove(
            "ldm-cloud-auth-pending",
            "secure-page-pending"
        );

        window.dispatchEvent(
            new CustomEvent(
                "ldm-cloud-auth-ready",
                {
                    detail:
                        context
                }
            )
        );

        return context;
    }

    async function bootWithOfflineFallback(){
        try{
            return await boot();
        }catch(error){
            const offlineContext =
                window.LDMOfflineQueue &&
                typeof window.LDMOfflineQueue.offlineContextForError === "function"
                    ? window.LDMOfflineQueue.offlineContextForError(error)
                    : null;

            if(!offlineContext){
                throw error;
            }

            patchLogoutFunctions();

            root.classList.remove(
                "ldm-cloud-auth-pending",
                "secure-page-pending"
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-cloud-auth-ready",
                    {
                        detail:offlineContext
                    }
                )
            );

            window.dispatchEvent(
                new CustomEvent(
                    "ldm-cloud-auth-offline-ready",
                    {
                        detail:offlineContext
                    }
                )
            );

            console.warn(
                "LocDailyMar berjalan dalam mode offline terbatas. Data transaksi akan masuk antrean perangkat."
            );

            return offlineContext;
        }
    }

    window.LDMCloudGuard =
        Object.freeze({
            boot,
            patchLogoutFunctions
        });

    /*
     * Mulai sedini mungkin, sebelum DOMContentLoaded.
     * Ini membantu cache kompatibilitas tersedia sebelum
     * guard legacy halaman ikut berjalan.
     */
    bootWithOfflineFallback()
        .then(
            () => {
                if(
                    document.readyState ===
                    "loading"
                ){
                    document.addEventListener(
                        "DOMContentLoaded",
                        patchLogoutFunctions,
                        {
                            once:
                                true
                        }
                    );
                }else{
                    patchLogoutFunctions();
                }

                window.addEventListener(
                    "load",
                    patchLogoutFunctions,
                    {
                        once:
                            true
                    }
                );
            }
        )
        .catch(
            failAuth
        );
})();

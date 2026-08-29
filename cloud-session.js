(function(){
    "use strict";

    const VALID_ROLES =
        new Set([
            "owner",
            "admin",
            "kasir"
        ]);

    const CACHE_KEYS = [
        "loginSession",
        "isLoggedIn",
        "username",
        "activeUsername",
        "loggedInUser",
        "currentUser",
        "userRole",
        "role",
        "activeUserId",
        "loginTimestamp",
        "ldmAuthSource",
        "ldmCloudUserId",
        "ldmCloudStoreId",
        "ldmCloudStoreCode",
        "ldmCloudStoreName",
        "ldmCloudProfileVersion",
        "ldmOfflineLeaseV16"
    ];

    function normalizeRole(value){
        return String(
            value || ""
        )
            .trim()
            .toLowerCase();
    }

    function clearCompatibilityCache(){
        CACHE_KEYS.forEach(
            key =>
                localStorage.removeItem(
                    key
                )
        );
    }

    function syncCurrentLegacyAccount(
        profile
    ){
        /*
         * daftarAkun belum menjadi sumber Auth.
         * Kita hanya menyamakan role akun yang sedang login
         * supaya halaman legacy yang masih mengecek daftarAkun
         * tidak bentrok dengan role dari Supabase.
         */
        try{
            const raw =
                localStorage.getItem(
                    "daftarAkun"
                );

            if(!raw){
                return;
            }

            const accounts =
                JSON.parse(raw);

            if(!Array.isArray(accounts)){
                return;
            }

            const wanted =
                String(
                    profile.username || ""
                )
                    .trim()
                    .toLowerCase();

            if(!wanted){
                return;
            }

            const target =
                accounts.find(
                    account =>
                        String(
                            account &&
                            account.username ||
                            ""
                        )
                            .trim()
                            .toLowerCase()
                        === wanted
                );

            if(!target){
                return;
            }

            const role =
                normalizeRole(
                    profile.role
                );

            if(
                VALID_ROLES.has(role)
                &&
                target.role !== role
            ){
                target.role =
                    role;

                localStorage.setItem(
                    "daftarAkun",
                    JSON.stringify(
                        accounts
                    )
                );
            }
        }catch(error){
            console.warn(
                "Gagal menyinkronkan cache akun legacy:",
                error
            );
        }
    }

    function writeCompatibilityCache(
        context
    ){
        if(
            !context ||
            !context.user ||
            !context.profile
        ){
            throw new Error(
                "Context Auth cloud tidak lengkap."
            );
        }

        const user =
            context.user;

        const profile =
            context.profile;

        const username =
            String(
                profile.username || ""
            ).trim();

        const role =
            normalizeRole(
                profile.role
            );

        if(!username){
            throw new Error(
                "Profile cloud tidak memiliki username."
            );
        }

        if(
            !VALID_ROLES.has(role)
        ){
            throw new Error(
                "Role cloud tidak valid."
            );
        }

        const now =
            Date.now();

        const compatibilitySession = {
            token:
                `cloud:${user.id}:${now}`,
            username:
                username,
            role:
                role,
            authSource:
                "supabase",
            createdAt:
                now,
            expiresAt:
                now + (
                    12 *
                    60 *
                    60 *
                    1000
                )
        };

        localStorage.setItem(
            "loginSession",
            JSON.stringify(
                compatibilitySession
            )
        );

        localStorage.setItem(
            "isLoggedIn",
            "true"
        );

        [
            "username",
            "activeUsername",
            "loggedInUser",
            "currentUser"
        ].forEach(
            key =>
                localStorage.setItem(
                    key,
                    username
                )
        );

        localStorage.setItem(
            "userRole",
            role
        );

        localStorage.setItem(
            "role",
            role
        );

        localStorage.setItem(
            "activeUserId",
            String(
                user.id || ""
            )
        );

        localStorage.setItem(
            "loginTimestamp",
            String(now)
        );

        localStorage.setItem(
            "ldmAuthSource",
            "supabase"
        );

        localStorage.setItem(
            "ldmCloudUserId",
            String(
                user.id || ""
            )
        );

        localStorage.setItem(
            "ldmCloudStoreId",
            String(
                profile.store_id || ""
            )
        );

        localStorage.setItem(
            "ldmCloudStoreCode",
            String(
                profile.store_code || ""
            )
        );

        localStorage.setItem(
            "ldmCloudStoreName",
            String(
                profile.store_name || ""
            )
        );

        localStorage.setItem(
            "ldmCloudProfileVersion",
            String(
                profile.profile_version || ""
            )
        );

        syncCurrentLegacyAccount(
            profile
        );

        return {
            username,
            role,
            userId:
                user.id,
            storeId:
                profile.store_id,
            storeCode:
                profile.store_code
        };
    }

    function requireHelpers(){
        if(
            !window.LDMCloudAuth
            ||
            typeof window.LDMCloudAuth.getContext !==
                "function"
        ){
            throw new Error(
                "Helper Supabase Auth belum termuat."
            );
        }
    }

    async function ensureAuthenticated(
        options = {}
    ){
        requireHelpers();

        const context =
            await window.LDMCloudAuth
                .getContext();

        if(!context){
            throw new Error(
                "Session Supabase Auth tidak ditemukan."
            );
        }

        writeCompatibilityCache(
            context
        );

        if(
            options.registerDevice !== false
        ){
            try{
                await window.LDMCloudAuth
                    .registerCurrentDevice();
            }catch(error){
                console.warn(
                    "Registrasi device gagal:",
                    error
                );
            }
        }

        return context;
    }

    async function signIn(
        email,
        password
    ){
        requireHelpers();

        await window.LDMCloudAuth
            .signIn(
                email,
                password
            );

        try{
            return await ensureAuthenticated({
                registerDevice:
                    true
            });
        }catch(error){
            try{
                await window.LDMCloudAuth
                    .signOut();
            }catch(signOutError){
                console.warn(
                    "Rollback Auth gagal:",
                    signOutError
                );
            }

            clearCompatibilityCache();

            throw error;
        }
    }

    async function logout(
        redirectTo = "index.html"
    ){
        try{
            if(
                window.LDMCloudAuth &&
                typeof window.LDMCloudAuth.signOut ===
                    "function"
            ){
                await window.LDMCloudAuth
                    .signOut();
            }
        }catch(error){
            console.warn(
                "Supabase signOut gagal, cache lokal tetap dibersihkan:",
                error
            );
        }finally{
            clearCompatibilityCache();

            if(
                window.LDMOfflineQueue &&
                typeof window.LDMOfflineQueue.clearLease === "function"
            ){
                window.LDMOfflineQueue.clearLease();
            }

            window.location.replace(
                redirectTo
            );
        }
    }

    async function resume(){
        requireHelpers();

        const context =
            await window.LDMCloudAuth
                .getContext();

        if(!context){
            clearCompatibilityCache();
            return null;
        }

        writeCompatibilityCache(
            context
        );

        return context;
    }

    function getCachedIdentity(){
        return {
            source:
                localStorage.getItem(
                    "ldmAuthSource"
                ),
            username:
                localStorage.getItem(
                    "username"
                ),
            role:
                localStorage.getItem(
                    "userRole"
                ),
            userId:
                localStorage.getItem(
                    "ldmCloudUserId"
                ),
            storeId:
                localStorage.getItem(
                    "ldmCloudStoreId"
                ),
            storeCode:
                localStorage.getItem(
                    "ldmCloudStoreCode"
                )
        };
    }

    window.LDMCloudSession =
        Object.freeze({
            normalizeRole,
            clearCompatibilityCache,
            writeCompatibilityCache,
            ensureAuthenticated,
            signIn,
            logout,
            resume,
            getCachedIdentity
        });
})();

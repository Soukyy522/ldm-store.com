(function(){
    "use strict";

    const DEVICE_KEY =
        "ldmCloudDeviceId";

    function getClient(){
        if(
            !window.LDMSupabase ||
            typeof window.LDMSupabase.createClient !== "function"
        ){
            throw new Error(
                "LDMSupabase belum tersedia."
            );
        }

        return window.LDMSupabase.createClient();
    }

    function getOrCreateDeviceId(){
        let id =
            localStorage.getItem(
                DEVICE_KEY
            );

        if(id){
            return id;
        }

        if(
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ){
            id =
                window.crypto.randomUUID();
        }else{
            const bytes =
                new Uint8Array(16);

            window.crypto.getRandomValues(
                bytes
            );

            id =
                Array
                    .from(bytes)
                    .map(
                        value =>
                            value
                                .toString(16)
                                .padStart(2, "0")
                    )
                    .join("");
        }

        localStorage.setItem(
            DEVICE_KEY,
            id
        );

        return id;
    }

    function getDeviceName(){
        const platform =
            navigator.userAgentData &&
            navigator.userAgentData.platform
                ? navigator.userAgentData.platform
                : navigator.platform || "Browser";

        return `LocDailyMar - ${platform}`;
    }

    function getPlatformInfo(){
        return (
            navigator.userAgent ||
            navigator.platform ||
            "Unknown"
        ).slice(0, 500);
    }

    async function signIn(
        email,
        password
    ){
        const normalizedEmail =
            String(email || "")
                .trim()
                .toLowerCase();

        if(!normalizedEmail){
            throw new Error(
                "Email wajib diisi."
            );
        }

        if(!password){
            throw new Error(
                "Password wajib diisi."
            );
        }

        const client =
            getClient();

        const {
            data,
            error
        } =
            await client.auth.signInWithPassword({
                email:
                    normalizedEmail,
                password:
                    password
            });

        if(error){
            throw error;
        }

        if(
            !data ||
            !data.user
        ){
            throw new Error(
                "Supabase tidak mengembalikan user setelah login."
            );
        }

        return data;
    }

    async function signOut(){
        const client =
            getClient();

        const {
            error
        } =
            await client.auth.signOut();

        if(error){
            throw error;
        }

        return true;
    }

    async function getUser(){
        const client =
            getClient();

        const {
            data,
            error
        } =
            await client.auth.getUser();

        if(error){
            throw error;
        }

        return (
            data &&
            data.user
                ? data.user
                : null
        );
    }

    async function getContext(){
        const client =
            getClient();

        const user =
            await getUser();

        if(!user){
            return null;
        }

        const {
            data,
            error
        } =
            await client.rpc(
                "ldm_my_context"
            );

        if(error){
            throw error;
        }

        const context =
            Array.isArray(data)
                ? data[0]
                : data;

        if(!context){
            throw new Error(
                "Auth berhasil, tetapi profile LocDailyMar belum ditemukan. Jalankan bootstrap Owner/Profile."
            );
        }

        return {
            user,
            profile:
                context
        };
    }

    async function registerCurrentDevice(){
        const client =
            getClient();

        const clientDeviceId =
            getOrCreateDeviceId();

        const {
            data,
            error
        } =
            await client.rpc(
                "ldm_register_device",
                {
                    p_client_device_id:
                        clientDeviceId,
                    p_device_name:
                        getDeviceName(),
                    p_platform:
                        getPlatformInfo()
                }
            );

        if(error){
            throw error;
        }

        return {
            id:
                data,
            clientDeviceId
        };
    }

    async function listDevices(){
        const client =
            getClient();

        const {
            data,
            error
        } =
            await client.rpc(
                "ldm_my_devices"
            );

        if(error){
            throw error;
        }

        return (
            Array.isArray(data)
                ? data
                : []
        );
    }

    async function getCurrentDeviceAccess(){
        const client =
            getClient();

        const clientDeviceId =
            getOrCreateDeviceId();

        const {
            data,
            error
        } = await client.rpc(
            "ldm_current_device_access",
            {
                p_client_device_id:
                    clientDeviceId
            }
        );

        if(error){
            throw error;
        }

        const access =
            Array.isArray(data)
                ? data[0]
                : data;

        return access || {
            client_device_id:
                clientDeviceId,
            status:
                "unknown"
        };
    }

    function watchAuth(callback){
        const client =
            getClient();

        const {
            data
        } =
            client.auth.onAuthStateChange(
                function(
                    event,
                    session
                ){
                    if(
                        typeof callback === "function"
                    ){
                        callback(
                            event,
                            session
                        );
                    }
                }
            );

        return (
            data &&
            data.subscription
                ? data.subscription
                : null
        );
    }

    window.LDMCloudAuth =
        Object.freeze({
            getClient,
            signIn,
            signOut,
            getUser,
            getContext,
            registerCurrentDevice,
            listDevices,
            getCurrentDeviceAccess,
            getOrCreateDeviceId,
            watchAuth
        });
})();

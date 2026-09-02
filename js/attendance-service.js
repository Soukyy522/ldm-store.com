(function(){
    "use strict";

    const CACHE_KEY =
        "dataAbsensi";

    const PROFILE_CACHE_KEY =
        "ldmAttendanceProfiles";

    const ENABLED_KEY =
        "ldmAttendanceCloudEnabled";

    const LAST_SYNC_KEY =
        "ldmAttendanceLastSyncAt";

    const BUCKET =
        "ldm-attendance-proofs";

    const CHANNEL_NAME =
        "ldm-attendance-realtime-v9";

    let channel = null;

    function client(){
        if(
            !window.LDMSupabase ||
            typeof window.LDMSupabase.createClient !==
                "function"
        ){
            throw new Error(
                "Supabase client belum tersedia."
            );
        }

        return window.LDMSupabase
            .createClient();
    }

    function createUUID(){
        if(
            window.crypto &&
            typeof window.crypto.randomUUID ===
                "function"
        ){
            return window.crypto.randomUUID();
        }

        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        const hex = Array.from(bytes)
            .map(
                value => value
                    .toString(16)
                    .padStart(2, "0")
            )
            .join("");

        return [
            hex.slice(0,8),
            hex.slice(8,12),
            hex.slice(12,16),
            hex.slice(16,20),
            hex.slice(20)
        ].join("-");
    }

    function normalizeUsername(value){
        return String(value || "")
            .normalize("NFKC")
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function readCache(){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(
                    CACHE_KEY
                ) || "[]"
            );

            return Array.isArray(parsed)
                ? parsed
                : [];
        }catch(error){
            return [];
        }
    }

    function readProfilesCache(){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(
                    PROFILE_CACHE_KEY
                ) || "[]"
            );

            return Array.isArray(parsed)
                ? parsed
                : [];
        }catch(error){
            return [];
        }
    }

    function isEnabled(){
        return localStorage.getItem(
            ENABLED_KEY
        ) === "true";
    }

    function hasLegacyUnmigrated(){
        return readCache().some(
            item =>
                item &&
                !item._cloud
        );
    }

    async function getContext(){
        if(!window.LDMCloudSession){
            throw new Error(
                "Cloud Session belum tersedia."
            );
        }

        return await window.LDMCloudSession
            .ensureAuthenticated({
                registerDevice:false
            });
    }

    function pad(value){
        return String(value)
            .padStart(2, "0");
    }

    function formatLocalParts(iso){
        if(!iso){
            return {
                date: "",
                time: ""
            };
        }

        const d = new Date(iso);

        if(!Number.isFinite(d.getTime())){
            return {
                date: "",
                time: ""
            };
        }

        const parts = new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: "Asia/Makassar",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }
        ).formatToParts(d);

        const map = {};
        parts.forEach(
            part => {
                if(part.type !== "literal"){
                    map[part.type] = part.value;
                }
            }
        );

        return {
            date: `${map.year}-${map.month}-${map.day}`,
            time: `${map.hour}:${map.minute}`
        };
    }

    async function signedURL(path){
        if(!path){
            return "";
        }

        const supabase = client();

        const {
            data,
            error
        } = await supabase
            .storage
            .from(BUCKET)
            .createSignedUrl(
                path,
                3600
            );

        if(error){
            console.warn(
                "Signed URL bukti presensi gagal:",
                error
            );
            return "";
        }

        return data && data.signedUrl
            ? data.signedUrl
            : "";
    }

    async function rowsToLegacy(rows){
        const result = [];

        for(const row of (Array.isArray(rows) ? rows : [])){
            const local = formatLocalParts(
                row.recorded_at
            );

            let proofURL = "";

            if(row.proof_path){
                proofURL = await signedURL(
                    row.proof_path
                );
            }

            result.push({
                id: row.id,
                tanggal:
                    row.attendance_date ||
                    local.date,
                waktu:
                    local.time,
                username:
                    row.username_snapshot ||
                    row.username ||
                    "",
                jenis:
                    row.attendance_type,
                shift:
                    row.shift_label || "-",
                surat:
                    proofURL,
                catatan:
                    row.note || "",
                _proofPath:
                    row.proof_path || null,
                _cloud: {
                    id:
                        row.id,
                    userId:
                        row.user_id,
                    recordedAt:
                        row.recorded_at
                }
            });
        }

        return result;
    }

    function mergeRows(base, extra){
        const map = new Map();

        [...base, ...extra].forEach(
            row => {
                if(row && row.id){
                    map.set(
                        String(row.id),
                        row
                    );
                }
            }
        );

        return Array.from(map.values())
            .sort(
                (a,b) =>
                    new Date(a.recorded_at || 0) -
                    new Date(b.recorded_at || 0)
            );
    }

    async function fetchProfiles(){
        const supabase = client();

        const {
            data,
            error
        } = await supabase.rpc(
            "ldm_attendance_profiles"
        );

        if(error){
            throw error;
        }

        const profiles = (
            Array.isArray(data)
                ? data
                : []
        ).map(
            row => ({
                id: row.id,
                username: row.username,
                role: row.role
            })
        );

        localStorage.setItem(
            PROFILE_CACHE_KEY,
            JSON.stringify(profiles)
        );

        window.dispatchEvent(
            new CustomEvent(
                "ldm-attendance-profiles-updated",
                {
                    detail: {
                        count:
                            profiles.length
                    }
                }
            )
        );

        return profiles;
    }

    async function fetchCloudRows(){
        const context =
            await getContext();

        const supabase = client();

        let query = supabase
            .from("attendance")
            .select(
                [
                    "id",
                    "store_id",
                    "user_id",
                    "username_snapshot",
                    "attendance_date",
                    "attendance_type",
                    "shift_label",
                    "proof_path",
                    "note",
                    "recorded_at",
                    "version"
                ].join(",")
            )
            .order(
                "recorded_at",
                {
                    ascending:true
                }
            );

        const {
            data: history,
            error: historyError
        } = await query;

        if(historyError){
            throw historyError;
        }

        const {
            data: today,
            error: todayError
        } = await supabase.rpc(
            "ldm_attendance_today"
        );

        if(todayError){
            throw todayError;
        }

        return {
            context,
            rows: mergeRows(
                Array.isArray(history) ? history : [],
                Array.isArray(today) ? today.map(row => ({
                    id: row.id,
                    user_id: row.user_id,
                    username_snapshot: row.username,
                    attendance_date: row.attendance_date,
                    attendance_type: row.attendance_type,
                    shift_label: row.shift_label,
                    note: row.note,
                    proof_path: row.proof_path,
                    recorded_at: row.recorded_at
                })) : []
            )
        };
    }

    async function refreshCache(options = {}){
        const fetched =
            await fetchCloudRows();

        const rows = fetched.rows;

        const preserveLegacy =
            options.preserveLegacy !== false &&
            !isEnabled() &&
            hasLegacyUnmigrated() &&
            rows.length === 0;

        if(preserveLegacy){
            return readCache();
        }

        const legacy =
            await rowsToLegacy(rows);

        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify(legacy)
        );

        localStorage.setItem(
            LAST_SYNC_KEY,
            String(Date.now())
        );

        if(
            rows.length > 0 ||
            options.forceEnable === true
        ){
            localStorage.setItem(
                ENABLED_KEY,
                "true"
            );
        }

        window.dispatchEvent(
            new CustomEvent(
                "ldm-attendance-cache-updated",
                {
                    detail: {
                        count:
                            legacy.length
                    }
                }
            )
        );

        return legacy;
    }

    function dataURLToBlob(dataURL){
        const parts = String(dataURL || "")
            .split(",");

        if(parts.length !== 2){
            throw new Error(
                "Format foto tidak valid."
            );
        }

        const match = parts[0].match(
            /data:([^;]+);base64/i
        );

        if(!match){
            throw new Error(
                "Foto bukan data URL Base64."
            );
        }

        const mime = match[1];
        const binary = atob(parts[1]);
        const bytes = new Uint8Array(
            binary.length
        );

        for(let i = 0; i < binary.length; i++){
            bytes[i] = binary.charCodeAt(i);
        }

        return {
            blob: new Blob(
                [bytes],
                {
                    type:mime
                }
            ),
            mime
        };
    }

    function extensionForMime(mime){
        if(mime === "image/png"){
            return "png";
        }

        if(mime === "image/webp"){
            return "webp";
        }

        return "jpg";
    }

    async function uploadProof({
        dataURL,
        storeId,
        userId,
        date,
        prefix = "attendance"
    }){
        if(!dataURL){
            throw new Error(
                "Bukti foto wajib tersedia."
            );
        }

        const converted =
            dataURLToBlob(dataURL);

        if(converted.blob.size > 5 * 1024 * 1024){
            throw new Error(
                "Ukuran bukti foto melebihi 5 MB."
            );
        }

        const ext =
            extensionForMime(
                converted.mime
            );

        const path = [
            storeId,
            userId,
            date,
            `${prefix}-${createUUID()}.${ext}`
        ].join("/");

        const supabase = client();

        const {
            error
        } = await supabase
            .storage
            .from(BUCKET)
            .upload(
                path,
                converted.blob,
                {
                    contentType:
                        converted.mime,
                    upsert:false,
                    cacheControl:"3600"
                }
            );

        if(error){
            throw error;
        }

        return path;
    }

    async function removeProof(path){
        if(!path){
            return;
        }

        const supabase = client();

        const {
            error
        } = await supabase
            .storage
            .from(BUCKET)
            .remove([path]);

        if(error){
            console.warn(
                "Gagal menghapus bukti Storage:",
                error
            );
        }
    }

    async function recordAttendance({
        username,
        type,
        shift,
        note,
        proofDataURL
    }){
        if(
            !isEnabled() &&
            hasLegacyUnmigrated()
        ){
            throw new Error(
                "Data Absensi lama belum dimigrasikan. Jalankan halaman Migrasi Absensi Tahap 9 sebagai Owner terlebih dahulu."
            );
        }

        const context =
            await getContext();

        const profiles =
            await fetchProfiles();

        const wanted = normalizeUsername(username);

        const target = profiles.find(
            profile =>
                normalizeUsername(profile.username) === wanted
        );

        if(!target){
            throw new Error(
                "Profile akun presensi tidak ditemukan di Supabase."
            );
        }

        const role = String(
            context.profile.role || ""
        ).toLowerCase();

        if(
            role !== "owner" &&
            target.id !== context.user.id
        ){
            throw new Error(
                "Akun ini hanya boleh melakukan presensi untuk dirinya sendiri."
            );
        }

        const date = new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:"Asia/Makassar",
                year:"numeric",
                month:"2-digit",
                day:"2-digit"
            }
        ).format(new Date());

        const proofPath =
            await uploadProof({
                dataURL:proofDataURL,
                storeId:context.profile.store_id,
                userId:target.id,
                date,
                prefix:String(type || "attendance")
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
            });

        const supabase = client();

        try{
            const {
                data,
                error
            } = await supabase.rpc(
                "ldm_record_attendance",
                {
                    p_target_user_id:
                        target.id,
                    p_attendance_type:
                        type,
                    p_shift_label:
                        shift || null,
                    p_note:
                        note || null,
                    p_proof_path:
                        proofPath
                }
            );

            if(error){
                throw error;
            }

            localStorage.setItem(
                ENABLED_KEY,
                "true"
            );

            await refreshCache({
                forceEnable:true,
                preserveLegacy:false
            });

            return data;

        }catch(error){
            await removeProof(
                proofPath
            );
            throw error;
        }
    }

    async function softDelete(attendanceId){
        const supabase = client();

        const {
            data,
            error
        } = await supabase.rpc(
            "ldm_soft_delete_attendance",
            {
                p_attendance_id:
                    attendanceId
            }
        );

        if(error){
            throw error;
        }

        if(data && data.proof_path){
            await removeProof(
                data.proof_path
            );
        }

        await refreshCache({
            forceEnable:true,
            preserveLegacy:false
        });

        return data;
    }

    async function migrateLegacy(items = null){
        const context =
            await getContext();

        if(
            String(context.profile.role || "")
                .toLowerCase() !== "owner"
        ){
            throw new Error(
                "Hanya Owner yang dapat migrasi Absensi lama."
            );
        }

        const profiles =
            await fetchProfiles();

        const profileMap = new Map(
            profiles.map(
                profile => [
                    normalizeUsername(profile.username),
                    profile
                ]
            )
        );

        const source = Array.isArray(items)
            ? items
            : readCache();

        const legacy = source.filter(
            item => item && !item._cloud
        );

        if(legacy.length === 0){
            throw new Error(
                "Tidak ada dataAbsensi legacy yang perlu dimigrasikan."
            );
        }

        const payload = [];
        const uploadedPaths = [];

        try{
            for(let index = 0; index < legacy.length; index++){
                const item = legacy[index];
                const usernameKey = normalizeUsername(item.username);

                const profile =
                    profileMap.get(
                        usernameKey
                    );

                if(!profile){
                    throw new Error(
                        `Profile cloud untuk ${item.username || "-"} tidak ditemukan.`
                    );
                }

                const date = String(
                    item.tanggal || ""
                ).trim();

                if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
                    throw new Error(
                        `Tanggal legacy tidak valid pada akun ${item.username || "-"}.`
                    );
                }

                let proofPath = null;

                if(
                    item.surat &&
                    String(item.surat)
                        .startsWith("data:image/")
                ){
                    proofPath = await uploadProof({
                        dataURL:item.surat,
                        storeId:context.profile.store_id,
                        userId:profile.id,
                        date,
                        prefix:`legacy-${String(item.id || index)}`
                    });

                    uploadedPaths.push(
                        proofPath
                    );
                }

                payload.push({
                    legacy_source_id:
                        `dataAbsensi:${String(item.id || `${date}:${item.username}:${item.jenis}:${item.waktu}:${index}`)}`,
                    username:
                        item.username,
                    attendance_date:
                        date,
                    attendance_time:
                        item.waktu || "00:00",
                    attendance_type:
                        item.jenis === "Hadir"
                            ? "Masuk"
                            : item.jenis,
                    shift_label:
                        item.shift && item.shift !== "-"
                            ? item.shift
                            : null,
                    proof_path:
                        proofPath,
                    note:
                        item.catatan || null
                });
            }

            const supabase = client();

            const {
                data,
                error
            } = await supabase.rpc(
                "ldm_import_legacy_attendance",
                {
                    p_rows:
                        payload
                }
            );

            if(error){
                throw error;
            }

            localStorage.setItem(
                ENABLED_KEY,
                "true"
            );

            const cache =
                await refreshCache({
                    forceEnable:true,
                    preserveLegacy:false
                });

            return {
                processed:
                    Number(data) || payload.length,
                cache
            };

        }catch(error){
            if(uploadedPaths.length > 0){
                const supabase = client();
                try{
                    await supabase
                        .storage
                        .from(BUCKET)
                        .remove(uploadedPaths);
                }catch(cleanupError){
                    console.warn(
                        "Cleanup migrasi proof gagal:",
                        cleanupError
                    );
                }
            }

            throw error;
        }
    }

    async function startRealtime(){
        if(channel){
            return channel;
        }

        const context =
            await getContext();

        const storeId =
            context.profile.store_id;

        const supabase = client();

        channel = supabase
            .channel(
                CHANNEL_NAME
            )
            .on(
                "postgres_changes",
                {
                    event:"*",
                    schema:"public",
                    table:"attendance",
                    filter:
                        `store_id=eq.${storeId}`
                },
                async function(){
                    try{
                        localStorage.setItem(
                            ENABLED_KEY,
                            "true"
                        );

                        await refreshCache({
                            forceEnable:true,
                            preserveLegacy:false
                        });
                    }catch(error){
                        console.error(
                            "Realtime attendance refresh gagal:",
                            error
                        );
                    }
                }
            )
            .subscribe();

        return channel;
    }

    async function stopRealtime(){
        if(!channel){
            return;
        }

        const supabase = client();

        try{
            await supabase
                .removeChannel(
                    channel
                );
        }finally{
            channel = null;
        }
    }

    async function bootstrap(){
        const context =
            await getContext();

        const profiles =
            await fetchProfiles();

        const cache =
            await refreshCache({
                preserveLegacy:true
            });

        await startRealtime();

        return {
            context,
            profiles,
            cache,
            enabled:isEnabled(),
            legacyPending:
                !isEnabled() &&
                hasLegacyUnmigrated()
        };
    }

    window.LDMAttendance =
        Object.freeze({
            normalizeUsername,
            readCache,
            readProfilesCache,
            isEnabled,
            hasLegacyUnmigrated,
            fetchProfiles,
            refreshCache,
            recordAttendance,
            softDelete,
            migrateLegacy,
            startRealtime,
            stopRealtime,
            bootstrap
        });
})();

(function(){
    "use strict";

    const STORAGE_KEY="ldmPublicCheckoutV27";
    const LEGACY_KEYS=[
        "ldmPublicCheckoutV261",
        "ldmPublicCheckoutV26",
        "ldmPublicCheckoutV25"
    ];
    const LYNK_PENDING_KEY="ldmLynkPendingV27";

    function cfg(){
        const base=window.LDM_LICENSE_V2_CONFIG||{};

        return {
            statusUrl:String(base.checkoutUrl||"").trim(),
            orderUrl:String(base.lynkOrderUrl||"").trim(),
            whatsapp:String(base.developerWhatsApp||"").replace(/\D/g,""),
            links:base.lynkCheckoutLinks||{}
        };
    }

    const el=id=>document.getElementById(id);

    const rupiah=n=>
        new Intl.NumberFormat(
            "id-ID",
            {
                style:"currency",
                currency:"IDR",
                maximumFractionDigits:0
            }
        ).format(Number(n||0));

    const tanggal=v=>
        v
            ? new Date(v).toLocaleString("id-ID")
            : "-";

    const wait=ms=>
        new Promise(r=>setTimeout(r,ms));


    /* =========================================================
       STATUS UI
       ========================================================= */

    function setStatus(text,type="info"){
        const node=el("publicCheckoutStatus");

        if(!node)return;

        node.textContent=text;
        node.className="checkout-status show "+type;
    }


    /* =========================================================
       BILLING / PERIODE
       ========================================================= */

    function cycleLabel(v){
        return v==="two_year"
            ? "2 Tahun"
            : v==="yearly"
                ? "Tahunan"
                : "Bulanan";
    }


    function amountFor(planCode,cycle){
        return Number(
            window.LDM_LICENSE_V2_CONFIG
                ?.plans
                ?.[planCode]
                ?.[cycle]
            ||0
        );
    }


    function savingFor(planCode,cycle){

        const p=
            window.LDM_LICENSE_V2_CONFIG
                ?.plans
                ?.[planCode]
            ||{};

        if(cycle==="yearly"){
            return Math.max(
                0,
                Number(p.monthly||0)*12
                -
                Number(p.yearly||0)
            );
        }

        if(cycle==="two_year"){
            return Math.max(
                0,
                Number(p.monthly||0)*24
                -
                Number(p.two_year||0)
            );
        }

        return 0;
    }


    /* =========================================================
       REQUEST BACKEND
       ========================================================= */

    async function post(url,payload){

        if(
            !/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[a-z0-9-]+$/i
                .test(url)
        ){
            throw new Error(
                "URL backend belum dikonfigurasi."
            );
        }

        const controller=
            new AbortController();

        const timeout=
            setTimeout(
                ()=>controller.abort(),
                20000
            );

        try{

            const res=
                await fetch(
                    url,
                    {
                        method:"POST",

                        headers:{
                            "Content-Type":"application/json"
                        },

                        body:JSON.stringify(payload),

                        cache:"no-store",

                        signal:controller.signal
                    }
                );

            const data=
                await res
                    .json()
                    .catch(()=>({}));

            if(
                !res.ok
                ||
                data?.ok===false
            ){

                const e=
                    new Error(
                        data?.message
                        ||
                        `HTTP ${res.status}`
                    );

                e.code=
                    data?.code
                    ||
                    "REQUEST_FAILED";

                throw e;
            }

            return data;

        }finally{

            clearTimeout(timeout);

        }
    }


    function callStatus(payload){
        return post(
            cfg().statusUrl,
            payload
        );
    }


    function callOrder(payload){
        return post(
            cfg().orderUrl,
            payload
        );
    }


    /* =========================================================
       CURRENT CHECKOUT
       ========================================================= */

    let currentPlan=null;
    let currentReceipt=null;


    function renderSummary(){

        if(!currentPlan)return;

        const cycle=
            el("checkoutPeriod").value;

        el("checkoutPlanName").textContent=
            currentPlan.planName;

        el("checkoutPlanPeriod").textContent=
            cycleLabel(cycle);

        el("checkoutPlanAmount").textContent=
            rupiah(
                amountFor(
                    currentPlan.planCode,
                    cycle
                )
            );


        const g=
            el("checkoutGatewaySummary");

        if(g){
            g.textContent="Lynk.id";
        }


        const save=
            el("checkoutPeriodSaving");

        if(save){

            const s=
                savingFor(
                    currentPlan.planCode,
                    cycle
                );

            save.textContent=
                s>0
                    ? `Hemat ${rupiah(s)} dibanding ${
                        cycle==="two_year"
                            ? "24"
                            : "12"
                    }× pembayaran bulanan.`
                    : "";

            save.hidden=
                s<=0;
        }
    }


    /* =========================================================
       OPEN CHECKOUT
       ========================================================= */

    function open(input){

        currentPlan={
            ...input
        };

        const panel=
            el("publicCheckoutPanel");

        if(!panel){

            alert(
                "Panel pembayaran belum tersedia."
            );

            return;
        }


        const select=
            el("checkoutPeriod");

        select.innerHTML=
            '<option value="monthly">Bulanan</option>'+
            '<option value="yearly">Tahunan</option>'+
            '<option value="two_year">2 Tahun</option>';


        select.value=
            [
                "monthly",
                "yearly",
                "two_year"
            ].includes(
                input.billingCycle
            )
                ? input.billingCycle
                : "monthly";


        renderSummary();


        panel.hidden=false;

        panel.classList.add(
            "open"
        );

        panel.scrollIntoView({
            behavior:"smooth",
            block:"start"
        });


        setStatus(
            "Isi data customer, lalu lanjutkan pembayaran melalui Lynk.id. Setelah webhook pembayaran sukses diverifikasi, lisensi aktif dan hasil tampil otomatis di halaman ini.",
            "info"
        );
    }


    function close(){

        const panel=
            el("publicCheckoutPanel");

        if(panel){

            panel.hidden=true;

            panel.classList.remove(
                "open"
            );
        }
    }


    /* =========================================================
       LOCAL STORAGE
       ========================================================= */

    function saveLast(data){

        localStorage.setItem(
            STORAGE_KEY,

            JSON.stringify({

                order_id:
                    data.order_id,

                status_token:
                    data.status_token,

                payment_gateway:
                    "lynk",

                redirect_url:
                    data.redirect_url
                    ||
                    null,

                created_at:
                    Date.now()
            })
        );
    }


    function readLast(){

        try{

            const cur=
                JSON.parse(
                    localStorage.getItem(
                        STORAGE_KEY
                    )
                    ||
                    "null"
                );


            if(
                cur?.order_id
                &&
                cur?.status_token
            ){
                return cur;
            }


            for(
                const key
                of LEGACY_KEYS
            ){

                const old=
                    JSON.parse(
                        localStorage.getItem(
                            key
                        )
                        ||
                        "null"
                    );


                if(
                    old?.order_id
                    &&
                    old?.status_token
                    &&
                    String(
                        old.payment_gateway
                        ||
                        "lynk"
                    ).toLowerCase()
                    ===
                    "lynk"
                ){

                    saveLast(old);

                    return old;
                }
            }

        }catch(_e){}

        return null;
    }


    /* =========================================================
       RECEIPT / HASIL LISENSI
       ========================================================= */

    function setText(id,v){

        const n=
            el(id);

        if(n){
            n.textContent=
                v??"-";
        }
    }


    function setLink(id,url){

        const n=
            el(id);

        if(!n)return;


        if(url){

            n.href=url;

            n.hidden=false;

        }else{

            n.removeAttribute(
                "href"
            );

            n.hidden=true;
        }
    }


    function receiptText(r){

        return [

            "LOCDailyMar — DATA LISENSI",

            `Order ID: ${
                r.order_id
                ||
                "-"
            }`,

            `Paket: ${
                r.plan_name
                ||
                r.plan_code
                ||
                "-"
            }`,

            `Periode: ${
                r.period_label
                ||
                cycleLabel(
                    r.billing_cycle
                )
            }`,

            `License Key: ${
                r.license_key
                ||
                "-"
            }`,

            `Store Code: ${
                r.store_code
                ||
                "-"
            }`,

            `Store UUID: ${
                r.store_id
                ||
                "-"
            }`,

            `Network ID: ${
                r.network_id
                ||
                "-"
            }`,

            `Email Owner: ${
                r.owner_email
                ||
                "-"
            }`,

            `Masa berlaku: ${
                tanggal(
                    r.expires_at
                )
            }`

        ].join("\n");
    }


    async function copyText(text){

        if(
            navigator.clipboard
            ?.writeText
        ){

            await navigator.clipboard
                .writeText(text);

            return;
        }


        const ta=
            document.createElement(
                "textarea"
            );

        ta.value=text;

        ta.style.position=
            "fixed";

        ta.style.opacity=
            "0";

        document.body
            .appendChild(ta);

        ta.select();

        document.execCommand(
            "copy"
        );

        ta.remove();
    }


    function renderReceipt(r){

        if(
            !r?.license_key
        )return;


        currentReceipt=r;


        const panel=
            el("licenseReceipt");

        if(!panel)return;


        setText(
            "receiptOrderId",
            r.order_id
        );


        setText(
            "receiptPlan",
            `${
                r.plan_name
                ||
                r.plan_code
                ||
                "-"
            } · ${
                r.period_label
                ||
                cycleLabel(
                    r.billing_cycle
                )
            }`
        );


        setText(
            "receiptLicenseKey",
            r.license_key
        );


        setText(
            "receiptStoreCode",
            r.store_code
        );


        setText(
            "receiptStoreId",
            r.store_id
        );


        setText(
            "receiptNetworkId",
            r.network_id
        );


        setText(
            "receiptOwnerEmail",
            r.owner_email
        );


        setText(
            "receiptExpires",
            tanggal(
                r.expires_at
            )
        );


        setText(
            "receiptPasswordState",

            r.credentials_source
            ===
            "customer_checkout"

                ? "Gunakan kredensial Owner yang sudah dibuat"

                : "Gunakan tombol Buat / Ganti Password Owner"
        );


        setLink(
            "receiptLoginBtn",
            r.login_url
        );


        setLink(
            "receiptPasswordBtn",
            r.password_setup_url
        );


        setLink(
            "receiptGuideBtn",
            r.guide_url
        );


        const provision=
            el("receiptProvisionNote");


        if(provision){

            provision.textContent=

                r.provision_status
                ===
                "ready"

                    ? "Lisensi dan akun Owner sudah siap digunakan."

                    : `Lisensi aktif, tetapi provisioning akun belum selesai${
                        r.provision_error
                            ? `: ${r.provision_error}`
                            : "."
                    }`;


            provision.className=

                "receipt-provision "
                +
                (
                    r.provision_status
                    ===
                    "ready"

                        ? "ok"

                        : "warn"
                );
        }


        panel.hidden=false;


        panel.scrollIntoView({

            behavior:"smooth",

            block:"start"
        });
    }


    /* =========================================================
       CEK STATUS PEMBAYARAN
       ========================================================= */

    async function status(
        orderId,
        statusToken,
        quiet=false
    ){

        const data=
            await callStatus({

                action:"status",

                order_id:
                    orderId,

                status_token:
                    statusToken
            });


        if(
            data.receipt
        ){
            renderReceipt(
                data.receipt
            );
        }


        if(!quiet){

            if(
                data.payment_status
                ===
                "paid"
            ){

                setStatus(
                    "✅ Pembayaran Lynk.id sudah terverifikasi. Data lisensi tersedia di bawah.",
                    "success"
                );

            }else if(
                [
                    "failed",
                    "expired",
                    "cancelled"
                ].includes(
                    String(
                        data.payment_status
                        ||
                        ""
                    ).toLowerCase()
                )
            ){

                setStatus(
                    `Pembayaran berstatus ${
                        data.payment_status
                    }. Hubungi Support bila dana sudah terpotong.`,
                    "error"
                );

            }else{

                setStatus(
                    `Status pembayaran Lynk.id: ${
                        data.payment_status
                        ||
                        "pending"
                    }.`,
                    "info"
                );
            }
        }


        return data;
    }


    /* =========================================================
       POLLING OTOMATIS
       ========================================================= */

    async function poll(
        orderId,
        statusToken
    ){

        for(
            let i=0;
            i<90;
            i++
        ){

            await wait(
                i===0
                    ? 2200
                    : 4000
            );


            const data=
                await status(
                    orderId,
                    statusToken,
                    true
                );


            if(
                data.payment_status
                ===
                "paid"
            ){

                setStatus(
                    "✅ Pembayaran Lynk.id terverifikasi dan lisensi sudah diproses.",
                    "success"
                );

                return data;
            }


            if(
                [
                    "failed",
                    "expired",
                    "cancelled"
                ].includes(
                    String(
                        data.payment_status
                        ||
                        ""
                    ).toLowerCase()
                )
            ){
                return data;
            }
        }


        setStatus(
            "Pembayaran belum terkonfirmasi otomatis. Gunakan tombol Cek Status Pembayaran atau Bantuan WhatsApp.",
            "info"
        );
    }


    /* =========================================================
       VALIDASI URL LYNK.ID
       ========================================================= */

    function validLynkUrl(raw){

        try{

            const u=
                new URL(
                    String(
                        raw
                        ||
                        ""
                    ).trim()
                );


            /*
             * FIX V27.1
             *
             * Jika URL masih menggunakan:
             *
             * http://lynk.id/...
             *
             * otomatis diubah menjadi:
             *
             * https://lynk.id/...
             */
            if(
                u.protocol
                ===
                "http:"
            ){
                u.protocol=
                    "https:";
            }


            return (

                u.protocol
                ===
                "https:"

                &&

                (
                    u.hostname
                        .toLowerCase()
                    ===
                    "lynk.id"

                    ||

                    u.hostname
                        .toLowerCase()
                    ===
                    "www.lynk.id"
                )

            )
                ? u.href
                : "";


        }catch{

            return "";

        }
    }


    function resolveLynkUrl(
        planCode,
        cycle
    ){

        const raw=
            String(
                cfg()
                    .links
                    ?.[planCode]
                    ?.[cycle]
                ||
                ""
            ).trim();


        const url=
            validLynkUrl(raw);


        if(!url){

            throw new Error(
                `Link Lynk.id untuk ${
                    currentPlan?.planName
                    ||
                    planCode
                } · ${
                    cycleLabel(cycle)
                } belum valid. Pastikan memakai URL lengkap https://lynk.id/... pada js/license-v2-config.js.`
            );
        }


        return url;
    }


    /* =========================================================
       VALIDASI FORM
       ========================================================= */

    function validate(){

        if(!currentPlan){

            throw new Error(
                "Pilih paket terlebih dahulu."
            );
        }


        if(
            !el("checkoutAgree")
                ?.checked
        ){

            throw new Error(
                "Centang persetujuan data dan ketentuan pembayaran."
            );
        }


        const name=
            el("checkoutName")
                .value
                .trim();


        const email=
            el("checkoutEmail")
                .value
                .trim();


        const store=
            el("checkoutStoreName")
                .value
                .trim();


        const code=
            el("checkoutStoreCode")
                .value
                .trim()
                .toUpperCase();


        if(
            !name
            ||
            !email
            ||
            !store
            ||
            !code
        ){

            throw new Error(
                "Nama Customer, Email Owner, Nama Toko, dan Store Code wajib diisi."
            );
        }


        if(
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(email)
        ){

            throw new Error(
                "Email Owner tidak valid."
            );
        }


        if(
            !/^[A-Z0-9][A-Z0-9-]{2,29}$/
                .test(code)
        ){

            throw new Error(
                "Store Code harus 3-30 karakter: huruf kapital, angka, atau tanda strip."
            );
        }
    }


    /* =========================================================
       PENDING ORDER
       ========================================================= */

    function savePending(data){

        localStorage.setItem(

            LYNK_PENDING_KEY,

            JSON.stringify({

                ...data,

                created_at:
                    Date.now()
            })
        );
    }


    /* =========================================================
       WHATSAPP SUPPORT
       ========================================================= */

    function openWhatsApp(message){

        const phone=
            cfg().whatsapp;


        if(
            !/^62\d{7,15}$/
                .test(phone)
        ){

            throw new Error(
                "Nomor WhatsApp Support belum valid."
            );
        }


        window.open(

            `https://wa.me/${
                phone
            }?text=${
                encodeURIComponent(
                    message
                )
            }`,

            "_blank",

            "noopener,noreferrer"
        );
    }


    function helpWhatsApp(){

        const cycle=
            el("checkoutPeriod")
                ?.value
            ||
            "monthly";


        openWhatsApp(

            [

                "Halo Tim LocDailyMar, saya membutuhkan bantuan pembayaran melalui Lynk.id.",

                "",

                `Paket: ${
                    currentPlan?.planName
                    ||
                    "-"
                }`,

                `Periode: ${
                    cycleLabel(
                        cycle
                    )
                }`,

                `Total: ${
                    rupiah(
                        currentPlan
                            ? amountFor(
                                currentPlan.planCode,
                                cycle
                            )
                            : 0
                    )
                }`,

                `Store Code: ${
                    String(
                        el("checkoutStoreCode")
                            ?.value
                        ||
                        ""
                    )
                        .trim()
                        .toUpperCase()
                    ||
                    "-"
                }`

            ].join("\n")
        );
    }


    /* =========================================================
       SUBMIT PEMBAYARAN LYNK.ID
       ========================================================= */

    async function submitLynk(){

        validate();


        const cycle=
            el("checkoutPeriod")
                .value;


        /*
         * Ambil dan validasi URL Lynk.id.
         *
         * URL http:// akan otomatis menjadi https://.
         */
        const url=
            resolveLynkUrl(
                currentPlan.planCode,
                cycle
            );


        const button=
            el("checkoutPayBtn");


        button.disabled=true;

        button.textContent=
            "Membuat order Lynk.id…";


        try{

            setStatus(
                "Membuat pending order di License Authority…",
                "info"
            );


            const data=
                await callOrder({

                    plan_code:
                        currentPlan.planCode,

                    billing_cycle:
                        cycle,

                    customer_name:
                        el("checkoutName")
                            .value
                            .trim(),

                    customer_email:
                        el("checkoutEmail")
                            .value
                            .trim(),

                    customer_phone:
                        el("checkoutPhone")
                            .value
                            .trim(),

                    store_name:
                        el("checkoutStoreName")
                            .value
                            .trim(),

                    store_code:
                        el("checkoutStoreCode")
                            .value
                            .trim()
                            .toUpperCase(),

                    checkout_url:
                        url
                });


            saveLast(data);


            savePending({

                order_id:
                    data.order_id,

                status_token:
                    data.status_token,

                plan_code:
                    currentPlan.planCode,

                billing_cycle:
                    cycle,

                amount:
                    data.amount,

                redirect_url:
                    url
            });


            const check=
                el("checkoutCheckBtn");


            if(check){

                check.hidden=false;

                check.disabled=false;
            }


            setStatus(
                `✅ Order ${data.order_id} dibuat. Lynk.id dibuka di tab baru. Gunakan email yang sama dengan Email Owner agar webhook dapat mencocokkan transaksi.`,
                "success"
            );


            const w=
                window.open(
                    url,
                    "_blank",
                    "noopener,noreferrer"
                );


            /*
             * Jika browser memblokir popup,
             * arahkan tab yang sama ke Lynk.id.
             */
            if(!w){

                location.href=
                    url;
            }


            poll(
                data.order_id,
                data.status_token
            ).catch(

                e=>
                    setStatus(
                        `Pemeriksaan otomatis berhenti: ${
                            e.message
                            ||
                            e
                        }. Gunakan Cek Status Pembayaran.`,
                        "error"
                    )
            );


        }finally{

            button.disabled=false;

            button.textContent=
                "Lanjut Bayar via Lynk.id";
        }
    }


    /* =========================================================
       CEK ORDER TERAKHIR
       ========================================================= */

    async function checkLast(){

        const last=
            readLast();


        if(
            !last?.order_id
            ||
            !last?.status_token
        ){

            throw new Error(
                "Belum ada order Lynk.id pada perangkat ini."
            );
        }


        return status(
            last.order_id,
            last.status_token,
            false
        );
    }


    /* =========================================================
       REFUND POLICY
       ========================================================= */

    async function loadRefundPolicy(){

        const days=
            el("refundPolicyDays");

        const state=
            el("refundPolicyState");


        if(
            !days
            &&
            !state
        )return;


        try{

            const d=
                await callStatus({

                    action:
                        "refund_policy"
                });


            const p=
                d.policy
                ||
                {};


            const n=
                Math.max(
                    1,
                    Number(
                        p.refund_window_days
                        ||
                        3
                    )
                );


            if(days){

                days.textContent=
                    `${n} hari kalender`;
            }


            if(state){

                state.textContent=

                    p.enabled
                    ===
                    false

                        ? "Refund sedang dinonaktifkan sementara."

                        : `Kebijakan aktif · versi ${
                            p.policy_version
                            ||
                            "-"
                        }.`;
            }


        }catch(_e){

            if(days){

                days.textContent=
                    "3 hari kalender";
            }


            if(state){

                state.textContent=
                    "Kebijakan dinamis belum dapat dimuat.";
            }
        }
    }


    /* =========================================================
       INIT
       ========================================================= */

    function init(){

        const form=
            el("publicCheckoutForm");


        if(!form)return;


        /*
         * Gateway selector disembunyikan.
         * Pembayaran V27 hanya Lynk.id.
         */
        const gateway=
            el("checkoutGatewayField");

        if(gateway){

            gateway.hidden=true;
        }


        /*
         * Notice Lynk.id ditampilkan.
         */
        const notice=
            el("checkoutLynkNotice");

        if(notice){

            notice.hidden=false;
        }


        /*
         * Password Owner tidak diminta
         * pada checkout Lynk.id.
         */
        [
            "checkoutOwnerPassword",
            "checkoutOwnerPasswordConfirm"
        ].forEach(

            id=>{

                const input=
                    el(id);


                if(input){

                    input.required=false;

                    input.removeAttribute(
                        "required"
                    );


                    input
                        .closest(
                            ".checkout-field"
                        )
                        ?.setAttribute(
                            "hidden",
                            ""
                        );
                }
            }
        );


        /*
         * Tombol pembayaran.
         */
        const pay=
            el("checkoutPayBtn");

        if(pay){

            pay.textContent=
                "Lanjut Bayar via Lynk.id";
        }


        /*
         * Tombol cek status.
         */
        const check=
            el("checkoutCheckBtn");

        if(check){

            check.hidden=false;

            check.disabled=
                !readLast()
                    ?.order_id;
        }


        /*
         * Tombol konfirmasi manual lama
         * tidak digunakan.
         */
        const manual=
            el("checkoutLynkConfirmBtn");

        if(manual){

            manual.hidden=true;
        }


        /*
         * Event periode.
         */
        el("checkoutPeriod")
            ?.addEventListener(
                "change",
                renderSummary
            );


        /*
         * Close checkout.
         */
        el("checkoutCloseBtn")
            ?.addEventListener(
                "click",
                close
            );


        /*
         * Submit form.
         */
        form.addEventListener(

            "submit",

            async e=>{

                e.preventDefault();


                try{

                    await submitLynk();

                }catch(err){

                    setStatus(
                        `❌ ${
                            err.message
                            ||
                            err
                        }`,
                        "error"
                    );
                }
            }
        );


        /*
         * Cek status.
         */
        check?.addEventListener(

            "click",

            async()=>{

                try{

                    await checkLast();

                }catch(err){

                    setStatus(
                        `❌ ${
                            err.message
                            ||
                            err
                        }`,
                        "error"
                    );
                }
            }
        );


        /*
         * WhatsApp support.
         */
        el("checkoutLynkHelpBtn")
            ?.addEventListener(

                "click",

                ()=>{

                    try{

                        helpWhatsApp();

                    }catch(err){

                        setStatus(
                            `❌ ${
                                err.message
                                ||
                                err
                            }`,
                            "error"
                        );
                    }
                }
            );


        /*
         * Copy seluruh data lisensi.
         */
        el("receiptCopyAllBtn")
            ?.addEventListener(

                "click",

                async()=>{

                    if(currentReceipt){

                        await copyText(
                            receiptText(
                                currentReceipt
                            )
                        );
                    }
                }
            );


        /*
         * Copy License Key.
         */
        el("receiptCopyKeyBtn")
            ?.addEventListener(

                "click",

                async()=>{

                    if(
                        currentReceipt
                            ?.license_key
                    ){

                        await copyText(
                            currentReceipt
                                .license_key
                        );
                    }
                }
            );


        /*
         * Isi License Key + Store Code
         * ke form aktivasi.
         */
        el("receiptActivateBtn")
            ?.addEventListener(

                "click",

                ()=>{

                    if(
                        !currentReceipt
                    )return;


                    const sc=
                        el("storeCode");

                    const lk=
                        el("licenseKey");


                    if(sc){

                        sc.value=
                            currentReceipt
                                .store_code
                            ||
                            "";
                    }


                    if(lk){

                        lk.value=
                            currentReceipt
                                .license_key
                            ||
                            "";
                    }


                    el("activation")
                        ?.scrollIntoView({

                            behavior:"smooth",

                            block:"start"
                        });
                }
            );


        /*
         * Muat kebijakan refund.
         */
        loadRefundPolicy();


        /*
         * Jika kembali dari halaman pembayaran
         * dan memiliki order tersimpan,
         * cek status otomatis.
         */
        const params=
            new URLSearchParams(
                location.search
            );


        const last=
            readLast();


        if(
            params.get(
                "payment"
            )
            ===
            "return"

            &&

            last?.order_id
        ){

            setTimeout(

                ()=>
                    status(
                        last.order_id,
                        last.status_token,
                        false
                    )
                    .catch(()=>{}),

                700
            );
        }
    }


    /* =========================================================
       PUBLIC API
       ========================================================= */

    window.LDMCheckoutV2=
        Object.freeze({

            open,

            close,

            checkLast,

            init
        });


    /* =========================================================
       AUTO INIT
       ========================================================= */

    if(
        document.readyState
        ===
        "loading"
    ){

        document.addEventListener(

            "DOMContentLoaded",

            init,

            {
                once:true
            }
        );

    }else{

        init();
    }

})();

(function(){
    "use strict";
    const STORAGE_KEY="ldmPublicCheckoutV261";
    const PREVIOUS_V26_STORAGE_KEY="ldmPublicCheckoutV26";
    const PREVIOUS_V25_STORAGE_KEY="ldmPublicCheckoutV25";
    const PREVIOUS_V24_STORAGE_KEY="ldmPublicCheckoutV24";
    const PREVIOUS_V23_STORAGE_KEY="ldmPublicCheckoutV23";
    const PREVIOUS_STORAGE_KEY="ldmPublicCheckoutV278";
    const LEGACY_STORAGE_KEY="ldmPublicCheckoutV273";
    const LEGACY_STORAGE_KEY_2="ldmPublicCheckoutV272";
    function cfg(){
        const base=window.LDM_LICENSE_V2_CONFIG||{};
        const url=String(base.checkoutUrl||"").trim() || String(base.serverUrl||"").replace(/\/ldm-license-v2\/?$/i,"/ldm-public-checkout-v2");
        return {
            url,
            checkoutMode:String(base.checkoutMode||"gateway").toLowerCase(),
            showPaymentGatewaySelector:base.showPaymentGatewaySelector!==false,
            developerWhatsApp:String(base.developerWhatsApp||"").replace(/\D/g,""),
            manualPaymentLabel:String(base.manualPaymentLabel||"Bayar via Lynk.id"),
            lynkCheckoutLinks:base.lynkCheckoutLinks||{},
            lynkOrderUrl:String(base.lynkOrderUrl||"").trim()
        };
    }
    function rupiah(n){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0))}
    function tanggal(v){return v?new Date(v).toLocaleString("id-ID"):"Tidak terbatas (Lifetime)"}
    function el(id){return document.getElementById(id)}
    function setStatus(text,type="info"){
        const node=el("publicCheckoutStatus"); if(!node)return;
        node.textContent=text; node.className="checkout-status show "+type;
    }
    async function call(payload){
        const url=cfg().url;
        if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ldm-public-checkout-v2$/i.test(url)) throw new Error("URL Public Checkout belum dikonfigurasi.");
        const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),20000);
        try{
            const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});
            const data=await response.json().catch(()=>({}));
            if(!response.ok||data?.ok===false){const error=new Error(data?.message||`Checkout HTTP ${response.status}`);error.code=data?.code||"CHECKOUT_FAILED";throw error}
            return data;
        }finally{clearTimeout(timeout)}
    }
    async function callLynkOrder(payload){
        const url=cfg().lynkOrderUrl;
        if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ldm-lynk-order$/i.test(url))throw new Error("URL backend order Lynk.id belum dikonfigurasi.");
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
        try{
            const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});
            const data=await response.json().catch(()=>({}));
            if(!response.ok||data?.ok===false)throw new Error(data?.message||`Lynk Order HTTP ${response.status}`);
            return data;
        }finally{clearTimeout(timeout)}
    }

    function loadSnap(clientKey,environment){
        return new Promise((resolve,reject)=>{if(window.snap)return resolve();const s=document.createElement("script");s.src=environment==="production"?"https://app.midtrans.com/snap/snap.js":"https://app.sandbox.midtrans.com/snap/snap.js";s.setAttribute("data-client-key",clientKey);s.onload=()=>resolve();s.onerror=()=>reject(new Error("Midtrans Snap gagal dimuat."));document.head.appendChild(s)});
    }
    function isWhatsAppManualMode(){return cfg().checkoutMode==="whatsapp_manual"}
    function isLynkMode(){return cfg().checkoutMode==="lynk"}
    function isExternalManualMode(){return isWhatsAppManualMode()||isLynkMode()}
    function gatewayLabel(v){const g=String(v||"").toLowerCase();if(g==="whatsapp_manual")return "WhatsApp Manual";if(g==="lynk")return "Lynk.id";return g==="doku"?"DOKU":"Midtrans"}
    function gatewayValue(){if(isWhatsAppManualMode())return "whatsapp_manual";if(isLynkMode())return "lynk";return String(el("checkoutGateway")?.value||"midtrans").toLowerCase()}
    function syncGatewaySummary(){
        const n=el("checkoutGatewaySummary"), help=el("checkoutGatewayHelp"), field=el("checkoutGatewayField"), waNotice=el("checkoutWhatsAppNotice"), lynkNotice=el("checkoutLynkNotice");
        if(waNotice)waNotice.hidden=true;
        if(lynkNotice)lynkNotice.hidden=true;
        if(isWhatsAppManualMode()){
            if(n)n.textContent="WhatsApp Manual";
            if(field)field.hidden=true;
            if(waNotice)waNotice.hidden=false;
            if(help)help.textContent="Midtrans dan DOKU disimpan di sistem dan sementara disembunyikan sampai verifikasi merchant selesai.";
            return;
        }
        if(isLynkMode()){
            if(n)n.textContent="Lynk.id";
            if(field)field.hidden=true;
            if(lynkNotice)lynkNotice.hidden=false;
            if(help)help.textContent="Lynk.id menjadi checkout utama sementara. Midtrans dan DOKU tetap disimpan untuk diaktifkan kembali nanti.";
            return;
        }
        const g=gatewayValue();
        if(n)n.textContent=gatewayLabel(g);
        if(field)field.hidden=!cfg().showPaymentGatewaySelector;
        if(help)help.textContent=g==="doku"?"DOKU membuka halaman Checkout resmi DOKU pada tab yang sama.":"Midtrans membuka Snap Checkout pada halaman ini."
    }
    function cycleLabel(v){return v==="yearly"?"Tahunan":v==="lifetime"?"Lifetime":"Bulanan"}
    function amountFor(planCode,cycle){const p=window.LDM_LICENSE_V2_CONFIG?.plans?.[planCode]||{};return Number(cycle==="yearly"?p.yearly:cycle==="lifetime"?p.lifetime:p.monthly)||0}
    let currentPlan=null;
    let currentReceipt=null;
    let activePayment=null;
    function renderSummary(){if(!currentPlan)return;const cycle=el("checkoutPeriod").value;el("checkoutPlanName").textContent=currentPlan.planName;el("checkoutPlanPeriod").textContent=cycleLabel(cycle);el("checkoutPlanAmount").textContent=rupiah(amountFor(currentPlan.planCode,cycle));syncGatewaySummary()}
    function open(input){
        currentPlan={...input};const panel=el("publicCheckoutPanel");if(!panel)return alert("Panel pembayaran belum tersedia.");
        const select=el("checkoutPeriod");select.innerHTML=input.planCode==="LIFETIME"?'<option value="lifetime">Lifetime · sekali bayar</option>':'<option value="monthly">Bulanan</option><option value="yearly">Tahunan</option>';select.value=input.billingCycle||(input.planCode==="LIFETIME"?"lifetime":"monthly");renderSummary();panel.hidden=false;panel.classList.add("open");panel.scrollIntoView({behavior:"smooth",block:"start"});setStatus(isLynkMode()?"Isi data customer, lalu tekan Lanjut Bayar via Lynk.id. LocDailyMar akan membuat pending order terlebih dahulu. Setelah pembayaran terverifikasi oleh webhook, lisensi dan data akses akan tampil otomatis hanya di halaman License ini.":isWhatsAppManualMode()?"Isi data customer, lalu tekan Konfirmasi & Lanjut ke WhatsApp untuk memperoleh instruksi pembayaran.":"Isi data customer, pilih payment gateway, lalu lanjutkan ke metode pembayaran.","info");
    }
    function close(){const panel=el("publicCheckoutPanel");if(panel){panel.hidden=true;panel.classList.remove("open")}}
    function saveLast(data){localStorage.setItem(STORAGE_KEY,JSON.stringify({order_id:data.order_id,status_token:data.status_token,payment_gateway:data.payment_gateway||"midtrans",redirect_url:data.redirect_url||null,cancel_supported:data.cancel_supported!==false,created_at:Date.now()}))}
    function readLast(){
        try{
            const current=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
            if(current?.order_id&&current?.status_token)return current;
            const v26=JSON.parse(localStorage.getItem(PREVIOUS_V26_STORAGE_KEY)||"null");
            if(v26?.order_id&&v26?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(v26));return v26}
            const v25=JSON.parse(localStorage.getItem(PREVIOUS_V25_STORAGE_KEY)||"null");
            if(v25?.order_id&&v25?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(v25));return v25}
            const v24=JSON.parse(localStorage.getItem(PREVIOUS_V24_STORAGE_KEY)||"null");
            if(v24?.order_id&&v24?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(v24));return v24}
            const v23=JSON.parse(localStorage.getItem(PREVIOUS_V23_STORAGE_KEY)||"null");
            if(v23?.order_id&&v23?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(v23));return v23}
            const prev=JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY)||"null");
            if(prev?.order_id&&prev?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(prev));return prev}
            const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||"null");
            if(legacy?.order_id&&legacy?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(legacy));return legacy}
            const legacy2=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY_2)||"null");
            if(legacy2?.order_id&&legacy2?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(legacy2));return legacy2}
            return null;
        }catch{return null}
    }
    function setPaymentManager(show,payment=activePayment||readLast()){const box=el("checkoutManageActions");if(box)box.hidden=!show;const hide=el("checkoutHideSnapBtn"),reopen=el("checkoutReopenBtn"),cancel=el("checkoutCancelBtn");const provider=String(payment?.payment_gateway||"midtrans").toLowerCase();if(hide)hide.hidden=provider==="doku";if(reopen)reopen.textContent=provider==="doku"?"Buka DOKU Checkout Lagi":"Buka Metode Lagi";if(cancel)cancel.hidden=payment?.cancel_supported===false||provider==="doku"}
    function clearLast(){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(PREVIOUS_V26_STORAGE_KEY);localStorage.removeItem(PREVIOUS_V25_STORAGE_KEY);localStorage.removeItem(PREVIOUS_V24_STORAGE_KEY);localStorage.removeItem(PREVIOUS_V23_STORAGE_KEY);localStorage.removeItem(PREVIOUS_STORAGE_KEY);localStorage.removeItem(LEGACY_STORAGE_KEY);localStorage.removeItem(LEGACY_STORAGE_KEY_2)}
    function hideSnap(){try{window.snap?.hide?.()}catch(_ignored){}setStatus("Metode pembayaran ditutup. Order belum dibatalkan. Kamu bisa membuka metode pembayaran lagi atau membatalkan order selama transaksi belum dibayar.","info")}
    function snapCallbacks(payment){return {onSuccess:()=>{setStatus("Midtrans menutup pembayaran sebagai berhasil. LocDailyMar belum menganggapnya final sampai server memverifikasi Get Status. Sedang memverifikasi…","info");poll(payment.order_id,payment.status_token).catch(e=>setStatus(e.message,"error"))},onPending:()=>{setStatus("Metode pembayaran sudah dibuat dan masih menunggu. Status server akan direkonsiliasi otomatis; kamu juga dapat menekan Cek Status.","info");poll(payment.order_id,payment.status_token).catch(e=>setStatus(e.message,"error"))},onError:()=>setStatus("Midtrans melaporkan percobaan pembayaran gagal. Buka metode lagi atau batalkan order untuk membuat pembayaran baru.","error"),onClose:()=>setStatus("Jendela metode pembayaran ditutup. Order tetap tersimpan. Buka lagi untuk melanjutkan, atau batalkan order agar dapat membuat order baru dengan metode lain.","info")}}
    async function reopenPayment(){const payment=activePayment||readLast();if(!payment)throw new Error("Belum ada pembayaran aktif pada sesi ini.");if(String(payment.payment_gateway||"midtrans").toLowerCase()==="doku"){const url=payment.redirect_url||readLast()?.redirect_url;if(!url)throw new Error("URL DOKU Checkout tidak tersedia. Tekan Cek Status atau buat order baru setelah order lama selesai.");location.href=url;return}if(!payment.snap_token)throw new Error("Token pembayaran Midtrans tidak tersedia pada sesi ini. Tekan Lanjut ke Metode Pembayaran lagi untuk membuka order pending yang sama.");await loadSnap(payment.client_key,payment.environment);window.snap.pay(payment.snap_token,snapCallbacks(payment))}
    async function cancelLast(){const last=readLast();if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order yang dapat dibatalkan.");if(!confirm("Batalkan order pembayaran ini?\n\nGunakan ini hanya jika kamu benar-benar tidak ingin melanjutkan order tersebut. Order yang sudah settlement tidak dapat dibatalkan."))return;const btn=el("checkoutCancelBtn");if(btn){btn.disabled=true;btn.textContent="Membatalkan…"}try{const data=await call({action:"cancel",order_id:last.order_id,status_token:last.status_token});try{window.snap?.hide?.()}catch(_ignored){}activePayment=null;clearLast();setPaymentManager(false,null);if(el("checkoutCheckBtn"))el("checkoutCheckBtn").disabled=true;setStatus(`✅ Order ${data.order_id||last.order_id} berhasil dibatalkan. Kamu dapat memilih paket/periode dan membuat pembayaran baru.`,"success")}finally{if(btn){btn.disabled=false;btn.textContent="Batalkan Order Pembayaran"}}}
    function setText(id,value){const n=el(id);if(n)n.textContent=value??"-"}
    function setLink(id,url){const n=el(id);if(!n)return;if(url){n.href=url;n.hidden=false}else{n.removeAttribute("href");n.hidden=true}}
    function receiptText(r){return [
        "LOCDailyMar — DATA LISENSI PEMBAYARAN",`Order ID: ${r.order_id||"-"}`,`Paket: ${r.plan_name||r.plan_code||"-"}`,`Periode: ${r.period_label||cycleLabel(r.billing_cycle)}`,`License Key: ${r.license_key||"-"}`,`Store Code: ${r.store_code||"-"}`,`Store UUID: ${r.store_id||"-"}`,`Network ID: ${r.network_id||"-"}`,`Email Owner: ${r.owner_email||"-"}`,`Masa berlaku: ${tanggal(r.expires_at)}`
    ].join("\n")}
    async function copyText(text){
        if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return}
        const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    }
    function renderReceipt(r){
        if(!r?.license_key)return;
        currentReceipt=r;
        const panel=el("licenseReceipt");if(!panel)return;
        setText("receiptOrderId",r.order_id);setText("receiptPlan",`${r.plan_name||r.plan_code||"-"} · ${r.period_label||cycleLabel(r.billing_cycle)}`);setText("receiptLicenseKey",r.license_key);setText("receiptStoreCode",r.store_code);setText("receiptStoreId",r.store_id);setText("receiptNetworkId",r.network_id);setText("receiptOwnerEmail",r.owner_email);setText("receiptExpires",tanggal(r.expires_at));
        setText("receiptPasswordState",r.credentials_source==="customer_checkout"?"Password yang kamu buat saat checkout":"Gunakan tombol reset password untuk order lama");
        setLink("receiptLoginBtn",r.login_url);setLink("receiptPasswordBtn",r.password_setup_url);setLink("receiptGuideBtn",r.guide_url);
        const provision=el("receiptProvisionNote");if(provision){provision.textContent=r.provision_status==="ready"?(r.credentials_source==="customer_checkout"?"Akun Owner sudah aktif. Email dan password yang kamu buat saat checkout sekarang bisa digunakan untuk login aplikasi.":"Akun Owner order lama sudah disiapkan. Gunakan tombol Buat / Ganti Password Owner sebelum login."):`Lisensi sudah aktif, tetapi penyiapan akun Owner belum selesai${r.provision_error?`: ${r.provision_error}`:"."}`;provision.className="receipt-provision "+(r.provision_status==="ready"?"ok":"warn")}
        panel.hidden=false;panel.classList.add("show");panel.scrollIntoView({behavior:"smooth",block:"center"});
    }
    async function status(orderId,statusToken,quiet=false,syncProvider=false){
        const data=await call({action:"status",order_id:orderId,status_token:statusToken,sync_provider:!!syncProvider});
        const provider=String(data.payment_gateway||readLast()?.payment_gateway||"midtrans").toLowerCase();
        if(activePayment&&activePayment.order_id===orderId){activePayment={...activePayment,...data,payment_gateway:provider,redirect_url:data.redirect_url||activePayment.redirect_url}}
        if(data.payment_status==="paid"){setPaymentManager(false,{payment_gateway:provider});
            if(data.receipt?.license_key){renderReceipt(data.receipt);setStatus(`✅ Pembayaran ${gatewayLabel(provider)} sudah terverifikasi. Data lisensi ditampilkan di bawah pada halaman License. Simpan atau salin sekarang sebelum meninggalkan halaman ini.`,"success")}
            else setStatus(`✅ Pembayaran ${gatewayLabel(provider)} sudah terverifikasi, tetapi data lisensi belum dapat ditampilkan${data.receipt_error?`: ${data.receipt_error}`:". Tekan Cek Status beberapa saat lagi."}`,"info");
        }else {const manageable=["pending","challenge"].includes(data.payment_status);setPaymentManager(manageable,{payment_gateway:provider,redirect_url:data.redirect_url,cancel_supported:provider!=="doku"});if(!quiet){const syncError=data.provider_sync_error?` Sinkronisasi ${gatewayLabel(provider)}: ${data.provider_sync_error}`:"";const notCreated=provider==="midtrans"&&data.provider_sync?.transaction_status==="not_created"?" Sesi Snap sudah ada, tetapi transaksi Midtrans belum terbentuk karena metode pembayaran belum dipilih.":"";setStatus(`Status pembayaran ${gatewayLabel(provider)}: ${data.payment_status||"pending"}${data.provider_status?` / ${data.provider_status}`:""}.${notCreated}${syncError}`,manageable?"info":"error")} }
        return data;
    }
    async function poll(orderId,statusToken){
        for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,i===0?1800:2000));try{const data=await status(orderId,statusToken,true,i===0||i%5===0);if(data.payment_status==="paid"||["failed","expired","cancelled"].includes(data.payment_status)){if(data.payment_status!=="paid")setStatus(`Pembayaran ${data.payment_status}. Silakan buat order baru bila diperlukan.`,"error");return data}}catch(error){if(i===19)throw error}}
        setStatus("Pembayaran belum terkonfirmasi. Tekan Cek Status beberapa saat lagi.","info");
    }
    function manualRequestId(){
        const d=new Date();
        const date=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
        const bytes=new Uint8Array(4);
        if(window.crypto?.getRandomValues)window.crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
        const code=[...bytes].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase();
        return `WA-${date}-${code}`;
    }
    function validateCommonCheckout(){
        const required=[
            ["checkoutName","Nama customer"],["checkoutStoreName","Nama toko"],["checkoutPhone","Nomor WhatsApp"],
            ["checkoutEmail","Email Owner"],["checkoutStoreCode","Store Code"]
        ];
        for(const [id,label] of required){if(!String(el(id)?.value||"").trim())throw new Error(`${label} wajib diisi.`)}
        const email=String(el("checkoutEmail")?.value||"").trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Format Email Owner belum valid.");
    }
    function buildWhatsAppMessage(requestId){
        const cycle=el("checkoutPeriod").value;
        const total=amountFor(currentPlan.planCode,cycle);
        return [
            "Halo Tim LocDailyMar, saya ingin melakukan pembayaran lisensi secara manual melalui WhatsApp.",
            "",
            `Request ID: ${requestId}`,
            `Paket: ${currentPlan.planName}`,
            `Periode: ${cycleLabel(cycle)}`,
            `Total: ${rupiah(total)}`,
            "",
            `Nama Customer: ${el("checkoutName").value.trim()}`,
            `Nama Toko: ${el("checkoutStoreName").value.trim()}`,
            `WhatsApp Customer: ${el("checkoutPhone").value.trim()}`,
            `Email Owner: ${el("checkoutEmail").value.trim()}`,
            `Store Code: ${el("checkoutStoreCode").value.trim().toUpperCase()}`,
            "",
            "Mohon kirimkan instruksi/tujuan pembayaran. Setelah pembayaran saya akan mengirim bukti pembayaran melalui chat ini.",
            "",
            "Catatan keamanan: Password Owner tidak dikirim melalui WhatsApp."
        ].join("\n");
    }
    const LYNK_PENDING_KEY="ldmLynkPendingV26";
    function resolveLynkUrl(planCode,cycle){
        const raw=String(cfg().lynkCheckoutLinks?.[planCode]?.[cycle]||"").trim();
        if(!raw)throw new Error(`Link Lynk.id untuk ${currentPlan?.planName||planCode} · ${cycleLabel(cycle)} belum dikonfigurasi di js/license-v2-config.js.`);
        let u;try{u=new URL(raw)}catch{throw new Error("URL Lynk.id belum valid.")}
        const host=u.hostname.toLowerCase();
        if(u.protocol!=="https:"||!(host==="lynk.id"||host==="www.lynk.id"))throw new Error("URL checkout harus menggunakan HTTPS dan domain lynk.id.");
        return u.href;
    }
    function lynkRequestId(){return manualRequestId().replace(/^WA-/,"LYNK-")}
    function buildLynkPending(requestId,url){
        const cycle=el("checkoutPeriod").value;
        return {
            request_id:requestId,
            plan_code:currentPlan.planCode,
            plan_name:currentPlan.planName,
            cycle,
            cycle_label:cycleLabel(cycle),
            amount:amountFor(currentPlan.planCode,cycle),
            customer_name:el("checkoutName").value.trim(),
            store_name:el("checkoutStoreName").value.trim(),
            customer_phone:el("checkoutPhone").value.trim(),
            customer_email:el("checkoutEmail").value.trim(),
            store_code:el("checkoutStoreCode").value.trim().toUpperCase(),
            checkout_url:url,
            created_at:Date.now()
        };
    }
    function saveLynkPending(data){localStorage.setItem(LYNK_PENDING_KEY,JSON.stringify(data))}
    function readLynkPending(){try{return JSON.parse(localStorage.getItem(LYNK_PENDING_KEY)||"null")}catch{return null}}
    function showLynkConfirm(show){const b=el("checkoutLynkConfirmBtn");if(b)b.hidden=!show}
    function buildLynkConfirmMessage(p){
        return [
            "Halo Tim LocDailyMar, saya sudah melakukan pembayaran lisensi melalui Lynk.id dan ingin meminta verifikasi.",
            "",
            `Request ID: ${p.request_id}`,
            `Paket: ${p.plan_name}`,
            `Periode: ${p.cycle_label}`,
            `Total yang seharusnya dibayar: ${rupiah(p.amount)}`,
            "",
            `Nama Customer: ${p.customer_name}`,
            `Nama Toko: ${p.store_name}`,
            `WhatsApp Customer: ${p.customer_phone}`,
            `Email Owner: ${p.customer_email}`,
            `Store Code: ${p.store_code}`,
            "",
            "Mohon verifikasi transaksi pada dashboard Lynk.id. Lisensi hanya diproses setelah pembayaran benar-benar terkonfirmasi.",
            "",
            "Catatan keamanan: Password Owner tidak dikirim melalui WhatsApp."
        ].join("\n");
    }
    function buildLynkHelpMessage(){
        if(!currentPlan)return "Halo Tim LocDailyMar, saya membutuhkan bantuan pembayaran lisensi melalui Lynk.id.";
        const cycle=el("checkoutPeriod").value;
        return [
            "Halo Tim LocDailyMar, saya membutuhkan bantuan pembayaran lisensi melalui Lynk.id.",
            "",
            `Paket: ${currentPlan.planName}`,
            `Periode: ${cycleLabel(cycle)}`,
            `Total: ${rupiah(amountFor(currentPlan.planCode,cycle))}`,
            `Nama Customer: ${String(el("checkoutName")?.value||"").trim()||"-"}`,
            `Store Code: ${String(el("checkoutStoreCode")?.value||"").trim().toUpperCase()||"-"}`
        ].join("\n");
    }
    function openWhatsApp(message){
        const phone=cfg().developerWhatsApp;
        if(!/^62\d{7,15}$/.test(phone))throw new Error("Nomor WhatsApp LocDailyMar belum dikonfigurasi dengan benar.");
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");
    }
    async function pollLynk(orderId,statusToken){
        for(let i=0;i<90;i++){
            await new Promise(r=>setTimeout(r,i===0?2200:4000));
            try{
                const data=await status(orderId,statusToken,true,false);
                if(data.payment_status==="paid")return data;
                if(["failed","expired","cancelled"].includes(data.payment_status)){setStatus(`Pembayaran Lynk.id ${data.payment_status}. Hubungi Support bila kamu sudah membayar.`,"error");return data}
            }catch(error){if(i===89)throw error}
        }
        setStatus("Pembayaran Lynk.id belum terkonfirmasi otomatis. Halaman boleh tetap dibuka; gunakan Cek Status Pembayaran atau Bantuan WhatsApp bila transaksi sudah selesai.","info");
    }
    async function submitLynk(){
        validateCommonCheckout();
        const cycle=el("checkoutPeriod").value;
        const url=resolveLynkUrl(currentPlan.planCode,cycle);
        const button=el("checkoutPayBtn");
        button.disabled=true;button.textContent="Membuat order Lynk.id…";
        try{
            setStatus("Membuat pending order aman di server LocDailyMar sebelum membuka Lynk.id…","info");
            const data=await callLynkOrder({
                plan_code:currentPlan.planCode,billing_cycle:cycle,
                customer_name:el("checkoutName").value.trim(),customer_email:el("checkoutEmail").value.trim(),
                customer_phone:el("checkoutPhone").value.trim(),store_name:el("checkoutStoreName").value.trim(),
                store_code:el("checkoutStoreCode").value.trim().toUpperCase(),checkout_url:url
            });
            activePayment=data;saveLast(data);saveLynkPending({...buildLynkPending(data.order_id,url),request_id:data.order_id,status_token:data.status_token});
            const check=el("checkoutCheckBtn");if(check){check.hidden=false;check.disabled=false}
            showLynkConfirm(false);
            setStatus(`✅ Order ${data.order_id} dibuat. Lynk.id dibuka di tab baru. Setelah pembayaran sukses, webhook akan memverifikasi transaksi, lisensi akan aktif, hasil tampil otomatis hanya di halaman License ini. Pastikan email yang digunakan saat checkout Lynk.id sama dengan Email Owner di sini.`,"success");
            const w=window.open(url,"_blank","noopener,noreferrer");if(!w)location.href=url;
            pollLynk(data.order_id,data.status_token).catch(error=>setStatus(`Status otomatis berhenti: ${error.message||error}. Tekan Cek Status Pembayaran.`,"error"));
        }finally{button.disabled=false;button.textContent="Lanjut Bayar via Lynk.id"}
    }
    function confirmLynkWhatsApp(){
        const pending=readLynkPending();
        if(!pending?.request_id)throw new Error("Belum ada request Lynk.id yang tersimpan pada perangkat ini.");
        openWhatsApp(buildLynkConfirmMessage(pending));
        setStatus(`Konfirmasi ${pending.request_id} siap dikirim ke WhatsApp. Tim LocDailyMar tetap harus memverifikasi pembayaran di dashboard Lynk.id sebelum mengaktifkan lisensi.`,"info");
    }
    function lynkHelpWhatsApp(){openWhatsApp(buildLynkHelpMessage())}

    async function submitWhatsAppManual(){
        validateCommonCheckout();
        const phone=cfg().developerWhatsApp;
        if(!/^62\d{7,15}$/.test(phone))throw new Error("Nomor WhatsApp LocDailyMar belum dikonfigurasi dengan benar.");
        const requestId=manualRequestId();
        const message=buildWhatsAppMessage(requestId);
        const url=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        const button=el("checkoutPayBtn");
        button.disabled=true;button.textContent="Membuka WhatsApp…";
        try{
            // Password sengaja tidak dibaca, disimpan, atau dimasukkan ke pesan WhatsApp.
            setStatus(`✅ Data pesanan ${requestId} siap. WhatsApp LocDailyMar sedang dibuka. Kirim pesan yang sudah terisi lalu tunggu instruksi pembayaran dari tim LocDailyMar.`,"success");
            location.href=url
        }finally{
            button.disabled=false;button.textContent="Konfirmasi & Lanjut ke WhatsApp";
        }
    }
    async function submit(){
        if(!currentPlan)throw new Error("Pilih paket terlebih dahulu.");const button=el("checkoutPayBtn");if(!el("checkoutAgree").checked)throw new Error("Centang persetujuan data dan ketentuan pembayaran.");
        if(isLynkMode()){await submitLynk();return;}
        if(isWhatsAppManualMode()){await submitWhatsAppManual();return;}
        const ownerPassword=el("checkoutOwnerPassword").value;const ownerPasswordConfirm=el("checkoutOwnerPasswordConfirm").value;
        if(ownerPassword!==ownerPasswordConfirm)throw new Error("Konfirmasi Password Owner tidak sama.");
        if(ownerPassword.length<8||ownerPassword.length>72||/\s/.test(ownerPassword)||!/[a-z]/.test(ownerPassword)||!/[A-Z]/.test(ownerPassword)||!/\d/.test(ownerPassword))throw new Error("Password Owner harus 8-72 karakter, tanpa spasi, dan mengandung huruf besar, huruf kecil, serta angka.");
        const gateway=gatewayValue();
        const payload={action:"create",payment_gateway:gateway,plan_code:currentPlan.planCode,billing_cycle:el("checkoutPeriod").value,customer_name:el("checkoutName").value.trim(),customer_email:el("checkoutEmail").value.trim(),customer_phone:el("checkoutPhone").value.trim(),store_name:el("checkoutStoreName").value.trim(),store_code:el("checkoutStoreCode").value.trim().toUpperCase(),owner_password:ownerPassword};
        button.disabled=true;button.textContent="Menyiapkan pembayaran…";
        try{
            setStatus(`Memvalidasi akun Owner dan membuat order ${gatewayLabel(gateway)}…`,"info");const data=await call(payload);el("checkoutOwnerPassword").value="";el("checkoutOwnerPasswordConfirm").value="";activePayment=data;saveLast(data);el("checkoutCheckBtn").disabled=false;setPaymentManager(true,data);setStatus(`Order ${data.order_id} dibuat melalui ${gatewayLabel(data.payment_gateway||gateway)}. Total ${rupiah(data.amount)}. Membuka metode pembayaran…`,"info");
            if(String(data.payment_gateway||gateway).toLowerCase()==="doku"){if(!data.redirect_url)throw new Error("DOKU tidak mengembalikan URL Checkout.");location.href=data.redirect_url;return}
            await loadSnap(data.client_key,data.environment);if(window.snap)window.snap.pay(data.snap_token,snapCallbacks(data));else if(data.redirect_url)location.href=data.redirect_url;
        }finally{button.disabled=false;button.textContent="Lanjut ke Metode Pembayaran"}
    }
    async function checkLast(){const last=readLast();if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order pembayaran pada perangkat ini.");return status(last.order_id,last.status_token,false,String(last.payment_gateway||"").toLowerCase()!=="lynk")}
    async function loadGatewayConfig(){
        const select=el("checkoutGateway");if(!select)return;
        if(isExternalManualMode()){
            select.innerHTML='<option value="midtrans">Midtrans</option><option value="doku">DOKU</option>';
            select.value="midtrans";select.disabled=true;syncGatewaySummary();return;
        }
        try{
            const d=await call({action:"gateway_config"});const gateways=Array.isArray(d.gateways)?d.gateways:[];select.innerHTML="";
            gateways.forEach(g=>{const o=document.createElement("option");o.value=g.id;o.textContent=`${g.label}${g.enabled?"":" · belum dikonfigurasi"}`;o.disabled=!g.enabled;select.appendChild(o)});
            const enabled=gateways.filter(g=>g.enabled);if(!enabled.length){const o=document.createElement("option");o.value="";o.textContent="Belum ada gateway aktif";select.appendChild(o);select.disabled=true;throw new Error("Belum ada payment gateway yang siap di server.")}
            select.disabled=false;select.value=enabled.some(g=>g.id===d.default_gateway)?d.default_gateway:enabled[0].id;syncGatewaySummary();
        }catch(error){select.innerHTML='<option value="midtrans">Midtrans</option>';select.value="midtrans";syncGatewaySummary();const help=el("checkoutGatewayHelp");if(help)help.textContent=`Konfigurasi gateway belum dapat dibaca: ${error.message||error}`}
    }

    async function loadRefundPolicy(){
        const days=el("refundPolicyDays"),state=el("refundPolicyState");if(!days&&!state)return;
        try{
            const d=await call({action:"refund_policy"});const p=d.policy||{};const n=Math.max(1,Number(p.refund_window_days||3));
            if(days)days.textContent=`${n} hari kalender`;
            if(state)state.textContent=p.enabled===false?"Refund sedang dinonaktifkan sementara oleh kebijakan merchant.":`Kebijakan aktif · versi ${p.policy_version||"-"}${d.migration_required?" · fallback sementara, pasang SQL-42":""}.`;
        }catch(error){if(days)days.textContent="3 hari kalender";if(state)state.textContent="Kebijakan dinamis belum dapat dimuat. Batas default yang ditampilkan: 3 hari."}
    }
    function init(){
        const form=el("publicCheckoutForm");if(!form)return;
        if(isExternalManualMode()){
            const check=el("checkoutCheckBtn"), manage=el("checkoutManageActions"), pay=el("checkoutPayBtn");
            if(check){check.hidden=!isLynkMode();check.disabled=!readLast()?.order_id}if(manage)manage.hidden=true;
            if(pay)pay.textContent=isLynkMode()?"Lanjut Bayar via Lynk.id":"Konfirmasi & Lanjut ke WhatsApp";
            ["checkoutOwnerPassword","checkoutOwnerPasswordConfirm"].forEach(id=>{const input=el(id);if(input){input.required=false;input.removeAttribute("required")}});
            document.querySelectorAll('[data-password-target]').forEach(btn=>btn.closest('.checkout-field')?.setAttribute('hidden',''));
            if(isLynkMode())showLynkConfirm(false);
        }else{
            const check=el("checkoutCheckBtn"), pay=el("checkoutPayBtn");
            if(check)check.hidden=false;if(pay)pay.textContent="Lanjut ke Metode Pembayaran";
        }
        el("checkoutPeriod").addEventListener("change",renderSummary);el("checkoutGateway")?.addEventListener("change",()=>{syncGatewaySummary();renderSummary()});el("checkoutCloseBtn").addEventListener("click",close);form.addEventListener("submit",async e=>{e.preventDefault();try{await submit()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});el("checkoutCheckBtn").addEventListener("click",async()=>{try{await checkLast()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutHideSnapBtn")?.addEventListener("click",hideSnap);
        el("checkoutReopenBtn")?.addEventListener("click",async()=>{try{await reopenPayment()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutCancelBtn")?.addEventListener("click",async()=>{try{await cancelLast()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutLynkConfirmBtn")?.addEventListener("click",()=>{try{confirmLynkWhatsApp()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutLynkHelpBtn")?.addEventListener("click",()=>{try{lynkHelpWhatsApp()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("receiptCopyAllBtn")?.addEventListener("click",async()=>{if(!currentReceipt)return;try{await copyText(receiptText(currentReceipt));setStatus("✅ Semua data lisensi sudah disalin. Tetap simpan screenshot atau catatan cadangan.","success")}catch{setStatus("Gagal menyalin otomatis. Salin data lisensi secara manual.","error")}});
        el("receiptCopyKeyBtn")?.addEventListener("click",async()=>{if(!currentReceipt?.license_key)return;try{await copyText(currentReceipt.license_key);setStatus("✅ License Key sudah disalin.","success")}catch{setStatus("Gagal menyalin License Key secara otomatis.","error")}});
        el("receiptActivateBtn")?.addEventListener("click",()=>{if(!currentReceipt)return;const sc=el("storeCode"),lk=el("licenseKey");if(sc)sc.value=currentReceipt.store_code||"";if(lk)lk.value=currentReceipt.license_key||"";el("activation")?.scrollIntoView({behavior:"smooth",block:"start"});lk?.focus()});
        document.querySelectorAll("[data-password-target]").forEach(btn=>btn.addEventListener("click",()=>{const input=el(btn.getAttribute("data-password-target"));if(!input)return;const show=input.type==="password";input.type=show?"text":"password";btn.textContent=show?"Sembunyi":"Lihat"}));
        loadGatewayConfig();loadRefundPolicy();
        if(!isExternalManualMode()){const last=readLast();if(last?.order_id&&last?.status_token){el("checkoutCheckBtn").disabled=false;setPaymentManager(true,last);const params=new URLSearchParams(location.search);if(params.get("payment")==="return"){setTimeout(()=>status(last.order_id,last.status_token,false,true).catch(error=>setStatus(`❌ ${error.message||String(error)}`,"error")),700)}}}
    }
    window.LDMCheckoutV2=Object.freeze({open,close,checkLast,cancelLast,hideSnap,confirmLynkWhatsApp,init});if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

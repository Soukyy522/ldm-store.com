(function(){
    "use strict";
    const STORAGE_KEY="ldmPublicCheckoutV274";
    const PREVIOUS_STORAGE_KEY="ldmPublicCheckoutV273";
    const LEGACY_STORAGE_KEY="ldmPublicCheckoutV272";
    function cfg(){
        const base=window.LDM_LICENSE_V2_CONFIG||{};
        const url=String(base.checkoutUrl||"").trim() || String(base.serverUrl||"").replace(/\/ldm-license-v2\/?$/i,"/ldm-public-checkout-v2");
        return {url};
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
    function loadSnap(clientKey,environment){
        return new Promise((resolve,reject)=>{if(window.snap)return resolve();const s=document.createElement("script");s.src=environment==="production"?"https://app.midtrans.com/snap/snap.js":"https://app.sandbox.midtrans.com/snap/snap.js";s.setAttribute("data-client-key",clientKey);s.onload=()=>resolve();s.onerror=()=>reject(new Error("Midtrans Snap gagal dimuat."));document.head.appendChild(s)});
    }
    function cycleLabel(v){return v==="yearly"?"Tahunan":v==="lifetime"?"Lifetime":"Bulanan"}
    function amountFor(planCode,cycle){const p=window.LDM_LICENSE_V2_CONFIG?.plans?.[planCode]||{};return Number(cycle==="yearly"?p.yearly:cycle==="lifetime"?p.lifetime:p.monthly)||0}
    let currentPlan=null;
    let currentReceipt=null;
    let activePayment=null;
    function renderSummary(){if(!currentPlan)return;const cycle=el("checkoutPeriod").value;el("checkoutPlanName").textContent=currentPlan.planName;el("checkoutPlanPeriod").textContent=cycleLabel(cycle);el("checkoutPlanAmount").textContent=rupiah(amountFor(currentPlan.planCode,cycle))}
    function open(input){
        currentPlan={...input};const panel=el("publicCheckoutPanel");if(!panel)return alert("Panel pembayaran belum tersedia.");
        const select=el("checkoutPeriod");select.innerHTML=input.planCode==="LIFETIME"?'<option value="lifetime">Lifetime · sekali bayar</option>':'<option value="monthly">Bulanan</option><option value="yearly">Tahunan</option>';select.value=input.billingCycle||(input.planCode==="LIFETIME"?"lifetime":"monthly");renderSummary();panel.hidden=false;panel.classList.add("open");panel.scrollIntoView({behavior:"smooth",block:"start"});setStatus("Isi data customer, lalu lanjutkan ke metode pembayaran Midtrans.","info");
    }
    function close(){const panel=el("publicCheckoutPanel");if(panel){panel.hidden=true;panel.classList.remove("open")}}
    function saveLast(data){localStorage.setItem(STORAGE_KEY,JSON.stringify({order_id:data.order_id,status_token:data.status_token,created_at:Date.now()}))}
    function readLast(){
        try{
            const current=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
            if(current?.order_id&&current?.status_token)return current;
            const prev=JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY)||"null");
            if(prev?.order_id&&prev?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(prev));return prev}
            const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||"null");
            if(legacy?.order_id&&legacy?.status_token){localStorage.setItem(STORAGE_KEY,JSON.stringify(legacy));return legacy}
            return null;
        }catch{return null}
    }
    function setPaymentManager(show){const box=el("checkoutManageActions");if(box)box.hidden=!show}
    function clearLast(){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(PREVIOUS_STORAGE_KEY);localStorage.removeItem(LEGACY_STORAGE_KEY)}
    function hideSnap(){try{window.snap?.hide?.()}catch(_ignored){}setStatus("Metode pembayaran ditutup. Order belum dibatalkan. Kamu bisa membuka metode pembayaran lagi atau membatalkan order selama transaksi belum dibayar.","info")}
    async function reopenPayment(){if(!activePayment?.snap_token)throw new Error("Token pembayaran tidak tersedia pada sesi ini. Tekan Lanjut ke Metode Pembayaran lagi untuk membuka order pending yang sama.");await loadSnap(activePayment.client_key,activePayment.environment);window.snap.pay(activePayment.snap_token,{onSuccess:()=>{setStatus("Pembayaran selesai di Midtrans. Menunggu verifikasi webhook…","info");poll(activePayment.order_id,activePayment.status_token).catch(e=>setStatus(e.message,"error"))},onPending:()=>setStatus("Pembayaran masih pending. Selesaikan pembayaran atau batalkan order jika tidak ingin melanjutkan.","info"),onError:()=>setStatus("Midtrans melaporkan pembayaran gagal. Kamu dapat mencoba kembali.","error"),onClose:()=>setStatus("Jendela metode pembayaran ditutup. Order tetap pending sampai dibayar, kedaluwarsa, atau dibatalkan.","info")})}
    async function cancelLast(){const last=readLast();if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order yang dapat dibatalkan.");if(!confirm("Batalkan order pembayaran ini?\n\nGunakan ini hanya jika kamu benar-benar tidak ingin melanjutkan order tersebut. Order yang sudah settlement tidak dapat dibatalkan."))return;const btn=el("checkoutCancelBtn");if(btn){btn.disabled=true;btn.textContent="Membatalkan…"}try{const data=await call({action:"cancel",order_id:last.order_id,status_token:last.status_token});try{window.snap?.hide?.()}catch(_ignored){}activePayment=null;clearLast();setPaymentManager(false);if(el("checkoutCheckBtn"))el("checkoutCheckBtn").disabled=true;setStatus(`✅ Order ${data.order_id||last.order_id} berhasil dibatalkan. Kamu dapat memilih paket/periode dan membuat pembayaran baru.`,"success")}finally{if(btn){btn.disabled=false;btn.textContent="Batalkan Order Pembayaran"}}}
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
        setLink("receiptPasswordBtn",r.password_setup_url);setLink("receiptGuideBtn",r.guide_url);
        const provision=el("receiptProvisionNote");if(provision){provision.textContent=r.provision_status==="ready"?"Akun Owner dan toko Cloud sudah disiapkan. Buat password Owner sebelum login.":`Lisensi sudah aktif, tetapi penyiapan akun Owner belum selesai${r.provision_error?`: ${r.provision_error}`:"."}`;provision.className="receipt-provision "+(r.provision_status==="ready"?"ok":"warn")}
        panel.hidden=false;panel.classList.add("show");panel.scrollIntoView({behavior:"smooth",block:"center"});
    }
    async function status(orderId,statusToken,quiet=false){
        const data=await call({action:"status",order_id:orderId,status_token:statusToken});
        if(data.payment_status==="paid"){setPaymentManager(false);
            if(data.receipt?.license_key){renderReceipt(data.receipt);setStatus("✅ Pembayaran sudah terverifikasi. Data lisensi ditampilkan di bawah. Simpan sekarang sebelum meninggalkan halaman ini.","success")}
            else setStatus(`✅ Pembayaran sudah terverifikasi, tetapi data lisensi belum dapat ditampilkan${data.receipt_error?`: ${data.receipt_error}`:". Tekan Cek Status beberapa saat lagi."}`,"info");
        }else {const manageable=["pending","challenge"].includes(data.payment_status);setPaymentManager(manageable);if(!quiet)setStatus(`Status pembayaran: ${data.payment_status||"pending"}${data.provider_status?` / ${data.provider_status}`:""}.`,manageable?"info":"error") }
        return data;
    }
    async function poll(orderId,statusToken){
        for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,i===0?1800:2000));try{const data=await status(orderId,statusToken,true);if(data.payment_status==="paid"||["failed","expired","cancelled"].includes(data.payment_status)){if(data.payment_status!=="paid")setStatus(`Pembayaran ${data.payment_status}. Silakan buat order baru bila diperlukan.`,"error");return data}}catch(error){if(i===19)throw error}}
        setStatus("Pembayaran belum terkonfirmasi. Tekan Cek Status beberapa saat lagi.","info");
    }
    async function submit(){
        if(!currentPlan)throw new Error("Pilih paket terlebih dahulu.");const button=el("checkoutPayBtn");if(!el("checkoutAgree").checked)throw new Error("Centang persetujuan data dan ketentuan pembayaran.");
        const payload={action:"create",plan_code:currentPlan.planCode,billing_cycle:el("checkoutPeriod").value,customer_name:el("checkoutName").value.trim(),customer_email:el("checkoutEmail").value.trim(),customer_phone:el("checkoutPhone").value.trim(),store_name:el("checkoutStoreName").value.trim(),store_code:el("checkoutStoreCode").value.trim().toUpperCase()};
        button.disabled=true;button.textContent="Menyiapkan pembayaran…";
        try{
            setStatus("Memvalidasi data dan membuat order Midtrans…","info");const data=await call(payload);activePayment=data;saveLast(data);el("checkoutCheckBtn").disabled=false;setPaymentManager(true);setStatus(`Order ${data.order_id} dibuat. Total ${rupiah(data.amount)}. Membuka metode pembayaran…`,"info");await loadSnap(data.client_key,data.environment);
            if(window.snap)window.snap.pay(data.snap_token,{onSuccess:()=>{setStatus("Pembayaran selesai di Midtrans. Menunggu verifikasi webhook…","info");poll(data.order_id,data.status_token).catch(e=>setStatus(e.message,"error"))},onPending:()=>setStatus("Pembayaran masih pending. Kamu boleh menyelesaikan, mengganti metode, atau membatalkan order sebelum settlement.","info"),onError:()=>setStatus("Midtrans melaporkan pembayaran gagal. Kamu dapat mencoba kembali.","error"),onClose:()=>setStatus("Jendela metode pembayaran ditutup. Order tetap tersimpan. Gunakan Buka Metode Lagi untuk memilih metode lain, atau Batalkan Order bila tidak ingin melanjutkan.","info")});else if(data.redirect_url)location.href=data.redirect_url;
        }finally{button.disabled=false;button.textContent="Lanjut ke Metode Pembayaran"}
    }
    async function checkLast(){const last=readLast();if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order pembayaran pada perangkat ini.");return status(last.order_id,last.status_token,false)}
    function init(){
        const form=el("publicCheckoutForm");if(!form)return;el("checkoutPeriod").addEventListener("change",renderSummary);el("checkoutCloseBtn").addEventListener("click",close);form.addEventListener("submit",async e=>{e.preventDefault();try{await submit()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});el("checkoutCheckBtn").addEventListener("click",async()=>{try{await checkLast()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutHideSnapBtn")?.addEventListener("click",hideSnap);
        el("checkoutReopenBtn")?.addEventListener("click",async()=>{try{await reopenPayment()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("checkoutCancelBtn")?.addEventListener("click",async()=>{try{await cancelLast()}catch(error){setStatus(`❌ ${error.message||String(error)}`,"error")}});
        el("receiptCopyAllBtn")?.addEventListener("click",async()=>{if(!currentReceipt)return;try{await copyText(receiptText(currentReceipt));setStatus("✅ Semua data lisensi sudah disalin. Tetap simpan screenshot atau catatan cadangan.","success")}catch{setStatus("Gagal menyalin otomatis. Salin data lisensi secara manual.","error")}});
        el("receiptCopyKeyBtn")?.addEventListener("click",async()=>{if(!currentReceipt?.license_key)return;try{await copyText(currentReceipt.license_key);setStatus("✅ License Key sudah disalin.","success")}catch{setStatus("Gagal menyalin License Key secara otomatis.","error")}});
        el("receiptActivateBtn")?.addEventListener("click",()=>{if(!currentReceipt)return;const sc=el("storeCode"),lk=el("licenseKey");if(sc)sc.value=currentReceipt.store_code||"";if(lk)lk.value=currentReceipt.license_key||"";el("activation")?.scrollIntoView({behavior:"smooth",block:"start"});lk?.focus()});
        const last=readLast();if(last?.order_id&&last?.status_token){el("checkoutCheckBtn").disabled=false;setPaymentManager(true)}
    }
    window.LDMCheckoutV2=Object.freeze({open,close,checkLast,cancelLast,hideSnap,init});if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

(function(){
  "use strict";

  const STORAGE_KEY="ldmPublicCheckoutV281";
  const LEGACY_KEYS=["ldmPublicCheckoutV28","ldmPublicCheckoutV27","ldmPublicCheckoutV261","ldmPublicCheckoutV26","ldmPublicCheckoutV25"];
  const LYNK_PENDING_KEY="ldmLynkPendingV28";

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
  const rupiah=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0));
  const tanggal=v=>v?new Date(v).toLocaleString("id-ID"):"-";
  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  function setStatus(text,type="info"){
    const node=el("publicCheckoutStatus");
    if(!node)return;
    node.textContent=text;
    node.className="checkout-status show "+type;
  }

  function cycleLabel(v){return v==="two_year"?"2 Tahun":v==="yearly"?"Tahunan":"Bulanan";}
  function amountFor(planCode,cycle){return Number(window.LDM_LICENSE_V2_CONFIG?.plans?.[planCode]?.[cycle]||0);}
  function savingFor(planCode,cycle){
    const p=window.LDM_LICENSE_V2_CONFIG?.plans?.[planCode]||{};
    if(cycle==="yearly")return Math.max(0,Number(p.monthly||0)*12-Number(p.yearly||0));
    if(cycle==="two_year")return Math.max(0,Number(p.monthly||0)*24-Number(p.two_year||0));
    return 0;
  }

  async function post(url,payload){
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[a-z0-9-]+$/i.test(url))throw new Error("Layanan pembayaran belum dikonfigurasi.");
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:controller.signal});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||data?.ok===false){
        const e=new Error(data?.message||`HTTP ${res.status}`);
        e.code=data?.code||"REQUEST_FAILED";
        e.data=data;
        throw e;
      }
      return data;
    }finally{clearTimeout(timeout);}
  }

  function callStatus(payload){return post(cfg().statusUrl,payload);}
  function callOrder(payload){return post(cfg().orderUrl,payload);}

  let currentPlan=null;
  let currentReceipt=null;
  let receiptSensitiveRevealed=false;
  let receiptHideTimer=null;

  function renderSummary(){
    if(!currentPlan)return;
    const cycle=el("checkoutPeriod").value;
    el("checkoutPlanName").textContent=currentPlan.planName;
    el("checkoutPlanPeriod").textContent=cycleLabel(cycle);
    el("checkoutPlanAmount").textContent=rupiah(amountFor(currentPlan.planCode,cycle));
    const g=el("checkoutGatewaySummary");if(g)g.textContent="Lynk.id";
    const save=el("checkoutPeriodSaving");
    if(save){
      const s=savingFor(currentPlan.planCode,cycle);
      save.textContent=s>0?`Hemat ${rupiah(s)} dibanding ${cycle==="two_year"?"24":"12"}× pembayaran bulanan.`:"";
      save.hidden=s<=0;
    }
  }

  function open(input){
    currentPlan={...input};
    const panel=el("publicCheckoutPanel");
    if(!panel){alert("Panel pembayaran belum tersedia.");return;}
    const select=el("checkoutPeriod");
    select.innerHTML='<option value="monthly">Bulanan</option><option value="yearly">Tahunan</option><option value="two_year">2 Tahun</option>';
    select.value=["monthly","yearly","two_year"].includes(input.billingCycle)?input.billingCycle:"monthly";
    renderSummary();
    panel.hidden=false;
    panel.classList.add("open");
    panel.scrollIntoView({behavior:"smooth",block:"start"});window.dispatchEvent(new CustomEvent("ldm-paid-receipt-ready",{detail:{order_id:r.order_id||null}}));
    setStatus("Isi data customer, lalu lanjutkan pembayaran melalui Lynk.id. Order dapat dibatalkan selama pembayaran belum terverifikasi.","info");
  }

  function close(){
    const panel=el("publicCheckoutPanel");
    if(panel){panel.hidden=true;panel.classList.remove("open");}
  }

  function saveLast(data){
    localStorage.setItem(STORAGE_KEY,JSON.stringify({
      order_id:data.order_id,
      status_token:data.status_token,
      payment_gateway:"lynk",
      redirect_url:data.redirect_url||null,
      created_at:Date.now()
    }));
  }

  function readLast(){
    try{
      const cur=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if(cur?.order_id&&cur?.status_token)return cur;
      for(const key of LEGACY_KEYS){
        const old=JSON.parse(localStorage.getItem(key)||"null");
        if(old?.order_id&&old?.status_token&&String(old.payment_gateway||"lynk").toLowerCase()==="lynk"){
          saveLast(old);return old;
        }
      }
    }catch(_e){}
    return null;
  }

  function setText(id,v){const n=el(id);if(n)n.textContent=v??"-";}
  function setLink(id,url){const n=el(id);if(!n)return;if(url){n.href=url;n.hidden=false;}else{n.removeAttribute("href");n.hidden=true;}}
  function masked(v,keep=4){const s=String(v||"");if(!s)return "-";if(s.length<=keep)return "••••";return `${"•".repeat(Math.min(12,Math.max(6,s.length-keep)))}${s.slice(-keep)}`;}
  function setReceiptSensitive(reveal){
    receiptSensitiveRevealed=Boolean(reveal);
    const r=currentReceipt||{};
    setText("receiptLicenseKey",receiptSensitiveRevealed?(r.license_key||"-"):"••••••••••••••••••••");
    setText("receiptStoreCode",receiptSensitiveRevealed?(r.store_code||"-"):masked(r.store_code,3));
    setText("receiptStoreId",receiptSensitiveRevealed?(r.store_id||"-"):masked(r.store_id,6));
    setText("receiptNetworkId",receiptSensitiveRevealed?(r.network_id||"-"):masked(r.network_id,6));
    const revealBtn=el("receiptRevealBtn");if(revealBtn)revealBtn.textContent=receiptSensitiveRevealed?"Sembunyikan Data Penting":"Reveal Data Penting";
    ["receiptCopyAllBtn","receiptCopyKeyBtn","receiptActivateBtn"].forEach(id=>{const b=el(id);if(b)b.disabled=!receiptSensitiveRevealed;});
    if(receiptHideTimer){clearTimeout(receiptHideTimer);receiptHideTimer=null;}
    if(receiptSensitiveRevealed){
      receiptHideTimer=setTimeout(()=>setReceiptSensitive(false),90000);
    }
  }

  function receiptText(r){return [
    "LOCDailyMar — DATA LISENSI",
    `Order ID: ${r.order_id||"-"}`,
    `Paket: ${r.plan_name||r.plan_code||"-"}`,
    `Periode: ${r.period_label||cycleLabel(r.billing_cycle)}`,
    `License Key: ${r.license_key||"-"}`,
    `Store Code: ${r.store_code||"-"}`,
    `Store UUID: ${r.store_id||"-"}`,
    `Network ID: ${r.network_id||"-"}`,
    `Email Owner: ${r.owner_email||"-"}`,
    `Masa berlaku: ${tanggal(r.expires_at)}`
  ].join("\n");}

  async function copyText(text){
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
    const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
  }

  function renderReceipt(r){
    if(!r?.license_key)return;
    currentReceipt=r;
    const panel=el("licenseReceipt");if(!panel)return;
    setText("receiptOrderId",r.order_id);
    setText("receiptPlan",`${r.plan_name||r.plan_code||"-"} · ${r.period_label||cycleLabel(r.billing_cycle)}`);
    setReceiptSensitive(false);
    setText("receiptOwnerEmail",r.owner_email);
    setText("receiptExpires",tanggal(r.expires_at));
    setText("receiptPasswordState",r.credentials_source==="customer_checkout"?"Gunakan kredensial Owner yang sudah dibuat":"Gunakan tombol Buat / Ganti Password Owner");
    setLink("receiptLoginBtn",r.login_url);
    setLink("receiptPasswordBtn",r.password_setup_url);
    setLink("receiptGuideBtn",r.guide_url);
    const refundBtn=el("receiptRefundBtn");
    if(refundBtn){refundBtn.href="#licenseRefundSection";refundBtn.hidden=false;}
    const provision=el("receiptProvisionNote");
    if(provision){
      provision.textContent=r.provision_status==="ready"?"Lisensi dan akun Owner sudah siap digunakan.":`Lisensi aktif, tetapi provisioning akun belum selesai${r.provision_error?`: ${r.provision_error}`:"."}`;
      provision.className="receipt-provision "+(r.provision_status==="ready"?"ok":"warn");
    }
    panel.hidden=false;
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function updateManageActions(data){
    const box=el("checkoutManageActions");
    const cancel=el("checkoutCancelBtn");
    const hideSnap=el("checkoutHideSnapBtn");
    const reopen=el("checkoutReopenBtn");
    if(hideSnap)hideSnap.hidden=true;
    if(reopen)reopen.hidden=true;
    if(!box)return;
    const st=String(data?.payment_status||"").toLowerCase();
    box.hidden=!data?.order_id;
    if(cancel){
      cancel.hidden=false;
      cancel.disabled=!["pending","challenge"].includes(st);
      cancel.textContent=st==="cancelled"?"Order Sudah Dibatalkan":"Batalkan Order Pembayaran";
    }
  }

  async function status(orderId,statusToken,quiet=false){
    const data=await callStatus({action:"status",order_id:orderId,status_token:statusToken});
    if(data.receipt)renderReceipt(data.receipt);
    updateManageActions(data);
    if(!quiet){
      if(data.payment_status==="paid")setStatus("✅ Pembayaran Lynk.id sudah terverifikasi. Data lisensi tersedia di bawah. Form Refund Penuh akan tersedia selama transaksi masih berada dalam batas 24 jam.","success");
      else if(data.payment_status==="cancelled")setStatus("Order LocDailyMar sudah dibatalkan. Tutup halaman pembayaran Lynk.id dan jangan lanjutkan pembayaran pada order ini.","info");
      else if(["failed","expired"].includes(String(data.payment_status||"").toLowerCase()))setStatus(`Pembayaran berstatus ${data.payment_status}. Hubungi Support bila dana sudah terpotong.`,"error");
      else setStatus(`Status pembayaran Lynk.id: ${data.payment_status||"pending"}.`,"info");
    }
    return data;
  }

  async function poll(orderId,statusToken){
    for(let i=0;i<90;i++){
      await wait(i===0?2200:4000);
      const data=await status(orderId,statusToken,true);
      if(data.payment_status==="paid"){setStatus("✅ Pembayaran Lynk.id terverifikasi dan lisensi sudah diproses.","success");return data;}
      if(["failed","expired","cancelled"].includes(String(data.payment_status||"").toLowerCase()))return data;
    }
    setStatus("Pembayaran belum terkonfirmasi otomatis. Gunakan tombol Cek Status Pembayaran atau Bantuan WhatsApp.","info");
  }

  function validLynkUrl(raw){
    try{
      const u=new URL(String(raw||"").trim());
      if(u.protocol==="http:")u.protocol="https:";
      return u.protocol==="https:"&&(u.hostname.toLowerCase()==="lynk.id"||u.hostname.toLowerCase()==="www.lynk.id")?u.href:"";
    }catch{return "";}
  }

  function resolveLynkUrl(planCode,cycle){
    const raw=String(cfg().links?.[planCode]?.[cycle]||"").trim();
    const url=validLynkUrl(raw);
    if(!url)throw new Error(`Link Lynk.id untuk ${currentPlan?.planName||planCode} · ${cycleLabel(cycle)} belum valid. Pastikan URL lengkap memakai https://lynk.id/...`);
    return url;
  }

  function validate(){
    if(!currentPlan)throw new Error("Pilih paket terlebih dahulu.");
    if(!el("checkoutAgree")?.checked)throw new Error("Centang persetujuan data dan ketentuan pembayaran.");
    const name=el("checkoutName").value.trim(),email=el("checkoutEmail").value.trim(),store=el("checkoutStoreName").value.trim(),code=el("checkoutStoreCode").value.trim().toUpperCase();
    if(!name||!email||!store||!code)throw new Error("Nama Customer, Email Owner, Nama Toko, dan Store Code wajib diisi.");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Email Owner tidak valid.");
    if(!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code))throw new Error("Store Code harus 3-30 karakter: huruf kapital, angka, atau tanda strip.");
  }

  function savePending(data){localStorage.setItem(LYNK_PENDING_KEY,JSON.stringify({...data,created_at:Date.now()}));}
  function openWhatsApp(message){const phone=cfg().whatsapp;if(!/^62\d{7,15}$/.test(phone))throw new Error("Nomor WhatsApp Support belum valid.");window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");}

  function helpWhatsApp(){
    const cycle=el("checkoutPeriod")?.value||"monthly";
    openWhatsApp(["Halo Tim LocDailyMar, saya membutuhkan bantuan pembayaran melalui Lynk.id.","",`Paket: ${currentPlan?.planName||"-"}`,`Periode: ${cycleLabel(cycle)}`,`Total: ${rupiah(currentPlan?amountFor(currentPlan.planCode,cycle):0)}`,`Store Code: ${String(el("checkoutStoreCode")?.value||"").trim().toUpperCase()||"-"}`].join("\n"));
  }

  async function submitLynk(){
    validate();
    const cycle=el("checkoutPeriod").value;
    const url=resolveLynkUrl(currentPlan.planCode,cycle);
    const button=el("checkoutPayBtn");
    button.disabled=true;button.textContent="Membuat order Lynk.id…";
    try{
      setStatus("Menyiapkan order pembayaran…","info");
      const data=await callOrder({
        plan_code:currentPlan.planCode,
        billing_cycle:cycle,
        customer_name:el("checkoutName").value.trim(),
        customer_email:el("checkoutEmail").value.trim(),
        customer_phone:el("checkoutPhone").value.trim(),
        store_name:el("checkoutStoreName").value.trim(),
        store_code:el("checkoutStoreCode").value.trim().toUpperCase(),
        checkout_url:url
      });
      saveLast(data);
      savePending({order_id:data.order_id,status_token:data.status_token,plan_code:currentPlan.planCode,billing_cycle:cycle,amount:data.amount,redirect_url:url});
      const check=el("checkoutCheckBtn");if(check){check.hidden=false;check.disabled=false;}
      updateManageActions({order_id:data.order_id,payment_status:"pending"});
      setStatus(`✅ Order ${data.order_id} dibuat. Lynk.id dibuka di tab baru. Jika berubah pikiran sebelum membayar, kembali ke halaman ini dan tekan Batalkan Order Pembayaran.`,"success");
      const w=window.open(url,"_blank","noopener,noreferrer");if(!w)location.href=url;
      poll(data.order_id,data.status_token).catch(e=>setStatus(`Pemeriksaan otomatis berhenti: ${e.message||e}. Gunakan Cek Status Pembayaran.`,"error"));
    }finally{button.disabled=false;button.textContent="Lanjut Bayar via Lynk.id";}
  }

  async function cancelOrder(){
    const last=readLast();
    if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order Lynk.id yang dapat dibatalkan pada perangkat ini.");
    const confirmed=window.confirm("Batalkan order LocDailyMar ini?\n\nPembatalan hanya berlaku untuk order LocDailyMar yang masih PENDING. Tutup tab Lynk.id dan jangan melakukan pembayaran setelah order dibatalkan. Jika pembayaran sudah terverifikasi, gunakan proses refund, bukan cancel order.");
    if(!confirmed)return;
    const btn=el("checkoutCancelBtn");if(btn){btn.disabled=true;btn.textContent="Membatalkan…";}
    try{
      const data=await callStatus({action:"cancel_order",order_id:last.order_id,status_token:last.status_token});
      updateManageActions({order_id:last.order_id,payment_status:"cancelled"});
      setStatus(`✅ Order ${last.order_id} berhasil dibatalkan. Tutup tab Lynk.id dan jangan membayar order tersebut. Kamu dapat membuat order baru dengan paket/periode yang benar.`,"success");
      return data;
    }catch(e){
      if(e?.code==="PAYMENT_ALREADY_PAID"){
        setStatus("Pembayaran sudah terverifikasi sehingga order tidak dapat dibatalkan. Gunakan form Refund Penuh pada hasil lisensi selama masih berada dalam batas 24 jam.","error");
      }else setStatus(`❌ ${e.message||e}`,"error");
      throw e;
    }finally{
      if(btn&&btn.textContent==="Membatalkan…"){btn.disabled=false;btn.textContent="Batalkan Order Pembayaran";}
    }
  }

  async function checkLast(){
    const last=readLast();
    if(!last?.order_id||!last?.status_token)throw new Error("Belum ada order Lynk.id pada perangkat ini.");
    return status(last.order_id,last.status_token,false);
  }

  async function loadRefundPolicy(){
    const days=el("refundPolicyDays"),state=el("refundPolicyState");
    if(!days&&!state)return;
    try{
      const d=await callStatus({action:"refund_policy"});
      const p=d.policy||{},hours=Math.max(1,Number(p.refund_window_hours||24));
      if(days)days.textContent=`${hours} jam`;
      if(state)state.textContent=p.enabled===false?"Refund sedang dinonaktifkan sementara.":`Kebijakan internal LocDailyMar · Refund Penuh · maksimal ${hours} jam · proses 2-3 hari kerja.`;
    }catch(_e){if(days)days.textContent="24 jam";if(state)state.textContent="Kebijakan refund LocDailyMar belum dapat dimuat.";}
  }

  function init(){
    const form=el("publicCheckoutForm");if(!form)return;
    const gateway=el("checkoutGatewayField");if(gateway)gateway.hidden=true;
    const notice=el("checkoutLynkNotice");if(notice)notice.hidden=false;
    ["checkoutOwnerPassword","checkoutOwnerPasswordConfirm"].forEach(id=>{const input=el(id);if(input){input.required=false;input.removeAttribute("required");input.closest(".checkout-field")?.setAttribute("hidden","");}});
    const pay=el("checkoutPayBtn");if(pay)pay.textContent="Lanjut Bayar via Lynk.id";
    const check=el("checkoutCheckBtn");if(check){check.hidden=false;check.disabled=!readLast()?.order_id;}
    const manual=el("checkoutLynkConfirmBtn");if(manual)manual.hidden=true;
    const hideSnap=el("checkoutHideSnapBtn");if(hideSnap)hideSnap.hidden=true;
    const reopen=el("checkoutReopenBtn");if(reopen)reopen.hidden=true;
    const last=readLast();if(last?.order_id)updateManageActions({order_id:last.order_id,payment_status:"pending"});

    el("checkoutPeriod")?.addEventListener("change",renderSummary);
    el("checkoutCloseBtn")?.addEventListener("click",close);
    form.addEventListener("submit",async e=>{e.preventDefault();try{await submitLynk();}catch(err){setStatus(`❌ ${err.message||err}`,"error");}});
    check?.addEventListener("click",async()=>{try{await checkLast();}catch(err){setStatus(`❌ ${err.message||err}`,"error");}});
    el("checkoutCancelBtn")?.addEventListener("click",()=>{cancelOrder().catch(()=>{});});
    el("checkoutLynkHelpBtn")?.addEventListener("click",()=>{try{helpWhatsApp();}catch(err){setStatus(`❌ ${err.message||err}`,"error");}});
    el("receiptRevealBtn")?.addEventListener("click",()=>setReceiptSensitive(!receiptSensitiveRevealed));
    el("receiptCopyAllBtn")?.addEventListener("click",async()=>{if(currentReceipt&&receiptSensitiveRevealed)await copyText(receiptText(currentReceipt));});
    el("receiptCopyKeyBtn")?.addEventListener("click",async()=>{if(currentReceipt?.license_key&&receiptSensitiveRevealed)await copyText(currentReceipt.license_key);});
    el("receiptActivateBtn")?.addEventListener("click",()=>{if(!currentReceipt||!receiptSensitiveRevealed)return;const sc=el("storeCode"),lk=el("licenseKey");if(sc)sc.value=currentReceipt.store_code||"";if(lk){lk.value=currentReceipt.license_key||"";lk.type="password";}el("activation")?.scrollIntoView({behavior:"smooth",block:"start"});});
    loadRefundPolicy();
    const params=new URLSearchParams(location.search);
    if(params.get("payment")==="return"&&last?.order_id)setTimeout(()=>status(last.order_id,last.status_token,false).catch(()=>{}),700);
    else if(last?.order_id)setTimeout(()=>status(last.order_id,last.status_token,true).catch(()=>{}),500);
  }

  window.LDMCheckoutV2=Object.freeze({open,close,checkLast,cancelOrder,init});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

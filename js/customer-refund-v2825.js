(function(){
  "use strict";

  const STORAGE_KEYS=[
    "ldmPublicCheckoutV281","ldmPublicCheckoutV28","ldmPublicCheckoutV27",
    "ldmPublicCheckoutV261","ldmPublicCheckoutV26","ldmPublicCheckoutV25",
    "ldmPublicCheckoutV278","ldmPublicCheckoutV276","ldmPublicCheckoutV273","ldmPublicCheckoutV272"
  ];

  const ACTIVE_STATUS=new Set(["submitted","reviewing","waiting_customer","approved","processing"]);
  const $=id=>document.getElementById(id);
  const money=v=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0));
  const fmt=v=>{
    if(!v)return "-";
    const d=new Date(v);
    if(Number.isNaN(d.getTime()))return String(v);
    return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Makassar"}).format(d);
  };
  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));

  function readContext(){
    for(const key of STORAGE_KEYS){
      try{
        const data=JSON.parse(localStorage.getItem(key)||"null");
        if(data?.order_id&&data?.status_token){
          return {order_id:String(data.order_id),status_token:String(data.status_token)};
        }
      }catch{}
    }
    return null;
  }

  function checkoutUrl(){
    const base=window.LDM_LICENSE_V2_CONFIG||{};
    const url=String(base.checkoutUrl||"").trim()
      ||String(base.serverUrl||"").replace(/\/ldm-license-v2\/?$/i,"/ldm-public-checkout-v2");
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ldm-public-checkout-v2$/i.test(url)){
      throw new Error("URL Public Checkout belum dikonfigurasi.");
    }
    return url;
  }

  async function call(payload){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(checkoutUrl(),{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
        cache:"no-store",
        signal:controller.signal
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.ok===false){
        const error=new Error(data?.message||`Refund HTTP ${response.status}`);
        error.code=data?.code||"REFUND_REQUEST_FAILED";
        error.data=data;
        throw error;
      }
      return data;
    }finally{
      clearTimeout(timeout);
    }
  }

  function statusLabel(value){
    return ({
      submitted:"Diajukan",
      reviewing:"Sedang Diverifikasi",
      waiting_customer:"Menunggu Informasi",
      approved:"Disetujui",
      processing:"Sedang Diproses",
      completed:"Refund Selesai",
      rejected:"Ditolak",
      cancelled:"Dibatalkan"
    })[String(value||"").toLowerCase()]||String(value||"-");
  }

  function categoryLabel(value){
    return ({
      duplicate_payment:"Pembayaran ganda / duplikat",
      wrong_plan:"Salah memilih paket",
      wrong_period:"Salah memilih periode",
      provisioning_issue:"Kendala aktivasi / provisioning lisensi",
      technical_issue:"Kendala teknis aplikasi",
      service_issue:"Kendala layanan",
      changed_mind:"Membatalkan pembelian",
      other:"Alasan lainnya"
    })[String(value||"")]||String(value||"-");
  }

  function configs(){
    return [
      {
        key:"support",
        section:"refundRequestSection",
        form:"refundRequestFormWrap",
        message:"refundRequestMessage",
        context:"refundContextMessage",
        info:"refundInfoGrid",
        expired:"refundExpiredNote",
        expiredText:"refundExpiredText",
        existing:"refundExistingRequest",
        order:"refundOrderId",
        status:"refundPaymentStatus",
        amount:"refundPaymentAmount",
        requested:"refundRemainingAmount",
        paidAt:"refundPaidAt",
        deadline:"refundDeadline",
        plan:"refundPlan",
        email:"refundRequesterEmail",
        type:"refundRequestType",
        category:"refundReasonCategory",
        detail:"refundReasonDetail",
        chars:"refundReasonChars",
        confirm:"refundRequestConfirm",
        submit:"btnSubmitRefundRequest",
        refresh:"btnRefreshRefundContext",
        showExpired:true,
        requirePaidReceipt:false
      },
      {
        key:"license",
        section:"licenseRefundSection",
        form:"licenseRefundFormWrap",
        message:"licenseRefundMessage",
        context:"licenseRefundContextMessage",
        info:"licenseRefundInfoGrid",
        expired:"licenseRefundExpiredNote",
        expiredText:"licenseRefundExpiredText",
        existing:"licenseRefundExistingRequest",
        order:"licenseRefundOrderId",
        status:"licenseRefundPaymentStatus",
        amount:"licenseRefundPaymentAmount",
        requested:"licenseRefundAmount",
        paidAt:"licenseRefundPaidAt",
        deadline:"licenseRefundDeadline",
        plan:"licenseRefundPlan",
        email:"licenseRefundEmail",
        type:"licenseRefundType",
        category:"licenseRefundReasonCategory",
        detail:"licenseRefundReasonDetail",
        chars:"licenseRefundReasonChars",
        confirm:"licenseRefundConfirm",
        submit:"licenseRefundSubmit",
        refresh:"licenseRefundRefresh",
        showExpired:false,
        requirePaidReceipt:true
      }
    ];
  }

  const state=new Map();

  function setMessage(cfg,text,type=""){
    const node=$(cfg.message);
    if(!node)return;
    node.textContent=text||"";
    node.className=(cfg.key==="support"?"support-message ":"license-refund-message ")+(type||"");
  }

  function setFormDisabled(cfg,disabled){
    [cfg.email,cfg.type,cfg.category,cfg.detail,cfg.confirm,cfg.submit].forEach(id=>{
      const n=$(id);
      if(n)n.disabled=disabled;
    });
    const type=$(cfg.type);
    if(type){type.value="full";type.disabled=true;}
  }

  function renderExisting(cfg,request){
    const box=$(cfg.existing);
    if(!box)return;
    if(!request){
      box.hidden=true;
      box.innerHTML="";
      return;
    }

    const active=ACTIVE_STATUS.has(String(request.status||"").toLowerCase());
    box.hidden=false;
    box.innerHTML=`
      <div class="refund-existing-head">
        <div>
          <strong class="refund-request-code">${esc(request.request_code||"-")}</strong>
          <span>${esc(statusLabel(request.status))}</span>
        </div>
        ${["submitted","waiting_customer"].includes(String(request.status||"").toLowerCase())
          ? `<button type="button" class="btn btn-soft js-cancel-refund">Batalkan Request</button>`
          : ""}
      </div>
      <div class="refund-existing-meta">
        <span>Refund Penuh</span>
        <span>${esc(money(request.requested_amount))}</span>
        <span>${esc(categoryLabel(request.reason_category))}</span>
      </div>
      <div class="refund-existing-note">
        Diajukan ${esc(fmt(request.created_at))}
        ${request.processing_due_at?` · Estimasi selesai maksimal ${esc(fmt(request.processing_due_at))}`:" · Estimasi proses 2-3 hari kerja"}
      </div>
      ${request.response_note?`<div class="refund-response-note"><strong>Catatan Developer:</strong><br>${esc(request.response_note)}</div>`:""}
    `;

    const cancel=box.querySelector(".js-cancel-refund");
    if(cancel)cancel.addEventListener("click",()=>cancelRequest(cfg));
    if(active)setFormDisabled(cfg,true);
  }

  function renderInfo(cfg,data){
    const p=data.payment||{};
    const e=data.eligibility||{};
    const l=data.license||{};

    const map=[
      [cfg.order,p.order_id||"-"],
      [cfg.status,String(p.status||"-").toUpperCase()],
      [cfg.amount,money(p.amount)],
      [cfg.requested,money(e.full_refund_amount||p.amount)],
      [cfg.paidAt,fmt(p.paid_at)],
      [cfg.deadline,fmt(e.refund_deadline)],
      [cfg.plan,l.plan_code||"-"]
    ];
    for(const [id,value] of map){
      const n=$(id);
      if(n)n.textContent=value;
    }

    const info=$(cfg.info);
    if(info)info.hidden=false;

    const email=$(cfg.email);
    if(email && !email.value){
      email.value=String(l.customer_email||"");
    }
  }

  function paidReceiptReady(){
    const receipt=$("licenseReceipt");
    return Boolean(receipt && !receipt.hidden);
  }

  function render(cfg,data){
    state.set(cfg.key,data);
    const section=$(cfg.section);
    const form=$(cfg.form);
    const context=$(cfg.context);
    const expired=$(cfg.expired);

    if(!section)return;

    const p=data.payment||{};
    const e=data.eligibility||{};
    const request=data.request||null;
    const paymentPaid=String(p.status||"").toLowerCase()==="paid";
    const active=request && ACTIVE_STATUS.has(String(request.status||"").toLowerCase());

    // License: refund block only exists after paid receipt or when an existing
    // request belongs to that already-paid order.
    if(cfg.requirePaidReceipt && !paidReceiptReady() && !active){
      section.hidden=true;
      return;
    }

    // Unpaid/cancelled order never gets a customer refund form.
    if(!paymentPaid && !active){
      section.hidden=true;
      return;
    }

    renderExisting(cfg,request);

    if(active){
      section.hidden=false;
      if(form)form.hidden=true;
      if(expired)expired.hidden=true;
      if(context){
        context.className=cfg.key==="support"?"refund-state info":"license-refund-state info";
        context.textContent=`Permintaan ${request.request_code} sedang diproses. Estimasi normal 2-3 hari kerja.`;
      }
      renderInfo(cfg,data);
      return;
    }

    if(e.eligible===true){
      section.hidden=false;
      if(form)form.hidden=false;
      if(expired)expired.hidden=true;
      setFormDisabled(cfg,false);
      renderInfo(cfg,data);
      if(context){
        context.className=cfg.key==="support"?"refund-state info":"license-refund-state info";
        context.textContent=`Refund Penuh masih dapat diajukan sampai ${fmt(e.refund_deadline)}. Setelah dikirim, proses diperkirakan 2-3 hari kerja.`;
      }
      return;
    }

    // Window expired: form MUST disappear.
    if(form)form.hidden=true;
    const deadline=e.refund_deadline?new Date(e.refund_deadline).getTime():0;
    const isExpired=deadline>0 && Date.now()>deadline;

    if(cfg.showExpired && paymentPaid){
      section.hidden=false;
      renderInfo(cfg,data);
      if(context){
        context.className=cfg.key==="support"?"refund-state warn":"license-refund-state warn";
        context.textContent=isExpired
          ?"Batas pengajuan refund 24 jam sudah berakhir."
          :(e.reason||"Pembayaran ini tidak memenuhi syarat refund.");
      }
      if(expired){
        expired.hidden=!isExpired;
        const text=$(cfg.expiredText);
        if(text && isExpired){
          text.textContent=`Batas pengajuan berakhir pada ${fmt(e.refund_deadline)}. Form refund tidak lagi tersedia untuk transaksi ini.`;
        }
      }
    }else{
      // Pada license.html, setelah >24 jam form/section benar-benar hilang.
      section.hidden=true;
    }
  }

  async function load(cfg,forceShow=false){
    const section=$(cfg.section);
    if(!section)return;

    if(cfg.requirePaidReceipt && !paidReceiptReady() && !forceShow){
      section.hidden=true;
      return;
    }

    const checkout=readContext();
    if(!checkout){
      section.hidden=true;
      return;
    }

    try{
      const data=await call({
        action:"refund_context",
        order_id:checkout.order_id,
        status_token:checkout.status_token
      });
      render(cfg,data);
    }catch(error){
      if(cfg.requirePaidReceipt)section.hidden=true;
      else{
        section.hidden=false;
        const c=$(cfg.context);
        if(c){
          c.className="refund-state off";
          c.textContent=error?.message||"Kelayakan refund belum dapat diperiksa.";
        }
        const form=$(cfg.form);
        if(form)form.hidden=true;
      }
    }
  }

  async function submit(cfg){
    const data=state.get(cfg.key);
    if(!data?.eligibility?.eligible){
      setMessage(cfg,"Pembayaran tidak memenuhi syarat refund.","error");
      return;
    }

    const email=String($(cfg.email)?.value||"").trim().toLowerCase();
    const type=String($(cfg.type)?.value||"full").trim().toLowerCase();
    const category=String($(cfg.category)?.value||"").trim().toLowerCase();
    const detail=String($(cfg.detail)?.value||"").trim();
    const confirmed=Boolean($(cfg.confirm)?.checked);

    if(type!=="full"){
      setMessage(cfg,"Jenis refund yang tersedia hanya Refund Penuh.","error");
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      setMessage(cfg,"Email wajib diisi dengan format yang valid.","error");
      return;
    }
    if(!category){
      setMessage(cfg,"Pilih kategori alasan refund.","error");
      return;
    }
    if(detail.length<20){
      setMessage(cfg,"Alasan refund wajib diisi minimal 20 karakter.","error");
      return;
    }
    if(!confirmed){
      setMessage(cfg,"Centang konfirmasi ketentuan refund terlebih dahulu.","error");
      return;
    }

    const checkout=readContext();
    if(!checkout){
      setMessage(cfg,"Data order checkout tidak ditemukan pada perangkat ini.","error");
      return;
    }

    const button=$(cfg.submit);
    if(button){button.disabled=true;button.textContent="Mengirim Permintaan…";}
    setMessage(cfg,"Mengirim permintaan refund penuh ke Developer LocDailyMar…","");

    try{
      const response=await call({
        action:"refund_request_create",
        order_id:checkout.order_id,
        status_token:checkout.status_token,
        refund_type:"full",
        amount:Number(data.payment?.amount||0),
        reason_category:category,
        reason_detail:detail,
        requester_email:email
      });
      setMessage(
        cfg,
        `Permintaan ${response.request?.request_code||"RFD"} berhasil dibuat. Estimasi proses 2-3 hari kerja.`,
        "ok"
      );
      await load(cfg,true);
    }catch(error){
      setMessage(cfg,error?.message||"Permintaan refund gagal dikirim.","error");
    }finally{
      if(button){button.disabled=false;button.textContent="↩️ Ajukan Refund Penuh";}
    }
  }

  async function cancelRequest(cfg){
    const data=state.get(cfg.key);
    const request=data?.request;
    const checkout=readContext();
    if(!request?.request_code||!checkout)return;

    if(!window.confirm(`Batalkan permintaan ${request.request_code}?`))return;

    try{
      await call({
        action:"refund_request_cancel",
        order_id:checkout.order_id,
        status_token:checkout.status_token,
        request_code:request.request_code
      });
      setMessage(cfg,"Permintaan refund dibatalkan.","ok");
      await load(cfg,true);
    }catch(error){
      setMessage(cfg,error?.message||"Gagal membatalkan permintaan refund.","error");
    }
  }

  function bind(cfg){
    const detail=$(cfg.detail);
    if(detail){
      detail.addEventListener("input",()=>{
        const chars=$(cfg.chars);
        if(chars)chars.textContent=String(detail.value.length);
      });
    }

    const submitBtn=$(cfg.submit);
    if(submitBtn)submitBtn.addEventListener("click",()=>submit(cfg));

    const refreshBtn=$(cfg.refresh);
    if(refreshBtn)refreshBtn.addEventListener("click",()=>load(cfg,true));

    const type=$(cfg.type);
    if(type){type.value="full";type.disabled=true;}
  }

  function init(){
    for(const cfg of configs()){
      if($(cfg.section)){
        bind(cfg);
        load(cfg,false);
      }
    }
  }

  function refreshLicense(){
    const cfg=configs().find(x=>x.key==="license");
    if(cfg&&$(cfg.section))load(cfg,true);
  }

  function refreshSupport(){
    const cfg=configs().find(x=>x.key==="support");
    if(cfg&&$(cfg.section))load(cfg,true);
  }

  window.addEventListener("ldm-paid-receipt-ready",()=>refreshLicense());

  window.LDMCustomerRefund=Object.freeze({
    init,
    refreshLicense,
    refreshSupport
  });

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",init,{once:true});
  }else{
    init();
  }
})();

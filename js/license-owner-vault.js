(function(){
  "use strict";

  const $ = (id) => document.getElementById(id);
  let revealed = new Map();
  let hideTimers = new Map();

  function esc(value){
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[ch]);
  }

  function money(value){
    if(value===null || value===undefined || value==="") return "-";
    return new Intl.NumberFormat("id-ID",{
      style:"currency",currency:"IDR",maximumFractionDigits:0
    }).format(Number(value||0));
  }

  function date(value){
    if(!value) return "Tidak terbatas";
    const d=new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("id-ID");
  }

  function status(el,text,type="info"){
    if(!el)return;
    el.textContent=text;
    el.className="owner-vault-status show "+type;
  }

  function setBusy(btn,busy,busyText){
    if(!btn)return;
    if(!btn.dataset.originalLabel)btn.dataset.originalLabel=btn.textContent;
    btn.disabled=busy;
    btn.textContent=busy?busyText:btn.dataset.originalLabel;
  }

  function client(){
    if(!window.LDMSupabase?.createClient){
      throw new Error("Modul Supabase aplikasi belum termuat.");
    }
    return window.LDMSupabase.createClient();
  }

  async function session(){
    const c=client();
    const {data,error}=await c.auth.getSession();
    if(error)throw error;
    return data?.session||null;
  }

  async function accessToken(){
    const s=await session();
    if(!s?.access_token){
      throw Object.assign(new Error("Login Owner diperlukan."),{code:"OWNER_AUTH_REQUIRED"});
    }
    return s.access_token;
  }

  async function call(action,payload={}){
    if(!window.LDMLicenseV2?.call){
      throw new Error("Modul License V2 belum termuat.");
    }
    const token=await accessToken();
    return window.LDMLicenseV2.call(action,payload,{authorization:token});
  }

  function initPasswordToggles(){
    document.querySelectorAll("[data-password-target]").forEach(btn=>{
      if(btn.dataset.toggleReady==="1")return;
      btn.dataset.toggleReady="1";
      btn.addEventListener("click",()=>{
        const input=$(btn.dataset.passwordTarget);
        if(!input)return;
        const reveal=input.type==="password";
        input.type=reveal?"text":"password";
        btn.textContent=reveal?"Sembunyikan":"Lihat";
        btn.setAttribute("aria-pressed",reveal?"true":"false");
        input.focus({preventScroll:true});
        try{
          const end=input.value.length;
          input.setSelectionRange(end,end);
        }catch(_){}
      });
    });
  }

  function clearSensitive(licenseId){
    revealed.delete(String(licenseId));
    const timer=hideTimers.get(String(licenseId));
    if(timer)clearTimeout(timer);
    hideTimers.delete(String(licenseId));
  }

  function scheduleHide(licenseId){
    const id=String(licenseId);
    const old=hideTimers.get(id);
    if(old)clearTimeout(old);
    hideTimers.set(id,setTimeout(()=>{
      clearSensitive(id);
      const card=document.querySelector(`[data-vault-license="${CSS.escape(id)}"]`);
      if(card){
        const data=card.__ldmSummary;
        if(data)card.outerHTML=cardMarkup(data);
        bindCardActions();
      }
    },90000));
  }

  function sensitiveRows(r){
    const key=r.license_key||"";
    const recovery=r.recovery_note||"";
    return `
      <div class="owner-vault-secret-grid">
        <div><span>License Key</span><strong class="owner-vault-key">${key?esc(key):"Tidak dapat dipulihkan otomatis"}</strong></div>
        <div><span>Store Code</span><strong>${esc(r.store_code||"-")}</strong></div>
        <div><span>Store UUID</span><strong>${esc(r.store_id||"-")}</strong></div>
        <div><span>Network ID</span><strong>${esc(r.network_id||"-")}</strong></div>
        <div><span>Email Owner</span><strong>${esc(r.owner_email||"-")}</strong></div>
        <div><span>Nama Owner</span><strong>${esc(r.owner_name||"-")}</strong></div>
        <div><span>Order terakhir</span><strong>${esc(r.last_paid_order_id||"-")}</strong></div>
        <div><span>Pembayaran terakhir</span><strong>${date(r.last_paid_at)}</strong></div>
      </div>
      ${recovery?`<div class="owner-vault-recovery">${esc(recovery)}</div>`:""}
      <div class="owner-vault-secret-actions">
        ${key?`<button class="btn ghost" type="button" data-vault-copy-key="${esc(r.license_id)}">Salin License Key</button>`:""}
        <button class="btn ghost" type="button" data-vault-copy-all="${esc(r.license_id)}">Salin Data</button>
        <button class="btn danger-soft" type="button" data-vault-hide="${esc(r.license_id)}">Sembunyikan</button>
      </div>
      <p class="owner-vault-auto-hide">Data sensitif otomatis disembunyikan lagi setelah 90 detik.</p>
    `;
  }

  function summaryLabel(x){
    if(x.legacy_lifetime)return "Lifetime Legacy · Tetap Aktif";
    if(!x.expires_at)return "Tanpa tanggal kedaluwarsa";
    return date(x.expires_at);
  }

  function cardMarkup(item){
    const id=String(item.license_id);
    const full=revealed.get(id);
    return `
      <article class="owner-vault-card" data-vault-license="${esc(id)}">
        <div class="owner-vault-card-head">
          <div>
            <span class="owner-vault-badge">${item.legacy_lifetime?"LEGACY LIFETIME":"LISENSI OWNER"}</span>
            <h3>${esc(item.plan_name||item.plan_code||"Lisensi")}</h3>
            <p>${esc(item.store_name||"Toko")} · ${esc(item.store_code_masked||"••••")}</p>
          </div>
          <span class="owner-vault-state ${String(item.status||"").toLowerCase()==="active"?"active":""}">${esc(item.status||"-")}</span>
        </div>
        <div class="owner-vault-summary">
          <div><span>Masa berlaku</span><strong>${esc(summaryLabel(item))}</strong></div>
          <div><span>Kuota</span><strong>${esc(item.max_devices??"-")} perangkat · ${esc(item.max_stores??"-")} toko</strong></div>
          <div><span>License Key</span><strong>${esc(item.key_masked||"••••••••")}</strong></div>
          <div><span>Status penjualan paket</span><strong>${item.plan_sales_active===false?"Tidak dijual baru · lisensi lama tetap berlaku":"Aktif"}</strong></div>
        </div>
        <div class="owner-vault-warning">
          <strong>🔐 Data penting</strong>
          <span>License Key, Store Code, Store UUID, dan Network ID jangan dibagikan kepada orang lain. Reveal hanya saat diperlukan.</span>
        </div>
        <div class="owner-vault-actions">
          <button class="btn primary" type="button" data-vault-reveal="${esc(id)}">${full?"Refresh Data":"Reveal data penting"}</button>
          ${item.legacy_lifetime&&!item.has_recoverable_key?`<span class="owner-vault-legacy-note">Key Lifetime lama belum ada di vault. Aktivasi sekali dengan key lama akan mendaftarkannya secara terenkripsi.</span>`:""}
        </div>
        <div class="owner-vault-sensitive" ${full?"":"hidden"}>
          ${full?sensitiveRows(full):""}
        </div>
      </article>
    `;
  }

  function renderList(data){
    const box=$("ownerVaultList");
    const empty=$("ownerVaultEmpty");
    if(!box)return;

    const rows=Array.isArray(data?.licenses)?data.licenses:[];
    box.innerHTML="";
    if(empty)empty.hidden=rows.length>0;

    rows.forEach(item=>{
      const wrap=document.createElement("div");
      wrap.innerHTML=cardMarkup(item);
      const card=wrap.firstElementChild;
      card.__ldmSummary=item;
      box.appendChild(card);
    });

    bindCardActions();
  }

  function copyText(text){
    if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(text);
    const ta=document.createElement("textarea");
    ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
    document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    return Promise.resolve();
  }

  function revealText(r){
    return [
      "LocDailyMar — DATA LISENSI OWNER",
      `Paket: ${r.plan_name||r.plan_code||"-"}`,
      `Status: ${r.status||"-"}`,
      `License Key: ${r.license_key||"Tidak tersedia"}`,
      `Store Code: ${r.store_code||"-"}`,
      `Store UUID: ${r.store_id||"-"}`,
      `Network ID: ${r.network_id||"-"}`,
      `Email Owner: ${r.owner_email||"-"}`,
      `Masa berlaku: ${date(r.expires_at)}`,
      `Order terakhir: ${r.last_paid_order_id||"-"}`
    ].join("\n");
  }

  async function revealLicense(id,btn){
    setBusy(btn,true,"Memverifikasi…");
    const st=$("ownerVaultStatus");
    try{
      const result=await call("owner_vault_reveal",{license_id:id});
      const record=result?.license||{};
      record.recovery_note=result?.recovery_note||null;
      revealed.set(String(id),record);
      scheduleHide(id);

      const card=document.querySelector(`[data-vault-license="${CSS.escape(String(id))}"]`);
      if(card){
        const summary=card.__ldmSummary;
        const wrap=document.createElement("div");
        wrap.innerHTML=cardMarkup(summary);
        const next=wrap.firstElementChild;
        next.__ldmSummary=summary;
        card.replaceWith(next);
      }
      bindCardActions();

      status(st,record.license_key
        ?"Data penting berhasil direveal. Jangan bagikan atau unggah screenshot data ini."
        :"Data lisensi ditemukan, tetapi License Key lama belum dapat dipulihkan dari server.",
        record.license_key?"ok":"warn"
      );
    }catch(e){
      status(st,`${e.code||"GAGAL"} — ${e.message||e}`,"err");
    }finally{
      setBusy(btn,false);
    }
  }

  function bindCardActions(){
    document.querySelectorAll("[data-vault-reveal]").forEach(btn=>{
      if(btn.dataset.bound==="1")return;
      btn.dataset.bound="1";
      btn.addEventListener("click",()=>revealLicense(btn.dataset.vaultReveal,btn));
    });

    document.querySelectorAll("[data-vault-hide]").forEach(btn=>{
      if(btn.dataset.bound==="1")return;
      btn.dataset.bound="1";
      btn.addEventListener("click",()=>{
        const id=btn.dataset.vaultHide;
        const card=document.querySelector(`[data-vault-license="${CSS.escape(String(id))}"]`);
        const summary=card?.__ldmSummary;
        clearSensitive(id);
        if(card&&summary){
          const wrap=document.createElement("div");
          wrap.innerHTML=cardMarkup(summary);
          const next=wrap.firstElementChild;
          next.__ldmSummary=summary;
          card.replaceWith(next);
          bindCardActions();
        }
      });
    });

    document.querySelectorAll("[data-vault-copy-key]").forEach(btn=>{
      if(btn.dataset.bound==="1")return;
      btn.dataset.bound="1";
      btn.addEventListener("click",async()=>{
        const r=revealed.get(String(btn.dataset.vaultCopyKey));
        if(r?.license_key)await copyText(r.license_key);
      });
    });

    document.querySelectorAll("[data-vault-copy-all]").forEach(btn=>{
      if(btn.dataset.bound==="1")return;
      btn.dataset.bound="1";
      btn.addEventListener("click",async()=>{
        const r=revealed.get(String(btn.dataset.vaultCopyAll));
        if(r)await copyText(revealText(r));
      });
    });
  }

  async function loadVault(){
    const btn=$("ownerVaultLoadBtn");
    const st=$("ownerVaultStatus");
    setBusy(btn,true,"Memuat…");
    try{
      const result=await call("owner_vault_list");
      const owner=result?.owner||{};
      const auth=$("ownerVaultAuthState");
      if(auth){
        auth.innerHTML=`Login sebagai <strong>${esc(owner.email||"-")}</strong>${owner.is_primary_owner?" · <b>Owner Pusat</b>":" · Owner"}`;
      }
      $("ownerVaultLoginBox")?.setAttribute("hidden","");
      $("ownerVaultDataBox")?.removeAttribute("hidden");
      renderList(result);
      status(st,result?.licenses?.length
        ?`${result.licenses.length} lisensi ditemukan. Data sensitif masih disembunyikan.`
        :"Belum ada lisensi yang terhubung ke akun Owner ini.",
        result?.licenses?.length?"ok":"warn"
      );
    }catch(e){
      $("ownerVaultLoginBox")?.removeAttribute("hidden");
      $("ownerVaultDataBox")?.setAttribute("hidden","");
      status(st,`${e.code||"GAGAL"} — ${e.message||e}`,"err");
    }finally{
      setBusy(btn,false);
    }
  }

  async function login(){
    const email=String($("ownerVaultEmail")?.value||"").trim().toLowerCase();
    const password=String($("ownerVaultPassword")?.value||"");
    const btn=$("ownerVaultLoginBtn");
    const st=$("ownerVaultStatus");
    if(!email||!password){
      status(st,"Email dan Password Owner wajib diisi.","err");
      return;
    }
    setBusy(btn,true,"Masuk…");
    try{
      const c=client();
      const {error}=await c.auth.signInWithPassword({email,password});
      if(error)throw error;
      if($("ownerVaultPassword"))$("ownerVaultPassword").value="";
      await loadVault();
    }catch(e){
      status(st,`Login Owner gagal — ${e.message||e}`,"err");
    }finally{
      setBusy(btn,false);
    }
  }

  async function logout(){
    try{
      await client().auth.signOut();
    }catch(_){}
    revealed.clear();
    hideTimers.forEach(t=>clearTimeout(t));
    hideTimers.clear();
    $("ownerVaultDataBox")?.setAttribute("hidden","");
    $("ownerVaultLoginBox")?.removeAttribute("hidden");
    if($("ownerVaultAuthState"))$("ownerVaultAuthState").textContent="Belum login";
    if($("ownerVaultList"))$("ownerVaultList").innerHTML="";
    status($("ownerVaultStatus"),"Sesi Owner sudah keluar dari perangkat ini.","info");
  }

  async function init(){
    if(!$("ownerLicenseVault"))return;
    initPasswordToggles();

    $("ownerVaultLoginBtn")?.addEventListener("click",login);
    $("ownerVaultLoadBtn")?.addEventListener("click",loadVault);
    $("ownerVaultLogoutBtn")?.addEventListener("click",logout);
    $("ownerVaultPassword")?.addEventListener("keydown",e=>{
      if(e.key==="Enter"){e.preventDefault();login();}
    });

    try{
      const s=await session();
      if(s?.access_token){
        await loadVault();
      }else{
        $("ownerVaultLoginBox")?.removeAttribute("hidden");
      }
    }catch(_){
      $("ownerVaultLoginBox")?.removeAttribute("hidden");
    }
  }

  window.LDMOwnerLicenseVault=Object.freeze({init,loadVault,initPasswordToggles});
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",init,{once:true});
  }else{
    init();
  }
})();

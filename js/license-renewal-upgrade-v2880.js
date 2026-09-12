(function(){
  "use strict";
  const SUPPORTED=["WARUNG_KECIL","WARUNG_SEDERHANA","TOKO"];
  const RANK={WARUNG_KECIL:10,WARUNG_SEDERHANA:20,TOKO:30};
  const $=id=>document.getElementById(id);
  const cfg=()=>window.LDM_LICENSE_V2_CONFIG||{};
  const plan=code=>cfg().plans?.[code]||{name:code};
  const money=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0));
  const date=v=>v?new Date(v).toLocaleString("id-ID",{dateStyle:"long",timeStyle:"short"}):"Tanpa batas";
  let latestContext=null;

  function daysLeft(v){
    if(!v)return null;
    return Math.ceil((new Date(v).getTime()-Date.now())/86400000);
  }
  function style(){
    if(document.getElementById("ldmPackageManagementStyleV2880"))return;
    const s=document.createElement("style");s.id="ldmPackageManagementStyleV2880";
    s.textContent=`
      .package-manage-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}
      .package-manage-card{border:1px solid #dce5f0;background:#f8fbff;border-radius:16px;padding:16px}
      .package-manage-card h3{font-size:15px;margin:0 0 5px}.package-manage-card p{font-size:11px;line-height:1.65;margin:0;color:#64748b}
      .package-manage-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:13px}
      .package-manage-stat{background:#fff;border:1px solid #e6edf5;border-radius:11px;padding:10px}.package-manage-stat span{font-size:10px;color:#64748b;display:block}.package-manage-stat strong{font-size:12px;display:block;margin-top:3px;word-break:break-word}
      .package-manage-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.package-manage-actions .btn{flex:1;min-width:150px}
      .package-manage-alert{margin-top:12px;border-radius:12px;padding:11px 12px;font-size:11px;line-height:1.6;background:#edf7ff;border:1px solid #bfdcf7;color:#24577f}.package-manage-alert.warn{background:#fff7df;border-color:#f3d27b;color:#775700}.package-manage-alert.ok{background:#ecfaf4;border-color:#b8e8d0;color:#0b684e}
      .upgrade-options{display:grid;gap:8px;margin-top:12px}.upgrade-option{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid #e2eaf3;border-radius:12px;padding:11px}.upgrade-option strong{font-size:12px}.upgrade-option span{font-size:10px;color:#64748b;display:block;margin-top:2px}.upgrade-option .btn{white-space:nowrap}
      .package-manage-empty{padding:12px;border-radius:12px;background:#f5f8fb;color:#64748b;font-size:12px}
      @media(max-width:720px){.package-manage-grid{grid-template-columns:1fr}.package-manage-stats{grid-template-columns:1fr}.package-manage-actions .btn{width:100%}.upgrade-option{align-items:flex-start;flex-direction:column}.upgrade-option .btn{width:100%}}
    `;
    document.head.appendChild(s);
  }
  function ensureSection(){
    let section=$("packageManagement");
    if(section)return section;
    const current=$("current");
    if(!current)return null;
    section=document.createElement("section");
    section.className="section";section.id="packageManagement";
    section.innerHTML=`<div class="section-head"><div><h2>Kelola Paket</h2><p>Perpanjang masa aktif atau naikkan paket tanpa membuat toko baru.</p></div></div><div id="packageManagementBody" class="package-manage-empty">Memuat status paket…</div>`;
    current.closest("section")?.insertAdjacentElement("afterend",section);
    return section;
  }
  function openCheckout(mode,targetPlan,cycle="yearly"){
    if(!latestContext){alert("Status paket belum siap. Tekan Periksa ulang lalu coba lagi.");return;}
    const current=String(latestContext.plan_code||"").toUpperCase();
    const target=String(targetPlan||current).toUpperCase();
    if(mode==="renewal"&&target!==current){alert("Perpanjangan harus memakai paket yang sedang aktif.");return;}
    if(mode==="upgrade"&&!(RANK[target]>RANK[current])){alert("Paket tujuan harus lebih tinggi daripada paket saat ini.");return;}
    if(!window.LDMCheckoutV2){alert("Modul pembayaran belum siap. Muat ulang halaman.");return;}
    window.LDMCheckoutV2.open({
      planCode:target,
      planName:plan(target).name||target,
      billingCycle:cycle,
      mode,
      management:latestContext
    });
  }
  function routePlanSelection(targetPlan,cycle){
    const run=()=>{
      const current=String((latestContext?.plan_code||window.LDMLicenseV2?.activationContext?.()?.plan_code||"")).toUpperCase();
      const target=String(targetPlan||"").toUpperCase();
      if(!SUPPORTED.includes(current)){alert("Periksa status lisensi terlebih dahulu.");return;}
      if(target===current)return startRenewal(cycle);
      if(RANK[target]>RANK[current])return startUpgrade(target,cycle);
      alert("Downgrade paket tidak dilakukan melalui checkout otomatis. Gunakan paket yang sama untuk perpanjangan atau pilih paket yang lebih tinggi.");
    };
    if(!latestContext){refresh(true).then(run).catch(()=>run());return;}
    return run();
  }
  function startRenewal(cycle="yearly"){openCheckout("renewal",latestContext?.plan_code||window.LDMLicenseV2?.activationContext?.()?.plan_code,cycle);}
  function startUpgrade(target,cycle="yearly"){openCheckout("upgrade",target,cycle);}

  function render(ctx){
    latestContext=ctx||null;
    const body=$("packageManagementBody");if(!body)return;
    if(!ctx){body.className="package-manage-empty";body.textContent="Paket belum dapat dikelola dari perangkat ini.";return;}
    const code=String(ctx.plan_code||"").toUpperCase();
    if(!SUPPORTED.includes(code)){body.className="package-manage-empty";body.textContent=code==="LIFETIME"?"Lisensi Lifetime lama tetap berlaku dan tidak memerlukan perpanjangan.":"Paket ini tidak tersedia untuk pengelolaan otomatis.";return;}
    const remaining=daysLeft(ctx.expires_at);
    const expired=remaining!==null&&remaining<=0;
    const warn=remaining!==null&&remaining<=30;
    const upgrades=SUPPORTED.filter(x=>RANK[x]>RANK[code]);
    const statusText=expired?"Masa aktif berakhir":remaining===null?"Aktif":remaining===1?"1 hari tersisa":`${remaining} hari tersisa`;
    const alertClass=expired||warn?"warn":"ok";
    const alertText=expired
      ?"Masa aktif sudah berakhir. Data toko tetap tersimpan. Perpanjang paket untuk melanjutkan penggunaan."
      :remaining!==null&&remaining<=3?`Masa aktif tinggal ${Math.max(0,remaining)} hari. Segera perpanjang agar operasional tidak tertunda.`
      :remaining!==null&&remaining<=7?`Masa aktif akan berakhir dalam ${remaining} hari. Perpanjangan sekarang tetap mempertahankan sisa hari yang masih ada.`
      :remaining!==null&&remaining<=14?`Masa aktif akan berakhir dalam ${remaining} hari. Kamu sudah dapat memperpanjang tanpa kehilangan sisa periode.`
      :warn?`Masa aktif akan berakhir dalam ${remaining} hari. Perpanjangan sekarang tidak menghilangkan sisa periode yang masih ada.`
      :"Perpanjangan menambahkan periode baru setelah masa aktif saat ini. Upgrade mengaktifkan paket lebih tinggi segera tanpa mengganti toko atau akun Owner.";
    body.className="package-manage-grid";
    body.innerHTML=`
      <div class="package-manage-card">
        <h3>${plan(code).name||ctx.plan_name||code}</h3>
        <p>Paket pada perangkat dan toko ini. Store Code, akun Owner, serta data operasional tetap dipertahankan saat perpanjangan maupun upgrade.</p>
        <div class="package-manage-stats">
          <div class="package-manage-stat"><span>Status</span><strong>${expired?"Ditangguhkan sementara":"Aktif"}</strong></div>
          <div class="package-manage-stat"><span>Masa berlaku</span><strong>${date(ctx.expires_at)}</strong></div>
          <div class="package-manage-stat"><span>Sisa waktu</span><strong>${statusText}</strong></div>
        </div>
        <div class="package-manage-alert ${alertClass}">${alertText}</div>
        <div class="package-manage-actions">
          <button type="button" class="btn primary" id="renewPackageBtn">Perpanjang Masa Aktif</button>
          <button type="button" class="btn ghost" id="refreshPackageBtn">Periksa Ulang</button>
        </div>
      </div>
      <div class="package-manage-card">
        <h3>Upgrade Paket</h3>
        <p>Upgrade berlaku segera setelah pembayaran terverifikasi. Sisa masa aktif lama tetap dipertahankan lalu periode paket baru ditambahkan.</p>
        <div class="upgrade-options" id="upgradeOptions">
          ${upgrades.length?upgrades.map(target=>`<div class="upgrade-option"><div><strong>${plan(target).name||target}</strong><span>Mulai ${money(plan(target).monthly)}/bulan · toko dan data tetap sama</span></div><button type="button" class="btn ghost" data-upgrade-plan="${target}">Upgrade</button></div>`).join(""):'<div class="package-manage-empty">Kamu sudah menggunakan paket tertinggi. Gunakan Perpanjang Masa Aktif untuk menambah periode.</div>'}
        </div>
      </div>`;
    $("renewPackageBtn")?.addEventListener("click",()=>startRenewal("yearly"));
    $("refreshPackageBtn")?.addEventListener("click",()=>refresh(true));
    body.querySelectorAll("[data-upgrade-plan]").forEach(btn=>btn.addEventListener("click",()=>startUpgrade(btn.dataset.upgradePlan,"yearly")));
  }
  async function refresh(force=false){
    ensureSection();
    const body=$("packageManagementBody");
    const local=window.LDMLicenseV2?.activationContext?.()||{};
    if(!local.license_id||local.is_trial){
      if(body){body.className="package-manage-empty";body.textContent=local.is_trial?"Trial dapat dilanjutkan ke paket berbayar melalui pilihan paket di atas.":"Aktifkan lisensi pada perangkat ini untuk menggunakan Perpanjang dan Upgrade Paket.";}
      latestContext=null;return;
    }
    const code=String(local.plan_code||"").toUpperCase();
    if(code==="LIFETIME"){render({...local,plan_code:"LIFETIME"});return;}
    if(!SUPPORTED.includes(code)){render(null);return;}
    if(body&&force){body.className="package-manage-empty";body.textContent="Memeriksa paket terbaru…";}
    try{
      const ctx=await window.LDMLicenseV2.packageManagementContext();
      render(ctx);
    }catch(error){
      console.warn("Kelola paket:",error);
      if(body){body.className="package-manage-empty";body.textContent=error?.message||"Status paket belum dapat dimuat. Coba Periksa Ulang.";}
    }
  }
  function init(){style();ensureSection();refresh(false);}
  window.LDMLicenseManagementV2880=Object.freeze({refresh,startRenewal,startUpgrade,routePlanSelection});
  window.addEventListener("ldm-license-v2-ready",()=>setTimeout(()=>refresh(false),50));
  window.addEventListener("ldm-paid-receipt-ready",()=>setTimeout(async()=>{try{await window.LDMLicenseV2?.check?.({force:true});}catch(_){}refresh(true);},400));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

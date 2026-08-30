(function(){
    "use strict";
    const PAGE_FEATURE={
        "dashboard.html":"dashboard","kasir.html":"pos","barang.html":"inventory","kartu-stok.html":"stock_card","stock-opname.html":"stock_opname",
        "laporan.html":"reports","absensi.html":"attendance","retur.html":"returns","shift-closing.html":"shift_closing","backup & restore.html":"backup_restore",
        "pengeluaran.html":"expenses","supplier.html":"suppliers","purchase-order.html":"purchase_order","goods.receipt.html":"goods_receipt",
        "account-management.html":"cloud_accounts","account-password-reset.html":"cloud_accounts","device-management.html":"cloud_devices","device-access.html":"cloud_devices",
        "recovery-center.html":"recovery_center","pwa-settings.html":"app_update","multi-store.html":"multi_store","cloud-control-center.html":"cloud_control",
        "eod.html":"eod","qa-security-performance.html":"qa_security","pages-health-check.html":"qa_security"
    };
    const LABEL={dashboard:"Dashboard",pos:"Kasir",inventory:"Barang",stock_card:"Kartu Stok",stock_opname:"Stock Opname",reports:"Laporan",attendance:"Absensi",returns:"Retur",shift_closing:"Closing Shift",backup_restore:"Backup & Restore",expenses:"Pengeluaran",suppliers:"Supplier",purchase_order:"Purchase Order",goods_receipt:"Goods Receipt",cloud_accounts:"Akun Cloud",cloud_devices:"Perangkat Cloud",recovery_center:"Recovery Center",app_update:"Aplikasi & Update",multi_store:"Multi-Toko",cloud_control:"Cloud Control",eod:"End of Day",qa_security:"QA & Security"};
    function page(){let p=decodeURIComponent(location.pathname.split("/").pop()||"index.html").toLowerCase();return p}
    function feature(){if(page()==="index.html")return "";if(PAGE_FEATURE[page()])return PAGE_FEATURE[page()];if(page().startsWith("supabase-"))return "qa_security";return ""}
    function css(){if(document.getElementById("ldmLicenseGuardStyle"))return;const s=document.createElement("style");s.id="ldmLicenseGuardStyle";s.textContent=`.ldm2-guard{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(7,20,39,.94);font-family:Poppins,system-ui,sans-serif;color:#10213d}.ldm2-guard-card{width:min(540px,100%);background:#fff;border-radius:22px;padding:26px;box-shadow:0 28px 90px rgba(0,0,0,.34);text-align:center}.ldm2-guard-mark{width:58px;height:58px;margin:auto;display:grid;place-items:center;border-radius:18px;background:#e8f1ff;font-size:28px}.ldm2-guard h2{margin:15px 0 7px;font-size:22px}.ldm2-guard p{margin:0;color:#637087;line-height:1.6}.ldm2-guard-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px}.ldm2-guard button,.ldm2-guard a{border:0;border-radius:11px;padding:11px 16px;font-weight:700;text-decoration:none;cursor:pointer}.ldm2-primary{background:#135cc5;color:#fff}.ldm2-secondary{background:#edf2f8;color:#183252}.ldm2-spinner{width:28px;height:28px;border:3px solid #cfdef2;border-top-color:#135cc5;border-radius:50%;animation:ldm2spin .8s linear infinite;margin:17px auto}@keyframes ldm2spin{to{transform:rotate(360deg)}}`;document.head.appendChild(s)}
    function overlay(title,message,mode="loading"){css();let el=document.getElementById("ldmLicenseGuard");if(!el){el=document.createElement("div");el.id="ldmLicenseGuard";el.className="ldm2-guard";document.body.appendChild(el)}el.innerHTML=`<div class="ldm2-guard-card" role="dialog" aria-live="polite"><div class="ldm2-guard-mark">${mode==="loading"?"🔐":mode==="locked"?"🔒":"⚠️"}</div><h2>${title}</h2><p>${message}</p>${mode==="loading"?'<div class="ldm2-spinner"></div>':`<div class="ldm2-guard-actions"><button class="ldm2-primary" id="ldm2Retry">Coba Lagi</button><a class="ldm2-secondary" href="license.html">Lisensi & Paket</a></div>`}</div>`;el.querySelector("#ldm2Retry")?.addEventListener("click",()=>run(true));return el}
    function remove(){document.getElementById("ldmLicenseGuard")?.remove()}
    function filterNav(data){document.querySelectorAll("[data-ldm-route],a[href]").forEach(link=>{let target;try{target=decodeURIComponent(new URL(link.getAttribute("href"),location.href).pathname.split("/").pop()||"").toLowerCase()}catch(error){return}const need=PAGE_FEATURE[target];if(need&&!window.LDMLicenseV2.hasFeature(need,data)){link.hidden=true;link.setAttribute("data-license-locked","true")}})}
    async function run(force=false){
        overlay("Memeriksa lisensi aplikasi","Pemeriksaan dibatasi waktu agar halaman tidak mengalami loading tanpa akhir.");
        try{
            const data=await window.LDMLicenseV2.check({force});
            const needed=feature();
            if(!window.LDMLicenseV2.hasFeature(needed,data)){
                overlay("Fitur belum termasuk paket",`${LABEL[needed]||"Halaman ini"} dikunci pada paket ${data.plan_name||data.plan_code||"yang aktif"}. Hubungi developer untuk upgrade.`,"locked");return false;
            }
            document.documentElement.dataset.ldmLicensePlan=data.plan_code||"";
            window.LDM_LICENSE_V2_STATE=data;
            remove();filterNav(data);
            window.dispatchEvent(new CustomEvent("ldm-license-v2-authorized",{detail:data}));
            return true;
        }catch(error){
            const activation=["ACTIVATION_REQUIRED","ACTIVATION_INVALID","LICENSE_KEY_INVALID","LICENSE_CONFIG_REQUIRED"].includes(error.code);
            overlay(activation?"Lisensi perlu diaktifkan":"Lisensi belum dapat diverifikasi",error.message||"Pemeriksaan lisensi gagal.","error");return false;
        }
    }
    function boot(){if(!window.LDMLicenseV2){overlay("Komponen lisensi tidak tersedia","Pastikan license-v2-client.js dimuat sebelum guard.","error");return}run(false)}
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
    window.addEventListener("ldm-global-navigation-rendered",()=>{if(window.LDM_LICENSE_V2_STATE)filterNav(window.LDM_LICENSE_V2_STATE)});
    window.LDMLicenseV2Guard={run,featureForPage:feature,filterNav};
})();

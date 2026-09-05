(function(){
    "use strict";

    let mounted=false;
    let refreshTimer=null;

    function role(){
        return String(localStorage.getItem("userRole")||localStorage.getItem("role")||"").trim().toLowerCase();
    }

    function ensureStyle(){
        if(document.getElementById("ldmOnboardingDashboardStyle"))return;
        const style=document.createElement("style");
        style.id="ldmOnboardingDashboardStyle";
        style.textContent=`
        .ldm-onboarding-card{display:flex;align-items:center;gap:14px;margin:10px 0 14px;padding:14px 16px;border:1px solid #cfe2d8;border-radius:14px;background:linear-gradient(135deg,#f7fcf9,#eef8f2);box-shadow:0 4px 14px rgba(15,157,88,.05)}
        .ldm-onboarding-icon{width:42px;height:42px;border-radius:13px;background:#0F9D58;color:#fff;display:grid;place-items:center;font-size:20px;flex:none}
        .ldm-onboarding-copy{min-width:0;flex:1}.ldm-onboarding-copy strong{display:block;color:#173449;font-size:.84rem}.ldm-onboarding-copy span{display:block;color:#667085;font-size:.68rem;margin-top:3px;line-height:1.4}
        .ldm-onboarding-progress{height:6px;background:#dfeae4;border-radius:999px;overflow:hidden;margin-top:7px;max-width:440px}.ldm-onboarding-progress>i{display:block;height:100%;background:#0F9D58;border-radius:999px}
        .ldm-onboarding-action{border:0;border-radius:10px;background:#0F9D58;color:white;text-decoration:none;font-weight:800;font-size:.7rem;padding:9px 11px;white-space:nowrap}
        @media(max-width:650px){.ldm-onboarding-card{align-items:flex-start;flex-wrap:wrap}.ldm-onboarding-action{margin-left:56px}.ldm-onboarding-progress{max-width:none}}
        `;
        document.head.appendChild(style);
    }

    function nextLabel(state){
        const order=[
            ["profile","Konfirmasi profil toko"],
            ["mode","Pilih mode operasional"],
            ["product","Tambahkan barang/menu pertama"],
            ["team","Siapkan akun tim"],
            ["device","Periksa perangkat dasar"],
            ["sale","Lakukan transaksi pertama"]
        ];
        for(const [key,label] of order){
            if(!state?.steps?.[key]?.ready)return label;
        }
        return "Selesaikan Setup Awal";
    }

    function remove(){
        document.getElementById("ldmOnboardingDashboardCard")?.remove();
        mounted=false;
    }

    function render(state){
        if(role()!=="owner" || !state || state.completed){remove();return}
        ensureStyle();
        let card=document.getElementById("ldmOnboardingDashboardCard");
        if(!card){
            card=document.createElement("section");
            card.id="ldmOnboardingDashboardCard";
            card.className="ldm-onboarding-card";
            card.setAttribute("aria-label","Progress Setup Awal");
            const mode=document.getElementById("ldmModeControl");
            if(mode)mode.insertAdjacentElement("afterend",card);
            else document.querySelector(".main-content")?.insertAdjacentElement("afterbegin",card);
        }
        const percent=Math.max(0,Math.min(100,Number(state.progress_percent||0)));
        card.innerHTML=`<div class="ldm-onboarding-icon">🚀</div><div class="ldm-onboarding-copy"><strong>Setup Awal belum selesai · ${percent}%</strong><span>Berikutnya: ${nextLabel(state)}. Progress tersimpan per toko dan dapat dilanjutkan kapan saja.</span><div class="ldm-onboarding-progress"><i style="width:${percent}%"></i></div></div><a class="ldm-onboarding-action" href="setup-awal.html">Lanjutkan Setup</a>`;
        mounted=true;
    }

    async function refresh(){
        if(role()!=="owner" || !window.LDMOnboarding){remove();return}
        try{
            const state=await window.LDMOnboarding.status();
            render(state);
        }catch(error){
            // Jangan mengganggu dashboard jika SQL-37 belum dipasang.
            remove();
            if(!/function|schema cache|does not exist|Setup Awal/i.test(String(error?.message||""))){
                console.warn("Progress Setup Awal belum dapat dibaca:",error);
            }
        }
    }

    function schedule(){
        clearTimeout(refreshTimer);
        refreshTimer=setTimeout(refresh,200);
    }

    function init(){
        schedule();
        window.addEventListener("ldm-cloud-session-ready",schedule);
        window.addEventListener("ldm-onboarding-updated",event=>render(event.detail));
        window.addEventListener("ldm-onboarding-completed",()=>remove());
        window.addEventListener("storage",event=>{if(event.key==="userRole"||event.key==="role")schedule()});
        window.addEventListener("focus",()=>{if(mounted)schedule()});
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
    else init();
})();

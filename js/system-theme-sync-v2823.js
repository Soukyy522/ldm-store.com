(function(){
    "use strict";

    const KEY="headerConfig";
    const DEFAULTS={
        warnaBgHeader:"#0d2240",
        warnaSubJudul:"#ffc107",
        warnaJudul:"#ffffff",
        warnaOutline:"#d99b00",
        fontFamily:"'Poppins', sans-serif",
        brandFontFamily:"'Poppins', sans-serif",
        bgPrimary:"#f4f6f9",
        bgSecondary:"#ffffff",
        darkMode:false
    };

    function read(){
        try{
            return {...DEFAULTS,...(JSON.parse(localStorage.getItem(KEY)||"null")||{})};
        }catch(error){
            return {...DEFAULTS};
        }
    }

    function apply(config=read()){
        const root=document.documentElement;
        const body=document.body;
        if(!body)return;

        const dark=Boolean(config.darkMode);
        const headerBase=config.warnaBgHeader||DEFAULTS.warnaBgHeader;
        const headerColor=dark && headerBase===DEFAULTS.warnaBgHeader ? "#1e293b" : headerBase;
        const bgPrimary=dark && (!config.bgPrimary || config.bgPrimary===DEFAULTS.bgPrimary)
            ? "#0f172a"
            : (config.bgPrimary||DEFAULTS.bgPrimary);
        const bgSecondary=dark && (!config.bgSecondary || config.bgSecondary===DEFAULTS.bgSecondary)
            ? "#1e293b"
            : (config.bgSecondary||DEFAULTS.bgSecondary);

        const values={
            "--app-font":config.fontFamily||DEFAULTS.fontFamily,
            "--brand-font":config.brandFontFamily||config.fontFamily||DEFAULTS.brandFontFamily,
            "--bg-primary":bgPrimary,
            "--bg-secondary":bgSecondary,
            "--text-color":dark?"#e2e8f0":"#334155",
            "--heading-color":dark?"#f8fafc":"#0d2240",
            "--muted-color":dark?"#94a3b8":"#64748b",
            "--border-color":dark?"#334155":"#e2e8f0",
            "--input-bg":dark?bgPrimary:bgSecondary,
            "--nav-desktop-bg":headerColor,
            "--accent-color":config.warnaSubJudul||DEFAULTS.warnaSubJudul,

            /* Alias CSS lama per halaman. */
            "--bg":bgPrimary,
            "--card":bgSecondary,
            "--text":dark?"#e2e8f0":"#334155",
            "--muted":dark?"#94a3b8":"#64748b",
            "--line":dark?"#334155":"#e2e8f0",
            "--border":dark?"#334155":"#e2e8f0",
            "--surface":bgSecondary,
            "--input":dark?bgPrimary:bgSecondary
        };

        Object.entries(values).forEach(([name,value])=>root.style.setProperty(name,value));

        body.classList.add("ldm-system-page");
        body.classList.toggle("dark-mode",dark);
        body.dataset.ldmThemeSource="dashboard-headerConfig";

        document.querySelectorAll("[data-ldm-brand-title]").forEach(node=>{
            if(config.judul)node.textContent=config.judul;
        });
        document.querySelectorAll("[data-ldm-brand-subtitle]").forEach(node=>{
            if(config.subJudul)node.textContent=config.subJudul;
            node.style.color=config.warnaSubJudul||DEFAULTS.warnaSubJudul;
        });

        const meta=document.querySelector('meta[name="theme-color"]');
        if(meta)meta.setAttribute("content",headerColor);

        window.dispatchEvent(new CustomEvent("ldm-system-theme-applied",{
            detail:{darkMode:dark,headerColor,bgPrimary,bgSecondary}
        }));
    }

    function boot(){
        apply();
        window.addEventListener("storage",event=>{
            if(event.key===KEY)apply();
        });
        window.addEventListener("ldm-theme-changed",()=>apply());
        try{
            const channel=new BroadcastChannel("ldm-shared-theme");
            channel.addEventListener("message",()=>apply());
        }catch(error){}
    }

    if(document.readyState==="loading"){
        document.addEventListener("DOMContentLoaded",boot,{once:true});
    }else{
        boot();
    }

    window.LDMSystemThemeSync={read,apply};
})();

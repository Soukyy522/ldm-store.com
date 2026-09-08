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

    function clamp(value,min=0,max=255){
        return Math.min(max,Math.max(min,value));
    }

    function parseHex(value){
        let raw=String(value||"").trim().replace(/^#/,"");
        if(/^[0-9a-f]{3}$/i.test(raw)){
            raw=raw.split("").map(char=>char+char).join("");
        }
        if(!/^[0-9a-f]{6}$/i.test(raw))return null;
        return {
            r:parseInt(raw.slice(0,2),16),
            g:parseInt(raw.slice(2,4),16),
            b:parseInt(raw.slice(4,6),16)
        };
    }

    function parseRgbString(value){
        const match=String(value||"").match(
            /rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/
        );
        if(!match)return null;
        return {
            r:clamp(Number(match[1])),
            g:clamp(Number(match[2])),
            b:clamp(Number(match[3]))
        };
    }

    function resolveRgb(value){
        const direct=parseHex(value)||parseRgbString(value);
        if(direct)return direct;

        /*
         * Fallback browser parser agar nilai CSS seperti hsl() atau nama warna
         * tetap dapat digunakan bila suatu saat Dashboard menyimpannya.
         */
        try{
            const probe=document.createElement("span");
            probe.style.position="fixed";
            probe.style.left="-9999px";
            probe.style.visibility="hidden";
            probe.style.color="";
            probe.style.color=String(value||"");
            if(!probe.style.color)return null;
            document.body.appendChild(probe);
            const computed=getComputedStyle(probe).color;
            probe.remove();
            return parseRgbString(computed);
        }catch(error){
            return null;
        }
    }

    function srgbChannel(channel){
        const c=channel/255;
        return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
    }

    function luminance(rgb){
        if(!rgb)return null;
        return (
            0.2126*srgbChannel(rgb.r)
            +0.7152*srgbChannel(rgb.g)
            +0.0722*srgbChannel(rgb.b)
        );
    }

    function contrastRatio(a,b){
        const la=luminance(a);
        const lb=luminance(b);
        if(la===null||lb===null)return 1;
        const lighter=Math.max(la,lb);
        const darker=Math.min(la,lb);
        return (lighter+0.05)/(darker+0.05);
    }

    function bestText(background){
        const bg=resolveRgb(background);
        const light={r:255,g:255,b:255};
        const dark={r:15,g:23,b:42};

        if(!bg)return "#ffffff";

        return contrastRatio(bg,light)>=contrastRatio(bg,dark)
            ? "#ffffff"
            : "#0f172a";
    }

    function readablePreferred(background,preferred,fallback){
        const bg=resolveRgb(background);
        const fg=resolveRgb(preferred);
        if(bg&&fg&&contrastRatio(bg,fg)>=4.5)return preferred;
        return fallback||bestText(background);
    }

    function rgba(color,alpha){
        const rgb=resolveRgb(color);
        if(!rgb)return color;
        return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${alpha})`;
    }

    function readableAccent(background,accent,bannerText){
        const bg=resolveRgb(background);
        const fg=resolveRgb(accent);
        if(bg&&fg&&contrastRatio(bg,fg)>=3.2)return accent;
        return bannerText;
    }

    function apply(config=read()){
        const root=document.documentElement;
        const body=document.body;
        if(!body)return;

        const dark=Boolean(config.darkMode);
        const headerBase=config.warnaBgHeader||DEFAULTS.warnaBgHeader;
        const headerColor=dark && headerBase===DEFAULTS.warnaBgHeader
            ? "#1e293b"
            : headerBase;

        const bgPrimary=dark && (!config.bgPrimary || config.bgPrimary===DEFAULTS.bgPrimary)
            ? "#0f172a"
            : (config.bgPrimary||DEFAULTS.bgPrimary);

        const bgSecondary=dark && (!config.bgSecondary || config.bgSecondary===DEFAULTS.bgSecondary)
            ? "#1e293b"
            : (config.bgSecondary||DEFAULTS.bgSecondary);

        const inputBg=dark?bgPrimary:bgSecondary;
        const accent=config.warnaSubJudul||DEFAULTS.warnaSubJudul;

        /*
         * Dynamic readable colors:
         * - page text mengikuti Latar Utama
         * - card text mengikuti Latar Kartu
         * - input text mengikuti input background
         * - banner text mengikuti warna banner/header
         * - accent button text mengikuti warna accent
         */
        const pageText=bestText(bgPrimary);
        const cardText=bestText(bgSecondary);
        const inputText=bestText(inputBg);
        const bannerFallback=bestText(headerColor);
        const bannerText=readablePreferred(
            headerColor,
            config.warnaJudul||DEFAULTS.warnaJudul,
            bannerFallback
        );
        const bannerMuted=rgba(bannerText,0.78);
        const bannerSubtle=rgba(bannerText,0.12);
        const bannerBorder=rgba(bannerText,0.20);
        const bannerHover=rgba(bannerText,0.17);
        const bannerAccent=readableAccent(headerColor,accent,bannerText);
        const accentText=bestText(accent);

        const cardMuted=rgba(cardText,0.68);
        const pageMuted=rgba(pageText,0.70);
        const border=rgba(cardText,0.16);

        const values={
            "--app-font":config.fontFamily||DEFAULTS.fontFamily,
            "--brand-font":config.brandFontFamily||config.fontFamily||DEFAULTS.brandFontFamily,

            "--bg-primary":bgPrimary,
            "--bg-secondary":bgSecondary,
            "--input-bg":inputBg,
            "--nav-desktop-bg":headerColor,
            "--accent-color":accent,

            "--system-page-text":pageText,
            "--system-page-muted":pageMuted,
            "--system-card-text":cardText,
            "--system-card-muted":cardMuted,
            "--system-input-text":inputText,
            "--system-banner-text":bannerText,
            "--system-banner-muted":bannerMuted,
            "--system-banner-soft":bannerSubtle,
            "--system-banner-border":bannerBorder,
            "--system-banner-hover":bannerHover,
            "--system-banner-accent":bannerAccent,
            "--system-accent-text":accentText,

            /*
             * Compatibility aliases untuk CSS lama tiap halaman.
             * text-color/heading-color sengaja mengikuti card karena sebagian
             * besar konten lama berada di dalam surface/card.
             */
            "--text-color":cardText,
            "--heading-color":cardText,
            "--muted-color":cardMuted,
            "--border-color":border,

            "--bg":bgPrimary,
            "--card":bgSecondary,
            "--text":cardText,
            "--muted":cardMuted,
            "--line":border,
            "--border":border,
            "--surface":bgSecondary,
            "--input":inputBg
        };

        Object.entries(values).forEach(([name,value])=>{
            root.style.setProperty(name,value);
        });

        body.classList.add("ldm-system-page");
        body.classList.toggle("dark-mode",dark);
        body.dataset.ldmThemeSource="dashboard-headerConfig";
        body.dataset.ldmBannerTone=bannerText==="#ffffff"?"dark":"light";

        document.querySelectorAll("[data-ldm-brand-title]").forEach(node=>{
            if(config.judul)node.textContent=config.judul;
            node.style.color=bannerText;
            node.style.textShadow=config.warnaOutline
                ? `1px 1px 0 ${rgba(config.warnaOutline,0.55)}`
                : "";
        });

        document.querySelectorAll("[data-ldm-brand-subtitle]").forEach(node=>{
            if(config.subJudul)node.textContent=config.subJudul;
            node.style.color=bannerAccent;
        });

        const meta=document.querySelector('meta[name="theme-color"]');
        if(meta)meta.setAttribute("content",headerColor);

        window.dispatchEvent(new CustomEvent("ldm-system-theme-applied",{
            detail:{
                darkMode:dark,
                headerColor,
                bgPrimary,
                bgSecondary,
                pageText,
                cardText,
                bannerText,
                bannerTone:body.dataset.ldmBannerTone
            }
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

    window.LDMSystemThemeSync={
        read,
        apply,
        bestText,
        contrastRatio
    };
})();

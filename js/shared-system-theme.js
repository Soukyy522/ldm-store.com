(function(){
    "use strict";

    const KEY="headerConfig";
    const DEFAULTS={
        judul:"LocDailyMar",
        subJudul:"Sistem Operasional Toko",
        warnaJudul:"#ffffff",
        warnaOutline:"#d99b00",
        warnaSubJudul:"#ffc107",
        warnaBgHeader:"#0d2240",
        fontFamily:"'Poppins', sans-serif",
        brandFontFamily:"'Poppins', sans-serif",
        bgPrimary:"#f4f6f9",
        bgSecondary:"#ffffff",
        logoData:"",
        darkMode:false
    };
    const FONT_OPTIONS=[
        ["'Poppins', sans-serif","Poppins"],
        ["'Inter', sans-serif","Inter"],
        ["'Roboto', sans-serif","Roboto"],
        ["'Montserrat', sans-serif","Montserrat"],
        ["'Nunito', sans-serif","Nunito"],
        ["'Open Sans', sans-serif","Open Sans"]
    ];
    let pendingLogo="";
    let channel=null;

    function read(){
        try{return {...DEFAULTS,...(JSON.parse(localStorage.getItem(KEY)||"null")||{})}}
        catch(error){return {...DEFAULTS}}
    }

    function contrast(hex){
        const value=String(hex||"").replace("#","");
        if(!/^[0-9a-f]{6}$/i.test(value))return "#ffffff";
        const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
        return (r*299+g*587+b*114)/1000>160?"#0d2240":"#ffffff";
    }

    function apply(config=read()){
        const root=document.documentElement;
        const body=document.body;
        const dark=Boolean(config.darkMode);
        const navColor=dark&&config.warnaBgHeader===DEFAULTS.warnaBgHeader?"#1e293b":config.warnaBgHeader;
        body.classList.toggle("dark-mode",dark);
        root.style.setProperty("--app-font",config.fontFamily||DEFAULTS.fontFamily);
        root.style.setProperty("--brand-font",config.brandFontFamily||config.fontFamily||DEFAULTS.brandFontFamily);
        const primary=dark&&(!config.bgPrimary||config.bgPrimary===DEFAULTS.bgPrimary)?"#0f172a":(config.bgPrimary||DEFAULTS.bgPrimary);
        const secondary=dark&&(!config.bgSecondary||config.bgSecondary===DEFAULTS.bgSecondary)?"#1e293b":(config.bgSecondary||DEFAULTS.bgSecondary);
        root.style.setProperty("--bg-primary",primary);
        root.style.setProperty("--bg-secondary",secondary);
        root.style.setProperty("--text-color",dark?"#e2e8f0":"#334155");
        root.style.setProperty("--heading-color",dark?"#f8fafc":"#0d2240");
        root.style.setProperty("--border-color",dark?"#334155":"#e2e8f0");
        root.style.setProperty("--input-bg",dark?"#0f172a":"#ffffff");
        root.style.setProperty("--nav-desktop-bg",navColor||DEFAULTS.warnaBgHeader);
        root.style.setProperty("--accent-color",config.warnaSubJudul||DEFAULTS.warnaSubJudul);
        document.querySelectorAll("[data-ldm-brand-title]").forEach(node=>{
            node.textContent=config.judul||DEFAULTS.judul;
            node.style.color=config.warnaJudul||contrast(config.warnaBgHeader);
            node.style.textShadow=`1px 1px 0 ${config.warnaOutline||DEFAULTS.warnaOutline}`;
        });
        document.querySelectorAll("[data-ldm-brand-subtitle]").forEach(node=>{
            node.textContent=config.subJudul||DEFAULTS.subJudul;
            node.style.color=config.warnaSubJudul||DEFAULTS.warnaSubJudul;
        });
        document.querySelectorAll("[data-ldm-brand-logo]").forEach(node=>{
            if(config.logoData){node.src=config.logoData;node.style.display="block"}
            else{node.removeAttribute("src");node.style.display="none"}
        });
        document.querySelectorAll("[data-ldm-role-chip]").forEach(node=>{
            node.textContent=`👤 ${String(localStorage.getItem("userRole")||localStorage.getItem("role")||"pengguna").toLowerCase()}`;
        });
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content",navColor||DEFAULTS.warnaBgHeader);
        window.LDMGlobalNavigation?.applySharedTheme?.();
    }

    function modalHTML(){
        const fonts=FONT_OPTIONS.map(([value,label])=>`<option value="${value.replace(/"/g,"&quot;")}">${label}</option>`).join("");
        return `<div class="ldm-theme-modal" id="ldmSharedThemeModal" role="dialog" aria-modal="true" aria-labelledby="ldmThemeTitle"><div class="ldm-theme-dialog"><div class="ldm-theme-dialog-head"><div><h2 id="ldmThemeTitle">🎨 Pengaturan Tema</h2><p>Perubahan berlaku pada Dashboard dan seluruh halaman Sistem di perangkat ini.</p></div><button type="button" class="ldm-theme-close" data-ldm-theme-close aria-label="Tutup">✕</button></div><form class="ldm-theme-form" id="ldmSharedThemeForm"><div class="ldm-theme-grid"><div class="ldm-theme-field"><label for="ldmThemeTitleInput">Nama toko/aplikasi</label><input id="ldmThemeTitleInput" maxlength="60" required></div><div class="ldm-theme-field"><label for="ldmThemeSubtitleInput">Subjudul</label><input id="ldmThemeSubtitleInput" maxlength="90"></div><div class="ldm-theme-field"><label>Warna header</label><div class="ldm-theme-color-row"><input type="color" id="ldmThemeHeaderColor"><input id="ldmThemeHeaderText" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div><div class="ldm-theme-field"><label>Warna aksen</label><div class="ldm-theme-color-row"><input type="color" id="ldmThemeAccentColor"><input id="ldmThemeAccentText" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div><div class="ldm-theme-field"><label>Warna latar halaman</label><div class="ldm-theme-color-row"><input type="color" id="ldmThemePrimaryColor"><input id="ldmThemePrimaryText" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div><div class="ldm-theme-field"><label>Warna kartu</label><div class="ldm-theme-color-row"><input type="color" id="ldmThemeSecondaryColor"><input id="ldmThemeSecondaryText" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div><div class="ldm-theme-field"><label for="ldmThemeFont">Font aplikasi</label><select id="ldmThemeFont">${fonts}</select></div><div class="ldm-theme-field"><label class="ldm-theme-check"><input type="checkbox" id="ldmThemeDark"> Aktifkan dark mode</label></div><div class="ldm-theme-field full"><label for="ldmThemeLogo">Logo toko (opsional, maksimal 2 MB)</label><input type="file" id="ldmThemeLogo" accept="image/png,image/jpeg,image/webp,image/svg+xml"><div class="ldm-theme-logo-preview" id="ldmThemeLogoPreview"><img id="ldmThemeLogoImage" alt="Pratinjau logo"><button type="button" class="ldm-theme-cancel" id="ldmThemeRemoveLogo">Hapus Logo</button></div></div></div><div class="ldm-theme-modal-actions"><button type="button" class="ldm-theme-reset" id="ldmThemeReset">Reset Tema</button><button type="button" class="ldm-theme-cancel" data-ldm-theme-close>Batal</button><button type="submit" class="ldm-theme-save">Simpan & Terapkan</button></div></form></div></div><div class="ldm-theme-toast" id="ldmThemeToast" role="status"></div>`;
    }

    function byId(id){return document.getElementById(id)}
    function pair(colorId,textId){
        const color=byId(colorId),text=byId(textId);
        color.addEventListener("input",()=>{text.value=color.value});
        text.addEventListener("input",()=>{if(/^#[0-9a-f]{6}$/i.test(text.value))color.value=text.value});
    }

    function showToast(message){
        const toast=byId("ldmThemeToast");
        toast.textContent=message;toast.classList.add("show");
        clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove("show"),2600);
    }

    function fill(){
        const config=read();pendingLogo=config.logoData||"";
        byId("ldmThemeTitleInput").value=config.judul;
        byId("ldmThemeSubtitleInput").value=config.subJudul;
        [["ldmThemeHeaderColor","ldmThemeHeaderText",config.warnaBgHeader],["ldmThemeAccentColor","ldmThemeAccentText",config.warnaSubJudul],["ldmThemePrimaryColor","ldmThemePrimaryText",config.bgPrimary],["ldmThemeSecondaryColor","ldmThemeSecondaryText",config.bgSecondary]].forEach(([color,text,value])=>{byId(color).value=value;byId(text).value=value});
        byId("ldmThemeFont").value=config.fontFamily;
        if(!byId("ldmThemeFont").value)byId("ldmThemeFont").value=DEFAULTS.fontFamily;
        byId("ldmThemeDark").checked=Boolean(config.darkMode);
        const preview=byId("ldmThemeLogoPreview");
        if(pendingLogo){byId("ldmThemeLogoImage").src=pendingLogo;preview.classList.add("show")}
        else preview.classList.remove("show");
        byId("ldmThemeLogo").value="";
    }

    function open(){fill();byId("ldmSharedThemeModal").classList.add("open");document.body.style.overflow="hidden";byId("ldmThemeTitleInput").focus()}
    function close(){byId("ldmSharedThemeModal").classList.remove("open");document.body.style.overflow=""}

    function save(event){
        event.preventDefault();
        const previous=read();
        const config={...previous,judul:byId("ldmThemeTitleInput").value.trim()||DEFAULTS.judul,subJudul:byId("ldmThemeSubtitleInput").value.trim(),warnaBgHeader:byId("ldmThemeHeaderText").value,warnaSubJudul:byId("ldmThemeAccentText").value,bgPrimary:byId("ldmThemePrimaryText").value,bgSecondary:byId("ldmThemeSecondaryText").value,fontFamily:byId("ldmThemeFont").value,brandFontFamily:byId("ldmThemeFont").value,darkMode:byId("ldmThemeDark").checked,logoData:pendingLogo};
        config.warnaJudul=contrast(config.warnaBgHeader);
        localStorage.setItem(KEY,JSON.stringify(config));
        apply(config);close();showToast("Tema berhasil disimpan dan terhubung ke semua halaman.");
        window.dispatchEvent(new CustomEvent("ldm-theme-changed",{detail:config}));
        try{channel?.postMessage({type:"theme-updated"})}catch(error){}
    }

    function reset(){
        if(!confirm("Kembalikan tema ke pengaturan bawaan pada seluruh halaman?"))return;
        localStorage.removeItem(KEY);pendingLogo="";apply(DEFAULTS);fill();showToast("Tema dikembalikan ke pengaturan bawaan.");
        window.dispatchEvent(new CustomEvent("ldm-theme-changed",{detail:DEFAULTS}));
        try{channel?.postMessage({type:"theme-updated"})}catch(error){}
    }

    function boot(){
        document.body.classList.add("ldm-system-page");
        apply();
        if(!byId("ldmSharedThemeModal"))document.body.insertAdjacentHTML("beforeend",modalHTML());
        document.querySelectorAll("[data-ldm-theme-open]").forEach(button=>button.addEventListener("click",open));
        document.querySelectorAll("[data-ldm-theme-close]").forEach(button=>button.addEventListener("click",close));
        byId("ldmSharedThemeModal").addEventListener("click",event=>{if(event.target===event.currentTarget)close()});
        byId("ldmSharedThemeForm").addEventListener("submit",save);
        byId("ldmThemeReset").addEventListener("click",reset);
        pair("ldmThemeHeaderColor","ldmThemeHeaderText");pair("ldmThemeAccentColor","ldmThemeAccentText");pair("ldmThemePrimaryColor","ldmThemePrimaryText");pair("ldmThemeSecondaryColor","ldmThemeSecondaryText");
        byId("ldmThemeLogo").addEventListener("change",event=>{
            const file=event.target.files&&event.target.files[0];if(!file)return;
            if(file.size>2*1024*1024){alert("Ukuran logo maksimal 2 MB.");event.target.value="";return}
            const reader=new FileReader();reader.onload=()=>{pendingLogo=String(reader.result||"");byId("ldmThemeLogoImage").src=pendingLogo;byId("ldmThemeLogoPreview").classList.add("show")};reader.readAsDataURL(file);
        });
        byId("ldmThemeRemoveLogo").addEventListener("click",()=>{pendingLogo="";byId("ldmThemeLogo").value="";byId("ldmThemeLogoPreview").classList.remove("show")});
        document.addEventListener("keydown",event=>{if(event.key==="Escape"&&byId("ldmSharedThemeModal").classList.contains("open"))close()});
        window.addEventListener("storage",event=>{if(event.key===KEY)apply()});
        try{channel=new BroadcastChannel("ldm-shared-theme");channel.addEventListener("message",()=>apply())}catch(error){}
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
    window.LDMSharedTheme={read,apply,open};
})();

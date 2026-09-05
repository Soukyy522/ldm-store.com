(function(){
    "use strict";
    const VERSION="27.9.0-commercial04-receipt1";
    const DEFAULTS=Object.freeze({namaToko:"LocDailyMar POS",subHeader:"Frozen Food",footer:"-- Terima Kasih --"});
    const $=id=>document.getElementById(id);
    function safeParse(raw){try{return JSON.parse(raw)}catch(_){return null}}
    function clean(value,max=300){return String(value??"").trim().slice(0,max)}
    function defaultsFromProfile(){
        const header=safeParse(localStorage.getItem("headerConfig"))||{};
        const storeName=clean(localStorage.getItem("ldmCloudStoreName"),120);
        return {
            namaToko:clean(header.judul,120)||storeName||DEFAULTS.namaToko,
            subHeader:clean(header.subJudul,300)||DEFAULTS.subHeader,
            footer:DEFAULTS.footer
        };
    }
    function getConfig(){return {...defaultsFromProfile(),...(safeParse(localStorage.getItem("strukConfig"))||{})}}
    function setMultiline(node,text){if(!node)return;node.textContent="";const parts=String(text||"").split(/\r?\n/);parts.forEach((part,i)=>{if(i)node.appendChild(document.createElement("br"));node.appendChild(document.createTextNode(part))})}
    function paperWidth(){return $("peripheralReceiptWidth")?.value==="80"?"80":"58"}
    function renderPreview(){
        const name=clean($("setupReceiptStoreName")?.value,120)||DEFAULTS.namaToko;
        const sub=clean($("setupReceiptSubHeader")?.value,300);
        const footer=clean($("setupReceiptFooter")?.value,300)||DEFAULTS.footer;
        if($("setupReceiptPreviewName")) $("setupReceiptPreviewName").textContent=name;
        setMultiline($("setupReceiptPreviewSubHeader"),sub);
        setMultiline($("setupReceiptPreviewFooter"),footer);
        $("setupReceiptPreview")?.classList.toggle("w80",paperWidth()==="80");
    }
    function fill(config=getConfig()){
        if($("setupReceiptStoreName")) $("setupReceiptStoreName").value=clean(config.namaToko,120)||DEFAULTS.namaToko;
        if($("setupReceiptSubHeader")) $("setupReceiptSubHeader").value=clean(config.subHeader,300);
        if($("setupReceiptFooter")) $("setupReceiptFooter").value=clean(config.footer,300)||DEFAULTS.footer;
        renderPreview();
    }
    function message(text,type=""){const el=$("setupReceiptMessage");if(!el)return;el.textContent=text||"";el.className=`peripheral-message ${type}`.trim()}
    function save(){
        const namaToko=clean($("setupReceiptStoreName")?.value,120);
        if(!namaToko){message("Nama toko/header struk wajib diisi.","error");$("setupReceiptStoreName")?.focus();return}
        const config={namaToko,subHeader:clean($("setupReceiptSubHeader")?.value,300),footer:clean($("setupReceiptFooter")?.value,300)};
        localStorage.setItem("strukConfig",JSON.stringify(config));
        renderPreview();
        if($("receiptCustomizerStatus")){ $("receiptCustomizerStatus").textContent="TERSIMPAN"; $("receiptCustomizerStatus").className="peripheral-status ok"; }
        message("Tampilan struk disimpan. Kasir dan Laporan akan memakai pengaturan yang sama.","ok");
        window.dispatchEvent(new CustomEvent("ldm-receipt-config-changed",{detail:config}));
    }
    function useProfile(){fill(defaultsFromProfile());message("Profil toko dimuat ke form. Tekan Simpan Tampilan Struk untuk menerapkannya.","ok")}
    function reset(){
        if(!confirm("Reset teks struk ke profil/default? Pengaturan printer 58/80 mm tidak ikut dihapus."))return;
        localStorage.removeItem("strukConfig");
        fill(defaultsFromProfile());
        if($("receiptCustomizerStatus")){ $("receiptCustomizerStatus").textContent="DEFAULT"; $("receiptCustomizerStatus").className="peripheral-status"; }
        message("Teks struk direset. Kasir dan Laporan kembali memakai default/profil toko.","ok");
        window.dispatchEvent(new CustomEvent("ldm-receipt-config-changed",{detail:getConfig()}));
    }
    function init(){
        if(!$("stepDevice")||!$("setupReceiptStoreName"))return;
        fill();
        ["setupReceiptStoreName","setupReceiptSubHeader","setupReceiptFooter"].forEach(id=>$(id)?.addEventListener("input",renderPreview));
        $("peripheralReceiptWidth")?.addEventListener("change",renderPreview);
        $("setupReceiptSave")?.addEventListener("click",save);
        $("setupReceiptUseStoreProfile")?.addEventListener("click",useProfile);
        $("setupReceiptReset")?.addEventListener("click",reset);
        window.addEventListener("storage",event=>{if(event.key==="strukConfig"||event.key==="headerConfig")fill()});
    }
    window.LDMReceiptCustomizer=Object.freeze({VERSION,getConfig,save,renderPreview});
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

(function(){
    "use strict";

    const ITEMS=[
        {href:"pwa-settings.html",icon:"▣",label:"Aplikasi & Update",roles:["owner","admin","kasir"]},
        {href:"recovery-center.html",icon:"↻",label:"Recovery Center",roles:["owner","admin","kasir"]},
        {href:"qa-security-performance.html",icon:"✓",label:"QA & Security",roles:["owner"]}
    ];

    const ROUTE_ACCESS={
        "dashboard.html":["owner","admin","kasir"],
        "absensi.html":["owner","admin","kasir"],
        "kasir.html":["owner","admin","kasir"],
        "retur.html":["owner","admin","kasir"],
        "barang.html":["owner","admin"],
        "supplier.html":["owner","admin"],
        "purchase-order.html":["owner","admin"],
        "goods.receipt.html":["owner","admin"],
        "kartu-stok.html":["owner","admin","kasir"],
        "stock-opname.html":["owner","admin","kasir"],
        "laporan.html":["owner","admin","kasir"],
        "shift-closing.html":["owner","admin"],
        "eod.html":["owner","admin"],
        "pengeluaran.html":["owner","admin"],
        "backup & restore.html":["owner","admin"],
        "pwa-settings.html":["owner","admin","kasir"],
        "recovery-center.html":["owner","admin","kasir"],
        "qa-security-performance.html":["owner"]
    };

    function normalize(value){
        const role=String(value||"").trim().toLowerCase();
        if(role==="administrator")return "admin";
        if(role==="cashier")return "kasir";
        return role;
    }

    function currentRole(){
        return normalize(localStorage.getItem("userRole")||localStorage.getItem("role"));
    }

    function currentPage(){
        try{return decodeURIComponent(location.pathname.split("/").pop()||"dashboard.html").toLowerCase()}
        catch(error){return (location.pathname.split("/").pop()||"dashboard.html").toLowerCase()}
    }

    function addStyle(){
        if(document.getElementById("ldmGlobalSystemNavStyle"))return;
        const style=document.createElement("style");
        style.id="ldmGlobalSystemNavStyle";
        style.textContent=`
            .ldm-system-nav-label{display:flex;align-items:center;gap:8px;margin:12px 10px 5px;padding:8px 5px 5px;color:rgba(255,255,255,.58);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;border-top:1px solid rgba(255,255,255,.12)}
            .ldm-system-nav-label::before{content:"";width:5px;height:5px;border-radius:50%;background:#0f9d58;box-shadow:0 0 0 3px rgba(15,157,88,.18)}
            .nav-bar .nav-item.ldm-system-nav-item{position:relative}
            .nav-bar .nav-item.ldm-system-nav-item::after{content:"";position:absolute;right:12px;width:5px;height:5px;border:1px solid currentColor;border-width:1px 1px 0 0;transform:rotate(45deg);opacity:.35}
            .nav-bar .nav-item.ldm-system-nav-item.active{box-shadow:inset 3px 0 #0f9d58}
            [data-ldm-system-nav][hidden]{display:none!important}
            [data-ldm-role-hidden="true"]{display:none!important}
            .ldm-system-standalone{max-width:1320px;margin:12px auto 0;padding:0 16px;display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
            .ldm-system-standalone-label{margin-right:auto;color:#667085;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
            .ldm-system-standalone a{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:8px 11px;border:1px solid #d8e0ea;border-radius:9px;background:#fff;color:#2c3e50;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(44,62,80,.05);transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease}
            .ldm-system-standalone a:hover{border-color:#0f9d58;box-shadow:0 5px 14px rgba(15,157,88,.1);transform:translateY(-1px)}
            .ldm-system-standalone a.active{background:#edf8f2;border-color:#0f9d58;color:#087943}
            .ldm-system-nav-icon{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:rgba(15,157,88,.1);color:#0f9d58;font-size:12px;font-weight:900;flex:0 0 auto}
            @media(max-width:720px){.ldm-system-standalone{padding:0 10px;justify-content:stretch}.ldm-system-standalone-label{width:100%;margin:0}.ldm-system-standalone a{flex:1 1 calc(50% - 7px);justify-content:center;white-space:nowrap}.ldm-system-standalone a:last-child{flex-basis:100%}}
        `;
        document.head.appendChild(style);
    }

    function makeLink(item,role,mode){
        const link=document.createElement("a");
        link.href=item.href;
        link.dataset.ldmSystemNav=item.href;
        link.dataset.roleAccess=item.roles.join(",");
        link.className=mode==="sidebar"?"nav-item ldm-system-nav-item":"ldm-system-standalone-item";
        if(currentPage()===item.href.toLowerCase())link.classList.add("active");
        link.innerHTML=`<span class="ldm-system-nav-icon" aria-hidden="true">${item.icon}</span>`;
        if(mode==="sidebar")link.appendChild(document.createTextNode(" "+item.label));
        else{const text=document.createElement("span");text.textContent=item.label;link.appendChild(text)}
        link.hidden=!role||!item.roles.includes(role);
        return link;
    }

    function enhanceSidebar(nav,role){
        ITEMS.forEach(item=>{
            const existing=nav.querySelector(`a[href="${item.href}"]`);
            if(existing){
                existing.dataset.ldmSystemNav=item.href;
                existing.dataset.roleAccess=item.roles.join(",");
                existing.classList.add("ldm-system-nav-item");
                existing.hidden=!role||!item.roles.includes(role);
            }
        });
        const missing=ITEMS.filter(item=>!nav.querySelector(`a[href="${item.href}"]`));
        if(!missing.length)return;
        let label=nav.querySelector(".ldm-system-nav-label");
        if(!label){label=document.createElement("div");label.className="ldm-system-nav-label";label.textContent="Sistem";nav.appendChild(label)}
        missing.forEach(item=>nav.appendChild(makeLink(item,role,"sidebar")));
    }

    function createStandalone(role){
        if(document.querySelector(".ldm-system-standalone"))return;
        const nav=document.createElement("nav");
        nav.className="ldm-system-standalone";
        nav.setAttribute("aria-label","Menu Sistem LocDailyMar");
        const label=document.createElement("span");label.className="ldm-system-standalone-label";label.textContent="Menu Sistem";nav.appendChild(label);
        ITEMS.forEach(item=>nav.appendChild(makeLink(item,role,"standalone")));
        const anchor=document.querySelector("header,.top,.header-app,.page-header");
        if(anchor)anchor.insertAdjacentElement("afterend",nav);else document.body.insertAdjacentElement("afterbegin",nav);
    }

    function routeName(href){
        if(!href||/^(#|javascript:|mailto:|tel:)/i.test(href))return "";
        let value=String(href).split("#")[0].split("?")[0].replace(/^\.\//,"");
        try{value=decodeURIComponent(value)}catch(error){}
        return value.split("/").pop().toLowerCase();
    }

    function applyRoleAccess(role){
        document.querySelectorAll(".nav-bar a[href]").forEach(link=>{
            const allowed=ROUTE_ACCESS[routeName(link.getAttribute("href"))];
            if(!allowed)return;
            const denied=!role||!allowed.includes(role);
            link.dataset.ldmRoleHidden=denied?"true":"false";
            link.setAttribute("aria-hidden",denied?"true":"false");
            if(denied)link.setAttribute("tabindex","-1");else link.removeAttribute("tabindex");
        });
    }

    function render(){
        addStyle();
        const role=currentRole();
        document.documentElement.dataset.ldmRole=role;
        const sidebars=[...document.querySelectorAll(".nav-bar")];
        if(sidebars.length)sidebars.forEach(nav=>enhanceSidebar(nav,role));else createStandalone(role);
        applyRoleAccess(role);
        document.querySelectorAll("[data-ldm-system-nav]").forEach(link=>{
            const allowed=String(link.dataset.roleAccess||"").split(",");
            link.hidden=!role||!allowed.includes(role);
        });
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",render,{once:true});else render();
    window.addEventListener("storage",event=>{if(event.key==="userRole"||event.key==="role")render()});
    if(!currentRole()){
        let attempts=0;
        const timer=setInterval(()=>{
            attempts+=1;
            if(currentRole()){clearInterval(timer);render()}
            else if(attempts>=8)clearInterval(timer);
        },250);
    }
})();

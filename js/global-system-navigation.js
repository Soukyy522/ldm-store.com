(function(){
    "use strict";
    if(window.LDM_PUBLIC_GUIDE_MODE===true)return;

    const NAV_VERSION="27.9.0-commercial-monitoring-support-v5";
    const EOD_KEYS=["laporan","dataLaporan","shiftClosingLog","dataRetur"];

    /*
     * Dashboard is the navigation source of truth.
     * Every authenticated operational page is rendered from this list.
     */
    const ROUTES=[
        {page:"dashboard.html",icon:"📊",label:"Dashboard",group:"Utama",roles:["owner","admin","kasir"],feature:"dashboard",quick:true},
        {page:"absensi.html",icon:"📝",label:"Absensi",group:"Utama",roles:["owner","admin","kasir"],feature:"attendance"},
        {page:"kasir.html",icon:"💵",label:"Kasir",group:"Utama",roles:["owner","admin","kasir"],feature:"pos",quick:true},

        {page:"barang.html",icon:"📦",label:"Barang",group:"Inventori",roles:["owner","admin","kasir"],feature:"inventory",badge:"navBadge"},
        {page:"kartu-stok.html",icon:"📒",label:"Kartu Stok",group:"Inventori",roles:["owner","admin","kasir"],feature:"stock_card"},
        {page:"stock-opname.html",icon:"📋",label:"Stock Opname",group:"Inventori",roles:["owner","admin","kasir"],feature:"stock_opname"},
        {page:"multi-store.html",icon:"⇄",label:"Multi-Toko & Transfer",group:"Inventori",roles:["owner","admin"],feature:"multi_store",quick:true},

        {page:"supplier.html",icon:"🏢",label:"Supplier",group:"Supplier & Pembelian",roles:["owner","admin"],feature:"suppliers"},
        {page:"Purchase-Order.html",icon:"🛒",label:"Purchase Order",group:"Supplier & Pembelian",roles:["owner","admin"],feature:"purchase_order",badge:"pendingPOBadge"},
        {page:"goods.receipt.html",icon:"📥",label:"Goods Receipt",group:"Supplier & Pembelian",roles:["owner","admin"],feature:"goods_receipt",badge:"pendingGRBadge"},

        {page:"retur.html",icon:"↩️",label:"Retur",group:"Keuangan & Laporan",roles:["owner","admin","kasir"],feature:"returns"},
        {page:"laporan.html",icon:"📑",label:"Laporan",group:"Keuangan & Laporan",roles:["owner","admin","kasir"],feature:"reports",quick:true},
        {page:"owner-control-center.html",icon:"🏛️",label:"Kontrol Pusat",group:"Keuangan & Laporan",roles:["owner"],feature:"central_control",primaryOwnerOnly:true},
        {page:"pengeluaran.html",icon:"💸",label:"Pengeluaran",group:"Keuangan & Laporan",roles:["owner","admin"],feature:"expenses"},

        {page:"shift-closing.html",icon:"🔒",label:"Closing Shift",group:"Closing & Data",roles:["owner","admin"],feature:"shift_closing"},
        {page:"eod.html",icon:"🌙",label:"End of Day",group:"Closing & Data",roles:["owner","admin"],feature:"eod",requiresEodReady:true},
        {page:"backup%20%26%20restore.html",icon:"💾",label:"Backup & Restore",group:"Closing & Data",roles:["owner","admin"],feature:"backup_restore"},

        {page:"account-management.html",icon:"👥",label:"Management Akun",group:"Sistem",roles:["owner"],feature:"cloud_accounts"},
        {page:"device-management.html",icon:"💻",label:"Perangkat Cloud",group:"Sistem",roles:["owner"],feature:"cloud_devices"},
        {page:"pwa-settings.html",icon:"📲",label:"Aplikasi & Update",group:"Sistem",roles:["owner","admin","kasir"],feature:"app_update"},
        {page:"penyimpanan.html",icon:"🗄️",label:"Penyimpanan & Retensi",group:"Sistem",roles:["owner","admin"],feature:"app_update"},
        {page:"recovery-center.html",icon:"🛟",label:"Recovery Center",group:"Sistem",roles:["owner","admin","kasir"],feature:"recovery_center"},
        {page:"qa-security-performance.html",icon:"🧪",label:"QA & Security",group:"Sistem",roles:["owner"],feature:"qa_security"},
        {page:"monitoring-error.html",icon:"🚨",label:"Monitoring Error",group:"Sistem",roles:["owner","admin"],infrastructure:true},
        {page:"support-center.html",icon:"🛟",label:"Pusat Bantuan & Support",group:"Sistem",roles:["owner","admin","kasir"]},
        {page:"license.html",icon:"🔑",label:"Lisensi & Paket",group:"Sistem",roles:["owner","admin","kasir"]},
        {page:"panduan.html",icon:"📘",label:"Panduan Pengguna",group:"Sistem",roles:["owner","admin","kasir"]}
    ];

    const GROUP_ORDER=["Utama","Inventori","Supplier & Pembelian","Keuangan & Laporan","Closing & Data","Sistem"];
    const GROUP_META={
        "Utama":"⚡",
        "Inventori":"📦",
        "Supplier & Pembelian":"🏢",
        "Keuangan & Laporan":"📑",
        "Closing & Data":"🔐",
        "Sistem":"⚙️",
        "Menu & Cabang":"☕",
        "Bahan & Pembelian":"🥛",
        "Barang":"🍜",
        "Belanja & Supplier":"🧺",
        "Operasional Harian":"🕒",
        "Pengaturan":"⚙️"
    };

    /*
     * Navigasi adaptif per Mode Operasional.
     * Ini hanya menyederhanakan menu. Halaman/fitur tidak dihapus dan
     * hak akses role + lisensi tetap menjadi lapisan izin utama.
     */
    const MODE_NAV_PROFILES=Object.freeze({
        retail:Object.freeze({
            id:"retail",icon:"🛒",label:"Toko Ritel",
            tagline:"Navigasi lengkap untuk stok, pembelian, audit, dan operasional toko.",
            hidden:Object.freeze([]),
            labels:Object.freeze({}),
            quick:Object.freeze({}),
            groups:Object.freeze({})
        }),
        cafe:Object.freeze({
            id:"cafe",icon:"☕",label:"Kafe",
            tagline:"Fokus pada kasir, menu, pembelian bahan, laporan, dan operasional harian.",
            hidden:Object.freeze([
                "kartu-stok.html","stock-opname.html","retur.html",
                "backup & restore.html","recovery-center.html","qa-security-performance.html"
            ]),
            labels:Object.freeze({
                "barang.html":"Menu & Produk",
                "multi-store.html":"Cabang & Transfer",
                "supplier.html":"Supplier Bahan",
                "purchase-order.html":"Pesanan Bahan",
                "goods.receipt.html":"Penerimaan Bahan",
                "laporan.html":"Laporan Penjualan",
                "shift-closing.html":"Tutup Shift",
                "eod.html":"Tutup Hari"
            }),
            quick:Object.freeze({"barang.html":true,"multi-store.html":false}),
            groups:Object.freeze({
                "Inventori":"Menu & Cabang",
                "Supplier & Pembelian":"Bahan & Pembelian",
                "Closing & Data":"Operasional Harian",
                "Sistem":"Pengaturan"
            })
        }),
        warung:Object.freeze({
            id:"warung",icon:"🍜",label:"Warung",
            tagline:"Navigasi ringkas untuk jualan cepat, barang/menu, belanja, dan tutup operasional.",
            hidden:Object.freeze([
                "kartu-stok.html","stock-opname.html","retur.html",
                "multi-store.html","owner-control-center.html",
                "backup & restore.html","recovery-center.html","qa-security-performance.html"
            ]),
            labels:Object.freeze({
                "barang.html":"Barang & Menu",
                "supplier.html":"Supplier",
                "purchase-order.html":"Belanja / PO",
                "goods.receipt.html":"Barang Masuk",
                "laporan.html":"Laporan Penjualan",
                "shift-closing.html":"Tutup Shift",
                "eod.html":"Tutup Hari"
            }),
            quick:Object.freeze({"barang.html":true,"multi-store.html":false}),
            groups:Object.freeze({
                "Inventori":"Barang",
                "Supplier & Pembelian":"Belanja & Supplier",
                "Closing & Data":"Operasional Harian",
                "Sistem":"Pengaturan"
            })
        })
    });

    let lastEodState=null;
    let eodPollTimer=0;

    function normalizeRole(value){
        const role=String(value||"").trim().toLowerCase();
        if(role==="administrator")return "admin";
        if(role==="cashier")return "kasir";
        return role;
    }

    function currentRole(){
        try{
            if(typeof window.getSecuritySession==="function"){
                const session=window.getSecuritySession();
                const role=normalizeRole(session&&session.role);
                if(role)return role;
            }
        }catch(error){}
        return normalizeRole(localStorage.getItem("userRole")||localStorage.getItem("role"));
    }

    function currentPage(){
        let page=location.pathname.split("/").pop()||"dashboard.html";
        try{page=decodeURIComponent(page)}catch(error){}
        return String(page||"dashboard.html").toLowerCase();
    }

    function normalizedPage(value){
        let page=String(value||"").split("#")[0].split("?")[0].replace(/^\.\//,"");
        try{page=decodeURIComponent(page)}catch(error){}
        return page.split("/").pop().toLowerCase();
    }

    function esc(value){
        return String(value==null?"":value)
            .replace(/&/g,"&amp;")
            .replace(/</g,"&lt;")
            .replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;")
            .replace(/'/g,"&#039;");
    }

    function sessionName(){
        return String(
            localStorage.getItem("activeUsername")
            || localStorage.getItem("loggedInUser")
            || localStorage.getItem("username")
            || "Pengguna"
        );
    }

    function storeName(){
        return String(localStorage.getItem("ldmCloudStoreName")||"Toko belum terhubung");
    }

    function readArray(key){
        try{
            const value=JSON.parse(localStorage.getItem(key)||"[]");
            return Array.isArray(value)?value:[];
        }catch(error){
            return [];
        }
    }

    function witaDate(value){
        return window.LDMLocalTime.dateKey(value);
    }

    function recordDate(item){
        if(!item)return "";
        const raw=item.waktu_teks||item.tanggal||item.tgl||item.date||item.waktu||item.created_at||item.timestamp||"";
        if(typeof raw==="string" && /^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
        const d=new Date(raw);
        return isNaN(d)?"":witaDate(d);
    }

    function cashierName(item){
        return String(item&&(
            item.kasir||item.user||item.username||item.admin||""
        )||"").trim().toLowerCase();
    }

    function shiftName(value){return String(value||"").trim().toLowerCase()}

    /* Same EOD readiness rule used by dashboard.html. */
    function calculateEodReadiness(){
        const today=witaDate(new Date());
        const laporan=readArray("laporan");
        const transactions=(laporan.length?laporan:readArray("dataLaporan")).filter(item=>recordDate(item)===today);
        const activeAccounts=new Set(transactions.map(cashierName).filter(Boolean));

        if(activeAccounts.size===0){
            return {ready:false,activeAccounts:[],pendingAccounts:[],hasShift1:false,hasShift2:false,date:today};
        }

        const closingToday=readArray("shiftClosingLog").filter(item=>String(item&&item.tanggal||"").slice(0,10)===today);
        const closedAccounts=new Set(closingToday.map(item=>String(item&&item.kasir||"").trim().toLowerCase()).filter(Boolean));
        const pendingAccounts=[...activeAccounts].filter(account=>!closedAccounts.has(account));
        const hasShift1=closingToday.some(item=>shiftName(item&&item.shift)==="shift 1");
        const hasShift2=closingToday.some(item=>shiftName(item&&item.shift)==="shift 2");

        return {
            ready:pendingAccounts.length===0 && hasShift1 && hasShift2,
            activeAccounts:[...activeAccounts],
            pendingAccounts,
            hasShift1,
            hasShift2,
            date:today
        };
    }

    function licenseFeatureAllowed(feature){
        if(!feature)return true;
        if(window.LDM_LICENSE_V2_CONFIG?.enabled===false)return true;
        const license=window.LDM_LICENSE_V2_STATE;
        return Boolean(license&&window.LDMLicenseV2?.hasFeature(feature,license));
    }

    function currentStoreMode(){
        const apiMode=window.LDMStoreMode&&typeof window.LDMStoreMode.getMode==="function"
            ? window.LDMStoreMode.getMode()
            : "";
        const value=String(apiMode||localStorage.getItem("ldmStoreOperationalMode")||"retail").trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(MODE_NAV_PROFILES,value)?value:"retail";
    }

    function modeProfile(){return MODE_NAV_PROFILES[currentStoreMode()]||MODE_NAV_PROFILES.retail}

    function modeRouteKey(route){return normalizedPage(route&&route.page)}

    function routeAllowed(route,role,eodReady){
        if(!route.roles.includes(role))return false;
        // Fitur infrastructure (Monitoring/Support) tidak dipaketkan sebagai
        // fitur berbayar. Role tetap membatasi siapa yang dapat melihatnya.
        if(!route.infrastructure && !licenseFeatureAllowed(route.feature))return false;
        if(route.requiresEodReady && !eodReady)return false;
        const profile=modeProfile();
        if(profile.hidden.includes(modeRouteKey(route)))return false;
        return true;
    }

    function routeForMode(route){
        const profile=modeProfile();
        const key=modeRouteKey(route);
        const copy={...route};
        if(profile.labels[key])copy.label=profile.labels[key];
        if(Object.prototype.hasOwnProperty.call(profile.quick,key))copy.quick=profile.quick[key];
        copy.group=profile.groups[route.group]||route.group;
        copy.originalGroup=route.group;
        return copy;
    }

    function visibleRoutes(role,eodReady){
        return ROUTES.filter(route=>routeAllowed(route,role,eodReady)).map(routeForMode);
    }

    function modeGroupOrder(){
        const profile=modeProfile();
        const mapped=GROUP_ORDER.map(group=>profile.groups[group]||group);
        return [...new Set(mapped)];
    }

    function isActive(route){return currentPage()===normalizedPage(route.page)}

    function addStylesheet(){
        let link=document.getElementById("ldmGlobalNavigationCSS");
        if(!link){
            link=document.createElement("link");
            link.id="ldmGlobalNavigationCSS";
            link.rel="stylesheet";
            document.head.appendChild(link);
        }
        link.href=`css/global-responsive-navigation.css?v=${NAV_VERSION}`;

        let modeLink=document.getElementById("ldmStoreModesGlobalCSS");
        if(!modeLink){
            modeLink=document.createElement("link");
            modeLink.id="ldmStoreModesGlobalCSS";
            modeLink.rel="stylesheet";
            document.head.appendChild(modeLink);
        }
        modeLink.href=`css/store-modes.css?v=${NAV_VERSION}`;
    }

    function applyModeContext(){
        const mode=currentStoreMode();
        const profile=MODE_NAV_PROFILES[mode]||MODE_NAV_PROFILES.retail;
        document.documentElement.dataset.ldmStoreMode=mode;
        document.documentElement.dataset.ldmModeLabel=profile.label;
        document.documentElement.dataset.ldmCurrentPage=currentPage();
        if(document.body){
            document.body.dataset.ldmStoreMode=mode;
            document.body.dataset.ldmModeLabel=profile.label;
        }
        return profile;
    }

    function parseTheme(){
        try{return JSON.parse(localStorage.getItem("headerConfig")||"null")||{}}
        catch(error){return {}}
    }

    function applySharedTheme(){
        const config=parseTheme();
        const root=document.documentElement;
        const headerColor=config.warnaBgHeader||"#0d2240";
        const accent=config.warnaSubJudul||"#ffc107";
        const dark=Boolean(config.darkMode);
        if(document.body)document.body.classList.toggle("dark-mode",dark);
        root.style.setProperty("--app-font",config.fontFamily||"'Poppins', sans-serif");
        root.style.setProperty("--brand-font",config.brandFontFamily||config.fontFamily||"'Poppins', sans-serif");
        root.style.setProperty("--bg-primary",config.bgPrimary||(dark?"#0f172a":"#f4f6f9"));
        root.style.setProperty("--bg-secondary",config.bgSecondary||(dark?"#1e293b":"#ffffff"));
        root.style.setProperty("--nav-desktop-bg",dark&&headerColor==="#0d2240"?"#1e293b":headerColor);
        root.style.setProperty("--accent-color",accent);
        document.querySelectorAll("[data-ldm-brand-title]").forEach(node=>{
            node.textContent=config.judul||"LocDailyMar";
            if(config.warnaJudul)node.style.color=config.warnaJudul;
            if(config.warnaOutline)node.style.textShadow=`1px 1px 0 ${config.warnaOutline}`;
        });
        document.querySelectorAll("[data-ldm-brand-subtitle]").forEach(node=>{
            node.textContent=config.subJudul||"LocDailyMar";
            node.style.color=accent;
        });
        document.querySelectorAll("[data-ldm-brand-logo]").forEach(node=>{
            if(config.logoData){node.src=config.logoData;node.style.display="block"}
            else node.style.display="none";
        });
    }

    function badgeHTML(route){
        return route.badge?`<span class="ldm-global-badge" data-source-badge="${esc(route.badge)}" hidden></span>`:"";
    }

    function routeLink(route,mode){
        const klass=mode==="mobile"?"ldm-global-mobile-link":"ldm-global-link";
        return `<a href="${route.page}" class="${klass}${isActive(route)?" active":""}" data-ldm-route="${esc(route.page)}"${route.primaryOwnerOnly?' data-primary-owner-route="true" hidden':''}${isActive(route)?' aria-current="page"':''}><span class="ldm-global-icon" aria-hidden="true">${route.icon}</span><span class="ldm-global-link-label">${esc(route.label)}</span>${badgeHTML(route)}</a>`;
    }

    function groupedHTML(routes,mode){
        const grouped={};
        routes.forEach(route=>{
            if(!grouped[route.group])grouped[route.group]=[];
            grouped[route.group].push(route);
        });
        return modeGroupOrder().filter(group=>grouped[group]&&grouped[group].length).map(group=>{
            const items=grouped[group];
            if(mode==="mobile"){
                return `<section class="ldm-global-mobile-group"><div class="ldm-global-mobile-label"><span>${GROUP_META[group]||"•"}</span><span>${esc(group)}</span></div>${items.map(item=>routeLink(item,"mobile")).join("")}</section>`;
            }
            return `<section class="ldm-global-group"><div class="ldm-global-group-title"><span>${GROUP_META[group]||"•"}</span><span>${esc(group)}</span></div><div class="ldm-global-links">${items.map(item=>routeLink(item,"desktop")).join("")}</div></section>`;
        }).join("");
    }

    function closeMobileDrawer(){
        const drawer=document.getElementById("ldmGlobalMobileDrawer");
        const overlay=document.getElementById("ldmGlobalMobileOverlay");
        if(drawer)drawer.classList.remove("open");
        if(overlay)overlay.classList.remove("open");
        if(document.body)document.body.classList.remove("ldm-global-menu-open");
        document.querySelectorAll("[data-ldm-menu-toggle]").forEach(button=>button.setAttribute("aria-expanded","false"));
    }

    function openMobileDrawer(){
        const drawer=document.getElementById("ldmGlobalMobileDrawer");
        const overlay=document.getElementById("ldmGlobalMobileOverlay");
        if(!drawer||!overlay)return;
        drawer.classList.add("open");
        overlay.classList.add("open");
        if(document.body)document.body.classList.add("ldm-global-menu-open");
        document.querySelectorAll("[data-ldm-menu-toggle]").forEach(button=>button.setAttribute("aria-expanded","true"));
        drawer.querySelector("a")?.focus();
    }

    function prepareMenuButtons(){
        const existing=[...document.querySelectorAll("[data-ldm-menu-toggle], .btn-toggle-menu")];
        const unique=[...new Set(existing)];

        unique.forEach(button=>{
            button.dataset.ldmMenuToggle="true";
            button.removeAttribute("onclick");
            button.setAttribute("aria-label",button.getAttribute("aria-label")||"Buka menu navigasi");
            button.setAttribute("aria-expanded","false");
            if(button.dataset.ldmGlobalBound!=="true"){
                button.addEventListener("click",event=>{
                    if(matchMedia("(max-width:899px)").matches){
                        event.preventDefault();
                        event.stopPropagation();
                        openMobileDrawer();
                    }
                });
                button.dataset.ldmGlobalBound="true";
            }
        });

        if(unique.length){
            document.documentElement.classList.remove("ldm-global-floating-menu");
            document.getElementById("ldmGlobalFloatingToggle")?.remove();
            return;
        }
        document.documentElement.classList.add("ldm-global-floating-menu");
        let floating=document.getElementById("ldmGlobalFloatingToggle");
        if(!floating){
            floating=document.createElement("button");
            floating.id="ldmGlobalFloatingToggle";
            floating.type="button";
            floating.className="ldm-global-floating-toggle";
            floating.dataset.ldmMenuToggle="true";
            floating.setAttribute("aria-label","Buka menu navigasi");
            floating.setAttribute("aria-expanded","false");
            floating.textContent="☰";
            floating.addEventListener("click",openMobileDrawer);
            document.body.appendChild(floating);
        }
    }

    function buildMega(role,eodReady){
        document.getElementById("ldmGlobalMegaNav")?.remove();
        const routes=visibleRoutes(role,eodReady);
        if(!routes.length)return false;
        const quick=routes.filter(route=>route.quick).map(route=>`<a href="${route.page}" class="${isActive(route)?"active":""}"${isActive(route)?' aria-current="page"':''}><span>${route.icon}</span><span>${esc(route.label)}</span></a>`).join("");
        const profile=modeProfile();
        const shell=document.createElement("div");
        shell.id="ldmGlobalMegaNav";
        shell.className="ldm-global-mega";
        shell.innerHTML=`<nav class="ldm-global-mega-bar" aria-label="Navigasi utama desktop"><button type="button" class="ldm-global-mega-trigger" aria-expanded="false" aria-controls="ldmGlobalMegaPanel"><span>☷</span><span>Menu</span><span class="ldm-global-mega-arrow">▼</span></button><div class="ldm-global-mega-quick">${quick}</div><div class="ldm-global-mega-session"><span class="ldm-global-mode-chip">${profile.icon} ${esc(profile.label)}</span><span class="ldm-global-store" data-ldm-store-name>${esc(storeName())}</span><span class="ldm-global-role">👤 ${esc(role)}</span></div><div class="ldm-global-mega-panel" id="ldmGlobalMegaPanel"><div class="ldm-global-panel-head"><div><strong>Navigasi ${profile.label}</strong><p>${esc(profile.tagline)} Menu tetap mengikuti role dan paket lisensi.</p></div><button type="button" class="ldm-global-panel-close">✕ Tutup</button></div><div class="ldm-global-mega-grid">${groupedHTML(routes,"desktop")}</div></div></nav>`;

        const app=document.querySelector(".app-layout");
        const main=app&&app.querySelector(".main-content");
        if(app&&main)app.insertBefore(shell,main);
        else document.body.insertAdjacentElement("afterbegin",shell);

        const trigger=shell.querySelector(".ldm-global-mega-trigger");
        const close=shell.querySelector(".ldm-global-panel-close");
        const setOpen=open=>{
            shell.classList.toggle("open",Boolean(open));
            trigger.setAttribute("aria-expanded",open?"true":"false");
        };
        trigger.addEventListener("click",event=>{event.stopPropagation();setOpen(!shell.classList.contains("open"))});
        close.addEventListener("click",()=>{setOpen(false);trigger.focus()});
        document.addEventListener("click",event=>{if(shell.isConnected&&!shell.contains(event.target))setOpen(false)});
        document.addEventListener("keydown",event=>{if(event.key==="Escape")setOpen(false)});
        // Desktop compact: Mega Menu hanya dibuka lewat tombol Menu.
        // Hover-open sengaja dinonaktifkan agar panel tidak menutupi layar saat
        // pointer sekadar melewati navigation bar.
        return true;
    }

    function buildMobileDrawer(role,eodReady){
        const old=document.getElementById("ldmGlobalMobileDrawer");
        const wasOpen=Boolean(old&&old.classList.contains("open"));
        old?.remove();
        document.getElementById("ldmGlobalMobileOverlay")?.remove();

        const routes=visibleRoutes(role,eodReady);
        if(!routes.length)return false;

        const overlay=document.createElement("div");
        overlay.id="ldmGlobalMobileOverlay";
        overlay.className="ldm-global-mobile-overlay";
        overlay.setAttribute("aria-hidden","true");

        const drawer=document.createElement("aside");
        drawer.id="ldmGlobalMobileDrawer";
        drawer.className="ldm-global-mobile-drawer";
        drawer.setAttribute("aria-label","Menu navigasi HP");
        const profile=modeProfile();
        drawer.innerHTML=`<div class="ldm-global-mobile-head"><strong>☰ Menu LocDailyMar</strong><button type="button" class="ldm-global-mobile-close" aria-label="Tutup menu">✕</button></div><div class="ldm-global-mobile-context"><strong>${esc(sessionName())} · ${esc(role)}</strong><span data-ldm-store-name>${esc(storeName())}</span><span class="ldm-global-mobile-mode">${profile.icon} ${esc(profile.label)}</span></div>${groupedHTML(routes,"mobile")}`;
        document.body.append(overlay,drawer);

        drawer.querySelector(".ldm-global-mobile-close").addEventListener("click",closeMobileDrawer);
        overlay.addEventListener("click",closeMobileDrawer);
        drawer.querySelectorAll("a").forEach(link=>link.addEventListener("click",closeMobileDrawer));

        if(wasOpen){
            drawer.classList.add("open");
            overlay.classList.add("open");
            document.body.classList.add("ldm-global-menu-open");
        }
        prepareMenuButtons();
        return true;
    }

    function syncBadges(){
        const mode=String(localStorage.getItem("ldmStoreOperationalMode")||"retail").toLowerCase();
        const softStock=mode==="cafe"||mode==="warung";
        document.querySelectorAll(".ldm-global-badge[data-source-badge]").forEach(target=>{
            if(softStock && target.dataset.sourceBadge==="navBadge"){
                target.hidden=true;
                target.textContent="";
                return;
            }
            const source=document.getElementById(target.dataset.sourceBadge);
            const text=String(source&&source.textContent||"").trim();
            const visible=Boolean(text&&text!=="0"&&text!=="!");
            target.hidden=!visible;
            if(visible)target.textContent=text;
        });
    }

    function refreshContext(){
        document.querySelectorAll("[data-ldm-store-name]").forEach(node=>{node.textContent=storeName()});
        const role=currentRole();
        document.querySelectorAll(".ldm-global-role").forEach(node=>{node.textContent=`👤 ${role}`});
    }

    function applyPrimaryOwnerRoutes(context){
        const allowed=context?.is_primary_owner===true;
        document.querySelectorAll('[data-primary-owner-route="true"]').forEach(link=>{
            const license=window.LDM_LICENSE_V2_STATE;
            const licensingEnabled=window.LDM_LICENSE_V2_CONFIG?.enabled!==false;
            const licensed=!licensingEnabled||Boolean(
                license&&window.LDMLicenseV2?.hasFeature("central_control",license)
            );
            link.hidden=!(allowed&&licensed);
        });
    }

    function initializePrimaryOwnerAccess(){
        const start=()=>window.LDMPrimaryOwner.initialize().then(applyPrimaryOwnerRoutes);
        if(window.LDMPrimaryOwner){start();return}
        if(document.getElementById("ldmPrimaryOwnerScript"))return;
        const script=document.createElement("script");
        script.id="ldmPrimaryOwnerScript";
        script.src="js/primary-owner-service.js?v=26.0";
        script.addEventListener("load",start,{once:true});
        document.head.appendChild(script);
    }

    function markLegacyEodLinks(result){
        document.documentElement.setAttribute("data-ldm-eod-ready",result.ready?"true":"false");
        document.querySelectorAll('a[href="eod.html"]').forEach(link=>{
            if(result.ready){
                link.removeAttribute("data-eod-waiting");
                link.title="End of Day siap karena seluruh Closing Shift wajib sudah lengkap.";
            }else{
                link.setAttribute("data-eod-waiting","true");
                link.title="End of Day akan muncul setelah seluruh Closing Shift wajib hari ini lengkap.";
            }
        });
    }

    function render(){
        addStylesheet();
        applyModeContext();
        applySharedTheme();
        const role=currentRole();
        document.documentElement.dataset.ldmRole=role;
        if(!role)return false;

        const eodResult=calculateEodReadiness();
        markLegacyEodLinks(eodResult);
        const desktopReady=buildMega(role,eodResult.ready);
        const mobileReady=buildMobileDrawer(role,eodResult.ready);
        syncBadges();
        refreshContext();
        initializePrimaryOwnerAccess();

        if(desktopReady&&mobileReady){
            document.documentElement.classList.add("ldm-global-nav-ready","ldm-global-mega-ready");
            window.dispatchEvent(new CustomEvent("ldm-global-navigation-rendered",{detail:{role,eodReady:eodResult.ready}}));
            return true;
        }
        return false;
    }

    function syncEodAvailability(forceRender){
        const result=calculateEodReadiness();
        markLegacyEodLinks(result);
        const state=result.ready?"true":"false";
        if(forceRender||lastEodState!==state){
            lastEodState=state;
            if(currentRole())render();
            window.dispatchEvent(new CustomEvent("ldm-eod-menu-readiness",{detail:result}));
        }
        return result;
    }

    function boot(){
        let attempt=0;
        const run=()=>{
            attempt+=1;
            if(render()||attempt>=16){
                syncEodAvailability(false);
                syncBadges();
                return;
            }
            setTimeout(run,250);
        };
        run();

        if(!eodPollTimer){
            eodPollTimer=window.setInterval(()=>{
                if(!document.hidden)syncEodAvailability(false);
            },2000);
        }
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
    else boot();

    document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMobileDrawer()});
    window.addEventListener("storage",event=>{
        if(["headerConfig","userRole","role","ldmCloudStoreName","ldmStoreOperationalMode"].includes(event.key))render();
        if(EOD_KEYS.includes(event.key))syncEodAvailability(false);
    });
    window.addEventListener("focus",()=>syncEodAvailability(false));
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncEodAvailability(false)});
    window.addEventListener("ldm-cloud-session-ready",()=>{render();syncEodAvailability(false)});
    window.addEventListener("ldm-store-mode-change",()=>{render();syncBadges();});
    window.addEventListener("ldm-primary-owner-ready",event=>applyPrimaryOwnerRoutes(event.detail));
    window.addEventListener("ldm-license-v2-authorized",()=>{
        render();
        applyPrimaryOwnerRoutes(window.LDM_PRIMARY_OWNER_CONTEXT);
    });

    window.LDMGlobalNavigation={
        version:NAV_VERSION,
        routes:ROUTES.slice(),
        modeProfiles:MODE_NAV_PROFILES,
        currentStoreMode,
        render,
        applySharedTheme,
        refreshContext,
        getVisibleRoutes:(role,eodReady)=>visibleRoutes(normalizeRole(role),Boolean(eodReady)).map(route=>({...route})),
        checkEodAvailability:syncEodAvailability,
        calculateEodReadiness,
        openMobileDrawer,
        closeMobileDrawer
    };
})();

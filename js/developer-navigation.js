(function(){
  "use strict";
  const VERSION="27.9.0-commercial-12-devnav-v15";
  const routes=[
    {key:"overview",icon:"🏠",label:"Ringkasan",href:"developer-license-v2.html#developerOverview",page:"developer-license-v2.html",hash:"#developeroverview"},
    {key:"licenses",icon:"🔐",label:"Customer & Lisensi",href:"developer-license-v2.html#licenseManagement",page:"developer-license-v2.html",hash:"#licensemanagement"},
    {key:"support",icon:"🛟",label:"Support Center",href:"developer-incident-support.html#supportOverview",page:"developer-incident-support.html",hash:"#supportoverview"}
  ];
  const esc=s=>String(s??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function pageName(){return (location.pathname.split("/").pop()||"").toLowerCase()}
  function activeKey(){
    const page=pageName(),hash=(location.hash||"").toLowerCase();
    if(page==="developer-license-v2.html") return hash==="#licensemanagement"?"licenses":"overview";
    if(page==="developer-incident-support.html") return "support";
    return "";
  }
  function build(){
    const app=document.getElementById("app");
    if(!app||document.getElementById("developerNavigation"))return;
    const active=activeKey();
    const nav=document.createElement("nav");
    nav.id="developerNavigation";
    nav.className="developer-nav";
    nav.setAttribute("aria-label","Navigasi Developer Center");
    nav.dataset.version=VERSION;
    nav.innerHTML=`<div class="developer-nav__bar">
      <div class="developer-nav__brand"><span class="developer-nav__brand-mark">D</span><span class="developer-nav__brand-copy"><strong>Developer Center</strong><span>Khusus developer</span></span></div>
      <button type="button" class="developer-nav__toggle" id="developerNavToggle" aria-expanded="false" aria-controls="developerNavLinks">☰ <span>Menu Developer</span></button>
      <div class="developer-nav__links" id="developerNavLinks">${routes.map(r=>`<a class="developer-nav__link ${r.key===active?"is-active":""}" data-dev-route="${esc(r.key)}" href="${esc(r.href)}"><span aria-hidden="true">${r.icon}</span><span class="developer-nav__label">${esc(r.label)}</span></a>`).join("")}</div>
      <span class="developer-nav__badge">🔒 Developer only</span>
    </div>`;
    app.insertBefore(nav,app.firstChild);
    const toggle=nav.querySelector("#developerNavToggle");
    toggle?.addEventListener("click",()=>{
      const open=nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded",String(open));
    });
    nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{nav.classList.remove("is-open");toggle?.setAttribute("aria-expanded","false")}));
    window.addEventListener("hashchange",syncActive);
    setTimeout(scrollHashTarget,0);
  }
  function syncActive(){
    const active=activeKey();
    document.querySelectorAll("#developerNavigation [data-dev-route]").forEach(a=>a.classList.toggle("is-active",a.dataset.devRoute===active));
  }
  function scrollHashTarget(){
    if(!location.hash)return;
    const el=document.getElementById(location.hash.slice(1));
    if(el)el.scrollIntoView({behavior:"smooth",block:"start"});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",build,{once:true});else build();
  window.LDMDeveloperNavigation={version:VERSION,refresh:syncActive};
})();

(function(){
  "use strict";

  const TECH_RULES = [
    [/\bSupabase\s+Auth\b/gi, "Sistem Login Cloud"],
    [/\bSupabase\s+Storage\b/gi, "Penyimpanan File Cloud"],
    [/\bSupabase\s+Advisors?\b/gi, "Pemeriksaan Keamanan Developer"],
    [/\bApp\s+Supabase\b/gi, "Server Aplikasi"],
    [/\bSupabase\b/gi, "Layanan Cloud"],
    [/\bEdge\s+Functions?\b/gi, "Layanan Server"],
    [/\bSQL-\d+(?:[A-Z0-9.-]*)?\b/gi, "Konfigurasi Sistem"],
    [/\bSQL\b/gi, "Konfigurasi Data"],
    [/\bRPC\b/gi, "Layanan Data"],
    [/\bRLS\b/gi, "Proteksi Akses Data"],
    [/\bIndexedDB\b/gi, "Penyimpanan Lokal"],
    [/\bService\s+Worker\b/gi, "Layanan Offline"],
    [/\blocalStorage\b/gi, "Penyimpanan Browser"],
    [/\bsessionStorage\b/gi, "Penyimpanan Sesi"],
    [/\bschema\s+cache\b/gi, "sinkronisasi konfigurasi"],
    [/\bpg_cron\b/gi, "jadwal otomatis"],
    [/\bpg_net\b/gi, "layanan jaringan"],
    [/\bCron\s+secret\b/gi, "kredensial jadwal otomatis"],
    [/\bCron\b/gi, "Jadwal Otomatis"],
    [/\bservice[_-]?role(?:\s+key)?\b/gi, "kredensial internal"],
    [/\banon(?:ymous)?\s+key\b/gi, "kredensial aplikasi"],
    [/\bJWT\b/gi, "sesi keamanan"],
    [/\baccess\s+token\b/gi, "data sesi"],
    [/\brefresh\s+token\b/gi, "data sesi"],
    [/\bpublishable\s+key\b/gi, "konfigurasi aplikasi"],
    [/\bAPI\b/gi, "Layanan Aplikasi"],
    [/\bwebhook\b/gi, "verifikasi pembayaran otomatis"],
    [/\bbackend\b/gi, "server"],
    [/\bfrontend\b/gi, "aplikasi"],
    [/\bpayload\b/gi, "data permintaan"],
    [/\bmigration\b/gi, "pembaruan sistem"],
    [/\bbucket(?:\s+Storage)?\b/gi, "ruang penyimpanan file"],
    [/\bdatabase\b/gi, "penyimpanan data"],
    [/\bAuth\s+user\b/gi, "akun login"],
    [/\bAuth\b/gi, "login"],
    [/\bPGRST\d+\b/gi, "kode sinkronisasi"],
    [/\bHTTP\s+[45]\d\d\b/gi, "gangguan layanan"],
    [/\bfunctions?\s*>\s*[^>]+(?:\s*>\s*(?:Logs|Invocations))?/gi, "diagnostik Developer"],
    [/js\/supabase-config\.js/gi, "konfigurasi aplikasi"],
  ];

  const SENSITIVE_RULES = [
    [/\b(?:sb_secret_|service_role)[A-Za-z0-9._-]*\b/gi, "[DATA INTERNAL]"],
    [/\bBearer\s+[A-Za-z0-9._~-]+\b/gi, "[DATA SESI]"],
  ];

  function sanitize(value){
    let text=String(value==null?"":value);
    for(const [pattern,replacement] of SENSITIVE_RULES){
      text=text.replace(pattern,replacement);
    }
    for(const [pattern,replacement] of TECH_RULES){
      text=text.replace(pattern,replacement);
    }

    // Convert a few common raw diagnostic sentences into customer copy.
    text=text
      .replace(/Layanan Cloud client belum tersedia\.?/gi,"Layanan Cloud belum siap. Muat ulang aplikasi dan coba kembali.")
      .replace(/Layanan Server client helper belum tersedia[^.]*\.?/gi,"Layanan server belum siap. Muat ulang aplikasi dan coba kembali.")
      .replace(/Layanan Data [^.!?]{0,90}belum (?:tersedia|terpasang)[^.!?]*\.?/gi,"Layanan data belum siap. Coba kembali atau hubungi Support bila masalah berlanjut.")
      .replace(/Konfigurasi Data[^.!?]{0,120}(?:belum|missing|tidak)[^.!?]*\.?/gi,"Konfigurasi sistem belum siap. Hubungi Support bila masalah berlanjut.")
      .replace(/Tidak dapat menghubungi Layanan Server [^.!?]+\.?/gi,"Layanan server belum dapat dihubungi. Periksa koneksi lalu coba kembali.")
      .replace(/Layanan Server [^.!?]+ tidak ditemukan[^.!?]*\.?/gi,"Layanan server belum tersedia. Hubungi Support.")
      .replace(/Periksa diagnostik Developer[^.!?]*\.?/gi,"Hubungi Support bila masalah berlanjut.")
      .replace(/\s{2,}/g," ");

    return text.trim();
  }

  function shouldSanitizeNode(node){
    const parent=node && node.parentElement;
    if(!parent)return false;
    if(parent.closest("script,style,code,pre,[data-ldm-developer-raw]"))return false;

    const value=String(node.nodeValue||"");
    return /(Supabase|Edge Function|\bSQL(?:-\d+)?\b|\bRPC\b|\bRLS\b|IndexedDB|Service Worker|localStorage|sessionStorage|schema cache|pg_cron|pg_net|\bCron\b|service[_-]?role|anon key|\bJWT\b|access token|refresh token|publishable key|\bAPI\b|webhook|backend|frontend|payload|migration|\bbucket\b|\bdatabase\b|\bAuth\b|PGRST\d+|HTTP [45]\d\d)/i.test(value);
  }

  function sanitizeTextNode(node){
    if(!shouldSanitizeNode(node))return;
    const next=sanitize(node.nodeValue);
    if(next!==node.nodeValue)node.nodeValue=next;
  }

  function sanitizeElementAttributes(element){
    if(!(element instanceof Element))return;
    if(element.closest("[data-ldm-developer-raw]"))return;
    for(const attr of ["title","aria-label","placeholder"]){
      if(!element.hasAttribute(attr))continue;
      const current=element.getAttribute(attr)||"";
      const next=sanitize(current);
      if(next!==current)element.setAttribute(attr,next);
    }
  }

  function sanitizeMessageElement(element){
    if(!(element instanceof Element))return;
    if(element.closest("[data-ldm-developer-raw]"))return;

    const hint=[
      element.id||"",
      element.className||"",
      element.getAttribute("role")||""
    ].join(" ");

    if(!/(message|status|notice|note|help|error|warn|health|result|output|log|state|diagnostic|alert)/i.test(hint)){
      return;
    }

    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(sanitizeTextNode);
  }

  function sanitizeDocument(){
    const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(sanitizeTextNode);

    document.querySelectorAll("[title],[aria-label],[placeholder]").forEach(sanitizeElementAttributes);
  }

  const nativeAlert=window.alert?.bind(window);
  const nativeConfirm=window.confirm?.bind(window);
  const nativePrompt=window.prompt?.bind(window);

  if(nativeAlert)window.alert=(message)=>nativeAlert(sanitize(message));
  if(nativeConfirm)window.confirm=(message)=>nativeConfirm(sanitize(message));
  if(nativePrompt)window.prompt=(message,defaultValue)=>nativePrompt(sanitize(message),defaultValue);

  function boot(){
    sanitizeDocument();

    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==="characterData"){
          sanitizeTextNode(record.target);
          continue;
        }
        if(record.type==="attributes"){
          sanitizeElementAttributes(record.target);
          continue;
        }
        for(const node of record.addedNodes){
          if(node.nodeType===Node.TEXT_NODE){
            sanitizeTextNode(node);
          }else if(node.nodeType===Node.ELEMENT_NODE){
            sanitizeElementAttributes(node);
            sanitizeMessageElement(node);
          }
        }
        sanitizeMessageElement(record.target);
      }
    });

    observer.observe(document.documentElement,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:["title","aria-label","placeholder"]
    });
  }

  window.LDMCustomerCopy=Object.freeze({sanitize,sanitizeDocument});

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",boot,{once:true});
  }else{
    boot();
  }
})();

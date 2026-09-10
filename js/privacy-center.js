(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const APP_VERSION=String(window.LDM_LICENSE_V2_CONFIG?.appVersion||window.LDM_APP_VERSION||"27.9.0-v28.4.0");

  function client(){
    if(window.ldmSupabase)return window.ldmSupabase;
    if(window.LDMSupabase&&window.LDMSupabase.isConfigured&&window.LDMSupabase.isConfigured())return window.LDMSupabase.createClient();
    throw new Error("Layanan Cloud belum dikonfigurasi.");
  }
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function fmt(v){if(!v)return "-";const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Makassar"}).format(d)}
  function setText(id,value){const n=$(id);if(n)n.textContent=value==null||value===""?"-":String(value)}
  function setMsg(id,text,type=""){const n=$(id);if(!n)return;n.textContent=text||"";n.className=`privacy-message ${type||""}`}
  function browserSummary(){return String(navigator.userAgent||"").replace(/\s+/g," ").trim().slice(0,480)}
  function typeLabel(v){return({access_copy:"Akses / Salinan Data",correction:"Koreksi Data",restriction:"Pembatasan Pemrosesan",deletion:"Penghapusan / Pemusnahan",withdraw_consent:"Penarikan Persetujuan",portability:"Portabilitas Data",automated_decision_objection:"Keberatan Keputusan Otomatis",other:"Lainnya"})[String(v||"")]||v||"-"}
  function scopeLabel(v){return({account_profile:"Akun & Profil",attendance:"Absensi",device_session:"Perangkat & Sesi",support_security:"Support & Keamanan",business_activity:"Aktivitas Bisnis Terkait Akun",all_personal_data:"Seluruh Data Pribadi Saya",other:"Lainnya"})[String(v||"")]||v||"-"}
  function statusLabel(v){return({submitted:"Diajukan",verifying:"Verifikasi",processing:"Diproses",waiting_user:"Menunggu Anda",completed:"Selesai",rejected:"Ditolak",cancelled:"Dibatalkan"})[String(v||"submitted")]||v}
  function roleLabel(v){return({owner:"Owner",admin:"Admin",kasir:"Kasir"})[String(v||"").toLowerCase()]||String(v||"-")}
  function licenseStatusLabel(v){return({active:"Aktif",pending:"Menunggu Pembayaran",suspended:"Ditangguhkan",expired:"Kedaluwarsa",cancelled:"Dibatalkan"})[String(v||"").toLowerCase()]||String(v||"-")}
  function planLabel(name,code){const c=String(code||"").toUpperCase(),n=String(name||"");return c==="LIFETIME"||/lifetime\s+legacy/i.test(n)?"Lifetime":(n||c||"-")}
  function validCode(v){return /^PRV-\d{8}-[A-F0-9]{10}$/.test(String(v||""))}

  function updateCorrectionField(){const yes=$("privacyRequestType").value==="correction";$("correctionField").hidden=!yes;if(!yes)$("privacyCorrection").value=""}
  function clearForm(){$("privacyRequestType").value="access_copy";$("privacyDataScope").value="account_profile";$("privacyDetails").value="";$("privacyCorrection").value="";$("privacyConfirm").checked=false;$("privacyChars").textContent="0";$("privacySuccess").classList.remove("show");setMsg("privacyMessage","");updateCorrectionField()}
  async function copyText(value,msgId){if(!value)return;try{await navigator.clipboard.writeText(value);setMsg(msgId,`Kode ${value} disalin.`,"ok")}catch{setMsg(msgId,"Clipboard tidak tersedia. Salin kode secara manual.","error")}}

  function quotaBar(id,used,max){
    const bar=$(id);if(!bar)return;
    const u=Math.max(0,Number(used||0)),m=Math.max(0,Number(max||0));
    const pct=m>0?Math.min(100,(u/m)*100):0;
    bar.style.width=`${pct}%`;
  }

  function renderQuota(quota,license){
    const q=quota&&typeof quota==="object"?quota:{};
    const maxDevices=Number(q.max_devices??license?.max_devices??0)||0;
    const maxStores=Number(q.max_stores??license?.max_stores??0)||0;
    const activeDevices=Number(q.active_devices||0);
    const activeStores=Number(q.active_stores||0);
    const deviceRemaining=Math.max(0,maxDevices-activeDevices);
    const storeRemaining=Math.max(0,maxStores-activeStores);

    setText("pcNetworkId",q.network_id||"-");
    setText("pcLicensePlan",planLabel(q.plan_name||license?.plan_name,q.plan_code||license?.plan_code));
    setText("pcLicenseStatus",licenseStatusLabel(q.license_status||license?.status||"-"));
    setText("pcLicenseExpiry",fmt(q.license_expires_at||license?.expires_at));
    setText("pcQuotaSyncedAt",fmt(q.license_synced_at));
    setText("pcDeviceQuotaText",maxDevices?`${activeDevices} / ${maxDevices}`:"Belum tersedia");
    setText("pcStoreQuotaText",maxStores?`${activeStores} / ${maxStores}`:"Belum tersedia");
    setText("pcDeviceQuotaNote",maxDevices?`${deviceRemaining} slot perangkat tersisa. Perangkat PENDING tidak dihitung sampai Owner menyetujuinya.`:"Batas perangkat sedang diperbarui.");
    setText("pcStoreQuotaNote",maxStores?`${storeRemaining} slot toko tersisa. Batas toko menghitung toko pusat + seluruh cabang aktif.`:"Batas toko sedang diperbarui.");
    quotaBar("pcDeviceQuotaBar",activeDevices,maxDevices);
    quotaBar("pcStoreQuotaBar",activeStores,maxStores);

    const health=$("pcQuotaHealth"),warning=$("pcQuotaWarning");
    if(!health||!warning)return;
    const synced=Boolean(q.quota_synced&&maxDevices>0&&maxStores>0);
    const overDevice=maxDevices>0&&activeDevices>maxDevices;
    const overStore=maxStores>0&&activeStores>maxStores;
    health.className="quota-health";
    warning.hidden=true;
    warning.className="quota-warning";

    if(overDevice||overStore){
      health.textContent="Melebihi kuota";
      health.classList.add("bad");
      warning.hidden=false;
      warning.textContent=`Data lama terdeteksi melebihi kuota paket. Penambahan baru akan ditolak sampai penggunaan kembali sesuai batas.${overDevice?` Perangkat ${activeDevices}/${maxDevices}.`:""}${overStore?` Toko ${activeStores}/${maxStores}.`:""}`;
      return;
    }
    if(!synced){
      health.textContent="Belum siap";
      health.classList.add("warn");
      warning.hidden=false;
      warning.classList.add("warn");
      warning.textContent="Informasi batas pemakaian belum tersedia. Pastikan perangkat terhubung ke internet lalu tekan Refresh Data Saya.";
      return;
    }
    if(q.quota_stale){
      health.textContent="Perlu diperbarui";
      health.classList.add("warn");
      warning.hidden=false;
      warning.classList.add("warn");
      warning.textContent="Informasi batas pemakaian perlu diperbarui. Tekan Refresh Data Saya saat perangkat terhubung ke internet.";
      return;
    }
    const status=String(q.license_status||license?.status||"").toLowerCase();
    const expired=q.license_expires_at&&new Date(q.license_expires_at).getTime()<=Date.now();
    if(status&&status!=="active"||expired){
      health.textContent="Lisensi tidak aktif";
      health.classList.add("bad");
      warning.hidden=false;
      warning.textContent="Lisensi sedang tidak aktif atau sudah berakhir. Penambahan perangkat dan toko baru ditolak sampai lisensi kembali aktif.";
      return;
    }
    health.textContent="Aktif";
    health.classList.add("good");
  }

  let vaultTimers=new Map();
  async function ownerAccessToken(){const {data,error}=await client().auth.getSession();if(error)throw error;const token=data?.session?.access_token||"";if(!token)throw new Error("Silakan login kembali untuk melihat data lisensi.");return token}
  async function licenseCall(action,payload={}){if(!window.LDMLicenseV2?.call)throw new Error("Data lisensi belum dapat dimuat.");const authorization=await ownerAccessToken();return window.LDMLicenseV2.call(action,payload,{authorization})}
  function hideVaultSecret(id){const secret=document.querySelector(`[data-pc-license-secret="${CSS.escape(String(id))}"]`),btn=document.querySelector(`[data-pc-license-reveal="${CSS.escape(String(id))}"]`);if(secret){secret.hidden=true;secret.innerHTML=""}if(btn){btn.textContent="Tampilkan Data Penting";btn.onclick=()=>revealPrivacyLicense(id,btn)}const old=vaultTimers.get(String(id));if(old)clearTimeout(old);vaultTimers.delete(String(id))}
  function scheduleVaultHide(id){const key=String(id),old=vaultTimers.get(key);if(old)clearTimeout(old);vaultTimers.set(key,setTimeout(()=>hideVaultSecret(key),90000))}
  async function revealPrivacyLicense(id,button){button.disabled=true;button.textContent="Memverifikasi…";setMsg("pcLicenseVaultMessage","","");try{const data=await licenseCall("owner_vault_reveal",{license_id:id}),r=data?.license||{},box=document.querySelector(`[data-pc-license-secret="${CSS.escape(String(id))}"]`);if(!box)return;box.innerHTML=`<div><span>License Key</span><code>${esc(r.license_key||"Tidak tersedia")}</code></div><div><span>Store Code</span><strong>${esc(r.store_code||"-")}</strong></div><div><span>Store UUID</span><code>${esc(r.store_id||"-")}</code></div><div><span>Network ID</span><code>${esc(r.network_id||"-")}</code></div><div><span>Email Owner</span><strong>${esc(r.owner_email||"-")}</strong></div><div><span>Masa Berlaku</span><strong>${esc(r.expires_at?fmt(r.expires_at):"Tidak terbatas")}</strong></div>`;box.hidden=false;button.textContent="Sembunyikan";button.onclick=()=>hideVaultSecret(id);scheduleVaultHide(id);setMsg("pcLicenseVaultMessage","Data penting akan disembunyikan kembali secara otomatis.","ok")}catch(error){setMsg("pcLicenseVaultMessage",error?.message||"Data lisensi belum dapat ditampilkan.","error")}finally{button.disabled=false}}
  async function loadPrimaryOwnerVault(isPrimaryOwner){const card=$("pcLicenseVault"),list=$("pcLicenseVaultList");if(!card||!list)return;card.hidden=true;list.innerHTML="";setMsg("pcLicenseVaultMessage","","");if(!isPrimaryOwner)return;try{const data=await licenseCall("owner_vault_list"),rows=Array.isArray(data?.licenses)?data.licenses:[];card.hidden=false;if(!rows.length){list.innerHTML='<div class="empty">Belum ada lisensi yang terhubung ke akun ini.</div>';return}list.innerHTML=rows.map(r=>`<article class="privacy-license-card"><div class="privacy-license-card-head"><div><h4>${esc(planLabel(r.plan_name,r.plan_code))}</h4><p>${esc(r.status||"-")} · ${esc(r.expires_at?fmt(r.expires_at):"Tidak terbatas")}</p></div><span class="quota-health good">${esc(r.max_devices??"-")} perangkat · ${esc(r.max_stores??"-")} toko</span></div><div class="privacy-license-secret" data-pc-license-secret="${esc(r.license_id)}" hidden></div><div class="privacy-license-actions"><button class="btn btn-primary" type="button" data-pc-license-reveal="${esc(r.license_id)}">Tampilkan Data Penting</button></div></article>`).join("");list.querySelectorAll("[data-pc-license-reveal]").forEach(btn=>{btn.onclick=()=>revealPrivacyLicense(btn.dataset.pcLicenseReveal,btn)})}catch(error){if(/PRIMARY_OWNER_REQUIRED|OWNER_FORBIDDEN/i.test(String(error?.code||error?.message||""))){card.hidden=true;return}card.hidden=false;list.innerHTML='<div class="empty">Data lisensi belum dapat dimuat.</div>'}}
  async function primaryOwnerFlag(ctx){if(String(ctx?.profile?.role||"").toLowerCase()!=="owner")return false;try{const {data,error}=await client().rpc("ldm_primary_owner_context");if(error)throw error;const row=Array.isArray(data)?data[0]:data;return row?.is_primary_owner===true}catch(_){return false}}

  async function loadAccountSnapshot(){
    const btn=$("btnRefreshAccountSnapshot");
    if(btn)btn.disabled=true;
    setMsg("privacyAccountMessage","Memuat data akun dan batas pemakaian…","");
    let ctx=null,user=null,device=null,license=null,quota=null;
    const notes=[];

    try{
      try{
        if(window.LDMCloudSession?.ensureAuthenticated){
          ctx=await window.LDMCloudSession.ensureAuthenticated({registerDevice:false});
        }
      }catch(_){notes.push("Data akun belum sepenuhnya tersedia.")}

      try{
        const {data,error}=await client().auth.getUser();
        if(error)throw error;
        user=data?.user||null;
      }catch(_){notes.push("Informasi akun belum dapat dimuat.")}

      try{
        if(window.LDMLicenseV2?.check)license=await window.LDMLicenseV2.check({force:true});
      }catch(_){notes.push("Status lisensi belum dapat diperbarui.")}

      try{
        if(window.LDMLicenseQuotaSync?.refresh){
          const result=await window.LDMLicenseQuotaSync.refresh({allowSync:true});
          quota=result?.quota||null;
          if(!result?.ready && result?.error)notes.push("Batas pemakaian belum dapat dimuat.");
        }else{
          const {data,error}=await client().rpc("ldm_my_license_quota");
          if(error)throw error;
          quota=data||null;
        }
      }catch(_){notes.push("Batas pemakaian belum dapat diperbarui.")}

      try{
        if(window.LDMCloudAuth?.getCurrentDeviceAccess)device=await window.LDMCloudAuth.getCurrentDeviceAccess();
      }catch(_){notes.push("Status perangkat belum dapat dimuat.")}

      const profile=ctx?.profile||{};
      setText("pcDisplayName",profile.display_name||user?.user_metadata?.display_name||profile.username||"-");
      setText("pcUsername",profile.username||"-");
      setText("pcEmail",user?.email||"-");
      setText("pcRole",roleLabel(profile.role));
      setText("pcUserId",user?.id||profile.id||profile.user_id||"-");
      setText("pcAccountCreated",fmt(user?.created_at));
      setText("pcLastSignIn",fmt(user?.last_sign_in_at));
      setText("pcStoreName",profile.store_name||"-");
      setText("pcStoreCode",profile.store_code||localStorage.getItem("ldmCloudStoreCode")||"-");
      setText("pcStoreId",profile.store_id||localStorage.getItem("ldmCloudStoreId")||"-");
      setText("pcDeviceName",device?.device_name||window.LDMLicenseV2?.deviceName?.()||"-");
      setText("pcDeviceStatus",String(device?.status||"-").toUpperCase());
      setText("pcDeviceId",device?.client_device_id||window.LDMLicenseV2?.deviceId?.()||"-");
      setText("pcDevicePlatform",device?.platform||browserSummary()||"-");
      renderQuota(quota,license);

      const isPrimaryOwner=await primaryOwnerFlag(ctx);
      await loadPrimaryOwnerVault(isPrimaryOwner);

      if(notes.length){
        setMsg("privacyAccountMessage",`Data berhasil dimuat. ${[...new Set(notes)].join(" ")}`,"");
      }else{
        setMsg("privacyAccountMessage","Data akun dan batas pemakaian berhasil diperbarui.","ok");
      }
    }finally{
      if(btn)btn.disabled=false;
    }
  }

  async function submitPrivacy(){
    const type=$("privacyRequestType").value,scope=$("privacyDataScope").value;
    const details=String($("privacyDetails").value||"").trim(),correction=String($("privacyCorrection").value||"").trim();
    if(details.length<15){setMsg("privacyMessage","Penjelasan permintaan minimal 15 karakter.","error");return}
    if(type==="correction"&&correction.length<3){setMsg("privacyMessage","Tuliskan data yang seharusnya untuk permintaan koreksi.","error");return}
    if(!$("privacyConfirm").checked){setMsg("privacyMessage","Centang konfirmasi bahwa request hanya terkait data pribadi Anda sendiri.","error");return}
    const btn=$("btnSubmitPrivacy");btn.disabled=true;setMsg("privacyMessage","Mengirim Privacy Request...","");
    try{
      const {data,error}=await client().rpc("ldm_create_privacy_request",{p_request_type:type,p_data_scope:scope,p_details:details,p_desired_correction:correction||null,p_app_version:APP_VERSION,p_browser:browserSummary(),p_online:navigator.onLine===true});
      if(error)throw error;
      const code=String(data&&data.request_code||"");$("createdPrivacyCode").textContent=code||"-";$("privacySuccess").classList.add("show");setMsg("privacyMessage","Permintaan berhasil dicatat. Simpan kode PRV untuk referensi.","ok");await loadRequests();
    }catch(e){setMsg("privacyMessage",e&&e.message?e.message:"Gagal mengirim Privacy Request.","error")}
    finally{btn.disabled=false}
  }
  async function cancelRequest(code){
    if(!validCode(code))return;
    if(!confirm(`Batalkan Privacy Request ${code}?`))return;
    setMsg("privacyListMessage",`Membatalkan ${code}...`,"");
    try{const {error}=await client().rpc("ldm_cancel_privacy_request",{p_request_code:code});if(error)throw error;setMsg("privacyListMessage",`${code} dibatalkan.`,"ok");await loadRequests()}catch(e){setMsg("privacyListMessage",e&&e.message?e.message:"Gagal membatalkan request.","error")}
  }
  function renderRequests(rows){
    const host=$("privacyRequestsList");
    if(!Array.isArray(rows)||!rows.length){host.innerHTML='<div class="empty">Belum ada Privacy Request pada akun ini.</div>';return}
    host.innerHTML=rows.map(r=>{
      const st=String(r.status||"submitted").toLowerCase();
      const canCancel=["submitted","waiting_user"].includes(st);
      const due=r.statutory_due_at?`<span class="badge tag deadline">Target ${esc(fmt(r.statutory_due_at))}</span>`:"";
      const correction=r.desired_correction?`<div class="response-note" style="background:#f8faf9;border-color:#e3ebe7"><b>Data yang diminta untuk dikoreksi:</b><br>${esc(r.desired_correction)}</div>`:"";
      const note=r.response_note?`<div class="response-note"><b>Catatan Privacy Support:</b><br>${esc(r.response_note)}</div>`:"";
      return `<article class="request"><div class="request-top"><div><code>${esc(r.request_code)}</code><div class="request-title">${esc(typeLabel(r.request_type))}</div></div><div class="actions" style="margin:0"><button class="btn btn-soft js-copy-prv" data-code="${esc(r.request_code)}">📋 Salin</button>${canCancel?`<button class="btn btn-danger js-cancel-prv" data-code="${esc(r.request_code)}">Batalkan</button>`:""}</div></div><div class="meta"><span class="badge st-${esc(st)}">${esc(statusLabel(st))}</span><span class="badge tag">${esc(scopeLabel(r.data_scope))}</span>${due}</div><div class="help" style="margin-top:9px">Dibuat ${esc(fmt(r.created_at))}${r.privacy_last_action_at?` · Update ${esc(fmt(r.privacy_last_action_at))}`:""}</div><div style="margin-top:9px;white-space:pre-wrap;font-size:12px;line-height:1.55">${esc(r.details||"")}</div>${correction}${note}</article>`
    }).join("");
    host.querySelectorAll(".js-copy-prv").forEach(b=>b.onclick=()=>copyText(b.dataset.code,"privacyListMessage"));
    host.querySelectorAll(".js-cancel-prv").forEach(b=>b.onclick=()=>cancelRequest(b.dataset.code));
  }
  async function loadRequests(){
    setMsg("privacyListMessage","Memuat riwayat Privacy Request...","");
    try{const {data,error}=await client().rpc("ldm_my_privacy_requests",{p_limit:40});if(error)throw error;renderRequests(data);setMsg("privacyListMessage","")}
    catch(e){$("privacyRequestsList").innerHTML='<div class="empty">Riwayat Privacy Request belum dapat dimuat.</div>';setMsg("privacyListMessage",e&&e.message?e.message:"Gagal memuat Privacy Request.","error")}
  }

  document.addEventListener("DOMContentLoaded",()=>{
    $("privacyRequestType").addEventListener("change",updateCorrectionField);
    $("privacyDetails").addEventListener("input",()=>{$("privacyChars").textContent=String($("privacyDetails").value.length)});
    $("btnSubmitPrivacy").addEventListener("click",submitPrivacy);
    $("btnClearPrivacy").addEventListener("click",clearForm);
    $("btnRefreshPrivacy").addEventListener("click",loadRequests);
    $("btnCopyPrivacyCode").addEventListener("click",()=>copyText($("createdPrivacyCode").textContent,"privacyMessage"));
    $("btnRefreshAccountSnapshot")?.addEventListener("click",loadAccountSnapshot);
    updateCorrectionField();
    Promise.allSettled([loadAccountSnapshot(),loadRequests()]);
    window.addEventListener("ldm-license-v2-authorized",()=>Promise.allSettled([loadAccountSnapshot(),loadRequests()]),{once:true});
  });
})();

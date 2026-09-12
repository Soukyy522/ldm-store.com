(function(){
  "use strict";

  const STATE_KEY="ldm_demo_account_state_v2863";
  const TTL_MS=2*60*60*1000;
  const VERSION="28.6.3";
  const CATEGORIES={
    SAKIT_KONDISI:"Sakit / kondisi kesehatan",
    KEPERLUAN_KELUARGA:"Keperluan keluarga mendesak",
    KENDALA_TRANSPORTASI:"Kendala transportasi / perjalanan",
    KENDALA_SISTEM:"Kendala perangkat, jaringan, atau sistem absensi",
    LUPA_KELALAIAN:"Lupa / kelalaian melakukan absensi",
    KEADAAN_DARURAT:"Keadaan darurat",
    LAINNYA:"Lainnya"
  };
  const PROFILES={
    "owner-pusat":{id:"owner-pusat",employeeId:"emp-owner-pusat",name:"Owner Pusat Demo",role:"owner",scope:"network",storeCode:"DEMO-PUSAT",storeName:"Toko Pusat Demo",icon:"🏛️"},
    "owner-cabang":{id:"owner-cabang",employeeId:"emp-owner-a",name:"Owner Cabang Demo",role:"owner",scope:"store",storeCode:"DEMO-A",storeName:"Cabang A Demo",icon:"🏪"},
    admin:{id:"admin",employeeId:"emp-admin-a",name:"Admin Demo",role:"admin",scope:"store",storeCode:"DEMO-A",storeName:"Cabang A Demo",icon:"🧑‍💼"},
    kasir:{id:"kasir",employeeId:"emp-kasir-a",name:"Kasir Demo",role:"kasir",scope:"store",storeCode:"DEMO-A",storeName:"Cabang A Demo",icon:"🧾"}
  };
  const ROUTES=[
    {id:"dashboard",icon:"📊",label:"Dashboard",roles:["owner","admin","kasir"]},
    {id:"kasir",icon:"💵",label:"Kasir",roles:["owner","admin","kasir"]},
    {id:"barang",icon:"📦",label:"Barang",roles:["owner","admin","kasir"]},
    {id:"laporan",icon:"📑",label:"Laporan",roles:["owner","admin","kasir"]},
    {id:"absensi",icon:"📝",label:"Absensi",roles:["owner","admin","kasir"]},
    {id:"master-shift",icon:"🗓️",label:"Master Shift",roles:["owner"]},
    {id:"ketidakhadiran",icon:"📋",label:"Ketidakhadiran",roles:["owner","admin","kasir"]},
    {id:"keamanan",icon:"ℹ️",label:"Informasi Demo",roles:["owner","admin","kasir"]}
  ];
  const MENU_GROUPS=[
    {title:"⚡ Utama",items:[
      {icon:"📊",label:"Dashboard",route:"dashboard"},{icon:"📝",label:"Absensi",route:"absensi"},{icon:"🗓️",label:"Master Shift",route:"master-shift",roles:["owner"]},{icon:"📋",label:"Ketidakhadiran",route:"ketidakhadiran"},{icon:"💵",label:"Kasir",route:"kasir"}
    ]},
    {title:"📦 Inventori",items:[
      {icon:"📦",label:"Barang",route:"barang"},{icon:"📒",label:"Kartu Stok",limited:true},{icon:"📋",label:"Stock Opname",limited:true},{icon:"⇄",label:"Multi-Toko & Transfer",limited:true}
    ]},
    {title:"🏢 Supplier & Pembelian",items:[
      {icon:"🏢",label:"Supplier",limited:true},{icon:"🛒",label:"Purchase Order",limited:true},{icon:"📥",label:"Goods Receipt",limited:true}
    ]},
    {title:"📑 Keuangan & Laporan",items:[
      {icon:"↩️",label:"Retur",limited:true},{icon:"📑",label:"Laporan",route:"laporan"},{icon:"🏛️",label:"Kontrol Pusat",limited:true,roles:["owner"]},{icon:"💸",label:"Pengeluaran",limited:true}
    ]},
    {title:"🔐 Closing & Data",items:[
      {icon:"🔒",label:"Closing Shift",limited:true},{icon:"💾",label:"Backup & Restore",limited:true}
    ]},
    {title:"⚙️ Sistem",items:[
      {icon:"👥",label:"Management Akun",action:"account"},{icon:"🖥️",label:"Perangkat Toko",limited:true},{icon:"📲",label:"Aplikasi & Update",limited:true},{icon:"🗄️",label:"Penyimpanan & Retensi",limited:true},{icon:"🛟",label:"Pemulihan & Sinkronisasi",limited:true},{icon:"🧪",label:"Pemeriksaan Sistem & Keamanan",limited:true},{icon:"🪄",label:"Setup Awal",limited:true},{icon:"💟",label:"Pusat Bantuan & Support",limited:true},{icon:"ℹ️",label:"Informasi Demo",route:"keamanan"}
    ]}
  ];

  function esc(value){return String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));}
  function money(value){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value)||0);}
  function pad(v){return String(v).padStart(2,"0");}
  function dateKey(date){const d=new Date(date);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
  function shiftDate(offset){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);return dateKey(d);}
  function timeNow(){const d=new Date();return `${pad(d.getHours())}:${pad(d.getMinutes())}`;}
  function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
  function clone(value){return JSON.parse(JSON.stringify(value));}

  function employees(){return [
    {id:"emp-owner-pusat",name:"Owner Pusat Demo",role:"owner",storeCode:"DEMO-PUSAT",storeName:"Toko Pusat Demo",primaryOwner:true,annualLeave:12},
    {id:"emp-owner-a",name:"Owner Cabang Demo",role:"owner",storeCode:"DEMO-A",storeName:"Cabang A Demo",annualLeave:12},
    {id:"emp-admin-a",name:"Admin Demo",role:"admin",storeCode:"DEMO-A",storeName:"Cabang A Demo",annualLeave:12},
    {id:"emp-kasir-a",name:"Kasir Demo",role:"kasir",storeCode:"DEMO-A",storeName:"Cabang A Demo",annualLeave:12},
    {id:"emp-kasir-b",name:"Kasir Cabang B Demo",role:"kasir",storeCode:"DEMO-B",storeName:"Cabang B Demo",annualLeave:12}
  ];}

  function scheduleRows(){
    const today=shiftDate(0),yesterday=shiftDate(-1),tomorrow=shiftDate(1);
    const rows=[];
    const workers=["emp-owner-a","emp-admin-a","emp-kasir-a","emp-kasir-b"];
    for(const employeeId of workers){
      const shift=employeeId==="emp-kasir-b"?"SHIFT_2":"SHIFT_1";
      const start=shift==="SHIFT_2"?"14:00":"08:00";
      const end=shift==="SHIFT_2"?"22:00":"16:00";
      [yesterday,today,tomorrow].forEach(workDate=>rows.push({employeeId,workDate,status:"WORK",shift,start,end,tolerance:15,note:"Jadwal demo"}));
    }
    return rows;
  }

  function seedState(profileId){
    const now=Date.now();
    const today=shiftDate(0),yesterday=shiftDate(-1),twoDays=shiftDate(-2);
    return {
      version:VERSION,
      createdAt:now,
      expiresAt:now+TTL_MS,
      profileId:PROFILES[profileId]?profileId:"owner-pusat",
      page:"dashboard",
      storeMode:"retail",
      demoTheme:"dashboard",
      cart:[],
      products:[
        {id:"prd-001",barcode:"899100100001",name:"Indomie Goreng",price:3200,stock:24,minStock:10},
        {id:"prd-002",barcode:"899100100002",name:"Aqua 600ml",price:4000,stock:18,minStock:12},
        {id:"prd-003",barcode:"899100100003",name:"Susu UHT 250ml",price:7500,stock:7,minStock:8},
        {id:"prd-004",barcode:"899100100004",name:"Gula 1kg",price:18000,stock:5,minStock:6},
        {id:"prd-005",barcode:"899100100005",name:"Beras 5kg",price:78000,stock:9,minStock:5},
        {id:"prd-006",barcode:"899100100006",name:"Teh Botol",price:6000,stock:21,minStock:8}
      ],
      employees:employees(),
      schedules:scheduleRows(),
      attendance:[
        {id:"att-001",employeeId:"emp-admin-a",workDate:twoDays,checkIn:"08:03",checkOut:"16:07",shift:"SHIFT_1",storeCode:"DEMO-A"},
        {id:"att-002",employeeId:"emp-kasir-a",workDate:twoDays,checkIn:"07:58",checkOut:"16:02",shift:"SHIFT_1",storeCode:"DEMO-A"}
      ],
      transactions:[
        {id:"TRX-DEMO-001",date:today,time:"09:12",storeCode:"DEMO-A",cashier:"Kasir Demo",method:"Tunai",total:28000,items:4},
        {id:"TRX-DEMO-002",date:today,time:"10:26",storeCode:"DEMO-A",cashier:"Kasir Demo",method:"QRIS Simulasi",total:46500,items:6},
        {id:"TRX-DEMO-003",date:yesterday,time:"16:15",storeCode:"DEMO-B",cashier:"Kasir Cabang B Demo",method:"Tunai",total:92000,items:8},
        {id:"TRX-DEMO-004",date:yesterday,time:"11:42",storeCode:"DEMO-A",cashier:"Kasir Demo",method:"Tunai",total:63500,items:7},
        {id:"TRX-DEMO-005",date:twoDays,time:"13:04",storeCode:"DEMO-A",cashier:"Kasir Demo",method:"QRIS Simulasi",total:121000,items:9}
      ],
      absences:[
        {id:"ABS-DEMO-A",employeeId:"emp-admin-a",workDate:yesterday,category:"KENDALA_TRANSPORTASI",reason:"Kendaraan mengalami kendala saat perjalanan menuju toko.",storeCode:"DEMO-A",status:"SUBMITTED",submittedAt:`${yesterday} 10:20`,reviewNote:""},
        {id:"ABS-DEMO-B",employeeId:"emp-kasir-b",workDate:yesterday,category:"KENDALA_SISTEM",reason:"Perangkat absensi cabang tidak dapat digunakan pada awal shift.",storeCode:"DEMO-B",status:"SUBMITTED",submittedAt:`${yesterday} 15:10`,reviewNote:""}
      ]
    };
  }

  function read(){
    try{
      const raw=sessionStorage.getItem(STATE_KEY);
      const data=raw?JSON.parse(raw):null;
      if(!data||data.version!==VERSION||Number(data.expiresAt||0)<=Date.now()) return null;
      return data;
    }catch(_){return null;}
  }
  function save(state){sessionStorage.setItem(STATE_KEY,JSON.stringify(state));return state;}
  function ensure(profileId){let state=read();if(!state)state=save(seedState(profileId));return state;}
  function currentProfile(state){return PROFILES[state.profileId]||PROFILES["owner-pusat"];}
  function start(profileId){const state=save(seedState(profileId));state.page="dashboard";save(state);location.href="demo-app.html";}
  function reset(){const old=read();const state=save(seedState(old?.profileId||"owner-pusat"));state.page=old?.page||"dashboard";save(state);return state;}
  function exit(){sessionStorage.removeItem(STATE_KEY);location.href="index.html";}

  function visibleTransactions(state,profile){return state.transactions.filter(row=>profile.scope==="network"||row.storeCode===profile.storeCode);}
  function visibleEmployees(state,profile){return state.employees.filter(emp=>profile.scope==="network"||emp.storeCode===profile.storeCode);}
  function employeeById(state,id){return state.employees.find(emp=>emp.id===id);}
  function scheduleFor(state,employeeId,workDate){return state.schedules.find(row=>row.employeeId===employeeId&&row.workDate===workDate);}
  function attendanceFor(state,employeeId,workDate){return state.attendance.find(row=>row.employeeId===employeeId&&row.workDate===workDate);}
  function absenceFor(state,employeeId,workDate){return state.absences.find(row=>row.employeeId===employeeId&&row.workDate===workDate);}

  let toastTimer=null;
  function toast(message,type="ok"){
    const el=document.getElementById("demoToast");if(!el)return;
    el.textContent=message;el.className=`demo-toast show${type==="error"?" error":type==="warn"?" warn":""}`;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.className="demo-toast";},3000);
  }
  function pageHead(title,description,actions=""){return `<div class="demo-page-head"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="demo-page-actions">${actions}</div></div>`;}
  function statusPill(text,type=""){return `<span class="demo-pill ${type}">${esc(text)}</span>`;}
  function roleLabel(value){return ({owner:"Owner",admin:"Admin",kasir:"Kasir"})[value]||String(value||"");}
  function storeLabel(value){return ({"DEMO-PUSAT":"Toko Pusat","DEMO-A":"Cabang A","DEMO-B":"Cabang B"})[value]||String(value||"");}
  function shiftLabel(value){return ({SHIFT_1:"Shift 1",SHIFT_2:"Shift 2",FULL_DAY:"Full Day"})[value]||String(value||"");}
  function workStatusLabel(value){return ({WORK:"Kerja",OFF:"Libur",ANNUAL_LEAVE:"Cuti Tahunan"})[value]||String(value||"");}
  function profileTitle(profile){return ({"owner-pusat":"Owner Pusat","owner-cabang":"Owner Cabang",admin:"Admin",kasir:"Kasir"})[profile?.id]||roleLabel(profile?.role);}
  function modeInfo(value){return ({retail:{label:"Toko Ritel",icon:"🛒",desc:"Toko Ritel · kontrol stok ketat."},warung:{label:"Warung",icon:"🍜",desc:"Warung · alur operasional sederhana."},cafe:{label:"Kafe",icon:"☕",desc:"Kafe · alur menu dan stok fleksibel."}})[value]||{label:"Toko Ritel",icon:"🛒",desc:"Toko Ritel · kontrol stok ketat."};}
  function openModal(id){const el=document.getElementById(id);if(el)el.hidden=false;}
  function closeModal(id){const el=document.getElementById(id);if(el)el.hidden=true;}
  function applyDemoTheme(state){
    if(!window.LDMSystemThemeSync)return;
    const base=window.LDMSystemThemeSync.read();
    if(state.demoTheme==="dark")window.LDMSystemThemeSync.apply({...base,darkMode:true});
    else if(state.demoTheme==="light")window.LDMSystemThemeSync.apply({...base,darkMode:false});
    else window.LDMSystemThemeSync.apply(base);
  }

  function renderDashboard(state,profile){
    const tx=visibleTransactions(state,profile);
    const today=shiftDate(0),yesterday=shiftDate(-1);
    const todayRows=tx.filter(x=>x.date===today),yesterdayRows=tx.filter(x=>x.date===yesterday);
    const sales=todayRows.reduce((a,x)=>a+Number(x.total||0),0);
    const cash=todayRows.filter(x=>String(x.method).toLowerCase().includes("tunai")&&!String(x.method).toLowerCase().includes("qris")).reduce((a,x)=>a+Number(x.total||0),0);
    const nonCash=Math.max(0,sales-cash);
    const low=state.products.filter(x=>x.stock<=x.minStock).length;
    const top=state.products.slice(0,5).map((p,i)=>({name:p.name,units:[7.55,6.1,4.8,3.4,2.15][i]||1.5,value:Math.round(p.price*([48,42,35,28,22][i]||20))}));
    const yesterdaySales=yesterdayRows.reduce((a,x)=>a+Number(x.total||0),0);
    return `<div class="reset-timer-box">
      <div><div>⏳ Ringkasan Hari Ini</div><div style="margin-top:2px"><span class="demo-countdown">DATA CONTOH</span></div></div>
      <button type="button" class="btn-toggle-day" data-demo-yesterday> Pendapatan Kemarin 🕒</button>
    </div>
    <button type="button" class="dashboard-range-trigger-demo" data-demo-limited="Filter periode laporan">
      <span>📅</span><strong>Periode</strong><span>Hari ini · 1 hari</span><span class="edit">Ubah</span>
    </button>
    <div class="dashboard-section-title">Ringkasan Penjualan Hari Ini</div>
    <div class="grid-cards">
      <section class="card omzet"><div class="card-icon">💰</div><div class="card-info"><h4>Omzet</h4><h2>${money(sales)}</h2></div></section>
      <section class="card tunai"><div class="card-icon">💵</div><div class="card-info"><h4>Tunai</h4><h2>${money(cash)}</h2></div></section>
      <section class="card nontunai"><div class="card-icon">📱</div><div class="card-info"><h4>Non Tunai (QRIS)</h4><h2>${money(nonCash)}</h2></div></section>
      <section class="card warning"><div class="card-icon">🚫</div><div class="card-info"><h4>Barang Habis / Menipis</h4><h2>${low} Item</h2></div></section>
    </div>
    <section class="detail-box">
      <h3><span>🏆 5 Item Terlaris Hari Ini <small>Berdasarkan contoh penjualan terbesar</small></span><span class="demo-pill blue">5</span></h3>
      ${top.map((p,i)=>`<div class="production-item-row"><div><b>${i+1}. ${esc(p.name)}</b><small>${String(p.units).replace('.',',')} unit terjual</small></div><strong>${money(p.value)}</strong></div>`).join("")}
    </section>
    <div class="demo-grid two">
      <section class="demo-card"><h2>Transaksi Terbaru</h2>${tx.slice(0,5).map(x=>`<div class="demo-cart-row"><span>${esc(x.time)} · ${esc(x.cashier)}</span><strong>${money(x.total)}</strong></div>`).join("")||'<div class="demo-empty">Belum ada transaksi.</div>'}</section>
      <section class="demo-card"><h2>Status Demo</h2><p>Gunakan menu utama untuk mencoba alur operasional. Fitur yang berhubungan dengan layanan nyata dibatasi pada Mode Demo.</p><div class="demo-cart-row"><span>Pendapatan kemarin</span><strong>${money(yesterdaySales)}</strong></div><div class="demo-grid two" style="margin-top:10px"><button class="demo-btn primary" data-go="kasir">Buka Kasir</button><button class="demo-btn" data-go="absensi">Buka Absensi</button></div></section>
    </div>`;
  }

  function renderKasir(state,profile){
    const cart=state.cart||[];const total=cart.reduce((sum,row)=>sum+row.price*row.qty,0);
    return `${pageHead("Kasir","Coba alur transaksi dengan data contoh.",statusPill("Mode Demo","orange"))}
      <div class="demo-grid two">
        <section class="demo-card"><h2>Pilih Barang</h2><div class="demo-products">${state.products.map(p=>`<article class="demo-product"><strong>${esc(p.name)}</strong><div class="meta">${money(p.price)} · stok ${p.stock}</div><div class="row">${statusPill(p.stock>0?"Tersedia":"Habis",p.stock>0?"green":"red")}<button class="demo-btn small primary" data-add-product="${esc(p.id)}" ${p.stock<=0?"disabled":""}>+ Keranjang</button></div></article>`).join("")}</div></section>
        <section class="demo-card"><h2>Keranjang</h2>${cart.length?cart.map(row=>`<div class="demo-cart-row"><span>${esc(row.name)} × ${row.qty}</span><strong>${money(row.price*row.qty)}</strong></div>`).join(""):'<div class="demo-empty">Keranjang masih kosong.</div>'}<div class="demo-cart-total"><span>Total</span><span>${money(total)}</span></div><div class="demo-form" style="margin-top:12px"><div class="demo-field"><label>Metode pembayaran</label><select id="demoPaymentMethod"><option>Tunai</option><option>QRIS</option></select></div><button class="demo-btn primary" id="demoCheckoutBtn" ${!cart.length?"disabled":""}>Selesaikan Transaksi</button><button class="demo-btn" id="demoClearCartBtn" ${!cart.length?"disabled":""}>Kosongkan Keranjang</button></div><p>Transaksi pada Mode Demo menggunakan data contoh dan tidak memengaruhi transaksi toko.</p></section>
      </div>`;
  }

  function renderBarang(state,profile){
    const editable=profile.role!=="kasir";
    return `${pageHead("Barang",editable?"Owner dan Admin dapat mencoba penyesuaian stok. Kasir hanya dapat melihat data.":"Akun Kasir hanya dapat melihat data barang.")}
      <section class="demo-card"><div class="demo-table-wrap"><table class="demo-table"><thead><tr><th>Barcode</th><th>Barang</th><th>Harga</th><th>Stok</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${state.products.map(p=>`<tr><td><span class="demo-kbd">${esc(p.barcode)}</span></td><td>${esc(p.name)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${statusPill(p.stock<=p.minStock?"Perlu dicek":"Aman",p.stock<=p.minStock?"orange":"green")}</td><td>${editable?`<button class="demo-btn small" data-stock="${esc(p.id)}" data-delta="-1">−1</button> <button class="demo-btn small" data-stock="${esc(p.id)}" data-delta="1">+1</button>`:statusPill("Lihat saja")}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function renderLaporan(state,profile){
    const tx=visibleTransactions(state,profile);const total=tx.reduce((s,x)=>s+Number(x.total||0),0);
    return `${pageHead("Laporan",`Data ditampilkan sesuai cakupan ${profile.scope==="network"?"Owner Pusat":"Cabang A"}.`)}
      <div class="demo-grid stats"><section class="demo-card demo-stat-card"><small>Total penjualan</small><strong>${money(total)}</strong><em>${tx.length} transaksi</em></section><section class="demo-card demo-stat-card"><small>Cakupan laporan</small><strong>${profile.scope==="network"?"Semua Cabang":"Cabang"}</strong><em>sesuai hak akses akun</em></section><section class="demo-card demo-stat-card"><small>Akun aktif</small><strong>${roleLabel(profile.role)}</strong><em>${storeLabel(profile.storeCode)}</em></section><section class="demo-card demo-stat-card"><small>Mode</small><strong>Demo</strong><em>data latihan</em></section></div>
      <section class="demo-card" style="margin-top:12px"><div class="demo-table-wrap"><table class="demo-table"><thead><tr><th>ID</th><th>Tanggal</th><th>Toko</th><th>Kasir</th><th>Metode</th><th>Total</th></tr></thead><tbody>${tx.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.date)} ${esc(x.time)}</td><td>${esc(storeLabel(x.storeCode))}</td><td>${esc(x.cashier)}</td><td>${esc(x.method)}</td><td>${money(x.total)}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function renderAbsensi(state,profile){
    const today=shiftDate(0);const schedule=scheduleFor(state,profile.employeeId,today);const att=attendanceFor(state,profile.employeeId,today);const primaryOptional=profile.id==="owner-pusat"&&!schedule;
    const detail=schedule?`${workStatusLabel(schedule.status)} · ${shiftLabel(schedule.shift)} · ${schedule.start}-${schedule.end} · toleransi ${schedule.tolerance} menit`:primaryOptional?"Jadwal Owner Pusat bersifat opsional.":"Belum ada jadwal";
    return `${pageHead("Absensi","Shift yang dipilih harus sesuai dengan jadwal pada Master Shift.")}
      <div class="demo-grid two"><section class="demo-card"><h2>Jadwal Hari Ini</h2><p>${esc(detail)}</p>${schedule?.status==="OFF"?statusPill("LIBUR","green"):schedule?.status==="ANNUAL_LEAVE"?statusPill("CUTI TAHUNAN","green"):schedule?statusPill(shiftLabel(schedule.shift),"green"):statusPill("Jadwal Opsional","orange")}</section>
      <section class="demo-card"><h2>Status Presensi</h2><p>Masuk: <b>${esc(att?.checkIn||"Belum")}</b><br>Keluar: <b>${esc(att?.checkOut||"Belum")}</b></p></section></div>
      <section class="demo-card" style="margin-top:12px"><div class="demo-form two"><div class="demo-field"><label>Shift yang dicoba</label><select id="demoAttendanceShift"><option value="SHIFT_1">Shift 1</option><option value="SHIFT_2">Shift 2</option><option value="FULL_DAY">Full Day</option></select></div><div class="demo-field"><label>Catatan</label><input value="Presensi pada Mode Demo" disabled></div></div><div class="demo-page-actions" style="margin-top:12px"><button class="demo-btn primary" id="demoCheckInBtn">Absen Masuk</button><button class="demo-btn navy" id="demoCheckOutBtn">Absen Keluar</button></div><p>Gunakan alur ini untuk mencoba aturan jadwal dan presensi.</p></section>`;
  }

  function renderMasterShift(state,profile){
    if(profile.role!=="owner") return `${pageHead("Master Shift","Akun ini tidak memiliki akses ke halaman tersebut.")}<div class="demo-lock"><strong>Akses khusus Owner</strong><p>Master Shift hanya tersedia untuk akun Owner.</p></div>`;
    const emps=visibleEmployees(state,profile);const selected=state.masterEmployeeId&&emps.some(e=>e.id===state.masterEmployeeId)?state.masterEmployeeId:(emps.find(e=>!e.primaryOwner)?.id||emps[0]?.id);state.masterEmployeeId=selected;save(state);const emp=employeeById(state,selected);const today=shiftDate(0);const sch=scheduleFor(state,selected,today)||{status:"WORK",shift:"SHIFT_1",start:"08:00",end:"16:00",tolerance:15,note:""};
    return `${pageHead("Master Shift",profile.scope==="network"?"Owner Pusat dapat memilih seluruh cabang.":"Owner Cabang hanya dapat mengatur akun di Cabang A.")}
      <div class="demo-grid two"><section class="demo-card"><h2>Pengaturan Cepat</h2><div class="demo-form"><div class="demo-field"><label>Karyawan</label><select id="demoMasterEmployee">${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===selected?"selected":""}>${esc(e.name)} · ${esc(storeLabel(e.storeCode))}</option>`).join("")}</select></div><div class="demo-field"><label>Tanggal contoh</label><input id="demoMasterDate" type="date" value="${today}"></div><div class="demo-field"><label>Status</label><select id="demoMasterStatus"><option value="WORK" ${sch.status==="WORK"?"selected":""}>Kerja</option><option value="OFF" ${sch.status==="OFF"?"selected":""}>Libur</option><option value="ANNUAL_LEAVE" ${sch.status==="ANNUAL_LEAVE"?"selected":""}>Cuti Tahunan</option></select></div><div class="demo-field"><label>Shift</label><select id="demoMasterShift"><option value="SHIFT_1" ${sch.shift==="SHIFT_1"?"selected":""}>Shift 1</option><option value="SHIFT_2" ${sch.shift==="SHIFT_2"?"selected":""}>Shift 2</option><option value="FULL_DAY" ${sch.shift==="FULL_DAY"?"selected":""}>Full Day</option></select></div><div class="demo-form two"><div class="demo-field"><label>Masuk</label><input id="demoMasterStart" type="time" value="${esc(sch.start||"08:00")}"></div><div class="demo-field"><label>Keluar</label><input id="demoMasterEnd" type="time" value="${esc(sch.end||"16:00")}"></div></div><button class="demo-btn primary" id="demoSaveScheduleBtn">Simpan Jadwal</button></div></section>
      <section class="demo-card"><h2>Hak Cuti Tahunan</h2><p><b>${esc(emp?.name||"")}</b></p><div class="demo-stat-card"><small>Hak tahun berjalan</small><strong>${Number(emp?.annualLeave||0)} hari</strong><em>tahun berjalan</em></div><div class="demo-form" style="margin-top:12px"><div class="demo-field"><label>Ubah hak cuti</label><input id="demoAnnualLeave" type="number" min="0" max="30" value="${Number(emp?.annualLeave||0)}"></div><button class="demo-btn" id="demoSaveLeaveBtn">Simpan Hak Cuti</button></div></section></div>`;
  }

  function eligibleDates(state,profile){
    const dates=[shiftDate(-1),shiftDate(-2),shiftDate(-3)];
    return dates.filter(date=>{const sch=scheduleFor(state,profile.employeeId,date);return sch&&sch.status==="WORK"&&!attendanceFor(state,profile.employeeId,date)&&!absenceFor(state,profile.employeeId,date);});
  }

  function visibleAbsences(state,profile){return state.absences.filter(row=>profile.scope==="network"||row.storeCode===profile.storeCode);}
  function renderKetidakhadiran(state,profile){
    const owner=profile.role==="owner";const eligible=eligibleDates(state,profile);const own=state.absences.filter(x=>x.employeeId===profile.employeeId);const inbox=owner?visibleAbsences(state,profile):[];
    const form=eligible.length?`<div class="demo-form"><div class="demo-field"><label>Tanggal kerja terlewat</label><select id="demoAbsenceDate">${eligible.map(d=>`<option>${d}</option>`).join("")}</select></div><div class="demo-field"><label>Jenis Ketidakhadiran</label><select id="demoAbsenceCategory">${Object.entries(CATEGORIES).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></div><div class="demo-field"><label>Penjelasan</label><textarea id="demoAbsenceReason" placeholder="Jelaskan alasan secara jelas, minimal 10 karakter."></textarea></div><button class="demo-btn primary" id="demoSubmitAbsenceBtn">Kirim Ketidakhadiran</button></div>`:'<div class="demo-empty">Tidak ada tanggal kerja terlewat yang dapat diajukan untuk profil ini.</div>';
    return `${pageHead("Ketidakhadiran","Ajukan penjelasan untuk jadwal kerja yang terlewat.")}
      <div class="demo-grid ${owner?"two":"two"}"><section class="demo-card"><h2>Form Saya</h2>${form}</section><section class="demo-card"><h2>Riwayat Saya</h2>${own.length?own.map(x=>`<div class="demo-cart-row"><span>${esc(x.workDate)} · ${esc(CATEGORIES[x.category]||x.category)}</span>${statusPill(x.status==="REVIEWED"?"Ditinjau":"Dikirim",x.status==="REVIEWED"?"green":"orange")}</div>`).join(""):'<div class="demo-empty">Belum ada pengajuan.</div>'}</section></div>
      ${owner?`<section class="demo-card" style="margin-top:12px"><h2>Inbox Owner</h2><div class="demo-table-wrap"><table class="demo-table"><thead><tr><th>Karyawan</th><th>Cabang</th><th>Tanggal</th><th>Kategori</th><th>Alasan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${inbox.map(x=>{const emp=employeeById(state,x.employeeId);return `<tr><td>${esc(emp?.name||x.employeeId)}</td><td>${esc(storeLabel(x.storeCode))}</td><td>${esc(x.workDate)}</td><td>${esc(CATEGORIES[x.category]||x.category)}</td><td class="wrap">${esc(x.reason)}</td><td>${statusPill(x.status==="REVIEWED"?"Ditinjau":"Dikirim",x.status==="REVIEWED"?"green":"orange")}</td><td><button class="demo-btn small" data-review-absence="${esc(x.id)}" ${x.status==="REVIEWED"?"disabled":""}>Tandai Ditinjau</button></td></tr>`;}).join("")||'<tr><td colspan="7"><div class="demo-empty">Inbox kosong.</div></td></tr>'}</tbody></table></div></section>`:""}`;
  }

  function renderSecurity(){return `${pageHead("Informasi Demo","Gunakan Mode Demo untuk mencoba alur aplikasi dengan data contoh.")}
    <div class="demo-grid three"><section class="demo-card"><h3>🧪 Data Latihan</h3><p>Transaksi, stok, absensi, jadwal, dan pengajuan pada Mode Demo tidak memengaruhi data toko Anda.</p></section><section class="demo-card"><h3>↻ Reset Kapan Saja</h3><p>Gunakan tombol Reset untuk mengembalikan data contoh ke kondisi awal.</p></section><section class="demo-card"><h3>👥 Pilih Peran</h3><p>Ganti akun demo untuk melihat perbedaan akses Owner Pusat, Owner Cabang, Admin, dan Kasir.</p></section><section class="demo-card"><h3>ℹ️ Gambaran Aplikasi</h3><p>Mode Demo dibuat untuk memberi gambaran penggunaan LocDailyMar. Tampilan dan fitur yang tersedia dapat berbeda dan tidak mewakili 100% aplikasi pada penggunaan sebenarnya.</p></section><section class="demo-card"><h3>🧾 Transaksi Latihan</h3><p>Gunakan Kasir untuk mencoba alur transaksi tanpa memengaruhi transaksi toko.</p></section><section class="demo-card"><h3>🗓️ Jadwal & Absensi</h3><p>Owner dapat mencoba Master Shift, lalu akun terkait dapat mencoba Absensi sesuai jadwal tersebut.</p></section></div>`;}

  function render(state){
    const profile=currentProfile(state);const stage=document.getElementById("demoStage");if(!stage)return;
    if(!ROUTES.some(r=>r.id===state.page&&r.roles.includes(profile.role))) state.page="dashboard";
    save(state);
    const renderer={dashboard:renderDashboard,kasir:renderKasir,barang:renderBarang,laporan:renderLaporan,absensi:renderAbsensi,"master-shift":renderMasterShift,ketidakhadiran:renderKetidakhadiran,keamanan:()=>renderSecurity()};
    stage.innerHTML=(renderer[state.page]||renderDashboard)(state,profile);
    renderShell(state,profile);bindStage(state,profile);
  }

  function renderShell(state,profile){
    const ctx=document.getElementById("demoContext");
    if(ctx)ctx.innerHTML=`<strong>${profile.icon} ${esc(profileTitle(profile))}</strong><span>${esc(roleLabel(profile.role))} · ${esc(storeLabel(profile.storeCode))}</span><span>Demo aktif hingga ${new Date(state.expiresAt).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}</span>`;
    const nav=document.getElementById("demoNav");
    if(nav)nav.innerHTML=ROUTES.filter(r=>r.roles.includes(profile.role)).map(r=>`<button type="button" data-demo-route="${r.id}" class="nav-item ${state.page===r.id?"active":""}"><span>${r.icon}</span>${esc(r.label)}</button>`).join("")+`<button type="button" data-demo-limited="Fitur lainnya" class="nav-item is-limited"><span>•••</span>Menu Lainnya</button>`;

    document.querySelectorAll("[data-demo-route]").forEach(el=>el.classList.toggle("active",el.dataset.demoRoute===state.page));
    const rolePill=document.getElementById("demoRolePill");if(rolePill)rolePill.textContent=`👤 ${profileTitle(profile)}`;
    const mode=modeInfo(state.storeMode||"retail");
    const modePill=document.getElementById("demoModePill");if(modePill)modePill.textContent=`${mode.icon} ${mode.label}`;
    const modeIcon=document.getElementById("demoModeIcon");if(modeIcon)modeIcon.textContent=mode.icon;
    const modeDescription=document.getElementById("demoModeDescription");if(modeDescription)modeDescription.textContent=mode.desc;
    const modeSelect=document.getElementById("demoModeSelect");if(modeSelect)modeSelect.value=state.storeMode||"retail";

    const grid=document.getElementById("demoMegaGrid");
    if(grid)grid.innerHTML=MENU_GROUPS.map(group=>`<section class="ldm-mega-group"><div class="ldm-mega-group-title">${group.title}</div><div class="ldm-mega-links">${group.items.filter(item=>!item.roles||item.roles.includes(profile.role)).map(item=>{
      const active=item.route===state.page;
      if(item.action==="account")return `<button type="button" class="ldm-mega-link" data-demo-action="account"><span class="ldm-mega-icon">${item.icon}</span>${esc(item.label)}</button>`;
      if(item.route)return `<button type="button" class="ldm-mega-link ${active?"active":""}" data-demo-route="${item.route}"><span class="ldm-mega-icon">${item.icon}</span>${esc(item.label)}</button>`;
      return `<button type="button" class="ldm-mega-link is-limited" data-demo-limited="${esc(item.label)}"><span class="ldm-mega-icon">${item.icon}</span>${esc(item.label)}<span class="ldm-mega-badge">Demo</span></button>`;
    }).join("")}</div></section>`).join("");

    const profileGrid=document.getElementById("demoProfileGrid");
    if(profileGrid)profileGrid.innerHTML=Object.values(PROFILES).map(p=>`<button type="button" class="demo-profile-option ${p.id===profile.id?"active":""}" data-demo-profile-switch="${p.id}"><strong>${p.icon} ${esc(profileTitle(p))}</strong><span>${esc(roleLabel(p.role))} · ${esc(storeLabel(p.storeCode))}</span></button>`).join("");
    applyDemoTheme(state);
  }

  function bindStage(state,profile){
    document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>{state.page=btn.dataset.go;save(state);render(state);}));
    document.querySelectorAll("[data-add-product]").forEach(btn=>btn.addEventListener("click",()=>{const p=state.products.find(x=>x.id===btn.dataset.addProduct);if(!p||p.stock<=0)return;let row=state.cart.find(x=>x.id===p.id);if(row){if(row.qty>=p.stock){toast("Jumlah keranjang sudah mencapai stok demo.","warn");return;}row.qty+=1;}else state.cart.push({id:p.id,name:p.name,price:p.price,qty:1});save(state);render(state);}));
    document.getElementById("demoClearCartBtn")?.addEventListener("click",()=>{state.cart=[];save(state);render(state);});
    document.getElementById("demoCheckoutBtn")?.addEventListener("click",()=>{
      if(!state.cart.length)return;for(const row of state.cart){const p=state.products.find(x=>x.id===row.id);if(!p||row.qty>p.stock){toast(`Stok ${row.name} tidak cukup.`,"error");return;}}
      const total=state.cart.reduce((s,x)=>s+x.price*x.qty,0);for(const row of state.cart){state.products.find(x=>x.id===row.id).stock-=row.qty;}
      const method=document.getElementById("demoPaymentMethod")?.value||"Tunai";state.transactions.unshift({id:`TRX-DEMO-${Date.now().toString().slice(-6)}`,date:shiftDate(0),time:timeNow(),storeCode:profile.storeCode,cashier:profile.name,method,total,items:state.cart.reduce((s,x)=>s+x.qty,0)});state.cart=[];save(state);render(state);toast("Transaksi berhasil disimpan pada Mode Demo.");
    });
    document.querySelectorAll("[data-stock]").forEach(btn=>btn.addEventListener("click",()=>{if(profile.role==="kasir")return;const p=state.products.find(x=>x.id===btn.dataset.stock);if(!p)return;p.stock=Math.max(0,p.stock+Number(btn.dataset.delta||0));save(state);render(state);toast("Stok berhasil diperbarui pada Mode Demo.");}));
    document.getElementById("demoCheckInBtn")?.addEventListener("click",()=>attendanceAction(state,profile,"in"));
    document.getElementById("demoCheckOutBtn")?.addEventListener("click",()=>attendanceAction(state,profile,"out"));
    document.getElementById("demoMasterEmployee")?.addEventListener("change",e=>{state.masterEmployeeId=e.target.value;save(state);render(state);});
    document.getElementById("demoSaveScheduleBtn")?.addEventListener("click",()=>{
      const employeeId=document.getElementById("demoMasterEmployee")?.value;const workDate=document.getElementById("demoMasterDate")?.value;const emp=employeeById(state,employeeId);if(!emp||!workDate)return;
      if(profile.scope!=="network"&&emp.storeCode!==profile.storeCode){toast("Owner Cabang tidak boleh mengubah cabang lain.","error");return;}
      const row={employeeId,workDate,status:document.getElementById("demoMasterStatus")?.value||"WORK",shift:document.getElementById("demoMasterShift")?.value||"SHIFT_1",start:document.getElementById("demoMasterStart")?.value||"08:00",end:document.getElementById("demoMasterEnd")?.value||"16:00",tolerance:15,note:"Diubah melalui Master Shift Demo"};const idx=state.schedules.findIndex(x=>x.employeeId===employeeId&&x.workDate===workDate);if(idx>=0)state.schedules[idx]=row;else state.schedules.push(row);save(state);render(state);toast("Jadwal berhasil disimpan.");
    });
    document.getElementById("demoSaveLeaveBtn")?.addEventListener("click",()=>{const emp=employeeById(state,document.getElementById("demoMasterEmployee")?.value);if(!emp)return;emp.annualLeave=Math.max(0,Math.min(30,Number(document.getElementById("demoAnnualLeave")?.value)||0));save(state);render(state);toast("Hak cuti berhasil diperbarui.");});
    document.getElementById("demoSubmitAbsenceBtn")?.addEventListener("click",()=>{
      const workDate=document.getElementById("demoAbsenceDate")?.value;const category=document.getElementById("demoAbsenceCategory")?.value;const reason=String(document.getElementById("demoAbsenceReason")?.value||"").trim();if(!workDate||!CATEGORIES[category]){toast("Tanggal atau kategori tidak valid.","error");return;}if(reason.length<10){toast("Penjelasan minimal 10 karakter.","warn");return;}if(!eligibleDates(state,profile).includes(workDate)){toast("Tanggal tersebut tidak lagi memenuhi syarat Ketidakhadiran.","error");return;}state.absences.unshift({id:uid("ABS-DEMO"),employeeId:profile.employeeId,workDate,category,reason,storeCode:profile.storeCode,status:"SUBMITTED",submittedAt:`${shiftDate(0)} ${timeNow()}`,reviewNote:""});save(state);render(state);toast("Ketidakhadiran berhasil dikirim.");
    });
    document.querySelectorAll("[data-review-absence]").forEach(btn=>btn.addEventListener("click",()=>{if(profile.role!=="owner")return;const row=state.absences.find(x=>x.id===btn.dataset.reviewAbsence);if(!row)return;if(profile.scope!=="network"&&row.storeCode!==profile.storeCode){toast("Owner Cabang tidak dapat meninjau cabang lain.","error");return;}row.status="REVIEWED";row.reviewNote=`Ditinjau oleh ${profile.name}`;save(state);render(state);toast("Pengajuan ditandai sudah ditinjau.");}));
  }

  function attendanceAction(state,profile,kind){
    const today=shiftDate(0);const selected=document.getElementById("demoAttendanceShift")?.value||"SHIFT_1";const schedule=scheduleFor(state,profile.employeeId,today);let att=attendanceFor(state,profile.employeeId,today);
    if(schedule){if(schedule.status==="OFF"){toast("Hari ini adalah jadwal Libur.","warn");return;}if(schedule.status==="ANNUAL_LEAVE"){toast("Hari ini adalah jadwal Cuti Tahunan.","warn");return;}if(schedule.status==="WORK"&&schedule.shift!==selected){toast(`Shift yang dipilih tidak sesuai. Jadwal Anda ${shiftLabel(schedule.shift)}.`,"error");return;}}
    else if(profile.id!=="owner-pusat"){toast("Jadwal kerja hari ini belum diatur. Hubungi Owner.","error");return;}
    if(kind==="in"){
      if(att?.checkIn){toast("Absen masuk demo sudah tercatat.","warn");return;}if(!att){att={id:uid("ATT-DEMO"),employeeId:profile.employeeId,workDate:today,checkIn:timeNow(),checkOut:"",shift:selected,storeCode:profile.storeCode};state.attendance.push(att);}else att.checkIn=timeNow();
      save(state);render(state);toast("Absen Masuk berhasil pada Mode Demo.");return;
    }
    if(!att?.checkIn){toast("Lakukan Absen Masuk demo terlebih dahulu.","warn");return;}if(att.checkOut){toast("Absen keluar demo sudah tercatat.","warn");return;}att.checkOut=timeNow();save(state);render(state);toast("Absen Keluar berhasil pada Mode Demo.");
  }

  function bootLogin(){
    document.querySelectorAll("[data-demo-profile]").forEach(btn=>btn.addEventListener("click",()=>start(btn.dataset.demoProfile)));
  }
  function bootApp(){
    let state=read();if(!state){location.replace("demo-login.html");return;}
    render(state);
    const sidebar=document.getElementById("demoSidebar"),overlay=document.getElementById("demoNavOverlay"),mega=document.getElementById("demoMegaShell"),trigger=document.getElementById("demoMegaTrigger");
    const openMenu=()=>{sidebar?.classList.add("active");overlay?.classList.add("active");};
    const closeMenu=()=>{sidebar?.classList.remove("active");overlay?.classList.remove("active");};
    const openMega=()=>{mega?.classList.add("open");trigger?.setAttribute("aria-expanded","true");};
    const closeMega=()=>{mega?.classList.remove("open");trigger?.setAttribute("aria-expanded","false");};
    const toggleMega=()=>mega?.classList.contains("open")?closeMega():openMega();
    const goRoute=routeId=>{
      const route=ROUTES.find(r=>r.id===routeId),profile=currentProfile(state);
      if(!route||!route.roles.includes(profile.role)){toast("Akun ini tidak memiliki akses ke menu tersebut.","error");return;}
      state.page=route.id;save(state);render(state);closeMega();closeMenu();window.scrollTo({top:0,behavior:"smooth"});
    };

    document.getElementById("demoOpenMenu")?.addEventListener("click",openMenu);
    document.getElementById("demoCloseMenu")?.addEventListener("click",closeMenu);
    overlay?.addEventListener("click",closeMenu);
    trigger?.addEventListener("click",toggleMega);
    document.getElementById("demoMegaClose")?.addEventListener("click",closeMega);
    document.getElementById("demoManageBtn")?.addEventListener("click",()=>openModal("demoAccountModal"));
    document.getElementById("demoThemeBtn")?.addEventListener("click",()=>openModal("demoThemeModal"));
    document.getElementById("demoLimitInfoBtn")?.addEventListener("click",()=>openModal("demoLimitModal"));
    document.getElementById("demoInstallBtn")?.addEventListener("click",()=>toast("Pemasangan aplikasi tidak dijalankan pada Mode Demo.","warn"));
    document.getElementById("demoInsightBtn")?.addEventListener("click",()=>toast("Insight lanjutan tersedia pada aplikasi berlisensi.","warn"));
    document.getElementById("demoExitBtn")?.addEventListener("click",exit);
    document.getElementById("demoResetBtn")?.addEventListener("click",()=>{state=reset();render(state);closeModal("demoAccountModal");toast("Data demo dikembalikan ke kondisi awal.");});
    document.getElementById("demoModeSelect")?.addEventListener("change",e=>{state.storeMode=["cafe","warung","retail"].includes(e.target.value)?e.target.value:"retail";save(state);render(state);toast(`Mode operasional diubah menjadi ${modeInfo(state.storeMode).label}.`);});

    document.addEventListener("click",e=>{
      const routeBtn=e.target.closest("[data-demo-route]");if(routeBtn){goRoute(routeBtn.dataset.demoRoute);return;}
      const limited=e.target.closest("[data-demo-limited]");if(limited){closeMega();toast(`${limited.dataset.demoLimited} dibatasi pada Mode Demo.`,"warn");return;}
      const action=e.target.closest("[data-demo-action='account']");if(action){closeMega();openModal("demoAccountModal");return;}
      const profileBtn=e.target.closest("[data-demo-profile-switch]");if(profileBtn){state.profileId=PROFILES[profileBtn.dataset.demoProfileSwitch]?profileBtn.dataset.demoProfileSwitch:"owner-pusat";state.page="dashboard";state.cart=[];save(state);render(state);closeModal("demoAccountModal");toast("Akun demo berhasil diganti.");return;}
      const closeBtn=e.target.closest("[data-demo-modal-close]");if(closeBtn){closeModal(closeBtn.dataset.demoModalClose);return;}
      const themeBtn=e.target.closest("[data-demo-theme]");if(themeBtn){state.demoTheme=themeBtn.dataset.demoTheme;save(state);applyDemoTheme(state);closeModal("demoThemeModal");toast("Tema demo diperbarui.");return;}
      if(e.target.closest("[data-demo-yesterday]")){toast("Pendapatan kemarin ditampilkan sebagai data contoh.");return;}
      if(mega?.classList.contains("open")&&!e.target.closest("#demoMegaShell"))closeMega();
    });
    document.querySelectorAll(".demo-modal").forEach(modal=>modal.addEventListener("click",e=>{if(e.target===modal)modal.hidden=true;}));
  }

  function boot(){if(document.body.classList.contains("demo-login-page"))bootLogin();else if(document.body.classList.contains("demo-app"))bootApp();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();

  window.LDMDemoAccount=Object.freeze({VERSION,STATE_KEY,PROFILES,start,reset,exit});
})();

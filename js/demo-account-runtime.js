(function(){
  "use strict";

  const STATE_KEY="ldm_demo_account_state_v2892";
  const TTL_MS=2*60*60*1000;
  const VERSION="28.9.2";
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
    const today=shiftDate(0),yesterday=shiftDate(-1),twoDays=shiftDate(-2),threeDays=shiftDate(-3),fourDays=shiftDate(-4),fiveDays=shiftDate(-5),sixDays=shiftDate(-6);
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
        {id:"prd-001",barcode:"-",name:"Gula",purchasePrice:17000,price:18500,stock:4,minStock:5,unit:"Kg",category:"Sembako"},
        {id:"prd-002",barcode:"-",name:"Gula 1/2 Kg",purchasePrice:8500,price:9500,stock:4,minStock:5,unit:"Bungkus",category:"Sembako"},
        {id:"prd-003",barcode:"(90)MD121519000700026",name:"HANAU Minyak 1 Liter",purchasePrice:19000,price:20500,stock:0,minStock:3,unit:"Liter",category:"Sembako"},
        {id:"prd-004",barcode:"8998225800012",name:"Minyak Goreng Bantal Fortune 1L",purchasePrice:0,price:21000,stock:0,minStock:4,unit:"Pcs",category:"Sembako"},
        {id:"prd-005",barcode:"8993496106986",name:"Minyak Goreng Bantal Fortune 500ml",purchasePrice:10200,price:11000,stock:2,minStock:4,unit:"Pcs",category:"Sembako"},
        {id:"prd-006",barcode:"8997011700031",name:"Padamu Bihun Jagung 320g",purchasePrice:7500,price:8000,stock:0,minStock:4,unit:"Pcs",category:"Sembako"},
        {id:"prd-007",barcode:"Partai hanau",name:"Partai hanau",purchasePrice:227000,price:240000,stock:4,minStock:5,unit:"Pcs",category:"Sembako"},
        {id:"prd-008",barcode:"-",name:"Telur 25",purchasePrice:21000,price:25000,stock:.175,minStock:1,unit:"Kg",category:"Sembako"},
        {id:"prd-009",barcode:"8991234567891",name:"Telur Omega",purchasePrice:25500,price:29500,stock:7.629,minStock:8,unit:"Kg",category:"Sembako"},
        {id:"prd-010",barcode:"8993496110075",name:"tepung terigu",purchasePrice:11500,price:13000,stock:5,minStock:6,unit:"Pcs",category:"Sembako"},
        {id:"prd-011",barcode:"899100100011",name:"Telur Biasa",purchasePrice:23500,price:27500,stock:18,minStock:8,unit:"Kg",category:"Sembako"},
        {id:"prd-012",barcode:"899100100012",name:"Ras partai",purchasePrice:24000,price:25450,stock:13,minStock:5,unit:"Kg",category:"Sembako"}
      ],
      employees:employees(),
      schedules:scheduleRows(),
      attendance:[
        {id:"att-001",employeeId:"emp-admin-a",workDate:twoDays,checkIn:"08:03",checkOut:"16:07",shift:"SHIFT_1",storeCode:"DEMO-A"},
        {id:"att-002",employeeId:"emp-kasir-a",workDate:twoDays,checkIn:"07:58",checkOut:"16:02",shift:"SHIFT_1",storeCode:"DEMO-A"}
      ],
      reportFrom:today,
      reportTo:today,
      reportSearch:"",
      reportPage:1,
      transactions:[
        {id:"DEMO-TRX-0801",date:today,time:"08:07",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:12500,items:2},
        {id:"DEMO-TRX-0905",date:today,time:"09:05",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Non Tunai",total:28750,items:3},
        {id:"DEMO-TRX-0944",date:today,time:"09:44",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:15000,items:2},
        {id:"DEMO-TRX-1018",date:today,time:"10:18",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Tunai",total:36500,items:4},
        {id:"DEMO-TRX-1132",date:today,time:"11:32",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Non Tunai",total:52900,items:5},
        {id:"DEMO-TRX-1247",date:today,time:"12:47",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Tunai",total:19800,items:3},
        {id:"DEMO-TRX-1316",date:today,time:"13:16",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:44250,items:6},
        {id:"DEMO-TRX-1439",date:today,time:"14:39",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Non Tunai",total:27600,items:3},
        {id:"DEMO-TRX-1521",date:today,time:"15:21",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:68400,items:7},
        {id:"DEMO-TRX-1605",date:today,time:"16:05",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Tunai",total:31250,items:3},
        {id:"DEMO-TRX-1711",date:today,time:"17:11",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Tunai",total:42700,items:5},
        {id:"DEMO-TRX-1802",date:today,time:"18:02",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Non Tunai",total:55300,items:6},
        {id:"DEMO-TRX-Y01",date:yesterday,time:"09:14",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:33800,items:4},
        {id:"DEMO-TRX-Y02",date:yesterday,time:"11:26",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Non Tunai",total:61500,items:6},
        {id:"DEMO-TRX-Y03",date:yesterday,time:"15:50",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Tunai",total:47200,items:5},
        {id:"DEMO-TRX-D2A",date:twoDays,time:"08:42",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:21400,items:2},
        {id:"DEMO-TRX-D2B",date:twoDays,time:"14:08",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Tunai",total:74800,items:8},
        {id:"DEMO-TRX-D3A",date:threeDays,time:"10:33",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Non Tunai",total:39600,items:5},
        {id:"DEMO-TRX-D3B",date:threeDays,time:"17:04",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Tunai",total:58100,items:6},
        {id:"DEMO-TRX-D4A",date:fourDays,time:"12:21",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Tunai",total:26500,items:3},
        {id:"DEMO-TRX-D4B",date:fourDays,time:"18:16",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Non Tunai",total:49200,items:5},
        {id:"DEMO-TRX-D5A",date:fiveDays,time:"09:37",storeCode:"DEMO-PUSAT",cashier:"Owner Pusat Demo",method:"Tunai",total:31750,items:4},
        {id:"DEMO-TRX-D5B",date:fiveDays,time:"16:44",storeCode:"DEMO-A",cashier:"Rina Demo",method:"Tunai",total:66200,items:7},
        {id:"DEMO-TRX-D6A",date:sixDays,time:"13:05",storeCode:"DEMO-B",cashier:"Bima Demo",method:"Non Tunai",total:43800,items:5}
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

  function demoNote(){return `<div class="dp-demo-note"><span>ℹ️</span><div><strong>Mode Demo.</strong> Halaman ini dibuat menyerupai tampilan production dengan data latihan. Tampilan dan fitur Demo tidak mewakili 100% aplikasi sebenarnya.</div><button type="button" data-demo-limit-info>Detail Demo</button></div>`;}
  function brandHeader(subtitle,actions=""){return `<header class="dp-production-header"><div class="dp-brand-block"><div class="dp-brand-text"><strong>LocDailyMar</strong><small>${esc(subtitle)}</small></div></div><div class="dp-header-actions">${actions}</div></header>`;}
  function idDate(value){try{return new Date(value+"T12:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"});}catch(_){return value;}}
  function monthLabel(){return new Date().toLocaleDateString("id-ID",{month:"long",year:"numeric"});}
  function todayLong(){return new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});}
  function calcProductMargin(p){return Math.max(0,Number(p.price||0)-Number(p.purchasePrice||Math.round(Number(p.price||0)*.82)));}
  function lowLabel(p){if(Number(p.stock||0)<=0)return `Stok Habis: 0 ${esc(p.unit||"Pcs")}`;if(Number(p.stock||0)<=Number(p.minStock||0))return `Hampir Habis: ${Number(p.stock||0)} ${esc(p.unit||"Pcs")}`;return `Stok: ${Number(p.stock||0)} ${esc(p.unit||"Pcs")}`;}

  function renderDashboard(state,profile){
    const tx=visibleTransactions(state,profile),today=shiftDate(0),rows=tx.filter(x=>x.date===today);
    const sales=rows.reduce((a,x)=>a+Number(x.total||0),0);
    const modal=Math.round(sales*.79);const profit=Math.max(0,sales-modal);
    const monthSales=tx.reduce((a,x)=>a+Number(x.total||0),0);
    const monthProfit=Math.round(monthSales*.21);
    const monthTrx=tx.length;
    const top=[
      ["Gula",18.5,342250,100],["Minyak Goreng Fortune 1L",14,294000,82],["Telur Omega",8.75,258125,71],["Tepung Terigu",17,221000,58],["Bihun Jagung",19,152000,41]
    ];
    const points="0,18 42,20 84,58 126,73 168,52 210,94 252,55 294,66 336,52 378,67 420,74 462,82 504,96 546,96 588,96 630,96 672,96 714,96 756,96 798,96 840,96 882,96 924,96 966,96 1008,96";
    const polygon=`0,110 ${points} 1008,110`;
    return `<div class="dp-page dp-dashboard">
      ${brandHeader("Dashboard",`<button class="dp-header-btn green" type="button" data-demo-action="account">👤 Manage Account</button><button class="dp-header-btn gray" type="button" data-demo-theme-open>🎨 Tema</button><button class="dp-header-btn red" type="button" data-demo-exit>🚪 Keluar Demo</button>`)}
      ${demoNote()}
      <div class="dp-dash-mode"><select class="dp-select" id="demoInlineModeSelect"><option value="retail">🛒 Toko Ritel</option><option value="warung">🍜 Warung</option><option value="cafe">☕ Kafe</option></select></div>
      <div class="dp-grid-4" style="margin-bottom:10px"><div class="dp-stat"><span>Omzet Hari Ini</span><strong>${money(sales)}</strong></div><div class="dp-stat green"><span>Profit Bersih</span><strong>${money(profit)}</strong></div><div class="dp-stat"><span>Total Transaksi</span><strong>${rows.length||28} TRX</strong></div><div class="dp-stat orange"><span>Barang Menipis</span><strong>${state.products.filter(p=>p.stock<=p.minStock).length} Item</strong></div></div>
      <div class="dp-profit-formula">Rumus Profit: <b>OMZET (${money(sales).replace('Rp','').trim()}) - MODAL (${money(modal).replace('Rp','').trim()}) = TOTAL PROFIT ${money(profit).replace('Rp','').trim()}</b></div>
      <section class="dp-card"><div class="dp-month-head"><div class="dp-card-title" style="margin:0"><h2>📊 Statistik Penjualan Bulanan</h2></div><label style="display:flex;align-items:center;gap:6px;font-size:9px">Bulan: <input class="dp-input" style="width:145px;min-height:30px" value="${monthLabel()}" readonly></label></div>
        <div class="dp-month-stats"><div class="dp-stat"><span>🧮 Omzet Bulan Ini</span><strong>${money(monthSales)}</strong></div><div class="dp-stat green"><span>📈 Profit Bersih</span><strong>${money(monthProfit)}</strong></div><div class="dp-stat"><span>🧾 Total Transaksi</span><strong>${monthTrx} Transaksi</strong></div></div>
        <div class="dp-best-item dp-stat"><span>🔥 Penjualan Item Terbesar</span><strong style="font-size:11px">Gula · ${money(342250)}</strong></div>
        <div class="dp-top-list"><div class="dp-top-title"><div><strong>🏆 5 Item Terlaris ${monthLabel()}</strong><div style="font-size:8px;color:#64748b;margin-top:2px">Berdasarkan nominal penjualan terbesar</div></div><span class="dp-chip blue">5</span></div>${top.map((x,i)=>`<div class="dp-top-row" style="--bar:${x[3]}%"><div><strong>${i+1}. ${esc(x[0])}</strong><small style="display:block;color:#64748b;margin-top:2px">${String(x[1]).replace('.',',')} ${i===1?'Kg':'Kg'} terjual</small></div><strong>${money(x[2])}</strong></div>`).join("")}</div>
        <div class="dp-chart"><svg viewBox="0 0 1008 110" preserveAspectRatio="none" aria-label="Grafik penjualan contoh">${[20,40,60,80,100].map(y=>`<line class="grid" x1="0" x2="1008" y1="${y}" y2="${y}"></line>`).join("")}<polygon class="line" points="${polygon}"></polygon><polyline class="line" fill="none" points="${points}"></polyline></svg></div>
      </section>
    </div>`;
  }

  function renderKasir(state,profile){
    const cart=state.cart||[];const subtotal=cart.reduce((s,r)=>s+Number(r.price||0)*Number(r.qty||0),0);const discount=Number(state.demoDiscount||0);const total=Math.max(0,subtotal-discount);const cash=Number(state.demoCash||0);const change=Math.max(0,cash-total);
    return `<div class="dp-page">
      ${brandHeader("Transaksi",`<button type="button" class="dp-header-btn gray" data-demo-limited="Shortcut keyboard">F2/F4: Cari | F8: Bayar</button>`)}
      ${demoNote()}
      <div class="dp-pos-layout">
        <section class="dp-card"><div class="dp-pos-search"><div><label class="dp-label">Pilih Barang / Scan Barcode</label><input id="demoProductSearch" class="dp-input" placeholder="Nama / Barcode barang..."></div><button class="dp-btn blue" type="button" data-demo-limited="Kamera scanner">📷</button><div class="dp-qty-field"><label class="dp-label">Jumlah / Berat</label><input id="demoQty" class="dp-input" type="number" min="0.25" step="0.25" value="1"></div></div>
          <div class="dp-product-suggest">${state.products.slice(0,6).map(p=>`<button type="button" data-demo-select-product="${esc(p.id)}">${esc(p.name)} · ${money(p.price)}</button>`).join("")}</div>
          <div class="dp-pos-qty-grid"><button class="dp-mini-key" type="button" data-demo-qty="0.25">¼ (0.25)</button><button class="dp-mini-key" type="button" data-demo-qty="0.5">½ (0.5)</button><button class="dp-mini-key" type="button" data-demo-qty="1">1</button><button class="dp-mini-key" type="button" data-demo-qty="2">2</button></div>
          <button class="dp-btn dp-add-cart" id="demoAddSelectedBtn" type="button">+ Tambah ke Keranjang</button>
          <div class="dp-cart-box"><div class="dp-cart-title"><span>KERANJANG BELANJA</span><button type="button" id="demoClearCartBtn" style="border:0;background:transparent;color:#ef4444;font-size:9px;font-weight:900">[Kosongkan]</button></div><div class="dp-cart-list">${cart.length?cart.map(r=>`<div class="dp-cart-row"><div><strong>${esc(r.name)}</strong><small> × ${r.qty}</small></div><strong>${money(r.price*r.qty)}</strong></div>`).join(""):`<div style="padding:22px;text-align:center;color:#94a3b8;font-size:9px">Keranjang kosong</div>`}</div><div class="dp-hold-row"><button class="dp-btn yellow" type="button" data-demo-limited="Hold transaksi">▣ Hold Transaksi</button><button class="dp-btn purple" type="button" data-demo-limited="Transaksi Hold">▣ Transaksi Hold (0)</button></div><div style="margin-top:7px;color:#64748b;font-size:8px">💾 Draft transaksi tersimpan otomatis pada sesi Demo</div></div>
        </section>
        <section class="dp-card dp-pos-summary"><div class="dp-subtotal-line"><span>Subtotal Barang:</span><strong>${money(subtotal)}</strong></div><label class="dp-label">Diskon Transaksi (Rp / %)</label><input class="dp-input" id="demoDiscountInput" placeholder="Contoh: 5000 atau 10%" value="${discount||''}">
          <div class="dp-total-box"><span>Total Tagihan</span><strong>${money(total)}</strong></div><label class="dp-label">Uang Diterima (Tunai)</label><input class="dp-input" id="demoCashReceived" placeholder="Ketik nominal..." value="${cash||''}">
          <div class="dp-change"><span>Estimasi Kembalian:</span><strong>${money(change)}</strong></div><div class="dp-cash-shortcuts"><button class="dp-mini-key" data-demo-cash="exact">Uang Pas</button><button class="dp-mini-key" data-demo-cash="1000">+1rb</button><button class="dp-mini-key" data-demo-cash="5000">+5rb</button><button class="dp-mini-key" data-demo-cash="20000">+20rb</button><button class="dp-mini-key" data-demo-cash="50000">+50rb</button><button class="dp-mini-key" data-demo-cash="100000">+100rb</button></div>
          <select id="demoPaymentMethod" hidden><option>Tunai</option><option>QRIS</option></select><div class="dp-pay-row"><button class="dp-btn yellow" id="demoCheckoutBtn" type="button" data-demo-pay="Tunai" ${!cart.length?'disabled':''}>💵 TUNAI</button><button class="dp-btn blue" type="button" data-demo-pay="QRIS" ${!cart.length?'disabled':''}>📱 NON TUNAI</button></div>
        </section>
      </div>
    </div>`;
  }

  function renderBarang(state,profile){
    const editable=profile.role!=="kasir";
    return `<div class="dp-page">
      ${brandHeader("Data Barang",`<button type="button" class="dp-header-btn green" data-demo-limited="Cetak Label Price">🏷️ Cetak Label Price</button>`)}
      ${demoNote()}
      <div class="dp-products-layout"><section class="dp-card dp-product-form"><div class="dp-card-title"><h2>+ TAMBAH BARANG BARU</h2></div><label class="dp-label">Kode Barcode</label><input id="demoNewBarcode" class="dp-input" placeholder="Scan / Ketik Barcode..."><label class="dp-label">Nama Barang</label><input id="demoNewName" class="dp-input" placeholder="Contoh: Indomie Goreng"><label class="dp-label">Kategori Produk</label><select id="demoNewCategory" class="dp-select"><option>Sembako</option><option>Frozen Food</option><option>Minuman</option><option>Makanan</option></select><label class="dp-label">Jumlah Stok Awal</label><input id="demoNewStock" class="dp-input" type="number" placeholder="Contoh: 50"><label class="dp-label">Satuan Dasar / Stok / Kasir</label><select id="demoNewUnit" class="dp-select"><option>Pcs</option><option>Kg</option><option>Liter</option><option>Bungkus</option></select><label class="dp-label">Harga Beli per Satuan Dasar</label><input id="demoNewBuy" class="dp-input" type="number" placeholder="Contoh: 2800"><label class="dp-label">Harga Jual (ke Konsumen)</label><input id="demoNewSell" class="dp-input" type="number" placeholder="Contoh: 3500"><button class="dp-btn" style="width:100%" id="demoAddProductBtn" type="button" ${editable?'':'disabled'}>+ SIMPAN BARANG</button></section>
      <section class="dp-product-list-area"><div class="dp-search-row"><input class="dp-input" id="demoInventorySearch" placeholder="🔍 Cari nama / barcode / kategori..."><button class="dp-btn blue" type="button" data-demo-limited="Scan barcode">▣ Scan</button></div><div class="dp-products-grid">${state.products.map(p=>`<article class="dp-product-card ${p.stock>p.minStock?'safe':''}" data-demo-product-card data-product-search="${esc((p.name+' '+p.barcode+' '+(p.category||'')).toLowerCase())}"><div class="dp-product-head"><strong>${p.stock<=p.minStock?'⚠️ ':''}${esc(p.name)}</strong><span class="dp-chip ${p.stock<=0?'red':p.stock<=p.minStock?'red':'green'}">${lowLabel(p)}</span></div><div style="font-size:8px;color:#64748b;margin-bottom:7px">Barcode: ${esc(p.barcode||'-')} <span style="float:right" class="dp-chip">${esc(p.category||'Sembako')}</span></div><div class="dp-product-meta"><div>Harga Beli<b>${money(p.purchasePrice||Math.round(p.price*.82))}</b></div><div>Harga Normal<b>${money(p.price)}</b></div></div><div class="dp-margin">Margin Keuntungan: +${money(calcProductMargin(p))} / ${esc(p.unit||'Pcs')}</div><div class="dp-product-buttons"><button class="promo" type="button" data-demo-limited="Promo Barang">🏷 Promo</button><button class="edit" type="button" data-stock="${esc(p.id)}" data-delta="1" ${editable?'':'disabled'}>✏ Edit</button><button class="delete" type="button" data-demo-delete-product="${esc(p.id)}" ${editable?'':'disabled'}>🗑 Hapus</button></div></article>`).join("")}</div></section></div>
    </div>`;
  }

  function renderLaporan(state,profile){
    const tx=visibleTransactions(state,profile).slice().sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const today=shiftDate(0);
    const from=state.reportFrom||today;
    const to=state.reportTo||today;
    const search=String(state.reportSearch||"").trim().toLowerCase();
    const filtered=tx.filter(x=>x.date>=from&&x.date<=to&&(!search||`${x.id} ${x.date} ${x.time} ${x.cashier} ${x.method}`.toLowerCase().includes(search)));
    const total=filtered.reduce((sum,x)=>sum+Number(x.total||0),0);
    const pageSize=8;
    const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
    const page=Math.max(1,Math.min(Number(state.reportPage||1),pageCount));
    if(page!==state.reportPage){state.reportPage=page;save(state);}
    const rows=filtered.slice((page-1)*pageSize,page*pageSize);
    const pageButtons=Array.from({length:pageCount},(_,i)=>i+1).slice(0,5).map(n=>`<button type="button" class="${n===page?'active':''}" data-demo-report-page="${n}">${n}</button>`).join("");
    return `<div class="dp-page">
      ${brandHeader("Riwayat Transaksi",`<button type="button" class="dp-header-btn gray" data-demo-limited="Ganti Password">🔑 Ganti Password</button><button type="button" class="dp-header-btn gray" data-demo-limited="Pengaturan Struk">🧾 Pengaturan Struk</button>`)}
      ${demoNote()}<div class="dp-report-mode">👑 Mode ${roleLabel(profile.role)}: akses laporan ${profile.scope==='network'?'penuh':'sesuai cabang'}. Data pendapatan di bawah merupakan data latihan Demo dan berbeda dari data production.</div>
      <div class="dp-report-summary"><div class="dp-stat"><span>Penjualan Bersih Demo</span><strong>${money(total)}</strong><small>${idDate(from)} s.d. ${idDate(to)}</small></div><div class="dp-stat"><span>Jumlah Transaksi Demo</span><strong>${filtered.length} TRX</strong><small>${search?'Hasil pencarian aktif':'Sesuai rentang tanggal'}</small></div></div>
      <section class="dp-card"><div class="dp-report-controls"><div class="dp-card-title" style="margin:0"><h2>Riwayat Transaksi Demo</h2></div><div class="dp-report-actions"><button class="dp-btn green" data-demo-limited="Export CSV">📄 Export Tampilan CSV</button><button class="dp-btn green" data-demo-limited="Download Semua Laporan">📁 Download Semua Laporan</button><button class="dp-btn red" data-demo-report-reset>Reset Filter</button></div></div>
      <div class="dp-date-grid"><div><label class="dp-label">Dari Tanggal:</label><input id="demoReportFrom" class="dp-input" type="date" value="${esc(from)}"></div><div><label class="dp-label">Sampai Tanggal:</label><input id="demoReportTo" class="dp-input" type="date" value="${esc(to)}"></div></div>
      <div class="dp-quick-dates"><button class="dp-btn green" data-demo-report-range="today">Hari Ini</button><button class="dp-btn green" data-demo-report-range="yesterday">Kemarin</button><button class="dp-btn green" data-demo-report-range="7">7 Hari</button><button class="dp-btn green" data-demo-report-range="30">30 Hari</button></div>
      <div class="dp-info-line">Laporan Demo memakai transaksi latihan sendiri. Nilai pendapatan sengaja berbeda dari contoh production dan berubah mengikuti filter tanggal, akun, serta transaksi Demo.</div>
      <input id="demoReportSearch" class="dp-input dp-search-report" value="${esc(state.reportSearch||'')}" placeholder="🔍 Cari ID transaksi, tanggal, kasir, metode bayar...">
      <div class="dp-table-wrap"><table class="dp-table"><thead><tr><th>ID Transaksi</th><th>Waktu</th><th>Kasir</th><th>Total</th><th>Bayar</th><th>Aksi</th></tr></thead><tbody>${rows.map(x=>`<tr data-demo-report-row data-search="${esc((x.id+' '+x.cashier+' '+x.method).toLowerCase())}"><td><span class="dp-chip blue">${esc(x.id)}</span></td><td>${esc(x.date)} ${esc(x.time)}</td><td><strong style="color:#0284c7">${esc(x.cashier)}</strong></td><td><strong>${money(x.total)}</strong></td><td><span class="dp-chip ${String(x.method).toLowerCase().includes('tunai')&&!String(x.method).toLowerCase().includes('non')?'green':'blue'}">${esc(x.method)}</span></td><td><button class="dp-btn soft" data-demo-limited="Detail transaksi">Lihat Detail ➜</button></td></tr>`).join("")||`<tr><td colspan="6" class="dp-empty-row">Tidak ada transaksi Demo pada filter ini.</td></tr>`}</tbody></table></div>
      <div class="dp-pagination"><button type="button" data-demo-report-page="${page-1}" ${page<=1?'disabled':''}>‹ Prev</button>${pageButtons}<button type="button" data-demo-report-page="${page+1}" ${page>=pageCount?'disabled':''}>Next ›</button></div></section>
    </div>`;
  }

  function renderAbsensi(state,profile){
    const today=shiftDate(0),schedule=scheduleFor(state,profile.employeeId,today),att=attendanceFor(state,profile.employeeId,today);const employees=visibleEmployees(state,profile).slice(0,4);const primaryOptional=profile.id==='owner-pusat'&&!schedule;
    const detail=schedule?`${workStatusLabel(schedule.status)} · ${shiftLabel(schedule.shift)} · ${schedule.start}-${schedule.end}`:primaryOptional?'Owner Pusat: jadwal hari ini opsional. Pilih shift secara manual bila ingin melakukan presensi.':'Jadwal belum diatur.';
    return `<div class="dp-page">
      ${brandHeader("Absensi",`<button type="button" class="dp-header-btn red" data-demo-exit>🚪 Log out</button>`)}${demoNote()}
      <section class="dp-card dp-att-date"><div><span class="dp-label">🗓️ Tanggal & Waktu Presensi</span><strong>${esc(todayLong())}</strong></div><div class="dp-time-badge">${esc(timeNow())} WITA</div></section>
      <div class="dp-section-label">📌 Status Absensi Akun Karyawan Hari Ini</div><div class="dp-employee-status">${employees.map(e=>{const a=attendanceFor(state,e.id,today);return `<div class="dp-employee-box"><div><strong>👤 ${esc(e.name.replace(' Demo',''))}</strong><small>${a?.checkIn?'Masuk '+a.checkIn:'Belum ada presensi'}</small></div><span class="dp-chip ${a?.checkIn?'green':'orange'}">${a?.checkIn?'SUDAH ABSEN':'BELUM ABSEN'}</span></div>`;}).join("")}</div>
      <div class="dp-att-actions"><button class="dp-btn soft" data-demo-limited="Pemeriksaan & Riwayat Absensi">📊 Pemeriksaan & Riwayat Absensi</button>${profile.role==='owner'?'<button class="dp-btn soft" data-go="master-shift">🗓️ Master Shift →</button>':''}<button class="dp-btn soft" data-go="ketidakhadiran">📋 Ketidakhadiran →</button></div>
      <div class="dp-att-main"><section class="dp-card"><div class="dp-card-title"><h2>✍️ Form Presensi Masuk / Keluar</h2></div><div class="dp-info-line">${esc(detail)}</div><label class="dp-label">Pilih Akun / Karyawan</label><select class="dp-select" disabled><option>${esc(profile.name.replace(' Demo',''))}</option></select><label class="dp-label" style="margin-top:9px">Jenis Presensi</label><select class="dp-select" id="demoAttendanceKind"><option>Absen Masuk</option><option>Absen Keluar</option></select><label class="dp-label" style="margin-top:9px">Pilihan Shift Kerja</label><select class="dp-select" id="demoAttendanceShift"><option value="SHIFT_1">Shift 1 (Pagi - Siang)</option><option value="SHIFT_2">Shift 2 (Siang - Malam)</option><option value="FULL_DAY">Full Day</option></select><label class="dp-label" style="margin-top:9px">📷 Foto Selfie di Tempat <span style="color:#ef4444">*Wajib</span></label><button class="dp-btn dp-camera" type="button" data-demo-limited="Kamera Selfie">📷 Buka Kamera Selfie</button><label class="dp-label" style="margin-top:9px">Catatan / Keterangan Tambahan (Opsional)</label><input class="dp-input" placeholder="Misal: Datang tepat waktu / Keterangan Dokter"><button class="dp-btn green dp-submit-wide" id="demoCheckInBtn" type="button">📌 Simpan Absen Masuk Hari Ini</button><button class="dp-btn dp-submit-wide" id="demoCheckOutBtn" type="button" style="margin-top:6px">📍 Simpan Absen Keluar Hari Ini</button></section>
      <section class="dp-card"><div class="dp-att-log-head"><div class="dp-card-title" style="margin:0"><h2>📋 Log Presensi Akun Ini</h2></div><span style="font-size:8px;color:#64748b">${state.attendance.filter(a=>a.employeeId===profile.employeeId).length} Data Presensi (${esc(profile.name.replace(' Demo',''))})</span></div><div class="dp-table-wrap"><table class="dp-table"><thead><tr><th>Waktu</th><th>Akun</th><th>Jenis</th><th>Shift</th><th>Bukti Foto / Surat</th><th>Aksi</th></tr></thead><tbody>${state.attendance.filter(a=>a.employeeId===profile.employeeId).map(a=>`<tr><td>${esc(a.workDate)} ${esc(a.checkIn||'')}</td><td>${esc(profile.name.replace(' Demo',''))}</td><td>${a.checkOut?'Masuk & Keluar':'Masuk'}</td><td>${esc(shiftLabel(a.shift))}</td><td>Foto Demo</td><td><button class="dp-btn soft" data-demo-limited="Detail presensi">Lihat</button></td></tr>`).join("")||`<tr><td colspan="6" class="dp-empty-row">Belum ada log presensi hari ini untuk akun ${esc(profile.name.replace(' Demo',''))}.</td></tr>`}</tbody></table></div></section></div>
    </div>`;
  }

  function renderMasterShift(state,profile){
    if(profile.role!=="owner")return `<div class="wf-shell"><header class="wf-hero"><div class="wf-hero-main"><div class="wf-hero-copy"><h1>🗓️ Master Shift</h1><p>Halaman ini khusus Owner.</p></div></div></header><section class="wf-card"><div class="wf-empty">Akun Demo ini tidak memiliki akses Master Shift.</div></section></div>`;
    const emps=visibleEmployees(state,profile),selected=state.masterEmployeeId&&emps.some(e=>e.id===state.masterEmployeeId)?state.masterEmployeeId:(emps[0]?.id||"");state.masterEmployeeId=selected;save(state);const emp=employeeById(state,selected);const now=new Date(),year=now.getFullYear(),month=now.getMonth();const rows=state.schedules.filter(s=>s.employeeId===selected&&new Date(s.workDate+'T12:00:00').getMonth()===month);const work=rows.filter(r=>r.status==='WORK').length,off=rows.filter(r=>r.status==='OFF').length,leave=rows.filter(r=>r.status==='ANNUAL_LEAVE').length;
    return `<div class="wf-shell"><header class="wf-hero"><div class="wf-hero-main"><div class="wf-hero-copy"><h1>🗓️ Master Shift</h1><p>Atur jadwal kerja bulanan, jam masuk-keluar, hari libur, dan cuti tahunan dari satu halaman.</p></div></div><div class="wf-hero-actions"><span class="wf-pill">🔒 Owner Only</span><button class="wf-link-btn soft" type="button" data-go="absensi">← Absensi</button></div></header>${demoNote().replace('dp-demo-note','dp-demo-note dp-demo-workforce-note')}
      <section class="wf-card"><div class="wf-card-head"><div><h2>Pilih Jadwal</h2><p>Tentukan cabang, bulan, dan akun. Owner Cabang hanya melihat cabangnya sendiri.</p></div><button class="wf-btn soft" type="button" data-demo-limited="Muat Ulang Master Shift">↻ Muat Ulang</button></div><div class="wf-grid"><div class="wf-field wf-col-4"><label>Cabang</label><select><option>${esc(storeLabel(profile.storeCode))} · Pusat</option></select></div><div class="wf-field wf-col-4"><label>Bulan</label><input type="month" value="${year}-${pad(month+1)}"></div><div class="wf-field wf-col-4"><label>Akun Karyawan</label><select id="demoMasterEmployee">${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===selected?'selected':''}>${esc(e.name.replace(' Demo',''))} · ${esc(roleLabel(e.role))}</option>`).join("")}</select></div></div></section>
      <section class="wf-stats"><div class="wf-stat"><span>Hari Kerja</span><strong>${work}</strong></div><div class="wf-stat"><span>Hari Libur</span><strong>${off}</strong></div><div class="wf-stat"><span>Cuti Bulan Ini</span><strong>${leave}</strong></div><div class="wf-stat"><span>Hak Cuti Tahunan</span><strong>${Number(emp?.annualLeave||0)}</strong></div><div class="wf-stat"><span>Sisa Cuti</span><strong>${Math.max(0,Number(emp?.annualLeave||0)-leave)}</strong></div></section>
      <div class="wf-layout-2"><section class="wf-card"><div class="wf-card-head"><div><h2>Template Cepat</h2><p>Atur pola umum sekali, lalu terapkan ke seluruh bulan.</p></div></div><div class="wf-field"><label>Hari kerja</label><div class="wf-weekdays">${['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map((d,i)=>`<label class="wf-weekday"><input type="checkbox" ${i<6?'checked':''}> ${d}</label>`).join("")}</div></div><div class="wf-grid" style="margin-top:10px"><div class="wf-field wf-col-6"><label>Shift</label><select id="demoMasterShift"><option value="SHIFT_1">Shift 1</option><option value="SHIFT_2">Shift 2</option><option value="FULL_DAY">Full Day</option></select></div><div class="wf-field wf-col-6"><label>Toleransi terlambat</label><input type="number" value="30"></div><div class="wf-field wf-col-6"><label>Jam masuk</label><input id="demoMasterStart" type="time" value="08:00"></div><div class="wf-field wf-col-6"><label>Jam keluar</label><input id="demoMasterEnd" type="time" value="16:00"></div></div><div class="wf-actions" style="margin-top:12px"><button class="wf-btn primary" type="button" id="demoApplyMonthBtn">Terapkan ke Bulan</button></div></section>
      <section class="wf-card"><div class="wf-card-head"><div><h2>Hak Cuti Tahunan</h2><p>Hak cuti mengikuti tahun pada bulan yang sedang dipilih.</p></div></div><div class="wf-grid"><div class="wf-field wf-col-6"><label>Hak cuti / tahun</label><input id="demoAnnualLeave" type="number" min="0" max="366" value="${Number(emp?.annualLeave||0)}"></div><div class="wf-field wf-col-6"><label>Tahun</label><input type="text" readonly value="${year}"></div><div class="wf-col-12"><div class="wf-notice">Hak ${Number(emp?.annualLeave||0)} hari · terpakai ${leave} hari · sisa ${Math.max(0,Number(emp?.annualLeave||0)-leave)} hari.</div></div></div><div class="wf-actions" style="margin-top:12px"><button class="wf-btn soft" type="button" id="demoSaveLeaveBtn">Simpan Hak Cuti</button></div><div class="wf-divider"></div><div class="wf-notice">Owner Pusat boleh membiarkan jadwal akunnya sendiri kosong. Akun lain tetap wajib memiliki jadwal lengkap untuk setiap tanggal dalam bulan.</div></section></div>
      <section class="wf-card"><div class="wf-card-head"><div><h2>Jadwal Bulanan</h2><p>Setelah template diterapkan, cukup ubah tanggal yang berbeda menjadi Libur, Cuti Tahunan, atau shift lain.</p></div><div class="wf-actions"><button class="wf-btn danger" type="button" data-demo-limited="Kosongkan Jadwal">Kosongkan Jadwal Owner Pusat</button><button class="wf-btn primary" type="button" id="demoSaveScheduleBtn">💾 Simpan Jadwal Bulan</button></div></div><div class="wf-notice warning">${rows.length?'Jadwal contoh tersedia untuk bulan ini.':'Belum ada jadwal. Gunakan Template Cepat untuk membuat jadwal satu bulan.'}</div><div class="wf-table-wrap" style="margin-top:12px"><table class="wf-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Shift</th><th>Jam Kerja</th><th>Catatan</th></tr></thead><tbody>${rows.length?rows.slice(0,12).map(r=>`<tr><td>${esc(idDate(r.workDate))}</td><td>${esc(workStatusLabel(r.status))}</td><td>${esc(shiftLabel(r.shift))}</td><td>${esc(r.start)} - ${esc(r.end)}</td><td>${esc(r.note||'Jadwal Demo')}</td></tr>`).join(""):`<tr><td colspan="5">Belum ada jadwal.</td></tr>`}</tbody></table></div></section>
    </div>`;
  }

  function eligibleDates(state,profile){const dates=[shiftDate(-1),shiftDate(-2),shiftDate(-3)];return dates.filter(date=>{const sch=scheduleFor(state,profile.employeeId,date);return sch&&sch.status==="WORK"&&!attendanceFor(state,profile.employeeId,date)&&!absenceFor(state,profile.employeeId,date);});}
  function visibleAbsences(state,profile){return state.absences.filter(row=>profile.scope==="network"||row.storeCode===profile.storeCode);}
  function renderKetidakhadiran(state,profile){
    const owner=profile.role==='owner',eligible=eligibleDates(state,profile),own=state.absences.filter(x=>x.employeeId===profile.employeeId),inbox=owner?visibleAbsences(state,profile):[];const reviewed=inbox.filter(x=>x.status==='REVIEWED').length;
    return `<div class="wf-shell"><header class="wf-hero"><div class="wf-hero-main"><div class="wf-hero-copy"><h1>📋 Ketidakhadiran</h1><p>Jelaskan jadwal kerja yang terlewat. Hari Libur dan Cuti Tahunan tidak dianggap sebagai ketidakhadiran.</p></div></div><div class="wf-hero-actions"><button class="wf-link-btn soft" type="button" data-go="absensi">← Absensi</button></div></header>${demoNote().replace('dp-demo-note','dp-demo-note dp-demo-workforce-note')}
      <section class="wf-stats"><div class="wf-stat"><span>Perlu Dijelaskan</span><strong>${eligible.length}</strong></div><div class="wf-stat"><span>Sudah Dikirim</span><strong>${own.filter(x=>x.status!=='REVIEWED').length}</strong></div><div class="wf-stat"><span>Sudah Ditinjau</span><strong>${reviewed}</strong></div><div class="wf-stat"><span>Role Aktif</span><strong>${esc(roleLabel(profile.role))}</strong></div><div class="wf-stat"><span>Cakupan</span><strong>${profile.scope==='network'?'Semua Cabang':'Cabang Ini'}</strong></div></section>
      <div class="wf-layout-2"><section class="wf-card"><div class="wf-card-head"><div><h2>Kirim Penjelasan</h2><p>Form hanya menampilkan tanggal kerja yang sudah melewati batas jam masuk tetapi belum mempunyai Absen Masuk, izin, atau sakit.</p></div></div>${eligible.length?`<div class="wf-field"><label>Tanggal kerja</label><select id="demoAbsenceDate">${eligible.map(d=>`<option>${d}</option>`).join("")}</select></div><div class="wf-field" style="margin-top:10px"><label>Jenis ketidakhadiran</label><select id="demoAbsenceCategory">${Object.entries(CATEGORIES).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></div><div class="wf-field" style="margin-top:10px"><label>Penjelasan</label><textarea id="demoAbsenceReason" placeholder="Jelaskan kejadian dengan jelas, minimal 10 karakter."></textarea></div><div class="wf-actions" style="margin-top:12px"><button id="demoSubmitAbsenceBtn" class="wf-btn primary" type="button">Kirim ke Owner</button></div>`:`<div class="wf-empty">Tidak ada tanggal kerja terlewat yang perlu dijelaskan. Hari libur dan cuti tidak dimasukkan.</div>`}</section><section class="wf-card"><div class="wf-card-head"><div><h2>Riwayat Saya</h2><p>Pengajuan tidak mengubah status menjadi hadir. Ini tetap menjadi catatan pertanggungjawaban untuk ditinjau Owner.</p></div></div><div class="wf-list">${own.length?own.map(x=>`<div class="wf-item"><div class="wf-item-head"><div><h3>${esc(idDate(x.workDate))}</h3><small>${esc(CATEGORIES[x.category]||x.category)}</small></div><span class="wf-tag ${x.status==='REVIEWED'?'reviewed':''}">${x.status==='REVIEWED'?'Ditinjau':'Dikirim'}</span></div><p>${esc(x.reason)}</p></div>`).join(""):`<div class="wf-empty">Belum ada pengajuan ketidakhadiran.</div>`}</div></section></div>
      ${owner?`<section class="wf-card"><div class="wf-card-head"><div><h2>📥 Tinjauan Ketidakhadiran</h2><p>Owner Cabang hanya melihat akun cabangnya. Owner Pusat dapat melihat seluruh cabang dalam network.</p></div><span class="wf-tag">Owner Only</span></div><div class="wf-grid"><div class="wf-field wf-col-4"><label>Cabang</label><select><option>${profile.scope==='network'?'Semua Cabang':esc(storeLabel(profile.storeCode))}</option></select></div><div class="wf-col-8 wf-actions end"><button class="wf-btn soft" type="button" data-demo-limited="Muat Ulang Ketidakhadiran">↻ Muat Ulang</button></div></div><div class="wf-list" style="margin-top:12px">${inbox.length?inbox.map(x=>{const e=employeeById(state,x.employeeId);return `<div class="wf-item"><div class="wf-item-head"><div><h3>${esc(e?.name||x.employeeId)} · ${esc(idDate(x.workDate))}</h3><small>${esc(storeLabel(x.storeCode))} · ${esc(CATEGORIES[x.category]||x.category)}</small></div><button class="wf-btn soft" data-review-absence="${esc(x.id)}" ${x.status==='REVIEWED'?'disabled':''}>${x.status==='REVIEWED'?'Sudah Ditinjau':'Tandai Ditinjau'}</button></div><p>${esc(x.reason)}</p></div>`;}).join(""):`<div class="wf-empty">Tidak ada pengajuan pada cakupan cabang ini.</div>`}</div></section>`:''}
    </div>`;
  }

  function renderSecurity(){return `<div class="dp-page">${brandHeader("Informasi Demo",`<button class="dp-header-btn red" data-demo-exit>Keluar Demo</button>`)}${demoNote()}<div class="dp-grid-3"><section class="dp-card"><h3>🧪 Data Latihan</h3><p>Transaksi, stok, absensi, jadwal, dan pengajuan pada Mode Demo tidak memengaruhi toko.</p></section><section class="dp-card"><h3>↻ Reset Kapan Saja</h3><p>Gunakan Management Akun untuk mengembalikan data contoh ke kondisi awal.</p></section><section class="dp-card"><h3>👥 Pilih Peran</h3><p>Ganti akun Demo untuk melihat perbedaan akses Owner Pusat, Owner Cabang, Admin, dan Kasir.</p></section><section class="dp-card"><h3>🧩 Parity Halaman</h3><p>Dashboard, Kasir, Barang, Laporan, Absensi, Master Shift, dan Ketidakhadiran mengikuti struktur visual production masing-masing.</p></section><section class="dp-card"><h3>ℹ️ Bukan 100%</h3><p>Tampilan dan fitur Demo tetap dapat disederhanakan atau dibatasi dan tidak mewakili 100% aplikasi sebenarnya.</p></section><section class="dp-card"><h3>🔒 Tindakan Dibatasi</h3><p>Fitur cloud, pembayaran, perangkat, dan tindakan berisiko tidak menjalankan operasi nyata.</p></section></div></div>`;}


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

    // Kasir parity
    document.querySelectorAll("[data-demo-select-product]").forEach(btn=>btn.addEventListener("click",()=>{state.demoSelectedProductId=btn.dataset.demoSelectProduct;const p=state.products.find(x=>x.id===state.demoSelectedProductId);const input=document.getElementById("demoProductSearch");if(input&&p)input.value=p.name;save(state);}));
    document.querySelectorAll("[data-demo-qty]").forEach(btn=>btn.addEventListener("click",()=>{const input=document.getElementById("demoQty");if(input)input.value=btn.dataset.demoQty;}));
    document.getElementById("demoAddSelectedBtn")?.addEventListener("click",()=>{const query=String(document.getElementById("demoProductSearch")?.value||"").trim().toLowerCase();let p=state.products.find(x=>x.id===state.demoSelectedProductId);if(!p&&query)p=state.products.find(x=>String(x.name).toLowerCase().includes(query)||String(x.barcode).toLowerCase()===query);if(!p){toast("Pilih barang terlebih dahulu.","warn");return;}const qty=Math.max(.25,Number(document.getElementById("demoQty")?.value)||1);if(Number(p.stock||0)<qty){toast(`Stok ${p.name} tidak cukup.`,"error");return;}let row=state.cart.find(x=>x.id===p.id);if(row){if(row.qty+qty>p.stock){toast("Jumlah keranjang melebihi stok Demo.","warn");return;}row.qty+=qty;}else state.cart.push({id:p.id,name:p.name,price:p.price,qty});save(state);render(state);});
    document.getElementById("demoClearCartBtn")?.addEventListener("click",()=>{state.cart=[];state.demoCash=0;state.demoDiscount=0;save(state);render(state);});
    document.getElementById("demoDiscountInput")?.addEventListener("change",e=>{const raw=String(e.target.value||"").trim();const subtotal=state.cart.reduce((s,r)=>s+r.price*r.qty,0);state.demoDiscount=raw.endsWith("%")?Math.round(subtotal*(Number(raw.slice(0,-1))||0)/100):Math.max(0,Number(raw)||0);save(state);render(state);});
    document.getElementById("demoCashReceived")?.addEventListener("change",e=>{state.demoCash=Math.max(0,Number(e.target.value)||0);save(state);render(state);});
    document.querySelectorAll("[data-demo-cash]").forEach(btn=>btn.addEventListener("click",()=>{const subtotal=state.cart.reduce((s,r)=>s+r.price*r.qty,0);const total=Math.max(0,subtotal-Number(state.demoDiscount||0));state.demoCash=btn.dataset.demoCash==="exact"?total:total+Number(btn.dataset.demoCash||0);save(state);render(state);}));
    const checkoutDemo=(method)=>{if(!state.cart.length)return;const subtotal=state.cart.reduce((s,x)=>s+x.price*x.qty,0),total=Math.max(0,subtotal-Number(state.demoDiscount||0));if(method==="Tunai"&&Number(state.demoCash||0)<total){toast("Uang diterima belum mencukupi total tagihan.","warn");return;}for(const row of state.cart){const p=state.products.find(x=>x.id===row.id);if(!p||row.qty>p.stock){toast(`Stok ${row.name} tidak cukup.`,"error");return;}}for(const row of state.cart){state.products.find(x=>x.id===row.id).stock-=row.qty;}state.transactions.unshift({id:`LDM-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,date:shiftDate(0),time:timeNow(),storeCode:profile.storeCode,cashier:profile.name.replace(" Demo",""),method,total,items:state.cart.reduce((s,x)=>s+x.qty,0)});state.cart=[];state.demoCash=0;state.demoDiscount=0;save(state);render(state);toast("Transaksi Demo berhasil disimpan.");};
    document.getElementById("demoCheckoutBtn")?.addEventListener("click",()=>checkoutDemo("Tunai"));
    document.querySelectorAll("[data-demo-pay]").forEach(btn=>{if(btn.id==="demoCheckoutBtn")return;btn.addEventListener("click",()=>checkoutDemo(btn.dataset.demoPay==="QRIS"?"QRIS":"Tunai"));});

    // Barang parity
    document.querySelectorAll("[data-stock]").forEach(btn=>btn.addEventListener("click",()=>{if(profile.role==="kasir")return;const p=state.products.find(x=>x.id===btn.dataset.stock);if(!p)return;p.stock=Math.max(0,Number(p.stock||0)+Number(btn.dataset.delta||0));save(state);render(state);toast("Data stok Demo diperbarui.");}));
    document.querySelectorAll("[data-demo-delete-product]").forEach(btn=>btn.addEventListener("click",()=>{if(profile.role==="kasir")return;const i=state.products.findIndex(x=>x.id===btn.dataset.demoDeleteProduct);if(i<0)return;state.products.splice(i,1);save(state);render(state);toast("Barang dihapus dari data Demo.","warn");}));
    document.getElementById("demoAddProductBtn")?.addEventListener("click",()=>{if(profile.role==="kasir")return;const name=String(document.getElementById("demoNewName")?.value||"").trim();if(!name){toast("Nama barang wajib diisi.","warn");return;}const sell=Math.max(0,Number(document.getElementById("demoNewSell")?.value)||0),buy=Math.max(0,Number(document.getElementById("demoNewBuy")?.value)||0),stock=Math.max(0,Number(document.getElementById("demoNewStock")?.value)||0);state.products.unshift({id:uid("PRD-DEMO"),barcode:String(document.getElementById("demoNewBarcode")?.value||"-").trim()||"-",name,purchasePrice:buy,price:sell,stock,minStock:Math.max(1,Math.ceil(stock*.15)),unit:document.getElementById("demoNewUnit")?.value||"Pcs",category:document.getElementById("demoNewCategory")?.value||"Sembako"});save(state);render(state);toast("Barang Demo berhasil ditambahkan.");});
    document.getElementById("demoInventorySearch")?.addEventListener("input",e=>{const q=String(e.target.value||"").toLowerCase();document.querySelectorAll("[data-demo-product-card]").forEach(card=>{card.style.display=!q||String(card.dataset.productSearch||"").includes(q)?"":"none";});});

    // Laporan parity
    document.getElementById("demoReportSearch")?.addEventListener("change",e=>{state.reportSearch=String(e.target.value||"");state.reportPage=1;save(state);render(state);});
    document.getElementById("demoReportFrom")?.addEventListener("change",e=>{state.reportFrom=e.target.value||shiftDate(0);if(state.reportTo<state.reportFrom)state.reportTo=state.reportFrom;state.reportPage=1;save(state);render(state);});
    document.getElementById("demoReportTo")?.addEventListener("change",e=>{state.reportTo=e.target.value||shiftDate(0);if(state.reportFrom>state.reportTo)state.reportFrom=state.reportTo;state.reportPage=1;save(state);render(state);});
    document.querySelectorAll("[data-demo-report-range]").forEach(btn=>btn.addEventListener("click",()=>{const kind=btn.dataset.demoReportRange;const today=shiftDate(0);if(kind==="today"){state.reportFrom=today;state.reportTo=today;}else if(kind==="yesterday"){state.reportFrom=shiftDate(-1);state.reportTo=shiftDate(-1);}else{const days=Math.max(1,Number(kind)||7);state.reportFrom=shiftDate(-(days-1));state.reportTo=today;}state.reportPage=1;save(state);render(state);}));
    document.querySelectorAll("[data-demo-report-page]").forEach(btn=>btn.addEventListener("click",()=>{if(btn.disabled)return;state.reportPage=Math.max(1,Number(btn.dataset.demoReportPage)||1);save(state);render(state);}));
    document.querySelector("[data-demo-report-reset]")?.addEventListener("click",()=>{state.reportFrom=shiftDate(0);state.reportTo=shiftDate(0);state.reportSearch="";state.reportPage=1;save(state);render(state);toast("Filter laporan Demo dikembalikan ke Hari Ini.");});

    // Absensi
    document.getElementById("demoCheckInBtn")?.addEventListener("click",()=>attendanceAction(state,profile,"in"));
    document.getElementById("demoCheckOutBtn")?.addEventListener("click",()=>attendanceAction(state,profile,"out"));

    // Master Shift parity
    document.getElementById("demoMasterEmployee")?.addEventListener("change",e=>{state.masterEmployeeId=e.target.value;save(state);render(state);});
    document.getElementById("demoApplyMonthBtn")?.addEventListener("click",()=>{const employeeId=document.getElementById("demoMasterEmployee")?.value,emp=employeeById(state,employeeId);if(!emp)return;if(profile.scope!=="network"&&emp.storeCode!==profile.storeCode){toast("Owner Cabang tidak boleh mengubah cabang lain.","error");return;}const d=new Date(),year=d.getFullYear(),month=d.getMonth(),days=new Date(year,month+1,0).getDate(),shift=document.getElementById("demoMasterShift")?.value||"SHIFT_1",start=document.getElementById("demoMasterStart")?.value||"08:00",end=document.getElementById("demoMasterEnd")?.value||"16:00";state.schedules=state.schedules.filter(r=>!(r.employeeId===employeeId&&new Date(r.workDate+'T12:00:00').getMonth()===month&&new Date(r.workDate+'T12:00:00').getFullYear()===year));for(let day=1;day<=days;day++){const wd=new Date(year,month,day).getDay(),workDate=`${year}-${pad(month+1)}-${pad(day)}`;state.schedules.push({employeeId,workDate,status:wd===0?"OFF":"WORK",shift,start,end,tolerance:30,note:wd===0?"Hari libur":"Template Demo"});}save(state);render(state);toast("Template jadwal Demo diterapkan ke bulan ini.");});
    document.getElementById("demoSaveScheduleBtn")?.addEventListener("click",()=>toast("Jadwal bulan tersimpan pada sesi Demo."));
    document.getElementById("demoSaveLeaveBtn")?.addEventListener("click",()=>{const emp=employeeById(state,document.getElementById("demoMasterEmployee")?.value);if(!emp)return;emp.annualLeave=Math.max(0,Math.min(366,Number(document.getElementById("demoAnnualLeave")?.value)||0));save(state);render(state);toast("Hak cuti Demo diperbarui.");});

    // Ketidakhadiran
    document.getElementById("demoSubmitAbsenceBtn")?.addEventListener("click",()=>{const workDate=document.getElementById("demoAbsenceDate")?.value,category=document.getElementById("demoAbsenceCategory")?.value,reason=String(document.getElementById("demoAbsenceReason")?.value||"").trim();if(!workDate||!CATEGORIES[category]){toast("Tanggal atau kategori tidak valid.","error");return;}if(reason.length<10){toast("Penjelasan minimal 10 karakter.","warn");return;}if(!eligibleDates(state,profile).includes(workDate)){toast("Tanggal tersebut tidak lagi memenuhi syarat Ketidakhadiran.","error");return;}state.absences.unshift({id:uid("ABS-DEMO"),employeeId:profile.employeeId,workDate,category,reason,storeCode:profile.storeCode,status:"SUBMITTED",submittedAt:`${shiftDate(0)} ${timeNow()}`,reviewNote:""});save(state);render(state);toast("Ketidakhadiran Demo berhasil dikirim.");});
    document.querySelectorAll("[data-review-absence]").forEach(btn=>btn.addEventListener("click",()=>{if(profile.role!=="owner")return;const row=state.absences.find(x=>x.id===btn.dataset.reviewAbsence);if(!row)return;if(profile.scope!=="network"&&row.storeCode!==profile.storeCode){toast("Owner Cabang tidak dapat meninjau cabang lain.","error");return;}row.status="REVIEWED";row.reviewNote=`Ditinjau oleh ${profile.name}`;save(state);render(state);toast("Pengajuan Demo ditandai sudah ditinjau.");}));

    // Dashboard inline mode
    const mode=document.getElementById("demoInlineModeSelect");if(mode){mode.value=state.storeMode||"retail";mode.addEventListener("change",e=>{state.storeMode=["cafe","warung","retail"].includes(e.target.value)?e.target.value:"retail";save(state);render(state);toast(`Mode operasional Demo diubah menjadi ${modeInfo(state.storeMode).label}.`);});}
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
    document.getElementById("demoRolePill")?.addEventListener("click",()=>openModal("demoAccountModal"));
    document.getElementById("demoLimitInfoBtn")?.addEventListener("click",()=>openModal("demoLimitModal"));
    document.getElementById("demoInstallBtn")?.addEventListener("click",()=>toast("Pemasangan aplikasi tidak dijalankan pada Mode Demo.","warn"));
    document.getElementById("demoInsightBtn")?.addEventListener("click",()=>toast("Insight lanjutan tersedia pada aplikasi berlisensi.","warn"));
    document.getElementById("demoResetBtn")?.addEventListener("click",()=>{state=reset();render(state);closeModal("demoAccountModal");toast("Data demo dikembalikan ke kondisi awal.");});

    document.addEventListener("click",e=>{
      const routeBtn=e.target.closest("[data-demo-route]");if(routeBtn){goRoute(routeBtn.dataset.demoRoute);return;}
      const limited=e.target.closest("[data-demo-limited]");if(limited){closeMega();toast(`${limited.dataset.demoLimited} dibatasi pada Mode Demo.`,"warn");return;}
      const action=e.target.closest("[data-demo-action='account']");if(action){closeMega();openModal("demoAccountModal");return;}
      if(e.target.closest("[data-demo-theme-open]")){openModal("demoThemeModal");return;}
      if(e.target.closest("[data-demo-limit-info]")){openModal("demoLimitModal");return;}
      if(e.target.closest("[data-demo-exit]")){exit();return;}
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

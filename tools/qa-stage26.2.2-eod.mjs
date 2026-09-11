import fs from 'node:fs';
import vm from 'node:vm';

const navJs=fs.readFileSync('js/global-system-navigation.js','utf8');
const failures=[];

function makeApi(){
    const data=new Map();
    const localStorage={
        getItem:key=>data.has(key)?data.get(key):null,
        setItem:(key,value)=>data.set(key,String(value)),
        removeItem:key=>data.delete(key),
        clear:()=>data.clear()
    };
    const fakeDocument={
        readyState:'loading',
        addEventListener(){},
        querySelectorAll(){return []},
        getElementById(){return null},
        createElement(){return {addEventListener(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}}},
        head:{appendChild(){}},
        documentElement:{dataset:{},style:{setProperty(){}},setAttribute(){},classList:{add(){},toggle(){}}},
        body:{classList:{toggle(){},remove(){},add(){}}},
        hidden:false
    };
    const fakeWindow={addEventListener(){},setInterval(){return 0},dispatchEvent(){}};
    const sandbox={
        window:fakeWindow,document:fakeDocument,localStorage,
        location:{pathname:'/dashboard.html'},matchMedia:()=>({matches:false}),
        CustomEvent:function(){},setTimeout(){},console,Date
    };
    vm.runInNewContext(navJs,sandbox,{filename:'global-system-navigation.js'});
    return {api:fakeWindow.LDMGlobalNavigation,localStorage};
}

const {api,localStorage}=makeApi();
if(!api)throw new Error('LDMGlobalNavigation tidak diekspor');
const now=new Date(Date.now()+8*60*60*1000);
const today=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;

function setRows(tx,closings){
    localStorage.setItem('laporan',JSON.stringify(tx.map(x=>({tanggal:today,...x}))));
    localStorage.setItem('shiftClosingLog',JSON.stringify(closings.map(x=>({tanggal:today,...x}))));
}
function expect(name,expected){
    const got=api.calculateEodReadiness();
    if(got.ready!==expected)failures.push(`${name}: expected ready=${expected}, got ${got.ready}; pending=${JSON.stringify(got.pendingClosings)}`);
}

setRows([],[]); expect('Tanpa transaksi',false);
setRows([{kasir:'A',shift:'Shift 1'}],[]); expect('Shift 1 transaksi belum closing',false);
setRows([{kasir:'A',shift:'Shift 1'}],[{kasir:'A',shift:'Shift 1'}]); expect('Hanya Shift 1 dipakai, sudah closing',true);
setRows([{kasir:'A',shift:'Shift 1'},{kasir:'B',shift:'Shift 2'}],[{kasir:'A',shift:'Shift 1'}]); expect('B Shift 2 masih pending',false);
setRows([{kasir:'A',shift:'Shift 1'},{kasir:'B',shift:'Shift 2'}],[{kasir:'A',shift:'Shift 1'},{kasir:'B',shift:'Shift 2'}]); expect('Dua akun dua shift lengkap',true);
setRows([{kasir:'C',shift:'Full Day'}],[{kasir:'C',shift:'Full Day'}]); expect('Full Day transaksi + closing',true);
setRows([{kasir:'A',shift:'Shift 1'},{kasir:'A',shift:'Shift 2'}],[{kasir:'A',shift:'Shift 1'}]); expect('A transaksi dua shift tapi baru satu closing',false);
setRows([{kasir:'A',shift:'Shift 1'},{kasir:'A',shift:'Shift 2'}],[{kasir:'A',shift:'Full Day'}]); expect('Full Day menutup kebutuhan dua shift akun sama',true);
setRows([{kasir:'A'}],[{kasir:'A',shift:'Shift 1'}]); expect('Transaksi legacy tanpa shift ditutup closing akun yang sama',true);

const htmlNames=['shift-closing.html','retur.html','absensi.html','pengeluaran.html','supplier.html','kasir.html','kartu-stok.html','goods.receipt.html','backup & restore.html','laporan.html','dashboard.html','Purchase-Order.html','eod.html','barang.html','stock-opname.html'];
for(const name of htmlNames){
    const text=fs.readFileSync(name,'utf8');
    if(text.includes('return allClosed && hasShift1 && hasShift2;')) failures.push(`${name}: gate lama masih ada`);
    if(text.includes('pendingAccounts.length===0\n                && hasShift1\n                && hasShift2')) failures.push(`${name}: calculateReadiness gate lama masih ada`);
}

if(failures.length){
    console.error(`QA 26.2.2 EOD: FAIL (${failures.length})`);
    failures.forEach(x=>console.error('- '+x));
    process.exit(1);
}
console.log('QA 26.2.2 EOD: PASS');

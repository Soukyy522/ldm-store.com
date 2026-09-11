import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../js/promo-pricing.js",import.meta.url),"utf8");
const context = {window:{},Intl,Date,Number,Math,Object,String,Boolean};
vm.createContext(context);
vm.runInContext(code,context);
const pricing = context.window.LDMPromoPricing;

function assert(condition,message){
    if(!condition) throw new Error(message);
}

const fixedProduct = {
    harga:3200,
    promo:{aktif:true,nama:"Paket Hemat",type:"fixed_price",value:3000,hargaPromo:3000,minQty:10}
};
assert(pricing.resolve(fixedProduct,9).unitPrice === 3200,"Qty di bawah minimum harus harga normal.");
assert(pricing.resolve(fixedProduct,10).unitPrice === 3000,"Qty minimum harus memakai harga promo.");

const percentProduct = {
    harga:20000,
    promo:{aktif:true,nama:"Diskon 10%",type:"percentage",value:10,minQty:1}
};
assert(pricing.resolve(percentProduct,1).unitPrice === 18000,"Diskon 10% salah.");
assert(pricing.resolve(percentProduct,2).totalDiscount === 4000,"Total potongan persen salah.");

const scheduled = {
    harga:10000,
    promo:{aktif:true,type:"fixed_price",value:8000,hargaPromo:8000,minQty:1,tglMulai:"2099-01-01"}
};
assert(pricing.resolve(scheduled,1,new Date("2026-08-29T04:00:00Z")).applied === false,"Promo masa depan tidak boleh aktif.");

const invalid = pricing.validate({aktif:true,type:"percentage",value:100,minQty:1},10000);
assert(invalid.valid === false,"Diskon 100% harus ditolak.");

console.log("TAHAP 21 QA: PASS");

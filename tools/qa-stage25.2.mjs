import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root,file),"utf8");
const failures = [];

function expect(file,pattern,message){
    const value = read(file);
    if(!pattern.test(value)) failures.push(`${file}: ${message}`);
}

function reject(file,pattern,message){
    const value = read(file);
    if(pattern.test(value)) failures.push(`${file}: ${message}`);
}

expect("barang.html",/requireRole\(\s*\[\s*"owner",\s*"admin",\s*"kasir"\s*\]\s*\)/s,"guard Kasir belum aktif");
expect("barang.html",/function requireOwnerBarangAction\(\)/,"guard aksi Owner tidak tersedia");
expect("barang.html",/role-kasir-readonly[\s\S]*action-buttons/,"kontrol mutasi Kasir belum disembunyikan");
expect("js/global-system-navigation.js",/barang\.html"[^\n]+roles:\["owner","admin","kasir"\]/,"menu Barang Kasir belum aktif");
expect("Purchase-Order.html",/admin:\s*\[\s*"purchaseorder\.view",\s*"purchaseorder\.create"\s*\]/s,"izin Admin PO tidak sesuai");
expect("goods.receipt.html",/admin:\s*\[\s*"goodsreceipt\.view",\s*"goodsreceipt\.create"\s*\]/s,"izin Admin GR tidak sesuai");
expect("Purchase-Order.html",/\.owner-purchase-value\s*\{\s*display:\s*none/s,"mask UI PO tidak tersedia");
expect("goods.receipt.html",/\.owner-purchase-value\s*\{\s*display:\s*none/s,"mask UI GR tidak tersedia");
expect("js/procurement-service.js",/ldm_save_purchase_order_role_safe/,"RPC PO aman belum dipakai");
expect("js/procurement-service.js",/ldm_submit_goods_receipt_role_safe/,"RPC GR aman belum dipakai");
expect("supabase/sql/21-stage25.2-role-access-procurement-mask.sql",/revoke execute on function public\.ldm_save_purchase_order[\s\S]+from authenticated/,"RPC PO lama belum ditutup");
expect("supabase/sql/21-stage25.2-role-access-procurement-mask.sql",/notify pgrst, 'reload schema'/,"reload schema belum tersedia");
reject("barang.html",/html\[data-ldm-role="kasir"\][^\n]+a\[href="barang\.html"\]/,"menu Barang masih disembunyikan untuk Kasir");

if(failures.length){
    console.error(`QA 25.2 GAGAL (${failures.length})`);
    failures.forEach(item => console.error(`- ${item}`));
    process.exit(1);
}

console.log("QA 25.2 LULUS: akses role, mask harga beli, RPC aman, dan navigasi sesuai.");

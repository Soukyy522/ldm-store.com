(function(){
    "use strict";

    const TYPE_FIXED = "fixed_price";
    const TYPE_PERCENT = "percentage";

    function number(value,fallback=0){
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function roundMoney(value){
        return Math.round(number(value,0) * 100) / 100;
    }

    function businessDateWITA(value){
        if(window.LDMLocalTime) return window.LDMLocalTime.dateKey(value);
        const date=value instanceof Date?value:new Date(value||Date.now());
        const pad=v=>String(v).padStart(2,"0");
        return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    }

    function normalize(promo,normalPrice=0){
        if(!promo || typeof promo !== "object") return null;

        const normal = Math.max(0,number(normalPrice,0));
        const type = promo.type === TYPE_PERCENT ? TYPE_PERCENT : TYPE_FIXED;
        const rawValue = number(
            promo.value,
            type === TYPE_PERCENT ? number(promo.persen,0) : number(promo.hargaPromo,0)
        );

        let promoPrice;
        if(type === TYPE_PERCENT){
            promoPrice = roundMoney(normal * (1 - rawValue / 100));
        }else{
            promoPrice = roundMoney(number(promo.hargaPromo,rawValue));
        }

        return {
            aktif:Boolean(promo.aktif),
            nama:String(promo.nama || promo.name || "Promo Produk").trim() || "Promo Produk",
            type,
            value:roundMoney(rawValue),
            hargaPromo:promoPrice,
            minQty:Math.max(1,number(promo.minQty,1)),
            tglMulai:String(promo.tglMulai || ""),
            tglSelesai:String(promo.tglSelesai || "")
        };
    }

    function validate(promo,normalPrice=0){
        const normalized = normalize(promo,normalPrice);
        const errors = [];
        const normal = Math.max(0,number(normalPrice,0));

        if(!normalized) return {valid:false,errors:["Data promo kosong."],promo:null};
        if(normal <= 0) errors.push("Harga normal harus lebih besar dari Rp0.");
        if(normalized.type === TYPE_PERCENT && (normalized.value <= 0 || normalized.value >= 100)){
            errors.push("Diskon persen harus lebih dari 0% dan kurang dari 100%.");
        }
        if(normalized.type === TYPE_FIXED && normalized.value <= 0){
            errors.push("Harga promo harus lebih besar dari Rp0.");
        }
        if(normalized.hargaPromo >= normal && normalized.aktif){
            errors.push("Harga promo harus lebih rendah daripada harga normal.");
        }
        if(normalized.tglMulai && normalized.tglSelesai && normalized.tglMulai > normalized.tglSelesai){
            errors.push("Tanggal selesai tidak boleh lebih awal daripada tanggal mulai.");
        }

        return {valid:errors.length === 0,errors,promo:normalized};
    }

    function isScheduled(promo,at=Date.now()){
        if(!promo || !promo.aktif) return false;
        const today = businessDateWITA(at);
        if(promo.tglMulai && today < promo.tglMulai) return false;
        if(promo.tglSelesai && today > promo.tglSelesai) return false;
        return true;
    }

    function resolve(product,qty=1,at=Date.now()){
        const normalPrice = Math.max(0,number(product && product.harga,0));
        const normalized = normalize(product && product.promo,normalPrice);
        const quantity = Math.max(0,number(qty,0));

        const base = {
            normalPrice,
            unitPrice:normalPrice,
            discountPerUnit:0,
            totalDiscount:0,
            applied:false,
            eligible:false,
            reason:"normal_price",
            promo:normalized,
            label:"Harga Normal"
        };

        if(!normalized || !normalized.aktif) return base;
        if(!isScheduled(normalized,at)) return {...base,reason:"outside_schedule"};
        if(quantity < normalized.minQty) return {...base,reason:"minimum_quantity"};

        const checked = validate(normalized,normalPrice);
        if(!checked.valid) return {...base,reason:"invalid_promo"};

        const unitPrice = Math.min(normalPrice,Math.max(0,checked.promo.hargaPromo));
        const discountPerUnit = roundMoney(normalPrice - unitPrice);

        return {
            ...base,
            unitPrice,
            discountPerUnit,
            totalDiscount:roundMoney(discountPerUnit * quantity),
            applied:unitPrice < normalPrice,
            eligible:true,
            reason:"promo_applied",
            promo:checked.promo,
            label:checked.promo.nama || "Promo Produk"
        };
    }

    function summary(promo,normalPrice=0){
        const normalized = normalize(promo,normalPrice);
        if(!normalized) return "Tidak ada promo";
        if(normalized.type === TYPE_PERCENT){
            return `${normalized.value.toLocaleString("id-ID")}% • Rp ${normalized.hargaPromo.toLocaleString("id-ID")}`;
        }
        return `Rp ${normalized.hargaPromo.toLocaleString("id-ID")}`;
    }

    window.LDMPromoPricing = Object.freeze({
        TYPE_FIXED,
        TYPE_PERCENT,
        businessDateWITA,
        normalize,
        validate,
        isScheduled,
        resolve,
        summary
    });
})();

(function(){
    "use strict";

    const UNITS = Object.freeze([
        "Pcs","Kg","Gram","Liter","Ml","Dus","Karton","Pak",
        "Bungkus","Botol","Sachet","Karung","Ikat","Kaleng","Lusin"
    ]);

    function text(value,fallback=""){
        const result = String(value == null ? "" : value).trim();
        return result || fallback;
    }

    function factor(value){
        const result = Number(value);
        return Number.isFinite(result) && result > 0 ? result : 1;
    }

    function baseUnit(product){
        return text(product && (product.satuanDasar || product.baseUnit || product.satuan),"Pcs");
    }

    function purchaseUnit(product){
        return text(product && (product.satuanBeli || product.purchaseUnit),baseUnit(product));
    }

    function purchaseFactor(product){
        return factor(product && (product.konversiBeli || product.purchaseUnitFactor));
    }

    function toBase(quantity,productOrFactor){
        const qty = Number(quantity || 0);
        const conversion = typeof productOrFactor === "object"
            ? purchaseFactor(productOrFactor)
            : factor(productOrFactor);
        return Math.round(qty * conversion * 1000) / 1000;
    }

    function fromBase(quantity,productOrFactor){
        const qty = Number(quantity || 0);
        const conversion = typeof productOrFactor === "object"
            ? purchaseFactor(productOrFactor)
            : factor(productOrFactor);
        return Math.round((qty / conversion) * 1000) / 1000;
    }

    function packagePrice(basePrice,productOrFactor){
        const price = Number(basePrice || 0);
        const conversion = typeof productOrFactor === "object"
            ? purchaseFactor(productOrFactor)
            : factor(productOrFactor);
        return Math.round(price * conversion * 100) / 100;
    }

    function basePrice(packageValue,productOrFactor){
        const price = Number(packageValue || 0);
        const conversion = typeof productOrFactor === "object"
            ? purchaseFactor(productOrFactor)
            : factor(productOrFactor);
        return Math.round((price / conversion) * 100) / 100;
    }

    function normalizeProduct(product={}){
        const dasar = baseUnit(product);
        const beli = purchaseUnit(product);
        const konversi = purchaseFactor(product);
        return {
            ...product,
            satuan:dasar,
            satuanDasar:dasar,
            satuanBeli:beli,
            konversiBeli:konversi
        };
    }

    function description(product){
        const normalized = normalizeProduct(product);
        return `1 ${normalized.satuanBeli} = ${normalized.konversiBeli} ${normalized.satuanDasar}`;
    }

    window.LDMUnits = Object.freeze({
        units:UNITS,
        factor,
        baseUnit,
        purchaseUnit,
        purchaseFactor,
        toBase,
        fromBase,
        packagePrice,
        basePrice,
        normalizeProduct,
        description
    });
})();

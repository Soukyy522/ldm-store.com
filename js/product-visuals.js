(function(){
    "use strict";

    const BUCKET = "ldm-product-images";
    const MAX_DIMENSION = 800;
    const WEBP_QUALITY = 0.80;
    const urlCache = new Map();

    function client(){
        if(!window.LDMSupabase || typeof window.LDMSupabase.createClient!=="function"){
            throw new Error("Supabase client belum tersedia.");
        }
        return window.LDMSupabase.createClient();
    }

    function storeId(){return String(localStorage.getItem("ldmCloudStoreId")||"").trim()}
    function productId(product){return String(product&&product.id||"").trim()}
    function imagePath(product){return String(product&&(
        product.imagePath||product.image_path||product._cloud?.imagePath||""
    )||"").trim()}

    function get(product){
        if(!product) return "";
        if(window.LDMStoreMode && !window.LDMStoreMode.supportsProductImages()) return "";
        const path=imagePath(product);
        if(!path) return "";
        if(urlCache.has(path)) return urlCache.get(path);
        try{
            const {data}=client().storage.from(BUCKET).getPublicUrl(path);
            const url=String(data&&data.publicUrl||"");
            if(url)urlCache.set(path,url);
            return url;
        }catch(error){
            console.warn("URL gambar produk gagal dibuat:",error);
            return "";
        }
    }

    function imageFromFile(file){
        return new Promise((resolve,reject)=>{
            const reader=new FileReader();
            reader.onerror=()=>reject(new Error("Gambar tidak dapat dibaca."));
            reader.onload=()=>{
                const img=new Image();
                img.onerror=()=>reject(new Error("Format gambar tidak didukung."));
                img.onload=()=>resolve(img);
                img.src=reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function compressFile(file){
        if(!file || !String(file.type||"").startsWith("image/")) throw new Error("Pilih gambar JPG, PNG, atau WebP.");
        if(file.size>8*1024*1024) throw new Error("Ukuran gambar terlalu besar. Maksimal 8 MB sebelum kompresi.");
        const image=await imageFromFile(file);
        const ratio=Math.min(1,MAX_DIMENSION/Math.max(image.width,image.height));
        const width=Math.max(1,Math.round(image.width*ratio));
        const height=Math.max(1,Math.round(image.height*ratio));
        const canvas=document.createElement("canvas");
        canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext("2d",{alpha:false});
        ctx.drawImage(image,0,0,width,height);
        return await new Promise((resolve,reject)=>{
            canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Gambar gagal dikompresi.")),"image/webp",WEBP_QUALITY);
        });
    }

    function randomPart(){return Math.random().toString(36).slice(2,9)}

    function patchLocalProductCache(product,path){
        try{
            const rows=JSON.parse(localStorage.getItem("dataBarang")||"[]");
            if(!Array.isArray(rows))return;
            const pid=productId(product);
            let changed=false;
            rows.forEach(row=>{
                if(String(row&&row.id||"")===pid){
                    row.imagePath=path||"";
                    row.image_path=path||"";
                    if(row._cloud)row._cloud.imagePath=path||"";
                    changed=true;
                }
            });
            if(changed)localStorage.setItem("dataBarang",JSON.stringify(rows));
        }catch(error){console.warn("Cache path gambar produk belum dapat diperbarui:",error)}
    }

    async function updateProductPath(product,path){
        const supabase=client();
        const {data,error}=await supabase.rpc("ldm_set_product_image",{
            p_product_id:productId(product),
            p_image_path:path||null
        });
        if(error)throw error;
        if(product){
            product.imagePath=path||"";
            product.image_path=path||"";
            if(product._cloud)product._cloud.imagePath=path||"";
        }
        patchLocalProductCache(product,path);
        return data;
    }

    async function setFromFile(product,file){
        if(window.LDMStoreMode && !window.LDMStoreMode.supportsProductImages()){
            throw new Error("Mode Toko Ritel tidak menggunakan gambar produk.");
        }
        const sid=storeId();const pid=productId(product);
        if(!sid||!pid)throw new Error("Store ID atau Product ID belum tersedia.");
        const blob=await compressFile(file);
        const path=`${sid}/${pid}/${Date.now()}-${randomPart()}.webp`;
        const oldPath=imagePath(product);
        const supabase=client();
        const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,blob,{
            contentType:"image/webp",cacheControl:"31536000",upsert:false
        });
        if(uploadError)throw uploadError;
        try{
            await updateProductPath(product,path);
        }catch(error){
            await supabase.storage.from(BUCKET).remove([path]).catch(()=>{});
            throw error;
        }
        if(oldPath && oldPath!==path){
            await supabase.storage.from(BUCKET).remove([oldPath]).catch(error=>console.warn("Gambar lama belum dapat dihapus:",error));
            urlCache.delete(oldPath);
        }
        urlCache.delete(path);
        window.dispatchEvent(new CustomEvent("ldm-product-visual-change",{detail:{productId:pid,path}}));
        return get(product);
    }

    async function remove(product){
        const oldPath=imagePath(product);
        await updateProductPath(product,null);
        if(oldPath){
            await client().storage.from(BUCKET).remove([oldPath]).catch(error=>console.warn("File gambar lama belum dapat dihapus:",error));
            urlCache.delete(oldPath);
        }
        window.dispatchEvent(new CustomEvent("ldm-product-visual-change",{detail:{productId:productId(product),removed:true}}));
        return true;
    }

    window.LDMProductVisuals=Object.freeze({BUCKET,get,remove,setFromFile,imagePath});
})();

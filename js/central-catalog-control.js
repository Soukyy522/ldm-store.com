(function(){
    "use strict";

    const byId=id=>document.getElementById(id);
    const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({
        "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    })[char]);
    const number=value=>Number(value||0).toLocaleString("id-ID");
    const date=value=>value
        ? new Date(value).toLocaleString("id-ID",{})
        : "Belum pernah";
    let busy=false;

    function setMessage(message,error=false){
        const node=byId("catalogControlStatus");
        if(!node)return;
        node.textContent=message;
        node.classList.toggle("error",Boolean(error));
    }

    function setBusy(value){
        busy=Boolean(value);
        const panel=byId("catalogControlPanel");
        if(panel)panel.classList.toggle("catalog-working",busy);
    }

    function render(data={}){
        const rows=Array.isArray(data.branches)?data.branches:[];
        byId("catalogPrimaryCount").textContent=number(data.primary_product_count);
        byId("catalogBranchCount").textContent=number(rows.length);
        byId("catalogAutoCount").textContent=number(rows.filter(row=>row.enabled).length);

        const body=byId("catalogBranchRows");
        body.innerHTML=rows.length?rows.map(row=>{
            const result=row.last_result||{};
            const detail=row.last_synced_at
                ? `Terakhir: ${date(row.last_synced_at)} · ${number(result.processed||0)} diproses`
                : "Belum pernah disinkronkan";
            return `<tr>
                <td><strong>${esc(row.store_name)}</strong><br><small>${esc(row.store_code)}</small></td>
                <td>${number(row.product_count)} barang<span class="catalog-sync-detail">${number(row.linked_count)} tertaut ke pusat</span></td>
                <td><span class="cc-badge ${row.enabled?"on":"off"}">${row.enabled?"OTOMATIS":"MANUAL"}</span><span class="catalog-sync-detail">${esc(detail)}</span></td>
                <td><label class="catalog-auto-control"><input type="checkbox" data-catalog-auto="${esc(row.store_id)}" ${row.enabled?"checked":""}> Ikuti pusat</label></td>
                <td><button class="cc-btn soft" data-catalog-sync="${esc(row.store_id)}">Sinkronkan sekarang</button></td>
            </tr>`;
        }).join(""):'<tr><td class="cc-empty" colspan="5">Belum ada cabang lain pada jaringan toko ini.</td></tr>';
    }

    async function reload(){
        if(!window.LDMPrimaryOwner?.catalogStatus)return;
        setMessage("Memuat status katalog cabang…");
        try{
            const data=await window.LDMPrimaryOwner.catalogStatus();
            render(data||{});
            setMessage("Status katalog cabang berhasil diperbarui.");
        }catch(error){
            setMessage("Status katalog gagal dimuat: "+(error.message||String(error)),true);
        }
    }

    async function syncOne(storeId){
        if(busy)return;
        setBusy(true);
        setMessage("Menyinkronkan master barang dan harga ke cabang…");
        try{
            const autoInput=[...(byId("catalogBranchRows")?.querySelectorAll("[data-catalog-auto]")||[])]
                .find(input=>input.dataset.catalogAuto===storeId);
            const auto=autoInput?.checked!==false;
            const result=await window.LDMPrimaryOwner.syncCatalog({
                storeId,enableAutoSync:auto
            });
            await reload();
            setMessage(`Sinkron selesai: ${number(result.processed)} barang diproses, ${number(result.inserted)} baru, ${number(result.updated)} diperbarui. Stok cabang tidak berubah.`);
        }catch(error){
            setMessage("Sinkron gagal: "+(error.message||String(error)),true);
        }finally{setBusy(false)}
    }

    async function toggleAuto(input){
        if(busy)return;
        const enabled=input.checked;
        setBusy(true);
        setMessage(enabled?"Mengaktifkan sinkron otomatis…":"Menonaktifkan sinkron otomatis…");
        try{
            await window.LDMPrimaryOwner.setCatalogSync({
                storeId:input.dataset.catalogAuto,enabled
            });
            await reload();
            setMessage(enabled
                ? "Sinkron otomatis aktif. Perubahan katalog pusat berikutnya akan langsung diteruskan ke cabang."
                : "Sinkron otomatis nonaktif. Data terakhir tetap tersimpan dan stok cabang tidak berubah."
            );
        }catch(error){
            input.checked=!enabled;
            setMessage("Pengaturan gagal disimpan: "+(error.message||String(error)),true);
        }finally{setBusy(false)}
    }

    async function syncAll(){
        if(busy)return;
        if(!window.confirm("Sinkronkan master barang dan seluruh harga dari cabang pusat ke semua cabang? Stok tiap cabang tidak akan diubah."))return;
        setBusy(true);
        setMessage("Menyinkronkan katalog ke seluruh cabang…");
        try{
            const result=await window.LDMPrimaryOwner.syncAllCatalog({enableAutoSync:true});
            await reload();
            setMessage(`${number(result.count)} cabang selesai disinkronkan dan diaktifkan mengikuti katalog pusat.`);
        }catch(error){
            setMessage("Sinkron seluruh cabang gagal: "+(error.message||String(error)),true);
        }finally{setBusy(false)}
    }

    function boot(){
        const panel=byId("catalogControlPanel");
        if(!panel)return;
        byId("catalogReload")?.addEventListener("click",reload);
        byId("catalogSyncAll")?.addEventListener("click",syncAll);
        byId("catalogBranchRows")?.addEventListener("click",event=>{
            const button=event.target.closest("[data-catalog-sync]");
            if(button)syncOne(button.dataset.catalogSync);
        });
        byId("catalogBranchRows")?.addEventListener("change",event=>{
            const input=event.target.closest("[data-catalog-auto]");
            if(input)toggleAuto(input);
        });
        window.addEventListener("ldm-primary-owner-ready",event=>{
            if(event.detail?.is_primary_owner)reload();
        },{once:true});
        if(window.LDM_PRIMARY_OWNER_CONTEXT?.is_primary_owner)reload();
    }

    document.addEventListener("DOMContentLoaded",boot);
})();

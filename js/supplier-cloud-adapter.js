(function(){
    "use strict";

    function ready(){
        return window.LDMProcurement && typeof window.LDMProcurement.saveSupplier === "function";
    }

    globalThis.saveSupplier = async function(ev){
        if(ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if(!ready()){
            showModal("Cloud Belum Siap","procurement-service.js belum termuat.","danger");
            return;
        }

        const name = document.getElementById("supplierName").value.trim();
        if(!name){
            showModal("Nama Wajib Diisi","Nama Supplier / Distributor wajib diisi.","warning");
            return;
        }

        try{
            const data = getSuppliers();
            const duplicate = data.find(
                s => normalizeName(s.nama) === normalizeName(name) && String(s.id) !== String(editingSupplierId)
            );
            if(duplicate){
                showModal("Supplier Duplikat",`Supplier <strong>${esc(name)}</strong> sudah ada dengan kode ${esc(duplicate.kode)}.`,"warning");
                return;
            }

            await window.LDMProcurement.saveSupplier({
                id:editingSupplierId || null,
                code:document.getElementById("supplierCode").value || newSupplierCode(),
                name,
                contactPerson:document.getElementById("supplierSales").value.trim(),
                phone:document.getElementById("supplierPhone").value.trim(),
                whatsapp:document.getElementById("supplierWhatsapp").value.trim(),
                email:document.getElementById("supplierEmail").value.trim(),
                address:document.getElementById("supplierAddress").value.trim(),
                paymentTermDays:Number(document.getElementById("supplierTerm").value || 0),
                category:document.getElementById("supplierCategory").value.trim(),
                note:document.getElementById("supplierNote").value.trim(),
                active:document.getElementById("supplierActive").checked
            });

            showModal("Supplier Disimpan",`Data <strong>${esc(name)}</strong> berhasil disimpan ke cloud.`,"success");
            resetSupplierForm();
            renderSuppliers();
        }catch(error){
            console.error("Cloud Supplier save gagal:",error);
            showModal("Supplier Gagal Disimpan",error.message || String(error),"danger");
        }
    };

    globalThis.toggleSupplier = async function(id){
        if(!ready()) return;
        const s = getSuppliers().find(x => String(x.id) === String(id));
        if(!s) return;
        try{
            await window.LDMProcurement.saveSupplier({
                id:s.id,
                code:s.kode,
                name:s.nama,
                contactPerson:s.sales,
                phone:s.telepon,
                whatsapp:s.whatsapp,
                email:s.email,
                address:s.alamat,
                paymentTermDays:s.tempoHari,
                category:s.kategori,
                note:s.catatan,
                active:s.aktif === false
            });
            renderSuppliers();
        }catch(error){
            showModal("Status Supplier Gagal",error.message || String(error),"danger");
        }
    };

    globalThis.deleteSupplier = async function(id){
        if(currentRole !== "owner"){
            showModal("Akses Ditolak","Hanya Owner yang dapat menghapus master supplier. Admin tetap dapat menonaktifkan supplier.","warning");
            return;
        }
        const s = getSuppliers().find(x => String(x.id) === String(id));
        if(!s) return;
        const ok = await ldmDialog.confirm(
            "Hapus Supplier",
            `Hapus supplier ${s.nama}? Supplier yang sudah dipakai histori pembelian akan ditolak oleh server.`,
            "danger",
            {okText:"Hapus"}
        );
        if(!ok) return;
        try{
            await window.LDMProcurement.deleteSupplier(id);
            if(String(editingSupplierId) === String(id)) resetSupplierForm();
            renderSuppliers();
            showModal("Supplier Dihapus",`Supplier <strong>${esc(s.nama)}</strong> berhasil di-soft-delete.`,"success");
        }catch(error){
            showModal("Supplier Tidak Dihapus",error.message || String(error),"warning");
        }
    };

    globalThis.importFromPO = async function(){
        const pos = getPOs();
        if(!pos.length){
            showModal("Belum Ada PO","Tidak ada riwayat Purchase Order yang dapat digunakan.");
            return;
        }
        const existing = getSuppliers();
        const names = [...new Set(pos.map(po => String(po.supplier || "").trim()).filter(Boolean))]
            .filter(name => !existing.some(s => normalizeName(s.nama) === normalizeName(name)));
        if(!names.length){
            showModal("Tidak Ada Supplier Baru","Semua Supplier dari riwayat PO sudah ada di master cloud.","success");
            return;
        }
        let added = 0;
        try{
            for(const name of names){
                const po = pos.find(row => normalizeName(row.supplier) === normalizeName(name)) || {};
                await window.LDMProcurement.saveSupplier({
                    code:"",
                    name,
                    contactPerson:po.referensi || "",
                    phone:po.kontakSupplier || "",
                    active:true
                });
                added += 1;
            }
            renderSuppliers();
            showModal("Import Selesai",`${added} supplier baru berhasil dibuat di cloud.`,"success");
        }catch(error){
            showModal("Import Supplier Gagal",error.message || String(error),"danger");
        }
    };

    window.addEventListener("ldm-procurement-cache-updated",event => {
        if(event.detail && ["suppliers","purchaseOrders"].includes(event.detail.section)){
            try{ renderSuppliers(); }catch(error){}
        }
    });
})();

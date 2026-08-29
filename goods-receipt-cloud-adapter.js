(function(){
    "use strict";

    function service(){
        if(!window.LDMProcurement){
            throw new Error("procurement-service.js belum termuat.");
        }
        return window.LDMProcurement;
    }

    async function confirmCloud(title,message,okText="Lanjutkan"){
        if(window.ldmDialog && typeof window.ldmDialog.confirm === "function"){
            return await window.ldmDialog.confirm(title,message,"question",{okText});
        }
        return window.confirm(message);
    }

    globalThis.konfirmasiSimpanGoodsReceipt = async function(){
        if(!requirePermission("goodsreceipt.create")) return;
        if(daftarBarangGoodsReceipt.length === 0){
            tampilkanNotifikasi("Belum Ada Barang","Tambahkan minimal satu barang ke lembar Goods Receipt.");
            return;
        }
        const supplier = sanitizeSimpleText(document.getElementById("inputSupplier").value,80);
        const suratJalan = sanitizeSimpleText(document.getElementById("inputSuratJalan").value,50);
        if(!supplier){
            tampilkanNotifikasi("Supplier Wajib Diisi","Pilih Supplier dari Master Supplier Cloud.");
            return;
        }
        if(!suratJalan){
            tampilkanNotifikasi("Surat Jalan Wajib Diisi","Masukkan nomor surat jalan dari supplier.");
            return;
        }
        const session = requireLogin();
        if(!session) return;
        const ok = await confirmCloud(
            session.role === "admin" ? "Ajukan Goods Receipt" : "Simpan Goods Receipt",
            session.role === "admin"
                ? "Goods Receipt Admin akan menjadi PENDING. Stok cloud belum berubah sampai Owner Accept. Lanjutkan?"
                : "Goods Receipt Owner akan diterapkan ke stok cloud secara atomik. Lanjutkan?",
            session.role === "admin" ? "Ajukan" : "Terima"
        );
        if(!ok) return;
        await globalThis.simpanGoodsReceipt();
    };

    globalThis.simpanGoodsReceipt = async function(){
        if(!requirePermission("goodsreceipt.create")) return;
        const session = requireLogin();
        if(!session) return;

        const nomorGR = document.getElementById("inputNomorGR").value || buatNomorGoodsReceipt();
        const supplier = sanitizeSimpleText(document.getElementById("inputSupplier").value,80);
        const suratJalan = sanitizeSimpleText(document.getElementById("inputSuratJalan").value,50);
        const catatan = sanitizeSimpleText(document.getElementById("inputCatatanGR").value,250);

        try{
            const result = await service().submitGoodsReceipt({
                grNumber:nomorGR,
                businessDate:document.getElementById("inputTanggalGR").value || tanggalHariIniLocal(),
                supplier,
                deliveryNote:suratJalan,
                purchaseOrderId:currentSourcePOId || null,
                note:catatan,
                items:daftarBarangGoodsReceipt.map(item => ({...item}))
            });

            hapusAutoDraftGR();
            daftarBarangGoodsReceipt = [];
            renderDraftGoodsReceipt();
            renderRiwayatGoodsReceipt();
            renderApprovedPurchaseOrderInbox();

            const status = result && result.status ? result.status : (session.role === "admin" ? "PendingApproval" : "Accepted");
            if(status === "PendingApproval"){
                tampilkanNotifikasi("Dikirim ke Owner",`${nomorGR} tersimpan di cloud sebagai Pending Approval. Stok belum berubah.`);
            }else{
                tampilkanNotifikasi("Goods Receipt Diterima",`${nomorGR} berhasil diterapkan ke stok cloud secara atomik.`);
                if(result && result.id){
                    try{ cetakGoodsReceiptById(result.id); }catch(error){}
                }
            }
            setTimeout(resetDokumenGoodsReceipt,250);
        }catch(error){
            console.error("Cloud Goods Receipt gagal:",error);
            tampilkanNotifikasi("Goods Receipt Gagal",error.message || String(error));
        }
    };

    globalThis.acceptPendingGoodsReceipt = async function(id){
        if(!requirePermission("goodsreceipt.approve")) return;
        const receipt = safeReadArray("dataGoodsReceipt").find(gr => String(gr.id) === String(id));
        if(!receipt) return;
        const ok = await confirmCloud(
            "Accept Goods Receipt",
            `Setujui ${receipt.nomorGR}? Stok cloud dan qty diterima pada PO akan diperbarui dalam satu transaksi database.`,
            "Accept"
        );
        if(!ok) return;
        try{
            await service().approveGoodsReceipt(id);
            renderRiwayatGoodsReceipt();
            renderApprovedPurchaseOrderInbox();
            try{ tutupModal("modalDetailGR"); }catch(error){}
            tampilkanNotifikasi("Goods Receipt Diterima",`${receipt.nomorGR} telah di-Accept dan stok cloud diperbarui.`);
        }catch(error){
            tampilkanNotifikasi("Accept Goods Receipt Gagal",error.message || String(error));
        }
    };

    globalThis.konfirmasiHapusGoodsReceipt = async function(id){
        if(!requirePermission("goodsreceipt.delete")) return;
        const receipt = safeReadArray("dataGoodsReceipt").find(gr => String(gr.id) === String(id));
        if(!receipt) return;
        const ok = await confirmCloud(
            receipt.status === "Accepted" ? "Batalkan & Rollback Goods Receipt" : "Batalkan Goods Receipt",
            receipt.status === "Accepted"
                ? `Batalkan ${receipt.nomorGR}? Server akan mengurangi kembali stok secara atomik. Jika stok sudah tidak cukup karena penjualan berikutnya, pembatalan akan ditolak.`
                : `Batalkan ${receipt.nomorGR}?`,
            "Batalkan"
        );
        if(!ok) return;
        await globalThis.hapusGoodsReceiptDanRollback(id);
    };

    globalThis.hapusGoodsReceiptDanRollback = async function(id){
        if(!requirePermission("goodsreceipt.delete")) return;
        const receipt = safeReadArray("dataGoodsReceipt").find(gr => String(gr.id) === String(id));
        if(!receipt) return;
        try{
            await service().cancelGoodsReceipt(id,"Dibatalkan melalui Goods Receipt UI");
            renderRiwayatGoodsReceipt();
            renderApprovedPurchaseOrderInbox();
            tampilkanNotifikasi(
                "Goods Receipt Dibatalkan",
                `${receipt.nomorGR} berstatus Cancelled. Efek stok dibalik secara atomik bila sebelumnya sudah Accepted.`
            );
        }catch(error){
            tampilkanNotifikasi("Pembatalan Goods Receipt Gagal",error.message || String(error));
        }
    };

    window.addEventListener("ldm-procurement-cache-updated",event => {
        if(!event.detail) return;
        if(["goodsReceipts","purchaseOrders","suppliers"].includes(event.detail.section)){
            try{ renderRiwayatGoodsReceipt(); }catch(error){}
            try{ renderApprovedPurchaseOrderInbox(); }catch(error){}
        }
    });
})();

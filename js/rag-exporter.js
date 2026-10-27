/**
 * Local AI Engine RAG Preparation & JSON Exporter Pipeline
 * Maps contextual project state into structured tabular JSON data streams
 * optimized for Retrieval-Augmented Generation via local Ollama wrappers.
 */

class RAGExporter {
    exportProjectRAG(project, tasks) {
        const todayStr = new Date().toISOString().split('T')[0];
        
        const ragStructure = {
            "Thong_Tin_Du_An": {
                "Ma_Du_An": project.id,
                "Ten_Du_An": project.name,
                "Bo_Phan_Khoi_Tao": project.creatorDept || "CONSTRUCTION",
                "Thoi_Gian": `Từ ${project.startRange} đến ${project.endRange}`,
                "Trang_Thai": project.status || "Active",
                "Ngay_Kiem_Tra_Today": todayStr
            },
            "Luat_He_Thong_Ve_Mau_Sac": {
                "Vang": "Chưa làm, đang trong hạn mốc cho phép (Pending)",
                "Xanh_La": "Đang triển khai thực tế tại hiện trường (Working)",
                "Blue_Dam_Co_Tich": "Đã hoàn thành xong 100%, đã nghiệm thu (Completed)",
                "Do_Nhat_Co_Hao_Quang": "CẢNH BÁO NGUY HIỂM: Đã quá hạn deadline so với ngày TODAY nhưng việc vẫn chưa xong! (Overdue)"
            },
            "Ma_Tran_Nhan_Qua_Du_An": tasks.map(t => {
                const predecessors = t.codeOut ? t.codeOut.split(',').map(s=>s.trim()).filter(Boolean) : [];
                
                let statusLabel = "Chưa làm - Vàng";
                if (t.isCompleted) statusLabel = "Đã hoàn thành - Blue đậm";
                else if (t.isStarted) statusLabel = "Đang làm - Xanh lá";
                else if (t.end < todayStr) statusLabel = "CẢNH BÁO QUÁ HẠN - Đỏ nhạt (Vì deadline trước ngày TODAY)";

                const successors = tasks.filter(x => x.codeOut && x.codeOut.split(',').map(s=>s.trim()).includes(t.codeIn)).map(x => x.codeIn);

                return {
                    "Ma_Task_CodeIn": t.codeIn,
                    "Ten_Task": t.name,
                    "Bo_Phan_Phu_Trach": t.dept || "CONSTRUCTION",
                    "Nguoi_Lam_PIC": t.staff,
                    "Han_Chay": `Từ ${t.start} đến ${t.end}`,
                    "Trang_Thai_Mau": statusLabel,
                    "Cong_Viec_Bi_Noi_Chan_Phia_Sau": successors,
                    "Bi_Chan_Boi_Task_Phia_Truoc": predecessors,
                    "Ghi_Chu_Tac_Dong_Tien_Do": t.notes || "Không có ghi chú tác động"
                };
            })
        };

        const jsonStr = JSON.stringify(ragStructure, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RAG_CONTEXT_${project.id}_${todayStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return ragStructure;
    }
}

window.ragExporter = new RAGExporter();

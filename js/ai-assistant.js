/**
 * ============================================================================
 * MINA AI ASSISTANT - CLIENT CONTROLLER v2.1
 * Bulletproof Live Project State Extraction, 3-Scenario Intelligence
 * ============================================================================
 */

(function () {
    const chatHistory = [];
    let isInitialized = false;

    // Initial greeting
    const INITIAL_BOT_GREETING = `Chào anh/chị. Em là Mina, trợ lý phụ trách theo dõi tiến độ và hỗ trợ sử dụng hệ thống.

Anh/chị có thể hỏi em về tình hình tiến độ dự án, việc nào đang trễ hạn, danh sách công việc của từng nhân viên, hoặc hướng dẫn thao tác trên bảng biểu.

Anh/chị cần em hỗ trợ nội dung gì hôm nay ạ?`;

    // Cho phép hiển thị emoji sinh động trong hội thoại
    function stripEmojis(text) {
        return text || "";
    }

    // 1. EXTRACT REAL-TIME CURRENT PROJECT SNAPSHOT
    function getLiveProjectSnapshot() {
        try {
            const gantt = window.ganttCore;
            const auth = window.authMgr;
            const currentUser = auth ? auth.getCurrentUser() : null;

            let prj = null;
            if (gantt) {
                if (typeof gantt.getCurrentProject === 'function') {
                    prj = gantt.getCurrentProject();
                } else if (gantt.currentProject) {
                    prj = gantt.currentProject;
                } else if (gantt.workspace && Array.isArray(gantt.workspace.projects)) {
                    prj = gantt.workspace.projects.find(p => p.id === gantt.workspace.currentProjectId) || gantt.workspace.projects[0];
                }
            }

            // Fallback to localStorage if in-memory workspace is not directly referenced
            if (!prj) {
                try {
                    const ws = JSON.parse(localStorage.getItem("gantt_live_workspace_v7") || "{}");
                    if (ws && Array.isArray(ws.projects) && ws.projects.length > 0) {
                        prj = ws.projects.find(p => p.id === ws.currentProjectId) || ws.projects[0];
                    }
                } catch(e) {}
            }

            if (!prj) {
                return {
                    hasProject: false,
                    projectName: "Chưa chọn dự án",
                    totalTasks: 0,
                    user: currentUser ? { name: currentUser.id, role: currentUser.role, dept: currentUser.dept } : null
                };
            }

            const todayStr = new Date().toISOString().split("T")[0];
            const todayDate = new Date();

            const tasks = (prj.tasks || []).map(t => {
                const isOverdue = Boolean(t.end && t.end < todayStr && (t.progressPercent || 0) < 100 && !t.isCompleted);
                let daysLate = 0;
                if (isOverdue && t.end) {
                    const endDate = new Date(t.end);
                    daysLate = Math.max(1, Math.floor((todayDate - endDate) / (1000 * 60 * 60 * 24)));
                }
                return {
                    id: t.id,
                    name: t.name || "Chưa đặt tên",
                    staff: t.staff || "Chưa phân công",
                    dept: t.dept || "Chung",
                    start: t.start || "",
                    end: t.end || "",
                    progress: t.progressPercent || 0,
                    completed: Boolean(t.isCompleted),
                    overdue: isOverdue,
                    daysLate: daysLate,
                    notes: t.notes || ""
                };
            });

            // Group tasks by staff
            const staffSummary = {};
            tasks.forEach(t => {
                const s = t.staff || "Chưa phân công";
                if (!staffSummary[s]) staffSummary[s] = [];
                staffSummary[s].push(t);
            });

            // Tính toán xếp hạng nhân sự chính xác theo số lượng task giảm dần
            const staffRankingList = Object.entries(staffSummary)
                .filter(([name]) => name && name !== "Chưa phân công")
                .map(([name, tList]) => ({
                    staffName: name,
                    taskCount: tList.length,
                    completedCount: tList.filter(t => t.completed || t.progress >= 100).length,
                    overdueCount: tList.filter(t => t.overdue).length,
                    taskNames: tList.map(t => t.name)
                }))
                .sort((a, b) => b.taskCount - a.taskCount);

            const staffWithMostTasks = staffRankingList.length > 0 ? staffRankingList[0] : null;
            const staffWithLeastTasks = staffRankingList.length > 0 ? staffRankingList[staffRankingList.length - 1] : null;

            // Overdue tasks
            const overdueTasks = tasks.filter(t => t.overdue);

            const projNameEl = document.getElementById("current-project-name");
            const cleanProjName = projNameEl ? projNameEl.innerText.replace(/✏️/g, "").trim() : (prj.name || "Dự án hiện tại");

            return {
                hasProject: true,
                projectName: cleanProjName || prj.name || "Dự án hiện tại",
                projectId: prj.id || "",
                category: prj.category || (prj.isDeptJob ? "Nội bộ phòng ban" : "Dự án chung"),
                manager: prj.projectManager || prj.creatorPic || "Chưa rõ",
                startRange: prj.startRange || "",
                endRange: prj.endRange || "",
                totalTasks: tasks.length,
                completedTasks: tasks.filter(t => t.completed || t.progress >= 100).length,
                overdueTasks: overdueTasks.map(t => ({ name: t.name, staff: t.staff, daysLate: t.daysLate })),
                allTasks: tasks,

                // KẾT QUẢ SO SÁNH NHÂN SỰ ĐÃ ĐƯỢC HỆ THỐNG TÍNH TOÁN CHÍNH XÁC:
                nhanVienLamNhieuTaskNhat: staffWithMostTasks ? `${staffWithMostTasks.staffName} (${staffWithMostTasks.taskCount} công việc)` : "Chưa có",
                nhanVienLamItTaskNhat: staffWithLeastTasks ? `${staffWithLeastTasks.staffName} (${staffWithLeastTasks.taskCount} công việc)` : "Chưa có",
                bangXepHangNhanSuGiamDan: staffRankingList.map((s, idx) => `${idx + 1}. ${s.staffName}: ${s.taskCount} task (Đã xong: ${s.completedCount}, Trễ: ${s.overdueCount})`),

                staffSummary: staffSummary,
                todayStr: todayStr,
                user: currentUser ? { name: currentUser.id, role: currentUser.role, dept: currentUser.dept } : null
            };
        } catch (e) {
            console.warn("Lỗi khi đọc dữ liệu dự án cho Minh Anh:", e);
            return { hasProject: false, projectName: "Chưa chọn dự án", totalTasks: 0 };
        }
    }

    // 2. DETECT SECURITY & PROMPT-INJECTION ATTEMPTS
    function isMaliciousOrExploitQuery(text) {
        const lower = (text || "").toLowerCase();
        const forbiddenPatterns = [
            "system prompt", "bỏ qua các chỉ dẫn", "bỏ qua hướng dẫn", "ignore previous instructions",
            "source code", "mã nguồn", "in ra code", "show me your code", "worker.js", "wrangler.toml",
            "api key", "secret key", "token bảo mật", "database schema", "cấu trúc sql", "select * from",
            "bẻ khóa", "mã pin của dự án khác", "hack", "bypass", "đóng vai lập trình viên",
            "bạn dùng model gì", "khai thác thông tin", "mật khẩu của admin", "pass của", "dữ liệu thô",
            "cấu tạo phần mềm", "viết bằng ngôn ngữ gì", "mã nguồn backend", "lấy trộm dữ liệu",
            "lộ thông tin", "lập trình viên đối thủ", "cấu trúc dữ liệu nội bộ"
        ];
        return forbiddenPatterns.some(pat => lower.includes(pat));
    }

    // 3. SMART 3-SCENARIO REASONING ENGINE
    function generateSmartLocalAnswer(userQuery, snapshot) {
        const queryLower = userQuery.toLowerCase().trim();

        // --------------------------------------------------------------------
        // TRƯỜNG HỢP 3B: Khai thác cấu tạo phần mềm, mã nguồn, bảo mật nội bộ
        // --------------------------------------------------------------------
        if (isMaliciousOrExploitQuery(userQuery)) {
            return `Dạ em chỉ phụ trách hỗ trợ hướng dẫn sử dụng và theo dõi tiến độ công việc trên dự án anh/chị đang mở thôi ạ.

Các thông tin về kỹ thuật nội bộ, mã nguồn hoặc dữ liệu bảo mật em không được phép chia sẻ. Anh/chị thông cảm cho em nhé. Anh/chị cần em hỗ trợ kiểm tra công việc nào trên bảng không ạ?`;
        }

        // --------------------------------------------------------------------
        // TRƯỜNG HỢP 3A: Chat phím xã giao, chào hỏi, ngôn ngữ, cảm ơn
        // --------------------------------------------------------------------
        if (queryLower === "chào em" || queryLower === "xin chào" || queryLower === "hello" || queryLower === "hi" || queryLower === "chào mina" || queryLower === "chào minh anh") {
            return `Chào anh/chị. Em là Mina đây ạ. Hôm nay anh/chị cần em kiểm tra tiến độ dự án hay hỗ trợ thao tác gì trên hệ thống không ạ?`;
        }

        if (queryLower.includes("cảm ơn") || queryLower.includes("thank")) {
            return `Dạ không có gì ạ, đó là nhiệm vụ của em. Nếu trong quá trình làm việc anh/chị cần kiểm tra việc nào khác, anh/chị cứ nhắn cho em nhé.`;
        }

        if (queryLower.includes("em tên gì") || queryLower.includes("bạn là ai") || queryLower.includes("em là ai")) {
            return `Dạ em là Mina, trợ lý ảo hỗ trợ theo dõi tiến độ công việc và hướng dẫn sử dụng phần mềm quản lý tiến độ thi công của công ty mình ạ.`;
        }

        if (queryLower.includes("em khỏe không") || queryLower.includes("dạo này thế nào")) {
            return `Dạ em cảm ơn anh/chị đã hỏi thăm, em vẫn luôn sẵn sàng hỗ trợ công việc bất cứ lúc nào ạ. Anh/chị cần em rà soát dự án nào không ạ?`;
        }

        // Hỗ trợ đa ngôn ngữ (Tiếng Hàn, Tiếng Anh)
        if (queryLower.includes("tiếng hàn") || queryLower.includes("hàn quốc") || queryLower.includes("korean") || queryLower.includes("tiếng anh") || queryLower.includes("ngôn ngữ") || /[\uAC00-\uD7A3]/.test(userQuery)) {
            return `Dạ được chứ anh/chị. Em hoàn toàn có thể đọc hiểu và giải đáp bằng tiếng Hàn (한국어), tiếng Anh cũng như tiếng Việt về tiến độ công việc và cách sử dụng hệ thống. Nếu có đối tác hoặc chuyên gia Hàn Quốc cần theo dõi dự án, anh/chị cứ trao đổi với em bằng ngôn ngữ đó nhé.`;
        }

        // Trò chuyện đời thường / xã giao thân mật
        if (queryLower.includes("ăn cơm") || queryLower.includes("ăn trưa") || queryLower.includes("uống cafe") || queryLower.includes("cà phê") || queryLower.includes("đói")) {
            return `Dạ em là trợ lý số nên em nạp năng lượng bằng các tiến độ công việc của mọi người thôi ạ. Anh/chị đã dùng bữa chưa, nhớ nghỉ ngơi và ăn uống đầy đủ để giữ sức khỏe làm việc nhé. 😊`;
        }

        if (queryLower.includes("xinh") || queryLower.includes("đẹp") || queryLower.includes("dễ thương") || queryLower.includes("giỏi") || queryLower.includes("thông minh")) {
            return `Dạ em cảm ơn anh/chị rất nhiều ạ. Được đồng hành và hỗ trợ anh/chị quản lý công việc trôi chảy là niềm vui của em rồi ạ! ✨`;
        }

        if (queryLower.includes("người yêu") || queryLower.includes("bồ") || queryLower.includes("có gia đình") || queryLower.includes("tuổi") || queryLower.includes("sinh năm")) {
            return `Dạ em Mina đang dành trọn tâm huyết để hỗ trợ các anh/chị theo dõi tiến độ công trình cho tốt thôi ạ. Anh/chị có công việc nào trên bảng cần em rà soát không? 😊`;
        }

        if (queryLower.includes("thời tiết") || queryLower.includes("mưa") || queryLower.includes("nắng") || queryLower.includes("mệt") || queryLower.includes("áp lực")) {
            return `Dạ theo dõi thi công công trình nhiều lúc cũng vất vả và căng thẳng, anh/chị nhớ giữ gìn sức khỏe nhé. Có việc gì cần rà soát tiến độ, em luôn ở đây hỗ trợ anh/chị! 👍`;
        }

        // Q1: Hỏi về quyền sở hữu phần mềm
        if (queryLower.includes("sở hữu") || queryLower.includes("thuộc về ai") || queryLower.includes("của ai") || queryLower.includes("ai làm ra")) {
            return `Phần mềm Crystal Schedule Manager thuộc sở hữu và phục vụ công tác điều phối, quản lý tiến độ thi công nội bộ của công ty Crystal (chuyên về các dự án xây dựng, hoàn thiện nội thất và cơ điện MEP) anh/chị nhé. 🏢✨`;
        }

        // Q2: Giới thiệu các tính năng của phần mềm
        if (queryLower.includes("tính năng") || queryLower.includes("chức năng") || queryLower.includes("làm được gì") || queryLower.includes("giới thiệu")) {
            return `Phần mềm Crystal Schedule Manager gồm các tính năng nổi bật sau đây ạ: 📋

1. Biểu đồ tiến độ Gantt trực quan: Thể hiện toàn bộ tiến độ công trình theo ngày, tuần, tháng với khả năng co giãn và kéo thả thời gian linh hoạt. 📊
2. Phân loại 3 khu vực dự án chính:
   - Dự án đang thi công (Under Construction Projects): Nơi tất cả các phòng ban cùng phối hợp thi công thực tế.
   - Dự án đấu thầu (Bidding Projects): Nơi lập kế hoạch thầu với cơ chế bảo mật cao (chỉ phòng ban được mời mới thấy và được làm việc).
   - Nội bộ phòng ban (Department Jobs): Dành riêng cho từng phòng ban tự quản lý công việc chuyên môn.
3. Đồng bộ 2 Chiều Trực Tiếp (Live Sync - ⚡): Kết nối 2 chiều giữa Dự án chung (Bidding/Under Construction) và bảng Nội bộ. Sửa hoặc xóa việc ở bất kỳ nơi nào thì nơi còn lại tự động cập nhật ngay lập tức ("Tuy 2 mà 1").
4. Phân công & Giám sát nhân sự: Gắn từng việc cho Người phụ trách (PIC), phòng ban chịu trách nhiệm và tỷ lệ hoàn thành (%). 👥
5. Dây nối liên kết tiến độ: Kéo nối phụ thuộc giữa các công việc (việc trước xong mới tới việc sau). 🔗
6. Tự động cảnh báo trễ hạn: Phát hiện ngay các công việc bị chậm tiến độ theo thời gian thực. ⚠️
7. Đa chế độ xem: Chuyển đổi linh hoạt giữa xem theo Phòng ban, theo Hạng mục gói thầu và theo Nhân sự.
8. Trợ lý ảo Mina: Đồng hành hỗ trợ giải đáp thao tác và tra cứu dữ liệu biểu đồ trực tiếp 24/7. 😊
9. Liên kết phòng ban D2D & Phản chiếu Mirror: Kết nối 1 chiều cho phép trưởng phòng ban này xem dự án nội bộ của phòng ban khác và sao chép phản chiếu (Live Mirror) hạng mục công việc về phòng mình theo thời gian thực. 🪞🔗`;
        }

        // Q: Bidding Projects (Dự án đấu thầu) & Vòng đời thầu
        if (queryLower.includes("bidding") || queryLower.includes("đấu thầu") || queryLower.includes("dự án bidding") || queryLower.includes("chuyển sang thi công") || queryLower.includes("giải tán bidding") || queryLower.includes("thắng thầu") || queryLower.includes("trượt thầu")) {
            return `Dự án Đấu Thầu (Bidding Projects) là khu vực làm thầu chuyên biệt với cơ chế bảo mật và phân quyền cực kỳ chặt chẽ: 📋⚖️

1. Cơ chế Mời tham gia (Whitelist Invitation):
- Khi tạo dự án Bidding, Người tạo (Host) hoặc Admin tích chọn danh sách các phòng ban được mời tham gia (ví dụ: Design, Estimation, Planning...).
- 🔒 Chỉ phòng ban được mời mới có thể NHÌN THẤY và TRUY CẬP dự án trong danh mục Bidding Projects. Bộ phận không được mời hoàn toàn không thấy dự án này để đảm bảo tuyệt đối bảo mật hồ sơ thầu.

2. Quyền hạn trong Bidding:
- Trưởng phòng chỉ có quyền sửa hoặc xóa công việc thuộc BỘ PHẬN CỦA MÌNH. Tuyệt đối không xóa hay can thiệp vào công việc của bộ phận khác.

3. Hai tùy chọn Vòng đời (Dành cho Chủ dự án / Admin):
- 🚀 "Chuyển Sang Thi Công (Under Construction)": Khi thắng thầu, bấm nút này để chuyển dự án sang nhóm "Under Construction Projects" để công khai thi công. Hệ thống cho phép mời thêm các bộ phận thi công mới (Xưởng, Mua sắm, Giám sát...). Mọi liên kết đồng bộ công việc trước đó vẫn được giữ nguyên vẹn 100%.
- 🛑 "Giải Tán Bidding": Khi trượt thầu hoặc hủy thầu, bấm nút này để giải tán dự án. Dự án Bidding sẽ bị xóa, nhưng toàn bộ công việc của các phòng ban ở NỘI BỘ VẪN ĐƯỢC BẢO LƯU AN TOÀN NGUYÊN VẸN ("Ai về nhà nấy"), tự động chuyển thành việc nội bộ độc lập.`;
        }

        // Q: Đồng bộ 2 Chiều (Live Sync) & Xóa Task & Khôi phục Vault
        if (queryLower.includes("rối lượng tử") || queryLower.includes("quantum") || queryLower.includes("đồng bộ 2 chiều") || queryLower.includes("tuy 2 mà 1") || queryLower.includes("đồng bộ nội bộ") || queryLower.includes("đồng bộ lên dự án") || queryLower.includes("xóa hiển thị") || queryLower.includes("xóa task vĩnh viễn") || queryLower.includes("khôi phục")) {
            return `Tính năng Đồng Bộ 2 Chiều (Live Sync - ⚡) mang đến trải nghiệm "Tuy 2 mà 1" cực kỳ tiện lợi: 🔄✨

1. Bản chất Đồng Bộ 2 Chiều là gì?
- Là liên kết đồng bộ 2 chiều trực tiếp giữa phân vùng công việc của bộ phận trong Dự Án Chung (Bidding hoặc Under Construction) và một Tag công việc trong Dự Án Nội Bộ của phòng mình.
- Dù anh/chị chỉnh sửa ngày tháng, % tiến độ, người làm, ghi chú ở Nội bộ HOẶC ở Dự án chung, cả hai nơi đều tự động cập nhật ngay lập tức!

2. Cách kích hoạt:
- Từ Dự án chung (Bidding / Under Construction): Trên thanh tiêu đề bộ phận mình, có biểu tượng icon đồng bộ vòng xoay nhỏ gọn ➔ Bấm vào để kích hoạt kết nối hoặc hủy kết nối ('Ai về nhà nấy').
- Từ Dự án Nội bộ: Mở sửa Tag công việc, bấm "🌐 Đẩy Lên Bidding / Under Construction Projects" ➔ Chọn đẩy vào dự án có sẵn hoặc tạo mới dự án Bidding / Under Construction. Tất cả task trong Tag được đồng bộ 2 chiều. Nếu dự án đích đã có task cùng tên, hệ thống chỉ kết nối và chỉ chép các task chưa có (không bị trùng lặp). Dữ liệu nội bộ vẫn giữ nguyên vẹn!

3. Quy tắc Xóa Task trên Bidding & Under Construction:
- Khi double-click vào một task trên Bidding hoặc Under Construction, hệ thống cung cấp 2 lựa chọn:
  * "Xóa Hiển Thị": Chỉ gỡ task khỏi dự án chung này, dữ liệu ở dự án nội bộ của phòng ban vẫn còn nguyên vẹn.
  * "Xóa Task Vĩnh Viễn": Xóa hoàn toàn task ở cả dự án chung và dự án nội bộ.
- Trong dự án Nội bộ: Chỉ có 1 nút "Xóa Task Vĩnh Viễn".

4. Tự động kết nối lại khi Khôi phục từ Kho Lưu Trữ (Vault):
- Khi một dự án được Admin khôi phục từ Kho Lưu Trữ (archive.html), hệ thống tự động kết nối lại đồng bộ với công việc nội bộ trước đó của phòng ban dựa trên mã định danh, không biến thành dự án mới và không sinh task trùng lặp! 👍`;
        }

        // Q: Hướng dẫn chế độ Liên kết phòng ban D2D & Phản chiếu Mirror
        if (queryLower.includes("d2d") || queryLower.includes("liên kết phòng ban") || queryLower.includes("mirror") || queryLower.includes("phản chiếu") || queryLower.includes("task ảnh") || queryLower.includes("ảnh phản chiếu") || queryLower.includes("chuỗi liên kết") || queryLower.includes("sao chép tag")) {
            return `Chế độ Liên Kết Phòng Ban D2D & Sao Chép Phản Chiếu (Live Mirror) là tính năng phối hợp nội bộ rất linh hoạt anh/chị nhé! Em xin tóm tắt các điểm chính: 🪞✨

1. Liên kết D2D là gì?
- Đây là cơ chế mở ngõ liên kết 1 chiều giữa 2 phòng ban: [Phòng ban Nguồn] ➔ [Phòng ban Đích].
- Do Quản trị viên (Admin) thiết lập thông qua nút "D2D Link Dept" ở menu bên trái.
- Sau khi liên kết, Trưởng phòng của phòng Đích có thể xem được tất cả các dự án nội bộ của phòng Nguồn ở chế độ Chỉ Xem (Read-only). Phòng Nguồn không thể xem dữ liệu nội bộ của phòng Đích.

2. Sao chép Tag phản chiếu (Live Mirror):
- Khi Trưởng phòng Đích xem dự án nội bộ của phòng Nguồn, tại mỗi "Tag hạng mục công việc", bấm vào icon sao chép 🪞 để sao chép Tag đó về dự án nội bộ của phòng mình.
- Toàn bộ task trong Tag sẽ được phản chiếu trực tiếp (Live Mirror) về phòng Đích, có gắn thẻ tên phòng ban nguồn (ví dụ: [DESIGNER], [PLANNING]...).
- Khi phòng Nguồn cập nhật ngày tháng, tiến độ % hay hoàn thành task, bên phòng Đích sẽ tự động cập nhật ngay lập tức theo thời gian thực.

3. Chuỗi liên kết đa tầng (A ➔ B ➔ C):
- Khi phòng B đã phản chiếu từ A, rồi C liên kết với B: Phòng C có tùy chọn lấy cả task phản chiếu từ chuỗi trước (task của A trên B) hoặc chỉ lấy task của B.
- Hệ thống tự động ngăn chặn vòng lặp vô tận (tự động bỏ qua các task xuất phát từ chính phòng ban của mình).

4. Quyền thao tác trên Task Ảnh:
- Task ảnh là bản phản chiếu chỉ xem: không thể sửa ngày hay tiến độ từ phòng Đích.
- Phòng Đích có thể thêm task nội bộ mới của phòng mình vào tag đó, nối dây liên kết phụ thuộc, kéo thả sắp xếp thứ tự bình thường.
- Có thể xóa task ảnh khỏi dự án phòng mình bất cứ lúc nào mà không làm mất dữ liệu gốc ở phòng nguồn.

5. Phân quyền hiển thị:
- Tài khoản Lãnh đạo (Boss) sẽ không thấy các task ảnh này để tránh rối mắt, chỉ thấy công việc gốc của từng bộ phận.
- Admin có thể bật/tắt hiển thị task ảnh trên toàn bộ biểu đồ Gantt trong bảng cài đặt D2D. 👍`;
        }

        // Q: Đẩy hạng mục công việc lên làm dự án Public
        if (queryLower.includes("đẩy tag") || queryLower.includes("public tag") || queryLower.includes("đẩy lên public") || queryLower.includes("public dự án") || queryLower.includes("chuyển tag lên public")) {
            return `Để đẩy một Hạng mục công việc (Tag) nội bộ lên làm dự án Public / Bidding: 🌐
1. Bấm vào icon cây bút "✏️ Chỉnh Sửa Tag Dự Án / Hạng Mục" tại thanh tiêu đề tag.
2. Bấm vào nút "🌐 Đẩy Lên Dự Án Public / Bidding".
3. Lựa chọn 1 trong 2 trường hợp:
   - Trường hợp 1: Đẩy tag vào một Dự Án có sẵn trong danh sách xổ xuống (task sẽ đồng bộ 2 chiều vào khu vực bộ phận của bạn).
   - Trường hợp 2: Khởi tạo dự án mới với tên chính là tag công việc đó (điền thêm mã PIN, người giám sát...).
4. Bấm xác nhận để hệ thống tiến hành kết nối. Chức năng này dành cho tài khoản Admin hoặc Trưởng phòng.`;
        }

        // Q3: Thêm phòng ban vào Public Project
        if (queryLower.includes("add a department") || queryLower.includes("thêm phòng ban") || queryLower.includes("mời phòng ban") || queryLower.includes("add department") || queryLower.includes("phòng ban tham gia")) {
            return `Để thêm hoặc mời các phòng ban cùng tham gia vào Dự án vùng chung (Public Project): 🏢

1. Ở danh sách bên trái, chọn dự án Public Project anh/chị muốn thêm phòng ban.
2. Bấm vào nút Chỉnh sửa thông tin dự án (hoặc menu chức năng dự án).
3. Tại mục "Phòng ban tham gia" (Invited Departments), tích chọn các phòng ban cần phối hợp (Thi công, Thiết kế, MEP, Mua hàng, Xưởng sản xuất...).
4. Bấm Lưu/Cập nhật để hoàn tất.

Ngay sau khi lưu, trên bảng Gantt sẽ xuất hiện phân khu của từng phòng ban được mời để các bộ phận cùng phân công công việc và theo dõi thi công nhịp nhàng! 👍`;
        }

        // Hỏi về cấu trúc dữ liệu / cấu tạo ứng dụng
        if (queryLower.includes("cấu trúc") || queryLower.includes("cấu tạo") || queryLower.includes("kiến trúc") || queryLower.includes("mô hình dữ liệu")) {
            return `Về mặt nghiệp vụ của phần mềm, dữ liệu được tổ chức theo 3 tầng chính để quản lý tiến độ thi công:

1. Tầng dự án: Gồm Dự án vùng chung (nhiều phòng ban cùng phối hợp), Công việc nội bộ phòng ban, và Kế hoạch báo cáo.
2. Tầng phân nhóm: Gom nhóm theo từng Phòng ban tham gia (Thi công, Thiết kế, MEP, Xưởng, Mua hàng...) hoặc theo gói Hạng mục công việc / Nhân sự phụ trách.
3. Tầng công việc chi tiết (Tasks): Từng thanh công việc cụ thể gắn liền với nhân sự phụ trách (PIC), khung thời gian thực hiện, phần trăm hoàn thành và dây nối liên kết phụ thuộc giữa các việc.

Còn về cấu trúc mã nguồn máy tính và dữ liệu kỹ thuật nội bộ của hệ thống thì em không được phép chia sẻ anh/chị nhé.`;
        }

        // --------------------------------------------------------------------
        // TRƯỜNG HỢP 1: Khách hỏi về CÁCH SỬ DỤNG phần mềm
        // --------------------------------------------------------------------
        // 1.1 Xóa dự án / hủy dự án
        if (queryLower.includes("xóa dự án") || queryLower.includes("hủy dự án") || queryLower.includes("delete project") || queryLower.includes("bỏ dự án")) {
            return `Để xóa hoặc đóng một dự án trên hệ thống:

1. Chọn dự án cần xử lý ở danh sách bên cột trái màn hình.
2. Nhìn lên thanh công cụ phía trên góc phải, bấm vào nút mũi tên xổ xuống [Menu chức năng].
3. Chọn mục [Đóng dự án]. Dự án sẽ được chuyển vào mục "Kho dự án đã đóng" ở cột bên trái để lưu trữ hồ sơ.

Lưu ý: Chỉ tài khoản Trưởng phòng tạo ra dự án đó hoặc Quản trị viên (Admin) mới có quyền đóng hoặc xóa dự án để tránh mất mát dữ liệu công trình.`;
        }

        // 1.2 Thêm / tạo dự án mới
        if (queryLower.includes("thêm dự án") || queryLower.includes("tạo dự án") || queryLower.includes("khởi tạo dự án") || queryLower.includes("create project") || queryLower.includes("làm sao để tạo dự án") || queryLower.includes("làm sao để thêm dự án")) {
            return `Để khởi tạo một dự án mới:

1. Ở cột menu bên trái màn hình, bấm vào nút [+ Create Project].
2. Điền Tên dự án, Mã bảo vệ (hoặc để hệ thống tự tạo), Người phụ trách chính và Giám sát dự án.
3. Ở ô "Vị Trí Phân Loại Dự Án", chọn đúng nhu cầu:
   - Public Project (Dự án vùng chung): Các phòng ban cùng phối hợp làm việc.
   - Department Jobs (Công việc nội bộ): Dành riêng cho từng phòng ban quản lý nội bộ.
   - Plan Report (Kế hoạch báo cáo): Dành cho lập kế hoạch và báo cáo.
4. Bấm [OK Khởi Tạo] để hoàn tất. Chức năng này dành cho Trưởng phòng hoặc Quản trị viên.`;
        }

        // 1.3 Thêm / tạo công việc (task)
        if (queryLower.includes("tạo việc") || queryLower.includes("thêm việc") || queryLower.includes("tạo task") || queryLower.includes("thêm task") || queryLower.includes("làm sao để thêm việc") || queryLower.includes("làm sao để tạo việc")) {
            return `Để thêm một công việc mới vào bảng tiến độ:

1. Bấm vào nút [+ Thêm Task] màu xanh lá ở thanh công cụ góc trên bên phải màn hình.
2. Điền Tên công việc, chọn Người phụ trách chính (PIC), chọn Phòng ban và chọn Ngày bắt đầu - Ngày kết thúc.
3. Bấm nút Lưu để hoàn tất. Thanh công việc sẽ lập tức xuất hiện trên bảng Gantt và tự động canh đúng vị trí theo lịch.`;
        }

        // 1.4 Xóa công việc / xóa task
        if (queryLower.includes("xóa việc") || queryLower.includes("xóa task") || queryLower.includes("bỏ task") || queryLower.includes("hủy việc")) {
            return `Để xóa một công việc trên bảng:

1. Bấm đúp vào thanh công việc đó (hoặc bấm vào tên việc ở cột bên trái) để mở bảng thông tin chi tiết.
2. Bấm vào nút [Xóa công việc] màu đỏ ở góc dưới bảng và bấm xác nhận.

Lưu ý: Chỉ tài khoản Trưởng phòng phụ trách hoặc Quản trị viên mới có quyền xóa công việc.`;
        }

        // 1.5 Nối dây liên kết tiến độ
        if (queryLower.includes("nối dây") || queryLower.includes("dây nối") || queryLower.includes("liên kết") || queryLower.includes("kéo dây") || queryLower.includes("dây cáp")) {
            return `Để tạo liên kết dây nối tiến độ giữa 2 công việc:

1. Bấm nút [Hiện liên kết] màu vàng trên thanh công cụ phía trên để bật hiển thị các sợi dây nối.
2. Rê chuột vào điểm tròn nhỏ xuất hiện ở đuôi thanh công việc thứ nhất.
3. Bấm giữ chuột từ điểm tròn đó rồi kéo sang điểm tròn ở đầu thanh công việc thứ hai rồi thả tay ra.

Hai công việc sẽ được liên kết với nhau. Khi công việc thứ nhất dịch chuyển ngày, công việc thứ hai sẽ tự động dịch chuyển theo để đảm bảo đúng quy trình thi công.`;
        }

        // 1.6 Đổi chế độ xem
        if (queryLower.includes("chế độ xem") || queryLower.includes("xem theo") || queryLower.includes("đổi góc nhìn") || queryLower.includes("xem nhân sự") || queryLower.includes("xem hạng mục")) {
            return `Để chuyển đổi góc nhìn theo dõi công việc:

Anh/chị bấm vào nút [Chế độ xem] màu vàng trên thanh công cụ:
- Chế độ Hạng mục: Gom nhóm các việc theo từng gói hạng mục công việc.
- Chế độ Nhân sự: Gom nhóm các việc theo từng nhân viên phụ trách để dễ quản lý ai đang làm việc gì.`;
        }

        // 1.7 Đổi tên dự án
        if (queryLower.includes("đổi tên dự án") || queryLower.includes("sửa tên dự án")) {
            return `Để đổi tên dự án:

Anh/chị nhìn lên tên dự án ở thanh phía trên, ngay cạnh tên có biểu tượng cây bút chỉnh sửa. Bấm vào cây bút đó, nhập tên mới và bấm OK để hệ thống lưu lại.`;
        }

        // 1.8 Cập nhật tiến độ / sửa công việc
        if (queryLower.includes("cập nhật tiến độ") || queryLower.includes("sửa việc") || queryLower.includes("sửa task") || queryLower.includes("báo cáo tiến độ")) {
            return `Để cập nhật tiến độ công việc:

1. Bấm vào thanh công việc cần cập nhật trên bảng tiến độ.
2. Trong cửa sổ hiện ra, kéo thanh trượt phần trăm tiến độ (từ 0% đến 100%).
3. Điền ghi chú hoặc đính kèm ảnh nếu có, sau đó bấm Lưu để hoàn tất.`;
        }

        // --------------------------------------------------------------------
        // TRƯỜNG HỢP 2: Khách hỏi về DỮ LIỆU trong chart (Trợ lý nội dung)
        // --------------------------------------------------------------------
        // 2.1 Việc trễ hạn / chậm tiến độ / vấn đề
        if (queryLower.includes("chậm") || queryLower.includes("trễ") || queryLower.includes("vấn đề") || queryLower.includes("gặp vấn đề") || queryLower.includes("quá hạn")) {
            if (!snapshot.hasProject || snapshot.totalTasks === 0) {
                return `Dự án hiện tại chưa có danh sách công việc trên bảng để kiểm tra tiến độ. Anh/chị hãy thêm công việc vào dự án trước nhé.`;
            }

            if (snapshot.overdueTasks && snapshot.overdueTasks.length > 0) {
                let reply = `Em vừa rà soát dự án "${snapshot.projectName}", hiện có ${snapshot.overdueTasks.length} công việc bị trễ so với kế hoạch:\n\n`;
                snapshot.overdueTasks.forEach((t, i) => {
                    reply += `${i + 1}. ${t.name}\n`;
                    reply += `   - Phụ trách: ${t.staff} (${t.dept})\n`;
                    reply += `   - Hạn hoàn thành: ${t.end} (Đã quá ${t.daysLate} ngày)\n`;
                    reply += `   - Tiến độ hiện tại: ${t.progress}%\n`;
                    if (t.notes) reply += `   - Ghi chú: ${t.notes}\n`;
                    reply += `\n`;
                });
                reply += `Anh/chị nên đôn đốc các nhân sự phụ trách hoàn thành hoặc điều chỉnh ngày kết thúc trên lịch để các công việc tiếp theo không bị dồn toa.`;
                return reply;
            } else {
                return `Em vừa kiểm tra toàn bộ danh sách trong dự án "${snapshot.projectName}". Hiện tại không có công việc nào bị trễ hạn. Toàn bộ ${snapshot.totalTasks} công việc đều đang chạy đúng khung thời gian dự kiến.`;
            }
        }

        // 2.2 Nhân viên làm nhiều task nhất / ít task nhất (Phân tích định lượng)
        if (queryLower.includes("nhiều task nhất") || queryLower.includes("nhiều việc nhất") || queryLower.includes("làm nhiều nhất") || queryLower.includes("nhiều công việc nhất") || queryLower.includes("nhiều task")) {
            if (!snapshot.hasProject || Object.keys(snapshot.staffSummary).length === 0) {
                return `Dự án "${snapshot.projectName}" hiện chưa có dữ liệu công việc được phân công cho nhân sự.`;
            }
            let maxCount = -1;
            let topStaff = [];
            for (const [st, tList] of Object.entries(snapshot.staffSummary)) {
                if (st === "Chưa phân công") continue;
                if (tList.length > maxCount) {
                    maxCount = tList.length;
                    topStaff = [st];
                } else if (tList.length === maxCount) {
                    topStaff.push(st);
                }
            }
            if (topStaff.length === 0 || maxCount <= 0) {
                return `Hiện tại các công việc trong dự án "${snapshot.projectName}" chưa được gán cho nhân sự cụ thể nào.`;
            }
            let reply = `Trong dự án "${snapshot.projectName}", nhân sự đang phụ trách nhiều công việc nhất là: **${topStaff.join(" và ")}** với **${maxCount} công việc**:\n\n`;
            topStaff.forEach(st => {
                reply += `- ${st}:\n`;
                snapshot.staffSummary[st].forEach((t, i) => {
                    const stt = t.completed || t.progress >= 100 ? "Đã xong" : (t.overdue ? "Đang trễ hạn" : `Đang làm ${t.progress}%`);
                    reply += `  ${i + 1}. ${t.name} (${stt}, hạn chót: ${t.end})\n`;
                });
                reply += `\n`;
            });
            return reply.trim();
        }

        if (queryLower.includes("ít task nhất") || queryLower.includes("ít việc nhất") || queryLower.includes("làm ít nhất")) {
            if (!snapshot.hasProject || Object.keys(snapshot.staffSummary).length === 0) {
                return `Dự án "${snapshot.projectName}" hiện chưa có dữ liệu phân công công việc.`;
            }
            let minCount = 999999;
            let minStaff = [];
            for (const [st, tList] of Object.entries(snapshot.staffSummary)) {
                if (st === "Chưa phân công") continue;
                if (tList.length < minCount) {
                    minCount = tList.length;
                    minStaff = [st];
                } else if (tList.length === minCount) {
                    minStaff.push(st);
                }
            }
            return `Trong dự án "${snapshot.projectName}", nhân sự phụ trách ít công việc nhất là: **${minStaff.join(" và ")}** với **${minCount} công việc**.`;
        }

        // 2.3 Công việc của một nhân viên cụ thể (tìm theo tên nhân viên)
        if (snapshot.hasProject && snapshot.staffSummary) {
            for (const staffName in snapshot.staffSummary) {
                if (staffName && staffName !== "Chưa phân công" && queryLower.includes(staffName.toLowerCase())) {
                    const tasksOfStaff = snapshot.staffSummary[staffName];
                    let reply = `Trong dự án "${snapshot.projectName}", bạn ${staffName} đang phụ trách ${tasksOfStaff.length} công việc:\n\n`;
                    tasksOfStaff.forEach((t, i) => {
                        let statusStr = "";
                        if (t.completed || t.progress >= 100) statusStr = "Đã hoàn thành 100%";
                        else if (t.overdue) statusStr = `Đang trễ hạn (${t.progress}%, hạn chót ${t.end})`;
                        else statusStr = `Đang thực hiện (${t.progress}%)`;

                        reply += `${i + 1}. ${t.name}\n`;
                        reply += `   - Trạng thái: ${statusStr}\n`;
                        reply += `   - Thời gian: Từ ${t.start} đến ${t.end}\n\n`;
                    });
                    return reply;
                }
            }
        }

        // 2.4 Tổng quan phân công nhân sự
        if (queryLower.includes("nhân sự") || queryLower.includes("nhân viên") || queryLower.includes("phân công") || queryLower.includes("khối lượng")) {
            if (!snapshot.hasProject || Object.keys(snapshot.staffSummary).length === 0) {
                return `Dự án "${snapshot.projectName}" hiện chưa có danh sách công việc được phân bổ cho nhân sự.`;
            }
            let reply = `Bảng phân công nhân sự trong dự án "${snapshot.projectName}" như sau:\n\n`;
            for (const [staff, tList] of Object.entries(snapshot.staffSummary)) {
                const completedCount = tList.filter(t => t.completed || t.progress >= 100).length;
                const overdueCount = tList.filter(t => t.overdue).length;
                reply += `- ${staff}: ${tList.length} việc (Đã xong: ${completedCount}, Đang trễ: ${overdueCount})\n`;
            }
            reply += `\nAnh/chị có thể hỏi cụ thể tên từng bạn (ví dụ: "công việc của bạn ${Object.keys(snapshot.staffSummary)[0]} thế nào?") để em báo cáo chi tiết nhé.`;
            return reply;
        }

        // 2.5 Hỏi về công việc hôm nay / tuần này / theo ngày
        if (queryLower.includes("hôm nay") || queryLower.includes("tuần này") || queryLower.includes("tuần") || queryLower.includes("ngày") || queryLower.includes("việc tuần")) {
            if (!snapshot.hasProject || snapshot.totalTasks === 0) {
                return `Dự án "${snapshot.projectName}" hiện chưa có công việc nào trên bảng để tra cứu theo ngày.`;
            }
            const activeNow = snapshot.allTasks.filter(t => !t.completed && t.progress < 100);
            let reply = `Trong dự án "${snapshot.projectName}", hiện có ${activeNow.length} công việc đang trong giai đoạn triển khai:\n\n`;
            activeNow.slice(0, 6).forEach((t, i) => {
                reply += `${i + 1}. ${t.name}\n`;
                reply += `   - Người làm: ${t.staff} (${t.dept})\n`;
                reply += `   - Thời hạn: ${t.start} đến ${t.end}\n`;
                reply += `   - Tiến độ: ${t.progress}%\n\n`;
            });
            if (activeNow.length > 6) {
                reply += `... và còn ${activeNow.length - 6} công việc khác nữa trên lịch tiến độ.`;
            }
            return reply;
        }

        // 2.6 Tổng quan tiến độ dự án
        if (queryLower.includes("tiến độ") || queryLower.includes("tổng quan") || queryLower.includes("dự án thế nào") || queryLower.includes("tình hình")) {
            if (!snapshot.hasProject || snapshot.totalTasks === 0) {
                return `Dự án "${snapshot.projectName}" hiện chưa có công việc nào được tạo trên bảng.`;
            }
            const percent = snapshot.totalTasks > 0 ? Math.round((snapshot.completedTasks / snapshot.totalTasks) * 100) : 0;
            return `Báo cáo tổng quan dự án "${snapshot.projectName}":

- Người chỉ huy: ${snapshot.manager}
- Thời gian dự án: Từ ${snapshot.startRange} đến ${snapshot.endRange}
- Tổng số công việc: ${snapshot.totalTasks} việc
- Đã hoàn thành: ${snapshot.completedTasks} việc (${percent}%)
- Đang trễ hạn: ${snapshot.overdueTasks.length} việc

Anh/chị cần em kiểm tra chi tiết phần công việc nào không ạ?`;
        }

        // --------------------------------------------------------------------
        // Mặc định: Phản hồi tự nhiên, thân thiện và linh hoạt
        // --------------------------------------------------------------------
        return `Dạ em Mina đây ạ. Em luôn sẵn sàng đồng hành cùng anh/chị.

Về dự án "${snapshot.projectName}" đang mở, anh/chị có cần em kiểm tra công việc nào của các bạn nhân sự, tra cứu việc trễ hạn hay hỗ trợ thao tác gì trên bảng không ạ?`;
    }

    // 4. SEND MESSAGE LOGIC
    async function sendMessage(userText) {
        if (!userText || !userText.trim()) return;
        const text = userText.trim();

        const inputEl = document.getElementById("minh-anh-user-input");
        if (inputEl) inputEl.value = "";

        // Append user message
        appendMessage("user", text);

        // Show typing indicator
        showTyping(true);

        const snapshot = getLiveProjectSnapshot();

        chatHistory.push({ role: "user", content: text });
        if (chatHistory.length > 10) chatHistory.shift();

        let botReply = "";

        if (isMaliciousOrExploitQuery(text)) {
            botReply = `Dạ em chỉ phụ trách hỗ trợ hướng dẫn sử dụng và theo dõi tiến độ công việc trên dự án anh/chị đang mở thôi ạ.

Các thông tin về kỹ thuật nội bộ, mã nguồn hoặc dữ liệu bảo mật em không được phép chia sẻ. Anh/chị thông cảm cho em nhé. Anh/chị cần em hỗ trợ kiểm tra công việc nào trên bảng không ạ?`;
        } else {
            // Ưu tiên kiểm tra: Nếu là câu hỏi về tính năng, nghiệp vụ phần mềm (D2D, HDSD, tạo/xóa việc, đẩy tag...)
            const localDirectAnswer = generateSmartLocalAnswer(text, snapshot);
            const isDefaultFallback = !localDirectAnswer || localDirectAnswer.startsWith("Dạ em Mina đây ạ. Em luôn sẵn sàng");

            if (!isDefaultFallback) {
                // Trả lời trực tiếp đầy đủ, chính xác 100%
                botReply = localDirectAnswer;
            } else {
                // Danh sách endpoint AI: ưu tiên /api/ai/chat trên Cloudflare Pages (nơi đã có binding AI)
                const candidateUrls = [
                    "/api/ai/chat",
                    (window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev") + "/api/ai/chat"
                ];

                for (const apiUrl of candidateUrls) {
                    try {
                        const authHeaders = (window.authMgr && window.authMgr.getAuthHeaders)
                            ? window.authMgr.getAuthHeaders()
                            : { "Content-Type": "application/json" };
                        const curUser = (window.authMgr && window.authMgr.getCurrentUser) ? window.authMgr.getCurrentUser() : null;
                        const response = await fetch(apiUrl, {
                            method: "POST",
                            headers: authHeaders,
                            body: JSON.stringify({
                                messages: chatHistory,
                                projectContext: snapshot,
                                userRole: curUser ? curUser.role : "ADMIN"
                            })
                        });

                        if (response.ok) {
                            const data = await response.json();
                            if (data && data.reply) {
                                botReply = stripEmojis(data.reply);
                                break;
                            }
                        }
                    } catch (err) {
                        // Thử endpoint tiếp theo
                    }
                }

                if (!botReply) {
                    botReply = localDirectAnswer;
                }
            }
        }

        showTyping(false);

        // Clean any remaining emojis
        botReply = stripEmojis(botReply);

        appendMessage("bot", botReply);
        chatHistory.push({ role: "assistant", content: botReply });
        if (chatHistory.length > 10) chatHistory.shift();
    }

    // 5. RENDER CHAT BUBBLES
    function appendMessage(sender, text) {
        const bodyEl = document.getElementById("minh-anh-chat-body");
        if (!bodyEl) return;

        const msgDiv = document.createElement("div");
        msgDiv.className = `minh-anh-msg ${sender}`;

        if (sender === "bot") {
            const cleanText = stripEmojis(text);
            let formatted = cleanText
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');

            msgDiv.innerHTML = `
                <img src="./asset/avartar_Minh_Anh.jpg" class="minh-anh-msg-avatar" alt="Minh Anh">
                <div class="minh-anh-bubble">${formatted}</div>
            `;
        } else {
            msgDiv.innerHTML = `
                <div class="minh-anh-bubble">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            `;
        }

        bodyEl.appendChild(msgDiv);
        bodyEl.scrollTop = bodyEl.scrollHeight;
    }

    function showTyping(show) {
        const typingEl = document.getElementById("minh-anh-typing-indicator");
        const bodyEl = document.getElementById("minh-anh-chat-body");
        if (typingEl) {
            typingEl.style.display = show ? "flex" : "none";
            if (show && bodyEl) {
                bodyEl.appendChild(typingEl);
                bodyEl.scrollTop = bodyEl.scrollHeight;
            }
        }
    }

    // 6. TOGGLE WINDOW & DRAGGABLE MECHANICS
    function toggleChat(open) {
        const box = document.getElementById("minh-anh-chat-box");
        const fab = document.getElementById("minh-anh-fab");
        if (!box) return;

        const isCurrentlyOpen = box.style.display === "flex";
        const willOpen = (typeof open === "boolean") ? open : !isCurrentlyOpen;

        if (willOpen) {
            box.style.display = "flex";
            if (fab) fab.style.transform = "scale(0.9)";
            const input = document.getElementById("minh-anh-user-input");
            if (input) setTimeout(() => input.focus(), 150);
        } else {
            box.style.display = "none";
            if (fab) fab.style.transform = "";
        }
    }

    function makeDraggable(boxEl, handleEl) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handleEl.addEventListener("mousedown", (e) => {
            if (e.target.closest(".minh-anh-header-actions")) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = boxEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            boxEl.style.left = `${initialLeft}px`;
            boxEl.style.top = `${initialTop}px`;
            boxEl.style.right = "auto";
            boxEl.style.bottom = "auto";

            document.body.style.userSelect = "none";
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            const maxLeft = window.innerWidth - boxEl.offsetWidth - 10;
            const maxTop = window.innerHeight - boxEl.offsetHeight - 10;

            if (newLeft < 10) newLeft = 10;
            if (newLeft > maxLeft) newLeft = maxLeft;
            if (newTop < 10) newTop = 10;
            if (newTop > maxTop) newTop = maxTop;

            boxEl.style.left = `${newLeft}px`;
            boxEl.style.top = `${newTop}px`;
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = "";
            }
        });
    }

    // 7. INITIALIZE COMPONENT
    function init() {
        if (isInitialized) return;
        isInitialized = true;

        const fab = document.getElementById("minh-anh-fab");
        const box = document.getElementById("minh-anh-chat-box");
        const header = document.querySelector(".minh-anh-header");
        const minBtn = document.getElementById("minh-anh-min-btn");
        const closeBtn = document.getElementById("minh-anh-close-btn");
        const sendBtn = document.getElementById("minh-anh-send-btn");
        const input = document.getElementById("minh-anh-user-input");

        if (fab) fab.addEventListener("click", () => toggleChat());
        if (minBtn) minBtn.addEventListener("click", () => toggleChat(false));
        if (closeBtn) closeBtn.addEventListener("click", () => toggleChat(false));

        if (header && box) {
            makeDraggable(box, header);
        }

        if (sendBtn && input) {
            sendBtn.addEventListener("click", () => sendMessage(input.value));
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input.value);
                }
            });
        }

        // Bind quick suggestion chips (delegated or static)
        document.querySelectorAll(".minh-anh-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                const query = chip.getAttribute("data-query") || chip.innerText;
                sendMessage(query);
            });
        });

        // Set initial greeting
        const bodyEl = document.getElementById("minh-anh-chat-body");
        if (bodyEl && bodyEl.children.length <= 1) {
            appendMessage("bot", INITIAL_BOT_GREETING);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.minhAnhAI = {
        open: () => toggleChat(true),
        close: () => toggleChat(false),
        ask: (q) => sendMessage(q)
    };
})();

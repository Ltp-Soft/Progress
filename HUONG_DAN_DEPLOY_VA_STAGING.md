# HƯỚNG DẪN THIẾT LẬP TOÀN DIỆN: CLOUDFLARE (D1, R2, PAGES), SEPAY, RESEND & LUỒNG STAGING REVIEW
> **Dự án:** LTP Progress Hub SaaS (Multi-Tenant Construction & Production Schedule)  
> **Đơn vị sở hữu:** CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ LÊ TÀI PHÁT (LTP SOFT)  
> **GitHub Repository:** `https://github.com/Ltp-Soft/Progress.git`

---

## PHẦN 1: BẢNG ĐẶT TÊN CHUẨN ĐỒNG BỘ HỆ SINH THÁI LTP SOFT

Để không bị nhầm lẫn với dự án Chấm Công (`ltp-attendance`) trong cùng tài khoản Cloudflare của bạn, hãy đặt tên cho dự án Quản Lý Tiến Độ theo đúng bảng chuẩn sau:

| Thành phần | Tên chuẩn cần đặt | Tên biến Binding (Bắt buộc gõ đúng) | Ghi chú |
| :--- | :--- | :--- | :--- |
| **1. GitHub Repo** | `Progress` | — | `https://github.com/Ltp-Soft/Progress.git` |
| **2. Cloudflare Pages** | `ltp-progress-hub` | — | Sinh ra link gốc: `ltp-progress-hub.pages.dev` |
| **3. D1 Database (Chính)** | `ltp_progress_db` | **`DB`** | Lưu dữ liệu khách hàng thực tế (Production) |
| **4. D1 Database (Test)** | `ltp_progress_db_staging` | **`DB`** *(ở cột Preview)* | Lưu dữ liệu test nhánh `staging` (không chạm khách thật) |
| **5. R2 Bucket (File/Bản vẽ)** | `ltp-progress-files` | **`MY_BUCKET`** | Lưu bản vẽ CAD, PDF, ZIP, ảnh báo cáo tiến độ |
| **6. Workers AI (Mina)** | *(Có sẵn của Cloudflare)* | **`AI`** | Chạy mô hình Llama 3.1 cho trợ lý Mina |

---

## PHẦN 2: CẤU HÌNH TỪNG BƯỚC TRÊN CLOUDFLARE (CHỈ LÀM 1 LẦN)

### BƯỚC 1: TẠO CƠ SỞ DỮ LIỆU CLOUDFLARE D1 (`ltp_progress_db`)
1. Đăng nhập [Cloudflare Dashboard](https://dash.cloudflare.com) $\rightarrow$ Menu trái chọn **Storage & Databases** $\rightarrow$ **D1 SQL Database**.
2. Bấm **Create database** $\rightarrow$ Đặt tên: **`ltp_progress_db`** $\rightarrow$ Bấm **Create**.
3. *(Tùy chọn an toàn tuyệt đối cho Staging)*: Tạo thêm 1 database thứ 2 tên là **`ltp_progress_db_staging`** để khi bạn test bản cập nhật mới ở link Staging thì thoải mái xóa/sửa mà không đụng vào dữ liệu khách hàng.
4. Vào tab **Console** của cả 2 database, mở file [`schema.sql`](file:///d:/Progress_Hub_LTP/schema.sql), copy toàn bộ nội dung dán vào ô Console và bấm **Execute**. *(Hoặc hệ thống cũng đã có cơ chế tự động chạy `ensureMultiTenantSchema` ngay lần đầu gọi API).*

---

### BƯỚC 2: TẠO KHO LƯU TRỮ CLOUDFLARE R2 (`ltp-progress-files`)
1. Menu trái chọn **Storage & Databases** $\rightarrow$ **R2 Object Storage**.
2. Bấm **Create bucket**.
3. Đặt tên chính xác: **`ltp-progress-files`** $\rightarrow$ Bấm **Create bucket**.

---

### BƯỚC 3: KẾT NỐI GITHUB `Ltp-Soft/Progress` VỚI CLOUDFLARE PAGES & BẬT NHÁNH `staging`
1. Menu trái chọn **Compute (Workers)** $\rightarrow$ **Workers & Pages**.
2. Bấm **Create application** $\rightarrow$ Tab **Pages** $\rightarrow$ **Connect to Git**.
3. Chọn tài khoản `Ltp-Soft` $\rightarrow$ Chọn kho **`Progress`**.
4. Thiết lập **Build settings**:
   * **Project name:** `ltp-progress-hub`
   * **Production branch:** `main`
   * **Framework preset:** `None` *(Vì bộ code đã tối ưu thuần HTML/JS + Cloudflare Pages Functions `/functions/api/[[path]].js` chạy trực tiếp siêu tốc, không cần bước biên dịch phức tạp)*
   * **Build command:** *(Để trống)*
   * **Build output directory:** `/` *(hoặc để mặc định)*
5. Bấm **Save and Deploy**.
6. **Kích hoạt link Staging tự động:**
   * Vào dự án `ltp-progress-hub` $\rightarrow$ **Settings** $\rightarrow$ **Builds & deployments**.
   * Tại mục **Preview deployments**, chọn **All non-production branches** (hoặc chọn nhánh **`staging`**).
   * Từ nay, hễ bạn đẩy code lên nhánh `staging`, Cloudflare sẽ cấp riêng cho bạn link:
     👉 **`https://staging.ltp-progress-hub.pages.dev`** để bạn review trước khi gộp vào `main`.

---

### BƯỚC 4: GẮN BINDINGS (D1, R2, AI) CHO CẢ PRODUCTION & STAGING (PREVIEW)
Vào dự án Pages `ltp-progress-hub` $\rightarrow$ **Settings** $\rightarrow$ **Functions**:

1. **D1 database bindings:**
   * Bấm **Add binding**:
   * Variable name: **`DB`** *(Bắt buộc gõ hoa đúng chữ `DB`)*
   * Môi trường **Production**: Chọn `ltp_progress_db`
   * Môi trường **Preview (Staging)**: Chọn `ltp_progress_db_staging` *(hoặc `ltp_progress_db`)*
2. **R2 bucket bindings:**
   * Bấm **Add binding**:
   * Variable name: **`MY_BUCKET`** *(Bắt buộc gõ đúng `MY_BUCKET`)*
   * Chọn bucket: `ltp-progress-files` cho cả Production và Preview.
3. **Workers AI bindings:**
   * Bấm **Add binding**:
   * Variable name: **`AI`** *(cho cả Production và Preview)*.

---

### BƯỚC 5: KHAI BÁO BIẾN MÔI TRƯỜNG (SEPAY VIETQR, RESEND EMAIL, BẢO MẬT)
Vào dự án Pages `ltp-progress-hub` $\rightarrow$ **Settings** $\rightarrow$ **Environment variables** $\rightarrow$ Thêm các biến sau cho cả **Production** và **Preview**:

| Tên biến (Variable Name) | Giá trị (Value) | Ý nghĩa |
| :--- | :--- | :--- |
| **`ROOT_DOMAIN`** | `ltp-soft.com` | Tên miền gốc của bạn |
| **`AUTH_SECRET`** | `LTP_PROGRESS_SUPER_SECRET_KEY_2026` | Khóa mã hóa JWT & Token |
| **`VIETQR_BANK_BIN`** | `970422` | Mã BIN ngân hàng (VD: `970422` là MBBank, giống bên Chấm công) |
| **`VIETQR_ACCOUNT_NO`** | *(Số tài khoản của bạn)* | Số tài khoản nhận tiền VietQR |
| **`VIETQR_ACCOUNT_NAME`** | `CONG TY LTP SOFT` | Tên chủ tài khoản không dấu |
| **`RESEND_API_KEY`** | `re_BQejyjFu_3EsgN6Gtdsp1r5FqYh749F1g` | API Key Resend gửi mã OTP, Quên mật khẩu & Email kích hoạt gói |
| **`EMAIL_FROM`** | `LTP Soft <no-reply@ltp-soft.com>` | Địa chỉ người gửi hiển thị trong hộp thư khách hàng |
| **`GEMINI_API_KEY`** | *(API Key Gemini của bạn - nếu có)* | Để trợ lý Mina chạy model Gemini 2.5 Flash |

> 💡 **Lưu ý sau khi bấm Save:** Vào tab **Deployments** $\rightarrow$ Bấm dấu `...` ở bản mới nhất $\rightarrow$ Chọn **Retry deployment** để các biến vừa cài có hiệu lực ngay.

---

## PHẦN 3: HƯỚNG DẪN MÓC SEPAY DÙNG CHUNG TÀI KHOẢN VỚI DỰ ÁN CHẤM CÔNG

Bạn **không cần tạo tài khoản SePay mới** và **không cần đổi tài khoản ngân hàng**.
- Bên dự án **Chấm Công**, mã đơn hàng có đầu mã là **`LTPxxxxx`** (ví dụ: `LTP12345`).
- Bên dự án **Tiến Độ (LTP Progress Hub)** này, mình đã thiết kế mã đơn hàng có đầu mã riêng là **`PRGxxxxx`** (ví dụ: `PRG68291`), đồng thời vẫn nhận diện cả `LTPxxxxx` nếu cần.

### Cách thêm Webhook thứ 2 trên SePay:
1. Đăng nhập vào [my.sepay.vn](https://my.sepay.vn) $\rightarrow$ Vào mục **Tích hợp Webhooks**.
2. Giữ nguyên Webhook của bên Chấm công, bấm nút **+ Thêm Webhook mới**:
   * **Tên gợi nhớ:** `LTP Progress Hub (Quản lý tiến độ)`
   * **Sự kiện:** `Có tiền vào (In)`
   * **Tài khoản ngân hàng:** Chọn cùng số tài khoản ngân hàng của bạn.
   * **Bỏ qua nếu nội dung giao dịch không có mã thanh toán:** Chọn **Có** $\rightarrow$ Tiền tố mã thanh toán: **`PRG`** *(Như vậy khách chuyển tiền mua Chấm công `LTP...` sẽ chỉ bắn về Chấm công, còn khách chuyển tiền mua Tiến độ `PRG...` hoặc mua thêm GB sẽ bắn thẳng về Progress Hub!)*.
   * **URL gọi đến (Webhook URL):**
     👉 **`https://progress.ltp-soft.com/api/webhook/sepay`** *(hoặc `https://ltp-progress-hub.pages.dev/api/webhook/sepay`)*
   * **Kiểu chứng thực:** `Không cần chứng thực` (hoặc API Key), **Content-Type:** `application/json`.
3. Bấm **Lưu lại**. Khi khách quét VietQR trên trang chủ hoặc trong Admin (mua gói / mua thêm +10GB), tiền vào tài khoản là sau 3–5 giây tài khoản tự động kích hoạt và gửi Email xác nhận!

---

## PHẦN 4: HƯỚNG DẪN MÓC EMAIL TỰ ĐỘNG & QUÊN MẬT KHẨU QUA RESEND

Hệ thống đã tích hợp sẵn **3 luồng Email tự động qua Resend** dùng chung tài khoản Resend `ltp-soft.com` của bạn:
1. **Email gửi mã OTP 6 số (`/api/public/send-otp`):** Chống spam tạo tài khoản rác khi khách hàng đăng ký Dùng thử 14 ngày hoặc mua gói.
2. **Email Quên mật khẩu & Đặt lại mật khẩu (`/api/public/send-otp` + `/api/auth/reset-password`):**
   * Ngay ở màn hình Đăng nhập ([`index.html`](file:///d:/Progress_Hub_LTP/index.html)), bấm vào **"Quên mật khẩu?"** $\rightarrow$ Nhập Email Admin $\rightarrow$ Nhận mã OTP 6 số qua Resend $\rightarrow$ Nhập mật khẩu mới là đổi xong ngay lập tức.
3. **Email Chào mừng & Xác nhận thanh toán tự động:**
   * Ngay khi khách bấm **Dùng thử 14 ngày** hoặc ngay khi **SePay báo thanh toán thành công**, hệ thống tự động gửi Email thông báo thông tin tài khoản Admin, Subdomain công ty và dung lượng gói cước về hộp thư của khách.

### Kiểm tra trên Resend.com:
- Vì bạn đã xác thực domain `ltp-soft.com` trên [Resend.com](https://resend.com/domains) từ dự án Chấm Công, bạn **chỉ cần dùng lại đúng `RESEND_API_KEY` đó**, không cần cấu hình lại DNS của Resend!

---

## PHẦN 5: QUY TRÌNH DÙNG NHÁNH `staging` ĐỂ REVIEW TRƯỚC KHI LÊN `main`

Mình đã khởi tạo sẵn cho bạn 2 nhánh Git song song:
- **`main`**: Nhánh chính thức cho khách hàng đang sử dụng (`progress.ltp-soft.com`).
- **`staging`**: Nhánh nháp (Staging/Review) để bạn kiểm tra tính năng mới tại `https://staging.ltp-progress-hub.pages.dev`.

### 1. Khi muốn thử nghiệm bản cập nhật mới (Không ảnh hưởng khách hàng):
```powershell
git checkout staging
# (Sau khi mình hoặc bạn chỉnh sửa code xong)
git add -A
git commit -m "update: thu nghiem tinh nang moi tren staging"
git push -u origin staging
```
👉 Mở link **`https://staging.ltp-progress-hub.pages.dev`** để xem và test.

### 2. Khi bạn đã review ưng ý 100% và quyết định đẩy lên `main` cho khách hàng:
```powershell
git checkout main
git merge staging
git push origin main
```
👉 Toàn bộ khách hàng trên `main` sẽ nhận được bản cập nhật mới chỉ sau 30 giây!

-- ============================================================================
-- LTP PROGRESS HUB SaaS — CLOUDFLARE D1 MULTI-TENANT DATABASE SCHEMA v9.0
-- Owner: CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ LÊ TÀI PHÁT (LTP SOFT)
-- Supports: Multi-Tenancy, Dynamic Department Tags, QR Waiting Room Onboarding,
-- Hardware Anti-Duplicate Guard, Granular Staff Task Permissions, R2 Storage Quotas,
-- VietQR + SePay Auto-Activation, and Employee Performance Analytics.
-- ============================================================================

-- 1. TENANTS (Doanh nghiệp thuê phần mềm)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    subdomain TEXT UNIQUE NOT NULL,
    custom_domain TEXT,
    company_name TEXT NOT NULL,
    slogan TEXT DEFAULT 'ALL PROGRESS IN ONE',
    owner_email TEXT NOT NULL,
    owner_phone TEXT,
    logo_url TEXT DEFAULT './asset/Logo_white.png',
    theme_config TEXT DEFAULT '{}',
    plan_type TEXT DEFAULT 'TRIAL', -- TRIAL, STARTER, BUSINESS, PRO, ENTERPRISE
    status TEXT DEFAULT 'TRIAL',    -- TRIAL, ACTIVE, EXPIRED, LOCKED
    max_users INTEGER DEFAULT 10,
    max_projects INTEGER DEFAULT 2,
    storage_limit_mb INTEGER DEFAULT 500,
    addon_storage_mb INTEGER DEFAULT 0,
    storage_used_bytes INTEGER DEFAULT 0,
    max_file_size_mb INTEGER DEFAULT 50,
    ai_daily_limit INTEGER DEFAULT 10,
    ai_used_today INTEGER DEFAULT 0,
    ai_usage_date TEXT,
    google_owner_id TEXT,
    device_fingerprint TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain ON tenants(custom_domain);

-- 2. DEPARTMENTS (Thẻ Bộ Phận / Phòng Ban động theo từng Công ty)
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT DEFAULT 'C',
    color TEXT DEFAULT '#2563eb',
    leader_user_id TEXT,
    default_task_mode TEXT DEFAULT 'REPORT_ONLY', -- REPORT_ONLY (🔒 Chỉ báo cáo) | AUTONOMOUS (🔓 Tự chủ)
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_depts_tenant ON departments(tenant_id);

-- 3. USERS (Tài khoản Admin tổng, Trưởng Ban QLDA/Admin con, Trưởng phòng, Nhân viên, Phòng chờ)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'tenant-demo',
    username TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    full_name TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    pass TEXT NOT NULL,
    password_hash TEXT DEFAULT '',
    password_plain_hint TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'STAFF', -- ADMIN, BOSS, PROJECT_ADMIN, DEPT_ADMIN, STAFF, WAITING, GUEST
    dept TEXT NOT NULL DEFAULT 'CONSTRUCTION',
    dept_tags TEXT DEFAULT '[]',        -- JSON Array of Department Codes attached to this user
    prefix TEXT DEFAULT 'C',
    task_permission_mode TEXT DEFAULT 'REPORT_ONLY', -- REPORT_ONLY | AUTONOMOUS
    managed_project_ids TEXT DEFAULT '[]',           -- JSON Array for PROJECT_ADMIN (Admin con Tập đoàn)
    is_active INTEGER DEFAULT 1,                     -- 1: Active, 0: Locked/Revoked, 2: Waiting Room (Chờ duyệt)
    device_fingerprint TEXT,
    google_id TEXT,
    external_sync_id TEXT,                           -- Hook đồng bộ với hệ thống Chấm công LTP Attendance
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id, username);

-- 4. QR INVITES & ANTI-DUPLICATE HARDWARE SCANS (QR Phòng chờ tuyển quân)
CREATE TABLE IF NOT EXISTS qr_invites (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id TEXT DEFAULT '',
    title TEXT DEFAULT 'Mã QR Gia Nhập Đội Ngũ',
    max_uses INTEGER DEFAULT 10,
    used_count INTEGER DEFAULT 0,
    default_dept TEXT DEFAULT '',
    require_google INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qr_invites_tenant ON qr_invites(tenant_id);

CREATE TABLE IF NOT EXISTS qr_invite_scans (
    id TEXT PRIMARY KEY,
    invite_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    hardware_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_lookup ON qr_invite_scans(invite_id, hardware_hash);

-- 5. PROJECTS (Dự án thi công, Đấu thầu, Nội bộ)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'tenant-demo',
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    creator_dept TEXT NOT NULL,
    creator_pic TEXT,
    project_manager TEXT,
    project_admin_id TEXT DEFAULT '',
    is_shared INTEGER DEFAULT 1,
    invited_depts TEXT DEFAULT '[]',
    allowed_user_ids TEXT DEFAULT '[]', -- Danh sách nhân sự cụ thể được phép xem (Dự án Đấu thầu / Nội bộ)
    project_tags TEXT DEFAULT '[]',
    category TEXT DEFAULT 'SHARED',
    status TEXT DEFAULT 'Active',
    closed_at TEXT,
    start_range TEXT,
    end_range TEXT,
    staffs TEXT DEFAULT '[]',
    storage_quota_mb INTEGER DEFAULT 0,
    storage_used_bytes INTEGER DEFAULT 0,
    max_project_users INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, status);

-- 6. TASKS (Công việc trên bảng tiến độ Gantt)
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'tenant-demo',
    project_id TEXT NOT NULL,
    code_in TEXT NOT NULL,
    code_out TEXT,
    name TEXT NOT NULL,
    staff TEXT,
    staff_user_id TEXT DEFAULT '',
    created_by_user_id TEXT DEFAULT '',
    dept TEXT NOT NULL,
    project_tag TEXT,
    start_date TEXT,
    end_date TEXT,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    is_started INTEGER DEFAULT 0,
    is_completed INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT '',
    progress_percent INTEGER DEFAULT 0,
    last_progress_date TEXT,
    has_files INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0,
    is_mirror INTEGER DEFAULT 0,
    source_task_id TEXT,
    source_project_id TEXT,
    source_dept TEXT,
    order_index INTEGER DEFAULT 0,
    notes TEXT,
    is_deleted INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_proj ON tasks(tenant_id, project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tasks_staff_user ON tasks(tenant_id, staff_user_id);

-- 7. TASK FILES (Tệp đính kèm lưu trên Cloudflare R2)
CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'tenant-demo',
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_key TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    uploaded_by TEXT,
    uploaded_by_user_id TEXT DEFAULT '',
    uploaded_at TEXT,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_tenant_proj ON task_files(tenant_id, project_id);

-- 8. PAYMENT ORDERS (Đơn hàng VietQR & SePay tự động)
CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    order_type TEXT DEFAULT 'NEW_REGISTER', -- NEW_REGISTER, RENEWAL, UPGRADE, ADDON_STORAGE
    subdomain_requested TEXT NOT NULL,
    company_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    billing_cycle TEXT DEFAULT 'YEARLY',    -- MONTHLY, YEARLY
    addon_gb INTEGER DEFAULT 0,
    original_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    amount REAL NOT NULL,
    coupon_code TEXT,
    affiliate_id TEXT,
    order_status TEXT DEFAULT 'PENDING',    -- PENDING, PAID, EXPIRED
    payment_reference TEXT,
    google_owner_id TEXT,
    device_fingerprint TEXT,
    owner_name TEXT,
    admin_password_hash TEXT,
    admin_password_plain TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_orders_lookup ON payment_orders(id, order_status);

-- 9. EMAIL OTP CODES (Xác thực OTP Email & Lấy lại mật khẩu)
CREATE TABLE IF NOT EXISTS email_otps (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    purpose TEXT DEFAULT 'REGISTER',
    tenant_subdomain TEXT DEFAULT '',
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email, purpose);

-- 10. APP SETTINGS PER TENANT
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (tenant_id, key)
);

-- 11. COUPONS, KOL AFFILIATES, COMMISSIONS, WITHDRAWALS & SUPER ADMINS
CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    affiliate_id TEXT,
    discount_percent INTEGER DEFAULT 10,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO coupons (code, discount_percent, is_active) VALUES ('LTPSOFT10', 10, 1), ('CHINHTHUC10', 10, 1), ('NAM10', 10, 1);

CREATE TABLE IF NOT EXISTS super_admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    full_name TEXT DEFAULT 'Root Super Admin',
    role TEXT DEFAULT 'SUPER_ADMIN',
    google_sub TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliates (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone_zalo TEXT DEFAULT '',
    email TEXT UNIQUE NOT NULL,
    bank_name TEXT DEFAULT '',
    bank_account_number TEXT DEFAULT '',
    bank_account_name TEXT DEFAULT '',
    ref_code TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING_APPROVAL', -- PENDING_APPROVAL (Chờ Admin duyệt tay), ACTIVE, BANNED
    commission_rate_first_year REAL DEFAULT 0.20,
    commission_rate_recurring REAL DEFAULT 0.10,
    balance_available REAL DEFAULT 0,
    balance_pending REAL DEFAULT 0,
    total_withdrawn REAL DEFAULT 0,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id TEXT PRIMARY KEY,
    affiliate_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    tenant_id TEXT,
    order_type TEXT DEFAULT 'NEW_ORDER',
    order_amount REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0.20,
    commission_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDING', -- PENDING (14 ngày), APPROVED, PAID
    unlock_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id TEXT PRIMARY KEY,
    affiliate_id TEXT NOT NULL,
    amount REAL NOT NULL,
    bank_info TEXT DEFAULT '',
    status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


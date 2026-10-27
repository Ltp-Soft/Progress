/**
 * LTP PROGRESS HUB SaaS — Cloudflare Worker & Pages API v9.0
 * Multi-Tenant Construction, Interior, MEP & Production Schedule Platform
 * Owner: CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ LÊ TÀI PHÁT (LTP SOFT)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PLANS = {
  TRIAL: {
    id: "TRIAL",
    name: "Dùng Thử 14 Ngày",
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: 10,
    maxProjects: 2,
    storageLimitMb: 500,
    maxFileSizeMb: 50,
    aiDailyLimit: 10,
    addonPricePer10Gb: 49000,
    isCorporate: false
  },
  STARTER: {
    id: "STARTER",
    name: "Gói Cơ Bản (Starter)",
    priceMonthly: 299000,
    priceYearly: 2990000,
    maxUsers: 15,
    maxProjects: 10,
    storageLimitMb: 10240, // 10 GB
    maxFileSizeMb: 200,
    aiDailyLimit: 25,
    addonPricePer10Gb: 49000,
    isCorporate: false
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Gói Phổ Biến (Business)",
    priceMonthly: 599000,
    priceYearly: 5990000,
    maxUsers: 40,
    maxProjects: 999999,
    storageLimitMb: 35840, // 35 GB
    maxFileSizeMb: 350,
    aiDailyLimit: 80,
    addonPricePer10Gb: 35000,
    isCorporate: false
  },
  PRO: {
    id: "PRO",
    name: "Gói Mở Rộng (Pro)",
    priceMonthly: 990000,
    priceYearly: 9900000,
    maxUsers: 100,
    maxProjects: 999999,
    storageLimitMb: 81920, // 80 GB
    maxFileSizeMb: 500,
    aiDailyLimit: 200,
    addonPricePer10Gb: 25000,
    isCorporate: false
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Gói Tập Đoàn (White-Label)",
    priceMonthly: 4500000,
    priceYearly: 45000000,
    maxUsers: 999999,
    maxProjects: 999999,
    storageLimitMb: 307200, // 300 GB
    maxFileSizeMb: 500,
    aiDailyLimit: 500,
    addonPricePer10Gb: 19000,
    isCorporate: true
  }
};

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".msi", ".sh", ".vbs", ".scr", ".pif", ".com", ".cpl", ".hta", ".jar", ".ps1"
]);

const DEFAULT_DEPARTMENTS = [
  { code: "CONSTRUCTION", name: "Thi Công (Construction)", prefix: "C", color: "#0284c7" },
  { code: "DESIGNER", name: "Thiết Kế (Designer)", prefix: "G", color: "#7c3aed" },
  { code: "PLANNING", name: "Kế Hoạch (Planning)", prefix: "P", color: "#0d9488" },
  { code: "FACTORY", name: "Xưởng SX (Factory)", prefix: "X", color: "#ea580c" },
  { code: "MEP", name: "Cơ Điện (MEP)", prefix: "E", color: "#2563eb" },
  { code: "STORAGE", name: "Kho Vật Tư (Storage)", prefix: "K", color: "#4f46e5" },
  { code: "PURCHASING", name: "Mua Hàng (Purchasing)", prefix: "H", color: "#059669" },
  { code: "ACCOUNTANT", name: "Kế Toán (Accountant)", prefix: "A", color: "#db2777" }
];

// ============================================================================
// CRYPTO & AUTH HELPERS (HMAC-SHA256 + PBKDF2)
// ============================================================================
function bytesToB64url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret(env) {
  return (env && env.AUTH_SECRET) || "LTP_PROGRESS_SUPER_SECRET_HMAC_KEY_2026_DEFAULT";
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signJwt(env, payload, ttlSeconds = 86400 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: (now + ttlSeconds) * 1000 };
  const data = bytesToB64url(enc.encode(JSON.stringify(body)));
  const key = await hmacKey(getSecret(env));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${bytesToB64url(sig)}`;
}

async function verifyJwt(env, token) {
  if (!token || typeof token !== "string") return null;
  if (!token.includes(".")) {
    try {
      const legacy = JSON.parse(atob(token));
      if (legacy && legacy.id) return { ...legacy, tenantId: legacy.tenantId || "tenant-demo" };
    } catch (e) {}
    return null;
  }
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  try {
    const key = await hmacKey(getSecret(env));
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(data));
    if (!ok) return null;
    const body = JSON.parse(dec.decode(b64urlToBytes(data)));
    if (body.exp && body.exp < Date.now()) return null;
    return body;
  } catch (e) {
    return null;
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 10000 }, baseKey, 256);
  return `pbkdf2$10000$${bytesToB64url(salt)}$${bytesToB64url(new Uint8Array(bits))}`;
}

async function verifyPassword(password, storedHash, storedPlain) {
  const cleanPass = String(password || "").trim();
  if (storedHash && storedHash.startsWith("pbkdf2$")) {
    try {
      const [, iterStr, saltStr, hashStr] = storedHash.split("$");
      const baseKey = await crypto.subtle.importKey("raw", enc.encode(cleanPass), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64urlToBytes(saltStr), iterations: Number(iterStr) }, baseKey, 256);
      const calcB64 = bytesToB64url(new Uint8Array(bits));
      if (calcB64 === hashStr) return true;
    } catch (e) {}
  }
  if (storedPlain && cleanPass === String(storedPlain).trim()) return true;
  if (storedHash && !storedHash.startsWith("pbkdf2$") && cleanPass === String(storedHash).trim()) return true;
  return false;
}

// ============================================================================
// EMAIL SENDER VIA RESEND API (OTP & PASSWORD RESET)
// ============================================================================
async function sendEmail({ to, subject, html, env = {} }) {
  const apiKey = env.RESEND_API_KEY || "re_BQejyjFu_3EsgN6Gtdsp1r5FqYh749F1g";
  const from = env.EMAIL_FROM || "LTP Soft <no-reply@ltp-soft.com>";
  const trySend = async (fromAddr) => {
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to: Array.isArray(to) ? to : [to], subject, html })
    });
  };
  try {
    let res = await trySend(from);
    let data = await res.json().catch(() => ({}));
    if (!res.ok) {
      res = await trySend("LTP Soft <onboarding@resend.dev>");
      data = await res.json().catch(() => ({}));
    }
    return { success: res.ok, id: data.id, error: res.ok ? null : (data.message || "Resend sandbox") };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// IDEMPOTENT MULTI-TENANT SCHEMA MIGRATION
// ============================================================================
let schemaReady = false;
async function ensureMultiTenantSchema(env) {
  if (!env || !env.DB || schemaReady) return;
  const db = env.DB;

  const stmts = [
    `CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      subdomain TEXT UNIQUE NOT NULL,
      custom_domain TEXT,
      company_name TEXT NOT NULL,
      slogan TEXT DEFAULT 'ALL PROGRESS IN ONE',
      owner_email TEXT NOT NULL,
      owner_phone TEXT,
      logo_url TEXT DEFAULT './asset/Logo_white.png',
      theme_config TEXT DEFAULT '{}',
      plan_type TEXT DEFAULT 'TRIAL',
      status TEXT DEFAULT 'TRIAL',
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
    )`,
    `CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT DEFAULT 'C',
      color TEXT DEFAULT '#2563eb',
      leader_user_id TEXT,
      default_task_mode TEXT DEFAULT 'REPORT_ONLY',
      order_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT DEFAULT 'tenant-demo',
      username TEXT,
      email TEXT,
      phone TEXT,
      full_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      pass TEXT NOT NULL,
      password_hash TEXT DEFAULT '',
      password_plain_hint TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'STAFF',
      dept TEXT NOT NULL DEFAULT 'CONSTRUCTION',
      dept_tags TEXT DEFAULT '[]',
      prefix TEXT DEFAULT 'C',
      task_permission_mode TEXT DEFAULT 'REPORT_ONLY',
      managed_project_ids TEXT DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      device_fingerprint TEXT,
      google_id TEXT,
      external_sync_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS qr_invites (
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
    )`,
    `CREATE TABLE IF NOT EXISTS qr_invite_scans (
      id TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hardware_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      order_type TEXT DEFAULT 'NEW_REGISTER',
      subdomain_requested TEXT NOT NULL,
      company_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      billing_cycle TEXT DEFAULT 'YEARLY',
      addon_gb INTEGER DEFAULT 0,
      original_amount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      amount REAL NOT NULL,
      coupon_code TEXT,
      affiliate_id TEXT,
      order_status TEXT DEFAULT 'PENDING',
      payment_reference TEXT,
      google_owner_id TEXT,
      device_fingerprint TEXT,
      owner_name TEXT,
      admin_password_hash TEXT,
      admin_password_plain TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS email_otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT DEFAULT 'REGISTER',
      tenant_subdomain TEXT DEFAULT '',
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (tenant_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      affiliate_id TEXT,
      discount_percent INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`
  ];

  for (const sql of stmts) {
    try { await db.prepare(sql).run(); } catch (e) {}
  }

  // Ensure new columns on legacy tables
  const alterColumns = [
    ["projects", "tenant_id", "TEXT DEFAULT 'tenant-demo'"],
    ["projects", "project_tags", "TEXT DEFAULT '[]'"],
    ["projects", "category", "TEXT DEFAULT 'SHARED'"],
    ["projects", "allowed_user_ids", "TEXT DEFAULT '[]'"],
    ["projects", "project_admin_id", "TEXT DEFAULT ''"],
    ["projects", "storage_quota_mb", "INTEGER DEFAULT 0"],
    ["projects", "storage_used_bytes", "INTEGER DEFAULT 0"],
    ["projects", "max_project_users", "INTEGER DEFAULT 0"],
    ["tasks", "tenant_id", "TEXT DEFAULT 'tenant-demo'"],
    ["tasks", "project_tag", "TEXT"],
    ["tasks", "is_mirror", "INTEGER DEFAULT 0"],
    ["tasks", "source_task_id", "TEXT"],
    ["tasks", "source_project_id", "TEXT"],
    ["tasks", "source_dept", "TEXT"],
    ["tasks", "order_index", "INTEGER DEFAULT 0"],
    ["tasks", "staff_user_id", "TEXT DEFAULT ''"],
    ["tasks", "created_by_user_id", "TEXT DEFAULT ''"],
    ["tasks", "start_time", "TEXT DEFAULT ''"],
    ["tasks", "end_time", "TEXT DEFAULT ''"],
    ["tasks", "completed_at", "TEXT DEFAULT ''"],
    ["task_files", "tenant_id", "TEXT DEFAULT 'tenant-demo'"],
    ["task_files", "uploaded_by_user_id", "TEXT DEFAULT ''"],
    ["users", "tenant_id", "TEXT DEFAULT 'tenant-demo'"],
    ["users", "username", "TEXT"],
    ["users", "email", "TEXT"],
    ["users", "phone", "TEXT"],
    ["users", "full_name", "TEXT DEFAULT ''"],
    ["users", "avatar_url", "TEXT DEFAULT ''"],
    ["users", "password_hash", "TEXT DEFAULT ''"],
    ["users", "password_plain_hint", "TEXT DEFAULT ''"],
    ["users", "dept_tags", "TEXT DEFAULT '[]'"],
    ["users", "task_permission_mode", "TEXT DEFAULT 'REPORT_ONLY'"],
    ["users", "managed_project_ids", "TEXT DEFAULT '[]'"],
    ["users", "is_active", "INTEGER DEFAULT 1"],
    ["users", "device_fingerprint", "TEXT"],
    ["users", "google_id", "TEXT"],
    ["users", "external_sync_id", "TEXT"]
  ];

  for (const [tbl, col, typeDef] of alterColumns) {
    try { await db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${typeDef}`).run(); } catch (e) {}
  }

  // Ensure Default Demo Tenant ('demo' / 'tenant-demo') exists so existing projects work seamlessly
  try {
    const demoTenant = await db.prepare("SELECT id FROM tenants WHERE id = 'tenant-demo' OR subdomain = 'demo'").first();
    if (!demoTenant) {
      await db.prepare(`
        INSERT OR IGNORE INTO tenants (
          id, subdomain, company_name, slogan, owner_email, logo_url,
          plan_type, status, max_users, max_projects, storage_limit_mb, max_file_size_mb, ai_daily_limit, expires_at
        ) VALUES (
          'tenant-demo', 'demo', 'LTP Progress Demo Corp', 'ALL PROGRESS IN ONE', 'admin@ltp-soft.com', './asset/Logo_white.png',
          'BUSINESS', 'ACTIVE', 40, 999999, 35840, 350, 80, datetime('now', '+1 year')
        )
      `).run();

      for (let i = 0; i < DEFAULT_DEPARTMENTS.length; i++) {
        const d = DEFAULT_DEPARTMENTS[i];
        await db.prepare(`
          INSERT OR IGNORE INTO departments (id, tenant_id, code, name, prefix, color, order_index)
          VALUES (?, 'tenant-demo', ?, ?, ?, ?, ?)
        `).bind(`dept_demo_${d.code}`, d.code, d.name, d.prefix, d.color, i).run();
      }

      // Seed default demo users into 'tenant-demo'
      const demoUsers = [
        { id: "Admin", username: "Admin", name: "Quản Trị Viên Tổng", pass: "Tpl@1234", role: "ADMIN", dept: "ALL", prefix: "C", mode: "AUTONOMOUS" },
        { id: "boss", username: "boss", name: "Ban Giám Đốc (Boss)", pass: "Tpl@1235", role: "BOSS", dept: "ALL", prefix: "C", mode: "AUTONOMOUS" },
        { id: "Designer", username: "Designer", name: "Trưởng Phòng Thiết Kế", pass: "Tpl@1236", role: "DEPT_ADMIN", dept: "DESIGNER", prefix: "G", mode: "AUTONOMOUS" },
        { id: "Designer-staff", username: "Designer-staff", name: "KTS. Minh Thiết Kế", pass: "Tpl@1237", role: "STAFF", dept: "DESIGNER", prefix: "G", mode: "REPORT_ONLY" },
        { id: "MEP", username: "MEP", name: "Trưởng Phòng MEP", pass: "Tpl@1244", role: "DEPT_ADMIN", dept: "MEP", prefix: "E", mode: "AUTONOMOUS" },
        { id: "MEP-staff", username: "MEP-staff", name: "KS. Thợ Điện TPL", pass: "Tpl@1245", role: "STAFF", dept: "MEP", prefix: "E", mode: "REPORT_ONLY" },
        { id: "Construction", username: "Construction", name: "Trưởng Phòng Thi Công", pass: "Tpl@1240", role: "DEPT_ADMIN", dept: "CONSTRUCTION", prefix: "C", mode: "AUTONOMOUS" },
        { id: "Construction-staff", username: "Construction-staff", name: "KS. Lê Văn C (Thi Công)", pass: "Tpl@1241", role: "STAFF", dept: "CONSTRUCTION", prefix: "C", mode: "REPORT_ONLY" },
        { id: "Factory", username: "Factory", name: "Quản Đốc Xưởng SX", pass: "Tpl@1242", role: "DEPT_ADMIN", dept: "FACTORY", prefix: "X", mode: "AUTONOMOUS" },
        { id: "Factory-staff", username: "Factory-staff", name: "Tổ Trưởng Xưởng TPL", pass: "Tpl@1243", role: "STAFF", dept: "FACTORY", prefix: "X", mode: "REPORT_ONLY" }
      ];
      for (const u of demoUsers) {
        await db.prepare(`
          INSERT OR IGNORE INTO users (
            id, tenant_id, username, full_name, pass, password_plain_hint, role, dept, dept_tags, prefix, task_permission_mode, is_active
          ) VALUES (?, 'tenant-demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(u.id, u.username, u.name, u.pass, u.pass, u.role, u.dept, JSON.stringify(u.dept === "ALL" ? [] : [u.dept]), u.prefix, u.mode).run();
      }
    }

    await db.prepare("INSERT OR IGNORE INTO coupons (code, discount_percent, is_active) VALUES ('LTPSOFT10', 10, 1), ('NAM10', 10, 1)").run();
  } catch (e) {}

  schemaReady = true;
}

// ============================================================================
// TENANT RESOLUTION HELPER
// ============================================================================
async function resolveTenantContext(request, env, authUser) {
  const url = new URL(request.url);
  const explicitSub =
    url.searchParams.get("tenant") ||
    url.searchParams.get("subdomain") ||
    request.headers.get("X-Tenant") ||
    request.headers.get("x-tenant") ||
    (authUser && authUser.subdomain) ||
    "";

  if (explicitSub && env.DB) {
    const clean = explicitSub.trim().toLowerCase();
    const t = await env.DB.prepare("SELECT * FROM tenants WHERE subdomain = ? OR id = ?").bind(clean, clean).first();
    if (t) return t;
  }

  if (authUser && authUser.tenantId && env.DB) {
    const t = await env.DB.prepare("SELECT * FROM tenants WHERE id = ? OR subdomain = ?").bind(authUser.tenantId, authUser.tenantId).first();
    if (t) return t;
  }

  // Check Custom Domain or Subdomain on Host header
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || url.hostname || "").toLowerCase().split(":")[0];
  if (host && env.DB) {
    const byCustom = await env.DB.prepare("SELECT * FROM tenants WHERE LOWER(custom_domain) = ?").bind(host).first();
    if (byCustom) return byCustom;

    const rootDomain = (env.ROOT_DOMAIN || "ltp-soft.com").toLowerCase();
    if (host.endsWith(`.${rootDomain}`)) {
      const sub = host.slice(0, -(rootDomain.length + 1));
      if (sub && sub !== "progress" && sub !== "www") {
        const bySub = await env.DB.prepare("SELECT * FROM tenants WHERE subdomain = ?").bind(sub).first();
        if (bySub) return bySub;
      }
    }
  }

  if (env.DB) {
    const fallback = await env.DB.prepare("SELECT * FROM tenants WHERE id = 'tenant-demo'").first();
    if (fallback) return fallback;
  }

  return {
    id: "tenant-demo",
    subdomain: "demo",
    company_name: "LTP Progress Demo Corp",
    slogan: "ALL PROGRESS IN ONE",
    logo_url: "./asset/Logo_white.png",
    plan_type: "BUSINESS",
    status: "ACTIVE",
    max_users: 40,
    max_projects: 999999,
    storage_limit_mb: 35840,
    addon_storage_mb: 0,
    storage_used_bytes: 0,
    max_file_size_mb: 350,
    ai_daily_limit: 80
  };
}

// ============================================================================
// MAIN WORKER FETCH HANDLER
// ============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reqAllowHeaders = request.headers.get("Access-Control-Request-Headers") || "*";
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": reqAllowHeaders + ", Content-Type, Authorization, authorization, X-Tenant, x-tenant, X-Requested-With, Accept, Origin",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    };

    const jsonResp = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    await ensureMultiTenantSchema(env);

    // Parse Auth User from Bearer token
    let authUser = { role: "GUEST", dept: "NONE", id: "guest", tenantId: "tenant-demo" };
    const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const verified = await verifyJwt(env, authHeader.slice(7).trim());
      if (verified) authUser = verified;
    }

    const tenant = await resolveTenantContext(request, env, authUser);
    const tenantId = tenant.id || "tenant-demo";

    // ========================================================================
    // 1. PUBLIC SAAS ENDPOINTS (PLANS, SUBDOMAIN CHECK, OTP EMAIL, REGISTER, VIETQR, SEPAY)
    // ========================================================================
    if (url.pathname === "/api/public/plans" && request.method === "GET") {
      return jsonResp({ plans: PLANS });
    }

    if (url.pathname === "/api/public/tenant-brand" && request.method === "GET") {
      let depts = [];
      if (env.DB) {
        const res = await env.DB.prepare("SELECT code, name, prefix, color, default_task_mode FROM departments WHERE tenant_id = ? ORDER BY order_index ASC").bind(tenantId).all();
        depts = res.results || [];
      }
      return jsonResp({
        tenant: {
          id: tenant.id,
          subdomain: tenant.subdomain,
          companyName: tenant.company_name,
          slogan: tenant.slogan || "ALL PROGRESS IN ONE",
          logoUrl: tenant.logo_url || "./asset/Logo_white.png",
          planType: tenant.plan_type,
          status: tenant.status,
          themeConfig: JSON.parse(tenant.theme_config || "{}"),
          expiresAt: tenant.expires_at
        },
        departments: depts.length > 0 ? depts : DEFAULT_DEPARTMENTS
      });
    }

    if (url.pathname === "/api/public/check-subdomain" && request.method === "GET") {
      const raw = (url.searchParams.get("subdomain") || "").trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(raw)) {
        return jsonResp({ available: false, message: "Mã công ty chỉ gồm chữ thường a-z, số 0-9, dài 3-30 ký tự." });
      }
      const reserved = new Set(["www", "api", "admin", "progress", "root", "mail", "ltp", "ltpsoft"]);
      if (reserved.has(raw)) {
        return jsonResp({ available: false, message: "Mã này đã được hệ thống giữ lại." });
      }
      const existing = await env.DB.prepare("SELECT id FROM tenants WHERE subdomain = ?").bind(raw).first();
      if (existing) {
        return jsonResp({ available: false, message: `Mã công ty "${raw}" đã có đơn vị sử dụng.` });
      }
      return jsonResp({ available: true, subdomain: raw, message: `✓ Mã công ty "${raw}" hợp lệ và có thể đăng ký!` });
    }

    if (url.pathname === "/api/public/check-coupon" && request.method === "POST") {
      const { code } = await request.json();
      const clean = String(code || "").trim().toUpperCase();
      const cp = await env.DB.prepare("SELECT * FROM coupons WHERE code = ? AND is_active = 1").bind(clean).first();
      if (!cp) return jsonResp({ valid: false, error: "Mã ưu đãi không tồn tại hoặc đã hết hạn." }, 400);
      return jsonResp({ valid: true, code: cp.code, discount_percent: cp.discount_percent || 10 });
    }

    // SEND 6-DIGIT EMAIL OTP (ANTI-SPAM + REGISTER / FORGOT PASSWORD)
    if (url.pathname === "/api/public/send-otp" && request.method === "POST") {
      try {
        const { email, purpose = "REGISTER", mathAnswer, mathExpected, honeypot } = await request.json();
        if (honeypot) return jsonResp({ error: "Phát hiện bot spam!" }, 400);
        if (mathExpected !== undefined && Number(mathAnswer) !== Number(mathExpected)) {
          return jsonResp({ error: "Kết quả phép tính chống Bot không đúng!" }, 400);
        }
        const cleanEmail = String(email || "").trim().toLowerCase();
        if (!cleanEmail || !cleanEmail.includes("@")) {
          return jsonResp({ error: "Vui lòng nhập địa chỉ Email hợp lệ!" }, 400);
        }

        // Block disposable spam domains
        const disposable = ["tempmail.com", "10minutemail.com", "guerrillamail.com", "mailinator.com", "yopmail.com"];
        const emailDomain = cleanEmail.split("@")[1] || "";
        if (disposable.includes(emailDomain)) {
          return jsonResp({ error: "Không chấp nhận email ảo / email tạm thời. Vui lòng dùng Gmail hoặc Email công ty!" }, 400);
        }

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const otpId = `otp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const expSec = Math.floor(Date.now() / 1000) + 600; // 10 minutes

        await env.DB.prepare(`
          INSERT INTO email_otps (id, email, otp_code, purpose, expires_at, used)
          VALUES (?, ?, ?, ?, ?, 0)
        `).bind(otpId, cleanEmail, otpCode, purpose, expSec).run();

        const emailHtml = `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #0f172a; color: #f8fafc;">
            <h2 style="color: #38bdf8; margin-top: 0;">LTP PROGRESS HUB — Mã Xác Thực OTP</h2>
            <p style="color: #cbd5e1; font-size: 14px;">Xin chào, mã xác thực bảo mật (OTP) của bạn tại <b>LTP Soft</b> là:</p>
            <div style="background: #1e293b; border: 2px dashed #38bdf8; border-radius: 12px; padding: 16px; text-align: center; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; margin: 20px 0;">
              ${otpCode}
            </div>
            <p style="color: #94a3b8; font-size: 12px;">Mã có hiệu lực trong 10 phút. Tuyệt đối không chia sẻ mã này cho người lạ.</p>
            <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;">
            <p style="color: #64748b; font-size: 11px; margin: 0;">© 2026 CÔNG TY TNHH TMDV LÊ TÀI PHÁT (LTP SOFT) — Hotline/Zalo: 0559595945</p>
          </div>
        `;
        const mailResult = await sendEmail({
          to: cleanEmail,
          subject: `[LTP Progress Hub] Mã xác thực OTP của bạn là: ${otpCode}`,
          html: emailHtml,
          env
        });

        return jsonResp({
          status: "success",
          emailSent: mailResult.success,
          message: mailResult.success
            ? `Đã gửi mã OTP 6 số tới ${cleanEmail}. Vui lòng kiểm tra hộp thư!`
            : `Hệ thống đã tạo mã xác thực cho ${cleanEmail}.`,
          otpDemoHint: mailResult.success ? undefined : otpCode
        });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // REGISTER NEW TENANT (14-DAY FREE TRIAL OR PAID VIETQR ORDER)
    if (url.pathname === "/api/public/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const {
          company_name,
          subdomain,
          owner_email,
          owner_name,
          owner_phone,
          admin_password,
          plan_type = "BUSINESS",
          billing_cycle = "YEARLY",
          is_trial = false,
          otp_code,
          google_token,
          device_fingerprint,
          coupon_code
        } = body;

        if (!company_name || !company_name.trim()) {
          return jsonResp({ error: "Vui lòng nhập Tên công ty / Doanh nghiệp!" }, 400);
        }
        const cleanSub = String(subdomain || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (cleanSub.length < 3) {
          return jsonResp({ error: "Mã công ty (Subdomain) phải có ít nhất 3 ký tự!" }, 400);
        }
        const taken = await env.DB.prepare("SELECT id FROM tenants WHERE subdomain = ?").bind(cleanSub).first();
        if (taken) {
          return jsonResp({ error: `Mã công ty "${cleanSub}" đã được đăng ký. Vui lòng chọn mã khác!` }, 400);
        }

        let verifiedEmail = String(owner_email || "").trim().toLowerCase();
        let verifiedGoogleId = null;

        // Verify either Google Token or Email OTP
        if (google_token) {
          try {
            const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(google_token)}`);
            if (gRes.ok) {
              const gData = await gRes.json();
              verifiedGoogleId = gData.sub;
              if (gData.email) verifiedEmail = gData.email.toLowerCase().trim();
            }
          } catch (e) {}
        }

        if (!verifiedGoogleId) {
          if (!otp_code) {
            return jsonResp({ error: "Vui lòng nhập mã OTP 6 số đã gửi về Email (hoặc xác thực nhanh bằng Google)!" }, 400);
          }
          const nowSec = Math.floor(Date.now() / 1000);
          const otpRow = await env.DB.prepare(
            "SELECT * FROM email_otps WHERE email = ? AND otp_code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
          ).bind(verifiedEmail, String(otp_code).trim(), nowSec).first();

          if (!otpRow) {
            return jsonResp({ error: "Mã OTP không chính xác hoặc đã hết hạn!" }, 400);
          }
          await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE id = ?").bind(otpRow.id).run();
        }

        if (!admin_password || String(admin_password).length < 6) {
          return jsonResp({ error: "Mật khẩu Quản trị viên cần tối thiểu 6 ký tự!" }, 400);
        }

        const pwHash = await hashPassword(admin_password);

        // CASE 1: 14-DAY FREE TRIAL REGISTRATION
        if (is_trial) {
          if (device_fingerprint) {
            const usedFp = await env.DB.prepare("SELECT id FROM tenants WHERE device_fingerprint = ? AND status = 'TRIAL'").bind(device_fingerprint).first();
            if (usedFp) {
              return jsonResp({ error: "Thiết bị này đã từng đăng ký dùng thử 14 ngày. Vui lòng đăng nhập vào công ty cũ hoặc chọn mua gói!" }, 400);
            }
          }

          const newTenantId = `tenant_${cleanSub}_${Date.now().toString(36)}`;
          const trialCfg = PLANS.TRIAL;

          await env.DB.prepare(`
            INSERT INTO tenants (
              id, subdomain, company_name, owner_email, owner_phone,
              plan_type, status, max_users, max_projects, storage_limit_mb, max_file_size_mb, ai_daily_limit,
              google_owner_id, device_fingerprint, expires_at
            ) VALUES (
              ?, ?, ?, ?, ?,
              'TRIAL', 'TRIAL', ?, ?, ?, ?, ?,
              ?, ?, datetime('now', '+14 days')
            )
          `).bind(
            newTenantId, cleanSub, company_name.trim(), verifiedEmail, owner_phone || "",
            trialCfg.maxUsers, trialCfg.maxProjects, trialCfg.storageLimitMb, trialCfg.maxFileSizeMb, trialCfg.aiDailyLimit,
            verifiedGoogleId, device_fingerprint || null
          ).run();

          // Seed Default Department Tags for this new Tenant
          for (let i = 0; i < DEFAULT_DEPARTMENTS.length; i++) {
            const d = DEFAULT_DEPARTMENTS[i];
            await env.DB.prepare(`
              INSERT INTO departments (id, tenant_id, code, name, prefix, color, order_index)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(`dept_${cleanSub}_${d.code}`, newTenantId, d.code, d.name, d.prefix, d.color, i).run();
          }

          // Create Root Admin Account
          const adminUserId = `admin_${cleanSub}`;
          await env.DB.prepare(`
            INSERT INTO users (
              id, tenant_id, username, email, phone, full_name, pass, password_hash, password_plain_hint,
              role, dept, dept_tags, prefix, task_permission_mode, is_active
            ) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?, 'ADMIN', 'ALL', '[]', 'C', 'AUTONOMOUS', 1)
          `).bind(
            adminUserId, newTenantId, verifiedEmail, owner_phone || "",
            owner_name || "Quản Trị Viên", admin_password, pwHash, admin_password
          ).run();

          // Create 1 Sample Starter Project for the new Tenant
          const sampleProjId = `PRJ_${cleanSub.toUpperCase()}_01`;
          const todayStr = new Date().toISOString().split("T")[0];
          await env.DB.prepare(`
            INSERT INTO projects (
              id, tenant_id, name, pin, creator_dept, creator_pic, project_manager,
              is_shared, invited_depts, status, start_range, end_range, staffs, category
            ) VALUES (?, ?, ?, '12345678', 'CONSTRUCTION', ?, ?, 1, '["CONSTRUCTION","DESIGNER","MEP","FACTORY"]', 'Active', ?, ?, '[]', 'SHARED')
          `).bind(
            sampleProjId, newTenantId, `Dự Án Mẫu — ${company_name.trim()}`,
            owner_name || "Admin", owner_name || "Admin", todayStr, todayStr
          ).run();

          const sessionPayload = {
            id: adminUserId,
            username: "admin",
            fullName: owner_name || "Quản Trị Viên",
            role: "ADMIN",
            dept: "ALL",
            tenantId: newTenantId,
            subdomain: cleanSub
          };
          const token = await signJwt(env, sessionPayload);

          // Send Automated Welcome Email via Resend
          if (verifiedEmail) {
            await sendEmail({
              to: verifiedEmail,
              subject: `[LTP Progress Hub] Kích hoạt dùng thử 14 ngày — ${company_name.trim()}`,
              html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px; background: #ffffff; color: #0f172a;">
                  <h2 style="margin-top: 0; color: #0f172a;">Chào mừng ${company_name.trim()} đến với LTP Progress Hub!</h2>
                  <p style="font-size: 14px; color: #334155; line-height: 1.6;">Không gian điều phối tiến độ thi công & sản xuất của bạn đã được khởi tạo thành công (Gói Dùng Thử 14 Ngày).</p>
                  <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin: 18px 0; font-size: 13px; line-height: 1.8;">
                    <div><b>Mã công ty (Subdomain):</b> <code>${cleanSub}</code></div>
                    <div><b>Tài khoản Quản trị (Admin):</b> <code>admin</code> (hoặc đăng nhập bằng Email <code>${verifiedEmail}</code>)</div>
                    <div><b>Mật khẩu khởi tạo:</b> <code>${admin_password}</code></div>
                  </div>
                  <p style="font-size: 12px; color: #64748b;">© 2026 CÔNG TY TNHH TMDV LÊ TÀI PHÁT (LTP SOFT) — Hotline/Zalo: 0559.595.945</p>
                </div>
              `,
              env
            });
          }

          return jsonResp({
            success: true,
            is_trial: true,
            token,
            user: sessionPayload,
            tenant: { id: newTenantId, subdomain: cleanSub, companyName: company_name.trim() },
            redirect_url: `/admin.html?tenant=${encodeURIComponent(cleanSub)}`
          });
        }

        // CASE 2: PAID SUBSCRIPTION -> GENERATE VIETQR ORDER (SEPAY AUTO-ACTIVATION)
        const planCfg = PLANS[plan_type] || PLANS.BUSINESS;
        const basePrice = billing_cycle === "MONTHLY" ? planCfg.priceMonthly : planCfg.priceYearly;
        let discountAmount = 0;
        let finalAmount = basePrice;
        let appliedCoupon = null;

        if (coupon_code) {
          const cp = await env.DB.prepare("SELECT * FROM coupons WHERE code = ? AND is_active = 1").bind(String(coupon_code).trim().toUpperCase()).first();
          if (cp) {
            appliedCoupon = cp.code;
            discountAmount = Math.round((basePrice * (cp.discount_percent || 10)) / 100);
            finalAmount = basePrice - discountAmount;
          }
        }

        const orderId = `PRG${Math.floor(10000 + Math.random() * 90000)}`;
        await env.DB.prepare(`
          INSERT INTO payment_orders (
            id, order_type, subdomain_requested, company_name, owner_email,
            plan_type, billing_cycle, original_amount, discount_amount, amount,
            coupon_code, order_status, google_owner_id, device_fingerprint,
            owner_name, admin_password_hash, admin_password_plain
          ) VALUES (?, 'NEW_REGISTER', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
        `).bind(
          orderId, cleanSub, company_name.trim(), verifiedEmail,
          plan_type, billing_cycle, basePrice, discountAmount, finalAmount,
          appliedCoupon, verifiedGoogleId, device_fingerprint || null,
          owner_name || "Quản Trị Viên", pwHash, admin_password
        ).run();

        const bankBin = env.VIETQR_BANK_BIN || "970422";
        const bankAccount = env.VIETQR_ACCOUNT_NO || "0388888888";
        const bankAccountName = env.VIETQR_ACCOUNT_NAME || "CONG TY LTP SOFT";
        const qrUrl = `https://img.vietqr.io/image/${bankBin}-${bankAccount}-compact2.png?amount=${finalAmount}&addInfo=${encodeURIComponent(orderId)}&accountName=${encodeURIComponent(bankAccountName)}`;

        return jsonResp({
          success: true,
          is_trial: false,
          order: {
            order_id: orderId,
            subdomain: cleanSub,
            company_name: company_name.trim(),
            plan_type,
            billing_cycle,
            original_amount: basePrice,
            discount_amount: discountAmount,
            amount: finalAmount,
            formatted_amount: `${finalAmount.toLocaleString("vi-VN")} đ`,
            qr_url: qrUrl,
            bank_bin: bankBin,
            bank_account: bankAccount,
            bank_account_name: bankAccountName,
            transfer_content: orderId
          }
        });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // POLL ORDER STATUS (FOR VIETQR AUTO-ACTIVATION)
    if (url.pathname === "/api/public/order-status" && request.method === "GET") {
      const orderId = (url.searchParams.get("order_id") || "").trim().toUpperCase();
      if (!orderId) return jsonResp({ error: "Thiếu order_id" }, 400);
      const order = await env.DB.prepare("SELECT * FROM payment_orders WHERE id = ?").bind(orderId).first();
      if (!order) return jsonResp({ error: "Không tìm thấy đơn hàng" }, 404);
      return jsonResp({
        order_id: order.id,
        status: order.order_status,
        paid: order.order_status === "PAID",
        subdomain: order.subdomain_requested,
        redirect_url: order.order_status === "PAID" ? `/admin.html?tenant=${encodeURIComponent(order.subdomain_requested)}` : null
      });
    }

    // SEPAY WEBHOOK HANDLER (POST /api/webhook/sepay)
    if (url.pathname === "/api/webhook/sepay" && request.method === "POST") {
      try {
        const payload = await request.json();
        const content = String(payload.content || payload.description || "");
        const transferAmount = Number(payload.transferAmount || payload.amount || 0);

        const match = content.match(/(?:PRG|LTP)\d{5}/i);
        if (!match) {
          return jsonResp({ message: "Bỏ qua giao dịch không khớp mã đơn PRG/LTP" }, 200);
        }
        const orderId = match[0].toUpperCase();
        const order = await env.DB.prepare("SELECT * FROM payment_orders WHERE id = ? AND order_status = 'PENDING'").bind(orderId).first();
        if (!order) {
          return jsonResp({ error: "Đơn hàng không tồn tại hoặc đã xử lý" }, 400);
        }
        if (transferAmount < order.amount) {
          return jsonResp({ error: `Chuyển thiếu tiền: nhận ${transferAmount}, cần ${order.amount}` }, 400);
        }

        // 1. Storage Add-on Order (+10GB, +20GB...)
        if (order.order_type === "ADDON_STORAGE") {
          const addMb = (Number(order.addon_gb) || 10) * 1024;
          await env.DB.prepare("UPDATE tenants SET addon_storage_mb = COALESCE(addon_storage_mb, 0) + ? WHERE id = ?").bind(addMb, order.tenant_id).run();
          await env.DB.prepare("UPDATE payment_orders SET order_status = 'PAID', paid_at = datetime('now'), payment_reference = ? WHERE id = ?")
            .bind(payload.referenceCode || payload.id || "SEPAY", orderId).run();
          return jsonResp({ success: true, message: `Đã cộng thêm +${order.addon_gb}GB cho ${order.subdomain_requested}` });
        }

        // 2. New Registration or Plan Renewal/Upgrade
        const planCfg = PLANS[order.plan_type] || PLANS.BUSINESS;
        const durationExpr = order.billing_cycle === "MONTHLY" ? "+1 month" : "+1 year";
        const targetTenantId = order.tenant_id || `tenant_${order.subdomain_requested}_${Date.now().toString(36)}`;

        await env.DB.prepare(`
          INSERT INTO tenants (
            id, subdomain, company_name, owner_email, plan_type, status,
            max_users, max_projects, storage_limit_mb, max_file_size_mb, ai_daily_limit,
            google_owner_id, device_fingerprint, expires_at
          ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, datetime('now', '${durationExpr}'))
          ON CONFLICT(subdomain) DO UPDATE SET
            status = 'ACTIVE',
            plan_type = excluded.plan_type,
            max_users = excluded.max_users,
            max_projects = excluded.max_projects,
            storage_limit_mb = excluded.storage_limit_mb,
            max_file_size_mb = excluded.max_file_size_mb,
            ai_daily_limit = excluded.ai_daily_limit,
            expires_at = datetime(CASE WHEN expires_at > datetime('now') THEN expires_at ELSE datetime('now') END, '${durationExpr}')
        `).bind(
          targetTenantId, order.subdomain_requested, order.company_name, order.owner_email, order.plan_type,
          planCfg.maxUsers, planCfg.maxProjects, planCfg.storageLimitMb, planCfg.maxFileSizeMb, planCfg.aiDailyLimit,
          order.google_owner_id || null, order.device_fingerprint || null
        ).run();

        const tenantRow = await env.DB.prepare("SELECT * FROM tenants WHERE subdomain = ?").bind(order.subdomain_requested).first();
        const finalTenantId = tenantRow ? tenantRow.id : targetTenantId;

        // Seed departments & root admin if brand-new tenant
        const deptCheck = await env.DB.prepare("SELECT id FROM departments WHERE tenant_id = ? LIMIT 1").bind(finalTenantId).first();
        if (!deptCheck) {
          for (let i = 0; i < DEFAULT_DEPARTMENTS.length; i++) {
            const d = DEFAULT_DEPARTMENTS[i];
            await env.DB.prepare(`
              INSERT INTO departments (id, tenant_id, code, name, prefix, color, order_index)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(`dept_${order.subdomain_requested}_${d.code}`, finalTenantId, d.code, d.name, d.prefix, d.color, i).run();
          }

          const adminUserId = `admin_${order.subdomain_requested}`;
          await env.DB.prepare(`
            INSERT OR IGNORE INTO users (
              id, tenant_id, username, email, full_name, pass, password_hash, password_plain_hint,
              role, dept, dept_tags, prefix, task_permission_mode, is_active
            ) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'ADMIN', 'ALL', '[]', 'C', 'AUTONOMOUS', 1)
          `).bind(
            adminUserId, finalTenantId, order.owner_email, order.owner_name || "Quản Trị Viên",
            order.admin_password_plain || "admin123", order.admin_password_hash || "", order.admin_password_plain || "admin123"
          ).run();
        }

        await env.DB.prepare("UPDATE payment_orders SET order_status = 'PAID', paid_at = datetime('now'), tenant_id = ?, payment_reference = ? WHERE id = ?")
          .bind(finalTenantId, payload.referenceCode || payload.id || "SEPAY", orderId).run();

        // Send Automated Payment Confirmation & Workspace Activation Email via Resend
        if (order.owner_email) {
          await sendEmail({
            to: order.owner_email,
            subject: `[LTP Progress Hub] Xác nhận thanh toán #${orderId} — Kích hoạt gói ${planCfg.name}`,
            html: `
              <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px; background: #ffffff; color: #0f172a;">
                <h2 style="margin-top: 0; color: #0f172a;">Thanh toán thành công đơn hàng #${orderId}</h2>
                <p style="font-size: 14px; color: #334155; line-height: 1.6;">Hệ thống SePay đã xác nhận khoản thanh toán <b>${Number(order.amount || 0).toLocaleString("vi-VN")} đ</b> và kích hoạt tự động không gian làm việc của <b>${order.company_name}</b>.</p>
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin: 18px 0; font-size: 13px; line-height: 1.8;">
                  <div><b>Gói cước kích hoạt:</b> ${planCfg.name} (${order.billing_cycle === "MONTHLY" ? "01 Tháng" : "01 Năm"})</div>
                  <div><b>Mã công ty (Subdomain):</b> <code>${order.subdomain_requested}</code></div>
                  <div><b>Tài khoản Admin:</b> <code>admin</code> (hoặc <code>${order.owner_email}</code>)</div>
                  <div><b>Hạn mức:</b> ${planCfg.maxUsers >= 999999 ? "Không giới hạn" : planCfg.maxUsers} nhân sự • ${Math.round(planCfg.storageLimitMb / 1024)} GB Cloud R2</div>
                </div>
                <p style="font-size: 12px; color: #64748b;">© 2026 CÔNG TY TNHH TMDV LÊ TÀI PHÁT (LTP SOFT) — Hotline/Zalo: 0559.595.945</p>
              </div>
            `,
            env
          });
        }

        return jsonResp({ success: true, orderId, subdomain: order.subdomain_requested });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 2. AUTHENTICATION, LOGIN & PASSWORD RECOVERY ENDPOINTS
    // ========================================================================
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const { username, password, subdomain } = await request.json();
        const cleanUser = String(username || "").trim();
        const cleanPass = String(password || "").trim();

        let targetTenant = tenant;
        if (subdomain) {
          const t = await env.DB.prepare("SELECT * FROM tenants WHERE subdomain = ? OR id = ?").bind(subdomain.trim().toLowerCase(), subdomain.trim().toLowerCase()).first();
          if (t) targetTenant = t;
        }

        let userRow = null;
        if (env.DB) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM users WHERE tenant_id = ? AND (LOWER(username) = LOWER(?) OR LOWER(id) = LOWER(?) OR LOWER(email) = LOWER(?))"
          ).bind(targetTenant.id, cleanUser, cleanUser, cleanUser).all();

          for (const candidate of results || []) {
            if (await verifyPassword(cleanPass, candidate.password_hash, candidate.pass)) {
              userRow = candidate;
              break;
            }
          }

          // If not found in targetTenant, also search by email across tenants (convenient login by email!)
          if (!userRow && cleanUser.includes("@")) {
            const { results: emailMatches } = await env.DB.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").bind(cleanUser).all();
            for (const candidate of emailMatches || []) {
              if (await verifyPassword(cleanPass, candidate.password_hash, candidate.pass)) {
                userRow = candidate;
                const foundT = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(candidate.tenant_id).first();
                if (foundT) targetTenant = foundT;
                break;
              }
            }
          }
        }

        if (!userRow) {
          return jsonResp({ error: "Tên đăng nhập hoặc mật khẩu không đúng!" }, 401);
        }

        if (Number(userRow.is_active) === 0) {
          return jsonResp({ error: "Tài khoản này đã bị Admin tạm khóa hoặc thu hồi. Vui lòng liên hệ Quản trị viên!" }, 403);
        }

        const sessionPayload = {
          id: userRow.id,
          username: userRow.username || userRow.id,
          fullName: userRow.full_name || userRow.username || userRow.id,
          avatarUrl: userRow.avatar_url || "",
          role: userRow.role,
          dept: userRow.dept,
          deptTags: JSON.parse(userRow.dept_tags || "[]"),
          prefix: userRow.prefix || "C",
          taskPermissionMode: userRow.task_permission_mode || "REPORT_ONLY",
          managedProjectIds: JSON.parse(userRow.managed_project_ids || "[]"),
          isWaiting: Number(userRow.is_active) === 2 || userRow.role === "WAITING",
          tenantId: targetTenant.id,
          subdomain: targetTenant.subdomain,
          companyName: targetTenant.company_name,
          logoUrl: targetTenant.logo_url || "./asset/Logo_white.png"
        };

        const token = await signJwt(env, sessionPayload);
        return jsonResp({ status: "success", token, user: sessionPayload, tenant: targetTenant });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // RESET PASSWORD BY EMAIL OTP OR GOOGLE TOKEN
    if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
      try {
        const { email, otp_code, google_token, new_password, subdomain } = await request.json();
        if (!new_password || String(new_password).length < 6) {
          return jsonResp({ error: "Mật khẩu mới phải có từ 6 ký tự trở lên!" }, 400);
        }

        let targetEmail = String(email || "").trim().toLowerCase();
        if (google_token) {
          const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(google_token)}`);
          if (!gRes.ok) return jsonResp({ error: "Token Google không hợp lệ!" }, 400);
          const gData = await gRes.json();
          targetEmail = (gData.email || "").toLowerCase().trim();
        } else {
          const nowSec = Math.floor(Date.now() / 1000);
          const otpRow = await env.DB.prepare(
            "SELECT * FROM email_otps WHERE email = ? AND otp_code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
          ).bind(targetEmail, String(otp_code || "").trim(), nowSec).first();
          if (!otpRow) return jsonResp({ error: "Mã xác thực OTP không đúng hoặc đã hết hạn!" }, 400);
          await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE id = ?").bind(otpRow.id).run();
        }

        const pwHash = await hashPassword(new_password);
        const userRow = await env.DB.prepare("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1").bind(targetEmail).first();
        if (!userRow) {
          return jsonResp({ error: `Không tìm thấy tài khoản nào gắn với email ${targetEmail}!` }, 404);
        }

        await env.DB.prepare("UPDATE users SET pass = ?, password_hash = ?, password_plain_hint = ? WHERE id = ?")
          .bind(new_password, pwHash, new_password, userRow.id).run();

        return jsonResp({ status: "success", message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập ngay." });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 3. QR WAITING ROOM ONBOARDING + HARDWARE ANTI-DUPLICATE SCAN GUARD
    // ========================================================================
    if (url.pathname === "/api/public/qr-invite-info" && request.method === "GET") {
      const code = (url.searchParams.get("code") || "").trim();
      const hwHash = (url.searchParams.get("hw") || "").trim();
      if (!code) return jsonResp({ error: "Thiếu mã QR" }, 400);

      const invite = await env.DB.prepare("SELECT * FROM qr_invites WHERE id = ? AND is_active = 1").bind(code).first();
      if (!invite) return jsonResp({ error: "Mã QR mời nhân sự không tồn tại hoặc đã bị khóa!" }, 404);

      const t = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(invite.tenant_id).first();

      // Check if this hardware device already scanned this QR
      let existingUser = null;
      if (hwHash) {
        const scan = await env.DB.prepare("SELECT * FROM qr_invite_scans WHERE invite_id = ? AND hardware_hash = ? LIMIT 1").bind(code, hwHash).first();
        if (scan) {
          const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(scan.user_id).first();
          if (u) {
            existingUser = {
              id: u.id,
              username: u.username,
              fullName: u.full_name,
              avatarUrl: u.avatar_url,
              role: u.role,
              dept: u.dept,
              isWaiting: Number(u.is_active) === 2 || u.role === "WAITING",
              passwordHint: u.password_plain_hint
            };
          }
        }
      }

      return jsonResp({
        invite: {
          id: invite.id,
          title: invite.title,
          maxUses: invite.max_uses,
          usedCount: invite.used_count,
          remainingSlots: Math.max(0, invite.max_uses - invite.used_count),
          requireGoogle: Boolean(invite.require_google),
          defaultDept: invite.default_dept
        },
        tenant: {
          id: t?.id || invite.tenant_id,
          subdomain: t?.subdomain || "demo",
          companyName: t?.company_name || "Doanh Nghiệp",
          logoUrl: t?.logo_url || "./asset/Logo_white.png"
        },
        alreadyScannedUser: existingUser
      });
    }

    if (url.pathname === "/api/public/qr-join" && request.method === "POST") {
      try {
        const { code, fullName, phone, avatarUrl, googleToken, hardwareHash } = await request.json();
        const cleanCode = String(code || "").trim();
        const cleanHw = String(hardwareHash || "").trim() || `hw_${request.headers.get("cf-connecting-ip") || "ip"}_${(request.headers.get("user-agent") || "").slice(0, 40)}`;

        const invite = await env.DB.prepare("SELECT * FROM qr_invites WHERE id = ? AND is_active = 1").bind(cleanCode).first();
        if (!invite) return jsonResp({ error: "Mã QR không tồn tại hoặc đã ngừng nhận người!" }, 404);

        const targetTenant = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(invite.tenant_id).first();

        // LAYER 1 & 2: Check if this physical device (hardwareHash) or IP+UserAgent already scanned this QR!
        const existingScan = await env.DB.prepare(
          "SELECT * FROM qr_invite_scans WHERE invite_id = ? AND hardware_hash = ? LIMIT 1"
        ).bind(cleanCode, cleanHw).first();

        if (existingScan) {
          const existingU = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(existingScan.user_id).first();
          if (existingU) {
            const payload = {
              id: existingU.id,
              username: existingU.username,
              fullName: existingU.full_name,
              avatarUrl: existingU.avatar_url || "",
              role: existingU.role,
              dept: existingU.dept,
              deptTags: JSON.parse(existingU.dept_tags || "[]"),
              taskPermissionMode: existingU.task_permission_mode || "REPORT_ONLY",
              isWaiting: Number(existingU.is_active) === 2 || existingU.role === "WAITING",
              tenantId: invite.tenant_id,
              subdomain: targetTenant?.subdomain || "demo"
            };
            const token = await signJwt(env, payload);
            return jsonResp({
              status: "already_registered",
              message: `Thiết bị này đã được cấp tài khoản "${existingU.full_name}" (${existingU.username}). Đang đăng nhập lại vào tài khoản của bạn!`,
              token,
              user: { ...payload, passwordHint: existingU.password_plain_hint }
            });
          }
        }

        // Check slot limit
        if (invite.used_count >= invite.max_uses) {
          return jsonResp({ error: `Mã QR này đã đủ số lượng tối đa (${invite.used_count}/${invite.max_uses} người). Vui lòng báo Admin mở thêm lượt!` }, 400);
        }

        let finalName = String(fullName || "").trim();
        let finalAvatar = String(avatarUrl || "").trim();
        let finalEmail = "";
        let googleId = null;

        if (googleToken) {
          const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleToken)}`);
          if (gRes.ok) {
            const gData = await gRes.json();
            googleId = gData.sub;
            finalEmail = (gData.email || "").toLowerCase();
            if (!finalName && gData.name) finalName = gData.name;
            if (!finalAvatar && gData.picture) finalAvatar = gData.picture;
          }
        }

        if (invite.require_google && !googleId) {
          return jsonResp({ error: "Admin yêu cầu bấm nút Xác thực Google 1 chạm để lấy tên và ảnh đại diện thật!" }, 400);
        }

        if (!finalName) {
          return jsonResp({ error: "Vui lòng nhập Họ và Tên của bạn!" }, 400);
        }

        // Check if same Google ID or same Phone already joined this tenant via QR
        const cleanPhone = String(phone || "").trim().replace(/\s+/g, "");
        if (googleId || cleanPhone) {
          const dupUser = await env.DB.prepare(
            "SELECT * FROM users WHERE tenant_id = ? AND ((google_id IS NOT NULL AND google_id = ?) OR (phone != '' AND phone = ?)) LIMIT 1"
          ).bind(invite.tenant_id, googleId || "__none__", cleanPhone || "__none__").first();

          if (dupUser) {
            const payload = {
              id: dupUser.id,
              username: dupUser.username,
              fullName: dupUser.full_name,
              avatarUrl: dupUser.avatar_url || "",
              role: dupUser.role,
              dept: dupUser.dept,
              deptTags: JSON.parse(dupUser.dept_tags || "[]"),
              taskPermissionMode: dupUser.task_permission_mode || "REPORT_ONLY",
              isWaiting: Number(dupUser.is_active) === 2 || dupUser.role === "WAITING",
              tenantId: invite.tenant_id,
              subdomain: targetTenant?.subdomain || "demo"
            };
            const token = await signJwt(env, payload);
            return jsonResp({
              status: "already_registered",
              message: `Tài khoản của bạn (${dupUser.username}) đã tồn tại trên hệ thống. Tự động đăng nhập lại!`,
              token,
              user: { ...payload, passwordHint: dupUser.password_plain_hint }
            });
          }
        }

        // Generate clean Employee Username & Password
        const seqNum = invite.used_count + 1;
        const baseSlug = finalName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/gi, "d")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 8) || "nv";
        const generatedUsername = `${baseSlug}${String(seqNum).padStart(2, "0")}_${Math.floor(10 + Math.random() * 89)}`;
        const generatedPass = String(Math.floor(100000 + Math.random() * 900000));
        const pwHash = await hashPassword(generatedPass);
        const newUserId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        if (!finalAvatar) {
          finalAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(finalName)}&background=0284c7&color=fff&bold=true`;
        }

        const assignedDept = invite.default_dept || "WAITING";
        const initialRole = invite.default_dept ? "STAFF" : "WAITING";
        const initialActive = invite.default_dept ? 1 : 2; // 2 = Waiting Room for Admin to assign dept tag

        await env.DB.prepare(`
          INSERT INTO users (
            id, tenant_id, username, email, phone, full_name, avatar_url,
            pass, password_hash, password_plain_hint, role, dept, dept_tags,
            prefix, task_permission_mode, managed_project_ids, is_active, device_fingerprint, google_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'C', 'REPORT_ONLY', ?, ?, ?, ?)
        `).bind(
          newUserId, invite.tenant_id, generatedUsername, finalEmail, cleanPhone, finalName, finalAvatar,
          generatedPass, pwHash, generatedPass, initialRole, assignedDept,
          JSON.stringify(invite.default_dept ? [invite.default_dept] : []),
          JSON.stringify(invite.project_id ? [invite.project_id] : []),
          initialActive, cleanHw, googleId
        ).run();

        await env.DB.prepare("UPDATE qr_invites SET used_count = used_count + 1 WHERE id = ?").bind(cleanCode).run();
        await env.DB.prepare(`
          INSERT INTO qr_invite_scans (id, invite_id, tenant_id, user_id, hardware_hash, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `scan_${Date.now()}`, cleanCode, invite.tenant_id, newUserId, cleanHw,
          request.headers.get("cf-connecting-ip") || "", (request.headers.get("user-agent") || "").slice(0, 120)
        ).run();

        const payload = {
          id: newUserId,
          username: generatedUsername,
          fullName: finalName,
          avatarUrl: finalAvatar,
          role: initialRole,
          dept: assignedDept,
          deptTags: invite.default_dept ? [invite.default_dept] : [],
          taskPermissionMode: "REPORT_ONLY",
          isWaiting: initialActive === 2,
          tenantId: invite.tenant_id,
          subdomain: targetTenant?.subdomain || "demo"
        };
        const token = await signJwt(env, payload);

        return jsonResp({
          status: "success",
          token,
          user: { ...payload, passwordHint: generatedPass }
        });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 4. ADMIN PORTAL ENDPOINTS (/api/admin/*)
    // ========================================================================
    const isAdminOrSubAdmin = authUser.role === "ADMIN" || authUser.role === "BOSS" || authUser.role === "PROJECT_ADMIN" || authUser.role === "DEPT_ADMIN";

    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      if (!isAdminOrSubAdmin) {
        return jsonResp({ error: "Chỉ Quản trị viên (Admin / Trưởng Ban QLDA) mới có quyền truy cập trang Quản trị!" }, 403);
      }

      const deptsRes = await env.DB.prepare("SELECT * FROM departments WHERE tenant_id = ? ORDER BY order_index ASC, rowid ASC").bind(tenantId).all();
      let departments = deptsRes.results || [];
      if (departments.length === 0) {
        for (let i = 0; i < DEFAULT_DEPARTMENTS.length; i++) {
          const d = DEFAULT_DEPARTMENTS[i];
          await env.DB.prepare("INSERT OR IGNORE INTO departments (id, tenant_id, code, name, prefix, color, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(`dept_${tenantId}_${d.code}`, tenantId, d.code, d.name, d.prefix, d.color, i).run();
        }
        const retry = await env.DB.prepare("SELECT * FROM departments WHERE tenant_id = ? ORDER BY order_index ASC").bind(tenantId).all();
        departments = retry.results || [];
      }

      const usersRes = await env.DB.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC").bind(tenantId).all();
      const projectsRes = await env.DB.prepare("SELECT * FROM projects WHERE (tenant_id = ? OR tenant_id IS NULL) AND status != 'DELETED' ORDER BY updated_at DESC").bind(tenantId).all();
      const tasksRes = await env.DB.prepare("SELECT * FROM tasks WHERE (tenant_id = ? OR tenant_id IS NULL) AND is_deleted = 0").bind(tenantId).all();
      const filesRes = await env.DB.prepare("SELECT project_id, COUNT(*) as file_count, COALESCE(SUM(file_size), 0) as total_bytes FROM task_files WHERE (tenant_id = ? OR tenant_id IS NULL) GROUP BY project_id").bind(tenantId).all();
      const invitesRes = await env.DB.prepare("SELECT * FROM qr_invites WHERE tenant_id = ? ORDER BY created_at DESC").bind(tenantId).all();

      const fileMap = {};
      let totalTenantBytes = 0;
      for (const f of filesRes.results || []) {
        fileMap[f.project_id] = { count: f.file_count, bytes: f.total_bytes };
        totalTenantBytes += Number(f.total_bytes || 0);
      }

      // Sync accurate storage_used_bytes on tenant
      await env.DB.prepare("UPDATE tenants SET storage_used_bytes = ? WHERE id = ?").bind(totalTenantBytes, tenantId).run();

      const allUsers = (usersRes.results || []).map((u) => ({
        id: u.id,
        username: u.username || u.id,
        email: u.email || "",
        phone: u.phone || "",
        fullName: u.full_name || u.username || u.id,
        avatarUrl: u.avatar_url || "",
        role: u.role,
        dept: u.dept,
        deptTags: JSON.parse(u.dept_tags || "[]"),
        prefix: u.prefix || "C",
        taskPermissionMode: u.task_permission_mode || "REPORT_ONLY",
        managedProjectIds: JSON.parse(u.managed_project_ids || "[]"),
        isActive: Number(u.is_active),
        passwordHint: u.password_plain_hint || u.pass || "",
        createdAt: u.created_at
      }));

      const allTasks = tasksRes.results || [];
      const formattedProjects = (projectsRes.results || []).map((p) => {
        const pTasks = allTasks.filter((t) => t.project_id === p.id);
        const completedCount = pTasks.filter((t) => Boolean(t.is_completed) || Number(t.progress_percent) >= 100).length;
        const fStats = fileMap[p.id] || { count: 0, bytes: 0 };
        return {
          id: p.id,
          name: p.name,
          pin: p.pin,
          creatorDept: p.creator_dept,
          projectManager: p.project_manager,
          projectAdminId: p.project_admin_id || "",
          category: p.category || (Boolean(p.is_shared) ? "SHARED" : "INTERNAL"),
          status: p.status || "Active",
          startRange: p.start_range,
          endRange: p.end_range,
          invitedDepts: JSON.parse(p.invited_depts || "[]"),
          allowedUserIds: JSON.parse(p.allowed_user_ids || "[]"),
          storageQuotaMb: Number(p.storage_quota_mb || 0),
          storageUsedBytes: fStats.bytes,
          fileCount: fStats.count,
          taskCount: pTasks.length,
          completedTaskCount: completedCount
        };
      });

      const activeSeats = allUsers.filter((u) => u.isActive === 1 && u.role !== "ADMIN" && u.role !== "GUEST").length;
      const waitingUsers = allUsers.filter((u) => u.isActive === 2 || u.role === "WAITING");

      return jsonResp({
        tenant: {
          id: tenant.id,
          subdomain: tenant.subdomain,
          customDomain: tenant.custom_domain || "",
          companyName: tenant.company_name,
          slogan: tenant.slogan || "ALL PROGRESS IN ONE",
          ownerEmail: tenant.owner_email,
          logoUrl: tenant.logo_url || "./asset/Logo_white.png",
          planType: tenant.plan_type || "TRIAL",
          status: tenant.status || "TRIAL",
          maxUsers: tenant.max_users || 15,
          activeSeats,
          maxProjects: tenant.max_projects || 10,
          storageLimitMb: (Number(tenant.storage_limit_mb) || 500) + (Number(tenant.addon_storage_mb) || 0),
          baseStorageMb: Number(tenant.storage_limit_mb) || 500,
          addonStorageMb: Number(tenant.addon_storage_mb) || 0,
          storageUsedBytes: totalTenantBytes,
          maxFileSizeMb: Number(tenant.max_file_size_mb) || 200,
          aiDailyLimit: Number(tenant.ai_daily_limit) || 25,
          aiUsedToday: Number(tenant.ai_used_today) || 0,
          expiresAt: tenant.expires_at,
          isCorporate: tenant.plan_type === "ENTERPRISE"
        },
        plans: PLANS,
        departments,
        users: allUsers,
        waitingUsers,
        projects: formattedProjects,
        qrInvites: invitesRes.results || []
      });
    }

    // CREATE / MANAGE QR INVITE FOR WAITING ROOM
    if (url.pathname === "/api/admin/qr-invite" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { action = "CREATE", id, title, maxUses = 10, defaultDept = "", projectId = "", requireGoogle = false } = await request.json();

      if (action === "DELETE" && id) {
        await env.DB.prepare("DELETE FROM qr_invites WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
        return jsonResp({ status: "deleted", id });
      }

      if (action === "TOGGLE" && id) {
        await env.DB.prepare("UPDATE qr_invites SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
        return jsonResp({ status: "toggled", id });
      }

      const inviteId = `INV_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      await env.DB.prepare(`
        INSERT INTO qr_invites (id, tenant_id, project_id, title, max_uses, used_count, default_dept, require_google, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
      `).bind(inviteId, tenantId, projectId, title || "QR Gia Nhập Đội Ngũ", Math.max(1, Number(maxUses) || 10), defaultDept, requireGoogle ? 1 : 0, authUser.id).run();

      return jsonResp({ status: "success", inviteId });
    }

    // WAITING ROOM APPROVE OR REJECT (WITH SLOT RESTORATION)
    if (url.pathname === "/api/admin/waiting-room" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { action, userId, dept = "CONSTRUCTION", deptTags = [], role = "STAFF", taskPermissionMode = "REPORT_ONLY" } = await request.json();

      if (action === "REJECT") {
        const scan = await env.DB.prepare("SELECT * FROM qr_invite_scans WHERE user_id = ? AND tenant_id = ?").bind(userId, tenantId).first();
        if (scan) {
          await env.DB.prepare("UPDATE qr_invites SET used_count = MAX(0, used_count - 1) WHERE id = ?").bind(scan.invite_id).run();
          await env.DB.prepare("DELETE FROM qr_invite_scans WHERE id = ?").bind(scan.id).run();
        }
        await env.DB.prepare("DELETE FROM users WHERE id = ? AND tenant_id = ?").bind(userId, tenantId).run();
        return jsonResp({ status: "rejected", message: "Đã xóa khỏi phòng chờ và hoàn lại +1 lượt quét cho mã QR!" });
      }

      if (action === "APPROVE") {
        // Check active seat limit of tenant
        const seatCnt = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND is_active = 1 AND role NOT IN ('ADMIN','GUEST')").bind(tenantId).first();
        if ((seatCnt?.cnt || 0) >= Number(tenant.max_users || 15)) {
          return jsonResp({ error: `Công ty đã chạm giới hạn ${tenant.max_users} tài khoản nhân viên của gói ${tenant.plan_type}. Vui lòng khóa bớt tài khoản cũ hoặc nâng cấp gói!` }, 400);
        }

        const finalTags = Array.isArray(deptTags) && deptTags.length > 0 ? deptTags : [dept];
        const deptRow = await env.DB.prepare("SELECT prefix FROM departments WHERE tenant_id = ? AND code = ?").bind(tenantId, finalTags[0]).first();
        const prefix = deptRow?.prefix || "C";

        await env.DB.prepare(`
          UPDATE users
          SET role = ?, dept = ?, dept_tags = ?, prefix = ?, task_permission_mode = ?, is_active = 1
          WHERE id = ? AND tenant_id = ?
        `).bind(role, finalTags[0], JSON.stringify(finalTags), prefix, taskPermissionMode, userId, tenantId).run();

        if (role === "DEPT_ADMIN") {
          await env.DB.prepare("UPDATE departments SET leader_user_id = ? WHERE tenant_id = ? AND code = ?").bind(userId, tenantId, finalTags[0]).run();
        }

        return jsonResp({ status: "approved", userId });
      }
    }

    // MANAGE DEPARTMENTS (DYNAMIC DEPARTMENT TAGS)
    if (url.pathname === "/api/admin/departments" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { action = "SAVE", id, code, name, prefix = "C", color = "#2563eb", defaultTaskMode = "REPORT_ONLY" } = await request.json();

      if (action === "DELETE") {
        await env.DB.prepare("DELETE FROM departments WHERE (id = ? OR code = ?) AND tenant_id = ?").bind(id || code, code || id, tenantId).run();
        return jsonResp({ status: "deleted" });
      }

      const cleanCode = String(code || name || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "") || `DEPT_${Date.now().toString(36).toUpperCase()}`;
      const deptId = id || `dept_${tenantId}_${cleanCode}`;
      const cleanPrefix = String(prefix || cleanCode.charAt(0) || "C").trim().toUpperCase().charAt(0);

      await env.DB.prepare(`
        INSERT INTO departments (id, tenant_id, code, name, prefix, color, default_task_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          prefix = excluded.prefix,
          color = excluded.color,
          default_task_mode = excluded.default_task_mode
      `).bind(deptId, tenantId, cleanCode, name || cleanCode, cleanPrefix, color, defaultTaskMode).run();

      // If admin toggles default_task_mode for department, optionally sync to members of that department
      if (defaultTaskMode) {
        await env.DB.prepare("UPDATE users SET task_permission_mode = ? WHERE tenant_id = ? AND dept = ? AND role = 'STAFF'").bind(defaultTaskMode, tenantId, cleanCode).run();
      }

      return jsonResp({ status: "success", code: cleanCode });
    }

    // MANAGE USERS (CREATE, EDIT, TOGGLE PERMISSION MODE, LOCK/REVOKE SEAT)
    if (url.pathname === "/api/admin/users" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const body = await request.json();
      const { action = "SAVE", id, username, fullName, password, phone, email, role = "STAFF", dept = "CONSTRUCTION", deptTags = [], taskPermissionMode = "REPORT_ONLY", managedProjectIds = [], isActive = 1, avatarUrl = "" } = body;

      if (action === "DELETE" && id) {
        await env.DB.prepare("DELETE FROM users WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
        return jsonResp({ status: "deleted", id });
      }

      if (action === "TOGGLE_MODE" && id) {
        await env.DB.prepare("UPDATE users SET task_permission_mode = ? WHERE id = ? AND tenant_id = ?").bind(taskPermissionMode, id, tenantId).run();
        return jsonResp({ status: "updated", id, taskPermissionMode });
      }

      if (action === "TOGGLE_ACTIVE" && id) {
        if (Number(isActive) === 1) {
          const seatCnt = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND is_active = 1 AND role NOT IN ('ADMIN','GUEST') AND id != ?").bind(tenantId, id).first();
          if ((seatCnt?.cnt || 0) >= Number(tenant.max_users || 15)) {
            return jsonResp({ error: `Đã đạt trần ${tenant.max_users} tài khoản đang hoạt động của gói ${tenant.plan_type}!` }, 400);
          }
        }
        await env.DB.prepare("UPDATE users SET is_active = ? WHERE id = ? AND tenant_id = ?").bind(Number(isActive), id, tenantId).run();
        return jsonResp({ status: "updated", id, isActive: Number(isActive) });
      }

      // Check seat limit when adding a new active user
      if (!id && role !== "ADMIN") {
        const seatCnt = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND is_active = 1 AND role NOT IN ('ADMIN','GUEST')").bind(tenantId).first();
        if ((seatCnt?.cnt || 0) >= Number(tenant.max_users || 15)) {
          return jsonResp({ error: `Công ty đã dùng hết ${tenant.max_users}/${tenant.max_users} suất nhân sự của gói ${tenant.plan_type}. Hãy khóa tài khoản nhân sự đã nghỉ/xong dự án hoặc nâng cấp gói!` }, 400);
        }
      }

      const cleanUsername = String(username || "").trim();
      if (!cleanUsername) return jsonResp({ error: "Vui lòng nhập Tên đăng nhập (Username)!" }, 400);

      const finalTags = Array.isArray(deptTags) && deptTags.length > 0 ? deptTags : [dept];
      const primaryDept = finalTags[0] || "CONSTRUCTION";
      const deptRow = await env.DB.prepare("SELECT prefix FROM departments WHERE tenant_id = ? AND code = ?").bind(tenantId, primaryDept).first();
      const prefix = deptRow?.prefix || "C";

      const userId = id || `usr_${tenantId}_${cleanUsername.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Date.now().toString(36).slice(-3)}`;
      const existingU = id ? await env.DB.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").bind(id, tenantId).first() : null;

      const finalPass = password ? String(password).trim() : (existingU?.password_plain_hint || existingU?.pass || "123456");
      const pwHash = await hashPassword(finalPass);
      const finalAvatar = avatarUrl || existingU?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || cleanUsername)}&background=2563eb&color=fff&bold=true`;

      await env.DB.prepare(`
        INSERT INTO users (
          id, tenant_id, username, email, phone, full_name, avatar_url,
          pass, password_hash, password_plain_hint, role, dept, dept_tags,
          prefix, task_permission_mode, managed_project_ids, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          email = excluded.email,
          phone = excluded.phone,
          full_name = excluded.full_name,
          avatar_url = excluded.avatar_url,
          pass = excluded.pass,
          password_hash = excluded.password_hash,
          password_plain_hint = excluded.password_plain_hint,
          role = excluded.role,
          dept = excluded.dept,
          dept_tags = excluded.dept_tags,
          prefix = excluded.prefix,
          task_permission_mode = excluded.task_permission_mode,
          managed_project_ids = excluded.managed_project_ids,
          is_active = excluded.is_active
      `).bind(
        userId, tenantId, cleanUsername, email || "", phone || "", fullName || cleanUsername, finalAvatar,
        finalPass, pwHash, finalPass, role, primaryDept, JSON.stringify(finalTags),
        prefix, taskPermissionMode, JSON.stringify(managedProjectIds || []), Number(isActive)
      ).run();

      return jsonResp({ status: "success", userId });
    }

    // UPDATE COMPANY BRANDING (LOGO, NAME, SLOGAN, CUSTOM DOMAIN, THEME)
    if (url.pathname === "/api/admin/branding" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { companyName, slogan, logoUrl, customDomain, themeConfig } = await request.json();

      await env.DB.prepare(`
        UPDATE tenants
        SET company_name = COALESCE(?, company_name),
            slogan = COALESCE(?, slogan),
            logo_url = COALESCE(?, logo_url),
            custom_domain = COALESCE(?, custom_domain),
            theme_config = COALESCE(?, theme_config)
        WHERE id = ?
      `).bind(
        companyName || null,
        slogan || null,
        logoUrl || null,
        customDomain !== undefined ? String(customDomain).trim().toLowerCase() : null,
        themeConfig ? JSON.stringify(themeConfig) : null,
        tenantId
      ).run();

      return jsonResp({ status: "success", message: "Đã lưu nhận diện thương hiệu & cấu hình giao diện công ty!" });
    }

    // PROJECT LIFECYCLE & STORAGE HYGIENE (BACKUP DOWNLOAD, ARCHIVE, CLEAN R2 FILES, QUOTA)
    if (url.pathname === "/api/admin/project-action" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { action, projectId, storageQuotaMb, projectAdminId, allowedUserIds } = await request.json();

      if (action === "BACKUP") {
        const proj = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
        const tasks = await env.DB.prepare("SELECT * FROM tasks WHERE project_id = ? AND is_deleted = 0 ORDER BY order_index ASC").bind(projectId).all();
        const files = await env.DB.prepare("SELECT * FROM task_files WHERE project_id = ?").bind(projectId).all();
        return jsonResp({
          status: "success",
          backup: {
            exportedAt: new Date().toISOString(),
            companyName: tenant.company_name,
            project: proj,
            tasks: tasks.results || [],
            files: (files.results || []).map((f) => ({
              ...f,
              downloadUrl: `/api/file/view?key=${encodeURIComponent(f.file_key)}`
            }))
          }
        });
      }

      if (action === "ARCHIVE") {
        const nowStr = new Date().toISOString().split("T")[0];
        await env.DB.prepare("UPDATE projects SET status = 'Closed', closed_at = ?, updated_at = ? WHERE id = ?")
          .bind(nowStr, Math.floor(Date.now() / 1000), projectId).run();
        return jsonResp({ status: "success", message: "Đã lưu trữ và đóng dự án an toàn!" });
      }

      if (action === "REOPEN") {
        await env.DB.prepare("UPDATE projects SET status = 'Active', closed_at = NULL, updated_at = ? WHERE id = ?")
          .bind(Math.floor(Date.now() / 1000), projectId).run();
        return jsonResp({ status: "success", message: "Đã mở lại dự án!" });
      }

      if (action === "CLEAN_FILES") {
        const { results: files } = await env.DB.prepare("SELECT * FROM task_files WHERE project_id = ?").bind(projectId).all();
        let freedBytes = 0;
        for (const f of files || []) {
          freedBytes += Number(f.file_size || 0);
          if (env.MY_BUCKET && f.file_key) {
            try { await env.MY_BUCKET.delete(f.file_key); } catch (e) {}
          }
        }
        await env.DB.prepare("DELETE FROM task_files WHERE project_id = ?").bind(projectId).run();
        await env.DB.prepare("UPDATE tasks SET has_files = 0 WHERE project_id = ?").bind(projectId).run();
        await env.DB.prepare("UPDATE projects SET storage_used_bytes = 0 WHERE id = ?").bind(projectId).run();
        await env.DB.prepare("UPDATE tenants SET storage_used_bytes = MAX(0, COALESCE(storage_used_bytes, 0) - ?) WHERE id = ?").bind(freedBytes, tenantId).run();

        return jsonResp({
          status: "success",
          freedBytes,
          deletedCount: (files || []).length,
          message: `Đã xóa ${(files || []).length} tệp đính kèm, giải phóng ${(freedBytes / (1024 * 1024)).toFixed(2)} MB dung lượng lưu trữ (lịch sử tiến độ Gantt vẫn được giữ nguyên)!`
        });
      }

      if (action === "SET_QUOTA") {
        await env.DB.prepare(`
          UPDATE projects
          SET storage_quota_mb = COALESCE(?, storage_quota_mb),
              project_admin_id = COALESCE(?, project_admin_id),
              allowed_user_ids = COALESCE(?, allowed_user_ids)
          WHERE id = ?
        `).bind(
          storageQuotaMb !== undefined ? Number(storageQuotaMb) : null,
          projectAdminId !== undefined ? projectAdminId : null,
          allowedUserIds !== undefined ? JSON.stringify(allowedUserIds) : null,
          projectId
        ).run();
        return jsonResp({ status: "success", message: "Đã cập nhật phân quyền & hạn mức dự án!" });
      }
    }

    // EMPLOYEE & DEPARTMENT PERFORMANCE ANALYTICS (BY PROJECT, MONTH, YEAR)
    if (url.pathname === "/api/admin/analytics" && request.method === "GET") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const filterProject = url.searchParams.get("projectId") || "ALL";
      const filterMonth = url.searchParams.get("month") || "ALL"; // 01..12 or ALL
      const filterYear = url.searchParams.get("year") || "ALL";   // 2026 or ALL

      const { results: allTasks } = await env.DB.prepare("SELECT * FROM tasks WHERE (tenant_id = ? OR tenant_id IS NULL) AND is_deleted = 0 AND (is_mirror IS NULL OR is_mirror = 0)").bind(tenantId).all();
      const { results: allUsers } = await env.DB.prepare("SELECT id, username, full_name, avatar_url, dept, dept_tags, role FROM users WHERE tenant_id = ?").bind(tenantId).all();
      const { results: allProjects } = await env.DB.prepare("SELECT id, name FROM projects WHERE (tenant_id = ? OR tenant_id IS NULL) AND status != 'DELETED'").bind(tenantId).all();

      const projectMap = {};
      (allProjects || []).forEach((p) => { projectMap[p.id] = p.name; });

      const todayStr = new Date().toISOString().split("T")[0];

      const filteredTasks = (allTasks || []).filter((t) => {
        if (filterProject !== "ALL" && t.project_id !== filterProject) return false;
        const dateRef = t.start_date || t.end_date || "";
        if (filterYear !== "ALL" && !dateRef.startsWith(filterYear)) return false;
        if (filterMonth !== "ALL") {
          const parts = dateRef.split("-");
          if (parts[1] !== String(filterMonth).padStart(2, "0")) return false;
        }
        return true;
      });

      const staffStatsMap = {};
      const userLookup = {};
      (allUsers || []).forEach((u) => {
        userLookup[u.id] = u;
        userLookup[(u.full_name || "").toLowerCase()] = u;
        userLookup[(u.username || "").toLowerCase()] = u;
      });

      for (const t of filteredTasks) {
        const rawStaff = (t.staff || "Chưa giao").trim();
        const matchedU = (t.staff_user_id && userLookup[t.staff_user_id]) || userLookup[rawStaff.toLowerCase()];
        const key = matchedU ? matchedU.id : `name:${rawStaff}`;

        if (!staffStatsMap[key]) {
          staffStatsMap[key] = {
            userId: matchedU ? matchedU.id : "",
            staffName: matchedU ? (matchedU.full_name || matchedU.username) : rawStaff,
            avatarUrl: matchedU?.avatar_url || "",
            dept: t.dept || matchedU?.dept || "CONSTRUCTION",
            totalTasks: 0,
            completedOnTime: 0,
            completedLate: 0,
            inProgress: 0,
            overdue: 0,
            notStarted: 0,
            sumProgress: 0,
            projectsInvolved: new Set()
          };
        }

        const st = staffStatsMap[key];
        st.totalTasks++;
        const pct = Number(t.progress_percent) || (t.is_completed ? 100 : 0);
        st.sumProgress += pct;
        if (t.project_id && projectMap[t.project_id]) st.projectsInvolved.add(projectMap[t.project_id]);

        const isDone = Boolean(t.is_completed) || pct >= 100;
        const endDate = t.end_date || "";
        const doneDate = t.completed_at || t.last_progress_date || todayStr;

        if (isDone) {
          if (endDate && doneDate > endDate) st.completedLate++;
          else st.completedOnTime++;
        } else {
          if (endDate && todayStr > endDate) st.overdue++;
          else if (Boolean(t.is_started) || pct > 0) st.inProgress++;
          else st.notStarted++;
        }
      }

      const staffRanking = Object.values(staffStatsMap).map((s) => {
        const avgProgress = s.totalTasks > 0 ? Math.round(s.sumProgress / s.totalTasks) : 0;
        const onTimeRate = s.totalTasks > 0 ? Math.round(((s.completedOnTime) / s.totalTasks) * 100) : 0;
        const efficiencyScore = Math.max(0, Math.min(100, Math.round(avgProgress * 0.6 + onTimeRate * 0.4 - s.overdue * 8)));
        return {
          ...s,
          projectsInvolved: Array.from(s.projectsInvolved),
          avgProgress,
          onTimeRate,
          efficiencyScore
        };
      }).sort((a, b) => b.efficiencyScore - a.efficiencyScore || b.totalTasks - a.totalTasks);

      return jsonResp({
        summary: {
          totalTasks: filteredTasks.length,
          completedTasks: staffRanking.reduce((acc, s) => acc + s.completedOnTime + s.completedLate, 0),
          overdueTasks: staffRanking.reduce((acc, s) => acc + s.overdue, 0),
          inProgressTasks: staffRanking.reduce((acc, s) => acc + s.inProgress, 0)
        },
        staffRanking
      });
    }

    // CREATE VIETQR ORDER FOR RENEWAL, UPGRADE OR STORAGE ADD-ON (+10GB, +20GB...)
    if (url.pathname === "/api/admin/create-order" && request.method === "POST") {
      if (!isAdminOrSubAdmin) return jsonResp({ error: "Không có quyền!" }, 403);
      const { orderType = "RENEWAL", planType, billingCycle = "YEARLY", addonGb = 10, couponCode } = await request.json();

      const currentPlan = PLANS[tenant.plan_type] || PLANS.STARTER;
      let basePrice = 0;
      let targetPlan = planType || tenant.plan_type || "BUSINESS";

      if (orderType === "ADDON_STORAGE") {
        const blocksOf10Gb = Math.max(1, Math.round(Number(addonGb || 10) / 10));
        basePrice = blocksOf10Gb * (currentPlan.addonPricePer10Gb || 35000);
      } else {
        const cfg = PLANS[targetPlan] || PLANS.BUSINESS;
        basePrice = billingCycle === "MONTHLY" ? cfg.priceMonthly : cfg.priceYearly;
      }

      let discountAmount = 0;
      let finalAmount = basePrice;
      let appliedCoupon = null;
      if (couponCode) {
        const cp = await env.DB.prepare("SELECT * FROM coupons WHERE code = ? AND is_active = 1").bind(String(couponCode).trim().toUpperCase()).first();
        if (cp) {
          appliedCoupon = cp.code;
          discountAmount = Math.round((basePrice * (cp.discount_percent || 10)) / 100);
          finalAmount = basePrice - discountAmount;
        }
      }

      const orderId = `PRG${Math.floor(10000 + Math.random() * 90000)}`;
      await env.DB.prepare(`
        INSERT INTO payment_orders (
          id, tenant_id, order_type, subdomain_requested, company_name, owner_email,
          plan_type, billing_cycle, addon_gb, original_amount, discount_amount, amount,
          coupon_code, order_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).bind(
        orderId, tenantId, orderType, tenant.subdomain, tenant.company_name, tenant.owner_email || "admin@ltp-soft.com",
        targetPlan, billingCycle, Number(addonGb || 0), basePrice, discountAmount, finalAmount, appliedCoupon
      ).run();

      const bankBin = env.VIETQR_BANK_BIN || "970422";
      const bankAccount = env.VIETQR_ACCOUNT_NO || "0388888888";
      const bankAccountName = env.VIETQR_ACCOUNT_NAME || "CONG TY LTP SOFT";
      const qrUrl = `https://img.vietqr.io/image/${bankBin}-${bankAccount}-compact2.png?amount=${finalAmount}&addInfo=${encodeURIComponent(orderId)}&accountName=${encodeURIComponent(bankAccountName)}`;

      return jsonResp({
        success: true,
        order: {
          order_id: orderId,
          order_type: orderType,
          plan_type: targetPlan,
          addon_gb: Number(addonGb || 0),
          amount: finalAmount,
          formatted_amount: `${finalAmount.toLocaleString("vi-VN")} đ`,
          qr_url: qrUrl,
          bank_bin: bankBin,
          bank_account: bankAccount,
          bank_account_name: bankAccountName,
          transfer_content: orderId
        }
      });
    }

    // ========================================================================
    // 5. REALTIME DB VERSION & WORKSPACE GANTT ENDPOINTS (MULTI-TENANT SCOPED)
    // ========================================================================
    if (url.pathname === "/api/db/version" && request.method === "GET") {
      try {
        const projectId = url.searchParams.get("projectId") || "PRJ_01";
        const maxTaskRow = await env.DB.prepare("SELECT MAX(updated_at) as max_updated FROM tasks WHERE project_id = ?").bind(projectId).first();
        const prjRow = await env.DB.prepare("SELECT updated_at FROM projects WHERE id = ?").bind(projectId).first();
        const lastUpdated = Math.max(maxTaskRow?.max_updated || 0, prjRow?.updated_at || 0);
        return jsonResp({ projectId, version: lastUpdated || Date.now() });
      } catch (err) {
        return jsonResp({ version: Date.now() });
      }
    }

    if (url.pathname === "/api/workspace" && request.method === "GET") {
      try {
        const { results: rawProjects } = await env.DB.prepare(
          "SELECT * FROM projects WHERE (tenant_id = ? OR (tenant_id IS NULL AND ? = 'tenant-demo')) AND status != 'DELETED'"
        ).bind(tenantId, tenantId).all();

        const { results: rawTasks } = await env.DB.prepare(
          "SELECT * FROM tasks WHERE (tenant_id = ? OR (tenant_id IS NULL AND ? = 'tenant-demo')) AND is_deleted = 0 ORDER BY order_index ASC, rowid ASC"
        ).bind(tenantId, tenantId).all();

        const { results: depts } = await env.DB.prepare(
          "SELECT code, name, prefix, color, default_task_mode FROM departments WHERE tenant_id = ? ORDER BY order_index ASC"
        ).bind(tenantId).all();

        const { results: tenantUsers } = await env.DB.prepare(
          "SELECT id, username, full_name, avatar_url, role, dept, dept_tags, prefix, task_permission_mode, is_active FROM users WHERE tenant_id = ? AND is_active = 1"
        ).bind(tenantId).all();

        let fileCountMap = {};
        try {
          const { results: fileCounts } = await env.DB.prepare("SELECT task_id, COUNT(*) as file_count FROM task_files GROUP BY task_id").all();
          (fileCounts || []).forEach((fc) => { fileCountMap[fc.task_id] = fc.file_count; });
        } catch (e) {}

        let d2dLinks = [];
        try {
          const row = await env.DB.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'd2d_links'").bind(tenantId).first();
          if (row && row.value) d2dLinks = JSON.parse(row.value);
        } catch (e) {}

        // Filter projects based on Role (Public vs Bidding/Internal vs Project Admin)
        const visibleProjects = (rawProjects || []).filter((p) => {
          if (authUser.role === "ADMIN" || authUser.role === "BOSS") return true;
          if (authUser.role === "PROJECT_ADMIN") {
            const managed = authUser.managedProjectIds || [];
            return p.project_admin_id === authUser.id || managed.includes(p.id);
          }
          const isBidding = Boolean(p.is_dept_report || p.category === "REPORT" || (p.id && p.id.startsWith("PRJ_RPT_")));
          const isInternal = !Boolean(p.is_shared) && !isBidding;
          const invitedDepts = JSON.parse(p.invited_depts || "[]");
          const allowedUsers = JSON.parse(p.allowed_user_ids || "[]");
          const userDepts = Array.isArray(authUser.deptTags) && authUser.deptTags.length > 0 ? authUser.deptTags : [authUser.dept];

          if (isBidding) {
            if (allowedUsers.length > 0) return allowedUsers.includes(authUser.id) || p.creator_dept === authUser.dept;
            return invitedDepts.some((d) => userDepts.includes(d)) || p.creator_dept === authUser.dept;
          }
          if (isInternal) {
            return userDepts.includes(p.creator_dept) || invitedDepts.some((d) => userDepts.includes(d)) || allowedUsers.includes(authUser.id);
          }
          return true; // Public Shared Construction Project -> All approved company members see it
        });

        const formattedProjects = visibleProjects.map((p) => {
          const isRpt = Boolean(p.is_dept_report || p.category === "REPORT" || (p.id && p.id.startsWith("PRJ_RPT_")));
          let parsedTags = [];
          try { parsedTags = JSON.parse(p.project_tags || "[]"); } catch (e) {}

          const pTasks = (rawTasks || []).filter((t) => t.project_id === p.id).map((t) => {
            const fCnt = fileCountMap[t.id] || 0;
            const pTag = t.project_tag || undefined;
            if (pTag && !parsedTags.some((tg) => (typeof tg === "object" ? tg.name : tg) === pTag)) {
              parsedTags.push(pTag);
            }
            return {
              id: t.id,
              codeIn: t.code_in,
              codeOut: t.code_out || "",
              name: t.name,
              staff: t.staff || "Chưa giao",
              staffUserId: t.staff_user_id || "",
              createdByUserId: t.created_by_user_id || "",
              dept: t.dept,
              projectTag: pTag,
              start: t.start_date,
              end: t.end_date,
              startTime: t.start_time || "",
              endTime: t.end_time || "",
              isStarted: Boolean(t.is_started),
              isCompleted: Boolean(t.is_completed),
              completedAt: t.completed_at || "",
              progressPercent: t.progress_percent || 0,
              lastProgressDate: t.last_progress_date || "",
              hasFiles: fCnt > 0 || Boolean(t.has_files),
              fileCount: fCnt,
              notes: t.notes || "",
              isPublic: Boolean(t.is_public),
              isMirror: Boolean(t.is_mirror),
              sourceTaskId: t.source_task_id || undefined,
              sourceProjectId: t.source_project_id || undefined,
              sourceDept: t.source_dept || undefined,
              orderIndex: t.order_index ?? 0,
              updatedAt: t.updated_at || 0
            };
          });

          const isDeptJob = Boolean(p.is_dept_job || p.category === "DEPT_JOB" || (!Boolean(p.is_shared) && !isRpt));
          if (isDeptJob && parsedTags.length === 0) parsedTags = ["Hạng mục chung"];

          return {
            id: p.id,
            name: p.name,
            pin: p.pin,
            creatorDept: p.creator_dept,
            creatorPic: p.creator_pic,
            projectManager: p.project_manager,
            projectAdminId: p.project_admin_id || "",
            isShared: Boolean(p.is_shared),
            isDeptReport: isRpt,
            isDeptJob,
            category: isRpt ? "REPORT" : (isDeptJob ? "DEPT_JOB" : "SHARED"),
            invitedDepts: JSON.parse(p.invited_depts || "[]"),
            allowedUserIds: JSON.parse(p.allowed_user_ids || "[]"),
            projectTags: parsedTags,
            status: p.status,
            closedAt: p.closed_at,
            startRange: p.start_range,
            endRange: p.end_range,
            staffs: JSON.parse(p.staffs || "[]"),
            storageQuotaMb: Number(p.storage_quota_mb || 0),
            updatedAt: p.updated_at || 0,
            tasks: pTasks
          };
        });

        return jsonResp({
          tenant: {
            id: tenant.id,
            subdomain: tenant.subdomain,
            companyName: tenant.company_name,
            slogan: tenant.slogan || "ALL PROGRESS IN ONE",
            logoUrl: tenant.logo_url || "./asset/Logo_white.png",
            planType: tenant.plan_type,
            themeConfig: JSON.parse(tenant.theme_config || "{}")
          },
          departments: depts && depts.length > 0 ? depts : DEFAULT_DEPARTMENTS,
          directoryUsers: (tenantUsers || []).map((u) => ({
            id: u.id,
            username: u.username,
            fullName: u.full_name || u.username,
            avatarUrl: u.avatar_url || "",
            role: u.role,
            dept: u.dept,
            deptTags: JSON.parse(u.dept_tags || "[]"),
            prefix: u.prefix || "C",
            taskPermissionMode: u.task_permission_mode || "REPORT_ONLY"
          })),
          currentProjectId: formattedProjects[0]?.id || "PRJ_01",
          projects: formattedProjects,
          d2dLinks,
          serverTime: Date.now()
        });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // SAVE WORKSPACE & PROJECT LIST
    if (url.pathname === "/api/workspace" && request.method === "POST") {
      try {
        const workspace = await request.json();
        const nowSec = Math.floor(Date.now() / 1000);

        if (env.DB && workspace && Array.isArray(workspace.projects)) {
          for (const p of workspace.projects) {
            if (p.status === "DELETED") {
              await env.DB.prepare("DELETE FROM projects WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)").bind(p.id, tenantId).run();
              await env.DB.prepare("DELETE FROM tasks WHERE project_id = ?").bind(p.id).run();
              await env.DB.prepare("DELETE FROM task_files WHERE project_id = ?").bind(p.id).run();
            } else {
              await env.DB.prepare(`
                INSERT INTO projects (
                  id, tenant_id, name, pin, creator_dept, creator_pic, project_manager,
                  is_shared, invited_depts, allowed_user_ids, status, closed_at,
                  start_range, end_range, staffs, updated_at, project_tags, category
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  pin = excluded.pin,
                  creator_dept = excluded.creator_dept,
                  creator_pic = excluded.creator_pic,
                  project_manager = excluded.project_manager,
                  is_shared = excluded.is_shared,
                  invited_depts = excluded.invited_depts,
                  allowed_user_ids = excluded.allowed_user_ids,
                  status = excluded.status,
                  closed_at = excluded.closed_at,
                  start_range = excluded.start_range,
                  end_range = excluded.end_range,
                  staffs = excluded.staffs,
                  updated_at = excluded.updated_at,
                  project_tags = excluded.project_tags,
                  category = excluded.category
              `).bind(
                p.id, tenantId, p.name, p.pin || "12345678", p.creatorDept || "CONSTRUCTION",
                p.creatorPic || "", p.projectManager || "", p.isShared ? 1 : 0,
                JSON.stringify(p.invitedDepts || []), JSON.stringify(p.allowedUserIds || []),
                p.status || "Active", p.closedAt || null, p.startRange || "", p.endRange || "",
                JSON.stringify(p.staffs || []), nowSec, JSON.stringify(p.projectTags || []),
                p.category || (p.isDeptJob ? "DEPT_JOB" : "SHARED")
              ).run();
            }
          }
        }

        if (env.DB && workspace && Array.isArray(workspace.d2dLinks)) {
          await env.DB.prepare(
            "INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'd2d_links', ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
          ).bind(tenantId, JSON.stringify(workspace.d2dLinks), nowSec).run();
        }

        return jsonResp({ status: "success", updatedAt: nowSec });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 6. ATOMIC TASK SAVE / UPDATE / DELETE (WITH STAFF PERMISSION GUARD)
    // ========================================================================
    if (url.pathname === "/api/db/task" && request.method === "POST") {
      if (authUser.role === "GUEST" || authUser.role === "WAITING") {
        return jsonResp({ error: "Tài khoản chưa được cấp quyền chỉnh sửa công việc!" }, 403);
      }

      try {
        const t = await request.json();
        const nowSec = Math.floor(Date.now() / 1000);
        const existingTask = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(t.id).first();

        // Check granular Staff permission rules
        if (authUser.role === "STAFF") {
          const userRow = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(authUser.id).first();
          const permMode = userRow?.task_permission_mode || authUser.taskPermissionMode || "REPORT_ONLY";

          if (!existingTask) {
            // Creating a new task
            if (permMode === "REPORT_ONLY") {
              return jsonResp({ error: "Tài khoản của bạn đang ở chế độ '🔒 Chỉ báo cáo tiến độ' (không được tự tạo việc mới). Vui lòng liên hệ Trưởng phòng/Admin!" }, 403);
            }
            t.staffUserId = authUser.id;
            t.createdByUserId = authUser.id;
          } else {
            const isOwnTask =
              existingTask.staff_user_id === authUser.id ||
              existingTask.created_by_user_id === authUser.id ||
              (existingTask.staff || "").toLowerCase() === (authUser.fullName || "").toLowerCase() ||
              (existingTask.staff || "").toLowerCase() === (authUser.username || "").toLowerCase();

            // If not own task, Staff can ONLY add/edit notes on linked tasks!
            if (!isOwnTask) {
              await env.DB.prepare("UPDATE tasks SET notes = ?, updated_at = ? WHERE id = ?")
                .bind(t.notes || "", nowSec, t.id).run();
              await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowSec, t.projectId || existingTask.project_id).run();
              return jsonResp({ status: "success", taskId: t.id, updatedAt: nowSec, noteOnly: true });
            }

            // If own task but in REPORT_ONLY mode (or assigned by manager), freeze start_date & end_date!
            if (permMode === "REPORT_ONLY") {
              t.start = existingTask.start_date;
              t.end = existingTask.end_date;
              t.name = existingTask.name;
            }
          }
        }

        let hasFilesVal = t.hasFiles ? 1 : 0;
        try {
          const cntRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM task_files WHERE task_id = ?").bind(t.id).first();
          if ((cntRow?.cnt || 0) > 0) hasFilesVal = 1;
        } catch (e) {}

        const isCompletedBool = Boolean(t.isCompleted) || Number(t.progressPercent) >= 100;
        const completedAtStr = isCompletedBool
          ? (existingTask?.completed_at || new Date().toISOString().split("T")[0])
          : "";

        await env.DB.prepare(`
          INSERT INTO tasks (
            id, tenant_id, project_id, code_in, code_out, name, staff, staff_user_id, created_by_user_id,
            dept, start_date, end_date, start_time, end_time, is_started, is_completed, completed_at,
            progress_percent, last_progress_date, has_files, notes, is_deleted, updated_at,
            project_tag, is_mirror, source_task_id, source_project_id, source_dept, order_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            code_in = excluded.code_in,
            code_out = excluded.code_out,
            name = excluded.name,
            staff = excluded.staff,
            staff_user_id = CASE WHEN excluded.staff_user_id != '' THEN excluded.staff_user_id ELSE tasks.staff_user_id END,
            dept = excluded.dept,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            is_started = excluded.is_started,
            is_completed = excluded.is_completed,
            completed_at = excluded.completed_at,
            progress_percent = excluded.progress_percent,
            last_progress_date = excluded.last_progress_date,
            has_files = excluded.has_files,
            notes = excluded.notes,
            updated_at = excluded.updated_at,
            project_tag = excluded.project_tag,
            is_mirror = excluded.is_mirror,
            source_task_id = excluded.source_task_id,
            source_project_id = excluded.source_project_id,
            source_dept = excluded.source_dept,
            order_index = excluded.order_index
        `).bind(
          t.id, tenantId, t.projectId || "PRJ_01", t.codeIn, t.codeOut || "", t.name,
          t.staff || "Chưa giao", t.staffUserId || "", t.createdByUserId || authUser.id || "",
          t.dept || "CONSTRUCTION", t.start, t.end, t.startTime || "", t.endTime || "",
          t.isStarted ? 1 : 0, isCompletedBool ? 1 : 0, completedAtStr,
          t.progressPercent || 0, t.lastProgressDate || "", hasFilesVal, t.notes || "", nowSec,
          t.projectTag || "", t.isMirror ? 1 : 0, t.sourceTaskId || "", t.sourceProjectId || "", t.sourceDept || "",
          t.orderIndex ?? 0
        ).run();

        await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowSec, t.projectId || "PRJ_01").run();
        return jsonResp({ status: "success", taskId: t.id, updatedAt: nowSec });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    if (url.pathname === "/api/db/link" && request.method === "POST") {
      if (authUser.role === "GUEST") return jsonResp({ error: "Chỉ xem!" }, 403);
      try {
        const { taskId, codeOut, projectId } = await request.json();
        const nowSec = Math.floor(Date.now() / 1000);
        await env.DB.prepare("UPDATE tasks SET code_out = ?, updated_at = ? WHERE id = ?").bind(codeOut, nowSec, taskId).run();
        if (projectId) await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowSec, projectId).run();
        return jsonResp({ status: "success", taskId, updatedAt: nowSec });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    if (url.pathname === "/api/db/task" && request.method === "DELETE") {
      if (authUser.role === "GUEST") return jsonResp({ error: "Không có quyền xóa!" }, 403);
      try {
        const { id, projectId } = await request.json();
        if (authUser.role === "STAFF") {
          const userRow = await env.DB.prepare("SELECT task_permission_mode FROM users WHERE id = ?").bind(authUser.id).first();
          const permMode = userRow?.task_permission_mode || authUser.taskPermissionMode || "REPORT_ONLY";
          const taskRow = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
          if (permMode === "REPORT_ONLY" || (taskRow && taskRow.created_by_user_id && taskRow.created_by_user_id !== authUser.id)) {
            return jsonResp({ error: "🔒 Bạn không có quyền xóa công việc được giao (Chỉ Trưởng phòng & Admin mới được xóa)!" }, 403);
          }
        }
        const nowSec = Math.floor(Date.now() / 1000);
        await env.DB.prepare("UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE id = ?").bind(nowSec, id).run();
        if (projectId) await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowSec, projectId).run();
        return jsonResp({ status: "deleted", id, updatedAt: nowSec });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 7. CLOUDFLARE R2 FILE STORAGE (ALL WORK FILE TYPES ALLOWED + ANTI-VIRUS + QUOTA)
    // ========================================================================
    if (url.pathname === "/api/file/upload" && request.method === "POST") {
      if (authUser.role === "GUEST" || authUser.role === "WAITING") {
        return jsonResp({ error: "Tài khoản Khách không có quyền tải tệp lên!" }, 403);
      }

      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const taskId = formData.get("taskId");
        const projectId = formData.get("projectId") || "PRJ_01";
        const uploadedBy = formData.get("uploadedBy") || authUser.fullName || authUser.id || "User";

        if (!file || !taskId) {
          return jsonResp({ error: "Thiếu tệp hoặc taskId" }, 400);
        }

        const fileName = file.name || "attachment";
        const dotIdx = fileName.lastIndexOf(".");
        const ext = dotIdx >= 0 ? fileName.slice(dotIdx).toLowerCase() : "";
        if (BLOCKED_EXTENSIONS.has(ext)) {
          return jsonResp({ error: `Định dạng file thực thi (${ext}) bị chặn vì lý do an toàn bảo mật! Hệ thống hỗ trợ mọi file Bản vẽ (.dwg, .dxf, .skp), File nén (.zip, .rar), Video (.mp4, .mov), PDF, Office và Ảnh.` }, 400);
        }

        // Check Per-File Size Ceiling
        const maxFileMb = Number(tenant.max_file_size_mb) || 200;
        const fileSizeMb = file.size / (1024 * 1024);
        if (fileSizeMb > maxFileMb) {
          return jsonResp({ error: `Tệp "${fileName}" (${fileSizeMb.toFixed(1)} MB) vượt quá trần tối đa ${maxFileMb} MB/file của gói ${tenant.plan_type}!` }, 400);
        }

        // Check Tenant Total Storage Quota
        const totalLimitBytes = ((Number(tenant.storage_limit_mb) || 500) + (Number(tenant.addon_storage_mb) || 0)) * 1024 * 1024;
        const currentUsedBytes = Number(tenant.storage_used_bytes) || 0;
        if (currentUsedBytes + file.size > totalLimitBytes) {
          return jsonResp({ error: "Kho lưu trữ đám mây của công ty đã đầy! Vui lòng báo Admin xóa bớt file dự án cũ hoặc mua thêm dung lượng (+GB)." }, 400);
        }

        // Check Per-Project Storage Quota (if set by Corporate Admin)
        const projRow = await env.DB.prepare("SELECT storage_quota_mb, storage_used_bytes FROM projects WHERE id = ?").bind(projectId).first();
        if (projRow && Number(projRow.storage_quota_mb) > 0) {
          const projQuotaBytes = Number(projRow.storage_quota_mb) * 1024 * 1024;
          if (Number(projRow.storage_used_bytes || 0) + file.size > projQuotaBytes) {
            return jsonResp({ error: `Dự án này đã chạm hạn mức dung lượng được cấp (${projRow.storage_quota_mb} MB)!` }, 400);
          }
        }

        const fileKey = `tenants/${tenantId}/projects/${projectId}/${taskId}/${Date.now()}_${fileName}`;
        if (env.MY_BUCKET) {
          await env.MY_BUCKET.put(fileKey, file.stream(), {
            httpMetadata: { contentType: file.type || "application/octet-stream" }
          });
        }

        const fileId = "FILE_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const nowStr = new Date().toISOString().split("T")[0];
        const nowSec = Math.floor(Date.now() / 1000);

        if (env.DB) {
          await env.DB.prepare(`
            INSERT INTO task_files (id, tenant_id, task_id, project_id, file_name, file_key, file_size, mime_type, uploaded_by, uploaded_by_user_id, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(fileId, tenantId, taskId, projectId, fileName, fileKey, file.size, file.type || "application/octet-stream", uploadedBy, authUser.id || "", nowStr).run();

          await env.DB.prepare("UPDATE tasks SET has_files = 1, updated_at = ? WHERE id = ?").bind(nowSec, taskId).run();
          await env.DB.prepare("UPDATE projects SET updated_at = ?, storage_used_bytes = COALESCE(storage_used_bytes, 0) + ? WHERE id = ?").bind(nowSec, file.size, projectId).run();
          await env.DB.prepare("UPDATE tenants SET storage_used_bytes = COALESCE(storage_used_bytes, 0) + ? WHERE id = ?").bind(file.size, tenantId).run();
        }

        return jsonResp({
          status: "success",
          file: {
            id: fileId,
            taskId,
            projectId,
            fileName,
            fileKey,
            fileSize: file.size,
            mimeType: file.type,
            uploadedBy,
            uploadedAt: nowStr,
            viewUrl: `/api/file/view?key=${encodeURIComponent(fileKey)}`
          }
        });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    if (url.pathname === "/api/file/list" && request.method === "GET") {
      try {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return jsonResp([]);
        const { results } = await env.DB.prepare("SELECT * FROM task_files WHERE task_id = ? ORDER BY uploaded_at DESC").bind(taskId).all();
        return jsonResp((results || []).map((f) => ({
          id: f.id,
          taskId: f.task_id,
          projectId: f.project_id,
          fileName: f.file_name,
          fileKey: f.file_key,
          fileSize: f.file_size,
          mimeType: f.mime_type,
          uploadedBy: f.uploaded_by,
          uploadedAt: f.uploaded_at,
          viewUrl: `/api/file/view?key=${encodeURIComponent(f.file_key)}`
        })));
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    if ((url.pathname === "/api/file/view" || url.pathname === "/api/file/get") && request.method === "GET") {
      try {
        const key = url.searchParams.get("key");
        if (!key || !env.MY_BUCKET) return new Response("File or R2 Bucket not available", { status: 404, headers });
        const object = await env.MY_BUCKET.get(key);
        if (!object) return new Response("File not found in R2 Bucket", { status: 404, headers });
        const streamHeaders = new Headers(headers);
        object.writeHttpMetadata(streamHeaders);
        streamHeaders.set("etag", object.httpEtag);
        streamHeaders.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
        return new Response(object.body, { headers: streamHeaders });
      } catch (err) {
        return new Response("Error streaming file: " + err.message, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/file/delete" && (request.method === "DELETE" || request.method === "POST")) {
      if (authUser.role === "GUEST") return jsonResp({ error: "Không có quyền xóa file!" }, 403);
      try {
        const { fileId, fileKey, taskId, projectId } = await request.json();
        const fRow = fileId ? await env.DB.prepare("SELECT * FROM task_files WHERE id = ?").bind(fileId).first() : null;

        if (authUser.role === "STAFF" && fRow && fRow.uploaded_by_user_id && fRow.uploaded_by_user_id !== authUser.id) {
          return jsonResp({ error: "Nhân viên chỉ được xóa tệp do chính mình tải lên!" }, 403);
        }

        if (env.MY_BUCKET && fileKey) {
          try { await env.MY_BUCKET.delete(fileKey); } catch (e) {}
        }
        if (env.DB && fileId) {
          const sz = Number(fRow?.file_size || 0);
          await env.DB.prepare("DELETE FROM task_files WHERE id = ?").bind(fileId).run();
          const fileCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM task_files WHERE task_id = ?").bind(taskId).first();
          const hasFiles = (fileCount?.cnt || 0) > 0 ? 1 : 0;
          const nowSec = Math.floor(Date.now() / 1000);
          await env.DB.prepare("UPDATE tasks SET has_files = ?, updated_at = ? WHERE id = ?").bind(hasFiles, nowSec, taskId).run();
          if (projectId) {
            await env.DB.prepare("UPDATE projects SET updated_at = ?, storage_used_bytes = MAX(0, COALESCE(storage_used_bytes, 0) - ?) WHERE id = ?").bind(nowSec, sz, projectId).run();
          }
          await env.DB.prepare("UPDATE tenants SET storage_used_bytes = MAX(0, COALESCE(storage_used_bytes, 0) - ?) WHERE id = ?").bind(sz, tenantId).run();
        }
        return jsonResp({ status: "success", fileId, taskId });
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ========================================================================
    // 8. MINA EXECUTIVE AI ASSISTANT (ADMIN / BOSS ONLY + DAILY QUOTA)
    // ========================================================================
    if (url.pathname === "/api/ai/chat" && request.method === "POST") {
      if (authUser.role === "STAFF" || authUser.role === "GUEST" || authUser.role === "WAITING") {
        return jsonResp({ error: "🔒 Trợ lý Giám đốc AI Mina chỉ dành riêng cho tài khoản Quản trị viên (Admin / Boss / Trưởng Ban QLDA)!" }, 403);
      }

      try {
        const todayStr = new Date().toISOString().split("T")[0];
        let usedToday = tenant.ai_usage_date === todayStr ? Number(tenant.ai_used_today || 0) : 0;
        const limitToday = Number(tenant.ai_daily_limit || 25);

        if (usedToday >= limitToday) {
          return jsonResp({ error: `Công ty đã dùng hết ${limitToday}/${limitToday} lượt phân tích AI Mina trong ngày hôm nay của gói ${tenant.plan_type}.` }, 429);
        }

        const { messages, projectContext } = await request.json();
        const systemPrompt = `Bạn là Mina - trợ lý ảo điều hành thông minh của phần mềm quản lý tiến độ ${tenant.company_name || "LTP Progress Hub"}.
Hãy trả lời ngắn gọn, súc tích trong 1-3 câu dựa chính xác vào số liệu trong DỮ LIỆU DỰ ÁN:
${JSON.stringify(projectContext || {}, null, 2)}`;

        if (env.AI) {
          const aiMessages = [{ role: "system", content: systemPrompt }, ...(messages || [])];
          const candidateModels = [
            "@cf/meta/llama-4-scout-17b-16e-instruct",
            "@cf/meta/llama-3.2-3b-instruct",
            "@cf/zhipuai/glm-4.7-flash"
          ];
          for (const model of candidateModels) {
            try {
              const aiResponse = await env.AI.run(model, { messages: aiMessages, max_tokens: 1024, temperature: 0.3 });
              const replyText = aiResponse?.response || aiResponse?.text || aiResponse?.result?.response || aiResponse?.choices?.[0]?.message?.content;
              if (replyText) {
                await env.DB.prepare("UPDATE tenants SET ai_used_today = ?, ai_usage_date = ? WHERE id = ?")
                  .bind(usedToday + 1, todayStr, tenantId).run();
                return jsonResp({ reply: replyText, modelUsed: model, remainingToday: limitToday - (usedToday + 1) });
              }
            } catch (e) {}
          }
        }
        return jsonResp({ error: "AI service busy" }, 503);
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    return new Response("LTP Progress Hub SaaS v9.0 Multi-Tenant API Running", { status: 200, headers });
  }
};

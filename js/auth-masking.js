/**
 * Authentication & Multi-Tenant SaaS Data Scoping Module v8.0 — LTP Progress Hub
 * Supports Multi-Tenant JWT Sessions, QR Waiting Room Onboarding Sessions,
 * Granular Staff Task Permissions (REPORT_ONLY vs AUTONOMOUS),
 * Dynamic Company Branding (Logo + Name), and Role-Based Access Security.
 */

const ACCOUNTS_DB = [];

function getHostSubdomain() {
    try {
        const params = new URLSearchParams(window.location.search);
        const explicit = params.get("tenant") || params.get("subdomain") || "";
        if (explicit) return explicit.trim().toLowerCase().replace(/-(pm|progress)$/i, "");
        const host = (window.location.hostname || "").toLowerCase().split(":")[0];
        if (host.endsWith(".ltp-soft.com")) {
            const sub = host.slice(0, -".ltp-soft.com".length);
            if (sub && !["progress", "www", "app", "admin"].includes(sub)) {
                return sub.replace(/-(pm|progress)$/i, "");
            }
        }
    } catch (e) {}
    return "";
}
window.getHostSubdomain = getHostSubdomain;

// Resolve full department object from id, code, or name
function resolveDept(deptIdentifier) {
    if (!deptIdentifier) return (window.DEPARTMENTS && window.DEPARTMENTS[0]) || null;
    const s = String(deptIdentifier).trim().toUpperCase();
    const depts = (typeof window !== "undefined" && Array.isArray(window.DEPARTMENTS)) ? window.DEPARTMENTS : [];
    return depts.find(d => 
        String(d.id || "").toUpperCase() === s ||
        String(d.code || "").toUpperCase() === s ||
        String(d.name || "").toUpperCase() === s
    ) || null;
}
window.resolveDept = resolveDept;

// Universal Department Matching Helper (Matches across id, code, name, prefix)
function areDeptsMatching(deptA, deptB) {
    if (!deptA || !deptB) return false;
    const sA = String(deptA).trim().toUpperCase();
    const sB = String(deptB).trim().toUpperCase();
    if (sA === sB) return true;
    if (sA === "ALL" || sB === "ALL") return true;

    const depts = (typeof window !== "undefined" && Array.isArray(window.DEPARTMENTS)) ? window.DEPARTMENTS : [];
    const objA = depts.find(d => 
        String(d.id || "").toUpperCase() === sA ||
        String(d.code || "").toUpperCase() === sA ||
        String(d.name || "").toUpperCase() === sA
    );
    const objB = depts.find(d => 
        String(d.id || "").toUpperCase() === sB ||
        String(d.code || "").toUpperCase() === sB ||
        String(d.name || "").toUpperCase() === sB
    );

    if (objA && objB) {
        return (objA.id && objA.id === objB.id) ||
               (objA.code && objA.code.toUpperCase() === objB.code.toUpperCase()) ||
               (objA.name && objA.name.toUpperCase() === objB.name.toUpperCase());
    }
    if (objA) {
        return String(objA.id || "").toUpperCase() === sB ||
               String(objA.code || "").toUpperCase() === sB ||
               String(objA.name || "").toUpperCase() === sB;
    }
    if (objB) {
        return String(objB.id || "").toUpperCase() === sA ||
               String(objB.code || "").toUpperCase() === sA ||
               String(objB.name || "").toUpperCase() === sA;
    }
    return false;
}
window.areDeptsMatching = areDeptsMatching;

// Determine Department from Code In Prefix (Dynamic based on window.DEPARTMENTS)
function getDeptFromCodeIn(codeIn) {
    if (!codeIn) return (window.DEPARTMENTS && window.DEPARTMENTS[0]?.id) || "CONSTRUCTION";
    const prefix = codeIn.trim().charAt(0).toUpperCase();
    if (Array.isArray(window.DEPARTMENTS)) {
        const found = window.DEPARTMENTS.find(d => (d.prefix || d.code || "").toUpperCase() === prefix);
        if (found) return found.id || found.code || found.name;
    }
    switch (prefix) {
        case 'E': return "MEP";
        case 'G': return "DESIGNER";
        case 'X': return "FACTORY";
        case 'H': return "PURCHASING";
        case 'A': return "ACCOUNTANT";
        case 'C': return "CONSTRUCTION";
        default: return (window.DEPARTMENTS && window.DEPARTMENTS[0]?.id) || "CONSTRUCTION";
    }
}

// Use same-origin Cloudflare Pages Functions (/api/...) when served over HTTP/HTTPS, fallback to Worker URL if file://
const WORKER_API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:")
    ? ""
    : "https://schedule-manager-api.sdivn01.workers.dev";
window.WORKER_API_BASE = WORKER_API_BASE;

function getApiUrl(path) {
    if (!path.startsWith("/")) path = "/" + path;
    return WORKER_API_BASE + path;
}
window.getApiUrl = getApiUrl;

function decodeTokenPayloadSafe(tokenStr) {
    if (!tokenStr) return null;
    try {
        const parts = String(tokenStr).split(".");
        const rawB64 = parts.length >= 2 ? parts[1] : parts[0];
        const norm = rawB64.replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(decodeURIComponent(escape(atob(norm))));
    } catch (e) {
        try {
            return JSON.parse(atob(tokenStr));
        } catch (err) {
            return null;
        }
    }
}

const DEFAULT_UNAUTH_USER = {
    id: "",
    username: "",
    name: "Chưa đăng nhập",
    pass: "",
    role: "GUEST",
    dept: "NONE",
    prefix: "",
    isBoss: false,
    canEditAll: false,
    isGuest: true
};

class AuthManager {
    constructor() {
        this.currentUser = { ...DEFAULT_UNAUTH_USER };
        this.tenantInfo = null;
        this.directoryUsers = [];
        this.tenantDepartments = [];
        try {
            const cached = JSON.parse(localStorage.getItem("tenant_branding") || "null");
            const hostSub = getHostSubdomain();
            const cachedSub = (cached?.subdomain || "").toLowerCase().replace(/-(pm|progress)$/i, "");
            if (cached && (!hostSub || !cachedSub || cachedSub === hostSub)) {
                this.tenantInfo = cached;
                this.applyBrandingToHeader(cached);
            }
        } catch(e) {}
        this.loadSession();
        this.loadPublicTenantBrand();
    }

    clearLocalTenantCache() {
        localStorage.removeItem("gantt_session_user");
        localStorage.removeItem("gantt_auth_token");
        localStorage.removeItem("ltp_jwt_token");
        localStorage.removeItem("CRYSTAL_ACTIVE_SESSION_V2");
        localStorage.removeItem("gantt_live_workspace_v7");
        localStorage.removeItem("gantt_tenant_departments");
        localStorage.removeItem("tenant_branding");
    }

    loadSession() {
        this.adminDeptContext = (window.DEPARTMENTS && window.DEPARTMENTS[0]?.id) || "CONSTRUCTION";
        const hostSub = getHostSubdomain();

        // 1. Check Multi-Tenant V2 Session first (from landing.html / join.html / admin.html / index.html)
        const v2Raw = localStorage.getItem("CRYSTAL_ACTIVE_SESSION_V2");
        if (v2Raw) {
            try {
                const v2 = JSON.parse(v2Raw);
                const sessToken = v2?.token || localStorage.getItem("ltp_jwt_token") || "";
                const decodedTok = decodeTokenPayloadSafe(sessToken);
                const sessSub = (v2?.tenant?.subdomain || decodedTok?.subdomain || "").toLowerCase().replace(/-(pm|progress)$/i, "");

                // Enforce strict subdomain lock: if visiting a specific company subdomain, reject sessions from other companies or unsigned legacy tokens
                if ((hostSub && sessSub && sessSub !== hostSub) || (sessToken && !String(sessToken).includes("."))) {
                    this.clearLocalTenantCache();
                    this.currentUser = { ...DEFAULT_UNAUTH_USER };
                    return;
                }

                if (v2 && (v2.username || v2.id) && String(sessToken).includes(".")) {
                    const mappedRole = v2.role === "SUPER_ADMIN" ? "ADMIN" : (v2.role || "STAFF");
                    const primaryDept = (v2.department || v2.dept || "ALL");
                    localStorage.setItem("ltp_jwt_token", sessToken);
                    localStorage.setItem("gantt_auth_token", sessToken);
                    if (v2.tenant) {
                        this.tenantInfo = v2.tenant;
                        this.applyBrandingToHeader(v2.tenant);
                    }
                    this.currentUser = {
                        id: v2.username || v2.id,
                        username: v2.username || v2.id,
                        name: v2.name || v2.fullName || v2.username || v2.id,
                        pass: "",
                        role: mappedRole,
                        dept: ["ADMIN", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : primaryDept,
                        deptTags: Array.isArray(v2.deptTags) ? v2.deptTags : [primaryDept],
                        taskPermissionMode: v2.taskPermissionMode || (["ADMIN", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                        avatarUrl: v2.avatarUrl || "",
                        prefix: v2.prefix || (primaryDept === "MEP" ? "E" : "C"),
                        isBoss: false,
                        isWaiting: Boolean(v2.isWaiting || mappedRole === "WAITING"),
                        canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                        isGuest: mappedRole === "GUEST",
                        tenant: v2.tenant || null
                    };
                    return;
                }
            } catch (e) {}
        }

        // 2. Check signed JWT token in ltp_jwt_token / gantt_auth_token
        const savedToken = localStorage.getItem("ltp_jwt_token") || localStorage.getItem("gantt_auth_token");
        if (savedToken && String(savedToken).includes(".")) {
            const decoded = decodeTokenPayloadSafe(savedToken);
            const tokSub = (decoded?.subdomain || "").toLowerCase().replace(/-(pm|progress)$/i, "");
            if (hostSub && tokSub && tokSub !== hostSub) {
                this.clearLocalTenantCache();
                this.currentUser = { ...DEFAULT_UNAUTH_USER };
                return;
            }
            if (decoded && (!decoded.exp || decoded.exp > Date.now())) {
                const userId = decoded.username || decoded.id || decoded.sub || "";
                if (userId) {
                    const mappedRole = decoded.role === "SUPER_ADMIN" ? "ADMIN" : (decoded.role || "STAFF");
                    const dept = decoded.department || decoded.dept || "ALL";
                    this.currentUser = {
                        id: userId,
                        username: userId,
                        name: decoded.fullName || decoded.name || userId,
                        pass: "",
                        role: mappedRole,
                        dept: ["ADMIN", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : dept,
                        deptTags: decoded.deptTags || [dept],
                        taskPermissionMode: decoded.taskPermissionMode || (["ADMIN", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                        avatarUrl: decoded.avatarUrl || "",
                        prefix: decoded.prefix || (dept === "MEP" ? "E" : "C"),
                        isBoss: false,
                        isWaiting: Boolean(decoded.isWaiting || mappedRole === "WAITING"),
                        canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                        isGuest: mappedRole === "GUEST"
                    };
                    return;
                }
            }
        } else if (savedToken && !String(savedToken).includes(".")) {
            this.clearLocalTenantCache();
        }

        this.currentUser = { ...DEFAULT_UNAUTH_USER };
    }

    getAdminDeptContext() {
        return this.adminDeptContext || (window.DEPARTMENTS && window.DEPARTMENTS[0]?.id) || "CONSTRUCTION";
    }

    setAdminDeptContext(dept) {
        if (typeof DEPARTMENTS !== "undefined" && DEPARTMENTS && DEPARTMENTS.some(d => d.id === dept)) {
            this.adminDeptContext = dept;
        } else {
            this.adminDeptContext = dept || "CONSTRUCTION";
        }
    }

    async loginWithCredentials(username, password, subdomain = "") {
        const cleanUsername = (username || "").trim();
        const cleanPassword = (password || "").trim();
        const targetSub = (subdomain || getHostSubdomain() || "").trim().toLowerCase();

        if (!cleanUsername || !cleanPassword) {
            throw new Error("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!");
        }

        const apiUrl = getApiUrl(`/api/auth/login?_t=${Date.now()}`);
        const reqHeaders = { "Content-Type": "application/json" };
        if (targetSub) reqHeaders["X-Tenant"] = targetSub;

        let res;
        try {
            res = await fetch(apiUrl, {
                method: "POST",
                headers: reqHeaders,
                body: JSON.stringify({ username: cleanUsername, password: cleanPassword, subdomain: targetSub })
            });
        } catch (netErr) {
            throw new Error("Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra kết nối mạng!");
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Tên đăng nhập hoặc mật khẩu không đúng!");
        }

        if (data && data.token && data.user) {
            const u = data.user;
            const isWaitingUser = Boolean(data.isWaiting || data.statusLabel === "WAITING_ROOM" || u.role === "WAITING" || u.status === "WAITING_ROOM");
            const mappedRole = isWaitingUser ? "WAITING" : (u.role === "SUPER_ADMIN" ? "ADMIN" : (u.role || "STAFF"));
            const userId = u.username || u.id || cleanUsername;
            const primaryDept = u.department || u.dept || "ALL";
            const activeTenantSub = (data.tenant?.subdomain || targetSub || "").toLowerCase();

            const prevTenantSub = localStorage.getItem("gantt_active_tenant_sub") || "";
            if (prevTenantSub !== activeTenantSub) {
                localStorage.removeItem("gantt_live_workspace_v7");
                localStorage.removeItem("gantt_tenant_departments");
            }
            if (activeTenantSub) {
                localStorage.setItem("gantt_active_tenant_sub", activeTenantSub);
            }

            localStorage.setItem("ltp_jwt_token", data.token);
            localStorage.setItem("gantt_auth_token", data.token);
            localStorage.setItem("gantt_session_user", userId);

            if (data.tenant) {
                this.tenantInfo = data.tenant;
                this.applyBrandingToHeader(data.tenant);
            }

            this.currentUser = {
                id: userId,
                username: userId,
                name: u.fullName || u.name || userId,
                pass: "",
                role: mappedRole,
                dept: ["ADMIN", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : primaryDept,
                deptTags: Array.isArray(u.deptTags) ? u.deptTags : [primaryDept],
                taskPermissionMode: u.taskPermissionMode || (["ADMIN", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                avatarUrl: u.avatarUrl || "",
                prefix: u.prefix || (primaryDept === "MEP" ? "E" : "C"),
                isBoss: false,
                isWaiting: isWaitingUser,
                canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                isGuest: false,
                tenant: data.tenant || null
            };

            localStorage.setItem("CRYSTAL_ACTIVE_SESSION_V2", JSON.stringify({
                id: this.currentUser.id,
                username: this.currentUser.username,
                name: this.currentUser.name,
                role: this.currentUser.role,
                isWaiting: isWaitingUser,
                department: primaryDept,
                dept: primaryDept,
                deptTags: this.currentUser.deptTags,
                prefix: this.currentUser.prefix,
                taskPermissionMode: this.currentUser.taskPermissionMode,
                avatarUrl: this.currentUser.avatarUrl,
                tenant: data.tenant || null,
                token: data.token,
                loginTime: new Date().toISOString()
            }));

            return this.currentUser;
        }

        throw new Error(data.error || "Tên đăng nhập hoặc mật khẩu không đúng!");
    }

    getAuthToken() {
        return localStorage.getItem("ltp_jwt_token") || localStorage.getItem("gantt_auth_token") || "";
    }

    getToken() {
        return this.getAuthToken();
    }

    getAuthHeaders() {
        const token = this.getAuthToken();
        const hostSub = getHostSubdomain();
        const headers = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }
        if (hostSub) {
            headers["X-Tenant"] = hostSub;
        }
        return headers;
    }

    getFileAuthHeaders() {
        const token = this.getAuthToken();
        const hostSub = getHostSubdomain();
        const headers = {};
        if (token) headers["Authorization"] = "Bearer " + token;
        if (hostSub) headers["X-Tenant"] = hostSub;
        return headers;
    }

    switchUser() {
        return null;
    }

    logout() {
        this.currentUser = { ...DEFAULT_UNAUTH_USER };
        localStorage.removeItem("gantt_session_user");
        localStorage.removeItem("gantt_auth_token");
        localStorage.removeItem("ltp_jwt_token");
        localStorage.removeItem("CRYSTAL_ACTIVE_SESSION_V2");
        return this.currentUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    isAdmin() {
        return this.currentUser.role === "ADMIN" || this.currentUser.role === "SUPER_ADMIN";
    }

    isSuperTenantAdmin() {
        return this.currentUser.role === "ADMIN";
    }

    isProjectAdmin() {
        return this.currentUser.role === "PROJECT_ADMIN";
    }

    isBoss() {
        return this.currentUser.role === "BOSS";
    }

    isGuest() {
        return this.currentUser.role === "GUEST";
    }

    isDeptAdmin() {
        return this.currentUser.role === "DEPT_ADMIN";
    }

    isStaff() {
        return this.currentUser.role === "STAFF";
    }

    // Staff Task Permission Helpers (REPORT_ONLY vs AUTONOMOUS)
    isStaffReportOnly() {
        return this.isStaff() && (this.currentUser.taskPermissionMode || "REPORT_ONLY") === "REPORT_ONLY";
    }

    isStaffAutonomous() {
        if (this.isAdmin() || this.isDeptAdmin() || this.isBoss()) return true;
        return this.isStaff() && this.currentUser.taskPermissionMode === "AUTONOMOUS";
    }

    canUseAiMina() {
        // Strictly reserved for Admin, Boss, Project Admin, and Dept Admin to save AI quota
        return this.isAdmin() || this.isBoss() || this.isDeptAdmin();
    }

    canCreateProject() {
        return this.isAdmin() || this.isDeptAdmin();
    }

    validateAdminPassword(enteredPass) {
        if (!enteredPass) return false;
        const clean = String(enteredPass).trim();
        const cur = this.getCurrentUser();
        if (cur && (cur.role === "ADMIN" || cur.role === "PROJECT_ADMIN" || cur.role === "BOSS")) {
            if (cur.pass && cur.pass === clean) return true;
        }
        return ACCOUNTS_DB.some(u => u.role === "ADMIN" && u.pass === clean);
    }

    isStaffPinUnlocked(projectId) {
        if (!projectId) return false;
        return sessionStorage.getItem("gantt_staff_pin_unlocked_" + projectId) === "true";
    }

    unlockStaffPin(projectId, enteredPin, actualPin) {
        if (!projectId || !enteredPin) return false;
        if (String(enteredPin).trim() === String(actualPin).trim()) {
            sessionStorage.setItem("gantt_staff_pin_unlocked_" + projectId, "true");
            return true;
        }
        return false;
    }

    maskTaskForUser(task, user) {
        if (!user) user = this.currentUser;
        return { ...task, isMasked: false };
    }

    // Fetch & apply tenant branding (Logo + Company Name + Directory Users + Departments)
    async syncTenantWorkspaceMeta() {
        try {
            const res = await fetch(getApiUrl("/api/workspace"), {
                headers: this.getAuthHeaders()
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data.tenant) {
                this.tenantInfo = data.tenant;
                this.applyBrandingToHeader(data.tenant);
            }
            if (Array.isArray(data.users)) {
                this.directoryUsers = data.users;
            }
            if (Array.isArray(data.departments)) {
                this.tenantDepartments = data.departments;
            }
            if (data.currentUser) {
                this.currentUser.taskPermissionMode = data.currentUser.taskPermissionMode || this.currentUser.taskPermissionMode || "REPORT_ONLY";
                this.currentUser.deptTags = data.currentUser.deptTags || this.currentUser.deptTags;
                this.currentUser.avatarUrl = data.currentUser.avatarUrl || this.currentUser.avatarUrl;
            }
            return data;
        } catch (e) {
            return null;
        }
    }

    applyBrandingToHeader(tenant) {
        if (!tenant) return;
        try {
            localStorage.setItem("tenant_branding", JSON.stringify(tenant));
        } catch(e) {}
        const logoEl = document.getElementById("workspace-brand-logo");
        const titleEl = document.getElementById("workspace-brand-title");
        const subEl = document.getElementById("workspace-brand-subtitle");
        const loginLogo = document.getElementById("login-screen-logo");
        const loginTitle = document.getElementById("login-screen-title");
        const loginTagline = document.getElementById("login-screen-tagline");

        if (logoEl && tenant.logoUrl) {
            logoEl.src = tenant.logoUrl;
        }
        if (titleEl && tenant.companyName) {
            titleEl.textContent = tenant.companyName;
        }
        if (subEl && tenant.slogan) {
            subEl.textContent = tenant.slogan;
        }
        if (loginLogo && tenant.logoUrl) {
            loginLogo.src = tenant.logoUrl;
        }
        if (loginTitle && tenant.companyName) {
            loginTitle.textContent = tenant.companyName;
        }
        if (loginTagline && tenant.slogan) {
            loginTagline.textContent = tenant.slogan;
        }
        if (tenant.companyName) {
            document.title = `${tenant.companyName} | LTP Progress Hub`;
        }
    }

    async loadPublicTenantBrand() {
        try {
            const res = await fetch(getApiUrl("/api/public/tenant-info?_t=" + Date.now()));
            if (res.ok) {
                const data = await res.json();
                if (data && data.status === "success") {
                    this.applyBrandingToHeader(data);
                }
            }
        } catch (e) {}
    }
}

window.authMgr = new AuthManager();

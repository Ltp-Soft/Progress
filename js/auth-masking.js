/**
 * Authentication & Multi-Tenant SaaS Data Scoping Module v8.0 — LTP Progress Hub
 * Supports Multi-Tenant JWT Sessions, QR Waiting Room Onboarding Sessions,
 * Granular Staff Task Permissions (REPORT_ONLY vs AUTONOMOUS),
 * Dynamic Company Branding (Logo + Name), and Role-Based Access Security.
 */

const ACCOUNTS_DB = [
    { id: "ADMIN", pass: "123456", role: "ADMIN", dept: "ALL", isBoss: false, canEditAll: true, taskPermissionMode: "AUTONOMOUS" },
    { id: "Admin", pass: "Tpl@1234", role: "ADMIN", dept: "ALL", isBoss: false, canEditAll: true, taskPermissionMode: "AUTONOMOUS" },
    { id: "BOSS", pass: "123456", role: "BOSS", dept: "ALL", isBoss: true, canEditAll: false, taskPermissionMode: "AUTONOMOUS" },
    { id: "boss", pass: "Tpl@1235", role: "BOSS", dept: "ALL", isBoss: true, canEditAll: false, taskPermissionMode: "AUTONOMOUS" },
    { id: "CONSTRUCTION_ADMIN", pass: "123456", role: "DEPT_ADMIN", dept: "CONSTRUCTION", prefix: "C", taskPermissionMode: "AUTONOMOUS" },
    { id: "MEP_ADMIN", pass: "123456", role: "DEPT_ADMIN", dept: "MEP", prefix: "E", taskPermissionMode: "AUTONOMOUS" },
    { id: "Designer", pass: "Tpl@1236", role: "DEPT_ADMIN", dept: "DESIGNER", prefix: "G", taskPermissionMode: "AUTONOMOUS" },
    { id: "Designer-staff", pass: "Tpl@1237", role: "STAFF", dept: "DESIGNER", prefix: "G", taskPermissionMode: "REPORT_ONLY" },
    { id: "Planing", pass: "Tpl@1238", role: "DEPT_ADMIN", dept: "PLANNING", prefix: "G", taskPermissionMode: "AUTONOMOUS" },
    { id: "Planing-staff", pass: "Tpl@1239", role: "STAFF", dept: "PLANNING", prefix: "G", taskPermissionMode: "REPORT_ONLY" },
    { id: "Construction", pass: "Tpl@1240", role: "DEPT_ADMIN", dept: "CONSTRUCTION", prefix: "C", taskPermissionMode: "AUTONOMOUS" },
    { id: "Construction-staff", pass: "Tpl@1241", role: "STAFF", dept: "CONSTRUCTION", prefix: "C", taskPermissionMode: "REPORT_ONLY" },
    { id: "Factory", pass: "Tpl@1242", role: "DEPT_ADMIN", dept: "FACTORY", prefix: "X", taskPermissionMode: "AUTONOMOUS" },
    { id: "Factory-staff", pass: "Tpl@1243", role: "STAFF", dept: "FACTORY", prefix: "X", taskPermissionMode: "REPORT_ONLY" },
    { id: "MEP", pass: "Tpl@1244", role: "DEPT_ADMIN", dept: "MEP", prefix: "E", taskPermissionMode: "AUTONOMOUS" },
    { id: "MEP-staff", pass: "Tpl@1245", role: "STAFF", dept: "MEP", prefix: "E", taskPermissionMode: "REPORT_ONLY" },
    { id: "Storage", pass: "Tpl@1246", role: "DEPT_ADMIN", dept: "STORAGE", prefix: "H", taskPermissionMode: "AUTONOMOUS" },
    { id: "Storage-staff", pass: "Tpl@1247", role: "STAFF", dept: "STORAGE", prefix: "H", taskPermissionMode: "REPORT_ONLY" },
    { id: "Purchasing", pass: "Tpl@1248", role: "DEPT_ADMIN", dept: "PURCHASING", prefix: "H", taskPermissionMode: "AUTONOMOUS" },
    { id: "Purchasing-staff", pass: "Tpl@1249", role: "STAFF", dept: "PURCHASING", prefix: "H", taskPermissionMode: "REPORT_ONLY" },
    { id: "Accountant", pass: "Tpl@1250", role: "DEPT_ADMIN", dept: "ACCOUNTANT", prefix: "A", taskPermissionMode: "AUTONOMOUS" },
    { id: "Accountant-staff", pass: "Tpl@1251", role: "STAFF", dept: "ACCOUNTANT", prefix: "A", taskPermissionMode: "REPORT_ONLY" },
    { id: "Guess", pass: "guest123", role: "GUEST", dept: "NONE", isGuest: true, taskPermissionMode: "REPORT_ONLY" }
];

// Determine Department from Code In Prefix
function getDeptFromCodeIn(codeIn) {
    if (!codeIn) return "CONSTRUCTION";
    const prefix = codeIn.trim().charAt(0).toUpperCase();
    switch (prefix) {
        case 'E': return "MEP";
        case 'G': return "DESIGNER";
        case 'X': return "FACTORY";
        case 'H': return "PURCHASING";
        case 'A': return "ACCOUNTANT";
        case 'C': return "CONSTRUCTION";
        default: return "CONSTRUCTION";
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

class AuthManager {
    constructor() {
        const guestUser = ACCOUNTS_DB.find(u => u.role === "GUEST") || ACCOUNTS_DB[ACCOUNTS_DB.length - 1];
        this.currentUser = guestUser;
        this.tenantInfo = null;
        this.directoryUsers = [];
        this.tenantDepartments = [];
        this.loadSession();
    }

    loadSession() {
        const guestUser = ACCOUNTS_DB.find(u => u.role === "GUEST") || ACCOUNTS_DB[ACCOUNTS_DB.length - 1];
        this.adminDeptContext = "CONSTRUCTION";

        // 1. Check Multi-Tenant V2 Session first (from landing.html / join.html / admin.html)
        const v2Raw = localStorage.getItem("CRYSTAL_ACTIVE_SESSION_V2");
        if (v2Raw) {
            try {
                const v2 = JSON.parse(v2Raw);
                if (v2 && (v2.username || v2.id)) {
                    const mappedRole = v2.role === "SUPER_ADMIN" ? "ADMIN" : (v2.role || "STAFF");
                    const primaryDept = (v2.department || v2.dept || "CONSTRUCTION").toUpperCase();
                    if (v2.token) {
                        localStorage.setItem("ltp_jwt_token", v2.token);
                        localStorage.setItem("gantt_auth_token", v2.token);
                    }
                    if (v2.tenant) {
                        this.tenantInfo = v2.tenant;
                    }
                    this.currentUser = {
                        id: v2.username || v2.id,
                        username: v2.username || v2.id,
                        name: v2.name || v2.fullName || v2.username || v2.id,
                        pass: "",
                        role: mappedRole,
                        dept: ["ADMIN", "BOSS", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : primaryDept,
                        deptTags: Array.isArray(v2.deptTags) ? v2.deptTags : [primaryDept],
                        taskPermissionMode: v2.taskPermissionMode || (["ADMIN", "BOSS", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                        avatarUrl: v2.avatarUrl || "",
                        prefix: primaryDept === "MEP" ? "E" : "C",
                        isBoss: mappedRole === "BOSS",
                        canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                        isGuest: mappedRole === "GUEST",
                        tenant: v2.tenant || null
                    };
                    return;
                }
            } catch (e) {}
        }

        // 2. Check JWT or Base64 token in ltp_jwt_token / gantt_auth_token
        const savedToken = localStorage.getItem("ltp_jwt_token") || localStorage.getItem("gantt_auth_token");
        if (savedToken) {
            const decoded = decodeTokenPayloadSafe(savedToken);
            if (decoded && (!decoded.exp || decoded.exp > Date.now())) {
                const userId = decoded.username || decoded.id || decoded.sub || "Guest";
                const mappedRole = decoded.role === "SUPER_ADMIN" ? "ADMIN" : (decoded.role || "STAFF");
                const found = ACCOUNTS_DB.find(u => u.id.toLowerCase() === String(userId).toLowerCase());
                const dept = decoded.department || decoded.dept || (found ? found.dept : "ALL");
                this.currentUser = {
                    id: userId,
                    username: userId,
                    name: decoded.fullName || decoded.name || userId,
                    pass: found ? found.pass : "",
                    role: mappedRole,
                    dept: ["ADMIN", "BOSS", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : dept,
                    deptTags: decoded.deptTags || [dept],
                    taskPermissionMode: decoded.taskPermissionMode || (["ADMIN", "BOSS", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                    avatarUrl: decoded.avatarUrl || "",
                    prefix: found ? found.prefix : (dept === "MEP" ? "E" : "C"),
                    isBoss: mappedRole === "BOSS",
                    canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                    isGuest: mappedRole === "GUEST"
                };
                return;
            }
        }

        const saved = localStorage.getItem("gantt_session_user");
        if (saved) {
            const found = ACCOUNTS_DB.find(u => u.id.toLowerCase() === saved.toLowerCase());
            if (found) {
                this.currentUser = found;
                return;
            }
        }

        this.currentUser = guestUser;
    }

    getAdminDeptContext() {
        return this.adminDeptContext || "CONSTRUCTION";
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

        if (!cleanUsername || !cleanPassword) {
            throw new Error("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!");
        }

        const localFound = ACCOUNTS_DB.find(u => u.id.toLowerCase() === cleanUsername.toLowerCase() && u.pass === cleanPassword);

        const apiUrl = getApiUrl(`/api/auth/login?_t=${Date.now()}`);
        try {
            const res = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: cleanUsername, password: cleanPassword, subdomain })
            });

            if (res.ok) {
                const data = await res.json();
                if (data && data.token && data.user) {
                    const u = data.user;
                    const mappedRole = u.role === "SUPER_ADMIN" ? "ADMIN" : u.role;
                    const userId = u.username || u.id || cleanUsername;
                    const primaryDept = u.department || u.dept || "ALL";

                    localStorage.setItem("ltp_jwt_token", data.token);
                    localStorage.setItem("gantt_auth_token", data.token);
                    localStorage.setItem("gantt_session_user", userId);

                    if (data.tenant) {
                        this.tenantInfo = data.tenant;
                    }

                    const found = ACCOUNTS_DB.find(acc => acc.id.toLowerCase() === String(userId).toLowerCase());
                    this.currentUser = {
                        id: userId,
                        username: userId,
                        name: u.fullName || u.name || userId,
                        pass: found ? found.pass : "",
                        role: mappedRole,
                        dept: ["ADMIN", "BOSS", "PROJECT_ADMIN"].includes(mappedRole) ? "ALL" : primaryDept,
                        deptTags: Array.isArray(u.deptTags) ? u.deptTags : [primaryDept],
                        taskPermissionMode: u.taskPermissionMode || (["ADMIN", "BOSS", "PROJECT_ADMIN", "DEPT_ADMIN"].includes(mappedRole) ? "AUTONOMOUS" : "REPORT_ONLY"),
                        avatarUrl: u.avatarUrl || "",
                        prefix: found ? found.prefix : (primaryDept === "MEP" ? "E" : "C"),
                        isBoss: mappedRole === "BOSS",
                        canEditAll: mappedRole === "ADMIN" || mappedRole === "PROJECT_ADMIN",
                        isGuest: mappedRole === "GUEST",
                        tenant: data.tenant || null
                    };

                    localStorage.setItem("CRYSTAL_ACTIVE_SESSION_V2", JSON.stringify({
                        id: this.currentUser.id,
                        username: this.currentUser.username,
                        name: this.currentUser.name,
                        role: this.currentUser.role,
                        department: primaryDept,
                        deptTags: this.currentUser.deptTags,
                        taskPermissionMode: this.currentUser.taskPermissionMode,
                        avatarUrl: this.currentUser.avatarUrl,
                        tenant: data.tenant || null,
                        token: data.token,
                        loginTime: new Date().toISOString()
                    }));

                    return this.currentUser;
                }
            } else {
                const errData = await res.json().catch(() => ({}));
                if (errData && errData.error && !localFound) {
                    throw new Error(errData.error);
                }
            }
        } catch (e) {
            if (!localFound && e.message && !e.message.includes("Failed to fetch")) {
                throw e;
            }
            console.warn("Server login API call error/offline:", e.message);
        }

        // Local fallback for offline / legacy credentials in ACCOUNTS_DB
        if (localFound) {
            this.currentUser = localFound;
            const tokenPayload = {
                id: localFound.id,
                username: localFound.id,
                role: localFound.role,
                dept: localFound.dept,
                taskPermissionMode: localFound.taskPermissionMode || "AUTONOMOUS",
                exp: Date.now() + 86400000
            };
            const token = btoa(JSON.stringify(tokenPayload));
            localStorage.setItem("gantt_auth_token", token);
            localStorage.setItem("ltp_jwt_token", token);
            localStorage.setItem("gantt_session_user", localFound.id);
            return localFound;
        }

        throw new Error("Tên đăng nhập hoặc mật khẩu không đúng!");
    }

    getAuthToken() {
        return localStorage.getItem("ltp_jwt_token") || localStorage.getItem("gantt_auth_token") || "";
    }

    getAuthHeaders() {
        const token = this.getAuthToken();
        const headers = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }
        return headers;
    }

    getFileAuthHeaders() {
        const token = this.getAuthToken();
        return token ? { "Authorization": "Bearer " + token } : {};
    }

    switchUser(username) {
        const found = ACCOUNTS_DB.find(u => u.id === username);
        if (found) {
            this.currentUser = found;
            const tokenPayload = { id: found.id, role: found.role, dept: found.dept, exp: Date.now() + 86400000 };
            const tok = btoa(JSON.stringify(tokenPayload));
            localStorage.setItem("gantt_auth_token", tok);
            localStorage.setItem("ltp_jwt_token", tok);
            localStorage.setItem("gantt_session_user", found.id);
            return found;
        }
        return null;
    }

    logout() {
        const guestUser = ACCOUNTS_DB.find(u => u.role === "GUEST") || ACCOUNTS_DB[ACCOUNTS_DB.length - 1];
        this.currentUser = guestUser;
        localStorage.removeItem("gantt_session_user");
        localStorage.removeItem("gantt_auth_token");
        localStorage.removeItem("ltp_jwt_token");
        localStorage.removeItem("CRYSTAL_ACTIVE_SESSION_V2");
        return guestUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    isAdmin() {
        return this.currentUser.role === "ADMIN" || this.currentUser.role === "PROJECT_ADMIN";
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
        const logoEl = document.getElementById("workspace-brand-logo");
        const titleEl = document.getElementById("workspace-brand-title");
        const subEl = document.getElementById("workspace-brand-subtitle");

        if (logoEl && tenant.logoUrl) {
            logoEl.src = tenant.logoUrl;
        }
        if (titleEl && tenant.companyName) {
            titleEl.textContent = tenant.companyName;
        }
        if (subEl && tenant.slogan) {
            subEl.textContent = tenant.slogan;
        }
        if (tenant.companyName) {
            document.title = `${tenant.companyName} | LTP Progress Hub`;
        }
    }
}

window.authMgr = new AuthManager();

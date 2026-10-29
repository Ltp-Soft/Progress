/**
 * Core Gantt Workspace Engine v7.2
 * Supports Cloudflare D1 SQL Row-Level Persistence, Today Progress Badges,
 * Attachment Badges, Clean UI Labels, Anti-Cheating Progress Rules,
 * and Responsive Mobile/Tablet Touch Interaction.
 */

function isJunkOrDemoProject(p) {
    if (!p || !p.id) return true;
    // Only filter exact legacy demo IDs. Never filter by timestamp prefix (PRJ_179...) — real new projects use it!
    return ['PRJ_01', 'PRJ_02', 'PRJ_DEMO', 'PRJ_INT_01'].includes(p.id) || String(p.id).startsWith('demo_');
}

let DEPARTMENTS = (() => {
    try {
        const cached = JSON.parse(localStorage.getItem("gantt_tenant_departments") || "null");
        if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (e) {}
    return [];
})();
window.DEPARTMENTS = DEPARTMENTS;

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_W = 50;

class GanttCore {
    constructor() {
        this.selectedTaskId = null;
        this.showGlobalLinks = false;
        this.draggingLink = false;
        this.dragSourceTaskId = null;
        this.tempLine = null;
        this.autoScrollInterval = null;
        this.lastMouseEvent = null;
        this.expandedDepts = {};
        this.directoryUsers = [];

        DEPARTMENTS.forEach(d => {
            this.expandedDepts[d.id] = d.defaultExpanded;
        });

        this.openSidebarDept = null;
        this.ganttViewMode = 'TAG';
        this.draggedTagIndex = null;

        this.lastServerVersion = 0;
        this.initDefaultWorkspace();
        this.loadFromCloudflareD1();
        this.initUrlHashListener();
        this.startRealtimePolling();
    }

    getStaffAvatar(staffName) {
        if (!staffName || staffName === "Chưa giao" || staffName === "Chưa phân công" || staffName === "Chưa Phân Công") {
            return `https://ui-avatars.com/api/?name=%3F&background=475569&color=fff&size=40&bold=true`;
        }
        const clean = String(staffName).trim();
        const found = (this.directoryUsers || []).find(u => 
            (u.fullName && u.fullName.toLowerCase() === clean.toLowerCase()) ||
            (u.username && u.username.toLowerCase() === clean.toLowerCase()) ||
            (u.id && u.id.toLowerCase() === clean.toLowerCase())
        );
        if (found && found.avatarUrl) {
            return found.avatarUrl;
        }
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(clean)}&background=0284c7&color=fff&size=40&bold=true`;
    }

    updateWorkspaceBranding(tenant) {
        if (!tenant) return;
        const logoImg = document.getElementById("workspace-brand-logo");
        const titleEl = document.getElementById("workspace-brand-title");
        const sloganEl = document.getElementById("workspace-brand-slogan");

        if (logoImg && tenant.logoUrl) {
            logoImg.src = tenant.logoUrl;
        }
        if (titleEl && tenant.companyName) {
            titleEl.textContent = tenant.companyName;
        }
        if (sloganEl && tenant.slogan) {
            sloganEl.textContent = tenant.slogan;
            sloganEl.style.display = "block";
        }
    }

    updateDepartmentSelectors() {
        const depts = window.DEPARTMENTS || DEPARTMENTS || [];
        if (!depts.length) return;

        // 1. Task form department select
        const taskDeptSelect = document.getElementById("task-dept");
        if (taskDeptSelect) {
            const curVal = taskDeptSelect.value;
            taskDeptSelect.innerHTML = depts.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
            if (curVal && depts.some(d => d.id === curVal)) {
                taskDeptSelect.value = curVal;
            }
        }

        // 2. New Project Owner Dept select
        const ownerDeptSelect = document.getElementById("new-proj-owner-dept");
        if (ownerDeptSelect) {
            const curVal = ownerDeptSelect.value;
            ownerDeptSelect.innerHTML = depts.map(d => `<option value="${d.id}">Phòng ${d.name}</option>`).join("");
            if (curVal && depts.some(d => d.id === curVal)) {
                ownerDeptSelect.value = curVal;
            }
        }

        // 3. Admin Header Dept switcher
        const adminDeptSelect = document.getElementById("admin-dept-select");
        if (adminDeptSelect) {
            const curVal = adminDeptSelect.value;
            adminDeptSelect.innerHTML = depts.map(d => `<option value="${d.id}">Phòng ${d.name}</option>`).join("");
            if (curVal && depts.some(d => d.id === curVal)) {
                adminDeptSelect.value = curVal;
            }
        }

        // 4. New Project Invited Departments Checkboxes
        const invitedContainer = document.getElementById("new-proj-invited-depts-container");
        if (invitedContainer) {
            const curOwner = ownerDeptSelect ? ownerDeptSelect.value : (depts[0]?.id || "CONSTRUCTION");
            invitedContainer.innerHTML = depts.map(d => {
                const isOwner = d.id === curOwner;
                return `<label style="font-size:12px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; background:#f1f5f9; border-radius:6px;">
                    <input type="checkbox" class="new-proj-bidding-chk" value="${d.id}" ${isOwner ? 'checked disabled' : 'checked'}>
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${d.color || '#2563eb'};"></span>
                    ${d.name}
                </label>`;
            }).join('');
        }
    }

    startRealtimePolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(() => this.checkServerVersion(), 10000);
        if (!this._focusSyncBound) {
            this._focusSyncBound = true;
            window.addEventListener("focus", () => this.checkServerVersion());
        }
    }

    getDefaultWorkspaceData() {
        const localD2D = JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
        let localShowMirrors = true;
        try {
            const storedShow = localStorage.getItem("gantt_show_mirror_tasks");
            if (storedShow !== null) localShowMirrors = JSON.parse(storedShow);
        } catch(e) {}
        return {
            currentProjectId: "",
            d2dLinks: localD2D,
            showMirrorTasks: localShowMirrors,
            projects: []
        };
    }

    ensureDefaultProjects(projectsList) {
        // Workspace starts clean without auto-injecting demo/sample projects
        return;
    }

    initDefaultWorkspace() {
        try {
            const raw = localStorage.getItem("gantt_live_workspace_v7");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.projects && Array.isArray(parsed.projects)) {
                    parsed.projects = parsed.projects.filter(p => !isJunkOrDemoProject(p));
                    if (parsed.projects.length === 0 || isJunkOrDemoProject({ id: parsed.currentProjectId })) {
                        parsed.currentProjectId = parsed.projects[0]?.id || "";
                    }
                    this.workspace = parsed;
                    return;
                }
            }
        } catch (e) {
            console.warn("Could not init workspace from LocalStorage:", e);
        }
        try {
            const rawArch = localStorage.getItem("gantt_archived_projects");
            if (rawArch) {
                const parsedArch = JSON.parse(rawArch);
                if (Array.isArray(parsedArch)) {
                    const cleanArch = parsedArch.filter(p => !isJunkOrDemoProject(p));
                    localStorage.setItem("gantt_archived_projects", JSON.stringify(cleanArch));
                }
            }
        } catch (e) {}
        this.workspace = this.getDefaultWorkspaceData();
    }


    async checkServerVersion() {
        if (!this.workspace) return;
        // Do not auto-sync if user is currently interacting with the chart or modal is open!
        if (this.isDragging || this.isResizing || this.isLinking) return;
        const activeEl = document.activeElement;
        if (activeEl && (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable)) return;
        const openModals = document.querySelectorAll(".modal[style*='display: flex'], .modal:not(.hidden):not([style*='display: none'])");
        if (openModals && openModals.length > 0) return;

        try {
            const baseUrl = window.WORKER_API_BASE || "";
            const headers = window.authMgr ? window.authMgr.getAuthHeaders() : {};
            const prjId = this.workspace.currentProjectId || "";
            const res = await fetch(`${baseUrl}/api/db/version?projectId=${encodeURIComponent(prjId)}&_t=${Date.now()}`, { headers });
            if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
                const data = await res.json();
                const srvVer = Number(data.version || 0);
                const srvMeta = String(data.metaSig || "");
                const verChanged = srvVer > 0 && this.lastServerVersion > 0 && srvVer > this.lastServerVersion;
                const metaChanged = srvMeta && this.lastMetaSig && srvMeta !== this.lastMetaSig;
                if (verChanged || metaChanged) {
                    this.lastServerVersion = srvVer;
                    this.lastMetaSig = srvMeta;
                    await this.loadFromCloudflareD1(true);
                } else {
                    if (!this.lastServerVersion) this.lastServerVersion = srvVer;
                    if (!this.lastMetaSig && srvMeta) this.lastMetaSig = srvMeta;
                }
            }
        } catch (e) {
            // Quiet catch for offline / dev server transitions
        }
    }

    // REALTIME LOCALSTORAGE & SERVER SQL SYNC
    saveToLocalStorage() {
        this._lastLocalSaveAt = Date.now();
        if (this.workspace && Array.isArray(this.workspace.d2dLinks)) {
            try {
                localStorage.setItem("gantt_d2d_links_v1", JSON.stringify(this.workspace.d2dLinks));
            } catch (e) {}
        }

        try {
            localStorage.setItem("gantt_live_workspace_v7", JSON.stringify(this.workspace));
        } catch (e) {
            console.warn("Could not save to LocalStorage:", e);
        }

        const baseUrl = window.WORKER_API_BASE || "";
        const headers = {
            "Content-Type": "application/json",
            ...(window.authMgr ? window.authMgr.getAuthHeaders() : {})
        };

        return fetch(`${baseUrl}/api/workspace?_t=${Date.now()}`, {
            method: "POST",
            headers,
            body: JSON.stringify(this.workspace)
        }).then(res => {
            this.lastServerVersion = Math.floor(Date.now() / 1000);
            return res;
        }).catch(err => console.warn("Server sync save error:", err));
    }

    async loadWorkspace(silent = false) {
        return this.loadFromCloudflareD1(silent);
    }

    async loadFromCloudflareD1(silent = false) {
        let localData = null;
        try {
            const raw = localStorage.getItem("gantt_live_workspace_v7");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.projects && Array.isArray(parsed.projects)) {
                    localData = parsed;
                }
            }
        } catch (e) {
            console.warn("Could not load from LocalStorage:", e);
        }

        if (!localData && this.workspace && this.workspace.projects && Array.isArray(this.workspace.projects)) {
            localData = this.workspace;
        }

        let loadedData = null;
        try {
            const baseUrl = window.WORKER_API_BASE || "";
            const headers = window.authMgr ? window.authMgr.getAuthHeaders() : {};
            const res = await fetch(`${baseUrl}/api/workspace?_t=${Date.now()}`, { headers });
            if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
                const data = await res.json();
                if (data && data.projects && Array.isArray(data.projects)) {
                    data.projects = data.projects.filter(p => !isJunkOrDemoProject(p));
                    if (data.projects.length === 0 || isJunkOrDemoProject({ id: data.currentProjectId })) {
                        data.currentProjectId = data.projects[0]?.id || "";
                    }
                    loadedData = data;
                    if (data.departments && Array.isArray(data.departments)) {
                        window.DEPARTMENTS = data.departments.map(d => ({
                            id: d.code || d.id,
                            code: d.code || d.id,
                            name: d.name || d.code || d.id,
                            class: `dept-${(d.code || d.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                            color: d.color || "#2563eb",
                            prefix: d.prefix || (d.name ? d.name.charAt(0).toUpperCase() : "C"),
                            defaultTaskMode: d.defaultTaskMode || "REPORT_ONLY",
                            defaultExpanded: true
                        }));
                        DEPARTMENTS = window.DEPARTMENTS;
                        DEPARTMENTS.forEach(d => {
                            if (this.expandedDepts[d.id] === undefined) {
                                this.expandedDepts[d.id] = true;
                            }
                        });
                        try {
                            localStorage.setItem("gantt_tenant_departments", JSON.stringify(window.DEPARTMENTS));
                        } catch (e) {}
                        this.updateDepartmentSelectors();
                    }
                    if (data.directoryUsers && Array.isArray(data.directoryUsers)) {
                        this.directoryUsers = data.directoryUsers;
                        window.directoryUsers = data.directoryUsers;
                    }
                    if (data.tenant) {
                        this.updateWorkspaceBranding(data.tenant);
                    }
                }
            }
        } catch (e) {
            console.log("Server workspace fetch fallback to LocalStorage.");
        }

        if (!loadedData) {
            loadedData = localData || this.getDefaultWorkspaceData();
        }

        // Always ensure default sample projects exist
        this.ensureDefaultProjects(loadedData.projects);

        // Preserve and sync D2D Links & Show Mirror Tasks setting across F5 / Server refresh
        const localD2D = JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
        if (loadedData.d2dLinks && Array.isArray(loadedData.d2dLinks) && loadedData.d2dLinks.length > 0) {
            localStorage.setItem("gantt_d2d_links_v1", JSON.stringify(loadedData.d2dLinks));
        } else if (localD2D && localD2D.length > 0) {
            loadedData.d2dLinks = localD2D;
        } else if (this.workspace && Array.isArray(this.workspace.d2dLinks) && this.workspace.d2dLinks.length > 0) {
            loadedData.d2dLinks = this.workspace.d2dLinks;
        } else {
            loadedData.d2dLinks = [];
        }

        let localShowMirrors = true;
        try {
            const storedShow = localStorage.getItem("gantt_show_mirror_tasks");
            if (storedShow !== null) localShowMirrors = JSON.parse(storedShow);
            else if (localData && localData.showMirrorTasks !== undefined) localShowMirrors = localData.showMirrorTasks;
        } catch(e) {}
        loadedData.showMirrorTasks = (this.workspace && this.workspace.showMirrorTasks !== undefined) ? this.workspace.showMirrorTasks : localShowMirrors;

        const currentId = (this.workspace && this.workspace.currentProjectId) ? this.workspace.currentProjectId : (localData?.currentProjectId || (loadedData.projects && loadedData.projects[0] ? loadedData.projects[0].id : ""));
        
        // Filter out legacy demo projects from loadedData
        loadedData.projects = (loadedData.projects || []).filter(p => p && !['PRJ_01', 'PRJ_02', 'PRJ_DEMO'].includes(p.id));

        // Merge local data into loadedData so newly created projects (if F5 happened mid-save), mirror tasks and custom project tags are NEVER lost on F5!
        let hasUnsyncedNewProject = false;
        if (localData && localData.projects && Array.isArray(localData.projects)) {
            localData.projects.forEach(localP => {
                if (!localP || isJunkOrDemoProject(localP)) return;
                const srvP = loadedData.projects.find(sp => sp.id === localP.id);
                if (!srvP) {
                    if (localP.createdAt && (Date.now() - Number(localP.createdAt) < 60000)) {
                        loadedData.projects.push(localP);
                        hasUnsyncedNewProject = true;
                    }
                    return;
                } else {
                    // 1. Merge tags
                    if (Array.isArray(localP.projectTags)) {
                        srvP.projectTags = srvP.projectTags || [];
                        localP.projectTags.forEach(ltg => {
                            const ltgName = (typeof ltg === 'object' && ltg !== null) ? ltg.name : String(ltg);
                            const existingIdx = srvP.projectTags.findIndex(stg => ((typeof stg === 'object' && stg !== null) ? stg.name : String(stg)).toLowerCase() === ltgName.toLowerCase());
                            if (existingIdx === -1) {
                                srvP.projectTags.push(ltg);
                            } else if (typeof ltg === 'object' && ltg !== null && ltg.sourceProjectId) {
                                const currentTagObj = typeof srvP.projectTags[existingIdx] === 'object' && srvP.projectTags[existingIdx] !== null ? srvP.projectTags[existingIdx] : { name: ltgName };
                                srvP.projectTags[existingIdx] = {
                                    ...currentTagObj,
                                    ...ltg
                                };
                            }
                        });
                    }

                    // 2. Merge mirror tasks
                    if (Array.isArray(localP.tasks)) {
                        srvP.tasks = srvP.tasks || [];
                        localP.tasks.forEach(lt => {
                            if (lt.isMirror) {
                                const srvTask = srvP.tasks.find(st => st.id === lt.id || (st.isMirror && st.sourceTaskId === lt.sourceTaskId));
                                if (!srvTask) {
                                    srvP.tasks.push(lt);
                                } else {
                                    srvTask.isMirror = true;
                                    srvTask.sourceTaskId = lt.sourceTaskId || srvTask.sourceTaskId;
                                    srvTask.sourceProjectId = lt.sourceProjectId || srvTask.sourceProjectId;
                                    srvTask.sourceDept = lt.sourceDept || srvTask.sourceDept;
                                }
                            }
                        });

                        // 3. Preserve user's dragged task ordering (mirror tasks and normal tasks)
                        const localOrderMap = new Map();
                        localP.tasks.forEach((lt, idx) => {
                            const ord = (lt.orderIndex !== undefined && lt.orderIndex !== null) ? lt.orderIndex : idx;
                            localOrderMap.set(lt.id, ord);
                        });

                        srvP.tasks.sort((a, b) => {
                            const ordA = localOrderMap.has(a.id) ? localOrderMap.get(a.id) : ((a.orderIndex !== undefined && a.orderIndex !== null) ? a.orderIndex : 9999);
                            const ordB = localOrderMap.has(b.id) ? localOrderMap.get(b.id) : ((b.orderIndex !== undefined && b.orderIndex !== null) ? b.orderIndex : 9999);
                            return ordA - ordB;
                        });

                        srvP.tasks.forEach((t, idx) => {
                            t.orderIndex = idx;
                        });
                    } else if (srvP.tasks && Array.isArray(srvP.tasks)) {
                        srvP.tasks.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
                    }
                }
            });
        }

        // Sanitize creatorDept & preserve projectTags and task.projectTag for all Department Jobs
        loadedData.projects.forEach(p => {
            if (!p.creatorDept || p.creatorDept === "ALL" || !DEPARTMENTS.some(d => d.id === p.creatorDept)) {
                p.creatorDept = "CONSTRUCTION";
            }

            const isShared = Boolean(p.isShared === true || p.isShared === 1 || p.isShared === "1" || p.isShared === "true" || p.category === "SHARED" || p.category === "UNDER_CONSTRUCTION" || (p.id && !p.id.startsWith("PRJ_INT_") && !p.id.startsWith("PRJ_RPT_") && !p.isDeptJob && !p.isDeptReport));
            const isReport = Boolean(p.isDeptReport === true || p.category === "REPORT" || p.category === "BIDDING" || (p.id && p.id.startsWith("PRJ_RPT_")));

            if (isShared && !isReport) {
                p.isShared = true;
                p.isDeptJob = false;
                p.isDeptReport = false;
                p.category = p.category || "UNDER_CONSTRUCTION";
            } else if (isReport) {
                p.isDeptReport = true;
                p.isShared = true;
                p.isDeptJob = false;
                p.category = p.category || "BIDDING";
            } else {
                p.isDeptJob = true;
                p.isShared = false;
                p.isDeptReport = false;
                p.category = "DEPT_JOB";

                // Normalize & sanitize projectTags cleanly (clean out [object Object])
                const tagMap = new Map();
                (p.projectTags || []).forEach(tg => {
                    const name = (typeof tg === 'object' && tg !== null) ? tg.name : String(tg);
                    if (!name || name === "[object Object]") return;
                    if (!tagMap.has(name)) {
                        tagMap.set(name, (typeof tg === 'object' && tg !== null) ? tg : { name });
                    }
                });
                if (tagMap.size === 0) tagMap.set("Hạng mục chung", { name: "Hạng mục chung" });
                p.projectTags = Array.from(tagMap.values());
                const firstTagName = p.projectTags[0].name || "Hạng mục chung";

                if (p.tasks && Array.isArray(p.tasks)) {
                    p.tasks.forEach(t => {
                        let tTag = t.projectTag;
                        if (!tTag || tTag === "[object Object]" || typeof tTag === 'object') {
                            tTag = (typeof tTag === 'object' && tTag?.name) ? tTag.name : firstTagName;
                            t.projectTag = tTag;
                        }
                        if (!tagMap.has(tTag)) {
                            tagMap.set(tTag, { name: tTag });
                            p.projectTags.push({ name: tTag });
                        }
                    });
                }
            }
        });

        this.workspace = loadedData;
        if (loadedData.projects.some(p => p.id === currentId && p.status !== "ARCHIVED")) {
            this.workspace.currentProjectId = currentId;
        } else {
            const firstActive = loadedData.projects.find(p => p.status !== "ARCHIVED") || loadedData.projects[0];
            this.workspace.currentProjectId = firstActive ? firstActive.id : "";
        }

        localStorage.setItem("gantt_live_workspace_v7", JSON.stringify(this.workspace));
        if (hasUnsyncedNewProject) {
            this.saveToLocalStorage();
        }
        if (document.getElementById("gantt-unified-container")) {
            this.renderProjectsSidebar();
            this.renderGantt();
        }
    }


    initUrlHashListener() {
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash;
            if (hash && hash.startsWith('#project=')) {
                const projId = hash.replace('#project=', '');
                if (projId && projId !== this.workspace.currentProjectId) {
                    this.switchProject(projId, false);
                }
            }
        });
    }

    getCurrentProject() {
        if (!this.workspace || !Array.isArray(this.workspace.projects)) {
            this.initDefaultWorkspace();
        }
        if (!this.workspace || !Array.isArray(this.workspace.projects) || this.workspace.projects.length === 0) {
            return null;
        }

        let proj = this.workspace.projects.find(p => p.id === this.workspace.currentProjectId && p.status !== "ARCHIVED");
        if (!proj) {
            proj = this.workspace.projects.find(p => p.status !== "ARCHIVED" && this.canUserSeeProject(p)) || this.workspace.projects[0];
            if (proj) {
                this.workspace.currentProjectId = proj.id;
            }
        }
        return proj;
    }

    isProjectOwner(project) {
        if (!project) return false;
        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") return true;
        const isMatch = (typeof window.areDeptsMatching === "function") 
            ? window.areDeptsMatching(user.dept, project.creatorDept) 
            : (String(user.dept || '').toUpperCase() === String(project.creatorDept || '').toUpperCase());
        return isMatch && user.role === "DEPT_ADMIN";
    }

    getProjectCategory(project) {
        if (!project) return "SHARED";
        if (project.isDeptReport || project.category === "REPORT" || (project.id && project.id.startsWith("PRJ_RPT_"))) {
            return "REPORT";
        }
        if (project.isShared || project.category === "SHARED" || (project.id && !project.id.startsWith("PRJ_INT_") && !project.id.startsWith("PRJ_RPT_") && !project.isDeptJob)) {
            return "SHARED";
        }
        if (project.isDeptJob || project.category === "DEPT_JOB" || (project.id && project.id.startsWith("PRJ_INT_"))) {
            return "DEPT_JOB";
        }
        return "SHARED";
    }

    updateToolbarVisibility(project, user) {
        if (!user) user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        const prj = project || this.getCurrentProject();

        const isAdmin = (user.role === "ADMIN" || user.role === "PROJECT_ADMIN");
        const isDeptAdmin = (user.role === "DEPT_ADMIN");
        const isStaff = (user.role === "STAFF");
        const isGuest = (user.role === "GUEST");
        const isBoss = (user.role === "BOSS");
        const isStaffAuto = isStaff && window.authMgr && window.authMgr.isStaffAutonomous();

        // Hide AI Mina completely for STAFF & GUEST to protect AI quota and keep Staff UI ultra-clean
        const minaFab = document.getElementById("minh-anh-fab");
        const minaChat = document.getElementById("minh-anh-chat-box");
        const canUseAi = window.authMgr ? window.authMgr.canUseAiMina() : (isAdmin || isBoss || isDeptAdmin);
        if (minaFab) minaFab.style.display = canUseAi ? "flex" : "none";
        if (!canUseAi && minaChat) minaChat.style.display = "none";

        // Show Company Admin Portal button STRICTLY for ADMIN / SUPER_ADMIN only
        const btnCompanyAdmin = document.getElementById("btn-open-company-admin");
        if (btnCompanyAdmin) {
            btnCompanyAdmin.style.display = (user.role === "ADMIN" || user.role === "SUPER_ADMIN") ? "inline-flex" : "none";
        }



        const adminToolsContainer = document.getElementById("admin-tools-container");
        const dropdownWrapper = document.querySelector(".settings-dropdown-wrapper");
        const btnToggleLinks = document.getElementById("btn-toggle-links");
        const btnViewMode = document.getElementById("btn-switch-gantt-view-mode");
        const btnAddTag = document.getElementById("btn-add-project-tag");
        const btnAddTask = document.getElementById("btn-add-task");
        const btnStaffUnlock = document.getElementById("btn-staff-unlock");
        const btnManageStaffs = document.getElementById("btn-manage-staffs");
        const menuManageStaffs = document.getElementById("menu-manage-staffs");
        const btnManageDept = document.getElementById("btn-manage-dept");
        const menuManageDept = document.getElementById("menu-manage-dept");
        const btnImport = document.getElementById("btn-import-excel");
        const menuImport = document.getElementById("menu-import-excel");
        const menuDownloadTemplate = document.getElementById("menu-download-excel-template");
        const btnCloseProj = document.getElementById("btn-close-project");
        const menuCloseProj = document.getElementById("menu-close-project");
        const menuStaffUnlock = document.getElementById("menu-staff-unlock");
        const menuExportRag = document.getElementById("menu-export-rag");

        // 1. BOSS ROLE SPECIAL MINIMALISM: HIDE ENTIRE ADMIN TOOLS CONTAINER ATOMICALLY!
        if (isBoss) {
            if (btnViewMode) btnViewMode.style.display = "inline-flex";
            if (btnToggleLinks) btnToggleLinks.style.display = "inline-flex";
            if (adminToolsContainer) adminToolsContainer.style.display = "none";
            return;
        }

        // SHOW ADMIN TOOLS CONTAINER FOR ALL OTHER ROLES
        if (adminToolsContainer) adminToolsContainer.style.display = "inline-flex";

        if (!prj) return;

        const cat = this.getProjectCategory(prj);
        const isDeptJob = (cat === "DEPT_JOB");
        const isPublicProject = (cat === "SHARED");
        const isPlanReport = (cat === "REPORT");
        const isOwner = this.isProjectOwner(prj);

        // Update Dropdown Header Info (ID & PIN) - VISIBLE ONLY FOR ADMIN, DEPT_ADMIN, OWNER
        const infoRow = document.getElementById("settings-proj-info");
        const labelEl = document.getElementById("settings-proj-id-pin-label");
        const canSeePinInfo = (isAdmin || isDeptAdmin || isOwner);
        if (infoRow) {
            infoRow.style.display = canSeePinInfo ? "block" : "none";
        }
        if (labelEl && canSeePinInfo) {
            const pinStr = prj.pin || prj.securityPin || "12345678";
            labelEl.innerHTML = `📌 ID: ${prj.id} | PIN: ${pinStr}`;
        }

        // 1. Switch View Mode: Department Jobs ONLY
        if (btnViewMode) {
            btnViewMode.style.display = isDeptJob ? "inline-flex" : "none";
        }

        // 2. Toggle Links
        if (btnToggleLinks) btnToggleLinks.style.display = "inline-flex";

        // 3. Add Project Tag Button: Removed per user request
        if (btnAddTag) {
            btnAddTag.style.display = "none";
        }

        // 4. Add Task Button: Admin, Dept Admin, or Staff in AUTONOMOUS mode (or unlocked PIN)
        if (btnAddTask) {
            const canAddTask = (isAdmin || isDeptAdmin || isStaffAuto || (isStaff && window.authMgr.isStaffPinUnlocked(prj.id)));
            btnAddTask.style.display = canAddTask ? "inline-flex" : "none";
        }

        // 5. Dropdown Menu Items Scoping (Minimalist for Staff):
        if (menuManageStaffs) {
            menuManageStaffs.style.display = (isDeptJob && (isAdmin || isDeptAdmin || isOwner)) ? "flex" : "none";
        }
        if (menuManageDept) {
            const canManageDept = (isPublicProject || isPlanReport) && (isAdmin || isDeptAdmin || isOwner);
            menuManageDept.style.display = canManageDept ? "flex" : "none";
        }
        if (menuImport) {
            const canImport = (isAdmin || isDeptAdmin);
            menuImport.style.display = canImport ? "flex" : "none";
        }
        if (menuDownloadTemplate) {
            const canImport = (isAdmin || isDeptAdmin);
            menuDownloadTemplate.style.display = canImport ? "flex" : "none";
        }
        if (menuExportRag) {
            menuExportRag.style.display = (isAdmin || isDeptAdmin) ? "flex" : "none";
        }
        if (menuCloseProj) {
            const canClose = (isAdmin || isOwner);
            menuCloseProj.style.display = canClose ? "flex" : "none";
        }
        if (menuStaffUnlock) {
            menuStaffUnlock.style.display = "none";
        }

        const settingsUserLabel = document.getElementById("settings-user-label");
        if (settingsUserLabel) {
            settingsUserLabel.innerText = `${user.id || 'User'} / ${user.dept || user.role || 'GUEST'}`;
        }
    }

    // OPEN VIEWING RULES FOR SHARED PROJECTS & GUEST READ-ONLY PREVIEW MODE
    canUserSeeProject(project) {
        if (!project) return false;
        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST", dept: "NONE" };
        if (user.role === "ADMIN" || user.role === "BOSS") return true;

        // Bidding Projects: ONLY invited departments (and creatorDept) can view/access!
        const isBidding = Boolean(project.isDeptReport || project.category === "REPORT" || project.category === "BIDDING" || (project.id && project.id.startsWith("PRJ_RPT_")));
        if (isBidding) {
            if (user.role === "GUEST") return false;
            if (project.creatorDept === user.dept) return true;
            if (project.invitedDepts && Array.isArray(project.invitedDepts) && project.invitedDepts.includes(user.dept)) return true;
            return false;
        }

        if (user.role === "GUEST") return true;

        const isShared = Boolean(project.isShared === true || project.isShared === 1 || project.isShared === "1" || project.isShared === "true" || project.category === "SHARED" || project.category === "UNDER_CONSTRUCTION");
        if (isShared) {
            return true;
        } else {
            // Internal project (Department Job)
            if (user.dept === project.creatorDept) return true;

            // D2D 1-WAY LINK CHECK: DEPT_ADMIN of target dept can view read-only! (Staff cannot)
            if (user.role === "DEPT_ADMIN") {
                const d2dLinks = (this.workspace && Array.isArray(this.workspace.d2dLinks) && this.workspace.d2dLinks.length > 0)
                    ? this.workspace.d2dLinks
                    : JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
                const hasD2DLink = d2dLinks.some(l => l.fromDept === project.creatorDept && l.toDept === user.dept);
                if (hasD2DLink) return true;
            }

            return false;
        }
    }

    // Check if the current user is viewing another department's project via D2D 1-way link
    isViewingViaD2D(project) {
        if (!project) return false;
        const user = window.authMgr ? window.authMgr.getCurrentUser() : null;
        if (!user || user.role !== "DEPT_ADMIN") return false;
        if (user.dept === project.creatorDept) return false;
        if (project.isShared || project.isDeptReport) return false;
        const d2dLinks = (this.workspace && Array.isArray(this.workspace.d2dLinks) && this.workspace.d2dLinks.length > 0)
            ? this.workspace.d2dLinks
            : JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
        return d2dLinks.some(l => l.fromDept === project.creatorDept && l.toDept === user.dept);
    }

    // Sync mirrored tasks in a project from their live sources (with auto-addition of new tasks and auto-pruning of deleted tasks)
    syncMirrorTasks(project) {
        if (!project || !project.tasks || !Array.isArray(project.tasks) || !this.workspace || !Array.isArray(this.workspace.projects)) return;
        
        let hasChanges = false;
        const mirrorTasks = project.tasks.filter(t => t.isMirror);

        // 1. Build map of all mirrored tag bindings: targetTagName (lowercase) -> { targetTagName, sourceProjectId, sourceTagName }
        const mirroredTagBindings = new Map();

        // A. From project.projectTags metadata
        (project.projectTags || []).forEach(tg => {
            if (typeof tg === 'object' && tg !== null && tg.sourceProjectId) {
                const targetName = tg.name || "";
                mirroredTagBindings.set(targetName.trim().toLowerCase(), {
                    targetTagName: targetName,
                    sourceProjectId: tg.sourceProjectId,
                    sourceTagName: tg.sourceTagName || targetName,
                    includeNested: tg.includeNested !== false
                });
            }
        });

        // B. From existing mirror tasks in project.tasks
        mirrorTasks.forEach(mt => {
            if (mt.sourceProjectId && mt.projectTag) {
                const key = String(mt.projectTag).trim().toLowerCase();
                if (!mirroredTagBindings.has(key)) {
                    // Try resolving the source tag name from source project
                    const srcP = this.workspace.projects.find(p => p.id === mt.sourceProjectId);
                    let srcTagName = mt.projectTag;
                    if (srcP && srcP.tasks) {
                        const st = srcP.tasks.find(x => x.id === mt.sourceTaskId);
                        if (st && st.projectTag) {
                            srcTagName = (typeof st.projectTag === 'object' && st.projectTag !== null) ? st.projectTag.name : st.projectTag;
                        }
                    }
                    mirroredTagBindings.set(key, {
                        targetTagName: mt.projectTag,
                        sourceProjectId: mt.sourceProjectId,
                        sourceTagName: srcTagName,
                        includeNested: true
                    });
                }
            }
        });

        // 2. Process each mirrored tag binding
        mirroredTagBindings.forEach(binding => {
            const { targetTagName, sourceProjectId, sourceTagName, includeNested } = binding;
            const srcProj = this.workspace.projects.find(p => p.id === sourceProjectId);
            if (!srcProj || !srcProj.tasks) return;

            // Find all candidate tasks in source project under sourceTagName
            const candidateSrcTasks = srcProj.tasks.filter(st => {
                const defTag = (srcProj.projectTags && srcProj.projectTags[0]) ? ((typeof srcProj.projectTags[0] === 'object' && srcProj.projectTags[0] !== null) ? srcProj.projectTags[0].name : srcProj.projectTags[0]) : "Hạng mục chung";
                const stTag = (typeof st.projectTag === 'object' && st.projectTag !== null) ? st.projectTag.name : (st.projectTag || defTag);
                return String(stTag).trim().toLowerCase() === String(sourceTagName).trim().toLowerCase();
            });

            const validRootTaskIds = new Set();

            // 2a. Add any newly added tasks in source project or update existing ones
            candidateSrcTasks.forEach(st => {
                const isNested = Boolean(st.isMirror);
                if (isNested && includeNested === false) return; // User opted out of nested mirror tasks

                const rootTaskId = isNested ? st.sourceTaskId : st.id;
                const rootProjId = isNested ? st.sourceProjectId : srcProj.id;
                const rootDept = isNested ? (st.sourceDept || "UNKNOWN") : (srcProj.creatorDept || "CONSTRUCTION");

                // Self-reflection cycle guard: Do not mirror tasks that originated from this department!
                if (rootDept === project.creatorDept) return;

                validRootTaskIds.add(rootTaskId);

                // Ưu tiên đọc dữ liệu trực tiếp từ task gốc nếu project gốc đã load
                const rootProj = this.workspace.projects.find(p => p.id === rootProjId);
                const rootTask = rootProj?.tasks?.find(x => x.id === rootTaskId);
                const liveTask = rootTask || st;

                let mt = project.tasks.find(t => t.isMirror && t.sourceTaskId === rootTaskId);
                const cleanName = (liveTask.name || "").replace(/^\[Ảnh\]\s*/i, '');
                
                if (!mt) {
                    // Source project added a new task! Automatically create reflection task!
                    const newMirror = {
                        id: "MIRROR_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
                        isMirror: true,
                        sourceTaskId: rootTaskId,
                        sourceProjectId: rootProjId,
                        sourceDept: rootDept,
                        name: cleanName,
                        codeIn: liveTask.codeIn || "M000",
                        codeOut: "",
                        start: liveTask.start,
                        end: liveTask.end,
                        progressPercent: liveTask.progressPercent || 0,
                        isStarted: Boolean(liveTask.isStarted),
                        isCompleted: Boolean(liveTask.isCompleted),
                        staff: liveTask.staff || "Chưa Phân Công",
                        projectTag: targetTagName,
                        orderIndex: project.tasks.length,
                        notes: liveTask.notes || ""
                    };
                    project.tasks.push(newMirror);
                    hasChanges = true;

                    // Atomic save mirror task to D1 tasks table
                    if (window.authMgr && window.WORKER_API_BASE) {
                        const baseUrl = window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev";
                        const headers = window.authMgr.getAuthHeaders();
                        fetch(`${baseUrl}/api/db/task`, {
                            method: "POST",
                            headers,
                            body: JSON.stringify({ ...newMirror, projectId: project.id })
                        }).catch(e => console.warn("D1 Mirror Task Save Error:", e));
                    }
                } else {
                    // Sync live fields
                    if (mt.name !== cleanName) { mt.name = cleanName; hasChanges = true; }
                    if (mt.start !== liveTask.start) { mt.start = liveTask.start; hasChanges = true; }
                    if (mt.end !== liveTask.end) { mt.end = liveTask.end; hasChanges = true; }
                    if (mt.progressPercent !== (liveTask.progressPercent || 0)) { mt.progressPercent = liveTask.progressPercent || 0; hasChanges = true; }
                    if (Boolean(mt.isStarted) !== Boolean(liveTask.isStarted)) { mt.isStarted = Boolean(liveTask.isStarted); hasChanges = true; }
                    if (Boolean(mt.isCompleted) !== Boolean(liveTask.isCompleted)) { mt.isCompleted = Boolean(liveTask.isCompleted); hasChanges = true; }
                    if (mt.staff !== (liveTask.staff || "Chưa Phân Công")) { mt.staff = liveTask.staff || "Chưa Phân Công"; hasChanges = true; }
                    if (mt.notes !== (liveTask.notes || "")) { mt.notes = liveTask.notes || ""; hasChanges = true; }
                    if (mt.sourceDept !== rootDept) { mt.sourceDept = rootDept; hasChanges = true; }
                }
            });

            // 2b. Prune mirror tasks whose source task was deleted by the source department
            const targetTagKey = targetTagName.trim().toLowerCase();
            const tagMirrors = project.tasks.filter(t => t.isMirror && String(t.projectTag || '').trim().toLowerCase() === targetTagKey);
            tagMirrors.forEach(mt => {
                if (!validRootTaskIds.has(mt.sourceTaskId)) {
                    // Source task was deleted! Remove mirror reflection
                    project.tasks = project.tasks.filter(t => t.id !== mt.id);
                    hasChanges = true;

                    // Delete mirror task from D1
                    if (window.authMgr && window.WORKER_API_BASE) {
                        const baseUrl = window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev";
                        const headers = window.authMgr.getAuthHeaders();
                        fetch(`${baseUrl}/api/db/task?id=${encodeURIComponent(mt.id)}&projectId=${encodeURIComponent(project.id)}`, {
                            method: "DELETE",
                            headers
                        }).catch(e => console.warn("D1 Mirror Task Delete Error:", e));
                    }
                }
            });
        });

        // 3. Fallback sync for any standalone mirror tasks not in the binding map
        project.tasks.forEach(mt => {
            if (mt.isMirror && mt.sourceTaskId && mt.sourceProjectId) {
                const srcProj = this.workspace.projects.find(p => p.id === mt.sourceProjectId);
                if (srcProj && srcProj.tasks) {
                    const st = srcProj.tasks.find(x => x.id === mt.sourceTaskId);
                    if (st) {
                        const cleanName = (st.name || "").replace(/^\[Ảnh\]\s*/i, '');
                        if (mt.name !== cleanName) { mt.name = cleanName; hasChanges = true; }
                        if (mt.start !== st.start) { mt.start = st.start; hasChanges = true; }
                        if (mt.end !== st.end) { mt.end = st.end; hasChanges = true; }
                        if (mt.progressPercent !== (st.progressPercent || 0)) { mt.progressPercent = st.progressPercent || 0; hasChanges = true; }
                        if (Boolean(mt.isStarted) !== Boolean(st.isStarted)) { mt.isStarted = Boolean(st.isStarted); hasChanges = true; }
                        if (Boolean(mt.isCompleted) !== Boolean(st.isCompleted)) { mt.isCompleted = Boolean(st.isCompleted); hasChanges = true; }
                        if (mt.staff !== (st.staff || "Chưa Phân Công")) { mt.staff = st.staff || "Chưa Phân Công"; hasChanges = true; }
                        if (mt.notes !== (st.notes || "")) { mt.notes = st.notes || ""; hasChanges = true; }
                    }
                }
            }
        });

        if (hasChanges) {
            try {
                localStorage.setItem("gantt_live_workspace_v7", JSON.stringify(this.workspace));
            } catch (e) {}
        }
    }

    // LINKING PERMISSION CHECK: Admin, ALL invited DEPT_ADMINs, and ALL invited STAFF (Autonomous or unlocked with PIN)
    canUserLinkTasks(project) {
        const user = window.authMgr.getCurrentUser();
        if (!user || user.role === "BOSS" || user.role === "GUEST") return false;
        if (user.role === "ADMIN" || user.role === "PROJECT_ADMIN") return true;

        const isInvited = (user.dept === project.creatorDept) || (project.invitedDepts && project.invitedDepts.includes(user.dept));
        if (!isInvited) return false;

        if (user.role === "DEPT_ADMIN") return true;
        if (user.role === "STAFF") return false;
        return false;
    }

    // CAN USER FULL-EDIT / ADD TASK IN THIS PROJECT & DEPT?
    // Trưởng phòng (DEPT_ADMIN) phân công và quản trị toàn bộ task phòng mình. Nhân viên chỉ nhận việc và báo cáo.
    canUserEditTaskInDept(deptId, project) {
        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        if (!user || user.role === "BOSS" || user.role === "GUEST" || user.role === "WAITING") return false;
        if (user.role === "ADMIN" || user.role === "SUPER_ADMIN" || user.role === "PROJECT_ADMIN") return true;
        if (!project) return false;

        const areMatch = typeof window.areDeptsMatching === "function" 
            ? window.areDeptsMatching 
            : (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();

        const isUserInDept = areMatch(deptId, user.dept) || 
            (Array.isArray(user.deptTags) && user.deptTags.some(t => areMatch(deptId, t)));
        const isProjectCreatorDept = areMatch(project.creatorDept, user.dept);

        const isDeptJob = Boolean(project.isDeptJob || project.category === "DEPT_JOB" || (project.id && project.id.startsWith("PRJ_INT_")));

        if (isDeptJob) {
            if (user.role === "DEPT_ADMIN") {
                return isProjectCreatorDept || isUserInDept;
            }
            if (user.role === "STAFF") {
                const isAuto = user.taskPermissionMode === "AUTONOMOUS" || (window.authMgr && window.authMgr.isStaffAutonomous && window.authMgr.isStaffAutonomous());
                return Boolean(isAuto && (isProjectCreatorDept || isUserInDept));
            }
            return false;
        }

        // Shared / Under Construction / Bidding:
        if (user.role === "DEPT_ADMIN") {
            return isUserInDept || isProjectCreatorDept;
        }

        // Staff in AUTONOMOUS mode can add & edit tasks in their assigned department
        if (user.role === "STAFF") {
            const isAuto = user.taskPermissionMode === "AUTONOMOUS" || (window.authMgr && window.authMgr.isStaffAutonomous && window.authMgr.isStaffAutonomous());
            return Boolean(isAuto && isUserInDept);
        }

        return false;
    }

    // CAN STAFF REPORT PROGRESS, UPLOAD FILES, AND WRITE NOTES ON THIS TASK?
    // Nhân viên nào thì xử lý và báo cáo công việc của chính họ
    canUserReportOnTask(task, project) {
        if (!task || !project) return false;
        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        if (!user || user.role === "BOSS" || user.role === "GUEST" || user.role === "WAITING") return false;
        if (user.role === "ADMIN" || user.role === "SUPER_ADMIN" || user.role === "PROJECT_ADMIN") return true;

        const areMatch = typeof window.areDeptsMatching === "function" 
            ? window.areDeptsMatching 
            : (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();

        const taskDept = task.dept || getDeptFromCodeIn(task.codeIn);
        if (user.role === "DEPT_ADMIN") {
            return this.canUserEditTaskInDept(taskDept, project);
        }

        if (user.role === "STAFF") {
            const userNames = [user.name, user.fullName, user.username, user.id, user.displayName]
                .filter(Boolean)
                .map(s => String(s).trim().toLowerCase());
            const staffLower = String(task.staff || "").trim().toLowerCase();
            const isMyDept = areMatch(taskDept, user.dept) || 
                (Array.isArray(user.deptTags) && user.deptTags.some(t => areMatch(taskDept, t)));

            // 1. Match assigned staff directly
            if (userNames.some(n => n && (staffLower.includes(n) || n.includes(staffLower)))) return true;
            // 2. Task created by this staff member
            if (task.createdBy && (task.createdBy === user.username || task.createdBy === user.id)) return true;
            if (task.createdByUserId && task.createdByUserId === user.id) return true;
            // 3. Or unassigned task within their department
            if ((!task.staff || task.staff === "Chưa giao" || task.staff === "Chưa gán" || task.staff === "Chưa Phân Công") && isMyDept) return true;
            // 4. Or general task within their department
            if (isMyDept) return true;
        }

        return false;
    }

    // ONLY ADMIN & DEPARTMENT HEAD (DEPT_ADMIN) OR OWNER STAFF CAN DELETE TASKS
    canUserDeleteTask(task, project) {
        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        if (!user || user.role === "BOSS" || user.role === "GUEST" || user.role === "WAITING") return false;
        if (user.role === "ADMIN" || user.role === "SUPER_ADMIN" || user.role === "PROJECT_ADMIN") return true;

        const taskDept = task.dept || getDeptFromCodeIn(task.codeIn);
        if (user.role === "DEPT_ADMIN") {
            return this.canUserEditTaskInDept(taskDept, project);
        }

        if (user.role === "STAFF") {
            const isAuto = user.taskPermissionMode === "AUTONOMOUS" || (window.authMgr && window.authMgr.isStaffAutonomous && window.authMgr.isStaffAutonomous());
            const isOwn = (task.createdBy && (task.createdBy === user.username || task.createdBy === user.id)) ||
                          (task.createdByUserId && task.createdByUserId === user.id);
            return Boolean(isAuto && isOwn);
        }

        return false;
    }

    renameCurrentProject(newName) {
        const prj = this.getCurrentProject();
        if (!prj) return;
        if (!this.isProjectOwner(prj) && !window.authMgr.isAdmin()) {
            alert("Chỉ Người tạo dự án hoặc Admin tối cao mới được đổi tên dự án!");
            return;
        }
        prj.name = newName.trim();
        this.saveToLocalStorage();
        this.renderProjectsSidebar();
        this.renderGantt();
    }

    toggleLinkVisibility() {
        this.showGlobalLinks = !this.showGlobalLinks;
        const btn = document.getElementById("btn-toggle-links");
        if (btn) {
            if (this.showGlobalLinks) {
                btn.classList.add("active");
                btn.innerHTML = `<i data-lucide="eye" size="16"></i>`;
                btn.title = "Ẩn các đường liên kết";
            } else {
                btn.classList.remove("active");
                btn.innerHTML = `<i data-lucide="eye-off" size="16"></i>`;
                btn.title = "Hiện tất cả liên kết";
            }
            if (window.lucide) lucide.createIcons();
        }
        this.renderGantt();
    }

    toggleDeptAccordion(deptId) {
        this.expandedDepts[deptId] = (this.expandedDepts[deptId] === undefined) ? false : !this.expandedDepts[deptId];
        this.renderGantt();
    }

    toggleSidebarDeptAccordion(deptId) {
        this.openSidebarDept = (this.openSidebarDept === deptId) ? null : deptId;
        this.renderProjectsSidebar();
    }

    duplicateProject(projectId) {
        const orig = this.workspace.projects.find(p => p.id === projectId);
        if (!orig) return;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : null;
        if (user && user.role === "GUEST") {
            alert("🔒 Tài khoản Khách không có quyền sao chép dự án!");
            return;
        }

        const newId = "PRJ_INT_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        const newProj = JSON.parse(JSON.stringify(orig));
        newProj.id = newId;
        newProj.name = `${orig.name} (Copy)`;
        
        if (newProj.tasks && Array.isArray(newProj.tasks)) {
            newProj.tasks.forEach((t, idx) => {
                t.id = "IT_COPY_" + Date.now() + "_" + idx;
            });
        }

        this.workspace.projects.push(newProj);
        this.openSidebarDept = newProj.creatorDept || "CONSTRUCTION";
        this.saveToLocalStorage();
        this.switchProject(newId);
        alert(`📋 Đã sao chép dự án thành công!\nDự án mới: "${newProj.name}"`);
    }

    toggleGanttViewMode() {
        this.ganttViewMode = (this.ganttViewMode === 'TAG') ? 'STAFF' : 'TAG';
        const btn = document.getElementById("btn-switch-gantt-view-mode");
        if (btn) {
            btn.innerHTML = (this.ganttViewMode === 'STAFF') ? `<i data-lucide="footprints" size="16"></i>` : `<i data-lucide="building-2" size="16"></i>`;
            btn.title = (this.ganttViewMode === 'STAFF') ? "Chuyển về xem theo Dự Án / Hạng Mục" : "Chuyển sang xem theo Nhân Viên";
            if (window.lucide) lucide.createIcons();
        }
        this.renderGantt();
    }

    setQuickFilter(mode = 'ALL') {
        this.staffQuickFilter = mode;
        const filterMap = {
            'ALL': 'qfilter-all',
            'MY_TASKS': 'qfilter-mine',
            'OVERDUE': 'qfilter-overdue'
        };
        Object.keys(filterMap).forEach(m => {
            const el = document.getElementById(filterMap[m]) || document.getElementById("qfilter-btn-" + m);
            if (el) {
                if (m === mode) {
                    el.classList.add("active");
                } else {
                    el.classList.remove("active");
                }
            }
        });
        this.renderGantt();
    }

    isUserAssignedToTask(t, user) {
        if (!t || !user || user.role === "GUEST") return false;
        const userTokens = [
            user.fullName,
            user.displayName,
            user.name,
            user.username,
            user.id
        ].filter(Boolean).map(s => String(s).trim().toLowerCase());

        const staffVal = String(t.staff || "").trim().toLowerCase();
        if (staffVal && staffVal !== "chưa phân công" && staffVal !== "chưa giao" && staffVal !== "-- chọn danh sách --") {
            const parts = staffVal.split(',').map(p => p.trim());
            for (const p of parts) {
                if (!p) continue;
                for (const uTok of userTokens) {
                    if (p === uTok || p.includes(uTok) || uTok.includes(p)) {
                        return true;
                    }
                }
            }
        }

        // Also match if user created this task
        if (t.createdBy && userTokens.includes(String(t.createdBy).trim().toLowerCase())) return true;
        if (t.createdByUserId && userTokens.includes(String(t.createdByUserId).trim().toLowerCase())) return true;

        return false;
    }

    getTaskContextLabel(t, prj) {
        if (!t) return "";
        let tag = t.projectTag;
        if (tag && tag !== "Hạng mục chung" && tag !== "[object Object]") {
            if (typeof tag === "object" && tag.name) return tag.name;
            if (typeof tag === "string" && tag.trim()) return tag.trim();
        }
        const rawDept = t.dept || (typeof getDeptFromCodeIn === "function" ? getDeptFromCodeIn(t.codeIn) : "");
        if (rawDept && window.DEPARTMENTS) {
            const found = window.DEPARTMENTS.find(d => 
                typeof window.areDeptsMatching === "function" 
                    ? window.areDeptsMatching(d.id || d.code || d.name, rawDept) 
                    : (d.id === rawDept || d.code === rawDept)
            );
            if (found && found.name) return found.name;
        }
        if (rawDept) return rawDept;
        return prj ? prj.name : "";
    }

    openManageStaffsModal() {
        const prj = this.getCurrentProject();
        if (!prj) return;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
        const isDeptAdmin = user.role === "DEPT_ADMIN";
        const canManage = isAdmin || isDeptAdmin || user.role === "PROJECT_ADMIN";
        if (!canManage) {
            alert("🔒 Chỉ Quản trị viên (Admin) hoặc Trưởng Phòng mới có quyền quản lý & phân công nhân sự!");
            return;
        }

        const listContainer = document.getElementById("manage-staffs-list-container");
        if (!listContainer) return;

        const dirUsers = window.directoryUsers || [];
        const findDirUser = (st) => {
            if (!st || st === "Chưa Phân Công") return null;
            const s = String(st).trim().toLowerCase();
            return dirUsers.find(u => {
                const uFull = String(u.fullName || "").trim().toLowerCase();
                const uName = String(u.username || "").trim().toLowerCase();
                const uId = String(u.id || "").trim().toLowerCase();
                return (uFull && uFull === s) || (uName && uName === s) || (uId && uId === s);
            }) || null;
        };

        if (!prj.staffs) prj.staffs = [];
        if (!prj.staffs.includes("Chưa Phân Công")) {
            prj.staffs.unshift("Chưa Phân Công");
        }

        let visibleStaffs = [];
        if (isAdmin) {
            visibleStaffs = [...prj.staffs];
        } else if (isDeptAdmin) {
            const myDept = user.dept;
            visibleStaffs = prj.staffs.filter(st => {
                if (st === "Chưa Phân Công") return true;
                const du = findDirUser(st);
                if (!du) return true;
                // Strict: Trưởng phòng không thấy Admin hoặc nhân sự phòng khác
                if (du.role === "ADMIN" || du.role === "SUPER_ADMIN") return false;
                return typeof window.areDeptsMatching === "function"
                    ? window.areDeptsMatching(du.department || du.dept, myDept)
                    : String(du.department || du.dept || '').toUpperCase() === String(myDept || '').toUpperCase();
            });

            // Ensure all members of this department from directory are present
            dirUsers.forEach(u => {
                if (u.role === "ADMIN" || u.role === "SUPER_ADMIN") return;
                const isMatch = typeof window.areDeptsMatching === "function"
                    ? window.areDeptsMatching(u.department || u.dept, myDept)
                    : String(u.department || u.dept || '').toUpperCase() === String(myDept || '').toUpperCase();
                if (isMatch) {
                    const uName = u.fullName || u.username;
                    if (uName && !visibleStaffs.some(s => s.trim().toLowerCase() === uName.trim().toLowerCase())) {
                        visibleStaffs.push(uName);
                        if (!prj.staffs.includes(uName)) prj.staffs.push(uName);
                    }
                }
            });
        }

        listContainer.innerHTML = visibleStaffs.map(st => {
            const isUnassigned = st === "Chưa Phân Công";
            const taskCount = prj.tasks ? prj.tasks.filter(t => (t.staff || "").trim().toLowerCase() === st.trim().toLowerCase()).length : 0;
            const du = findDirUser(st);

            let canDelete = false;
            if (!isUnassigned) {
                if (isAdmin) {
                    canDelete = !(du && (du.role === "ADMIN" || du.role === "SUPER_ADMIN"));
                } else if (isDeptAdmin) {
                    const isSelf = du && (du.id === user.id || du.username === user.username || du.fullName === user.fullName);
                    const isOtherDeptAdmin = du && du.role === "DEPT_ADMIN";
                    const isTargetAdmin = du && (du.role === "ADMIN" || du.role === "SUPER_ADMIN");
                    canDelete = !isSelf && !isOtherDeptAdmin && !isTargetAdmin;
                }
            }

            let roleBadge = "";
            if (du) {
                if (du.role === "ADMIN" || du.role === "SUPER_ADMIN") {
                    roleBadge = `<span style="font-size:9.5px; background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:4px; padding:1px 4px; font-weight:700;">Admin</span>`;
                } else if (du.role === "DEPT_ADMIN") {
                    roleBadge = `<span style="font-size:9.5px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:4px; padding:1px 4px; font-weight:700;">Trưởng Phòng</span>`;
                } else {
                    roleBadge = `<span style="font-size:9.5px; background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; border-radius:4px; padding:1px 4px;">Nhân Viên</span>`;
                }
            }

            return `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border-bottom:1px solid #e2e8f0; font-size:12px; background:${isUnassigned ? '#f1f5f9' : '#ffffff'};">
                    <span style="font-weight:${isUnassigned ? '700' : '500'}; color:${isUnassigned ? '#64748b' : '#1e293b'}; display:inline-flex; align-items:center; gap:6px;">
                        👤 ${st} ${roleBadge} <small style="color:#94a3b8;">(${taskCount} jobs)</small>
                    </span>
                    ${canDelete ? `
                        <button class="btn btn-danger" style="padding:2px 8px; font-size:10.5px; font-weight:700;" onclick="ganttCore.reassignAndDeleteStaff('${st.replace(/'/g, "\\'")}')" title="Chuyển toàn bộ task sang Chưa Phân Công và Xóa Nhân Viên">
                            [Move / Xóa NV]
                        </button>
                    ` : `<span style="font-size:10px; color:#94a3b8; font-style:italic;">${isUnassigned ? 'Mặc định' : (du?.role === 'DEPT_ADMIN' || du?.role === 'ADMIN' ? 'Không thể xóa' : '')}</span>`}
                </div>`;
        }).join('');

        openModal('manage-staffs-modal');
    }

    reassignAndDeleteStaff(staffName) {
        const prj = this.getCurrentProject();
        if (!prj || !prj.staffs) return;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST" };
        const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
        const isDeptAdmin = user.role === "DEPT_ADMIN";
        if (!isAdmin && !isDeptAdmin && user.role !== "PROJECT_ADMIN") {
            alert("🔒 Chỉ Quản trị viên (Admin) hoặc Trưởng Phòng mới có quyền xóa nhân sự khỏi dự án!");
            return;
        }

        const dirUsers = window.directoryUsers || [];
        const du = dirUsers.find(u => {
            const s = String(staffName).trim().toLowerCase();
            return (u.fullName && u.fullName.trim().toLowerCase() === s) ||
                   (u.username && u.username.trim().toLowerCase() === s) ||
                   (u.id && u.id.trim().toLowerCase() === s);
        });

        if (du) {
            if (du.role === "ADMIN" || du.role === "SUPER_ADMIN") {
                alert("⛔ Không thể xóa tài khoản Quản trị viên (Admin) khỏi dự án!");
                return;
            }
            if (isDeptAdmin) {
                if (du.role === "DEPT_ADMIN") {
                    alert("⛔ Trưởng phòng không thể xóa tài khoản Trưởng phòng khác hoặc chính mình!");
                    return;
                }
                const isMatch = typeof window.areDeptsMatching === "function"
                    ? window.areDeptsMatching(du.department || du.dept, user.dept)
                    : String(du.department || du.dept || '').toUpperCase() === String(user.dept || '').toUpperCase();
                if (!isMatch) {
                    alert("⛔ Bạn chỉ có quyền quản lý và xóa nhân viên thuộc phòng ban của mình!");
                    return;
                }
            }
        }

        if (!confirm(`Bạn có chắc muốn xóa nhân viên "${staffName}"? Tất cả công việc của nhân viên này sẽ được chuyển sang "Chưa Phân Công".`)) {
            return;
        }

        if (prj.tasks) {
            prj.tasks.forEach(t => {
                if ((t.staff || "").trim().toLowerCase() === staffName.trim().toLowerCase()) {
                    t.staff = "Chưa Phân Công";
                }
            });
        }

        prj.staffs = prj.staffs.filter(s => s.trim().toLowerCase() !== staffName.trim().toLowerCase());
        this.saveToLocalStorage();
        this.openManageStaffsModal();
        this.renderGantt();
    }

    onTaskDragStart(e, taskId, tagIndex) {
        e.dataTransfer.setData("text/plain", taskId);
        this.draggedTaskId = taskId;
        this.draggedTagIndex = tagIndex;
    }

    onTaskDragOver(e, tagIndex) {
        if (this.draggedTagIndex === tagIndex) {
            e.preventDefault();
        }
    }

    onTaskDrop(e, targetTaskId, tagIndex) {
        e.preventDefault();
        if (this.draggedTagIndex !== tagIndex) return;

        const prj = this.getCurrentProject();
        if (!prj || !prj.tasks) return;

        const srcIdx = prj.tasks.findIndex(t => t.id === this.draggedTaskId);
        const tgtIdx = prj.tasks.findIndex(t => t.id === targetTaskId);

        if (srcIdx !== -1 && tgtIdx !== -1 && srcIdx !== tgtIdx) {
            const [moved] = prj.tasks.splice(srcIdx, 1);
            prj.tasks.splice(tgtIdx, 0, moved);
            
            // Stamp orderIndex on all tasks in this project
            prj.tasks.forEach((t, idx) => {
                t.orderIndex = idx;
            });

            this.saveToLocalStorage();
            this.renderGantt();
        }
    }

    onTagHeaderDragStart(e, tagIndex) {
        e.dataTransfer.setData("text/plain", "tag_" + tagIndex);
        this.draggedTagHeaderIndex = tagIndex;
    }

    onTagHeaderDragOver(e, tagIndex) {
        if (this.draggedTagHeaderIndex !== null && this.draggedTagHeaderIndex !== undefined) {
            e.preventDefault();
        }
    }

    onTagHeaderDrop(e, targetTagIndex) {
        e.preventDefault();
        if (this.draggedTagHeaderIndex === null || this.draggedTagHeaderIndex === undefined) return;
        const srcIdx = this.draggedTagHeaderIndex;
        const tgtIdx = targetTagIndex;
        this.draggedTagHeaderIndex = null;

        const prj = this.getCurrentProject();
        if (!prj || !prj.projectTags || srcIdx === tgtIdx) return;

        const [movedTag] = prj.projectTags.splice(srcIdx, 1);
        prj.projectTags.splice(tgtIdx, 0, movedTag);
        this.saveToLocalStorage();
        this.renderGantt();
    }

    promptEditProjectTag(tagName) {
        const prj = this.getCurrentProject();
        if (!prj || !prj.projectTags) return;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : null;
        if (!user || (user.role !== "ADMIN" && user.role !== "DEPT_ADMIN" && !this.isProjectOwner(prj))) {
            alert("🔒 Chỉ Trưởng phòng (DEPT_ADMIN) hoặc Admin mới có quyền sửa Tag Dự Án!");
            return;
        }

        const tagItem = prj.projectTags.find(t => (typeof t === 'object' ? t.name : t) === tagName);
        const tagStart = (typeof tagItem === 'object' && tagItem.start) ? tagItem.start : (prj.startRange || new Date().toISOString().split('T')[0]);
        const tagEnd = (typeof tagItem === 'object' && tagItem.end) ? tagItem.end : (prj.endRange || new Date().toISOString().split('T')[0]);

        document.getElementById("tag-modal-title").innerText = "✏️ Chỉnh Sửa Tag Dự Án / Hạng Mục";
        document.getElementById("tag-modal-old-name").value = tagName;
        document.getElementById("tag-modal-name-input").value = tagName;
        document.getElementById("tag-modal-start-input").value = tagStart;
        document.getElementById("tag-modal-end-input").value = tagEnd;

        const btnModalDelete = document.getElementById("btn-modal-delete-tag");
        if (btnModalDelete) btnModalDelete.style.display = "inline-flex";

        openModal("project-tag-modal");
    }

    deleteProjectTag(tagName) {
        const prj = this.getCurrentProject();
        if (!prj || !prj.projectTags) return;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : null;
        const isOwner = (user && (user.role === "ADMIN" || this.isProjectOwner(prj) || (user.role === "DEPT_ADMIN" && user.dept === prj.creatorDept)));
        if (!isOwner) {
            alert("🔒 Chỉ Trưởng phòng hoặc Admin của bộ phận chủ quản mới có quyền xóa Tag Dự Án!");
            return;
        }

        const cleanTarget = String(tagName || '').trim();
        if (!cleanTarget) return;

        if (prj.projectTags.length <= 1) {
            alert("⚠️ Dự án cần giữ ít nhất 1 Tag Dự Án!");
            return;
        }

        const tasksInTag = (prj.tasks || []).filter(t => {
            const tTag = (typeof t.projectTag === 'object' && t.projectTag !== null) ? t.projectTag.name : (t.projectTag || '');
            return String(tTag).trim().toLowerCase() === cleanTarget.toLowerCase();
        });

        const mirrorTasks = tasksInTag.filter(t => t.isMirror);
        const normalTasks = tasksInTag.filter(t => !t.isMirror);

        if (tasksInTag.length > 0) {
            const confirmMsg = `Tag [${cleanTarget}] đang chứa ${tasksInTag.length} công việc (${mirrorTasks.length} task phản chiếu, ${normalTasks.length} task nội bộ). Bạn có chắc muốn XÓA Tag này cùng TOÀN BỘ các công việc trong đó không?`;
            if (!confirm(confirmMsg)) {
                return;
            }
        } else {
            if (!confirm(`Bạn có chắc chắn muốn xóa Tag Dự Án [${cleanTarget}] không?`)) {
                return;
            }
        }

        // 1. Remove from prj.projectTags
        prj.projectTags = prj.projectTags.filter(tg => {
            const tgName = (typeof tg === 'object' && tg !== null) ? tg.name : String(tg);
            return String(tgName).trim().toLowerCase() !== cleanTarget.toLowerCase();
        });

        // 2. Completely delete ALL tasks (both mirror tasks and department tasks) in that tag and delete from D1 SQL
        const baseUrl = window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev";
        const headers = window.authMgr ? window.authMgr.getAuthHeaders() : { "Content-Type": "application/json" };

        const allTaskIdsToDelete = tasksInTag.map(t => t.id);
        if (allTaskIdsToDelete.length > 0) {
            prj.tasks = prj.tasks.filter(t => !allTaskIdsToDelete.includes(t.id));
            allTaskIdsToDelete.forEach(id => {
                fetch(`${baseUrl}/api/db/task`, {
                    method: "DELETE",
                    headers,
                    body: JSON.stringify({ id, projectId: prj.id })
                }).catch(e => console.warn("D1 task delete warning:", e));
            });
        }

        // 3. Re-index orderIndex for remaining tasks
        prj.tasks.forEach((t, idx) => {
            t.orderIndex = idx;
        });

        if (typeof closeModal === 'function') {
            closeModal("project-tag-modal");
        }

        this.saveToLocalStorage();
        this.renderGantt();
    }

    getTaskStatusClass(task) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (task.isCompleted) return "status-completed";
        if (task.isStarted) return "status-working";
        if (task.end < todayStr) return "status-overdue";
        return "status-pending";
    }

    getStaffActiveTasksCount(staffName, project = null) {
        if (!staffName || staffName === "Chưa Phân Công" || staffName === "Chưa giao") return 0;
        const sName = String(staffName).trim().toLowerCase();
        const prjs = project ? [project] : ((this.workspace && Array.isArray(this.workspace.projects)) ? this.workspace.projects : []);
        let count = 0;
        prjs.forEach(p => {
            if (!p || p.status === "ARCHIVED" || !Array.isArray(p.tasks)) return;
            p.tasks.forEach(t => {
                // Chỉ tính task ĐANG LÀM: đã xong (isCompleted/progress=100) hoặc chưa làm (chưa bắt đầu/progress=0) thì KHÔNG TÍNH!
                if (t.isCompleted || Number(t.progress) >= 100) return;
                const isDoing = Boolean(t.isStarted) || (Number(t.progress) > 0 && Number(t.progress) < 100) || t.status === "WORKING";
                if (!isDoing) return;
                const assigned = String(t.staff || "").trim().toLowerCase();
                if (assigned && (assigned === sName || assigned.includes(sName) || sName.includes(assigned))) {
                    count++;
                }
            });
        });
        return count;
    }

    getUnfinishedPredecessors(task, allTasks) {
        if (!task.codeOut) return [];
        const requiredCodes = task.codeOut.split(',').map(s => s.trim()).filter(Boolean);
        return allTasks.filter(t => requiredCodes.includes(t.codeIn) && !t.isCompleted);
    }

    isDuplicateTask(taskName, codeIn, startDate, excludeTaskId = null) {
        const prj = this.getCurrentProject();
        if (!prj) return false;
        return prj.tasks.some(t => 
            t.id !== excludeTaskId &&
            t.name.trim().toLowerCase() === taskName.trim().toLowerCase() &&
            t.codeIn.trim().toUpperCase() === codeIn.trim().toUpperCase() &&
            t.start === startDate
        );
    }

    renderProjectsSidebar() {
        const sharedList = document.getElementById("shared-projects-list");
        const internalList = document.getElementById("internal-projects-list");
        const reportsList = document.getElementById("dept-reports-projects-list");
        if (!sharedList || !internalList) return;

        sharedList.innerHTML = "";
        internalList.innerHTML = "";
        if (reportsList) reportsList.innerHTML = "";

        let sharedCount = 0;
        let internalTotalCount = 0;
        let reportsCount = 0;

        const user = window.authMgr ? window.authMgr.getCurrentUser() : { role: "GUEST", dept: "CONSTRUCTION" };
        const isAdminOrBoss = (user.role === "ADMIN" || user.role === "BOSS");

        const depts = window.DEPARTMENTS || DEPARTMENTS;
        const currentProj = this.getCurrentProject();
        if (currentProj && !currentProj.isShared && !currentProj.isDeptReport && (!this.openSidebarDept || !depts.some(d => d.id === this.openSidebarDept))) {
            this.openSidebarDept = currentProj.creatorDept || (depts[0]?.id || "CONSTRUCTION");
        }

        const internalProjectsByDept = {};
        depts.forEach(d => { internalProjectsByDept[d.id] = []; });

        this.workspace.projects.forEach(p => {
            if (p.status === "ARCHIVED") return;
            if (!this.canUserSeeProject(p)) return;

            const isReport = Boolean(p.isDeptReport || p.category === "REPORT" || (p.id && p.id.startsWith("PRJ_RPT_")));
            const creatorDept = p.creatorDept || (depts[0]?.id || "CONSTRUCTION");
            const deptClass = `dept-tag-${creatorDept.toLowerCase()}`;
            const active = p.id === this.workspace.currentProjectId ? "active" : "";

            if (isReport) {
                const itemHtml = `
                    <div class="project-item ${active}" onclick="ganttCore.switchProject('${p.id}')">
                        <div style="overflow:hidden; text-overflow:ellipsis; flex:1;">
                            <span class="sidebar-proj-name">${p.name}</span>
                        </div>
                        <span class="dept-owner-pill ${deptClass}">${creatorDept.toLowerCase()}</span>
                    </div>`;
                if (reportsList) reportsList.innerHTML += itemHtml;
                reportsCount++;
            } else if (p.isShared) {
                const itemHtml = `
                    <div class="project-item ${active}" onclick="ganttCore.switchProject('${p.id}')">
                        <div style="overflow:hidden; text-overflow:ellipsis; flex:1;">
                            <span class="sidebar-proj-name">${p.name}</span>
                        </div>
                        <span class="dept-owner-pill ${deptClass}">${creatorDept.toLowerCase()}</span>
                    </div>`;
                sharedList.innerHTML += itemHtml;
                sharedCount++;
            } else {
                let deptKey = creatorDept;
                if (!internalProjectsByDept[deptKey]) {
                    internalProjectsByDept[deptKey] = [];
                }
                internalProjectsByDept[deptKey].push(p);
                internalTotalCount++;
            }
        });

        // Filter visible department folders based on User Account
        // For ADMIN & BOSS: Only show folders with 1+ projects (hide empty folders (0) for a cleaner UI)
        // For DEPT_ADMIN: Show own department folder AND any department folders linked via D2D (where fromDept is linked to user.dept)
        // For STAFF: Show their own department folder only
        const visibleDepts = depts.filter(d => {
            if (user.role === "GUEST") return false;
            const deptJobs = internalProjectsByDept[d.id] || [];
            if (user.role === "ADMIN" || user.role === "BOSS") {
                return deptJobs.length > 0;
            }
            if (user.role === "DEPT_ADMIN") {
                if (d.id === user.dept || (user.deptTags && user.deptTags.includes(d.id))) return true;
                // Check if there is a D2D link from this department to the user's department
                const d2dLinks = (this.workspace && Array.isArray(this.workspace.d2dLinks) && this.workspace.d2dLinks.length > 0)
                    ? this.workspace.d2dLinks
                    : JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
                const isLinkedFrom = d2dLinks.some(l => l.fromDept === d.id && l.toDept === user.dept);
                if (isLinkedFrom) return true;
                return false;
            }
            if (user.role === "STAFF") {
                return d.id === user.dept || (user.deptTags && user.deptTags.includes(d.id));
            }
            return deptJobs.length > 0;
        });

        const countD2d = document.getElementById("count-d2d-links");
        if (countD2d) {
            const d2dLinks = (this.workspace && Array.isArray(this.workspace.d2dLinks) && this.workspace.d2dLinks.length > 0)
                ? this.workspace.d2dLinks
                : JSON.parse(localStorage.getItem("gantt_d2d_links_v1") || "[]");
            countD2d.innerText = String(d2dLinks.length);
        }

        // Render Department Accordion Folders for Department Jobs
        if (visibleDepts.length === 0) {
            internalList.innerHTML = `<div style="padding:8px; color:#64748b; font-size:11px; text-align:center;">🔒 Ẩn với tài khoản Khách</div>`;
        } else {
            internalList.innerHTML = visibleDepts.map(d => {
                const deptJobs = internalProjectsByDept[d.id] || [];
                const isOpen = (this.openSidebarDept === d.id);
                const countStr = `(${deptJobs.length})`;

                const titleFormatted = d.name || (d.id.charAt(0).toUpperCase() + d.id.slice(1).toLowerCase());

                let sublistHtml = "";
                if (isOpen) {
                    if (deptJobs.length > 0) {
                        sublistHtml = deptJobs.map(p => {
                            const active = p.id === this.workspace.currentProjectId ? "active" : "";
                            const isD2D = this.isViewingViaD2D(p);
                            const d2dBadge = isD2D ? `<span style="background:rgba(56,189,248,0.2); color:#38bdf8; font-size:9px; font-weight:700; padding:1px 4px; border-radius:4px; margin-right:4px;">D2D</span>` : "";
                            return `
                                <div class="project-item ${active}" style="margin:2px 4px;" onclick="ganttCore.switchProject('${p.id}')">
                                    <div style="overflow:hidden; text-overflow:ellipsis; flex:1; display:flex; align-items:center;">
                                        ${d2dBadge}
                                        <span class="sidebar-proj-name" style="font-size:11.5px;">${p.name}</span>
                                    </div>
                                    <button class="btn-dup-proj" style="background:transparent; border:none; padding:1px 4px; color:#cbd5e1; font-size:13px; cursor:pointer;" onclick="event.stopPropagation(); ganttCore.duplicateProject('${p.id}')" title="Sao chép dự án">🗐</button>
                                </div>`;
                        }).join('');
                    } else {
                        sublistHtml = `<div style="padding:6px; color:#64748b; font-size:10.5px; text-align:center;">Chưa có job nội bộ</div>`;
                    }
                }

                return `
                    <div class="sidebar-dept-folder">
                        <div class="sidebar-dept-header ${isOpen ? 'open' : ''}" onclick="ganttCore.toggleSidebarDeptAccordion('${d.id}')">
                            <span style="display:flex; align-items:center; gap:5px;">
                                📁 ${titleFormatted} <small style="color:#94a3b8; font-weight:600;">${countStr}</small>
                            </span>
                            <span style="font-size:9px;">${isOpen ? '˅' : '❯'}</span>
                        </div>
                        ${isOpen ? `<div class="sidebar-dept-sublist">${sublistHtml}</div>` : ''}
                    </div>`;
            }).join('');
        }

        if (sharedCount === 0) {
            sharedList.innerHTML = `<div style="padding:8px; color:#64748b; font-size:11px; text-align:center;">Không có dự án chia sẻ</div>`;
        }
        if (reportsList && reportsCount === 0) {
            reportsList.innerHTML = `<div style="padding:8px; color:#64748b; font-size:11px; text-align:center;">Không có kế hoạch báo cáo</div>`;
        }

        const countSharedEl = document.getElementById("count-shared");
        const countInternalEl = document.getElementById("count-internal");
        const countReportsEl = document.getElementById("count-reports");
        const countClosedEl = document.getElementById("count-closed");
        if (countSharedEl) countSharedEl.innerText = `(${sharedCount})`;
        if (countInternalEl) countInternalEl.innerText = `(${internalTotalCount})`;
        if (countReportsEl) countReportsEl.innerText = `(${reportsCount})`;
        const closedCount = this.workspace.projects.filter(p => p.status === "ARCHIVED").length;
        if (countClosedEl) countClosedEl.innerText = `(${closedCount})`;

        // Hide Create Project and Project Closed buttons for BOSS role
        const btnCreateProj = document.getElementById("btn-create-proj");
        if (btnCreateProj) {
            btnCreateProj.style.display = (user && (user.role === "BOSS" || user.role === "GUEST")) ? "none" : "flex";
        }

        const linkProjectClosed = document.querySelector(".vault-link");
        if (linkProjectClosed) {
            linkProjectClosed.style.display = (user && user.role === "BOSS") ? "none" : "flex";
        }

        if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    }


    switchProject(id, updateHash = true) {
        const targetProj = this.workspace.projects.find(p => p.id === id);
        if (targetProj && !this.canUserSeeProject(targetProj)) {
            alert("🔒 Bạn không có quyền truy cập vào dự án này!");
            return;
        }

        this.workspace.currentProjectId = id;
        this.selectedTaskId = null;

        if (targetProj && targetProj.creatorDept) {
            this.openSidebarDept = targetProj.creatorDept;
        }

        if (updateHash && targetProj) {
            window.location.hash = "project=" + targetProj.id;
        }

        this.renderProjectsSidebar();
        this.renderGantt();
    }

    updateProjectInvitedDepartments(projectId, updatedInvitedDepts, uncheckedDepts = []) {
        const prj = this.workspace.projects.find(p => p.id === projectId);
        if (!prj) return;

        const prevActive = (prj.invitedDepts || []).filter(d => !String(d).startsWith("!"));
        const removedDepts = prevActive.filter(d => !updatedInvitedDepts.includes(d));
        const exclusionTokens = (uncheckedDepts || []).map(id => "!" + id);
        prj.invitedDepts = [...updatedInvitedDepts, ...exclusionTokens];

        removedDepts.forEach(deptId => {
            const removedTaskCodeIns = prj.tasks
                .filter(t => (t.dept || getDeptFromCodeIn(t.codeIn)) === deptId)
                .map(t => t.codeIn);

            prj.tasks.forEach(t => {
                if (t.codeOut) {
                    let codes = t.codeOut.split(',').map(s=>s.trim()).filter(c => !removedTaskCodeIns.includes(c));
                    t.codeOut = codes.join(', ');
                }
            });

            prj.tasks = prj.tasks.filter(t => (t.dept || getDeptFromCodeIn(t.codeIn)) !== deptId);
        });

        this.saveToLocalStorage();
        this.renderGantt();
        this.renderProjectsSidebar();
    }

    renderGantt() {
        if (!this.workspace || !Array.isArray(this.workspace.projects) || this.workspace.projects.length === 0) {
            const container = document.getElementById("gantt-unified-container");
            if (container) {
                container.innerHTML = `
                    <div style="padding: 80px 20px; text-align: center; color: #94a3b8; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;">
                        <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); display: flex; align-items: center; justify-content: center; color: #38bdf8;">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
                        </div>
                        <div style="font-size: 16px; font-weight: 700; color: #ffffff;">Chưa có dự án nào trong Không Gian Làm Việc</div>
                        <div style="font-size: 12.5px; color: #64748b; max-width: 420px; line-height: 1.5;">Vui lòng bấm nút <b>"+ Tạo Dự Án Mới"</b> ở thanh bên trái để bắt đầu lập kế hoạch và quản lý tiến độ!</div>
                        <button onclick="openNewProjectModal()" class="ltp-btn" style="margin-top: 6px; padding: 8px 18px; font-weight: 700; font-size: 13px; background: #0284c7; color: #ffffff; border: none; border-radius: 8px; cursor: pointer;">
                            + Tạo Dự Án Mới
                        </button>
                    </div>`;
            }
            return;
        }

        const prj = this.getCurrentProject();
        if (!prj || !this.canUserSeeProject(prj)) {
            const container = document.getElementById("gantt-unified-container");
            if (container) container.innerHTML = `<div style="padding:50px; text-align:center; color:#64748b;">🔒 Bạn không có quyền truy cập vào dự án này.</div>`;
            return;
        }

        const unifiedContainer = document.getElementById("gantt-unified-container");
        if (unifiedContainer && (!prj.tasks || prj.tasks.length === 0)) {
            unifiedContainer.innerHTML = `
                <div style="padding: 70px 20px; text-align: center; color: #94a3b8; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
                    <div style="width: 52px; height: 52px; border-radius: 14px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); display: flex; align-items: center; justify-content: center; color: #38bdf8;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                    </div>
                    <div style="font-size: 15px; font-weight: 700; color: #ffffff;">Dự án [${prj.name}] chưa có công việc nào</div>
                    <div style="font-size: 12px; color: #64748b; max-width: 380px; line-height: 1.5;">Hãy bấm nút <b>"+ Thêm Việc"</b> hoặc nhập file Excel để bắt đầu vẽ sơ đồ tiến độ!</div>
                    <button onclick="openNewTaskModal()" class="ltp-btn" style="padding: 7px 18px; font-weight: 700; font-size: 12.5px; background: #0284c7; color: #ffffff; border: none; border-radius: 8px; cursor: pointer;">
                        + Thêm Công Việc Đầu Tiên
                    </button>
                </div>`;
            return;
        }

        const user = window.authMgr.getCurrentUser();
        const cat = this.getProjectCategory(prj);
        const isDeptJob = (cat === "DEPT_JOB");

        // 0. LIVE SYNC MIRROR TASKS
        this.syncMirrorTasks(prj);

        const isViewingD2D = this.isViewingViaD2D(prj);

        // Top Bar Info Updates
        const nameEl = document.getElementById("current-project-name");
        const idEl = document.getElementById("current-project-id");
        const badgeEl = document.getElementById("current-project-badge");

        if (nameEl) {
            const isBidding = Boolean(prj.isDeptReport || prj.category === "REPORT" || prj.category === "BIDDING" || (prj.id && prj.id.startsWith("PRJ_RPT_")));
            const isOwnerOrAdmin = (this.isProjectOwner(prj) || user.role === "ADMIN");

            const renameBtn = (!isViewingD2D && isOwnerOrAdmin) ? 
                `<button class="btn btn-secondary" style="padding:1px 5px; font-size:10px; margin-left:6px; cursor:pointer;" onclick="promptRenameProject()" title="Đổi tên dự án">✏️</button>` : "";
            
            let biddingActionsHtml = "";
            if (isBidding && isOwnerOrAdmin && !isViewingD2D) {
                biddingActionsHtml = `
                    <button class="btn" style="background:#16a34a; color:#fff; border:none; padding:2px 8px; font-size:11px; font-weight:700; border-radius:4px; margin-left:8px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" onclick="ganttCore.openConvertToUnderConstructionModal('${prj.id}')" title="Trúng thầu: Chuyển sang Under Construction và mời thêm bộ phận thi công">
                        🚀 Chuyển Sang Thi Công
                    </button>
                    <button class="btn" style="background:#dc2626; color:#fff; border:none; padding:2px 8px; font-size:11px; font-weight:700; border-radius:4px; margin-left:4px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" onclick="ganttCore.dissolveBiddingProject('${prj.id}')" title="Trượt thầu / Hủy: Giải tán Bidding (Bảo lưu dữ liệu nội bộ)">
                        🛑 Giải Tán Bidding
                    </button>`;
            }

            const d2dNotice = isViewingD2D ? `<span style="background:#0284c7; color:#ffffff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; margin-left:8px;">🔗 D2D READ-ONLY (${prj.creatorDept})</span>` : "";
            nameEl.innerHTML = `${prj.name} ${renameBtn} ${biddingActionsHtml} ${d2dNotice}`;
        }
        
        if (badgeEl) {
            badgeEl.style.display = "none";
        }
        
        if (idEl) {
            const cleanManager = (prj.projectManager || 'Chưa gán').replace(/\s*\([^)]*\)/g, '').trim();
            idEl.innerHTML = `<span>Manager: ${cleanManager}</span>`;
        }

        const startInput = document.getElementById("proj-start-date");
        const endInput = document.getElementById("proj-end-date");
        if (startInput) startInput.value = prj.startRange;
        if (endInput) endInput.value = prj.endRange;

        // Staff PIN Unlock button state
        const btnStaffUnlock = document.getElementById("btn-staff-unlock");
        if (btnStaffUnlock) {
            if (user.role === "STAFF") {
                const unlocked = window.authMgr.isStaffPinUnlocked(prj.id);
                btnStaffUnlock.style.display = "inline-flex";
                btnStaffUnlock.innerText = unlocked ? "🔓 Đã Giải Khóa PIN" : "🔑 Nhập PIN Giải Khóa Edit";
                btnStaffUnlock.className = unlocked ? "btn btn-success" : "btn btn-warning";
            } else {
                btnStaffUnlock.style.display = "none";
            }
        }

        // Master Centralized Toolbar Buttons Scoping
        this.updateToolbarVisibility(prj, user);

        let start = new Date(prj.startRange || "2026-09-01");
        let end = new Date(prj.endRange || "2026-09-30");
        if (isNaN(start.getTime())) start = new Date("2026-09-01");
        if (isNaN(end.getTime())) end = new Date("2026-09-30");
        if (end < start) end = new Date(start.getTime() + 30 * 86400000);
        const totalDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);

        const daysContainer = document.getElementById("days-header-container");
        const weekendIndices = [];

        if (daysContainer) {
            daysContainer.style.width = (totalDays * DAY_W) + 'px';
            daysContainer.innerHTML = "";
            for (let i = 0; i < totalDays; i++) {
                let d = new Date(start); d.setDate(d.getDate() + i);
                const dayIdx = d.getDay();
                const isWeekend = (dayIdx === 0 || dayIdx === 6);
                if (isWeekend) weekendIndices.push(i);

                const dayName = DAY_NAMES[dayIdx];
                const weekendClass = isWeekend ? "is-weekend" : "";

                daysContainer.innerHTML += `
                    <div class="day-cell ${weekendClass}" style="width:${DAY_W}px;">
                        <span class="day-name">${dayName}</span>
                        <span>${d.getDate()}/${d.getMonth()+1}</span>
                    </div>`;
            }
        }

        const container = document.getElementById("gantt-unified-container");
        if (!container) return;
        container.innerHTML = "";

        const staffHeadCol = document.getElementById("gantt-col-staff-name");
        if (staffHeadCol) {
            staffHeadCol.innerText = (isDeptJob && this.ganttViewMode === 'STAFF') ? "Hạng Mục / Job" : "Tên";
        }

        let groups = [];
        const qFilter = this.staffQuickFilter || "ALL";

        if (qFilter === "MY_TASKS" && user && user.role !== "GUEST") {
            const myName = user.fullName || user.displayName || user.name || user.username || "Tôi";
            groups = [{
                id: "MY_TASKS_GROUP",
                name: `👤 VIỆC CỦA TÔI: ${myName} — DỰ ÁN: ${prj.name}`,
                class: "dept-tag-style-0",
                isMyTasksGroup: true
            }];
            if (staffHeadCol) {
                staffHeadCol.innerText = "Bộ Phận / Hạng Mục";
            }
        } else if (isDeptJob) {
            if (this.ganttViewMode === 'STAFF') {
                if (!prj.staffs) prj.staffs = [];
                if (!prj.staffs.includes("Chưa Phân Công")) prj.staffs.unshift("Chưa Phân Công");
                if (prj.tasks && Array.isArray(prj.tasks)) {
                    prj.tasks.forEach(t => {
                        const sName = (t.staff && t.staff.trim()) ? t.staff.trim() : "Chưa Phân Công";
                        if (!prj.staffs.some(st => st.trim().toLowerCase() === sName.toLowerCase())) {
                            prj.staffs.push(sName);
                        }
                    });
                }
                groups = prj.staffs.map((st, idx) => {
                    const activeCount = this.getStaffActiveTasksCount(st, prj);
                    const countBadge = (st && st !== "Chưa Phân Công" && activeCount > 0) ? ` (⚡ ${activeCount} việc đang làm)` : "";
                    return {
                        id: st,
                        name: `👤 ${st}${countBadge}`,
                        class: "dept-tag-style-" + (idx % 8),
                        isStaffGroup: true
                    };
                });
            } else {
                // TAG View Mode: Clean and deduplicate tags
                const tagMap = new Map();
                (prj.projectTags || []).forEach(tg => {
                    const name = (typeof tg === 'object' && tg !== null) ? tg.name : String(tg);
                    if (!name || name === "[object Object]") return;
                    if (!tagMap.has(name)) {
                        tagMap.set(name, (typeof tg === 'object' && tg !== null) ? tg : { name });
                    }
                });
                if (tagMap.size === 0) tagMap.set("Hạng mục chung", { name: "Hạng mục chung" });

                if (prj.tasks && Array.isArray(prj.tasks)) {
                    prj.tasks.forEach(t => {
                        let tTag = t.projectTag;
                        if (!tTag || tTag === "[object Object]" || typeof tTag === 'object') {
                            tTag = (typeof tTag === 'object' && tTag?.name) ? tTag.name : tagMap.keys().next().value;
                            t.projectTag = tTag;
                        }
                        if (!tagMap.has(tTag)) {
                            tagMap.set(tTag, { name: tTag });
                        }
                    });
                }
                prj.projectTags = Array.from(tagMap.values());

                groups = prj.projectTags.map((tgItem, idx) => {
                    const tagName = typeof tgItem === 'object' ? tgItem.name : String(tgItem);
                    const tagStart = (typeof tgItem === 'object' && tgItem.start) ? tgItem.start : "";
                    const tagEnd = (typeof tgItem === 'object' && tgItem.end) ? tgItem.end : "";
                    return {
                        id: tagName,
                        name: tagName,
                        start: tagStart,
                        end: tagEnd,
                        rawTag: tgItem,
                        class: "dept-tag-style-" + (idx % 8),
                        isTag: true
                    };
                });
            }
        } else {
            const allDepts = (window.DEPARTMENTS && window.DEPARTMENTS.length > 0) ? window.DEPARTMENTS : (DEPARTMENTS || []);
            const inv = Array.isArray(prj.invitedDepts) ? prj.invitedDepts : [];
            const excludedSet = new Set(inv.filter(x => String(x).startsWith("!")).map(x => String(x).slice(1)));
            let activeDepts;
            if (prj.isDeptReport && inv.length > 0) {
                const matched = allDepts.filter(d =>
                    !excludedSet.has(d.id) && !excludedSet.has(d.code) &&
                    (inv.includes(d.id) || inv.includes(d.code) || inv.includes(d.name))
                );
                activeDepts = matched.length > 0 ? matched : allDepts.filter(d => !excludedSet.has(d.id) && !excludedSet.has(d.code));
            } else {
                // Under Construction / Shared projects automatically include all Admin departments unless explicitly unchecked (!id)
                activeDepts = allDepts.filter(d => !excludedSet.has(d.id) && !excludedSet.has(d.code) && !excludedSet.has(d.name));
            }
            groups = activeDepts.map(d => ({
                id: d.id || d.code,
                name: d.name || d.code || d.id,
                class: d.class || `dept-${(d.code || d.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                color: d.color || "#2563eb",
                isTag: false
            }));
        }

        const todayObj = new Date();
        const todayStr = todayObj.toISOString().split('T')[0];
        const daysFromStartToday = (todayObj - start) / (1000 * 60 * 60 * 24);

        const taskColWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--task-col-w')) || 350;
        const totalTimelineW = totalDays * DAY_W;
        const totalRowW = taskColWidth + totalTimelineW;

        groups.forEach((group, gIdx) => {
            const isExpanded = this.expandedDepts[group.id] !== false;

            const deptTasks = prj.tasks.filter(t => {
                const masked = window.authMgr.maskTaskForUser(t, user);
                if (!masked) return false;

                // 1. Yêu cầu người dùng: Tài khoản Boss không thấy các task ảnh phản chiếu để tránh rối mắt
                if (user && user.role === "BOSS" && t.isMirror) return false;

                // 2. Yêu cầu người dùng: Tùy chọn của Admin trong modal D2D để bật/tắt hiển thị task ảnh trên Gantt
                const showMirrors = (this.workspace && this.workspace.showMirrorTasks !== false);
                if (t.isMirror && !showMirrors) return false;

                // Mode "Việc của tôi" (My Tasks quick filter)
                if (group.isMyTasksGroup) {
                    return this.isUserAssignedToTask(t, user);
                }

                // 3. Quick Filter (ALL | OVERDUE)
                if (qFilter === "OVERDUE") {
                    if (t.isCompleted || !t.end || t.end >= todayStr) return false;
                }

                if (isDeptJob) {
                    if (this.ganttViewMode === 'STAFF') {
                        // User requirement: Do NOT include mirror tasks in staff view workload of this department
                        if (t.isMirror) return false;
                        const st = (t.staff || "Chưa Phân Công").trim().toLowerCase();
                        return st === group.id.trim().toLowerCase();
                    } else {
                        let tag = t.projectTag;
                        if (!tag || tag === "[object Object]" || typeof tag === 'object') {
                            tag = (typeof tag === 'object' && tag?.name) ? tag.name : group.id;
                        }
                        return String(tag).trim().toLowerCase() === String(group.id).trim().toLowerCase();
                    }
                } else {
                    const tDept = String(t.dept || getDeptFromCodeIn(t.codeIn) || "").toUpperCase();
                    const gId = String(group.id || "").toUpperCase();
                    const gName = String(group.name || "").toUpperCase();
                    return tDept === gId || tDept === gName;
                }
            });

            // Sort deptTasks explicitly by orderIndex (preserving user drag-and-drop order for mirror tasks and local tasks alike)
            deptTasks.sort((a, b) => {
                const ordA = (a.orderIndex !== undefined && a.orderIndex !== null) ? a.orderIndex : prj.tasks.indexOf(a);
                const ordB = (b.orderIndex !== undefined && b.orderIndex !== null) ? b.orderIndex : prj.tasks.indexOf(b);
                return ordA - ordB;
            });

            let deptGridCellsHtml = "";
            for (let i = 0; i < totalDays; i++) {
                const isWeekend = weekendIndices.includes(i);
                const weekendClass = isWeekend ? "is-weekend" : "";
                deptGridCellsHtml += `<div class="day-cell ${weekendClass}" style="width:${DAY_W}px;"></div>`;
            }

            const toggleChar = isExpanded ? "˅" : "❯";

            // 2-WAY SYNC BUTTONS & DEPT ACTIONS (Shared / Bidding / Under Construction)
            let syncBtnHtml = "";
            let deleteDeptTasksBtnHtml = "";
            if (!isDeptJob && !isViewingD2D) {
                const isMyDept = (user.dept === group.id);
                const canSync = (user.role === "ADMIN" || (user.role === "DEPT_ADMIN" && isMyDept));
                if (canSync) {
                    const syncLink = this.getQuantumSyncLinkForShared(prj.id, group.id);
                    if (syncLink) {
                        syncBtnHtml = `<button type="button" class="btn-sync-icon" style="background:transparent; border:none; padding:2px; cursor:pointer; color:#10b981; margin-left:6px; display:inline-flex; align-items:center; justify-content:center; line-height:1;" onclick="event.stopPropagation(); ganttCore.openQuantumSyncModal('${group.id}', '${prj.id}')" title="Đang đồng bộ 2 chiều với nội bộ: ${syncLink.internalTagName} (Nhấn để quản lý)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></button>`;
                    } else {
                        syncBtnHtml = `<button type="button" class="btn-sync-icon" style="background:transparent; border:none; padding:2px; cursor:pointer; color:#94a3b8; margin-left:6px; display:inline-flex; align-items:center; justify-content:center; line-height:1;" onclick="event.stopPropagation(); ganttCore.openQuantumSyncModal('${group.id}', '${prj.id}')" title="Đồng bộ 2 chiều với công việc nội bộ"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></button>`;
                    }

                    if (deptTasks.length > 0) {
                        deleteDeptTasksBtnHtml = `<button class="btn-delete-tag-compact" style="width:16px; height:16px; min-width:16px; border-radius:50%; background:#ef4444; color:#ffffff; border:none; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; cursor:pointer; margin-left:auto; line-height:1;" onclick="event.stopPropagation(); ganttCore.promptDeleteDeptTasks('${group.id}', '${prj.id}')" title="Xóa toàn bộ task của bộ phận ${group.name} trong dự án này">×</button>`;
                    }
                }
            }

            if (group.isMyTasksGroup) {
                syncBtnHtml = "";
                deleteDeptTasksBtnHtml = "";
            }

            const canManageTag = !group.isMyTasksGroup && !isViewingD2D && isDeptJob && this.ganttViewMode === 'TAG' && (user.role === "ADMIN" || user.role === "DEPT_ADMIN" || this.isProjectOwner(prj));

            // Check if viewer can mirror copy this tag (via D2D or Admin)
            const canMirrorTag = isDeptJob && this.ganttViewMode === 'TAG' && (user.role === "ADMIN" || isViewingD2D);
            const mirrorTagBtnHtml = canMirrorTag ?
                `<button class="btn-mirror-tag" style="background:#0284c7; color:#ffffff; border:none; padding:2px 6px; font-size:10px; font-weight:700; border-radius:4px; cursor:pointer; margin-left:4px; display:inline-flex; align-items:center; gap:2px;" onclick="event.stopPropagation(); openD2DMirrorModal('${group.id}', '${prj.id}')" title="Sao chép phản chiếu (Mirror) Tag này về dự án nội bộ của phòng bạn">🪞 Copy D2D</button>` : "";
            
            const editTagBtnHtml = canManageTag ?
                `<button class="btn-edit-tag" style="background:transparent; border:none; padding:1px 3px; color:#64748b; font-size:11px; cursor:pointer;" onclick="event.stopPropagation(); ganttCore.promptEditProjectTag('${group.id}')" title="Sửa Tên & Ngày Tag">✏️</button>` : "";

            const deleteTagBtnHtml = canManageTag ?
                `<button class="btn-delete-tag-compact" style="width:16px; height:16px; min-width:16px; border-radius:50%; background:#ef4444; color:#ffffff; border:none; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; cursor:pointer; margin-left:auto; line-height:1;" onclick="event.stopPropagation(); ganttCore.deleteProjectTag('${group.id}')" title="Xóa Tag Dự Án này">×</button>` : "";

            const tagHeaderDragAttr = canManageTag ? `draggable="true" ondragstart="ganttCore.onTagHeaderDragStart(event, ${gIdx})" ondragover="ganttCore.onTagHeaderDragOver(event, ${gIdx})" ondrop="ganttCore.onTagHeaderDrop(event, ${gIdx})"` : "";

            let tagSummaryBarHtml = "";
            const hasValidDates = group.start && group.end && 
                                  typeof group.start === 'string' && typeof group.end === 'string' &&
                                  group.start.trim() !== "" && group.end.trim() !== "" &&
                                  !isNaN(new Date(group.start).getTime()) && !isNaN(new Date(group.end).getTime());

            if (isDeptJob && this.ganttViewMode === 'TAG' && hasValidDates) {
                const tStart = new Date(group.start);
                const tEnd = new Date(group.end);
                const tagLeft = Math.max(0, ((tStart - start) / (1000 * 60 * 60 * 24)) * DAY_W);
                const tagWidth = Math.max(DAY_W, (((tEnd - tStart) / (1000 * 60 * 60 * 24)) + 1) * DAY_W);
                tagSummaryBarHtml = `
                    <div class="tag-summary-bar" style="left:${tagLeft}px; width:${tagWidth}px;"
                         title="Hạng Mục: ${group.name} (${group.start} ➔ ${group.end})"
                         ondblclick="event.stopPropagation(); ganttCore.promptEditProjectTag('${group.id}')">
                    </div>`;
            }

            const deptHeaderHtml = `
                <div class="dept-unified-row task-group-header" style="width:${totalRowW}px; min-width:${totalRowW}px;" ${tagHeaderDragAttr}>
                    <div class="dept-title-cell ${group.class}" onclick="ganttCore.toggleDeptAccordion('${group.id}')">
                        <span class="toggle-btn" style="font-size:11px; margin-right:4px;">${toggleChar}</span>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${group.name} (${deptTasks.length} task${deptTasks.length !== 1 ? 's' : ''})</span>
                        ${syncBtnHtml}
                        ${mirrorTagBtnHtml}
                        ${editTagBtnHtml}
                        ${deleteTagBtnHtml}
                        ${deleteDeptTasksBtnHtml}
                    </div>
                    <div class="timeline-cell-grid" style="width:${totalTimelineW}px; min-width:${totalTimelineW}px;">
                        ${tagSummaryBarHtml}
                        ${deptGridCellsHtml}
                    </div>
                </div>`;
            container.insertAdjacentHTML('beforeend', deptHeaderHtml);

            if (isExpanded) {
                if (group.isMyTasksGroup && deptTasks.length === 0) {
                    const emptyRowHtml = `
                        <div class="gantt-unified-row" style="width:${totalRowW}px; min-width:${totalRowW}px; padding:18px; text-align:center; background:#f8fafc; font-size:12px; color:#64748b; font-style:italic; border-bottom:1px solid #e2e8f0;">
                            ✨ Bạn hiện chưa có công việc nào được phân công trong dự án "${prj.name}".
                        </div>`;
                    container.insertAdjacentHTML('beforeend', emptyRowHtml);
                }

                deptTasks.forEach(t => {
                    try {
                        const maskedTask = window.authMgr.maskTaskForUser(t, user);
                        if (!maskedTask) return;

                        const tStart = new Date(t.start); const tEnd = new Date(t.end);
                        const left = ((tStart - start) / (1000 * 60 * 60 * 24)) * DAY_W;
                        const width = Math.max(DAY_W, (((tEnd - tStart) / (1000 * 60 * 60 * 24)) + 1) * DAY_W);
                        const statusClass = this.getTaskStatusClass(t);
                        const isSelected = this.selectedTaskId === t.id ? "selected-task" : "";

                        const isPredecessorWithNotes = t.notes && t.notes.trim().length > 0;
                        
                        let isAffectedSuccessor = false;
                        if (t.codeOut) {
                            const predecessors = t.codeOut.split(',').map(s=>s.trim());
                            const parentWithNote = prj.tasks.find(p => predecessors.includes(p.codeIn) && p.notes && p.notes.trim().length > 0);
                            if (parentWithNote) isAffectedSuccessor = true;
                        }

                        let alertIconHtml = "";
                        if (isPredecessorWithNotes) {
                            alertIconHtml = `<div class="alert-dot-predecessor" title="Task tiền đề có ghi chú tác động tiến độ!">!</div>`;
                        } else if (isAffectedSuccessor) {
                            alertIconHtml = `<div class="alert-dot-successor" title="Bị ảnh hưởng tiến độ từ Task tiền đề!"></div>`;
                        }

                        let attachmentIconHtml = "";
                        const hasAtts = (t.attachments && t.attachments.length > 0) || t.hasFiles || t.has_files || t.file_count > 0 || t.fileCount > 0;
                        if (hasAtts) {
                            const attCount = (t.attachments && t.attachments.length > 0) ? t.attachments.length : (t.fileCount || t.file_count || 1);
                            const hasImg = t.attachments && t.attachments.some(a => a.type && a.type.startsWith("image/"));
                            const icon = hasImg ? "📷" : "📎";
                            attachmentIconHtml = `<span class="task-attachment-icon" title="Đính kèm ${attCount} tệp">${icon} ${attCount}</span>`;
                        }

                        let progressTooltipText = "";
                        if (t.lastProgressDate) {
                            if (t.lastProgressDate === todayStr) {
                                progressTooltipText = `⚡ Đã cập nhật hôm nay (${t.progressPercent || 0}%)`;
                            } else {
                                progressTooltipText = `📅 Đã cập nhật ngày ${t.lastProgressDate}`;
                            }
                        } else {
                            progressTooltipText = `Chưa có báo cáo tiến độ`;
                        }

                        let todayProgressBadgeHtml = "";
                        if (t.progressPercent !== undefined && t.progressPercent !== null && t.progressPercent > 0 && t.lastProgressDate === todayStr) {
                            const todayXPos = daysFromStartToday * DAY_W;
                            if (todayXPos >= left && todayXPos <= (left + width)) {
                                const badgeLeftOffset = todayXPos - left - 42;
                                todayProgressBadgeHtml = `<div class="today-progress-badge gantt-progress-text" style="left:${badgeLeftOffset}px;" title="${progressTooltipText}">${t.progressPercent}%</div>`;
                            }
                        }

                        let gridCellsHtml = "";
                        for (let i = 0; i < totalDays; i++) {
                            const isWeekend = weekendIndices.includes(i);
                            const weekendClass = isWeekend ? "is-weekend" : "";
                            gridCellsHtml += `<div class="day-cell ${weekendClass}" style="width:${DAY_W}px;"></div>`;
                        }

                        const canDragTask = (user.role === "ADMIN" || user.role === "DEPT_ADMIN" || this.isProjectOwner(prj) || (user.role === "STAFF" && window.authMgr && window.authMgr.isStaffPinUnlocked(prj.id)));
                        const dragHandleHtml = canDragTask ? 
                            `<span class="task-drag-handle" draggable="true" ondragstart="ganttCore.onTaskDragStart(event, '${t.id}', ${gIdx})" title="Kéo thả sắp xếp thứ tự task">⋮⋮</span>` : "";

                        const getTaskTag = (task) => {
                            let tag = task.projectTag;
                            if (!tag || tag === "[object Object]" || typeof tag === 'object') {
                                tag = (typeof tag === 'object' && tag?.name) ? tag.name : (prj.projectTags && prj.projectTags[0] ? (typeof prj.projectTags[0] === 'object' ? prj.projectTags[0].name : prj.projectTags[0]) : "Hạng mục chung");
                            }
                            return tag || "Hạng mục chung";
                        };

                        let staffCellText = (isDeptJob && this.ganttViewMode === 'STAFF') ? getTaskTag(t) : (maskedTask.staff || "Chưa giao");
                        if (group.isMyTasksGroup) {
                            staffCellText = this.getTaskContextLabel(t, prj);
                        }
                        const staffAvatarUrl = this.getStaffAvatar(maskedTask.staff);
                        const mirrorBadge = t.isMirror ? `<span style="display:inline-flex; align-items:center; margin-right:3px; vertical-align:middle; color:#0284c7;" title="Task phản chiếu D2D (Mirror)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span>` : "";
                        let deptBadgeHtml = "";
                        if (t.isMirror && t.sourceDept) {
                            deptBadgeHtml = `<span class="mirror-dept-badge" title="Nguồn: Phòng ban ${t.sourceDept}">${t.sourceDept}</span>`;
                        }

                        const staffInfoBlockHtml = group.isMyTasksGroup ? `
                            <div style="display:inline-flex; align-items:center; gap:4px; max-width:115px; width:115px; min-width:115px; border-left:1px solid #f1f5f9; padding-left:4px; overflow:hidden;" title="Bộ phận / Hạng mục: ${staffCellText}">
                                <span style="font-size:11px;">🏷️</span>
                                <small style="color:#0284c7; font-weight:700; font-size:10.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${staffCellText}</small>
                            </div>` : `
                            <div style="display:inline-flex; align-items:center; gap:4px; max-width:95px; width:95px; min-width:95px; border-left:1px solid #f1f5f9; padding-left:4px; overflow:hidden;" title="Người phụ trách: ${staffCellText}">
                                <img src="${staffAvatarUrl}" alt="${staffCellText}" style="width:16px; height:16px; border-radius:50%; object-fit:cover; flex-shrink:0; border:1px solid rgba(0,0,0,0.12);" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=475569&color=fff&size=40';">
                                <small style="color:#64748b; font-weight:600; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${staffCellText}</small>
                            </div>`;

                        const rowHtml = `
                            <div class="gantt-unified-row" style="width:${totalRowW}px; min-width:${totalRowW}px;"
                                 ondragover="ganttCore.onTaskDragOver(event, ${gIdx})" ondrop="ganttCore.onTaskDrop(event, '${t.id}', ${gIdx})">
                                <div class="task-title-cell task-name-cell">
                                    ${dragHandleHtml}
                                    ${mirrorBadge}
                                    ${deptBadgeHtml}
                                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; padding-right:4px;">${maskedTask.name}</span>
                                    ${staffInfoBlockHtml}
                                </div>
                                <div class="timeline-cell-grid" style="width:${totalTimelineW}px; min-width:${totalTimelineW}px;">
                                    ${gridCellsHtml}
                                    <div class="task-bar ${statusClass} ${isSelected} ${t.isMirror ? 'is-mirror-task' : ''}" id="task-bar-${t.id}" data-id="${t.id}"
                                         style="left:${left}px; width:${width}px; ${t.isMirror ? 'border: 1.5px dashed #0284c7 !important;' : ''}" 
                                         title="${maskedTask.name} - ${progressTooltipText} ${t.isMirror ? '(Task phản chiếu D2D từ ' + (t.sourceDept || 'khác') + ')' : ''}"
                                         onclick="ganttCore.onTaskSingleClick('${t.id}', event)" 
                                         ondblclick="ganttCore.onTaskDoubleClick('${t.id}', event)">
                                        ${todayProgressBadgeHtml}
                                        <span style="overflow:hidden; text-overflow:ellipsis; display:inline-flex; align-items:center; gap:4px;">
                                            ${t.isMirror ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' : ''}
                                            ${group.isMyTasksGroup ? `<span style="font-size:10px; font-weight:700; color:#eff6ff; background:rgba(0,0,0,0.25); padding:1px 4px; border-radius:3px; flex-shrink:0;">🏷️ ${staffCellText}</span>` : `<img src="${staffAvatarUrl}" title="Phụ trách: ${staffCellText}" alt="${staffCellText}" style="width:15px; height:15px; border-radius:50%; object-fit:cover; flex-shrink:0; border:1px solid rgba(255,255,255,0.8); box-shadow:0 1px 2px rgba(0,0,0,0.2);" onerror="this.style.display='none';">`}
                                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${maskedTask.name}</span>
                                        </span>
                                        ${attachmentIconHtml}
                                        ${alertIconHtml}
                                        <div class="handle handle-right" onmousedown="ganttCore.startLinkDrag('${t.id}', event)"></div>
                                    </div>
                                </div>
                            </div>`;

                        container.insertAdjacentHTML('beforeend', rowHtml);
                    } catch (taskRenderErr) {
                        console.error("Error rendering task row:", t, taskRenderErr);
                    }
                });
            }
        });

        // TODAY Marker Positioning
        const ganttBodyScroll = document.getElementById("gantt-body-scroll");
        if (ganttBodyScroll) {
            const totalHeight = Math.max(ganttBodyScroll.scrollHeight, container.scrollHeight);
            const today = new Date();
            const daysFromStart = (today - start) / (1000 * 60 * 60 * 24);
            const todayMarker = document.getElementById("today-marker");
            
            if (todayMarker) {
                if (daysFromStart >= 0 && daysFromStart <= totalDays) {
                    const taskColWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--task-col-w')) || 350;
                    todayMarker.style.left = `${taskColWidth + (daysFromStart * DAY_W)}px`;
                    todayMarker.style.height = `${totalHeight}px`;
                    todayMarker.style.display = 'block';
                } else { todayMarker.style.display = 'none'; }
            }
        }

        setTimeout(() => {
            this.drawDependencyLines();
            if (window.lucide) lucide.createIcons();
        }, 10);
    }

    drawDependencyLines() {
        const svg = document.getElementById("dependency-svg");
        if (!svg) return;
        svg.innerHTML = "";

        const prj = this.getCurrentProject();
        if (!prj) return;

        const containerScroll = document.getElementById("gantt-body-scroll");
        const unifiedContainer = document.getElementById("gantt-unified-container");
        if (!containerScroll || !unifiedContainer) return;

        const fullWidth = Math.max(containerScroll.scrollWidth, unifiedContainer.scrollWidth, 1200);
        const fullHeight = Math.max(containerScroll.scrollHeight, unifiedContainer.scrollHeight, 600);

        svg.setAttribute("width", fullWidth);
        svg.setAttribute("height", fullHeight);
        svg.style.width = fullWidth + "px";
        svg.style.height = fullHeight + "px";

        const containerRect = containerScroll.getBoundingClientRect();
        const scrollLeft = containerScroll.scrollLeft;
        const scrollTop = containerScroll.scrollTop;

        prj.tasks.forEach(targetTask => {
            if (!targetTask.codeOut) return;
            const requiredCodes = targetTask.codeOut.split(',').map(s => s.trim()).filter(Boolean);
            const targetBar = document.getElementById(`task-bar-${targetTask.id}`);
            if (!targetBar) return;

            const targetRect = targetBar.getBoundingClientRect();
            if (targetRect.height === 0 || targetRect.width === 0) return;

            const x2 = targetRect.left - containerRect.left + scrollLeft;
            const y2 = targetRect.top - containerRect.top + scrollTop + (targetRect.height / 2);

            prj.tasks.forEach(sourceTask => {
                if (requiredCodes.includes(sourceTask.codeIn)) {
                    const sourceBar = document.getElementById(`task-bar-${sourceTask.id}`);
                    if (sourceBar) {
                        const sourceRect = sourceBar.getBoundingClientRect();
                        if (sourceRect.height === 0 || sourceRect.width === 0) return;

                        const x1 = sourceRect.right - containerRect.left + scrollLeft;
                        const y1 = sourceRect.top - containerRect.top + scrollTop + (sourceRect.height / 2);

                        const isHighLight = this.selectedTaskId === targetTask.id || this.selectedTaskId === sourceTask.id;
                        if (!this.showGlobalLinks && !isHighLight) return;

                        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                        const dx = Math.abs(x2 - x1) / 2;
                        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                        
                        let strokeColor = "#94a3b8";
                        let strokeWidth = "2";

                        if (isHighLight) {
                            strokeColor = "#f97316";
                            strokeWidth = "2.5";
                        }

                        path.setAttribute("d", d);
                        path.setAttribute("stroke", strokeColor);
                        path.setAttribute("stroke-width", strokeWidth);
                        path.setAttribute("stroke-dasharray", "5,5");
                        path.setAttribute("fill", "none");
                        path.style.cursor = "pointer";
                        path.setAttribute("title", `Click để xóa liên kết từ [${sourceTask.name}] tới [${targetTask.name}]`);
                        path.onclick = (e) => {
                            e.stopPropagation();
                            this.deleteDependencyLink(sourceTask.id, targetTask.id);
                        };
                        svg.appendChild(path);
                    }
                }
            });
        });
    }

    deleteDependencyLink(sourceTaskId, targetTaskId) {
        const prj = this.getCurrentProject();
        if (!prj || !prj.tasks) return;
        const sourceTask = prj.tasks.find(t => t.id === sourceTaskId);
        const targetTask = prj.tasks.find(t => t.id === targetTaskId);
        if (!sourceTask || !targetTask) return;

        const confirmMsg = `Bạn có chắc muốn XÓA đường dây liên kết giữa:\n👉 [${sourceTask.name}]\nvà\n👉 [${targetTask.name}]?`;
        if (!confirm(confirmMsg)) return;

        let codes = targetTask.codeOut ? targetTask.codeOut.split(',').map(s => s.trim()).filter(Boolean) : [];
        codes = codes.filter(c => c !== sourceTask.codeIn);
        targetTask.codeOut = codes.join(', ');

        // Atomic link sync with D1 / Server
        const baseUrl = window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev";
        const headers = window.authMgr ? window.authMgr.getAuthHeaders() : { "Content-Type": "application/json" };
        fetch(`${baseUrl}/api/db/link`, {
            method: "POST",
            headers,
            body: JSON.stringify({ taskId: targetTask.id, codeOut: targetTask.codeOut, projectId: prj.id })
        }).catch(e => console.warn("D1 Link Sync Error:", e));

        this.saveToLocalStorage();
        this.renderGantt();
    }

    // MULTI-DEPT ADMIN & UNLOCKED STAFF HANDLE DRAGGING
    startLinkDrag(taskId, e) {
        const prj = this.getCurrentProject();
        const user = window.authMgr.getCurrentUser();
        
        if (user.role === "BOSS" || user.role === "GUEST") {
            alert("🔒 Bạn đang ở chế độ xem không được phép kéo nối dây!");
            return;
        }

        // Check linking rights (ADMIN, ALL invited DEPT_ADMINs, ALL invited STAFF unlocked with PIN)
        if (!this.canUserLinkTasks(prj)) {
            const isInvited = (user.dept === prj.creatorDept) || (prj.invitedDepts && prj.invitedDepts.includes(user.dept));
            if (!isInvited) {
                alert("🔒 Bộ phận của bạn chưa được mời tham gia dự án này nên không được kéo nối dây!");
            } else if (user.role === "STAFF" && !window.authMgr.isStaffPinUnlocked(prj.id)) {
                alert("🔑 Nhân viên (STAFF) vui lòng bấm nút [🔑 Nhập PIN Giải Khóa Edit] ở trên trước khi thực hiện kéo nối dây!");
            } else {
                alert("🔒 Bạn không có quyền kéo nối dây liên kết trong dự án này!");
            }
            return;
        }

        e.stopPropagation();
        this.draggingLink = true;
        this.dragSourceTaskId = taskId;
        this.lastMouseEvent = e;

        const svg = document.getElementById("dependency-svg");
        this.tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        this.tempLine.setAttribute("stroke", "#f97316");
        this.tempLine.setAttribute("stroke-width", "2.5");
        this.tempLine.setAttribute("stroke-dasharray", "5,5");
        svg.appendChild(this.tempLine);

        this._onMouseMove = (evt) => {
            this.lastMouseEvent = evt;
            this.onLinkDrag(evt);
        };
        this._onMouseUp = (evt) => this.endLinkDrag(evt);

        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);

        this.startAutoScrollLoop();
    }

    startAutoScrollLoop() {
        if (this.autoScrollInterval) clearInterval(this.autoScrollInterval);

        this.autoScrollInterval = setInterval(() => {
            if (!this.draggingLink || !this.lastMouseEvent) return;
            const e = this.lastMouseEvent;
            const containerScroll = document.getElementById("gantt-body-scroll");
            if (!containerScroll) return;

            const containerRect = containerScroll.getBoundingClientRect();
            const threshold = 60;
            const scrollSpeed = 12;

            let scrolled = false;

            if (e.clientY > containerRect.bottom - threshold) {
                containerScroll.scrollTop += scrollSpeed;
                scrolled = true;
            } else if (e.clientY < containerRect.top + threshold) {
                containerScroll.scrollTop -= scrollSpeed;
                scrolled = true;
            }

            if (e.clientX > containerRect.right - threshold) {
                containerScroll.scrollLeft += scrollSpeed;
                scrolled = true;
            } else if (e.clientX < containerRect.left + 250 + threshold) {
                containerScroll.scrollLeft -= scrollSpeed;
                scrolled = true;
            }

            if (scrolled) {
                this.syncScroll(containerScroll);
                this.onLinkDrag(e);
            }
        }, 30);
    }

    stopAutoScrollLoop() {
        if (this.autoScrollInterval) {
            clearInterval(this.autoScrollInterval);
            this.autoScrollInterval = null;
        }
    }

    onLinkDrag(e) {
        if (!this.draggingLink || !this.tempLine) return;
        const containerScroll = document.getElementById("gantt-body-scroll");
        const containerRect = containerScroll.getBoundingClientRect();
        const scrollLeft = containerScroll.scrollLeft;
        const scrollTop = containerScroll.scrollTop;

        const sourceBar = document.getElementById(`task-bar-${this.dragSourceTaskId}`);
        if (!sourceBar) return;
        const sourceRect = sourceBar.getBoundingClientRect();
        
        const x1 = sourceRect.right - containerRect.left + scrollLeft;
        const y1 = sourceRect.top - containerRect.top + scrollTop + (sourceRect.height / 2);
        
        const x2 = e.clientX - containerRect.left + scrollLeft;
        const y2 = e.clientY - containerRect.top + scrollTop;

        this.tempLine.setAttribute("x1", x1); this.tempLine.setAttribute("y1", y1);
        this.tempLine.setAttribute("x2", x2); this.tempLine.setAttribute("y2", y2);
    }

    endLinkDrag(e) {
        if (!this.draggingLink) return;
        this.draggingLink = false;
        this.stopAutoScrollLoop();

        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);

        if (this.tempLine) this.tempLine.remove();

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const targetTaskBar = el ? el.closest('.task-bar') : null;

        if (targetTaskBar) {
            const targetTaskId = targetTaskBar.getAttribute('data-id');
            if (targetTaskId && targetTaskId !== this.dragSourceTaskId) {
                const prj = this.getCurrentProject();
                const sourceTask = prj.tasks.find(t => t.id === this.dragSourceTaskId);
                const targetTask = prj.tasks.find(t => t.id === targetTaskId);

                if (targetTask && sourceTask) {
                    let currentCodes = targetTask.codeOut ? targetTask.codeOut.split(',').map(s => s.trim()).filter(Boolean) : [];
                    if (!currentCodes.includes(sourceTask.codeIn)) {
                        currentCodes.push(sourceTask.codeIn);
                        targetTask.codeOut = currentCodes.join(', ');

                        // Fine-grained D1 SQL Atomic update
                        const baseUrl = window.WORKER_API_BASE || "https://schedule-manager-api.sdivn01.workers.dev";
                        const headers = window.authMgr ? window.authMgr.getAuthHeaders() : { "Content-Type": "application/json" };
                        fetch(`${baseUrl}/api/db/link`, {
                            method: "POST",
                            headers,
                            body: JSON.stringify({ taskId: targetTask.id, codeOut: targetTask.codeOut, projectId: prj.id })
                        }).catch(e => console.warn("D1 Link Sync Error:", e));

                        this.saveToLocalStorage();
                        this.renderGantt();
                    }
                }
            }
        }
    }

    onTaskSingleClick(id, e) {
        if (e) e.stopPropagation();
        
        const now = Date.now();
        const DOUBLE_TAP_THRESHOLD = 380; // ms threshold for mobile double tap

        // Double tap detection for iOS Safari / Mobile Touch screens
        if (this.lastTapTaskId === id && (now - (this.lastTapTime || 0)) < DOUBLE_TAP_THRESHOLD) {
            this.lastTapTime = 0;
            this.lastTapTaskId = null;
            if (this.clickTimer) clearTimeout(this.clickTimer);
            openTaskModal(id);
            return;
        }

        this.lastTapTime = now;
        this.lastTapTaskId = id;

        // Delay single-click selection slightly so double-tap can trigger smoothly on mobile
        if (this.clickTimer) clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => {
            const isDeselect = (this.selectedTaskId === id);
            this.selectedTaskId = isDeselect ? null : id;
            
            // Highlight selected task bar without full DOM tear-down
            document.querySelectorAll('.task-bar').forEach(el => el.classList.remove('selected-task'));
            if (!isDeselect) {
                const bar = document.getElementById(`task-bar-${id}`);
                if (bar) bar.classList.add('selected-task');
            }

            // Immediately redraw dependency lines so related tasks display orange-yellow dashed lines!
            this.drawDependencyLines();
        }, 220);
    }

    onTaskDoubleClick(id, e) {
        if (e) e.stopPropagation();
        if (this.clickTimer) clearTimeout(this.clickTimer);
        this.lastTapTime = 0;
        this.lastTapTaskId = null;
        openTaskModal(id);
    }

    syncScroll(el) {
        const headScroll = document.getElementById("timeline-head-scroll");
        if (headScroll) headScroll.scrollLeft = el.scrollLeft;
        this.drawDependencyLines();
    }

    // ==========================================
    // TÍNH NĂNG ĐỒNG BỘ RỐI LƯỢNG TỬ (QUANTUM 2-WAY SYNC)
    // ==========================================
    getQuantumSyncLinks() {
        if (!this.workspace || !Array.isArray(this.workspace.quantumSyncLinks)) {
            if (this.workspace) this.workspace.quantumSyncLinks = [];
            else return [];
        }
        return this.workspace.quantumSyncLinks;
    }

    getQuantumSyncLinkForShared(sharedProjectId, deptId) {
        return this.getQuantumSyncLinks().find(l => l.sharedProjectId === sharedProjectId && l.dept === deptId);
    }

    getQuantumSyncLinkForInternal(internalProjectId, tagName) {
        if (!tagName) return null;
        return this.getQuantumSyncLinks().find(l => l.internalProjectId === internalProjectId && l.internalTagName && l.internalTagName.trim().toLowerCase() === tagName.trim().toLowerCase());
    }

    openQuantumSyncModal(deptId, sharedProjectId) {
        const user = window.authMgr.getCurrentUser();
        if (user.role !== "ADMIN" && (user.role !== "DEPT_ADMIN" || user.dept !== deptId)) {
            alert("🔒 Chỉ Trưởng phòng của bộ phận này hoặc Admin mới có quyền đồng bộ công việc nội bộ!");
            return;
        }

        const prj = this.workspace.projects.find(p => p.id === sharedProjectId);
        if (!prj) return;

        document.getElementById("qsync-dept-id").value = deptId;
        document.getElementById("qsync-shared-proj-id").value = sharedProjectId;

        const syncLink = this.getQuantumSyncLinkForShared(sharedProjectId, deptId);
        const statusBox = document.getElementById("qsync-status-box");
        const statusDesc = document.getElementById("qsync-status-desc");
        const setupBox = document.getElementById("qsync-setup-box");

        if (syncLink) {
            const intProj = this.workspace.projects.find(p => p.id === syncLink.internalProjectId);
            const intProjName = intProj ? intProj.name : syncLink.internalProjectId;
            statusDesc.innerHTML = `Dự án nội bộ: <b>${intProjName}</b><br>Tag đồng bộ: <b>${syncLink.internalTagName}</b>`;
            statusBox.style.display = "block";
            setupBox.style.display = "none";
        } else {
            statusBox.style.display = "none";
            setupBox.style.display = "block";

            // Populate internal projects of deptId
            const intSelect = document.getElementById("qsync-internal-proj-select");
            const deptInternalProjects = this.workspace.projects.filter(p => p.status !== "ARCHIVED" && p.isDeptJob && p.creatorDept === deptId);
            if (deptInternalProjects.length === 0) {
                intSelect.innerHTML = `<option value="__NEW__">+ Tạo Dự Án Nội Bộ Mới Cho ${deptId}</option>`;
            } else {
                intSelect.innerHTML = deptInternalProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('') +
                    `<option value="__NEW__">+ Tạo Dự Án Nội Bộ Mới Cho ${deptId}</option>`;
            }

            document.getElementById("qsync-internal-tag-name").value = prj.name;
        }

        document.getElementById("quantum-sync-modal").style.display = "flex";
    }

    confirmCreateQuantumSync() {
        const deptId = document.getElementById("qsync-dept-id").value;
        const sharedProjectId = document.getElementById("qsync-shared-proj-id").value;
        const sharedProj = this.workspace.projects.find(p => p.id === sharedProjectId);
        if (!sharedProj) return;

        let internalProjId = document.getElementById("qsync-internal-proj-select").value;
        let internalTagName = document.getElementById("qsync-internal-tag-name").value.trim() || sharedProj.name;

        let internalProj = null;
        if (internalProjId === "__NEW__") {
            internalProjId = "PRJ_INT_" + Date.now();
            internalProj = {
                id: internalProjId,
                name: `Quản Lý Công Việc Nội Bộ ${deptId}`,
                pin: window.lifecycleMgr ? window.lifecycleMgr.generateDefaultPin() : "12345678",
                creatorDept: deptId,
                creatorPic: deptId,
                projectManager: "Trưởng Phòng " + deptId,
                isShared: false,
                isDeptReport: false,
                isDeptJob: true,
                category: "DEPT_JOB",
                invitedDepts: [deptId],
                projectTags: [{ name: internalTagName, start: sharedProj.startRange, end: sharedProj.endRange }],
                status: "Active",
                startRange: sharedProj.startRange || "2026-09-01",
                endRange: sharedProj.endRange || "2026-10-30",
                staffs: [deptId],
                tasks: []
            };
            this.workspace.projects.push(internalProj);
        } else {
            internalProj = this.workspace.projects.find(p => p.id === internalProjId);
        }

        if (!internalProj) {
            alert("❌ Không tìm thấy dự án nội bộ!");
            return;
        }

        // Ensure internal project has this tag
        internalProj.projectTags = internalProj.projectTags || [];
        const hasTag = internalProj.projectTags.some(tg => (typeof tg === 'object' ? tg.name : tg) === internalTagName);
        if (!hasTag) {
            internalProj.projectTags.push({ name: internalTagName, start: sharedProj.startRange, end: sharedProj.endRange });
        }

        const quantumSyncId = "QSYNC_" + Date.now();

        // Sync existing tasks of deptId in sharedProj to internalProj
        const sharedDeptTasks = (sharedProj.tasks || []).filter(t => (t.dept || getDeptFromCodeIn(t.codeIn)) === deptId);
        sharedDeptTasks.forEach(st => {
            if (!st.quantumId) {
                st.quantumId = "QTM_" + Date.now() + "_" + Math.floor(Math.random()*10000);
            }
            const existingTwin = (internalProj.tasks || []).find(it => it.quantumId === st.quantumId);
            if (!existingTwin) {
                internalProj.tasks = internalProj.tasks || [];
                internalProj.tasks.push({
                    id: "TASK_INT_" + Date.now() + "_" + Math.floor(Math.random()*10000),
                    quantumId: st.quantumId,
                    name: st.name,
                    codeIn: st.codeIn,
                    codeOut: "",
                    staff: st.staff || deptId,
                    dept: deptId,
                    projectTag: internalTagName,
                    start: st.start,
                    startTime: st.startTime || "",
                    end: st.end,
                    endTime: st.endTime || "",
                    isStarted: st.isStarted || false,
                    isCompleted: st.isCompleted || false,
                    progressPercent: st.progressPercent || 0,
                    lastProgressDate: st.lastProgressDate || "",
                    notes: st.notes || "",
                    orderIndex: internalProj.tasks.length,
                    attachments: st.attachments ? [...st.attachments] : []
                });
            }
        });

        // Register quantum link
        const links = this.getQuantumSyncLinks();
        this.workspace.quantumSyncLinks = links.filter(l => !(l.sharedProjectId === sharedProjectId && l.dept === deptId));
        this.workspace.quantumSyncLinks.push({
            id: quantumSyncId,
            dept: deptId,
            sharedProjectId: sharedProjectId,
            internalProjectId: internalProj.id,
            internalTagName: internalTagName,
            createdAt: new Date().toISOString()
        });

        this.saveToLocalStorage();
        closeModal("quantum-sync-modal");
        this.renderGantt();
        this.renderProjectsSidebar();
        alert(`⚡ Đã kích hoạt đồng bộ 2 chiều thành công!\nTừ giờ, công việc của bộ phận [${deptId}] trong dự án "${sharedProj.name}" và Tag "${internalTagName}" trong "${internalProj.name}" sẽ luôn đồng bộ 2 chiều.`);
    }

    confirmUnlinkQuantumSync() {
        const deptId = document.getElementById("qsync-dept-id").value;
        const sharedProjectId = document.getElementById("qsync-shared-proj-id").value;
        if (!confirm("⚠️ Bạn có chắc muốn HỦY LIÊN KẾT đồng bộ 2 chiều?\n\n- Toàn bộ công việc ở cả 2 nơi VẪN ĐƯỢC GIỮ NGUYÊN ('Ai về nhà nấy').\n- Sau khi hủy, sửa đổi ở một bên sẽ không tự động cập nhật sang bên kia nữa.")) return;

        this.workspace.quantumSyncLinks = this.getQuantumSyncLinks().filter(l => !(l.sharedProjectId === sharedProjectId && l.dept === deptId));
        this.saveToLocalStorage();
        closeModal("quantum-sync-modal");
        this.renderGantt();
        alert("Đã hủy liên kết đồng bộ. Dữ liệu công việc của cả 2 nơi vẫn được bảo toàn nguyên vẹn.");
    }

    openInternalToSharedSyncModal(tagName, internalProjectId) {
        const user = window.authMgr.getCurrentUser();
        const prj = this.workspace.projects.find(p => p.id === internalProjectId);
        if (!prj) return;
        const deptId = prj.creatorDept || user.dept || "CONSTRUCTION";

        if (user.role !== "ADMIN" && (user.role !== "DEPT_ADMIN" || user.dept !== deptId)) {
            alert("🔒 Chỉ Trưởng phòng của bộ phận này hoặc Admin mới có quyền đồng bộ Tag nội bộ lên dự án chung!");
            return;
        }

        document.getElementById("int-sync-tag-name").value = tagName;
        document.getElementById("int-sync-internal-proj-id").value = internalProjectId;

        this.onIntSyncTypeChange();
        document.getElementById("internal-to-shared-sync-modal").style.display = "flex";
    }

    onIntSyncTypeChange() {
        const type = document.getElementById("int-sync-proj-type-select").value;
        const targetSelect = document.getElementById("int-sync-target-proj-select");
        const availableProjects = this.workspace.projects.filter(p => {
            if (p.status === "ARCHIVED") return false;
            const isBidding = Boolean(p.isDeptReport || p.category === "REPORT" || p.category === "BIDDING" || (p.id && p.id.startsWith("PRJ_RPT_")));
            if (type === "bidding") {
                if (!isBidding) return false;
            } else {
                if (isBidding || !p.isShared) return false;
            }
            return this.canUserSeeProject(p);
        });

        if (availableProjects.length === 0) {
            targetSelect.innerHTML = `<option value="">-- Chưa có dự án nào thuộc nhóm này --</option>`;
        } else {
            targetSelect.innerHTML = availableProjects.map(p => `<option value="${p.id}">${p.name} (Tạo bởi: ${p.creatorDept || 'Admin'})</option>`).join('');
        }
    }

    confirmCreateInternalToSharedSync() {
        const tagName = document.getElementById("int-sync-tag-name").value.trim();
        const internalProjectId = document.getElementById("int-sync-internal-proj-id").value;
        const targetSharedProjectId = document.getElementById("int-sync-target-proj-select").value;

        if (!targetSharedProjectId) {
            alert("⚠️ Vui lòng chọn một Dự án chung đích để đồng bộ!");
            return;
        }

        const internalProj = this.workspace.projects.find(p => p.id === internalProjectId);
        const targetProj = this.workspace.projects.find(p => p.id === targetSharedProjectId);
        if (!internalProj || !targetProj) {
            alert("❌ Không tìm thấy thông tin dự án!");
            return;
        }

        const deptId = internalProj.creatorDept || "CONSTRUCTION";

        targetProj.invitedDepts = targetProj.invitedDepts || [];
        if (!targetProj.invitedDepts.includes(deptId)) {
            targetProj.invitedDepts.push(deptId);
        }

        const tagTasks = (internalProj.tasks || []).filter(t => (t.projectTag || (internalProj.projectTags && internalProj.projectTags[0])) === tagName);
        tagTasks.forEach(it => {
            if (!it.quantumId) {
                it.quantumId = "QTM_" + Date.now() + "_" + Math.floor(Math.random()*10000);
            }
            const existingTwin = (targetProj.tasks || []).find(st => 
                (st.quantumId && st.quantumId === it.quantumId) ||
                (st.name && it.name && st.name.trim().toLowerCase() === it.name.trim().toLowerCase() && (st.dept || getDeptFromCodeIn(st.codeIn)) === deptId)
            );
            if (existingTwin) {
                // Task đã có sẵn: chỉ kết nối quantumId, không chép trùng lặp
                existingTwin.quantumId = it.quantumId;
            } else {
                targetProj.tasks = targetProj.tasks || [];
                targetProj.tasks.push({
                    id: "TASK_" + Date.now() + "_" + Math.floor(Math.random()*10000),
                    quantumId: it.quantumId,
                    name: it.name,
                    codeIn: it.codeIn || (deptId.slice(0, 3) + Math.floor(1000 + Math.random()*9000)),
                    codeOut: "",
                    staff: it.staff || deptId,
                    dept: deptId,
                    projectTag: tagName,
                    start: it.start,
                    startTime: it.startTime || "",
                    end: it.end,
                    endTime: it.endTime || "",
                    isStarted: it.isStarted || false,
                    isCompleted: it.isCompleted || false,
                    progressPercent: it.progressPercent || 0,
                    lastProgressDate: it.lastProgressDate || "",
                    notes: it.notes || "",
                    orderIndex: targetProj.tasks.length,
                    attachments: it.attachments ? [...it.attachments] : []
                });
            }
        });

        const quantumSyncId = "QSYNC_" + Date.now();
        this.workspace.quantumSyncLinks = this.getQuantumSyncLinks().filter(l => !(l.internalProjectId === internalProjectId && l.internalTagName === tagName));
        this.workspace.quantumSyncLinks.push({
            id: quantumSyncId,
            dept: deptId,
            sharedProjectId: targetProj.id,
            internalProjectId: internalProj.id,
            internalTagName: tagName,
            createdAt: new Date().toISOString()
        });

        this.saveToLocalStorage();
        closeModal("internal-to-shared-sync-modal");
        this.renderGantt();
        alert(`⚡ Đã kích hoạt đồng bộ 2 chiều thành công!\nTag [${tagName}] đã được kết nối với dự án "${targetProj.name}".`);
    }

    openConvertToUnderConstructionModal(projectId) {
        const prj = this.workspace.projects.find(p => p.id === projectId);
        if (!prj) return;
        const user = window.authMgr.getCurrentUser();
        if (!this.isProjectOwner(prj) && user.role !== "ADMIN") {
            alert("🔒 Chỉ Người tạo dự án Bidding hoặc Admin mới có quyền chuyển dự án sang Thi Công!");
            return;
        }

        document.getElementById("convert-bidding-proj-id").value = projectId;
        document.getElementById("convert-bidding-proj-name").innerText = prj.name;

        const container = document.getElementById("convert-bidding-depts-container");
        const currentInvited = prj.invitedDepts || [prj.creatorDept || "CONSTRUCTION"];
        const deptsList = (window.DEPARTMENTS && window.DEPARTMENTS.length > 0) ? window.DEPARTMENTS : (DEPARTMENTS || []);
        container.innerHTML = deptsList.map(d => {
            const isChecked = currentInvited.includes(d.id) || currentInvited.includes(d.code) ? "checked" : "";
            return `<label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" class="convert-dept-chk" value="${d.id || d.code}" ${isChecked} style="accent-color:#2563eb;">
                ${d.name}
            </label>`;
        }).join('');

        document.getElementById("convert-bidding-modal").style.display = "flex";
    }

    confirmConvertToUnderConstruction() {
        const projectId = document.getElementById("convert-bidding-proj-id").value;
        const prj = this.workspace.projects.find(p => p.id === projectId);
        if (!prj) return;

        const selectedDepts = [];
        document.querySelectorAll(".convert-dept-chk:checked").forEach(c => selectedDepts.push(c.value));
        if (selectedDepts.length === 0) {
            alert("Vui lòng chọn ít nhất 1 bộ phận tham gia thi công!");
            return;
        }

        prj.isDeptReport = false;
        prj.isShared = true;
        prj.category = "UNDER_CONSTRUCTION";
        prj.invitedDepts = selectedDepts;

        this.saveToLocalStorage();
        closeModal("convert-bidding-modal");
        this.renderProjectsSidebar();
        this.renderGantt();
        alert(`🎉 CHÚC MỪNG THẮNG THẦU!\n\nDự án "${prj.name}" đã được chuyển sang "Under Construction Projects" thành công.\nCác liên kết đồng bộ 2 chiều với nội bộ các bộ phận vẫn được bảo lưu 100%.`);
    }

    dissolveBiddingProject(projectId) {
        const prj = this.workspace.projects.find(p => p.id === projectId);
        if (!prj) return;
        const user = window.authMgr.getCurrentUser();
        if (!this.isProjectOwner(prj) && user.role !== "ADMIN") {
            alert("🔒 Chỉ Người tạo dự án Bidding hoặc Admin mới có quyền giải tán dự án!");
            return;
        }

        if (!confirm(`⚠️ XÁC NHẬN GIẢI TÁN DỰ ÁN BIDDING: "${prj.name}"\n\n- Dự án Bidding sẽ bị xóa khỏi hệ thống.\n- Toàn bộ công việc của các bộ phận ở NỘI BỘ VẪN ĐƯỢC BẢO TOÀN NGUYÊN VẸN ("Ai về nhà nấy"), tự động chuyển thành việc nội bộ độc lập.\n\nBạn có chắc chắn muốn giải tán không?`)) {
            return;
        }

        this.workspace.quantumSyncLinks = this.getQuantumSyncLinks().filter(l => l.sharedProjectId !== projectId);
        this.workspace.projects = this.workspace.projects.filter(p => p.id !== projectId);
        this.saveToLocalStorage();

        alert("🛑 Đã giải tán dự án Bidding thành công. Công việc nội bộ của các phòng ban đã được bảo toàn an toàn.");
        const nextProj = this.workspace.projects.find(p => p.status !== "ARCHIVED" && this.canUserSeeProject(p)) || this.workspace.projects[0];
        if (nextProj) {
            this.switchProject(nextProj.id);
        } else {
            location.reload();
        }
    }

    promptDeleteDeptTasks(deptId, projectId) {
        const prj = this.workspace.projects.find(p => p.id === projectId);
        if (!prj) return;
        const user = window.authMgr.getCurrentUser();
        if (user.role !== "ADMIN" && (user.role !== "DEPT_ADMIN" || user.dept !== deptId)) {
            alert("🔒 Chỉ Trưởng phòng của bộ phận này hoặc Admin mới có quyền xóa công việc của bộ phận!");
            return;
        }

        const deptObj = DEPARTMENTS.find(d => d.id === deptId) || { name: deptId };
        if (!confirm(`⚠️ Bạn có chắc chắn muốn XÓA TOÀN BỘ công việc của ${deptObj.name} trong dự án "${prj.name}"?\n\nNếu đang đồng bộ 2 chiều với nội bộ, các task này cũng sẽ bị xóa vĩnh viễn ở dự án nội bộ.`)) {
            return;
        }

        const tasksToDelete = (prj.tasks || []).filter(t => (t.dept || getDeptFromCodeIn(t.codeIn)) === deptId);
        tasksToDelete.forEach(t => {
            if (t.quantumId) {
                this.deleteQuantumTaskAcrossProjects(t.quantumId, projectId);
            }
        });

        prj.tasks = (prj.tasks || []).filter(t => (t.dept || getDeptFromCodeIn(t.codeIn)) !== deptId);
        this.saveToLocalStorage();
        this.renderGantt();
        alert(`Đã xóa toàn bộ công việc của ${deptObj.name}.`);
    }

    syncQuantumTaskUpdate(taskData, sourceProjectId) {
        // Redundant cross-project sync removed: Tasks are self-contained with designated department & staff
        return;
    }

    deleteQuantumTaskAcrossProjects(quantumId, sourceProjectId) {
        // Redundant cross-project sync removed
        return;
    }

    handleQuantumTaskCreate(taskData, currentProj) {
        // Redundant cross-project sync removed
        return;
    }

    syncQuantumTasks() {
        // Redundant cross-project sync removed: Tasks are self-contained with designated department & staff
        return;
    }
}

window.ganttCore = new GanttCore();

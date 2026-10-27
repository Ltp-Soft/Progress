/**
 * Project Lifecycle & Security Freeze Engine
 * Handles PIN Verification, Archiving, 30-Day Cloud Countdown & Local Backup Purge
 */

class LifecycleManager {
    generateDefaultPin() {
        return Math.floor(10000000 + Math.random() * 90000000).toString(); // 8-digit PIN
    }

    validatePin(project, userPin) {
        if (!project || !userPin) return false;
        return String(project.pin).trim() === String(userPin).trim();
    }

    getCountdownDays(closedAt) {
        if (!closedAt) return 30;
        const closeDate = new Date(closedAt);
        const now = new Date();
        const diffMs = now - closeDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const remaining = 30 - diffDays;
        return remaining > 0 ? remaining : 0;
    }

    exportProjectBackup(project, tasks) {
        const payload = {
            export_version: "6.0",
            export_timestamp: new Date().toISOString(),
            project: {
                id: project.id,
                name: project.name,
                pin: project.pin,
                creatorDept: project.creatorDept,
                closedAt: project.closedAt,
                startRange: project.startRange,
                endRange: project.endRange
            },
            tasks: tasks.map(t => ({
                id: t.id,
                codeIn: t.codeIn,
                codeOut: t.codeOut,
                name: t.name,
                staff: t.staff,
                dept: t.dept,
                start: t.start,
                end: t.end,
                isStarted: t.isStarted,
                isCompleted: t.isCompleted,
                notes: t.notes,
                isPublic: t.isPublic
            }))
        };

        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `BACKUP_${project.id}_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_30DAY_PURGE.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

window.lifecycleMgr = new LifecycleManager();

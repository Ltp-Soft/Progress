/**
 * Client-Side Offline Storage & Synchronization (IndexedDB)
 * Ensures zero data loss during network dropouts
 */

class OfflineDB {
    constructor() {
        this.dbName = "ScheduleManagerDB";
        this.dbVersion = 1;
        this.db = null;
        this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains("projects")) {
                    db.createObjectStore("projects", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("tasks")) {
                    db.createObjectStore("tasks", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("pending_sync")) {
                    db.createObjectStore("pending_sync", { keyPath: "syncId", autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    async saveProjectLocal(project) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["projects"], "readwrite");
            const store = tx.objectStore("projects");
            store.put(project);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getProjectsLocal() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["projects"], "readonly");
            const store = tx.objectStore("projects");
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async saveTaskLocal(task) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["tasks"], "readwrite");
            const store = tx.objectStore("tasks");
            store.put(task);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async bufferSyncMutation(mutation) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["pending_sync"], "readwrite");
            const store = tx.objectStore("pending_sync");
            store.add({ ...mutation, timestamp: Date.now() });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async syncPendingMutations() {
        if (!navigator.onLine || !this.db) return;
        const tx = this.db.transaction(["pending_sync"], "readonly");
        const store = tx.objectStore("pending_sync");
        const req = store.getAll();
        
        req.onsuccess = async () => {
            const items = req.result || [];
            if (items.length === 0) return;

            for (const item of items) {
                try {
                    await fetch(item.url, {
                        method: item.method || "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(item.data)
                    });
                    // Clear synced item
                    const delTx = this.db.transaction(["pending_sync"], "readwrite");
                    delTx.objectStore("pending_sync").delete(item.syncId);
                } catch (e) {
                    console.warn("Sync failed, will retry later:", e);
                }
            }
        };
    }
}

window.offlineDB = new OfflineDB();
window.addEventListener('online', () => window.offlineDB.syncPendingMutations());

(function () {
    "use strict";

    const BACKUP_FORMAT = "bpsc-collection-migration-backup";
    const BACKUP_VERSION = 1;
    const DATABASE_ENUMERATION_TIMEOUT_MS = 10000;
    const DATABASE_OPEN_TIMEOUT_MS = 10000;
    const DATABASE_READ_TIMEOUT_MS = 15000;
    const FILE_FETCH_TIMEOUT_MS = 15000;
    const COMPLETED_KEY = "bpscCollectionMigrationBackupV2";
    const BACKUP_BASE_PATH = String(window.QUIZ_COLLECTIONS_BACKUP_BASE_PATH || "");
    const LEGACY_DATA_FILES = window.QUIZ_COLLECTIONS_BACKUP_LEGACY_FILES || [
        "data/saved_questions.json",
        "data/current_affairs.json"
    ];
    const DATABASE_NAMES = new Set(window.QUIZ_COLLECTIONS_BACKUP_DATABASE_NAMES || [
        "bpscQuizCollectionStore",
        "bpsc_quiz_storage",
        "bpscQuizPendingChanges"
    ]);
    const RELEVANT_KEY = /^(bookmarks|questionClassifications|quizPendingChanges|quizPendingChangeBatches|quiz_attempt_history|quizResult(?:_.+)?|quizResults|quiz_results|test_results|quizProgress(?:_.+)?)$/i;
    const localStorageSnapshot = {};
    let backupPayload = null;
    let backupError = null;

    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key && RELEVANT_KEY.test(key)) {
                localStorageSnapshot[key] = localStorage.getItem(key);
            }
        }
    } catch (error) {
        backupError = error;
    }

    function requestValue(request, source, timeoutMs = DATABASE_READ_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                reject(new Error(`Timed out after ${timeoutMs / 1000} seconds reading ${source}; the original data was left unchanged. Retry the backup.`));
            }, timeoutMs);
            request.onsuccess = () => {
                window.clearTimeout(timeout);
                resolve(request.result);
            };
            request.onerror = () => {
                window.clearTimeout(timeout);
                reject(request.error || new Error(`Unable to read ${source}; the original data was left unchanged. Retry the backup.`));
            };
        });
    }

    function withTimeout(promise, timeoutMs, message) {
        let timeout;
        return Promise.race([
            promise,
            new Promise((resolve, reject) => {
                timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
            })
        ]).finally(() => window.clearTimeout(timeout));
    }

    function openExistingDatabase(name, version) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = window.setTimeout(() => {
                settled = true;
                reject(new Error(`Timed out after ${DATABASE_OPEN_TIMEOUT_MS / 1000} seconds opening ${name}; the original data was left unchanged. Close blocking tabs and retry the backup.`));
            }, DATABASE_OPEN_TIMEOUT_MS);
            const request = window.indexedDB.open(name, version);
            request.onupgradeneeded = () => {
                window.clearTimeout(timeout);
                settled = true;
                request.transaction.abort();
                reject(new Error(`Database ${name} changed during backup; no schema changes were made. Retry the backup.`));
            };
            request.onsuccess = () => {
                if (settled) {
                    request.result.close();
                    return;
                }
                settled = true;
                window.clearTimeout(timeout);
                resolve(request.result);
            };
            request.onerror = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                reject(request.error || new Error(`Unable to open ${name} for backup; the original data was left unchanged. Retry the backup.`));
            };
            request.onblocked = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                reject(new Error(`Database ${name} is blocked by another tab; the original data was left unchanged. Close blocking tabs and retry the backup.`));
            };
        });
    }

    async function readExistingDatabases() {
        if (!window.indexedDB || typeof window.indexedDB.databases !== "function") {
            throw new Error("This browser cannot safely enumerate existing IndexedDB databases for the required migration backup.");
        }
        const known = await withTimeout(
            window.indexedDB.databases(),
            DATABASE_ENUMERATION_TIMEOUT_MS,
            `Timed out after ${DATABASE_ENUMERATION_TIMEOUT_MS / 1000} seconds listing IndexedDB databases; the original data was left unchanged. Retry the backup.`
        );
        const existing = known.filter((item) => item.name && DATABASE_NAMES.has(item.name));
        const snapshots = [];
        for (const item of existing) {
            const database = await openExistingDatabase(item.name, item.version);
            try {
                const stores = {};
                for (const storeName of Array.from(database.objectStoreNames)) {
                    const transaction = database.transaction(storeName, "readonly");
                    const store = transaction.objectStore(storeName);
                    const [keys, values] = await Promise.all([
                        requestValue(store.getAllKeys(), `${item.name}/${storeName} keys`),
                        requestValue(store.getAll(), `${item.name}/${storeName} records`)
                    ]);
                    stores[storeName] = values.map((value, index) => ({ key: keys[index], value }));
                }
                snapshots.push({ name: database.name, version: database.version, stores });
            } finally {
                database.close();
            }
        }
        return snapshots;
    }

    async function readLegacyFiles() {
        const files = {};
        for (const path of LEGACY_DATA_FILES) {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), FILE_FETCH_TIMEOUT_MS);
            try {
                const response = await fetch(new URL(`${BACKUP_BASE_PATH}${path}`, window.location.href), {
                    cache: "no-store",
                    signal: controller.signal
                });
                if (!response.ok) throw new Error(`Unable to back up legacy collection file ${path} (HTTP ${response.status}).`);
                files[path] = await response.text();
            } catch (error) {
                if (error.name === "AbortError") {
                    throw new Error(`Timed out after ${FILE_FETCH_TIMEOUT_MS / 1000} seconds backing up ${path}; the original data was left unchanged. Retry the backup.`);
                }
                throw error;
            } finally {
                window.clearTimeout(timeout);
            }
        }
        return files;
    }

    function waitForDocument() {
        if (document.readyState !== "loading") return Promise.resolve();
        return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }

    function downloadBackup() {
        if (!backupPayload) throw new Error("The migration backup has not been prepared.");
        const blob = new Blob([JSON.stringify(backupPayload, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `bpsc-collection-migration-backup-${backupPayload.createdAt.replace(/[:.]/g, "-")}.json`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        return backupPayload;
    }

    async function prepareBackup(automaticDownload) {
        backupError = null;
        backupPayload = null;
        const [indexedDBSnapshot, legacyFiles] = await Promise.all([
            readExistingDatabases(),
            readLegacyFiles()
        ]);
        backupPayload = {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            localStorage: { ...localStorageSnapshot },
            indexedDB: indexedDBSnapshot,
            legacyFiles
        };
        if (automaticDownload && !localStorage.getItem(COMPLETED_KEY)) {
            await waitForDocument();
            downloadBackup();
            localStorage.setItem(COMPLETED_KEY, backupPayload.createdAt);
        }
        return backupPayload;
    }

    function captureBackup(automaticDownload) {
        return prepareBackup(automaticDownload).catch((error) => {
        backupError = error;
        console.error("Unable to create the required collection migration backup.", error);
        throw error;
        });
    }

    let backupReady = captureBackup(true);

    window.quizCollectionMigrationBackup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        ready: backupReady,
        download: () => downloadBackup(),
        retry: () => {
            backupReady = captureBackup(false);
            window.quizCollectionMigrationBackupReady = backupReady;
            window.quizCollectionMigrationBackup.ready = backupReady;
            return backupReady;
        },
        getPayload: () => backupPayload,
        getError: () => backupError
    };
    window.quizCollectionMigrationBackupReady = backupReady;
}());

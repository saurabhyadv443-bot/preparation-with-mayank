(() => {
    "use strict";

    const format = "bpsc-legacy-browser-data-export";
    const version = 1;
    const localStoragePattern = /^(bookmarks|questionClassifications|quizPendingChanges|quizPendingChangeBatches|quiz_attempt_history|quizResult(?:_.+)?|quizResults|quiz_results|test_results|quizProgress(?:_.+)?)$/i;
    const databaseStores = {
        bpscQuizCollectionStore: ["memberships", "metadata", "unresolvedMigration"],
        bpsc_quiz_storage: ["quiz_attempt_history", "quiz_results"],
        bpscQuizPendingChanges: ["state"]
    };
    const readErrors = [];
    const localStorageRecords = {};
    const indexedDBRecords = [];
    const skippedStores = [];

    function tryParse(value, key) {
        try {
            return JSON.parse(value);
        } catch (error) {
            readErrors.push({ source: "localStorage JSON", key, error: String(error) });
            return null;
        }
    }

    function countArrayOrObject(value) {
        if (Array.isArray(value)) return value.length;
        if (value && typeof value === "object") return Object.keys(value).length;
        return value === null || value === undefined ? 0 : 1;
    }

    function localStorageCounts(key, value) {
        const parsed = tryParse(value, key);
        if (key === "bookmarks") {
            return { records: countArrayOrObject(parsed), memberships: { S: Array.isArray(parsed) ? parsed.length : 0 } };
        }
        if (key === "questionClassifications") {
            const memberships = {};
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                Object.values(parsed).forEach((entry) => {
                    if (!entry || typeof entry !== "object") return;
                    Object.keys(entry).forEach((tag) => {
                        const normalized = tag.toUpperCase();
                        if (entry[tag] === true && ["S", "H", "G", "P", "E", "CA"].includes(normalized)) {
                            memberships[normalized] = (memberships[normalized] || 0) + 1;
                        }
                    });
                });
            }
            return { records: countArrayOrObject(parsed), memberships };
        }
        if (key === "quizPendingChanges" || key === "quizPendingChangeBatches") {
            const changes = [];
            if (Array.isArray(parsed)) changes.push(...parsed);
            else if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.changes)) changes.push(...parsed.changes);
                (Array.isArray(parsed.batches) ? parsed.batches : [])
                    .filter((batch) => batch && batch.status !== "synced")
                    .forEach((batch) => changes.push(...(Array.isArray(batch.changes) ? batch.changes : [])));
            }
            const operations = { additions: 0, removals: 0, byTag: {} };
            changes.forEach((change) => {
                if (!change || !["classification", "saved-question"].includes(change.operationType)) return;
                const tag = change.operationType === "saved-question" ? "S" : String(change.tag || "").toUpperCase();
                if (!["S", "H", "G", "P", "E", "CA"].includes(tag)) return;
                if (change.active === false) operations.removals += 1;
                else operations.additions += 1;
                operations.byTag[tag] = (operations.byTag[tag] || 0) + 1;
            });
            return { records: changes.length, membershipOperations: operations };
        }
        return { records: countArrayOrObject(parsed), memberships: {}, note: "Progress, result, and attempt data are not treated as saved memberships." };
    }

    function readLocalStorage() {
        try {
            for (let index = 0; index < localStorage.length; index += 1) {
                let key;
                try {
                    key = localStorage.key(index);
                    if (!key || !localStoragePattern.test(key)) continue;
                    const value = localStorage.getItem(key);
                    localStorageRecords[key] = {
                        rawValue: value,
                        counts: localStorageCounts(key, value)
                    };
                } catch (error) {
                    readErrors.push({ source: "localStorage", key: key || `entry-${index}`, error: String(error) });
                }
            }
        } catch (error) {
            readErrors.push({ source: "localStorage", error: String(error) });
        }
    }

    function requestResult(request, source) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error(`Read failed: ${source}`));
        });
    }

    async function readDatabase(name, version, allowedStores) {
        const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name, version);
            request.onupgradeneeded = () => {
                request.transaction.abort();
                reject(new Error(`Database ${name} changed or disappeared during export; no schema changes were made.`));
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error(`Unable to open ${name} read-only.`));
            request.onblocked = () => reject(new Error(`Database ${name} is blocked by another tab.`));
        });
        const databaseResult = { name, version: database.version, stores: {} };
        try {
            for (const storeName of Array.from(database.objectStoreNames)) {
                if (!allowedStores.includes(storeName)) {
                    skippedStores.push({ database: name, store: storeName, reason: "Store is not on the collection/history export allowlist." });
                    continue;
                }
                try {
                    const transaction = database.transaction(storeName, "readonly");
                    const store = transaction.objectStore(storeName);
                    const [keys, values] = await Promise.all([
                        requestResult(store.getAllKeys(), `${name}/${storeName} keys`),
                        requestResult(store.getAll(), `${name}/${storeName} records`)
                    ]);
                    databaseResult.stores[storeName] = values.map((value, index) => ({ key: keys[index], value }));
                } catch (error) {
                    readErrors.push({ source: `indexedDB:${name}/${storeName}`, error: String(error) });
                }
            }
        } finally {
            database.close();
        }
        return databaseResult;
    }

    function summarizeIndexedDB(databases) {
        const summary = {};
        databases.forEach((database) => {
            const stores = {};
            Object.entries(database.stores).forEach(([storeName, rows]) => {
                stores[storeName] = { records: rows.length };
                if (storeName === "memberships") {
                    stores[storeName].membershipsByTag = {};
                    rows.forEach((row) => {
                        (Array.isArray(row.value?.tags) ? row.value.tags : []).forEach((tag) => {
                            stores[storeName].membershipsByTag[tag] = (stores[storeName].membershipsByTag[tag] || 0) + 1;
                        });
                    });
                }
            });
            summary[database.name] = stores;
        });
        return summary;
    }

    async function exportData() {
        readLocalStorage();
        let databaseList = [];
        try {
            if (!window.indexedDB || typeof indexedDB.databases !== "function") {
                throw new Error("This browser does not support IndexedDB database enumeration; no databases were opened or created.");
            }
            databaseList = await indexedDB.databases();
        } catch (error) {
            readErrors.push({ source: "indexedDB enumeration", error: String(error) });
        }

        const existing = databaseList.filter((database) => database.name && databaseStores[database.name]);
        for (const database of existing) {
            try {
                indexedDBRecords.push(await readDatabase(database.name, database.version, databaseStores[database.name]));
            } catch (error) {
                readErrors.push({ source: `indexedDB:${database.name}`, error: String(error) });
            }
        }

        const createdAt = new Date().toISOString();
        const payload = {
            format,
            version,
            createdAt,
            origin: window.location.origin,
            report: {
                localStorage: Object.fromEntries(Object.entries(localStorageRecords).map(([key, record]) => [key, record.counts])),
                indexedDB: summarizeIndexedDB(indexedDBRecords),
                skippedStores,
                readErrors
            },
            localStorage: Object.fromEntries(Object.entries(localStorageRecords).map(([key, record]) => [key, record.rawValue])),
            indexedDB: indexedDBRecords
        };

        const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const panel = document.createElement("section");
        panel.setAttribute("aria-label", "Read-only legacy data export");
        panel.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:min(520px,calc(100vw - 32px));padding:16px;background:#fff;color:#111;border:2px solid #333;border-radius:8px;box-shadow:0 4px 18px #0004;font:14px/1.45 sans-serif";
        const summary = document.createElement("p");
        summary.textContent = `Read-only export ready for ${payload.origin}. Local storage keys: ${Object.keys(localStorageRecords).length}; IndexedDB databases: ${indexedDBRecords.length}; read errors: ${readErrors.length}.`;
        const link = document.createElement("a");
        link.href = url;
        link.download = `bpsc-legacy-browser-export-${createdAt.replace(/[:.]/g, "-")}.json`;
        link.textContent = "Download legacy browser data export";
        link.style.cssText = "display:inline-block;padding:10px 14px;background:#174ea6;color:#fff;border-radius:4px;text-decoration:none;font-weight:600";
        link.addEventListener("click", () => window.setTimeout(() => URL.revokeObjectURL(url), 60000), { once: true });
        panel.append(summary, link);
        document.body.appendChild(panel);
        console.info("Read-only legacy browser export report", payload.report);
        return payload;
    }

    exportData().catch((error) => {
        console.error("Legacy browser export failed.", error);
    });
})();

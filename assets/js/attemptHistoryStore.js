(function () {
    const DB_NAME = "bpsc_quiz_storage";
    const DB_VERSION = 1;
    const STORE_NAME = "quiz_attempt_history";
    const RESULT_STORE_NAME = "quiz_results";
    const HISTORY_KEY = "quiz_attempt_history";

    let cachedHistory = readLocalHistory();
    const cachedResults = {};

    function readLocalHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
        } catch (error) {
            return {};
        }
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error("IndexedDB is unavailable"));
                return;
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
                if (!database.objectStoreNames.contains(RESULT_STORE_NAME)) {
                    database.createObjectStore(RESULT_STORE_NAME, { keyPath: "key" });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
        });
    }

    function requestAsPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
        });
    }

    function transactionComplete(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
            transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
        });
    }

    function historyToRecords(history) {
        return Object.entries(history || {}).flatMap(([quizId, attempts]) =>
            Array.isArray(attempts) ? attempts.map((attempt) => ({
                ...attempt,
                quizId: attempt.quizId || quizId,
                id: `${quizId}::${attempt.attempt}`
            })) : []
        );
    }

    function recordsToHistory(records) {
        return records.reduce((history, record) => {
            const quizId = record.quizId;
            if (!quizId) return history;
            const { id, ...attempt } = record;
            (history[quizId] ||= []).push(attempt);
            return history;
        }, {});
    }

    async function migrate(database) {
        const localHistory = readLocalHistory();
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const completed = transactionComplete(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const existingRecords = await requestAsPromise(store.getAll());
        const existingIds = new Set(existingRecords.map((record) => record.id));
        historyToRecords(localHistory).forEach((record) => {
            if (!existingIds.has(record.id)) store.put(record);
        });
        await completed;
        const migratedRecords = [...existingRecords, ...historyToRecords(localHistory).filter((record) => !existingIds.has(record.id))];
        cachedHistory = recordsToHistory(migratedRecords);
        if (Object.keys(localHistory).length) localStorage.removeItem(HISTORY_KEY);
        const resultTransaction = database.transaction(RESULT_STORE_NAME, "readwrite");
        const resultCompleted = transactionComplete(resultTransaction);
        const resultStore = resultTransaction.objectStore(RESULT_STORE_NAME);
        const existingResults = await requestAsPromise(resultStore.getAll());
        const migratedResultKeys = [];
        ["quizResult", "quizResult_study"].forEach((key) => {
            const raw = localStorage.getItem(key);
            if (!existingResults.some((item) => item.key === key) && raw) {
                try { resultStore.put({ key, value: JSON.parse(raw) }); migratedResultKeys.push(key); } catch (error) { }
            }
        });
        await resultCompleted;
        migratedResultKeys.forEach((key) => localStorage.removeItem(key));
        existingResults.forEach((record) => localStorage.removeItem(record.key));
    }

    const ready = openDatabase().then(migrate).catch(() => null);

    async function getHistory() {
        await ready;
        if (!window.indexedDB) return cachedHistory;
        try {
            const database = await openDatabase();
            const records = await requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll());
            cachedHistory = recordsToHistory(records);
        } catch (error) {
            return cachedHistory;
        }
        return cachedHistory;
    }

    async function putAttempt(quizId, attempt) {
        await ready;
        const record = { ...attempt, quizId, id: `${quizId}::${attempt.attempt}` };
        if (window.indexedDB) {
            try {
                const database = await openDatabase();
                const transaction = database.transaction(STORE_NAME, "readwrite");
                const completed = transactionComplete(transaction);
                transaction.objectStore(STORE_NAME).put(record);
                await completed;
                cachedHistory = recordsToHistory(await requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()));
                return;
            } catch (error) {
            }
        }
        const history = { ...cachedHistory, [quizId]: [...(cachedHistory[quizId] || []).filter((item) => item.attempt !== attempt.attempt), attempt] };
        const serialized = JSON.stringify(history);
        if (serialized.length <= 3500000) {
            localStorage.setItem(HISTORY_KEY, serialized);
            cachedHistory = history;
        }
    }

    async function updateAttempt(quizId, attemptNumber, changes) {
        await ready;
        if (window.indexedDB) {
            try {
                const database = await openDatabase();
                const transaction = database.transaction(STORE_NAME, "readwrite");
                const completed = transactionComplete(transaction);
                const store = transaction.objectStore(STORE_NAME);
                const current = await requestAsPromise(store.get(`${quizId}::${attemptNumber}`));
                if (current) {
                    store.put({ ...current, ...changes });
                    await completed;
                    cachedHistory = recordsToHistory(await requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()));
                    return;
                }
            } catch (error) {
            }
        }
        const records = Array.isArray(cachedHistory[quizId]) ? cachedHistory[quizId] : [];
        const index = records.findIndex((item) => item.attempt === attemptNumber);
        if (index < 0) return;
        const history = { ...cachedHistory, [quizId]: records.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) };
        const serialized = JSON.stringify(history);
        if (serialized.length <= 3500000) {
            localStorage.setItem(HISTORY_KEY, serialized);
            cachedHistory = history;
        }
    }

    async function deleteAttempt(quizId, attemptNumber) {
        await ready;
        const attemptId = `${quizId}::${attemptNumber}`;
        if (window.indexedDB) {
            const database = await openDatabase();
            const existingRecord = await requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(attemptId));
            if (!existingRecord) {
                throw new Error("Attempt was not found.");
            }
            const transaction = database.transaction(STORE_NAME, "readwrite");
            const completed = transactionComplete(transaction);
            transaction.objectStore(STORE_NAME).delete(attemptId);
            await completed;
            cachedHistory = recordsToHistory(await requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()));
            return;
        }

        const records = Array.isArray(cachedHistory[quizId]) ? cachedHistory[quizId] : [];
        const remainingRecords = records.filter((item) => item.attempt !== attemptNumber);
        if (remainingRecords.length === records.length) {
            throw new Error("Attempt was not found.");
        }
        const history = { ...cachedHistory, [quizId]: remainingRecords };
        const serialized = JSON.stringify(history);
        if (serialized.length > 3500000) {
            throw new Error("Unable to save attempt history.");
        }
        localStorage.setItem(HISTORY_KEY, serialized);
        cachedHistory = history;
    }

    async function getResult(key) {
        if (Object.prototype.hasOwnProperty.call(cachedResults, key)) return cachedResults[key];
        const localValue = (() => {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (error) {
                return null;
            }
        })();
        cachedResults[key] = localValue;
        await ready;
        if (!window.indexedDB) return cachedResults[key];
        try {
            const database = await openDatabase();
            const record = await requestAsPromise(database.transaction(RESULT_STORE_NAME, "readonly").objectStore(RESULT_STORE_NAME).get(key));
            if (record) cachedResults[key] = record.value;
        } catch (error) {
            return cachedResults[key];
        }
        return cachedResults[key];
    }

    async function putResult(key, value) {
        cachedResults[key] = value;
        await ready;
        if (window.indexedDB) {
            try {
                const database = await openDatabase();
                const transaction = database.transaction(RESULT_STORE_NAME, "readwrite");
                const completed = transactionComplete(transaction);
                transaction.objectStore(RESULT_STORE_NAME).put({ key, value });
                await completed;
                localStorage.removeItem(key);
                return;
            } catch (error) {
            }
        }
        const serialized = JSON.stringify(value);
        if (serialized.length <= 3500000) localStorage.setItem(key, serialized);
    }

    window.quizAttemptHistoryStore = { ready, getHistory, getHistorySync: () => cachedHistory, putAttempt, updateAttempt, deleteAttempt, getResult, putResult };
}());
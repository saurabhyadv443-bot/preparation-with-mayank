/**
 * Shared utility functions used across the quiz portal.
 * Consolidated to reduce code duplication while maintaining existing behavior.
 */

/**
 * Escapes HTML special characters to prevent XSS.
 * Converts: & < > " '
 * Used throughout the portal for safe HTML rendering.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const QUIZ_JSON_CACHE = new Map();

function loadJson(url, options = {}) {
    const cacheKey = String(url);
    const cached = QUIZ_JSON_CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }

    const pending = fetch(cacheKey, options)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Unable to load JSON: ${cacheKey}`);
            }
            return response.json();
        })
        .catch((error) => {
            QUIZ_JSON_CACHE.delete(cacheKey);
            throw error;
        });

    QUIZ_JSON_CACHE.set(cacheKey, pending);
    return pending;
}

const TEXT_SELECTION_PREFERENCE_KEY = "portalTextSelectionLocked";

function setTextSelectionPreference(locked) {
    document.body.classList.toggle("text-selection-locked", locked);
    const toggle = document.getElementById("textSelectionToggle");
    if (toggle) {
        toggle.setAttribute("aria-pressed", String(locked));
        toggle.setAttribute("aria-label", locked ? "Turn off text selection lock" : "Turn on text selection lock");
        toggle.textContent = locked ? "Selection: On" : "Selection: Off";
        toggle.classList.toggle("is-active", locked);
    }
}

function initializeTextSelectionPreference() {
    const locked = localStorage.getItem(TEXT_SELECTION_PREFERENCE_KEY) === "true";
    setTextSelectionPreference(locked);
    const toggle = document.getElementById("textSelectionToggle");
    toggle?.addEventListener("click", () => {
        const nextValue = !document.body.classList.contains("text-selection-locked");
        localStorage.setItem(TEXT_SELECTION_PREFERENCE_KEY, String(nextValue));
        setTextSelectionPreference(nextValue);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeTextSelectionPreference, { once: true });
} else {
    initializeTextSelectionPreference();
}

/**
 * Formats seconds into MM:SS format.
 * Used for timer display across quiz, practice, and collection modes.
 * Pads with zeros to ensure consistent two-digit format.
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// Set this only after a real HTTPS production backend is provisioned.
const QUIZ_API_BASE_URL = "";
const quizApiOrigin = window.location.hostname === "127.0.0.1"
    ? (window.location.port === "8000" ? "" : "http://127.0.0.1:8000")
    : QUIZ_API_BASE_URL.replace(/\/$/, "") || null;
function quizApiUrl(path) {
    if (!quizApiOrigin) return null;
    return `${quizApiOrigin}/${String(path).replace(/^\//, "")}`;
}
function quizApiUnavailableMessage() {
    return "Permanent save features require the online backend and are currently unavailable.";
}

const QUIZ_PENDING_CHANGES_KEY = "quizPendingChanges";
const QUIZ_PENDING_BATCHES_KEY = "quizPendingChangeBatches";
const QUIZ_PENDING_BATCHES_VERSION = 1;
const QUIZ_PENDING_BATCH_HISTORY_LIMIT = 5;
const QUIZ_PENDING_DB_NAME = "bpscQuizPendingChanges";
const QUIZ_PENDING_DB_VERSION = 1;
const QUIZ_PENDING_DB_STORE = "state";
const QUIZ_PENDING_DB_RECORD = "pending";
let quizPendingStateCache = null;
let quizPendingStoragePromise = null;
let quizPendingStorageReady = false;
let quizPendingStateRevision = 0;
const QUIZ_PENDING_SOURCE_FILES = {
    ancient: "ancient.json",
    medieval: "medeival.json",
    modern: "modern.json",
    geography: "geography.json",
    polity: "polity.json",
    economy: "economy.json",
    mock: "mock.json",
    current_affairs: "current_affairs.json"
};

function quizPendingSourceFile(subjectKey) {
    return QUIZ_PENDING_SOURCE_FILES[String(subjectKey || "")] || `${subjectKey}.json`;
}

function quizPendingFingerprint(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return { algorithm: "fnv1a32", value: (hash >>> 0).toString(16), snapshot: text.slice(0, 240) };
}

function quizPendingReadJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch (error) {
        return fallback;
    }
}

function quizPendingOperationKey(change) {
    return change.operationKey || `${change.operationType}::${change.field || change.tag || ""}::${quizPendingIdentity(change)}`;
}

function quizPendingCreateState(changes, batches = []) {
    return {
        version: QUIZ_PENDING_BATCHES_VERSION,
        nextBatchId: 1,
        nextChangeId: changes.length + 1,
        changes,
        batches
    };
}

function quizPendingReadLegacyState() {
    const stored = quizPendingReadJson(QUIZ_PENDING_BATCHES_KEY, null);
    if (stored && stored.version === QUIZ_PENDING_BATCHES_VERSION && Array.isArray(stored.changes) && Array.isArray(stored.batches)) {
        return {
            version: QUIZ_PENDING_BATCHES_VERSION,
            nextBatchId: Number(stored.nextBatchId) || 1,
            nextChangeId: Number(stored.nextChangeId) || stored.changes.length + 1,
            changes: stored.changes,
            batches: stored.batches
        };
    }
    const legacy = quizPendingReadJson(QUIZ_PENDING_CHANGES_KEY, []);
    const changes = (Array.isArray(legacy) ? legacy : []).map((change, index) => quizPendingNormalizeChange(change, index, index + 1));
    return quizPendingCreateState(changes);
}

function quizPendingAddMissingUnsyncedChanges(state) {
    const knownKeys = new Set(state.changes.map((change) => quizPendingOperationKey(change)));
    state.batches.filter((batch) => batch.status !== "synced").forEach((batch) => {
        (Array.isArray(batch.changes) ? batch.changes : []).forEach((change) => {
            const operationKey = quizPendingOperationKey(change);
            if (knownKeys.has(operationKey)) return;
            state.changes.push({ ...change });
            knownKeys.add(operationKey);
        });
    });
    return state;
}

function quizPendingChangeRecency(change) {
    const timestamp = Date.parse(change.timestamp || "");
    const pendingChangeId = String(change.pendingChangeId || "");
    const numericParts = pendingChangeId.match(/(?:change|legacy)-(?:(\d+).*)?$/);
    return {
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        sequence: numericParts && numericParts[1] ? Number(numericParts[1]) : null
    };
}

function quizPendingIsNewerChange(candidate, current) {
    const candidateRecency = quizPendingChangeRecency(candidate);
    const currentRecency = quizPendingChangeRecency(current);
    if (candidateRecency.timestamp !== null || currentRecency.timestamp !== null) {
        if (candidateRecency.timestamp === null) return false;
        if (currentRecency.timestamp === null) return true;
        if (candidateRecency.timestamp !== currentRecency.timestamp) return candidateRecency.timestamp > currentRecency.timestamp;
    }
    if (candidateRecency.sequence !== null || currentRecency.sequence !== null) {
        if (candidateRecency.sequence === null) return false;
        if (currentRecency.sequence === null) return true;
        if (candidateRecency.sequence !== currentRecency.sequence) return candidateRecency.sequence > currentRecency.sequence;
    }
    return true;
}

function quizPendingMergeStates(primary, secondary) {
    const mergedChanges = new Map();
    [...primary.changes, ...secondary.changes].forEach((change) => {
        const key = quizPendingOperationKey(change);
        const existing = mergedChanges.get(key);
        if (!existing || quizPendingIsNewerChange(change, existing)) mergedChanges.set(key, { ...change });
    });
    const batches = new Map();
    [...primary.batches, ...secondary.batches].forEach((batch) => batches.set(Number(batch.batchId), { ...batch }));
    return {
        version: QUIZ_PENDING_BATCHES_VERSION,
        nextBatchId: Math.max(Number(primary.nextBatchId) || 1, Number(secondary.nextBatchId) || 1),
        nextChangeId: Math.max(Number(primary.nextChangeId) || 1, Number(secondary.nextChangeId) || 1),
        changes: [...mergedChanges.values()],
        batches: [...batches.values()]
    };
}

function quizPendingCompactState(state) {
    const latestChanges = new Map();
    state.changes.forEach((change) => latestChanges.set(quizPendingOperationKey(change), change));
    state.changes = [...latestChanges.values()];
    const latestChangeIds = new Map(state.changes.map((change) => [quizPendingOperationKey(change), change.pendingChangeId]));
    state.batches = state.batches
        .map((batch) => {
            if (batch.status === "synced") return batch;
            const changes = (Array.isArray(batch.changes) ? batch.changes : [])
                .filter((change) => latestChangeIds.get(quizPendingOperationKey(change)) === change.pendingChangeId);
            return { ...batch, changes };
        })
        .filter((batch) => batch.status === "synced" || batch.changes.length);
    return state;
}

function quizPendingStateHasChanges(state, expectedState) {
    const actualChanges = new Map(state.changes.map((change) => [quizPendingOperationKey(change), change]));
    return expectedState.changes.every((expectedChange) => {
        const actualChange = actualChanges.get(quizPendingOperationKey(expectedChange));
        return actualChange && (actualChange.pendingChangeId === expectedChange.pendingChangeId || quizPendingIsNewerChange(actualChange, expectedChange));
    });
}

function quizPendingOpenDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(QUIZ_PENDING_DB_NAME, QUIZ_PENDING_DB_VERSION);
        request.onupgradeneeded = () => request.result.createObjectStore(QUIZ_PENDING_DB_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Unable to open pending changes database."));
        request.onblocked = () => reject(new Error("Pending changes database is blocked."));
    });
}

function quizPendingReadDatabase(database) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(QUIZ_PENDING_DB_STORE, "readonly");
        const request = transaction.objectStore(QUIZ_PENDING_DB_STORE).get(QUIZ_PENDING_DB_RECORD);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Unable to read pending changes database."));
    });
}

function quizPendingWriteDatabase(database, state) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(QUIZ_PENDING_DB_STORE, "readwrite");
        transaction.objectStore(QUIZ_PENDING_DB_STORE).put(state, QUIZ_PENDING_DB_RECORD);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Unable to write pending changes database."));
        transaction.onabort = () => reject(transaction.error || new Error("Pending changes database write was aborted."));
    });
}

function quizPendingMergeAndWriteDatabase(database, state) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(QUIZ_PENDING_DB_STORE, "readwrite");
        const store = transaction.objectStore(QUIZ_PENDING_DB_STORE);
        const readRequest = store.get(QUIZ_PENDING_DB_RECORD);
        let finalState = state;
        readRequest.onsuccess = () => {
            const currentState = readRequest.result;
            if (currentState && currentState.version === QUIZ_PENDING_BATCHES_VERSION) {
                finalState = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(quizPendingMergeStates(currentState, state)));
            }
            store.put(finalState, QUIZ_PENDING_DB_RECORD);
        };
        readRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve(finalState);
        transaction.onerror = () => reject(transaction.error || new Error("Unable to merge pending changes database state."));
        transaction.onabort = () => reject(transaction.error || new Error("Pending changes database merge was aborted."));
    });
}

function quizPendingRestoreLegacyStorage(state) {
    let previousBatches = null;
    let previousChanges = null;
    try {
        previousBatches = localStorage.getItem(QUIZ_PENDING_BATCHES_KEY);
        previousChanges = localStorage.getItem(QUIZ_PENDING_CHANGES_KEY);
        localStorage.setItem(QUIZ_PENDING_BATCHES_KEY, JSON.stringify(state));
        localStorage.setItem(QUIZ_PENDING_CHANGES_KEY, JSON.stringify(state.changes));
        return true;
    } catch (error) {
        try {
            if (previousBatches === null) localStorage.removeItem(QUIZ_PENDING_BATCHES_KEY);
            else localStorage.setItem(QUIZ_PENDING_BATCHES_KEY, previousBatches);
            if (previousChanges === null) localStorage.removeItem(QUIZ_PENDING_CHANGES_KEY);
            else localStorage.setItem(QUIZ_PENDING_CHANGES_KEY, previousChanges);
        } catch (restoreError) {
            console.warn("Unable to restore the previous localStorage pending-change state.", restoreError);
        }
        console.warn("Unable to preserve a localStorage fallback for pending quiz changes.", error);
        return false;
    }
}

function quizPendingRemoveLegacyStorage(state) {
    const batches = localStorage.getItem(QUIZ_PENDING_BATCHES_KEY);
    const changes = localStorage.getItem(QUIZ_PENDING_CHANGES_KEY);
    try {
        localStorage.removeItem(QUIZ_PENDING_BATCHES_KEY);
        localStorage.removeItem(QUIZ_PENDING_CHANGES_KEY);
    } catch (error) {
        if (batches !== null) localStorage.setItem(QUIZ_PENDING_BATCHES_KEY, batches);
        if (changes !== null) localStorage.setItem(QUIZ_PENDING_CHANGES_KEY, changes);
        throw error;
    }
}

async function quizPendingInitializeStorage() {
    const legacyState = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(quizPendingReadLegacyState()));
    const startingRevision = quizPendingStateRevision;
    let database;
    try {
        database = await quizPendingOpenDatabase();
        const storedState = await quizPendingReadDatabase(database);
        let state = storedState && storedState.version === QUIZ_PENDING_BATCHES_VERSION
            ? quizPendingMergeStates(storedState, legacyState)
            : legacyState;
        if (quizPendingStateRevision !== startingRevision) {
            state = quizPendingStateCache;
        }
        state = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(state));
        const latestBeforeWrite = await quizPendingReadDatabase(database);
        if (latestBeforeWrite && latestBeforeWrite.version === QUIZ_PENDING_BATCHES_VERSION) {
            state = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(quizPendingMergeStates(latestBeforeWrite, state)));
        }
        await quizPendingMergeAndWriteDatabase(database, state);
        const verifiedState = await quizPendingReadDatabase(database);
        if (!verifiedState || !quizPendingStateHasChanges(verifiedState, state)) throw new Error("Pending changes database verification failed.");
        quizPendingStateCache = verifiedState;
        quizPendingStorageReady = true;
        quizPendingRemoveLegacyStorage(verifiedState);
    } catch (error) {
        quizPendingStorageReady = false;
        const fallbackState = quizPendingStateCache || legacyState;
        quizPendingStateCache = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(fallbackState));
        quizPendingRestoreLegacyStorage(quizPendingStateCache);
        console.warn("Using localStorage fallback for pending quiz changes.", error);
    } finally {
        if (database) database.close();
    }
    return quizPendingStateCache;
}

function quizPendingPersistState(state, revision) {
    const snapshot = JSON.parse(JSON.stringify(state));
    if (!quizPendingStoragePromise) quizPendingStoragePromise = quizPendingInitializeStorage();
    quizPendingStoragePromise = quizPendingStoragePromise.then(async () => {
        if (!quizPendingStorageReady) return;
        const database = await quizPendingOpenDatabase();
        try {
            await quizPendingWriteDatabase(database, snapshot);
        } finally {
            database.close();
        }
    }).catch((error) => {
        quizPendingStorageReady = false;
        const fallbackState = revision === quizPendingStateRevision ? snapshot : quizPendingStateCache;
        quizPendingRestoreLegacyStorage(fallbackState);
        console.warn("Unable to persist pending quiz changes in IndexedDB; localStorage fallback retained.", error);
    });
}

function quizPendingWriteState(state) {
    const compactedState = quizPendingCompactState(state);
    quizPendingStateCache = compactedState;
    quizPendingStateRevision += 1;
    if (quizPendingStorageReady) quizPendingPersistState(compactedState, quizPendingStateRevision);
    else quizPendingRestoreLegacyStorage(compactedState);
}

function quizPendingNormalizeChange(change, index, nextChangeId) {
    const normalized = { ...change };
    if (!normalized.pendingChangeId) normalized.pendingChangeId = `legacy-${Date.now()}-${index}-${nextChangeId}`;
    normalized.operationKey = quizPendingOperationKey(normalized);
    return normalized;
}

function quizPendingReadState() {
    if (quizPendingStateCache) return quizPendingStateCache;
    const state = quizPendingCompactState(quizPendingAddMissingUnsyncedChanges(quizPendingReadLegacyState()));
    quizPendingStateCache = state;
    if (!quizPendingStoragePromise) quizPendingStoragePromise = quizPendingInitializeStorage();
    return state;
}

window.addEventListener("storage", (event) => {
    if (!quizPendingStorageReady && (event.key === QUIZ_PENDING_BATCHES_KEY || event.key === QUIZ_PENDING_CHANGES_KEY)) {
        quizPendingStateCache = null;
    }
});

function getQuizPendingChanges() {
    return quizPendingReadState().changes;
}

function quizPendingIdentity(change) {
    return [change.sourceSubjectKey, change.chapter, change.questionIndex].join("::");
}

function queueQuizPendingChange(change) {
    const state = quizPendingReadState();
    const changes = state.changes;
    const normalized = {
        ...change,
        sourceJsonFile: change.sourceJsonFile || quizPendingSourceFile(change.sourceSubjectKey),
        timestamp: change.timestamp || new Date().toISOString(),
        active: change.active !== false
    };
    const operationKey = quizPendingOperationKey(normalized);
    const existingIndex = changes.findIndex((item) => item.operationKey === operationKey);
    normalized.operationKey = operationKey;
    const existing = existingIndex >= 0 ? changes[existingIndex] : null;
    normalized.pendingChangeId = existing && !existing.downloadedBatchId
        ? existing.pendingChangeId
        : `change-${state.nextChangeId++}`;
    delete normalized.downloadedBatchId;
    if (existingIndex >= 0) changes[existingIndex] = normalized;
    else changes.push(normalized);
    state.changes = changes;
    quizPendingWriteState(state);
    return normalized;
}

function quizPendingQuestionSource(question, sourceSubjectKey, chapter, questionIndex) {
    const source = question?._source || question?.source || {};
    const id = question?.id ?? question?.qid ?? question?.questionId ?? question?._id ?? question?.questionID ?? question?.question_id ?? null;
    return {
        sourceSubjectKey: source.sourceSubjectKey || question?._pyqSubjectKey || sourceSubjectKey,
        sourceJsonFile: quizPendingSourceFile(source.sourceSubjectKey || question?._pyqSubjectKey || sourceSubjectKey),
        chapter: source.chapter || question?._pyqChapter || chapter || "",
        questionIndex: source.questionIndex ?? question?._pyqQuestionIndex ?? questionIndex,
        questionId: source.questionId ?? question?._pyqQuestionId ?? id,
        questionFingerprint: quizPendingFingerprint(question?.q || question?.question || question?.questionText || question?.prompt || "")
    };
}

function getQuizPendingQuestionChanges(source) {
    const identity = quizPendingIdentity(source);
    return getQuizPendingChanges().filter((change) => quizPendingIdentity(change) === identity);
}

function applyQuizPendingChanges(question, source) {
    const changes = getQuizPendingQuestionChanges(source);
    changes.forEach((change) => {
        if (change.operationType === "edit-question" && change.active !== false) question[change.field] = change.value;
    });
    return changes;
}

function applyQuizPendingMetadata(question, source) {
    getQuizPendingQuestionChanges(source).forEach((change) => {
        if (change.active === false) {
            if (change.operationType === "saved-question" && question.quizMeta) delete question.quizMeta.saved;
            if (change.operationType === "classification" && question.quizMeta?.classifications) delete question.quizMeta.classifications[change.tag];
            return;
        }
        question.quizMeta = { ...(question.quizMeta || {}) };
        if (change.operationType === "saved-question") question.quizMeta.saved = true;
        if (change.operationType === "classification") question.quizMeta.classifications = { ...(question.quizMeta.classifications || {}), [change.tag]: true };
    });
    if (question.quizMeta?.classifications && !Object.keys(question.quizMeta.classifications).length) delete question.quizMeta.classifications;
    if (question.quizMeta && !Object.keys(question.quizMeta).length) delete question.quizMeta;
    return question;
}

function isQuizPendingActive(source, operationType, fieldOrTag) {
    const changes = getQuizPendingQuestionChanges(source).filter((change) => change.operationType === operationType && (change.field || change.tag || "") === (fieldOrTag || ""));
    return changes.length ? changes[changes.length - 1].active !== false : false;
}

function quizPendingDownloadPayload(changes, successMessage) {
    if (!changes.length) {
        window.alert("No pending changes to download.");
        return false;
    }
    const blob = new Blob([JSON.stringify(changes, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quiz_pending_changes.json";
    link.click();
    URL.revokeObjectURL(url);
    if (successMessage) window.alert(successMessage);
    return true;
}

function quizPendingPruneCompletedBatches(state) {
    const completed = state.batches
        .filter((batch) => batch.status === "synced")
        .sort((left, right) => new Date(right.syncedAt || right.downloadedAt).getTime() - new Date(left.syncedAt || left.downloadedAt).getTime());
    const retained = new Set(completed.slice(0, QUIZ_PENDING_BATCH_HISTORY_LIMIT).map((batch) => batch.batchId));
    state.batches = state.batches.filter((batch) => batch.status !== "synced" || retained.has(batch.batchId));
}

function exportQuizPendingChanges() {
    const state = quizPendingReadState();
    const changes = state.changes.filter((change) => !change.downloadedBatchId);
    if (!changes.length) {
        window.alert("No pending changes to download.");
        return false;
    }
    const batchId = state.nextBatchId++;
    if (!quizPendingDownloadPayload(changes, null)) return false;
    const downloadedAt = new Date().toISOString();
    const batchChanges = changes.map((change) => ({ ...change }));
    changes.forEach((change) => { change.downloadedBatchId = batchId; });
    state.batches.push({ batchId, downloadedAt, status: "downloaded", changes: batchChanges });
    quizPendingWriteState(state);
    window.alert("All pending changes downloaded successfully.");
    window.dispatchEvent(new CustomEvent("quizPendingBatchesChanged"));
    return true;
}

function exportQuizPendingBatch(batchId) {
    const state = quizPendingReadState();
    const batch = state.batches.find((item) => item.batchId === Number(batchId));
    if (!batch || !Array.isArray(batch.changes) || !batch.changes.length) return false;
    return quizPendingDownloadPayload(batch.changes, "Pending change batch downloaded successfully.");
}

function markQuizPendingBatchSynced(batchId) {
    const state = quizPendingReadState();
    const batch = state.batches.find((item) => item.batchId === Number(batchId));
    if (!batch || batch.status === "synced") return false;
    batch.status = "synced";
    batch.syncedAt = new Date().toISOString();
    const changeIds = new Set(batch.changes.map((change) => change.pendingChangeId));
    state.changes = state.changes.filter((change) => !changeIds.has(change.pendingChangeId));
    quizPendingPruneCompletedBatches(state);
    quizPendingWriteState(state);
    window.dispatchEvent(new CustomEvent("quizPendingBatchesChanged"));
    return true;
}

function getQuizPendingBatches() {
    return quizPendingReadState().batches;
}


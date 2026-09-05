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

function quizPendingWriteState(state) {
    localStorage.setItem(QUIZ_PENDING_BATCHES_KEY, JSON.stringify(state));
    localStorage.setItem(QUIZ_PENDING_CHANGES_KEY, JSON.stringify(state.changes));
}

function quizPendingNormalizeChange(change, index, nextChangeId) {
    const normalized = { ...change };
    if (!normalized.pendingChangeId) normalized.pendingChangeId = `legacy-${Date.now()}-${index}-${nextChangeId}`;
    return normalized;
}

function quizPendingReadState() {
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
    const state = {
        version: QUIZ_PENDING_BATCHES_VERSION,
        nextBatchId: 1,
        nextChangeId: changes.length + 1,
        changes,
        batches: []
    };
    quizPendingWriteState(state);
    return state;
}

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
    const operationKey = `${normalized.operationType}::${normalized.field || normalized.tag || ""}::${quizPendingIdentity(normalized)}`;
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


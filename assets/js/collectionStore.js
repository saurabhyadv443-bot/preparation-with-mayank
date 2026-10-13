(function () {
    "use strict";

    const DATABASE_NAME = String(window.QUIZ_COLLECTIONS_DATABASE_NAME || "bpscQuizCollectionStore");
    const DATABASE_VERSION = 2;
    const MEMBERSHIP_STORE = "memberships";
    const META_STORE = "metadata";
    const UNRESOLVED_STORE = "unresolvedMigration";
    const HISTORY_DATABASE_NAME = String(window.QUIZ_COLLECTIONS_HISTORY_DATABASE_NAME || "bpsc_quiz_storage");
    const PENDING_DATABASE_NAME = String(window.QUIZ_COLLECTIONS_PENDING_DATABASE_NAME || "bpscQuizPendingChanges");
    const MIGRATION_KEY = "legacy-migration-v2";
    const AUTOMATIC_MIGRATION_TAGS = Object.freeze(["S", "H", "G", "P", "CA"]);
    const TAG_LABELS = Object.freeze({
        S: "Saved Questions",
        P: "Important Polity Questions",
        G: "Important Geography Questions",
        H: "Important History Questions",
        E: "Important Economy Questions",
        CA: "Important Current Affairs Questions"
    });
    const SOURCE_FILES = Object.freeze({
        ancient: "ancient.json",
        medieval: "medeival.json",
        medeival: "medeival.json",
        modern: "modern.json",
        geography: "geography.json",
        polity: "polity.json",
        economy: "economy.json",
        current_affairs: "current_affairs.json",
        mock: "mock.json"
    });
    const LEGACY_DATA_FILES = Object.freeze(window.QUIZ_COLLECTIONS_LEGACY_DATA_FILES || [
        "ancient.json",
        "medeival.json",
        "modern.json",
        "geography.json",
        "polity.json",
        "economy.json",
        "mock.json",
        "sectional.json",
        "current_affairs.json"
    ]);

    const records = new Map();
    const recordWriteQueues = new Map();
    const unresolvedRecords = new Map();
    let database = null;
    let durable = false;
    let unavailableReason = "";
    let databasePromise = null;
    let writeQueue = Promise.resolve();
    let migrationReport = null;
    let migrationFailure = "";
    let ready = Promise.resolve();

    function validTag(tag) {
        return Object.prototype.hasOwnProperty.call(TAG_LABELS, tag);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function safeReadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            console.warn(`Unable to read legacy ${key} collection data.`, error);
            return fallback;
        }
    }

    function questionFingerprint(question) {
        const content = JSON.stringify({
            q: question?.q ?? question?.question ?? question?.questionText ?? question?.prompt ?? "",
            options: Array.isArray(question?.options) ? question.options : [],
            answer: question?.answer ?? null,
            image: question?.image ?? question?.imageUrl ?? question?.image_url ?? null
        });
        let hash = 2166136261;
        for (let index = 0; index < content.length; index += 1) {
            hash ^= content.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    function normalizeSource(question, context = {}) {
        const source = question?._collectionSource || question?._source || question?.source || {};
        const sourceSubjectKey = String(
            source.sourceSubjectKey
            || question?._pyqSubjectKey
            || context.sourceSubjectKey
            || context.subjectKey
            || context.subject
            || ""
        ).trim().toLowerCase();
        const chapter = String(source.chapter || question?._pyqChapter || context.chapter || "").trim();
        const questionIndexValue = source.questionIndex ?? question?._pyqQuestionIndex ?? context.questionIndex;
        const questionIndex = Number.isInteger(Number(questionIndexValue)) && questionIndexValue !== null && questionIndexValue !== ""
            ? Number(questionIndexValue)
            : null;
        const stableQuestionIndex = source.questionIndex ?? question?._pyqQuestionIndex ?? null;
        const questionId = source.questionId
            ?? question?._pyqQuestionId
            ?? context.questionId
            ?? question?.id
            ?? question?.qid
            ?? question?.questionId
            ?? question?._id
            ?? question?.questionID
            ?? question?.question_id
            ?? null;
        let sourceJsonFile = String(source.sourceJsonFile || context.sourceJsonFile || "").trim();
        if (!/^[A-Za-z0-9_-]+\.json$/i.test(sourceJsonFile)) {
            const normalizedFileSubject = sourceSubjectKey.replace(/_history$/, "") || "unknown";
            sourceJsonFile = normalizedFileSubject === "mock" && context.source === "sectional"
                ? "sectional.json"
                : (SOURCE_FILES[normalizedFileSubject] || `${normalizedFileSubject}.json`);
        }
        const fingerprint = questionFingerprint(question);
        const identityPart = questionId !== null && questionId !== ""
            ? `id:${String(questionId)}`
            : (questionIndex !== null ? `index:${questionIndex}` : `content:${fingerprint}`);
        const duplicatePart = questionId !== null && questionId !== "" && stableQuestionIndex !== null
            ? `index:${stableQuestionIndex}`
            : "";
        const id = JSON.stringify([
            sourceJsonFile.toLowerCase(),
            sourceSubjectKey,
            chapter,
            identityPart,
            duplicatePart,
            fingerprint
        ]);
        return {
            id,
            source: {
                sourceJsonFile,
                sourceSubjectKey,
                chapter,
                questionIndex,
                questionId: questionId === null || questionId === "" ? null : String(questionId),
                questionFingerprint: fingerprint
            }
        };
    }

    function canResolveFromSource(source) {
        return Boolean(
            source.sourceSubjectKey
            && source.chapter
            && source.sourceJsonFile
            && source.questionIndex !== null
        );
    }

    function createRecord(question, context, tags) {
        const { id, source } = normalizeSource(question, context);
        const validTags = [...new Set(tags)].filter(validTag);
        if (!validTags.length) return null;
        return {
            id,
            source,
            tags: validTags,
            subject: String(context.subject || source.sourceSubjectKey || ""),
            updatedAt: new Date().toISOString(),
            ...(canResolveFromSource(source) ? {} : { question: question ? { ...question } : null })
        };
    }

    function validRecord(value) {
        return Boolean(
            value
            && typeof value === "object"
            && typeof value.id === "string"
            && value.source
            && typeof value.source === "object"
            && Array.isArray(value.tags)
            && value.tags.some(validTag)
            && (!value.source.sourceJsonFile || /^[A-Za-z0-9_-]+\.json$/i.test(value.source.sourceJsonFile))
        );
    }

    function backupRecordIdentityMatches(record) {
        try {
            const identity = JSON.parse(record.id);
            if (!Array.isArray(identity) || identity.length !== 6) return false;
            const [sourceFile, subjectKey, chapter, identityPart, duplicatePart, fingerprint] = identity;
            const source = record.source;
            if (sourceFile !== String(source.sourceJsonFile || "").toLowerCase()
                || subjectKey !== String(source.sourceSubjectKey || "").toLowerCase()
                || chapter !== String(source.chapter || "")
                || fingerprint !== source.questionFingerprint) return false;
            const expectedIdentity = source.questionId !== null && source.questionId !== undefined && source.questionId !== ""
                ? `id:${String(source.questionId)}`
                : (source.questionIndex !== null && source.questionIndex !== undefined
                    ? `index:${Number(source.questionIndex)}`
                    : `content:${source.questionFingerprint}`);
            if (identityPart !== expectedIdentity) return false;
            if (duplicatePart && duplicatePart !== `index:${Number(source.questionIndex)}`) return false;
            if (record.question && normalizeSource(record.question, source).id !== record.id) return false;
            return true;
        } catch (error) {
            return false;
        }
    }

    function mergeRecords(primary, incoming) {
        const merged = new Map(primary.map((record) => [record.id, { ...record, tags: [...record.tags] }]));
        incoming.forEach((record) => {
            if (!validRecord(record)) return;
            const current = merged.get(record.id);
            if (!current) {
                merged.set(record.id, { ...record, tags: [...new Set(record.tags.filter(validTag))] });
                return;
            }
            current.tags = [...new Set([...current.tags, ...record.tags].filter(validTag))];
            current.source = { ...record.source, ...current.source };
            if (record.preserveSnapshot && record.question) current.question = record.question;
            else current.question = current.question || record.question;
            current.preserveSnapshot = current.preserveSnapshot || record.preserveSnapshot;
            current.subject = current.subject || record.subject;
            current.updatedAt = current.updatedAt || record.updatedAt;
        });
        return [...merged.values()].filter((record) => record.tags.length);
    }

    const SUBJECT_ALIASES = Object.freeze({
        "ancient history": "ancient",
        ancient_history: "ancient",
        "medieval history": "medieval",
        medieval_history: "medieval",
        medeival: "medieval",
        "medeival history": "medieval",
        medeival_history: "medieval",
        "modern history": "modern",
        modern_history: "modern",
        geography: "geography",
        polity_governance: "polity",
        "polity governance": "polity",
        "current affairs": "current_affairs",
        "current-affairs": "current_affairs",
        ca: "current_affairs",
        "mock test": "mock",
        mock_test: "mock",
        sectional: "mock"
    });

    function canonicalSubject(value) {
        const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        return SUBJECT_ALIASES[key] || key;
    }

    function canonicalFile(value, subjectKey, sourceHint = "") {
        const input = String(value || "").replace(/\\/g, "/").split("/").pop();
        if (/^[A-Za-z0-9_-]+\.json$/i.test(input)) return input.toLowerCase();
        if (canonicalSubject(subjectKey) === "mock" && String(sourceHint).toLowerCase() === "sectional") return "sectional.json";
        return SOURCE_FILES[canonicalSubject(subjectKey)] || "";
    }

    function contextFromLegacy(item = {}, question = null, key = "") {
        const source = item.source && typeof item.source === "object"
            ? item.source
            : (question?._collectionSource || question?._source || {});
        const keyParts = String(key).split("::");
        const sourceIdentityParts = String(item.sourceIdentity || "").split("::");
        const identityFile = sourceIdentityParts.find((part) => /^[A-Za-z0-9_-]+\.json$/i.test(part));
        const rawSubject = source.sourceSubjectKey
            || item.sourceSubjectKey
            || item.originalSubjectKey
            || item.subjectKey
            || question?._pyqSubjectKey
            || question?.subjectKey
            || item.subject
            || keyParts[0]
            || "";
        const sourceSubjectKey = canonicalSubject(rawSubject);
        const chapter = String(
            source.chapter
            || item.sourceChapter
            || item.originalChapter
            || item.chapter
            || question?._pyqChapter
            || question?.chapter
            || keyParts[1]
            || ""
        ).trim();
        const rawIndex = source.questionIndex
            ?? item.sourceQuestionIndex
            ?? item.questionIndex
            ?? question?._pyqQuestionIndex
            ?? (keyParts.length > 3 ? keyParts[3] : null);
        const questionIndex = rawIndex !== null && rawIndex !== undefined && rawIndex !== "" && Number.isInteger(Number(rawIndex))
            ? Number(rawIndex)
            : null;
        const questionId = source.questionId
            ?? item.sourceQuestionId
            ?? item.questionId
            ?? question?._pyqQuestionId
            ?? question?.id
            ?? question?.qid
            ?? question?.questionId
            ?? (keyParts.length > 3 ? keyParts[2] : null);
        const sourceHint = source.source || (typeof item.source === "string" ? item.source : "") || item.sourceMode || item.quizUrl || "";
        const sourceJsonFile = source.sourceJsonFile || item.sourceJsonFile || identityFile || "";
        return {
            sourceSubjectKey,
            chapter,
            questionIndex,
            questionId,
            sourceJsonFile: canonicalFile(sourceJsonFile, sourceSubjectKey, sourceHint),
            sourceJsonFileExplicit: Boolean(sourceJsonFile),
            source: sourceHint,
            subject: String(item.subject || item.subjectKey || sourceSubjectKey)
        };
    }

    function explicitMetadataTags(question) {
        const metadata = question?.quizMeta;
        const tags = [];
        if (metadata && typeof metadata === "object" && metadata.saved === true) tags.push("S");
        const classifications = metadata && typeof metadata === "object" ? metadata.classifications : null;
        if (classifications && typeof classifications === "object") {
            Object.entries(classifications).forEach(([tag, active]) => {
                const normalized = String(tag).toUpperCase();
                if (active === true && validTag(normalized)) tags.push(normalized);
            });
        }
        Object.keys(TAG_LABELS).forEach((tag) => {
            if (question?.[tag] === true) tags.push(tag);
        });
        return [...new Set(tags)];
    }

    function getDatasetGroups(data, file) {
        if (file === "current_affairs.json") {
            const entries = Array.isArray(data?.questions) ? data.questions : [];
            return {
                "Current Affairs": entries.map((entry) => entry?.question || entry).filter((item) => item && typeof item === "object")
            };
        }
        const groups = data?.chapters || data?.["TEST NUMBER"];
        return groups && typeof groups === "object" ? groups : {};
    }

    function questionIdentifier(question) {
        return question?.id ?? question?.qid ?? question?.questionId ?? question?._id ?? question?.questionID ?? question?.question_id ?? null;
    }

    function rawSnapshot(localStorageData, key) {
        return Object.prototype.hasOwnProperty.call(localStorageData || {}, key) ? localStorageData[key] : null;
    }

    function addUnresolved(unresolved, sourceName, originalKey, raw, reason) {
        let payload;
        try {
            payload = JSON.stringify({ sourceName, originalKey, raw, reason });
        } catch (error) {
            payload = `${sourceName}::${originalKey}::${reason}`;
        }
        let hash = 2166136261;
        for (let index = 0; index < payload.length; index += 1) {
            hash ^= payload.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        const id = `legacy-${(hash >>> 0).toString(16)}`;
        unresolved.set(id, {
            id,
            sourceName,
            originalKey: String(originalKey || ""),
            raw,
            reason,
            tags: [],
            createdAt: new Date().toISOString()
        });
    }

    function parseLegacyJson(localStorageData, key, fallback, unresolved) {
        const raw = rawSnapshot(localStorageData, key);
        if (raw === null) return fallback;
        try {
            return JSON.parse(raw);
        } catch (error) {
            addUnresolved(unresolved, "localStorage", key, raw, `Malformed JSON: ${error.message}`);
            return fallback;
        }
    }

    function getIndexedDatabaseRecord(snapshot, databaseName, storeName, key) {
        const database = snapshot?.indexedDB?.find((item) => item.name === databaseName);
        const entry = database?.stores?.[storeName]?.find((item) => item.key === key);
        return entry?.value;
    }

    async function normalizeMigrationBackup(input) {
        if (input?.format !== "bpsc-real-legacy-backup") return input;
        if (input.version !== 1 || !input.localStorage || typeof input.localStorage !== "object"
            || !Array.isArray(input.indexedDB)) {
            throw new Error("Unsupported or malformed bpsc-real-legacy-backup version 1 payload.");
        }

        const localStorage = {};
        Object.entries(input.localStorage).forEach(([key, value]) => {
            if (!/^(bookmarks|questionClassifications|quizPendingChanges|quizPendingChangeBatches|quiz_attempt_history|quizResult(?:_.+)?|quizResults|quiz_results|test_results|quizProgress(?:_.+)?)$/i.test(key)) {
                return;
            }
            localStorage[key] = typeof value === "string" ? value : JSON.stringify(value);
        });
        const indexedDB = input.indexedDB
            .filter((item) => item && ["bpscQuizCollectionStore", HISTORY_DATABASE_NAME, PENDING_DATABASE_NAME].includes(item.name))
            .map((item) => {
                const stores = {};
                Object.entries(item.stores || {}).forEach(([storeName, store]) => {
                    const rows = Array.isArray(store) ? store : store?.records;
                    if (!Array.isArray(rows)) return;
                    stores[storeName] = rows.map((row) => ({
                        key: row?.key,
                        value: row?.value
                    }));
                });
                return { name: item.name, version: item.version, stores };
            });

        const legacyFiles = { ...(input.legacyFiles || {}) };
        const fileErrors = [];
        for (const path of ["data/saved_questions.json", "data/current_affairs.json"]) {
            if (typeof legacyFiles[path] === "string") continue;
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetch(`${window.QUIZ_COLLECTIONS_BACKUP_BASE_PATH || ""}${path}`, {
                    cache: "no-store",
                    signal: controller.signal
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                legacyFiles[path] = await response.text();
            } catch (error) {
                fileErrors.push({
                    path,
                    error: error.name === "AbortError" ? "Timed out after 15 seconds." : error.message
                });
            } finally {
                window.clearTimeout(timeout);
            }
        }

        return {
            ...input,
            format: input.format,
            localStorage,
            indexedDB,
            legacyFiles,
            importDataFiles: Array.isArray(window.QUIZ_COLLECTIONS_IMPORT_DATA_FILES)
                ? window.QUIZ_COLLECTIONS_IMPORT_DATA_FILES
                : LEGACY_DATA_FILES,
            importedBackupErrors: [
                ...(Array.isArray(input.errors) ? input.errors : []),
                ...fileErrors.map((item) => ({ source: `repository-file:${item.path}`, error: item.error }))
            ]
        };
    }

    function pendingChangesFromSnapshot(snapshot, localStorageData, unresolved) {
        const changes = [];
        const batchStatuses = [];
        const addChanges = (value, sourceName, activeState = false) => {
            if (Array.isArray(value)) {
                value.forEach((change) => changes.push({ change, sourceName, activeState }));
                return;
            }
            if (value && typeof value === "object") {
                const listed = Array.isArray(value.changes) ? value.changes : [];
                listed.forEach((change) => changes.push({ change, sourceName, activeState: true }));
                (Array.isArray(value.batches) ? value.batches : []).forEach((batch) => {
                    if (!batch || typeof batch !== "object") {
                        addUnresolved(unresolved, sourceName, "batch", batch, "Pending batch is not an object.");
                        return;
                    }
                    batchStatuses.push({ status: batch.status || "unknown", count: Array.isArray(batch.changes) ? batch.changes.length : 0 });
                    if (batch.status === "synced") return;
                    if (batch.status !== "downloaded") {
                        addUnresolved(unresolved, sourceName, batch.batchId || batch.id || "batch", batch, "Pending batch has an unknown synchronization status.");
                        return;
                    }
                    (Array.isArray(batch.changes) ? batch.changes : [])
                        .forEach((change) => changes.push({ change, sourceName, activeState: false }));
                });
            } else if (value !== null) {
                addUnresolved(unresolved, sourceName, "pending changes", value, "Pending record has an unsupported structure.");
            }
        };
        addChanges(parseLegacyJson(localStorageData, "quizPendingChanges", [], unresolved), "localStorage:quizPendingChanges");
        const batches = parseLegacyJson(localStorageData, "quizPendingChangeBatches", null, unresolved);
        if (batches) addChanges(batches, "localStorage:quizPendingChangeBatches");
        const databaseState = getIndexedDatabaseRecord(snapshot, PENDING_DATABASE_NAME, "state", "pending");
        if (databaseState) addChanges(databaseState, "indexedDB:bpscQuizPendingChanges", true);

        const byChangeId = new Map();
        changes.forEach(({ change, sourceName, activeState }, index) => {
            if (!change || typeof change !== "object") {
                addUnresolved(unresolved, sourceName, index, change, "Pending change is not an object.");
                return;
            }
            const type = String(change.operationType || "");
            if (!["classification", "saved-question", "edit-question"].includes(type)) {
                addUnresolved(unresolved, sourceName, change.pendingChangeId || index, change, "Pending change uses an unsupported operation type.");
                return;
            }
            if (type === "edit-question" && (!change.field || typeof change.field !== "string" || ["__proto__", "prototype", "constructor"].includes(change.field))) {
                addUnresolved(unresolved, sourceName, change.pendingChangeId || index, change, "Pending question edit has an unsupported field.");
                return;
            }
            const id = String(change.pendingChangeId || "");
            if (id) {
                const previous = byChangeId.get(id);
                if (previous) {
                    const previousPayload = { ...previous.change };
                    const currentPayload = { ...change };
                    delete previousPayload.downloadedBatchId;
                    delete currentPayload.downloadedBatchId;
                    if (JSON.stringify(previousPayload) !== JSON.stringify(currentPayload)) {
                        addUnresolved(unresolved, sourceName, id, { previous: previous.change, current: change }, "Archived and active pending records share an ID but have conflicting payloads.");
                    } else if (activeState) {
                        byChangeId.set(id, { change, sourceName, activeState });
                    }
                    return;
                }
                byChangeId.set(id, { change, sourceName, activeState });
                return;
            }
            byChangeId.set(`${sourceName}::${index}`, { change, sourceName, activeState });
        });

        const unique = new Map();
        const edits = new Map();
        [...byChangeId.values()].forEach(({ change, sourceName }, index) => {
            const type = String(change.operationType || "");
            if (type === "edit-question") {
                const context = contextFromLegacy(change, change.question, "");
                const fieldKey = [
                    context.sourceJsonFile,
                    context.sourceSubjectKey,
                    context.chapter,
                    context.questionId || "",
                    context.questionIndex ?? "",
                    change.field
                ].join("::");
                const timestamp = Date.parse(change.timestamp || "");
                const sequence = Number(String(change.pendingChangeId || "").match(/(?:change|legacy)-(\d+)/)?.[1] || index);
                const old = edits.get(fieldKey);
                if (!old || timestamp > old.timestamp || (timestamp === old.timestamp && sequence >= old.sequence)) {
                    edits.set(fieldKey, { change, context, sourceName, timestamp, sequence });
                }
                return;
            }
            const tag = type === "saved-question" ? "S" : String(change.tag || "").toUpperCase();
            if (!validTag(tag)) {
                addUnresolved(unresolved, sourceName, change.pendingChangeId || index, change, "Pending membership uses an unsupported tag.");
                return;
            }
            const context = contextFromLegacy(change, change.question, "");
            if (context.sourceSubjectKey === "mock" && String(change.sourceJsonFile || "").toLowerCase().includes("sectional")) {
                context.sourceJsonFile = "sectional.json";
            }
            const identity = [
                context.sourceJsonFile,
                context.sourceSubjectKey,
                context.chapter,
                context.questionId || "",
                context.questionIndex ?? ""
            ].join("::");
            const operationKey = `${identity}::${tag}`;
            const old = unique.get(operationKey);
            const timestamp = Date.parse(change.timestamp || "");
            const sequence = Number(String(change.pendingChangeId || "").match(/(?:change|legacy)-(\d+)/)?.[1] || index);
            if (!old || timestamp > old.timestamp || (timestamp === old.timestamp && sequence >= old.sequence)) {
                unique.set(operationKey, { change, tag, context, sourceName, timestamp, sequence });
            }
        });
        return {
            memberships: [...unique.values()],
            edits: [...edits.values()],
            summary: {
                activeChanges: changes.filter((entry) => entry.activeState).length,
                archivedChanges: changes.filter((entry) => !entry.activeState).length,
                uniquePendingIds: byChangeId.size,
                batchStatuses,
                deduplicatedArchiveRecords: changes.length - byChangeId.size
            }
        };
    }

    async function getSourceDataset(sourceJsonFile, cache) {
        if (cache.has(sourceJsonFile)) return cache.get(sourceJsonFile);
        const promise = loadJson(`data/${sourceJsonFile}`).then((data) => ({ data, groups: getDatasetGroups(data, sourceJsonFile) }));
        cache.set(sourceJsonFile, promise);
        return promise;
    }

    async function resolveLegacyQuestion(question, context, datasetCache) {
        if (!context.sourceSubjectKey || !context.sourceJsonFile || !context.chapter) {
            throw new Error("Source subject, dataset file, or chapter is unavailable.");
        }
        if (context.questionIndex === null && (context.questionId === null || context.questionId === undefined || context.questionId === "")) {
            throw new Error("Legacy record has neither a source question ID nor a stable source index.");
        }
        const { groups } = await getSourceDataset(context.sourceJsonFile, datasetCache);
        const chapterEntry = Object.entries(groups).find(([name]) => name.trim().toLowerCase() === context.chapter.trim().toLowerCase());
        if (!chapterEntry || !Array.isArray(chapterEntry[1])) {
            if (question && (context.questionId || context.questionIndex !== null)) return null;
            throw new Error("The referenced source chapter no longer exists.");
        }
        const questions = chapterEntry[1];
        const desiredId = context.questionId === null || context.questionId === undefined ? null : String(context.questionId);
        const idMatches = desiredId
            ? questions.filter((candidate) => {
                const id = questionIdentifier(candidate);
                return id !== null && String(id) === desiredId;
            })
            : [];
        if (idMatches.length === 1) return idMatches[0];
        if (idMatches.length > 1) throw new Error("The source question ID matches more than one question.");

        if (question) {
            const fingerprint = questionFingerprint(question);
            const fingerprintMatches = questions.filter((candidate) => questionFingerprint(candidate) === fingerprint);
            if (fingerprintMatches.length === 1) return fingerprintMatches[0];
            if (fingerprintMatches.length > 1 && context.questionIndex !== null
                && questions[context.questionIndex]
                && questionFingerprint(questions[context.questionIndex]) === fingerprint) {
                return questions[context.questionIndex];
            }
            if (context.questionIndex !== null && questions[context.questionIndex]
                && (desiredId === null || questionIdentifier(questions[context.questionIndex]) === null)) {
                return questions[context.questionIndex];
            }
            if (fingerprintMatches.length > 1) throw new Error("Question snapshot matches multiple source questions.");
            return null;
        }
        if (context.questionIndex !== null && questions[context.questionIndex]) {
            const indexed = questions[context.questionIndex];
            if (desiredId === null || questionIdentifier(indexed) === null || String(questionIdentifier(indexed)) === desiredId) {
                return indexed;
            }
        }
        throw new Error("The source question could not be resolved without substituting another record.");
    }

    async function makeMigrationCandidate(question, context, tags, sourceName, originalKey, raw, datasetCache, sourceQuestionIsExact = false, pendingEdits = [], appliedEditIds = new Set()) {
        try {
            const canonicalContext = { ...context };
            canonicalContext.sourceSubjectKey = canonicalSubject(canonicalContext.sourceSubjectKey);
            canonicalContext.sourceJsonFile = canonicalFile(canonicalContext.sourceJsonFile, canonicalContext.sourceSubjectKey, canonicalContext.source);
            let bankQuestion = question;
            if (!sourceQuestionIsExact) {
                if (canonicalContext.sourceSubjectKey === "mock"
                    && !context.sourceJsonFileExplicit
                    && String(context.source || "").toLowerCase() !== "sectional") {
                    const matches = [];
                    for (const sourceJsonFile of ["mock.json", "sectional.json"]) {
                        const candidateContext = { ...canonicalContext, sourceJsonFile };
                        const resolved = await resolveLegacyQuestion(question, candidateContext, datasetCache);
                        if (resolved) matches.push({ question: resolved, sourceJsonFile });
                    }
                    const fingerprintMatches = question
                        ? matches.filter((match) => questionFingerprint(match.question) === questionFingerprint(question))
                        : [];
                    const selectedMatches = fingerprintMatches.length ? fingerprintMatches : matches;
                    if (selectedMatches.length !== 1) {
                        throw new Error(matches.length
                            ? "The legacy mock question matches both normal and sectional datasets; source mode is ambiguous."
                            : "The legacy mock question could not be resolved uniquely to a source dataset.");
                    }
                    bankQuestion = selectedMatches[0].question;
                    canonicalContext.sourceJsonFile = selectedMatches[0].sourceJsonFile;
                } else {
                    bankQuestion = await resolveLegacyQuestion(question, canonicalContext, datasetCache);
                    if (!bankQuestion) {
                        throw new Error("The legacy snapshot did not match its referenced source question; it was retained for recovery.");
                    }
                }
            }
            const actualQuestionId = questionIdentifier(bankQuestion);
            if (canonicalContext.questionId !== null && canonicalContext.questionId !== undefined
                && actualQuestionId !== String(canonicalContext.questionId)) {
                canonicalContext.questionId = actualQuestionId ?? null;
            }
            let sourceQuestion = bankQuestion || question;
            const matchedEdits = pendingEdits.filter((edit) => {
                const editContext = edit.context;
                return edit.change.active !== false
                    && editContext.sourceJsonFile === canonicalContext.sourceJsonFile
                    && editContext.sourceSubjectKey === canonicalContext.sourceSubjectKey
                    && editContext.chapter.trim().toLowerCase() === canonicalContext.chapter.trim().toLowerCase()
                    && editContext.questionIndex === canonicalContext.questionIndex
                    && (!editContext.questionId || !canonicalContext.questionId
                        || String(editContext.questionId) === String(canonicalContext.questionId));
            });
            if (sourceQuestion && matchedEdits.length) {
                sourceQuestion = { ...sourceQuestion };
                matchedEdits.forEach((edit) => {
                    sourceQuestion[edit.change.field] = edit.change.value;
                    appliedEditIds.add(String(edit.change.pendingChangeId || edit.originalKey));
                });
            }
            const hasStoredSnapshot = Boolean(question && bankQuestion
                && (sourceName.startsWith("localStorage:") || sourceName.startsWith("legacy-file:"))
                && JSON.stringify(question) !== JSON.stringify(bankQuestion));
            const questionWithSnapshot = hasStoredSnapshot
                ? { ...bankQuestion, ...question, ...Object.fromEntries(matchedEdits.map((edit) => [edit.change.field, edit.change.value])) }
                : sourceQuestion;
            const sourced = sourceQuestion ? {
                ...(questionWithSnapshot || sourceQuestion),
                _source: {
                    ...(sourceQuestion._source && typeof sourceQuestion._source === "object" ? sourceQuestion._source : {}),
                    sourceSubjectKey: canonicalContext.sourceSubjectKey,
                    sourceJsonFile: canonicalContext.sourceJsonFile,
                    chapter: canonicalContext.chapter,
                    questionIndex: canonicalContext.questionIndex,
                    questionId: canonicalContext.questionId ?? actualQuestionId
                },
                _pyqSubjectKey: canonicalContext.sourceSubjectKey,
                _pyqChapter: canonicalContext.chapter,
                _pyqQuestionIndex: canonicalContext.questionIndex
            } : null;
            const identity = normalizeSource(sourced, canonicalContext);
            const parsedIdentity = JSON.parse(identity.id);
            if (parsedIdentity[3].startsWith("content:")) {
                throw new Error("Content-only identity is not accepted for collection migration.");
            }
            const record = createRecord(sourced, canonicalContext, tags);
            if (!record) throw new Error("No supported collection membership was found.");
            if (hasStoredSnapshot || matchedEdits.length) {
                record.question = { ...sourced };
                record.preserveSnapshot = true;
            } else if (!bankQuestion && question) {
                record.question = { ...question, _source: { ...sourced?._source } };
            }
            return { record, sourceName, originalKey, tags: [...new Set(tags)], raw, appliedEditIds: matchedEdits.map((edit) => String(edit.change.pendingChangeId || edit.originalKey)) };
        } catch (error) {
            addUnresolved(migrationUnresolved, sourceName, originalKey, raw || { question, context, tags }, error.message);
            return null;
        }
    }

    let migrationUnresolved = new Map();

    async function collectLegacyRecords(snapshot, currentRecords, options = {}) {
        const unresolved = new Map();
        migrationUnresolved = unresolved;
        const candidates = [];
        const datasetCache = new Map();
        const sourceCounts = {};
        const enabledTags = new Set(options.tags || Object.keys(TAG_LABELS));
        const appliedEditIds = new Set();
        const allPending = pendingChangesFromSnapshot(snapshot, snapshot.localStorage, unresolved);
        const filteredPending = {
            ...allPending,
            memberships: allPending.memberships.filter((item) => enabledTags.has(item.tag)),
            summary: {
                ...allPending.summary,
                excludedMembershipOperations: allPending.memberships.filter((item) => !enabledTags.has(item.tag)).length
            }
        };
        filteredPending.edits.forEach((edit) => {
            edit.originalKey = edit.change.pendingChangeId || `${edit.context.sourceJsonFile}::${edit.context.chapter}::${edit.context.questionIndex}::${edit.change.field}`;
        });
        const addCandidate = async (question, context, tags, sourceName, originalKey, raw) => {
            const validTags = [...new Set(tags.map((tag) => String(tag).toUpperCase()).filter((tag) => validTag(tag) && enabledTags.has(tag)))];
            if (!validTags.length) return;
            sourceCounts[sourceName] ||= { records: 0, memberships: 0 };
            sourceCounts[sourceName].records += 1;
            sourceCounts[sourceName].memberships += validTags.length;
            sourceCounts[sourceName].membershipTypes ||= {};
            validTags.forEach((tag) => {
                sourceCounts[sourceName].membershipTypes[tag] = (sourceCounts[sourceName].membershipTypes[tag] || 0) + 1;
            });
            const candidate = await makeMigrationCandidate(question, context, validTags, sourceName, originalKey, raw, datasetCache, false, filteredPending.edits, appliedEditIds);
            if (candidate) {
                candidate.appliedEditIds.forEach((id) => appliedEditIds.add(id));
                candidates.push(candidate);
            }
        };

        for (const sourceJsonFile of (snapshot.importDataFiles || LEGACY_DATA_FILES)) {
            try {
                const { groups } = await getSourceDataset(sourceJsonFile, datasetCache);
                for (const [chapter, questions] of Object.entries(groups)) {
                    if (!Array.isArray(questions)) continue;
                    for (let index = 0; index < questions.length; index += 1) {
                        const entry = questions[index];
                        const question = entry?.question || entry;
                        const tags = explicitMetadataTags(question);
                        const embeddedSource = question?._collectionSource || question?._source || entry?.source || {};
                        const sourceSubjectKey = canonicalSubject(embeddedSource.sourceSubjectKey || (
                            sourceJsonFile === "mock.json" || sourceJsonFile === "sectional.json" ? "mock"
                                : sourceJsonFile.replace(/\.json$/i, "")
                        ));
                        const context = {
                            sourceSubjectKey,
                            sourceJsonFile: sourceJsonFile === "current_affairs.json"
                                ? canonicalFile(embeddedSource.sourceJsonFile, sourceSubjectKey, embeddedSource.source)
                                : sourceJsonFile,
                            chapter: embeddedSource.chapter || chapter,
                            questionIndex: embeddedSource.questionIndex ?? index,
                            questionId: embeddedSource.questionId ?? questionIdentifier(question),
                            source: embeddedSource.source || (sourceJsonFile === "sectional.json" ? "sectional" : "")
                        };
                        const targetTag = ({
                            "ancient.json": "H",
                            "medeival.json": "H",
                            "modern.json": "H",
                            "geography.json": "G",
                            "polity.json": "P",
                            "economy.json": "E"
                        })[sourceJsonFile.toLowerCase()];
                        const hasLegacySource = Boolean(
                            question?._source || question?._collectionSource
                            || question?._pyqSubjectKey
                            || entry?.source?.sourceSubjectKey
                        );
                        const isLegacyCollectionCopy = targetTag
                            && chapter.trim().toLowerCase() === "important questions"
                            && hasLegacySource;
                        const includedTags = tags.filter((tag) => enabledTags.has(tag));
                        if (includedTags.length) {
                            const sourceName = `question-metadata:${sourceJsonFile}`;
                            sourceCounts[sourceName] ||= { records: 0, memberships: 0 };
                            sourceCounts[sourceName].records += 1;
                            sourceCounts[sourceName].memberships += includedTags.length;
                            sourceCounts[sourceName].membershipTypes ||= {};
                            includedTags.forEach((tag) => {
                                sourceCounts[sourceName].membershipTypes[tag] = (sourceCounts[sourceName].membershipTypes[tag] || 0) + 1;
                            });
                            const metadataContext = isLegacyCollectionCopy
                                ? contextFromLegacy(entry, question, "")
                                : context;
                            const candidate = await makeMigrationCandidate(
                                question,
                                metadataContext,
                                includedTags,
                                sourceName,
                                `${chapter}::${index}`,
                                { question, context: metadataContext, tags },
                                datasetCache,
                                !isLegacyCollectionCopy,
                                filteredPending.edits,
                                appliedEditIds
                            );
                            if (candidate) {
                                candidate.appliedEditIds.forEach((id) => appliedEditIds.add(id));
                                candidates.push(candidate);
                            }
                        }

                        if (targetTag && chapter.trim().toLowerCase() === "important questions" && hasLegacySource) {
                            const sourceContext = contextFromLegacy(entry, question, "");
                            await addCandidate(
                                question,
                                sourceContext,
                                [targetTag],
                                `legacy-chapter-collection:${sourceJsonFile}`,
                                `${chapter}::${index}`,
                                entry
                            );
                        }
                    }
                }
            } catch (error) {
                addUnresolved(unresolved, "question-metadata", sourceJsonFile, null, `Unable to inspect source dataset: ${error.message}`);
            }
        }

        for (const legacyPath of ["data/saved_questions.json", "data/current_affairs.json"]) {
            const rawText = snapshot.legacyFiles?.[legacyPath];
            if (typeof rawText !== "string") continue;
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (error) {
                addUnresolved(unresolved, `legacy-file:${legacyPath}`, legacyPath, rawText, `Malformed JSON: ${error.message}`);
                continue;
            }
            if (legacyPath.endsWith("saved_questions.json")) {
                const groups = data?.groups;
                if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
                    addUnresolved(unresolved, `legacy-file:${legacyPath}`, "groups", data, "Saved-question store has no groups object.");
                    continue;
                }
                for (const [groupName, items] of Object.entries(groups)) {
                    if (!Array.isArray(items)) {
                        addUnresolved(unresolved, `legacy-file:${legacyPath}`, groupName, items, "Saved-question group is not an array.");
                        continue;
                    }
                    for (let index = 0; index < items.length; index += 1) {
                        const item = items[index];
                        if (!item || typeof item !== "object") {
                            addUnresolved(unresolved, `legacy-file:${legacyPath}`, `${groupName}::${index}`, item, "Saved-question entry is not an object.");
                            continue;
                        }
                        const question = item.question && typeof item.question === "object" ? item.question : null;
                        if (!question) {
                            addUnresolved(unresolved, `legacy-file:${legacyPath}`, `${groupName}::${index}`, item, "Saved-question entry has no question snapshot.");
                            continue;
                        }
                        await addCandidate(
                            question,
                            contextFromLegacy({ ...item, originalMockTestSet: groupName }, question, ""),
                            ["S"],
                            `legacy-file:${legacyPath}`,
                            `${groupName}::${index}`,
                            item
                        );
                    }
                }
            } else if (Array.isArray(data?.questions)) {
                for (let index = 0; index < data.questions.length; index += 1) {
                    const item = data.questions[index];
                    if (!item || typeof item !== "object" || !item.sourceIdentity || !item.source) continue;
                    const question = item.question && typeof item.question === "object" ? item.question : null;
                    if (!question) {
                        addUnresolved(unresolved, `legacy-file:${legacyPath}`, index, item, "Current-affairs collection entry has no question snapshot.");
                        continue;
                    }
                    await addCandidate(
                        question,
                        contextFromLegacy(item, question, ""),
                        ["CA"],
                        `legacy-file:${legacyPath}`,
                        item.sourceIdentity || index,
                        item
                    );
                }
            }
        }

        const bookmarks = parseLegacyJson(snapshot.localStorage, "bookmarks", [], unresolved);
        if (Array.isArray(bookmarks)) {
            for (let index = 0; index < bookmarks.length; index += 1) {
                const item = bookmarks[index];
                if (!item || typeof item !== "object") {
                    addUnresolved(unresolved, "localStorage:bookmarks", index, item, "Bookmark is not an object.");
                    continue;
                }
                const question = item.question && typeof item.question === "object" ? item.question : item;
                await addCandidate(question, contextFromLegacy(item, question, ""), ["S"], "localStorage:bookmarks", item.collectionId || index, item);
            }
        } else {
            addUnresolved(unresolved, "localStorage:bookmarks", "bookmarks", bookmarks, "Bookmarks value is not an array.");
        }

        const classifications = parseLegacyJson(snapshot.localStorage, "questionClassifications", {}, unresolved);
        if (classifications && typeof classifications === "object" && !Array.isArray(classifications)) {
            for (const [key, entry] of Object.entries(classifications)) {
                if (!entry || typeof entry !== "object") {
                    addUnresolved(unresolved, "localStorage:questionClassifications", key, entry, "Classification entry is not an object.");
                    continue;
                }
                const tags = Object.keys(TAG_LABELS).filter((tag) => entry[tag] === true);
                if (!tags.length) continue;
                const question = entry.question && typeof entry.question === "object" ? entry.question : null;
                await addCandidate(question, contextFromLegacy(entry, question, key), tags, "localStorage:questionClassifications", key, entry);
            }
        } else {
            addUnresolved(unresolved, "localStorage:questionClassifications", "questionClassifications", classifications, "Classification value is not an object.");
        }

        const historyValues = [];
        Object.keys(snapshot.localStorage || {})
            .filter((key) => /^(quiz_attempt_history|quizResult(?:_.+)?|quizResults|quiz_results|test_results|quizProgress(?:_.+)?)$/i.test(key))
            .forEach((key) => {
                const parsed = parseLegacyJson(snapshot.localStorage, key, null, unresolved);
                if (parsed) historyValues.push({ sourceName: `localStorage:${key}`, value: parsed });
            });
        const historyDb = snapshot.indexedDB?.find((item) => item.name === HISTORY_DATABASE_NAME);
        ["quiz_attempt_history", "quiz_results"].forEach((storeName) => {
            (historyDb?.stores?.[storeName] || []).forEach((entry) => historyValues.push({
                sourceName: `indexedDB:bpsc_quiz_storage/${storeName}`,
                value: entry.value?.value ?? entry.value
            }));
        });
        const visited = new WeakSet();
        async function scanExplicitQuestionMetadata(value, sourceName, inherited = {}, path = "root") {
            if (!value || typeof value !== "object" || visited.has(value)) return;
            visited.add(value);
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index += 1) {
                    const item = value[index];
                    const context = {
                        ...inherited,
                        questionIndex: item?._source?.questionIndex ?? item?._pyqQuestionIndex ?? index
                    };
                    await scanExplicitQuestionMetadata(item, sourceName, context, `${path}[${index}]`);
                }
                return;
            }
            const tags = explicitMetadataTags(value);
            if (tags.length && (value.q || value.question || value.questionText || value.prompt)) {
                const question = value.question && typeof value.question === "object" ? value.question : value;
                await addCandidate(question, contextFromLegacy({
                    ...inherited,
                    sourceSubjectKey: value._source?.sourceSubjectKey || value._pyqSubjectKey || inherited.subjectKey || inherited.subject,
                    chapter: value._source?.chapter || value._pyqChapter || inherited.chapter,
                    questionIndex: value._source?.questionIndex ?? value._pyqQuestionIndex ?? inherited.questionIndex,
                    sourceJsonFile: value._source?.sourceJsonFile || inherited.sourceJsonFile
                }, question, ""), tags, sourceName, path, value);
            }
            const next = {
                ...inherited,
                subjectKey: value.subjectKey || value.subject || inherited.subjectKey,
                chapter: value.chapter || inherited.chapter,
                sourceJsonFile: value.sourceJsonFile || inherited.sourceJsonFile,
                source: value.source || inherited.source,
                quizUrl: value.quizUrl || inherited.quizUrl
            };
            for (const [key, child] of Object.entries(value)) {
                if (key === "quizMeta") continue;
                await scanExplicitQuestionMetadata(child, sourceName, next, `${path}.${key}`);
            }
        }
        for (const item of historyValues) {
            await scanExplicitQuestionMetadata(item.value, item.sourceName, {}, "root");
        }

        const latestPending = new Map();
        const pendingOperations = filteredPending.memberships;
        const pendingSummary = {
            ...filteredPending.summary,
            operations: pendingOperations.length,
            additions: 0,
            removals: 0,
            editOperations: filteredPending.edits.length,
            appliedEdits: 0,
            retainedEdits: 0
        };
        for (let index = 0; index < pendingOperations.length; index += 1) {
            const pendingOperation = pendingOperations[index];
            const pendingRecord = pendingOperation.change;
            const pendingOperationWithChange = { ...pendingOperation, change: pendingRecord };
            const change = pendingRecord;
            sourceCounts[pendingOperationWithChange.sourceName] ||= { records: 0, memberships: 0 };
            sourceCounts[pendingOperationWithChange.sourceName].operations = (sourceCounts[pendingOperationWithChange.sourceName].operations || 0) + 1;
            if (change.active === false) {
                pendingSummary.removals += 1;
            } else {
                pendingSummary.additions += 1;
                sourceCounts[pendingOperationWithChange.sourceName].records += 1;
                sourceCounts[pendingOperationWithChange.sourceName].memberships += 1;
                sourceCounts[pendingOperationWithChange.sourceName].membershipTypes ||= {};
                sourceCounts[pendingOperationWithChange.sourceName].membershipTypes[pendingOperationWithChange.tag] =
                    (sourceCounts[pendingOperationWithChange.sourceName].membershipTypes[pendingOperationWithChange.tag] || 0) + 1;
            }
            const question = change.question && typeof change.question === "object" ? change.question : null;
            const candidate = await makeMigrationCandidate(
                question,
                pendingOperationWithChange.context,
                [pendingOperationWithChange.tag],
                pendingOperationWithChange.sourceName,
                change.pendingChangeId || index,
                change,
                datasetCache,
                false,
                filteredPending.edits,
                appliedEditIds
            );
            if (!candidate) continue;
            candidate.appliedEditIds.forEach((id) => appliedEditIds.add(id));
            const key = `${candidate.record.id}::${pendingOperationWithChange.tag}`;
            const previous = latestPending.get(key);
            if (!previous || pendingOperationWithChange.timestamp > previous.timestamp
                || (pendingOperationWithChange.timestamp === previous.timestamp && pendingOperationWithChange.sequence >= previous.sequence)) {
                latestPending.set(key, {
                    ...pendingOperationWithChange,
                    record: candidate.record,
                    timestamp: pendingOperationWithChange.timestamp || 0
                });
            }
        }
        pendingSummary.appliedEdits = appliedEditIds.size;
        filteredPending.edits.forEach((edit) => {
            if (edit.change.active === false) return;
            const id = String(edit.change.pendingChangeId || edit.originalKey);
            if (appliedEditIds.has(id)) return;
            pendingSummary.retainedEdits += 1;
            addUnresolved(
                unresolved,
                "pending-question-edit",
                id,
                edit.change,
                "Question edit was retained for recovery because it did not resolve to a migrated collection question."
            );
        });
        (snapshot.importedBackupErrors || []).forEach((error, index) => addUnresolved(
            unresolved,
            error.source || "imported-backup-read-error",
            index,
            error,
            "The supplied backup reported a read error; the error record was retained for recovery."
        ));

        const base = mergeRecords([], candidates.map((candidate) => candidate.record));
        let explicitRemovals = 0;
        latestPending.forEach((pending) => {
            const existing = base.find((record) => record.id === pending.record.id);
            if (pending.change.active === false) return;
            const active = mergeRecords([], [pending.record, ...(existing ? [existing] : [])])[0];
            if (existing) {
                existing.tags = [...new Set([...existing.tags, pending.tag])];
            } else if (active) {
                base.push(active);
            }
        });

        const finalRecords = mergeRecords(currentRecords, base);
        let pendingRemovalsSuperseded = 0;
        const removedMemberships = [];
        latestPending.forEach((pending) => {
            if (pending.change.active !== false) return;
            const existing = finalRecords.find((record) => record.id === pending.record.id);
            const current = currentRecords.find((record) => record.id === pending.record.id);
            if (current?.tags.includes(pending.tag)) {
                const currentTimestamp = Date.parse(current.updatedAt || "");
                if (!pending.timestamp || (Number.isFinite(currentTimestamp) && currentTimestamp > pending.timestamp)) {
                    pendingRemovalsSuperseded += 1;
                    return;
                }
            }
            if (existing?.tags.includes(pending.tag)) {
                existing.tags = existing.tags.filter((tag) => tag !== pending.tag);
                explicitRemovals += 1;
                removedMemberships.push({ id: pending.record.id, tag: pending.tag });
            }
        });
        const nonEmptyFinalRecords = finalRecords.filter((record) => record.tags.length);
        const alreadyRepresented = { records: 0, memberships: 0 };
        const migrated = { records: 0, memberships: 0 };
        const duplicateMemberships = {};
        const sourceMemberships = {};
        candidates.forEach((candidate) => {
            candidate.tags.forEach((tag) => {
                const marker = `${candidate.record.id}::${tag}`;
                sourceMemberships[marker] = (sourceMemberships[marker] || 0) + 1;
            });
        });
        const existingMap = new Map(currentRecords.map((record) => [record.id, record]));
        nonEmptyFinalRecords.forEach((record) => {
            const old = existingMap.get(record.id);
            const relevantTags = record.tags.filter((tag) => enabledTags.has(tag));
            relevantTags.forEach((tag) => {
                if (old?.tags.includes(tag)) alreadyRepresented.memberships += 1;
                else migrated.memberships += 1;
            });
            if (old && relevantTags.length) alreadyRepresented.records += 1;
            else if (!old && relevantTags.length) migrated.records += 1;
        });
        Object.values(sourceMemberships).forEach((count) => {
            if (count > 1) duplicateMemberships.merged = (duplicateMemberships.merged || 0) + count - 1;
        });
        return {
            records: nonEmptyFinalRecords,
            unresolved: [...unresolved.values()],
            removedMemberships,
            report: {
                version: 2,
                startedAt: new Date().toISOString(),
                sources: sourceCounts,
                pendingOperations: pendingSummary,
                membershipTypes: Object.entries(sourceCounts).reduce((totals, [, source]) => {
                    Object.entries(source.membershipTypes || {}).forEach(([tag, count]) => {
                        totals[tag] = (totals[tag] || 0) + count;
                    });
                    return totals;
                }, {}),
                unresolvedBySource: [...unresolved.values()].reduce((totals, item) => {
                    totals[item.sourceName] = (totals[item.sourceName] || 0) + 1;
                    return totals;
                }, {}),
                discovered: {
                    records: Object.values(sourceCounts).reduce((sum, item) => sum + item.records, 0),
                    memberships: Object.values(sourceCounts).reduce((sum, item) => sum + item.memberships, 0)
                },
                alreadyRepresented,
                migrated,
                collectionMembershipCounts: Object.keys(TAG_LABELS).reduce((counts, tag) => {
                    counts[tag] = nonEmptyFinalRecords.filter((record) => record.tags.includes(tag)).length;
                    return counts;
                }, {}),
                duplicates: duplicateMemberships,
                explicitRemovals,
                pendingRemovalsSuperseded,
                unresolved: unresolved.size,
                writeFailures: 0
            }
        };
    }

    function requestPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Collection storage request failed."));
        });
    }

    function transactionPromise(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error("Collection storage transaction failed."));
            transaction.onabort = () => reject(transaction.error || new Error("Collection storage transaction was aborted."));
        });
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error("IndexedDB is unavailable in this browser."));
                return;
            }
            let settled = false;
            let request;
            const timeout = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error("Collection storage was blocked or did not open in time."));
            }, 5000);
            try {
                request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            } catch (error) {
                window.clearTimeout(timeout);
                reject(error);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(MEMBERSHIP_STORE)) {
                    db.createObjectStore(MEMBERSHIP_STORE, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(META_STORE)) {
                    db.createObjectStore(META_STORE, { keyPath: "key" });
                }
                if (!db.objectStoreNames.contains(UNRESOLVED_STORE)) {
                    db.createObjectStore(UNRESOLVED_STORE, { keyPath: "id" });
                }
            };
            request.onblocked = () => {
                if (!settled) {
                    settled = true;
                    window.clearTimeout(timeout);
                    reject(new Error("Collection storage upgrade is blocked by another open tab."));
                }
            };
            request.onerror = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                reject(request.error || new Error("Unable to open collection storage."));
            };
            request.onsuccess = () => {
                if (settled) {
                    request.result.close();
                    return;
                }
                settled = true;
                window.clearTimeout(timeout);
                request.result.onversionchange = () => {
                    request.result.close();
                    if (database === request.result) {
                        database = null;
                        reportStorageIssue(new Error("Collection storage changed in another tab. Changes are temporary until the page is reloaded."));
                    }
                };
                resolve(request.result);
            };
        });
    }

    function reportStorageIssue(error) {
        durable = false;
        unavailableReason = error?.message || "Durable storage is unavailable.";
        if (database) database.close();
        database = null;
        console.error("Question collection changes are temporary because durable storage failed.", error);
        document.querySelectorAll(".collection-storage-status").forEach((node) => {
            node.textContent = `Not saved permanently: ${unavailableReason} Export a backup before leaving.`;
            node.classList.add("is-temporary");
        });
        document.querySelectorAll(".collection-export-button").forEach((button) => {
            button.hidden = false;
        });
    }

    async function initialize() {
        try {
            const backup = await (window.quizCollectionMigrationBackupReady || Promise.reject(new Error("The required migration backup helper is unavailable.")));
            database = await openDatabase();
            const metadataStore = database.transaction(META_STORE, "readonly").objectStore(META_STORE);
            const migrationState = await requestPromise(metadataStore.get(MIGRATION_KEY));
            const existingRecords = await requestPromise(database.transaction(MEMBERSHIP_STORE, "readonly").objectStore(MEMBERSHIP_STORE).getAll());
            const validExisting = existingRecords.filter((record) => validRecord(record) && backupRecordIdentityMatches(record));
            const existingUnresolved = await requestPromise(database.transaction(UNRESOLVED_STORE, "readonly").objectStore(UNRESOLVED_STORE).getAll());
            existingUnresolved.forEach((record) => unresolvedRecords.set(record.id, record));
            const invalidExisting = new Map();
            existingRecords.filter((record) => !validRecord(record) || !backupRecordIdentityMatches(record))
                .forEach((record, index) => addUnresolved(
                    invalidExisting,
                    `indexedDB:${DATABASE_NAME}/${MEMBERSHIP_STORE}`,
                    record?.id || index,
                    record,
                    "Existing collection record has a malformed or mismatched identity and was retained for recovery."
                ));

            const completedTags = new Set(
                Array.isArray(migrationState?.completedTags)
                    ? migrationState.completedTags
                    : (migrationState?.complete === true ? AUTOMATIC_MIGRATION_TAGS : [])
            );
            const automaticMigrationAlreadyComplete = migrationState?.complete === true
                && AUTOMATIC_MIGRATION_TAGS.every((tag) => completedTags.has(tag));
            if (automaticMigrationAlreadyComplete) {
                if (invalidExisting.size) {
                    const recoveryTransaction = database.transaction(UNRESOLVED_STORE, "readwrite");
                    const recoveryComplete = transactionPromise(recoveryTransaction);
                    invalidExisting.forEach((record) => recoveryTransaction.objectStore(UNRESOLVED_STORE).put(record));
                    await recoveryComplete;
                    invalidExisting.forEach((record) => unresolvedRecords.set(record.id, record));
                }
                migrationReport = migrationState.report || null;
                validExisting.forEach((record) => records.set(record.id, record));
                durable = true;
                unavailableReason = "";
                return;
            }

            const collected = await collectLegacyRecords(backup, validExisting, { tags: AUTOMATIC_MIGRATION_TAGS });
            const combined = collected.records;
            const allUnresolved = new Map(existingUnresolved.map((item) => [item.id, item]));
            invalidExisting.forEach((item) => {
                if (!allUnresolved.has(item.id)) allUnresolved.set(item.id, item);
            });
            collected.unresolved.forEach((item) => {
                if (!allUnresolved.has(item.id)) allUnresolved.set(item.id, item);
            });
            unresolvedRecords.clear();
            allUnresolved.forEach((item) => unresolvedRecords.set(item.id, item));
            const report = {
                ...collected.report,
                unresolved: allUnresolved.size,
                backup: {
                    format: backup.format,
                    version: backup.version,
                    createdAt: backup.createdAt,
                    localStorageKeys: Object.keys(backup.localStorage || {}).length,
                    indexedDatabases: (backup.indexedDB || []).map((item) => item.name),
                    legacyFiles: Object.keys(backup.legacyFiles || {})
                },
                completedAt: null
            };
            migrationReport = report;

            const transaction = database.transaction([MEMBERSHIP_STORE, UNRESOLVED_STORE], "readwrite");
            const completed = transactionPromise(transaction);
            const membershipStore = transaction.objectStore(MEMBERSHIP_STORE);
            const unresolvedStore = transaction.objectStore(UNRESOLVED_STORE);
            const migratedIds = new Set(combined.map((record) => record.id));
            validExisting.forEach((record) => {
                if (!migratedIds.has(record.id)) membershipStore.delete(record.id);
            });
            combined.forEach((record) => membershipStore.put(record));
            allUnresolved.forEach((record) => unresolvedStore.put(record));
            await completed;

            const verification = await requestPromise(database.transaction(MEMBERSHIP_STORE, "readonly").objectStore(MEMBERSHIP_STORE).getAll());
            const verifiedMap = new Map(verification.filter((record) => validRecord(record) && backupRecordIdentityMatches(record)).map((record) => [record.id, record]));
            const missing = combined.flatMap((expected) => expected.tags
                .filter((tag) => !verifiedMap.get(expected.id)?.tags.includes(tag))
                .map((tag) => `${expected.id}::${tag}`));
            const verifiedUnresolved = await requestPromise(database.transaction(UNRESOLVED_STORE, "readonly").objectStore(UNRESOLVED_STORE).getAll());
            const missingUnresolved = [...allUnresolved.keys()].filter((id) => !verifiedUnresolved.some((record) => record.id === id));
            if (missing.length || missingUnresolved.length) {
                report.writeFailures += missing.length + missingUnresolved.length;
                migrationReport = report;
                throw new Error(`Migration reconciliation failed: ${missing.length} memberships and ${missingUnresolved.length} recovery records were not verified.`);
            }

            report.completedAt = new Date().toISOString();
            report.recordsInStore = verifiedMap.size;
            report.membershipsInStore = [...verifiedMap.values()].reduce((sum, record) => sum + record.tags.length, 0);
            report.unresolved = verifiedUnresolved.length;
            const metaTransaction = database.transaction(META_STORE, "readwrite");
            const metaCompleted = transactionPromise(metaTransaction);
            metaTransaction.objectStore(META_STORE).put({
                key: MIGRATION_KEY,
                complete: true,
                completedTags: [...new Set([...completedTags, ...AUTOMATIC_MIGRATION_TAGS])],
                completedAt: report.completedAt,
                report
            });
            await metaCompleted;

            records.clear();
            verifiedMap.forEach((record) => records.set(record.id, record));
            unresolvedRecords.clear();
            verifiedUnresolved.forEach((record) => unresolvedRecords.set(record.id, record));
            migrationReport = report;
            migrationFailure = "";
            durable = true;
            unavailableReason = "";
            window.dispatchEvent(new CustomEvent("quizCollectionsMigrationComplete", { detail: report }));
        } catch (error) {
            migrationFailure = error?.message || "Legacy collection migration failed.";
            if (database) {
                try {
                    const existing = await requestPromise(database.transaction(MEMBERSHIP_STORE, "readonly").objectStore(MEMBERSHIP_STORE).getAll());
                    records.clear();
                    existing.filter((record) => validRecord(record) && backupRecordIdentityMatches(record)).forEach((record) => records.set(record.id, record));
                    const unresolved = await requestPromise(database.transaction(UNRESOLVED_STORE, "readonly").objectStore(UNRESOLVED_STORE).getAll());
                    unresolved.forEach((record) => unresolvedRecords.set(record.id, record));
                } catch (readError) {
                    console.error("Unable to read collection records after migration failure.", readError);
                }
            }
            try {
                const backup = await window.quizCollectionMigrationBackupReady;
                const collected = await collectLegacyRecords(backup, [...records.values()], { tags: AUTOMATIC_MIGRATION_TAGS });
                records.clear();
                collected.records.forEach((record) => records.set(record.id, record));
                collected.unresolved.forEach((record) => unresolvedRecords.set(record.id, record));
                migrationReport = {
                    ...collected.report,
                    unresolved: unresolvedRecords.size,
                    completedAt: null,
                    backup: {
                        format: backup.format,
                        version: backup.version,
                        createdAt: backup.createdAt,
                        localStorageKeys: Object.keys(backup.localStorage || {}).length,
                        indexedDatabases: (backup.indexedDB || []).map((item) => item.name),
                        legacyFiles: Object.keys(backup.legacyFiles || {})
                    }
                };
            } catch (recoveryError) {
                console.error("Unable to load legacy collection data into temporary recovery state.", recoveryError);
            }
            if (migrationReport) migrationReport.writeFailures = (migrationReport.writeFailures || 0) + 1;
            reportStorageIssue(error);
            window.dispatchEvent(new CustomEvent("quizCollectionsMigrationFailed", { detail: { message: migrationFailure } }));
        }
    }

    ready = initialize();

    function status() {
        return {
            durable,
            message: unavailableReason,
            migrationComplete: Boolean(migrationReport?.completedAt),
            migrationError: migrationFailure,
            unresolvedCount: unresolvedRecords.size
        };
    }

    function getMigrationReport() {
        return migrationReport ? JSON.parse(JSON.stringify(migrationReport)) : null;
    }

    function retryMigration() {
        migrationFailure = "";
        ready = (async () => {
            try {
                await window.quizCollectionMigrationBackup?.retry?.();
            } catch (error) {
                migrationFailure = error?.message || "Unable to create the migration backup.";
                reportStorageIssue(error);
                throw error;
            }
            await initialize();
        })();
        if (window.quizCollections) window.quizCollections.ready = ready;
        return ready;
    }

    async function downloadMigrationBackup() {
        if (!window.quizCollectionMigrationBackup) {
            throw new Error("The migration backup feature is unavailable.");
        }
        if (!window.quizCollectionMigrationBackup.getPayload()) {
            await window.quizCollectionMigrationBackup.retry();
        }
        return window.quizCollectionMigrationBackup.download();
    }

    function getTags(question, context = {}) {
        const { id } = normalizeSource(question, context);
        return [...(records.get(id)?.tags || [])];
    }

    function getVisibleTags(question, context = {}) {
        const source = question?._collectionSource || question?._source || question?.source || {};
        const rawSubjectKey = String(
            source.sourceSubjectKey
            || question?._pyqSubjectKey
            || context.sourceSubjectKey
            || context.subjectKey
            || ""
        ).trim().toLowerCase().replace(/[\s-]+/g, "_");
        const sourceSubjectKey = rawSubjectKey.replace(/_history$/, "") === "polity_governance"
            ? "polity"
            : rawSubjectKey.replace(/_history$/, "");
        const sourceFile = String(source.sourceJsonFile || context.sourceJsonFile || "").trim().toLowerCase();
        const historySubjects = new Set(["ancient", "medieval", "medeival", "modern", "history"]);
        const mockSource = sourceSubjectKey === "mock" || sourceFile === "mock.json" || sourceFile === "sectional.json";
        let classifications = [];

        if (mockSource) classifications = ["H", "G", "P", "E", "CA"];
        else if (historySubjects.has(sourceSubjectKey)) classifications = ["H"];
        else if (sourceSubjectKey === "geography") classifications = ["G"];
        else if (sourceSubjectKey === "economy") classifications = ["E"];
        else if (sourceSubjectKey === "polity") classifications = ["P"];
        else if (sourceSubjectKey === "current_affairs" || sourceSubjectKey === "current-affairs" || sourceSubjectKey === "ca") classifications = ["CA"];

        return mockSource ? ["S", ...classifications] : classifications;
    }

    function renderControls(question, context = {}) {
        const { id } = normalizeSource(question, context);
        const tags = new Set(records.get(id)?.tags || []);
        const visibleTags = new Set(getVisibleTags(question, context));
        return `<div class="question-collection-controls" role="group" aria-label="Question collections" data-collection-id="${escapeHtml(id)}">
            <div class="question-collection-control-row">
            ${Object.entries(TAG_LABELS).filter(([tag]) => visibleTags.has(tag)).map(([tag, label]) => {
                const active = tags.has(tag);
                const verb = active ? "Remove from" : "Add to";
                return `<button type="button" class="classification-mini-btn ${tag.toLowerCase()}${active ? " active" : ""}" data-collection-tag="${tag}" data-collection-id="${escapeHtml(id)}" aria-label="${verb} ${escapeHtml(label)}" aria-pressed="${active}" title="${escapeHtml(label)}">${tag}</button>`;
            }).join("")}
            <button type="button" class="collection-export-button" hidden>Export backup</button>
            </div>
            <span class="collection-storage-status" role="status" aria-live="polite">${durable ? "" : `Temporary only: ${escapeHtml(unavailableReason)} Export a backup before leaving.`}</span>
        </div>`;
    }

    function attachControls(root, resolveQuestion) {
        if (!root || root.dataset.collectionControlsMounted === "true") return;
        root.dataset.collectionControlsMounted = "true";
        root.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-collection-tag]");
            if (!button || !root.contains(button)) return;
            event.preventDefault();
            const tag = button.dataset.collectionTag;
            if (!validTag(tag) || button.disabled) return;
            const questionContext = resolveQuestion(button);
            if (!questionContext?.question) return;
            button.disabled = true;
            try {
                const updated = await toggle(questionContext.question, questionContext.context || {}, tag);
                document.querySelectorAll("[data-collection-tag][data-collection-id]").forEach((control) => {
                    if (control.dataset.collectionId !== updated.id) return;
                    const active = updated.tags.includes(control.dataset.collectionTag);
                    control.classList.toggle("active", active);
                    control.setAttribute("aria-pressed", String(active));
                    const label = TAG_LABELS[control.dataset.collectionTag];
                    control.setAttribute("aria-label", `${active ? "Remove from" : "Add to"} ${label}`);
                    control.disabled = false;
                });
                const statusNode = button.closest(".question-collection-controls")?.querySelector(".collection-storage-status");
                if (statusNode) {
                    statusNode.textContent = updated.durable
                        ? `${TAG_LABELS[tag]} ${updated.tags.includes(tag) ? "saved." : "removed."}`
                        : `Not saved permanently. Export a backup before leaving. ${unavailableReason}`;
                    statusNode.classList.toggle("is-temporary", !updated.durable);
                }
                if (!updated.durable) {
                    const exportButton = button.closest(".question-collection-controls")?.querySelector(".collection-export-button");
                    if (exportButton) exportButton.hidden = false;
                }
                window.dispatchEvent(new CustomEvent("quizCollectionsChanged", { detail: { id: updated.id, tags: updated.tags, durable: updated.durable } }));
            } catch (error) {
                console.error("Unable to update question collection membership.", error);
                button.disabled = false;
                const statusNode = button.closest(".question-collection-controls")?.querySelector(".collection-storage-status");
                if (statusNode) statusNode.textContent = `Collection update failed: ${error.message}`;
            }
        });
        root.addEventListener("click", (event) => {
            const button = event.target.closest(".collection-export-button");
            if (button && root.contains(button)) exportBackup();
        });
    }

    async function persistRecord(record) {
        await ready;
        writeQueue = writeQueue.then(async () => {
            if (!durable || !database) {
                records.set(record.id, record);
                return false;
            }
            try {
                const transaction = database.transaction(MEMBERSHIP_STORE, "readwrite");
                const completed = transactionPromise(transaction);
                transaction.objectStore(MEMBERSHIP_STORE).put(record);
                await completed;
                records.set(record.id, record);
                return true;
            } catch (error) {
                reportStorageIssue(error);
                records.set(record.id, record);
                return false;
            }
        });
        return writeQueue;
    }

    async function toggle(question, context, tag) {
        if (!validTag(tag)) throw new Error(`Unsupported collection tag: ${tag}`);
        await ready;
        const candidate = createRecord(question, context, ["S"]);
        if (!candidate) throw new Error("Unable to create a stable question identity.");
        return enqueueRecordMutation(candidate.id, async () => {
            const current = records.get(candidate.id);
            const tags = new Set(current?.tags || []);
            if (tags.has(tag)) tags.delete(tag);
            else tags.add(tag);
            const record = {
                ...(current || candidate),
                id: candidate.id,
                source: candidate.source,
                tags: [...tags],
                subject: current?.subject || candidate.subject || context.subject || "",
                updatedAt: new Date().toISOString(),
                ...((current?.question || candidate.question) ? { question: current?.question || candidate.question } : {})
            };
            if (!record.tags.length) {
                const savedDurably = await deleteRecord(record.id);
                return { id: record.id, tags: [], durable: savedDurably };
            }
            const savedDurably = await persistRecord(record);
            return { id: record.id, tags: record.tags, durable: savedDurably };
        });
    }

    function enqueueRecordMutation(id, operation) {
        const previous = recordWriteQueues.get(id) || Promise.resolve();
        const next = previous.then(operation);
        recordWriteQueues.set(id, next.catch(() => {}));
        return next;
    }

    async function deleteRecord(id) {
        await ready;
        writeQueue = writeQueue.then(async () => {
            if (!durable || !database) {
                records.delete(id);
                return false;
            }
            try {
                const transaction = database.transaction(MEMBERSHIP_STORE, "readwrite");
                const completed = transactionPromise(transaction);
                transaction.objectStore(MEMBERSHIP_STORE).delete(id);
                await completed;
                records.delete(id);
                return true;
            } catch (error) {
                reportStorageIssue(error);
                records.delete(id);
                return false;
            }
        });
        return writeQueue;
    }

    async function removeMembership(id, tag) {
        if (!validTag(tag)) throw new Error(`Unsupported collection tag: ${tag}`);
        await ready;
        return enqueueRecordMutation(id, async () => {
            const current = records.get(id);
            if (!current || !current.tags.includes(tag)) return { durable, removed: false };
            const next = { ...current, tags: current.tags.filter((item) => item !== tag), updatedAt: new Date().toISOString() };
            if (!next.tags.length) {
                const savedDurably = await deleteRecord(id);
                if (!savedDurably) {
                    records.set(id, current);
                    return { durable: false, removed: false };
                }
                return { durable: true, removed: true };
            }
            const savedDurably = await persistRecord(next);
            if (!savedDurably) {
                records.set(id, current);
                return { durable: false, removed: false };
            }
            return { durable: true, removed: true };
        });
    }

    async function resolveQuestion(record) {
        if (!validRecord(record)) return null;
        if (record.preserveSnapshot && record.question) {
            return {
                ...record.question,
                _source: { ...record.source },
                _collectionSource: { ...record.source }
            };
        }
        if (record.question && questionFingerprint(record.question) !== record.source.questionFingerprint) {
            return {
                ...record.question,
                _source: { ...record.source },
                _collectionSource: { ...record.source }
            };
        }
        if (!record.source.sourceJsonFile || record.source.questionIndex === null || !record.source.chapter) {
            return record.question ? { ...record.question } : null;
        }
        try {
            const data = await loadJson(`data/${record.source.sourceJsonFile}`);
            const groups = data?.chapters || data?.["TEST NUMBER"] || {};
            let questions = groups[record.source.chapter];
            if (!Array.isArray(questions) && questions && typeof questions === "object") {
                questions = Object.values(questions).find(Array.isArray);
            }
            const questionIdOf = (candidate) => String(
                candidate?.id
                ?? candidate?.qid
                ?? candidate?.questionId
                ?? candidate?._id
                ?? candidate?.questionID
                ?? candidate?.question_id
                ?? ""
            );
            const indexedQuestion = Array.isArray(questions) ? questions[record.source.questionIndex] : null;
            let sourceQuestion = null;
            if (Array.isArray(questions)) {
                const fingerprintMatches = questions.filter((candidate) => questionFingerprint(candidate) === record.source.questionFingerprint);
                if (record.source.questionId !== null && record.source.questionId !== undefined) {
                    sourceQuestion = questions.find((candidate) => questionIdOf(candidate) === String(record.source.questionId)
                        && questionFingerprint(candidate) === record.source.questionFingerprint)
                        || questions.find((candidate) => questionIdOf(candidate) === String(record.source.questionId))
                        || (questionIdOf(indexedQuestion) === String(record.source.questionId) ? indexedQuestion : null)
                        || (questionFingerprint(indexedQuestion) === record.source.questionFingerprint ? indexedQuestion : null)
                        || (fingerprintMatches.length === 1 ? fingerprintMatches[0] : null);
                } else {
                    sourceQuestion = questionFingerprint(indexedQuestion) === record.source.questionFingerprint
                        ? indexedQuestion
                        : (fingerprintMatches.length === 1 ? fingerprintMatches[0] : null);
                }
            }
            if (!sourceQuestion) return record.question ? { ...record.question } : null;
            const question = {
                ...sourceQuestion,
                _source: { ...record.source },
                _collectionSource: { ...record.source }
            };
            if (typeof window.quizPendingQuestionSource === "function") {
                const pendingSource = window.quizPendingQuestionSource(
                    question,
                    record.source.sourceSubjectKey,
                    record.source.chapter,
                    record.source.questionIndex
                );
                window.applyQuizPendingChanges?.(question, pendingSource);
                window.applyQuizPendingMetadata?.(question, pendingSource);
            }
            return question;
        } catch (error) {
            console.error(`Unable to resolve collection question from ${record.source.sourceJsonFile}.`, error);
            return record.question ? { ...record.question } : null;
        }
    }

    async function getCollection(tag) {
        if (!validTag(tag)) throw new Error(`Unsupported collection tag: ${tag}`);
        await ready;
        const selected = [...records.values()].filter((record) => record.tags.includes(tag));
        const resolved = await Promise.all(selected.map(async (record) => ({
            ...record,
            question: await resolveQuestion(record)
        })));
        const unavailable = resolved.filter((record) => !record.question).length;
        if (unavailable) {
            throw new Error(`${unavailable} question${unavailable === 1 ? "" : "s"} in this collection could not be resolved from its source.`);
        }
        return resolved;
    }

    function getCount(tag) {
        if (!validTag(tag)) return 0;
        return [...records.values()].filter((record) => record.tags.includes(tag)).length;
    }

    function getAllRecords() {
        return [...records.values()].map((record) => ({ ...record, tags: [...record.tags] }));
    }

    function createBackup() {
        return {
            format: "bpsc-quiz-collections",
            version: 1,
            exportedAt: new Date().toISOString(),
            collections: getAllRecords(),
            unresolvedMigration: [...unresolvedRecords.values()]
        };
    }

    async function exportBackup() {
        await ready;
        const payload = createBackup();
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "bpsc-quiz-collections-backup.json";
        link.click();
        URL.revokeObjectURL(url);
        return payload;
    }

    function validateBackup(payload) {
        if (!payload || payload.format !== "bpsc-quiz-collections" || payload.version !== 1 || !Array.isArray(payload.collections)) {
            throw new Error("This is not a supported BPSC question-collection backup.");
        }
        if (payload.unresolvedMigration !== undefined && !Array.isArray(payload.unresolvedMigration)) {
            throw new Error("The backup contains an invalid unresolved-migration section.");
        }
        const unresolved = (payload.unresolvedMigration || []).map((record) => {
            if (!record || typeof record !== "object" || typeof record.id !== "string" || typeof record.reason !== "string") {
                throw new Error("The backup contains an invalid migration-recovery record.");
            }
            return record;
        });
        const validated = [];
        payload.collections.forEach((record) => {
            if (!validRecord(record) || !backupRecordIdentityMatches(record)) {
                throw new Error("The backup contains an invalid or mismatched question identity.");
            }
            if (!Array.isArray(record.tags) || record.tags.some((tag) => !validTag(tag))) {
                throw new Error("The backup contains an unsupported collection tag.");
            }
            const normalized = {
                ...record,
                tags: [...new Set(record.tags)],
                source: { ...record.source }
            };
            if (!normalized.tags.length) return;
            validated.push(normalized);
        });
        return { collections: validated, unresolved };
    }

    async function importBackup(payload) {
        await ready;
        const imported = validateBackup(payload);
        const merged = mergeRecords(getAllRecords(), imported.collections);
        const unresolved = new Map(unresolvedRecords);
        imported.unresolved.forEach((record) => {
            if (!unresolved.has(record.id)) unresolved.set(record.id, record);
        });
        if (durable && database) {
            try {
                const transaction = database.transaction([MEMBERSHIP_STORE, UNRESOLVED_STORE], "readwrite");
                const completed = transactionPromise(transaction);
                const store = transaction.objectStore(MEMBERSHIP_STORE);
                merged.forEach((record) => store.put(record));
                unresolved.forEach((record) => transaction.objectStore(UNRESOLVED_STORE).put(record));
                await completed;
                records.clear();
                merged.forEach((record) => records.set(record.id, record));
                unresolvedRecords.clear();
                unresolved.forEach((record) => unresolvedRecords.set(record.id, record));
                window.dispatchEvent(new CustomEvent("quizCollectionsChanged"));
                return { imported: imported.collections.length, unresolved: imported.unresolved.length, durable: true };
            } catch (error) {
                reportStorageIssue(error);
            }
        }
        merged.forEach((record) => records.set(record.id, record));
        unresolved.forEach((record) => unresolvedRecords.set(record.id, record));
        window.dispatchEvent(new CustomEvent("quizCollectionsChanged"));
        return { imported: imported.collections.length, unresolved: imported.unresolved.length, durable: false };
    }

    function legacyBackupImportKey(payload, tags) {
        const identity = JSON.stringify({
            origin: payload.origin || "",
            createdAt: payload.createdAt || "",
            format: payload.format,
            version: payload.version,
            tags: [...tags].sort()
        });
        let hash = 2166136261;
        for (let index = 0; index < identity.length; index += 1) {
            hash ^= identity.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `legacy-backup-import-${(hash >>> 0).toString(16)}`;
    }

    async function importLegacyBackup(payload) {
        if (payload?.format !== "bpsc-real-legacy-backup" || payload.version !== 1) {
            throw new Error("Select a bpsc-real-legacy-backup version 1 file.");
        }
        const includedTags = ["S", "H", "G", "P", "CA"];
        await ready;
        if (!durable || !database) {
            throw new Error("The collection store is not durably available. The legacy backup was not imported; retry after storage recovers.");
        }

        const normalized = await normalizeMigrationBackup(payload);
        const importKey = legacyBackupImportKey(normalized, includedTags);
        const prior = await requestPromise(database.transaction(META_STORE, "readonly").objectStore(META_STORE).get(importKey));
        if (prior?.complete === true) {
            return { report: prior.report, durable: true, alreadyImported: true };
        }

        const currentRecords = [...records.values()];
        const collected = await collectLegacyRecords(normalized, currentRecords, { tags: includedTags });
        const currentById = new Map(currentRecords.map((record) => [record.id, record]));
        const mergedById = new Map(currentRecords.map((record) => [record.id, { ...record, tags: [...record.tags] }]));
        collected.records.forEach((record) => {
            const current = currentById.get(record.id);
            const importedTags = record.tags.filter((tag) => includedTags.includes(tag));
            if (current) {
                const merged = mergedById.get(record.id);
                merged.tags = [...new Set([...merged.tags, ...importedTags])];
            } else if (importedTags.length) {
                mergedById.set(record.id, { ...record, tags: importedTags });
            }
        });
        collected.removedMemberships.forEach(({ id, tag }) => {
            if (!includedTags.includes(tag)) return;
            const record = mergedById.get(id);
            if (!record) return;
            record.tags = record.tags.filter((existingTag) => existingTag !== tag);
            if (!record.tags.length) mergedById.delete(id);
        });
        const merged = [...mergedById.values()];
        const unresolved = new Map(unresolvedRecords);
        collected.unresolved.forEach((record) => {
            if (!unresolved.has(record.id)) unresolved.set(record.id, record);
        });
        const report = {
            ...collected.report,
            backup: {
                format: payload.format,
                version: payload.version,
                createdAt: payload.createdAt || null,
                origin: payload.origin || null,
                localStorageKeys: Object.keys(normalized.localStorage || {}).length,
                indexedDatabases: (normalized.indexedDB || []).map((item) => item.name),
                legacyFiles: Object.keys(normalized.legacyFiles || {})
            },
            collectionMembershipCounts: includedTags.reduce((counts, tag) => {
                counts[tag] = merged.filter((record) => record.tags.includes(tag)).length;
                return counts;
            }, {}),
            excludedTags: ["E"],
            unresolved: unresolved.size,
            completedAt: null
        };

        const importWrite = writeQueue.catch(() => {}).then(async () => {
            if (!durable || !database) throw new Error("Collection storage became unavailable before the legacy import could be saved.");
            const transaction = database.transaction([MEMBERSHIP_STORE, UNRESOLVED_STORE], "readwrite");
            const completed = transactionPromise(transaction);
            const membershipStore = transaction.objectStore(MEMBERSHIP_STORE);
            const mergedIds = new Set(merged.map((record) => record.id));
            currentRecords.forEach((record) => {
                if (!mergedIds.has(record.id)) membershipStore.delete(record.id);
            });
            merged.forEach((record) => membershipStore.put(record));
            unresolved.forEach((record) => transaction.objectStore(UNRESOLVED_STORE).put(record));
            await completed;

            const storedRecords = await requestPromise(database.transaction(MEMBERSHIP_STORE, "readonly").objectStore(MEMBERSHIP_STORE).getAll());
            const storedById = new Map(storedRecords.filter((record) => validRecord(record) && backupRecordIdentityMatches(record)).map((record) => [record.id, record]));
            const missingMemberships = merged.flatMap((record) => record.tags
                .filter((tag) => !storedById.get(record.id)?.tags.includes(tag))
                .map((tag) => `${record.id}::${tag}`));
            const storedUnresolved = await requestPromise(database.transaction(UNRESOLVED_STORE, "readonly").objectStore(UNRESOLVED_STORE).getAll());
            const missingUnresolved = [...unresolved.keys()].filter((id) => !storedUnresolved.some((record) => record.id === id));
            if (missingMemberships.length || missingUnresolved.length) {
                report.writeFailures = missingMemberships.length + missingUnresolved.length;
                throw new Error(`Legacy backup reconciliation failed: ${missingMemberships.length} memberships and ${missingUnresolved.length} recovery records were not verified. Retry is safe.`);
            }

            report.completedAt = new Date().toISOString();
            report.recordsInStore = storedById.size;
            report.membershipsInStore = [...storedById.values()].reduce((sum, record) => sum + record.tags.length, 0);
            report.unresolved = storedUnresolved.length;
            const metaTransaction = database.transaction(META_STORE, "readwrite");
            const metaComplete = transactionPromise(metaTransaction);
            metaTransaction.objectStore(META_STORE).put({
                key: importKey,
                complete: true,
                completedAt: report.completedAt,
                report
            });
            await metaComplete;

            records.clear();
            storedById.forEach((record) => records.set(record.id, record));
            unresolvedRecords.clear();
            storedUnresolved.forEach((record) => unresolvedRecords.set(record.id, record));
            migrationReport = report;
            window.dispatchEvent(new CustomEvent("quizCollectionsChanged"));
            window.dispatchEvent(new CustomEvent("quizCollectionsMigrationComplete", { detail: report }));
        });
        writeQueue = importWrite.catch((error) => {
            if (migrationReport) migrationReport.writeFailures = (migrationReport.writeFailures || 0) + 1;
        });
        await importWrite;
        return { report, durable: true, alreadyImported: false };
    }

    function openCollection(tag, title, returnUrl = "dashboard.html") {
        if (!validTag(tag)) return;
        getCollection(tag).then((items) => {
            const questions = items.map((item) => ({
                ...item.question,
                _collectionSource: { ...item.source }
            }));
            const payload = {
                title: title || TAG_LABELS[tag],
                subject: title || TAG_LABELS[tag],
                subjectKey: "collections",
                chapter: title || TAG_LABELS[tag],
                collectionTag: tag,
                questions,
                returnUrl,
                collectionListPayload: {
                    title: title || TAG_LABELS[tag],
                    subject: title || TAG_LABELS[tag],
                    subjectKey: "collections",
                    chapter: title || TAG_LABELS[tag],
                    collectionTag: tag,
                    questions,
                    returnUrl
                }
            };
            sessionStorage.setItem("collectionListPayload", JSON.stringify(payload));
            window.location.href = "collection-list.html";
        }).catch((error) => {
            console.error("Unable to open the selected question collection.", error);
            window.alert(`Unable to open this collection: ${error.message}`);
        });
    }

    function attachBackupTools(container) {
        if (!container || container.dataset.collectionBackupMounted === "true") return;
        container.dataset.collectionBackupMounted = "true";
        container.addEventListener("click", (event) => {
            const scopedExport = event.target.closest(".collection-export-button");
            if (scopedExport && container.contains(scopedExport)) exportBackup();
            const exportAll = event.target.closest("[data-collection-export-all]");
            if (exportAll) exportBackup();
            const importButton = event.target.closest("[data-collection-import-button]");
            if (importButton) container.querySelector("[data-collection-import-file]")?.click();
            const legacyImportButton = event.target.closest("[data-legacy-backup-import-button]");
            if (legacyImportButton) container.querySelector("[data-legacy-backup-import-file]")?.click();
        });
        container.addEventListener("change", async (event) => {
            const legacyInput = event.target.closest("[data-legacy-backup-import-file]");
            if (legacyInput?.files?.length) {
                const statusNode = container.querySelector("[data-legacy-backup-import-status]");
                try {
                    const payload = JSON.parse(await legacyInput.files[0].text());
                    const outcome = await importLegacyBackup(payload);
                    const counts = Object.entries(outcome.report.collectionMembershipCounts || {})
                        .map(([tag, count]) => `${tag}: ${count}`)
                        .join(", ");
                    if (statusNode) statusNode.textContent = outcome.alreadyImported
                        ? `This legacy backup was already reconciled. ${outcome.report.migrated.memberships} memberships migrated; ${outcome.report.unresolved} unresolved records retained. Current collection counts: ${counts}.`
                        : `Legacy backup reconciled and saved: ${outcome.report.migrated.memberships} memberships migrated; ${outcome.report.alreadyRepresented.memberships} already represented; ${outcome.report.unresolved} unresolved records retained. Current collection counts: ${counts}.`;
                } catch (error) {
                    console.error("Unable to import legacy browser backup.", error);
                    if (statusNode) statusNode.textContent = `Legacy backup import failed: ${error.message} No legacy-backup import marker was written; the source backup remains unchanged and retry is safe.`;
                } finally {
                    legacyInput.value = "";
                }
                return;
            }
            const input = event.target.closest("[data-collection-import-file]");
            if (!input || !input.files?.length) return;
            try {
                const text = await input.files[0].text();
                const outcome = await importBackup(JSON.parse(text));
                const statusNode = container.querySelector("[data-collection-backup-status]");
                if (statusNode) statusNode.textContent = outcome.durable
                    ? `Imported and merged ${outcome.imported} collection records and ${outcome.unresolved} recovery records.`
                    : `Imported ${outcome.imported} records and ${outcome.unresolved} recovery records for this session only; export a backup before leaving.`;
            } catch (error) {
                console.error("Unable to import question-collection backup.", error);
                const statusNode = container.querySelector("[data-collection-backup-status]");
                if (statusNode) statusNode.textContent = `Import failed: ${error.message}`;
            } finally {
                input.value = "";
            }
        });
    }

    window.quizCollections = {
        tags: TAG_LABELS,
        ready,
        status,
        getMigrationReport,
        getUnresolvedCount: () => unresolvedRecords.size,
        getUnresolvedRecords: () => [...unresolvedRecords.values()].map((record) => ({ ...record })),
        retryMigration,
        importLegacyBackup,
        downloadMigrationBackup,
        normalizeSource,
        getTags,
        getVisibleTags,
        renderControls,
        attachControls,
        toggle,
        removeMembership,
        getCollection,
        getCount,
        getAllRecords,
        createBackup,
        exportBackup,
        importBackup,
        openCollection,
        attachBackupTools
    };
}());

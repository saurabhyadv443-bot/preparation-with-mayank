const params = new URLSearchParams(window.location.search);
const subject = params.get("subject") || "ancient";
const source = params.get("source") || "";
const chapterList = document.getElementById("chapterList");
const subjectReviewBtn = document.getElementById("subjectReviewBtn");
const reviewSubjects = new Set(["ancient", "medieval", "modern", "geography", "polity", "economy", "mock"]);
let subjectData = null;
let serverImportantQuestions = {};
let serverCurrentAffairsQuestions = null;
let originalCurrentAffairsQuestions = [];
let mockCollectionData = null;
let subjectPageRendered = false;
let subjectPendingStorageRefresh = false;

window.addEventListener("quizCollectionsChanged", () => {
    if (subject !== "important_collections") return;
    chapterList?.querySelectorAll("[data-collection-count]").forEach((countNode) => {
        const tag = countNode.dataset.collectionCount;
        const count = window.quizCollections?.getCount(tag) || 0;
        countNode.textContent = `${count} question${count === 1 ? "" : "s"}`;
        countNode.closest("button")?.setAttribute("aria-label", `${window.quizCollections?.tags[tag] || tag}, ${count} question${count === 1 ? "" : "s"}`);
    });
});

window.addEventListener("quizPendingStorageReady", () => {
    if (!subjectPageRendered) {
        subjectPendingStorageRefresh = true;
        return;
    }
    loadSubjectContent();
});

function subjectApiUrl(path) {
    return quizApiUrl(path);
}

async function loadServerCollections() {
}

function safeParseStoredValue(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function getMockHistoryQuizId(targetName, mockSource = "") {
    const normalizedSource = String(mockSource || "").trim().toLowerCase();
    return normalizedSource === "sectional"
        ? [subject, "sectional", targetName, "mock"].join("::")
        : [subject, targetName, "mock"].join("::");
}

function getResumeProgressForTarget(targetName, mockSource = "") {
    const progressKey = mockSource === "sectional" ? "quizProgress_sectional" : "quizProgress";
    const progress = safeParseStoredValue(progressKey, null);
    if (!progress || progress.subject !== subject || progress.chapter !== targetName) {
        return null;
    }
    if (mockSource === "sectional" && progress.source !== "sectional") {
        return null;
    }
    if (!mockSource && progress.source === "sectional") {
        return null;
    }
    return progress;
}

function hasCompletedMockAttempt(targetName, mockSource = "") {
    if (subject !== "mock") {
        return false;
    }

    const history = window.quizAttemptHistoryStore?.getHistorySync() || safeParseStoredValue("quiz_attempt_history", {});
    const quizId = getMockHistoryQuizId(targetName, mockSource);
    return Array.isArray(history[quizId]) && history[quizId].length > 0;
}

async function getSubjectMetaMap() {
    try {
        const j = await loadJson('data/subjects.json');
        if (!j || !Array.isArray(j.subjects)) throw new Error('invalid');
        return j.subjects.reduce((acc,s)=>{ acc[s.id]=s; return acc; }, {});
    } catch (e) {
        return null;
    }
}

function getClassifiedQuestionEntries(filterFn) {
    try {
        const store = JSON.parse(localStorage.getItem("questionClassifications") || "{}");
        return Object.values(store).filter((entry) => entry && filterFn(entry));
    } catch (error) {
        return [];
    }
}

function copyOriginalQuestion(question, sourceSubjectKey, chapter, questionIndex) {
    const source = quizPendingQuestionSource(question, sourceSubjectKey, chapter, questionIndex);
    const copy = {
        ...question,
        _source: {
            sourceSubjectKey: source.sourceSubjectKey,
            chapter: source.chapter,
            questionId: source.questionId,
            questionIndex: source.questionIndex
        },
        _pyqSubjectKey: source.sourceSubjectKey,
        _pyqChapter: source.chapter,
        _pyqQuestionId: source.questionId,
        _pyqQuestionIndex: source.questionIndex
    };
    applyQuizPendingChanges(copy, source);
    applyQuizPendingMetadata(copy, source);
    return copy;
}

function getOriginalClassifiedQuestions(data, sourceSubjectKey, tag) {
    const sources = [
        { data, sourceSubjectKey },
        { data: mockCollectionData, sourceSubjectKey: "mock" }
    ];
    const seen = new Set();
    return sources.flatMap(({ data: sourceData, sourceSubjectKey: originalSubjectKey }) => {
        const groups = sourceData?.chapters || sourceData?.["TEST NUMBER"];
        if (!groups || typeof groups !== "object") return [];
        return Object.entries(groups)
            .filter(([chapter, questions]) => chapter !== "Important Questions" || (Array.isArray(questions) && questions.some((question) => !question?._source && !question?._pyqSubjectKey)))
            .flatMap(([chapter, questions]) => Array.isArray(questions)
                ? questions.map((question, index) => copyOriginalQuestion(question, originalSubjectKey, chapter, index))
                : []);
    })
        .filter((question) => {
            if (question._source?.sourceSubjectKey && question._source.sourceSubjectKey !== sourceSubjectKey && question._source.sourceSubjectKey !== "mock") return false;
            const source = quizPendingQuestionSource(question, question._source?.sourceSubjectKey || sourceSubjectKey, question._source?.chapter, question._source?.questionIndex);
            const pending = getQuizPendingQuestionChanges(source).filter((change) => change.operationType === "classification" && change.tag === tag);
            const pendingActive = pending.length ? pending[pending.length - 1].active !== false : false;
            if (question.quizMeta?.classifications?.[tag] !== true && !pendingActive) return false;
            const identity = `${question._source?.sourceSubjectKey || sourceSubjectKey}::${question._source?.chapter || ""}::${question._source?.questionIndex ?? ""}`;
            const content = `${question.q || ""}::${JSON.stringify(question.options || [])}`;
            const key = question._source?.sourceSubjectKey ? identity : content;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function loadOriginalCurrentAffairsQuestions() {
    try {
        const data = await loadJson("data/current_affairs.json");
        const entries = Array.isArray(data?.questions) ? data.questions : [];
        originalCurrentAffairsQuestions = entries
            .map((entry, index) => {
                const source = entry?.source || {};
                const question = entry?.question || entry;
                const questionIndex = Number.isInteger(source.questionIndex) ? source.questionIndex : index;
                return copyOriginalQuestion(
                    question,
                    source.sourceSubjectKey || "current_affairs",
                    source.chapter || "Current Affairs",
                    questionIndex
                );
            })
            .filter((question) => question.quizMeta?.classifications?.CA === true);
    } catch (error) {
        originalCurrentAffairsQuestions = [];
    }
}

const SUBJECT_KEY_ALIASES = Object.freeze({
    modern_history: "modern",
    ancient_history: "ancient",
    medieval_history: "medieval",
    polity_governance: "polity",
    "modern history": "modern",
    "ancient history": "ancient",
    "medieval history": "medieval",
    "polity governance": "polity"
});

function normalizeSubjectKey(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return SUBJECT_KEY_ALIASES[normalized] || SUBJECT_KEY_ALIASES[normalized.replace(/_/g, " ")] || normalized;
}

function isReviewHistoryRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && (value.chapter || value.subjectKey || value.subject || value.completedAt || value.total !== undefined));
}

function collectReviewHistoryRecords(history) {
    const records = [];
    const visit = (value, storageKey = "", index = 0) => {
        if (Array.isArray(value)) {
            value.forEach((item, itemIndex) => {
                if (isReviewHistoryRecord(item)) {
                    records.push({ item, storageKey, index: itemIndex });
                } else {
                    visit(item, storageKey, itemIndex);
                }
            });
            return;
        }
        if (!value || typeof value !== "object") return;
        if (isReviewHistoryRecord(value)) {
            records.push({ item: value, storageKey, index });
            return;
        }
        Object.entries(value).forEach(([key, child]) => {
            visit(child, storageKey ? `${storageKey}::${key}` : key);
        });
    };
    visit(history);
    return records;
}

function reviewHistoryRecordMatchesSubject(record, normalizedSubject) {
    const metadataKeys = [record.item.subjectKey, record.item.subject, record.item.subject_key, record.item.subjectId, record.item.subject_id];
    if (metadataKeys.some((key) => key && normalizeSubjectKey(key) === normalizedSubject)) return true;

    const compositeKeys = [record.storageKey, record.item.quizId, record.item.quiz_id];
    return compositeKeys.some((key) => String(key || "").split("::").some((segment) => normalizeSubjectKey(segment) === normalizedSubject));
}

function getReviewHistoryRecords() {
    const sources = [
        window.quizAttemptHistoryStore?.getHistorySync(),
        safeParseStoredValue("quiz_attempt_history", {}),
        safeParseStoredValue("test_results", []),
        safeParseStoredValue("quizResults", []),
        safeParseStoredValue("quiz_results", [])
    ];
    const records = [];
    const seen = new Set();
    sources.forEach((source) => {
        collectReviewHistoryRecords(source).forEach((record) => {
            const item = record.item;
            const identity = [
                item.quizId || item.quiz_id || record.storageKey,
                item.attempt || item.attemptNumber || record.index,
                item.completedAt || "",
                item.chapter || "",
                item.finalScore ?? item.score ?? ""
            ].join("::");
            if (seen.has(identity)) return;
            seen.add(identity);
            records.push(record);
        });
    });
    return records;
}

function getAttemptedReviewSections() {
    const normalizedSubject = normalizeSubjectKey(subject);
    if (!reviewSubjects.has(normalizedSubject)) return [];

    const grouped = new Map();
    getReviewHistoryRecords().forEach((record) => {
        const attempt = record.item;
        if (!reviewHistoryRecordMatchesSubject(record, normalizedSubject) || !attempt.chapter || Number(attempt.total) <= 0) return;
        const completedAt = new Date(attempt.completedAt || 0).getTime();
        if (!Number.isFinite(completedAt)) return;
        const historyQuizId = attempt.quizId || attempt.quiz_id || record.storageKey;
        const isSectional = String(historyQuizId || "").trim().toLowerCase().startsWith("mock::sectional::")
            || normalizeSubjectKey(attempt.source) === "sectional";
        const reviewGroup = normalizedSubject === "mock" ? (isSectional ? "sectional" : "fullLength") : "";
        const key = reviewGroup
            ? `${normalizedSubject}::${reviewGroup}::${attempt.chapter}`
            : `${normalizedSubject}::${attempt.chapter}`;
        const attemptWithNumber = {
            ...attempt,
            quizId: historyQuizId,
            attempt: Number(attempt.attempt ?? attempt.attemptNumber) || record.index + 1
        };
        const current = grouped.get(key);
        const marks = Number(attemptWithNumber.finalScore ?? attemptWithNumber.score ?? 0);
        const currentMarks = current ? Number(current.best.finalScore ?? current.best.score ?? 0) : 0;
        if (!current || marks > currentMarks || (marks === currentMarks && completedAt > current.completedAt)) {
            grouped.set(key, { chapter: attempt.chapter, best: attemptWithNumber, completedAt, reviewGroup });
        }
    });

    return [...grouped.values()].sort((a, b) => b.completedAt - a.completedAt);
}

async function renderAttemptedReviewSections() {
    if (!chapterList) return;
    if (window.quizAttemptHistoryStore?.getHistory) {
        try {
            await window.quizAttemptHistoryStore.getHistory();
        } catch (error) {
        }
    }
    const sections = getAttemptedReviewSections();
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid", "review-section-list");
    if (!sections.length) {
        chapterList.innerHTML = '<p class="empty-state">No attempted sections yet.</p>';
        return;
    }

    const appendReviewCards = (container, reviewSections) => reviewSections.forEach(({ chapter, best }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chapterBtn subject-chapter-btn review-section-btn";
        button.innerHTML = `<div class="subject-card-content"><span class="subject-card-title">${escapeHtmlReviewText(chapter)}</span></div>`;
        button.onclick = () => {
            const query = new URLSearchParams({
                historical: "1",
                quizId: best.quizId,
                attempt: String(best.attempt),
                returnUrl: `subject.html?${new URLSearchParams({ subject, review: "1" }).toString()}`
            });
            window.location.href = `result-review.html?${query.toString()}`;
        };
        container.appendChild(button);
    });

    if (normalizeSubjectKey(subject) === "mock") {
        const storageKey = `reviewAccordionState:${normalizeSubjectKey(subject)}`;
        let accordionState = {};
        try {
            accordionState = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
        } catch (error) {
            accordionState = {};
        }

        const appendMockReviewGroup = (groupKey, title) => {
            const group = document.createElement("section");
            group.className = "review-accordion-group";
            const heading = document.createElement("h3");
            heading.className = "review-accordion-heading";
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "review-section-toggle";
            const toggleLabel = document.createElement("span");
            toggleLabel.textContent = title;
            const chevron = document.createElement("span");
            chevron.className = "review-section-chevron";
            chevron.setAttribute("aria-hidden", "true");
            chevron.textContent = "▾";
            toggle.append(toggleLabel, chevron);

            const grid = document.createElement("div");
            grid.className = "subject-card-grid review-accordion-grid";
            grid.id = `review-${groupKey}-grid`;
            toggle.setAttribute("aria-controls", grid.id);
            const hasSavedState = Object.prototype.hasOwnProperty.call(accordionState, groupKey);
            const isExpanded = hasSavedState ? Boolean(accordionState[groupKey]) : groupKey === "fullLength";
            toggle.setAttribute("aria-expanded", String(isExpanded));
            grid.hidden = !isExpanded;
            toggle.addEventListener("click", () => {
                const expanded = toggle.getAttribute("aria-expanded") === "true";
                accordionState[groupKey] = !expanded;
                toggle.setAttribute("aria-expanded", String(!expanded));
                grid.hidden = expanded;
                try {
                    localStorage.setItem(storageKey, JSON.stringify(accordionState));
                } catch (error) {
                }
            });

            const groupSections = sections.filter((section) => section.reviewGroup === groupKey);
            if (groupSections.length) {
                appendReviewCards(grid, groupSections);
            } else {
                const empty = document.createElement("p");
                empty.className = "empty-state";
                empty.textContent = "No attempts in this section yet.";
                grid.appendChild(empty);
            }

            heading.appendChild(toggle);
            group.append(heading, grid);
            chapterList.appendChild(group);
        };

        appendMockReviewGroup("fullLength", "Full Length Test");
        appendMockReviewGroup("sectional", "Sectional Test");
        return;
    }

    appendReviewCards(chapterList, sections);
}

function escapeHtmlReviewText(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderClassificationRemovalControls(tag, refresh) {
    const controls = document.getElementById("classificationRemovalControls");
    if (!controls) return;
    controls.hidden = false;
    controls.innerHTML = `
        <label><input type="checkbox" class="classification-select-all"> Select All</label>
        <button type="button" class="btn btn-secondary btn-small classification-remove-selected" disabled>Remove Selected</button>
        <span class="classification-selected-count">0 selected</span>
        <span class="collection-storage-status" role="status" aria-live="polite">${window.quizCollections?.status().durable ? "" : "Changes are temporary. Export a backup before leaving."}</span>
        <button type="button" class="collection-export-button" ${window.quizCollections?.status().durable ? "hidden" : ""}>Export backup</button>
    `;
    window.quizCollections?.attachBackupTools(controls);
    attachRemovalControls(controls, tag, refresh, window.__classificationQuestions || [], subject, "Important Questions");
}

async function buildImportantQuestionsForSubject(subjectKey) {
    const tagBySubject = {
        ancient: "H",
        medieval: "H",
        medeival: "H",
        modern: "H",
        geography: "G",
        polity: "P",
        economy: "E"
    };
    const tag = tagBySubject[String(subjectKey).toLowerCase()];
    if (!tag || !window.quizCollections) return [];
    return (await window.quizCollections.getCollection(tag)).map((record) => record.question);
}

async function loadMockCollectionData() {
    if (mockCollectionData) return;
    try {
        mockCollectionData = await loadJson("data/mock.json");
    } catch (error) {
        mockCollectionData = null;
    }
}

function buildCurrentAffairsQuestions() {
    return originalCurrentAffairsQuestions;
}

async function renderImportantCollectionChapters() {
    if (!chapterList || !window.quizCollections) return;
    await window.quizCollections.ready;

    const tags = ["S", "H", "G", "P", "E", "CA"];
    const collectionTools = document.getElementById("collectionTools");
    const backupStatus = collectionTools?.querySelector("[data-collection-backup-status]");
    const reportNode = document.getElementById("collectionMigrationReport");
    const backupToggle = document.getElementById("collectionBackupToggle");
    const openBackupTools = () => {
        if (collectionTools) collectionTools.hidden = false;
        if (backupToggle) backupToggle.setAttribute("aria-expanded", "true");
    };
    if (collectionTools) {
        window.quizCollections.attachBackupTools(collectionTools);
        await window.quizCollections.ready;
        const storage = window.quizCollections.status();
        const retryButton = document.getElementById("retryCollectionMigrationBtn");
        if (backupStatus) {
            backupStatus.textContent = "";
        }
        if (reportNode) {
            reportNode.textContent = storage.migrationError
                ? `Collection migration failed: ${storage.migrationError} Your existing data remains available for retry or export.`
                : "";
            reportNode.classList.toggle("is-temporary", Boolean(storage.migrationError));
        }
        if (!storage.durable || storage.migrationError) {
            openBackupTools();
            if (backupStatus && !storage.durable) {
                backupStatus.hidden = false;
                backupStatus.textContent = `Collection changes could not be saved: ${storage.message} Existing data is preserved.`;
                backupStatus.classList.add("is-temporary");
            }
        }
        if (retryButton) {
            retryButton.hidden = !storage.migrationError;
            retryButton.onclick = async () => {
                retryButton.disabled = true;
                try {
                    await window.quizCollections.retryMigration();
                    await renderImportantCollectionChapters();
                } catch (error) {
                    console.error("Unable to retry collection migration.", error);
                    if (reportNode) {
                        reportNode.textContent = `Migration retry failed: ${error.message} Existing data remains available for backup and retry.`;
                    }
                } finally {
                    retryButton.disabled = false;
                }
            };
        }
        const backupButton = document.getElementById("downloadMigrationBackupBtn");
        if (backupButton && backupButton.dataset.migrationBackupBound !== "true") {
            backupButton.dataset.migrationBackupBound = "true";
            backupButton.addEventListener("click", async () => {
                try {
                    await window.quizCollections.downloadMigrationBackup();
                } catch (error) {
                    console.error("Unable to download migration backup.", error);
                    if (reportNode) {
                        reportNode.textContent = `Backup download failed: ${error.message}`;
                    }
                }
            });
        }
    }

    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");
    const returnUrl = `subject.html?${new URLSearchParams({ subject: "important_collections" }).toString()}`;
    tags.forEach((tag) => {
        const title = window.quizCollections.tags[tag];
        const count = window.quizCollections.getCount(tag);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "chapterBtn subject-chapter-btn";
        card.setAttribute("aria-label", `${title}, ${count} question${count === 1 ? "" : "s"}`);
        card.innerHTML = `
            <div class="subject-card-content">
                <span class="subject-card-title">${title}</span>
            </div>
            <small data-collection-count="${tag}">${count} question${count === 1 ? "" : "s"}</small>
        `;
        card.addEventListener("click", () => window.quizCollections.openCollection(tag, title, returnUrl));
        chapterList.appendChild(card);
    });
}

function openCollectionListSession(title, questions, subjectKey = subject, returnChapter = title, classificationTag = null) {
    const returnUrl = `subject.html?${new URLSearchParams({ subject: subjectKey, chapter: returnChapter }).toString()}`;
    const payload = {
        title,
        subject: title,
        subjectKey,
        chapter: title,
        questions,
        returnUrl,
        classificationTag
    };
    sessionStorage.setItem("collectionListPayload", JSON.stringify(payload));
    window.location.href = "collection-list.html";
}

function openImportantQuestionsQuiz(title, questions, subjectKey) {
    const classificationTag = ({
        ancient: "H",
        medieval: "H",
        medeival: "H",
        modern: "H",
        geography: "G",
        polity: "P",
        economy: "E"
    })[String(subjectKey).toLowerCase()];
    openCollectionListSession(title, questions, subjectKey, "Important Questions", classificationTag);
}

function renderSubjectCardButton(targetName, targetType, mockSource = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = targetType === "mock" ? "chapterBtn subject-set-btn" : "chapterBtn subject-chapter-btn";

    const progress = getResumeProgressForTarget(targetName, mockSource);
    if (targetType === "mock" && (progress || hasCompletedMockAttempt(targetName, mockSource))) {
        button.classList.add("mock-attempted");
    }
    const actionText = targetType === "mock"
        ? (progress ? "Resume Mock Test" : "Start Mock Test")
        : (progress ? "Resume" : "Start Practice");

    button.innerHTML = `
        <div class="subject-card-content">
            <span class="subject-card-title">${targetName}</span>
        </div>
        <small>${actionText}</small>
    `;
    button.onclick = function () {
        const query = new URLSearchParams({ subject, chapter: targetName });
        if (targetType === "mock" && mockSource === "sectional") {
            query.set("source", "sectional");
        }
        window.location.href = `quiz.html?${query.toString()}`;
    };
    return button;
}

function collectMockSetNames(data) {
    const nested = data && typeof data === "object" ? data["TEST NUMBER"] : null;
    if (!nested || typeof nested !== "object") {
        return [];
    }
    return Object.keys(nested).filter((name) => Boolean(name));
}

function openClassifiedReviewSession(title, questions, subjectKey = subject) {
    openCollectionListSession(title, questions, subjectKey);
}

function renderClassifiedCollection(title, questions, subjectKey) {
    // Visible classified question rows are rendered here into #chapterList.
    if (!chapterList) return;
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    const tagBySubject = { modern: "H", geography: "G", polity: "P", economy: "E", current_affairs: "CA" };
    tagBySubject.ancient = "H";
    tagBySubject.medieval = "H";
    tagBySubject.medeival = "H";
    const classificationTag = tagBySubject[subjectKey];

    if (!questions.length) {
        const controls = document.getElementById("classificationRemovalControls");
        if (controls) {
            controls.hidden = true;
            controls.innerHTML = "";
        }
        chapterList.innerHTML = `<p class="empty-state">No ${title} questions saved yet.</p>`;
        return;
    }

    window.__classificationQuestions = questions;

    questions.forEach((question, index) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "classification-question-checkbox";
        checkbox.dataset.classificationKey = classificationTag
            ? getClassificationKeyForRemoval(question, classificationTag, {
                sourceSubjectKey: subjectKey,
                subject: title,
                chapter: question?._source?.chapter || question?._pyqChapter || title,
                questionIndex: question?._source?.questionIndex ?? question?._pyqQuestionIndex ?? index,
                sourceJsonFile: question?._source?.sourceJsonFile
            })
            : "";
        checkbox.setAttribute("aria-label", `Select question ${index + 1}`);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "chapterBtn subject-chapter-btn";
        card.style.flex = "1";
        card.innerHTML = `
            <div class="subject-card-content">
                <span class="subject-card-title">Q${index + 1}</span>
            </div>
            <small>${String(question.q || question.question || question.questionText || question.prompt || "Question").slice(0, 58)}</small>
        `;
        card.onclick = function () {
            if (["ancient", "medieval", "medeival", "modern", "geography", "polity", "economy"].includes(subjectKey)) {
                openImportantQuestionsQuiz(title, questions, subjectKey, index);
                return;
            }
            openCollectionListSession(title, questions, subjectKey, title, classificationTag);
        };
        row.appendChild(checkbox);
        row.appendChild(card);
        chapterList.appendChild(row);
    });
    if (classificationTag) {
        renderClassificationRemovalControls(classificationTag, () => loadSubjectContent());
    }
}

async function loadSubjectContent() {
    await window.quizCollections?.ready;
    const selectedChapter = new URLSearchParams(window.location.search).get("chapter");

    if (subject === "important_collections") {
        await renderImportantCollectionChapters();
        return;
    }

    if (selectedChapter === "Important Questions") {
        window.location.replace("subject.html?subject=important_collections");
        return;
    }

    if (!selectedChapter && new URLSearchParams(window.location.search).get("review") === "1") {
        await renderAttemptedReviewSections();
        return;
    }

    if (subject === "current_affairs") {
        if (!chapterList) return;
        chapterList.innerHTML = "";
        chapterList.classList.add("subject-card-grid");
        chapterList.innerHTML = `
            <p class="empty-state">Important Current Affairs Questions are available in
                <a href="subject.html?subject=important_collections">Important Collections</a>.
            </p>
        `;
        return;
    }

    const meta = await getSubjectMetaMap();
    const fileName = (meta && meta[subject] && meta[subject].file) || `${subject}.json`;

    try {
        const data = await loadJson(`data/${fileName}`);
        subjectData = data;
        if (subject === "mock") {
            const setNames = collectMockSetNames(data);
            let sectionalSetNames = [];
            try {
                const sectionalData = await loadJson("data/sectional.json");
                sectionalSetNames = collectMockSetNames(sectionalData);
            } catch (error) {
                sectionalSetNames = [];
            }
            renderMockSets(setNames, sectionalSetNames);
            return;
        }

        const chapters = data && data.chapters ? Object.keys(data.chapters) : [];
        await renderChapters(chapters);
    } catch (error) {
        if (chapterList) {
            if (subject === "mock") {
                chapterList.innerHTML = '<p class="empty-state">Mock Test sets are currently unavailable.</p>';
            } else {
                chapterList.innerHTML = '<p class="empty-state">No chapters are available for this subject.</p>';
            }
        }
    }
}

async function renderChapters(chapters) {
    if (!chapterList) {
        return;
    }
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    if (!chapters.length) {
        chapterList.innerHTML = '<p class="empty-state">No chapters are available for this subject.</p>';
        return;
    }

    const uniqueChapters = [...new Set(chapters.filter(Boolean))];
    for (const chapterName of uniqueChapters) {
        const button = renderSubjectCardButton(chapterName, "chapter");
        chapterList.appendChild(button);
    }
}

function renderMockSets(setNames, sectionalSetNames = []) {
    if (!chapterList) {
        return;
    }
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    function createSectionHeader(title, grid) {
        const header = document.createElement("h3");
        header.className = "mock-section-header";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "mock-section-toggle";
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-controls", grid.id);
        toggle.innerHTML = `<span>${title}</span><span class="mock-section-chevron" aria-hidden="true">▾</span>`;
        toggle.addEventListener("click", () => {
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            toggle.setAttribute("aria-expanded", String(!expanded));
            grid.hidden = expanded;
        });
        header.appendChild(toggle);
        return header;
    }

    const fullLengthWrapper = document.createElement("div");
    fullLengthWrapper.className = "mock-section-group";

    const fullLengthGrid = document.createElement("div");
    fullLengthGrid.className = "subject-card-grid mock-set-grid";
    fullLengthGrid.id = "mockFullLengthGrid";
    fullLengthWrapper.appendChild(createSectionHeader("Full Length Test", fullLengthGrid));

    if (!setNames.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Mock Test sets are currently unavailable.";
        fullLengthGrid.appendChild(empty);
    } else {
        setNames.forEach((setName) => {
            fullLengthGrid.appendChild(renderSubjectCardButton(setName, "mock"));
        });
    }

    fullLengthWrapper.appendChild(fullLengthGrid);
    chapterList.appendChild(fullLengthWrapper);

    const sectionalWrapper = document.createElement("div");
    sectionalWrapper.className = "mock-section-group";

    const sectionalGrid = document.createElement("div");
    sectionalGrid.className = "subject-card-grid mock-set-grid";
    sectionalGrid.id = "mockSectionalGrid";
    sectionalWrapper.appendChild(createSectionHeader("Sectional Test", sectionalGrid));

    if (!sectionalSetNames.length) {
        const sectionalEmpty = document.createElement("p");
        sectionalEmpty.className = "empty-state";
        sectionalEmpty.textContent = "No sectional tests available yet.";
        sectionalGrid.appendChild(sectionalEmpty);
    } else {
        sectionalSetNames.forEach((setName) => {
            sectionalGrid.appendChild(renderSubjectCardButton(setName, "mock", "sectional"));
        });
    }

    sectionalWrapper.appendChild(sectionalGrid);
    chapterList.appendChild(sectionalWrapper);
}

(async function initSubjectPage(){
    const storagePromise = loadServerCollections().catch(() => {});
    const meta = await getSubjectMetaMap();
    const title = (meta && meta[subject] && meta[subject].title) || (subject === "current_affairs" ? "Current Affairs" : subject);
    const subjectTitle = document.getElementById("subjectTitle");
    if (subjectTitle) {
        subjectTitle.innerText = subject === "important_collections" ? "Important Collections" : title;
    }

    const heading = document.getElementById("sectionHeading");
    if (heading) {
        heading.textContent = subject === "important_collections"
            ? "Important Collections"
            : (subject === "mock" ? "Mock Test Sets" : (subject === "current_affairs" ? "Current Affairs" : "Chapter Wise Practice"));
    }

    const collectionTools = document.getElementById("collectionTools");
    const collectionBackupToggle = document.getElementById("collectionBackupToggle");
    if (collectionTools) collectionTools.hidden = true;
    if (collectionBackupToggle) {
        collectionBackupToggle.hidden = subject !== "important_collections";
        collectionBackupToggle.setAttribute("aria-expanded", "false");
        collectionBackupToggle.onclick = () => {
            const expanded = collectionTools ? collectionTools.hidden : false;
            if (collectionTools) collectionTools.hidden = !expanded;
            collectionBackupToggle.setAttribute("aria-expanded", String(expanded));
        };
    }

    if (subjectReviewBtn && reviewSubjects.has(subject)) {
        subjectReviewBtn.hidden = false;
        subjectReviewBtn.onclick = () => {
            const query = new URLSearchParams({ subject, review: "1" });
            window.location.href = `subject.html?${query.toString()}`;
        };
    }

    const selectedChapter = new URLSearchParams(window.location.search).get("chapter");
    const isReviewView = new URLSearchParams(window.location.search).get("review") === "1";
    if (subject === "mock" && isReviewView && window.quizAttemptHistoryStore) {
        await window.quizAttemptHistoryStore.getHistory();
    }
    if (subject === "current_affairs" || subject === "important_collections") await storagePromise;
    await loadSubjectContent();
    subjectPageRendered = true;
    if (subjectPendingStorageRefresh) await loadSubjectContent();
})();

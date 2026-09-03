function getClassificationStoreForRemoval() {
    try {
        return JSON.parse(localStorage.getItem("questionClassifications") || "{}");
    } catch (error) {
        return {};
    }
}

function saveClassificationStoreForRemoval(store) {
    localStorage.setItem("questionClassifications", JSON.stringify(store));
}

function getClassificationKeyForRemoval(question, tag) {
    const stableId = String(question?.id ?? question?.qid ?? question?.questionId ?? question?._id ?? question?.questionID ?? question?.question_id ?? "");
    const store = getClassificationStoreForRemoval();
    const match = Object.entries(store).find(([, entry]) => {
        if (!entry || !entry[tag] || !entry.question) return false;
        const entryIds = [
            entry.question.id,
            entry.question.qid,
            entry.question.questionId,
            entry.question._id,
            entry.question.questionID,
            entry.question.question_id,
            entry.questionId
        ].filter((value) => value !== undefined && value !== null).map(String);
        return stableId ? entryIds.includes(stableId) : entry.question.q === question?.q;
    });
    if (match) return match[0];
    const source = question?._source || {};
    const subjectKey = source.sourceSubjectKey || question?._pyqSubjectKey || "";
    const chapter = source.chapter || question?._pyqChapter || "";
    const questionIndex = source.questionIndex ?? question?._pyqQuestionIndex ?? "";
    return subjectKey ? `${subjectKey}::${chapter}::${questionIndex}` : "";
}

function removeClassificationEntries(keys, tag) {
    const store = getClassificationStoreForRemoval();
    console.debug("Removing classified questions", { tag, selectedKeys: keys, savedEntries: Object.entries(store).filter(([, entry]) => entry && entry.S) });
    keys.forEach((key) => {
        const entry = store[key];
        if (!entry) return;
        delete entry[tag];
        if (!Object.keys(entry).some((label) => ["S", "H", "G", "P", "E", "CA"].includes(label) && entry[label])) {
            delete store[key];
        } else {
            store[key] = entry;
        }
    });
    saveClassificationStoreForRemoval(store);
    console.debug("Saved classification entries after removal", Object.entries(store).filter(([, entry]) => entry && entry.S));
}

function updateRemovalControls(container) {
    const root = container.parentElement || container;
    const checkboxes = Array.from(root.querySelectorAll(".classification-question-checkbox"));
    const selected = checkboxes.filter((checkbox) => checkbox.checked);
    const selectAll = container.querySelector(".classification-select-all");
    const removeButton = container.querySelector(".classification-remove-selected");
    const count = container.querySelector(".classification-selected-count");
    if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
    }
    if (removeButton) removeButton.disabled = selected.length === 0;
    if (count) count.textContent = `${selected.length} selected`;
}

function attachRemovalControls(container, tag, onRemoved, questions = [], sourceSubjectKey = "", chapter = "") {
    const root = container.parentElement || container;
    const selectAll = container.querySelector(".classification-select-all");
    const removeButton = container.querySelector(".classification-remove-selected");
    const checkboxes = root.querySelectorAll(".classification-question-checkbox");
    checkboxes.forEach((checkbox) => checkbox.addEventListener("change", () => updateRemovalControls(container)));
    selectAll?.addEventListener("change", () => {
        checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
        updateRemovalControls(container);
    });
    removeButton?.addEventListener("click", () => {
        const selectedKeys = Array.from(root.querySelectorAll(".classification-question-checkbox:checked"))
            .map((checkbox) => checkbox.dataset.classificationKey)
            .filter(Boolean);
        if (!selectedKeys.length) return;
        if (!window.confirm(`Remove ${selectedKeys.length} selected question${selectedKeys.length === 1 ? "" : "s"} from this collection?`)) return;
        removeClassificationEntries(selectedKeys, tag);
        selectedKeys.forEach((key) => {
            const index = Array.from(root.querySelectorAll(".classification-question-checkbox"))
                .findIndex((checkbox) => checkbox.dataset.classificationKey === key);
            const question = questions[index];
            if (question && typeof queueQuizPendingChange === "function") {
                queueQuizPendingChange({
                    operationType: tag === "S" ? "saved-question" : "classification",
                    ...quizPendingQuestionSource(question, sourceSubjectKey, chapter, index),
                    tag: tag === "S" ? undefined : tag,
                    active: false
                });
            }
        });
        onRemoved(selectedKeys);
    });
    updateRemovalControls(container);
}

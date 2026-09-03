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

    const sourceSubjectKey = question?._source?.sourceSubjectKey ?? question?._pyqSubjectKey ?? question?.source?.sourceSubjectKey ?? "";
    const chapter = question?._source?.chapter ?? question?._pyqChapter ?? question?.source?.chapter ?? "";
    const questionIndex = question?._source?.questionIndex ?? question?._pyqQuestionIndex ?? question?.source?.questionIndex ?? "";
    const questionId = question?._source?.questionId ?? question?._pyqQuestionId ?? question?.source?.questionId ?? stableId;
    if (sourceSubjectKey || chapter || questionIndex !== "" || questionId) {
        return `api:${tag}:${sourceSubjectKey}:${chapter}:${questionIndex}:${questionId ?? ""}`;
    }

    return "";
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

async function removeQuestionsWithAPI(questions, indices, tag, targetSubjectKey = null, originalMockTestSet = null) {
    const store = getClassificationStoreForRemoval();
    
    // Build API requests for selected questions
    const requests = [];
    for (const index of indices) {
        if (index < 0 || index >= questions.length) continue;
        
        const question = questions[index];
        
        // Extract source information from the question object itself (API format)
        // Priority: _source (API format) > _pyq* fields > entry from localStorage
        let sourceSubjectKey, chapter, questionId, questionIndex;
        
        if (question._source) {
            // API format with _source object
            sourceSubjectKey = question._source.sourceSubjectKey || "mock";
            chapter = question._source.chapter || "";
            questionId = question._source.questionId || null;
            questionIndex = question._source.questionIndex !== undefined ? question._source.questionIndex : index;
        } else if (question._pyqSubjectKey) {
            // API format with _pyq* fields
            sourceSubjectKey = question._pyqSubjectKey || "mock";
            chapter = question._pyqChapter || "";
            questionId = question._pyqQuestionId || null;
            questionIndex = question._pyqQuestionIndex !== undefined ? question._pyqQuestionIndex : index;
        } else {
            // Fallback: try localStorage entry
            const key = getClassificationKeyForRemoval(question, tag);
            const entry = store[key];
            
            if (!entry) continue;
            
            sourceSubjectKey = entry.sourceSubjectKey || entry.subjectKey || entry.source?.sourceSubjectKey || "mock";
            chapter = entry.chapter || entry.source?.chapter || "";
            questionId = entry.questionId || entry.source?.questionId || entry.question?.id || null;
            questionIndex = entry.questionIndex !== undefined ? entry.questionIndex : index;
        }
        
        const payload = {
            sourceSubjectKey,
            chapter,
            questionId: questionId === undefined ? null : questionId,
            questionIndex: questionIndex,
            tag,
            active: false
        };
        
        if (targetSubjectKey) {
            payload.targetSubjectKey = targetSubjectKey;
        }
        
        if (originalMockTestSet) {
            payload.originalMockTestSet = originalMockTestSet;
        }
        
        requests.push({
            question,
            key: `${sourceSubjectKey}::${chapter}::${questionIndex}`,
            payload,
            endpoint: tag === "CA" ? "api/current-affairs" : "api/important-classifications"
        });
    }
    
    // Execute API requests
    const results = [];
    for (const req of requests) {
        try {
            const apiUrl = typeof quizApiUrl === 'function' 
                ? quizApiUrl(req.endpoint) 
                : `http://127.0.0.1:8000/${req.endpoint}`;
            
            const response = await fetch(apiUrl, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.payload)
            });
            
            let payload;
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error("The server returned an invalid response.");
            }
            
            if (!response.ok) {
                throw new Error(payload?.error || `Failed to remove question (HTTP ${response.status})`);
            }
            
            results.push({ success: true, key: req.key });
        } catch (error) {
            console.error("API removal failed for question:", { key: req.key, error: error.message });
            results.push({ success: false, key: req.key, error: error.message });
        }
    }
    
    return results;
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

function attachRemovalControls(container, tag, onRemoved, questions = null, targetSubjectKey = null, originalMockTestSet = null) {
    const root = container.parentElement || container;
    const selectAll = container.querySelector(".classification-select-all");
    const removeButton = container.querySelector(".classification-remove-selected");
    const checkboxes = root.querySelectorAll(".classification-question-checkbox");
    checkboxes.forEach((checkbox) => checkbox.addEventListener("change", () => updateRemovalControls(container)));
    selectAll?.addEventListener("change", () => {
        checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
        updateRemovalControls(container);
    });
    removeButton?.addEventListener("click", async () => {
        const selectedKeys = Array.from(root.querySelectorAll(".classification-question-checkbox:checked"))
            .map((checkbox) => checkbox.dataset.classificationKey)
            .filter(Boolean);
        if (!selectedKeys.length) return;
        if (!window.confirm(`Remove ${selectedKeys.length} selected question${selectedKeys.length === 1 ? "" : "s"} from this collection?`)) return;
        
        removeButton.disabled = true;
        removeButton.textContent = "Removing...";
        
        try {
            // If questions array is provided, use API-based removal
            if (questions && Array.isArray(questions)) {
                const store = getClassificationStoreForRemoval();
                const indices = [];
                for (const key of selectedKeys) {
                    for (let i = 0; i < questions.length; i++) {
                        if (getClassificationKeyForRemoval(questions[i], tag) === key) {
                            indices.push(i);
                            break;
                        }
                    }
                }
                
                if (indices.length > 0) {
                    const results = await removeQuestionsWithAPI(questions, indices, tag, targetSubjectKey, originalMockTestSet);
                    const failedResults = results.filter(r => !r.success);
                    
                    if (failedResults.length > 0) {
                        const errorMessages = failedResults.map(r => r.error).join(", ");
                        throw new Error(`Failed to remove some questions: ${errorMessages}`);
                    }
                    
                    // Only update localStorage after successful API removal
                    removeClassificationEntries(selectedKeys, tag);
                } else {
                    // Fallback if no matching indices found
                    removeClassificationEntries(selectedKeys, tag);
                }
            } else {
                // Fallback for legacy removals without questions array (e.g., saved questions)
                removeClassificationEntries(selectedKeys, tag);
            }
            
            removeButton.textContent = "Remove Selected";
            onRemoved(selectedKeys);
        } catch (error) {
            console.error("Removal failed:", error);
            alert(`Error removing questions: ${error.message}`);
            removeButton.textContent = "Remove Selected";
            updateRemovalControls(container);
        } finally {
            removeButton.disabled = false;
        }
    });
    updateRemovalControls(container);
}

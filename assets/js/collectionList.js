// Parse the collection payload from sessionStorage
const collectionPayload = (() => {
    try {
        return JSON.parse(sessionStorage.getItem("collectionListPayload") || "null");
    } catch (error) {
        return null;
    }
})();

// Redirect to dashboard if no payload
if (!collectionPayload || !Array.isArray(collectionPayload.questions)) {
    window.location.href = "dashboard.html";
}

const pageTitle = document.getElementById("pageTitle");
const collectionTitle = document.getElementById("collectionTitle");
const collectionSubtitle = document.getElementById("collectionSubtitle");
const questionsList = document.getElementById("questionsList");
const backBtn = document.getElementById("backBtn");
const logoutBtn = document.getElementById("logoutBtn");
const removalControls = document.getElementById("classificationRemovalControls");
const readerStorageStatus = document.getElementById("collectionReaderStorageStatus");

// Set page title and collection name
if (collectionTitle) {
    collectionTitle.textContent = collectionPayload.title || "Questions";
}

if (collectionSubtitle) {
    const count = collectionPayload.questions.length;
    collectionSubtitle.textContent = `${count} question${count !== 1 ? "s" : ""} available`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getQuestionMembershipKey(question, index, tag) {
    const source = question?._collectionSource || question?._source || {};
    return getClassificationKeyForRemoval(question, tag, {
        sourceSubjectKey: source.sourceSubjectKey || question?._pyqSubjectKey || collectionPayload.subjectKey,
        subject: collectionPayload.subject,
        chapter: source.chapter || question?._pyqChapter || collectionPayload.chapter,
        questionIndex: source.questionIndex ?? question?._pyqQuestionIndex ?? index,
        sourceJsonFile: source.sourceJsonFile
    });
}

function renderQuestionSource(question) {
    const storedSource = question?.source;
    const sourceLabel = typeof storedSource === "string"
        ? storedSource
        : (storedSource && typeof storedSource === "object" && !storedSource.sourceSubjectKey
            ? storedSource.label || storedSource.name || storedSource.title || storedSource.text || storedSource.url || ""
            : "");
    const sourceText = sourceLabel || question?.sourceText || question?.sourceName || question?.reference || question?.citation || "";
    return sourceText
        ? `<p class="collection-reader-source"><strong>Source:</strong> ${escapeHtml(sourceText)}</p>`
        : "";
}

function renderQuestionsList() {
    if (!questionsList) return;

    if (collectionSubtitle) {
        const count = collectionPayload.questions.length;
        collectionSubtitle.textContent = `${count} question${count !== 1 ? "s" : ""} available`;
    }

    if (!collectionPayload.questions.length) {
        if (removalControls) removalControls.hidden = true;
        questionsList.innerHTML = '<div class="empty-state">No questions in this collection.</div>';
        return;
    }

    const collectionTag = collectionPayload.collectionTag || collectionPayload.classificationTag;
    if (collectionTag && removalControls) {
        removalControls.hidden = false;
        removalControls.innerHTML = `
            <label><input type="checkbox" class="classification-select-all"> Select All</label>
            <button type="button" class="btn btn-secondary btn-small classification-remove-selected" disabled>Remove Selected</button>
            <span class="classification-selected-count">0 selected</span>
            <span class="collection-storage-status" role="status" aria-live="polite"></span>
        `;
    }

    const questionKeys = collectionPayload.questions.map((question, index) => getQuestionMembershipKey(question, index, collectionTag || ""));
    questionsList.innerHTML = collectionPayload.questions.map((question, index) => {
        const source = question?._collectionSource || question?._source || {};
        const context = {
            sourceSubjectKey: source.sourceSubjectKey || question?._pyqSubjectKey || collectionPayload.subjectKey,
            subject: collectionPayload.subject,
            chapter: source.chapter || question?._pyqChapter || collectionPayload.chapter,
            questionIndex: source.questionIndex ?? question?._pyqQuestionIndex ?? index,
            sourceJsonFile: source.sourceJsonFile
        };
        const sectionalMatching = String(context.sourceJsonFile || "").toLowerCase() === "sectional.json";
        const readerQuestion = question.q ? question : {
            ...question,
            q: question.question || question.questionText || question.prompt || ""
        };
        const questionHtml = window.QuestionRenderer
            ? window.QuestionRenderer.renderQuestion(readerQuestion, index + 1, {
                interactive: false,
                collectionReader: true,
                sectionalMatching,
                questionNumber: index + 1
            })
            : `<div class="collection-reader-fallback"><h3>Question ${index + 1}</h3><p>${escapeHtml(readerQuestion.q || "Question")}</p></div>`;
        const options = window.QuestionRenderer
            ? window.QuestionRenderer.getQuestionOptions(question, { sectionalMatching, questionNumber: index + 1 })
            : (Array.isArray(question.options) ? question.options : []);
        const answerIndex = Number.isInteger(question.answer) ? question.answer : null;
        const answerHtml = answerIndex !== null && options[answerIndex] !== undefined
            ? `<strong>Correct answer:</strong> ${String.fromCharCode(65 + answerIndex)}. ${escapeHtml(options[answerIndex])}`
            : "<strong>Correct answer:</strong> Not available for this question.";
        const explanationDocument = question.explanationDocument || question.explanation || "";
        const renderedExplanation = window.ExplanationRenderer && explanationDocument
            ? window.ExplanationRenderer.renderExplanationDocument(explanationDocument, question.explanation || "")
            : (typeof explanationDocument === "string" && explanationDocument
                ? `<p>${escapeHtml(explanationDocument)}</p>`
                : (question.explanation ? `<p>${escapeHtml(String(question.explanation))}</p>` : ""));
        return `
            <article class="collection-reader-question" data-question-index="${index}">
                <input type="checkbox" class="classification-question-checkbox" data-classification-key="${escapeHtml(questionKeys[index])}" aria-label="Select question ${index + 1} for removal">
                <div class="collection-reader-question-content">
                    ${questionHtml}
                    ${renderQuestionSource(question)}
                    <section class="collection-reader-reveal" data-reader-reveal hidden aria-live="polite">
                        <div class="collection-reader-answer">${answerHtml}</div>
                        <div class="collection-reader-explanation"><strong>Explanation:</strong>${renderedExplanation || "<p>Explanation is not available for this question.</p>"}</div>
                    </section>
                </div>
            </article>
        `;
    }).join("");

    window.quizCollections?.attachControls(questionsList, (button) => {
        const row = button.closest(".collection-reader-question");
        const index = Number(row?.dataset.questionIndex);
        const question = collectionPayload.questions[index];
        return question ? {
            question,
            context: {
                sourceSubjectKey: question?._collectionSource?.sourceSubjectKey || question?._source?.sourceSubjectKey || question?._pyqSubjectKey || collectionPayload.subjectKey,
                subject: collectionPayload.subject,
                chapter: question?._collectionSource?.chapter || question?._source?.chapter || question?._pyqChapter || collectionPayload.chapter,
                questionIndex: question?._collectionSource?.questionIndex ?? question?._source?.questionIndex ?? question?._pyqQuestionIndex ?? index,
                sourceJsonFile: question?._collectionSource?.sourceJsonFile || question?._source?.sourceJsonFile
            }
        } : null;
    });
    if (collectionTag && removalControls) {
        attachRemovalControls(removalControls, collectionTag, (removedKeys, outcomes = []) => {
            if (!removedKeys.length) return;
            collectionPayload.questions = collectionPayload.questions.filter((question, index) => !removedKeys.includes(getQuestionMembershipKey(question, index, collectionTag)));
            renderQuestionsList();
            if (outcomes.some((outcome) => !outcome.durable) && readerStorageStatus) {
                readerStorageStatus.textContent = "Some selected memberships could not be removed permanently. Those questions remain in this reader; export a backup and try again.";
                readerStorageStatus.classList.add("is-temporary");
            } else if (readerStorageStatus && window.quizCollections?.status().durable) {
                readerStorageStatus.textContent = "";
                readerStorageStatus.classList.remove("is-temporary");
            }
            removalControls.querySelector(".classification-remove-selected")?.focus();
        }, collectionPayload.questions, collectionPayload.subjectKey, collectionPayload.chapter);
    }
}

function goBack() {
    // Return to the subject page based on subject/chapter stored in payload
    if (collectionPayload.returnUrl) {
        window.location.href = collectionPayload.returnUrl;
    } else {
        window.location.href = "dashboard.html";
    }
}

backBtn.addEventListener("click", goBack);

questionsList.addEventListener("click", (event) => {
    const option = event.target.closest(".collection-reader-option");
    if (!option || !questionsList.contains(option)) return;
    const card = option.closest(".collection-reader-question");
    const questionIndex = Number(card?.dataset.questionIndex);
    const selectedIndex = Number(option.dataset.readerOption);
    const question = collectionPayload.questions[questionIndex];
    if (!question || !Number.isInteger(selectedIndex)) return;

    const answerIndex = Number.isInteger(question.answer) ? question.answer : null;
    card.querySelectorAll(".collection-reader-option").forEach((button) => {
        const optionIndex = Number(button.dataset.readerOption);
        button.setAttribute("aria-pressed", String(optionIndex === selectedIndex));
        button.classList.toggle("selected-option", optionIndex === selectedIndex);
        button.classList.toggle("correct-option", answerIndex !== null && optionIndex === answerIndex);
        button.classList.toggle("incorrect-option", answerIndex !== null && optionIndex === selectedIndex && selectedIndex !== answerIndex);
    });
    const reveal = card.querySelector("[data-reader-reveal]");
    if (reveal) reveal.hidden = false;
});

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("isAuthenticated");
    window.location.href = "index.html";
});

// Initialize page
window.addEventListener("DOMContentLoaded", async () => {
    await window.quizCollections?.ready;
    window.quizCollections?.attachBackupTools(document.querySelector(".collection-header"));
    const storageStatus = window.quizCollections?.status();
    if (readerStorageStatus && storageStatus && !storageStatus.durable) {
        readerStorageStatus.textContent = `Collection changes are temporary only: ${storageStatus.message} Export a backup before leaving.`;
        readerStorageStatus.classList.add("is-temporary");
    }
    renderQuestionsList();
});

window.addEventListener("quizCollectionsChanged", (event) => {
    const tag = collectionPayload?.collectionTag || collectionPayload?.classificationTag;
    if (event.detail?.durable === false && readerStorageStatus) {
        readerStorageStatus.textContent = `Not saved permanently: ${window.quizCollections.status().message} Export a backup before leaving.`;
        readerStorageStatus.classList.add("is-temporary");
    }
    if (event.detail?.durable === false && tag && !event.detail.tags?.includes(tag)) return;
    if (!tag || !event.detail?.id || event.detail.tags?.includes(tag)) return;
    const index = collectionPayload.questions.findIndex((question, questionIndex) => {
        const source = question?._collectionSource || question?._source || {};
        return window.quizCollections.normalizeSource(question, {
            sourceSubjectKey: source.sourceSubjectKey || question?._pyqSubjectKey || collectionPayload.subjectKey,
            chapter: source.chapter || question?._pyqChapter || collectionPayload.chapter,
            questionIndex: source.questionIndex ?? question?._pyqQuestionIndex ?? questionIndex,
            sourceJsonFile: source.sourceJsonFile
        }).id === event.detail.id;
    });
    if (index >= 0) {
        const row = questionsList.querySelector(`.collection-reader-question[data-question-index="${index}"]`);
        const focusedInsideRow = row?.contains(document.activeElement);
        const nextRow = row?.nextElementSibling || row?.previousElementSibling;
        const scrollTop = window.scrollY;
        collectionPayload.questions.splice(index, 1);
        row?.remove();
        questionsList.querySelectorAll(".collection-reader-question").forEach((item, questionIndex) => {
            item.dataset.questionIndex = String(questionIndex);
            const checkbox = item.querySelector(".classification-question-checkbox");
            if (checkbox) checkbox.setAttribute("aria-label", `Select question ${questionIndex + 1}`);
        });
        if (collectionSubtitle) {
            const count = collectionPayload.questions.length;
            collectionSubtitle.textContent = `${count} question${count !== 1 ? "s" : ""} available`;
        }
        if (!collectionPayload.questions.length) {
            if (removalControls) removalControls.hidden = true;
            questionsList.innerHTML = '<div class="empty-state">No questions in this collection.</div>';
        }
        if (removalControls && collectionPayload.questions.length) updateRemovalControls(removalControls);
        if (focusedInsideRow) {
            (nextRow?.querySelector("[data-collection-tag]") || nextRow?.querySelector(".classification-question-checkbox") || backBtn)?.focus();
        }
        window.scrollTo(0, scrollTop);
    }
});

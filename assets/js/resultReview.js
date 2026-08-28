const urlParams = new URLSearchParams(window.location.search);
const reviewMode = urlParams.get("mode") || "";
const resultKey = reviewMode === "study" ? "quizResult_study" : "quizResult";
const historicalAttemptNumber = Number(urlParams.get("attempt"));
const historicalQuizId = urlParams.get("quizId");
const isHistoricalReview = Boolean(historicalQuizId && historicalAttemptNumber);
const attemptHistory = (() => {
    try { return JSON.parse(localStorage.getItem("quiz_attempt_history") || "{}"); } catch (error) { return {}; }
})();
const historicalAttempt = isHistoricalReview
    ? (attemptHistory[historicalQuizId] || []).find((item) => item.attempt === historicalAttemptNumber)
    : null;
const rawResult = localStorage.getItem(resultKey) || localStorage.getItem("quizResult");
let savedReviewFocus = null;
try {
    savedReviewFocus = JSON.parse(sessionStorage.getItem("savedReviewFocus") || "null");
} catch (error) {
    savedReviewFocus = null;
}
const result = savedReviewFocus
    ? {
        subject: savedReviewFocus.subject,
        subjectKey: savedReviewFocus.subjectKey,
        chapter: savedReviewFocus.chapter,
        total: 1,
        attempted: 0,
        correct: 0,
        wrong: 0,
        skipped: 1,
        accuracy: 0,
        questions: [savedReviewFocus.question],
        userAnswers: [null]
    }
    : (historicalAttempt || (rawResult ? JSON.parse(rawResult) : null));
const savedReviewQuestionIndex = savedReviewFocus ? Number(savedReviewFocus.questionIndex || 0) : null;
if (savedReviewFocus) {
    sessionStorage.removeItem("savedReviewFocus");
}

const reviewSubject = document.getElementById("reviewSubject");
const reviewSubtitle = document.getElementById("reviewSubtitle");
const summaryGrid = document.getElementById("summaryGrid");
const questionPalette = document.getElementById("questionPalette");
const questionReviewList = document.getElementById("questionReviewList");
const prevQuestionBtn = document.getElementById("prevQuestionBtn");
const nextQuestionBtn = document.getElementById("nextQuestionBtn");
const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
const searchInput = document.getElementById("searchInput");
const resultCount = document.getElementById("resultCount");
const savedQuestionsToggle = document.getElementById("savedQuestionsToggle");
const savedQuestionsPanel = document.getElementById("savedQuestionsPanel");
const savedQuestionsList = document.getElementById("savedQuestionsList");
const paletteToggle = document.getElementById("paletteToggle");
const paletteOverlay = document.getElementById("questionPaletteOverlay");
const paletteClose = document.getElementById("paletteClose");
const quickNavigationLabel = document.getElementById("quickNavigationLabel");
const quickNavigationList = document.getElementById("quickNavigationList");
const testHistory = document.getElementById("testHistory");
const historyCount = document.getElementById("historyCount");
const reattemptTestBtn = document.getElementById("reattemptTestBtn");

let activeQuestionIndex = 0;
let activeFilter = "all";
let activeSearchQuery = "";
let editingExplanationIndex = null;
let editingAnswerIndex = null;
window.reviewResultQuestions = result && Array.isArray(result.questions) ? result.questions : [];

function renderTestHistory() {
    if (!testHistory || !result || !result.quizId) return;
    const records = Array.isArray(attemptHistory[result.quizId]) ? attemptHistory[result.quizId] : [];
    if (historyCount) historyCount.innerText = `${records.length} of 5 attempts`;
    testHistory.innerHTML = records.length ? records.slice().reverse().map((item) => `
        <article class="test-history-item${isHistoricalReview && item.attempt === historicalAttemptNumber ? " current-history-item" : ""}">
            <div>
                <strong>Attempt ${item.attempt}</strong>
                <span>${escapeHtml(item.date || new Date(item.completedAt).toLocaleDateString())} • ${escapeHtml(item.time || new Date(item.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
                <span>${item.correct || 0} Correct | ${item.wrong || item.incorrect || 0} Incorrect | ${item.skipped || item.unanswered || 0} Unanswered</span>
            </div>
            <div class="test-history-score">
                <strong>Score: ${item.finalScore ?? item.score ?? 0} / ${item.total || 0}</strong>
                <span>Percentage: ${item.percentage ?? item.accuracy ?? 0}%</span>
                ${isHistoricalReview && item.attempt === historicalAttemptNumber ? "<span class=\"history-readonly-label\">Read-only review</span>" : `<a class="btn btn-secondary btn-small" href="result-review.html?historical=1&quizId=${encodeURIComponent(result.quizId)}&attempt=${item.attempt}">View Attempt</a>`}
            </div>
        </article>
    `).join("") : "<p class=\"history-empty\">No submitted attempts yet.</p>";
}

function startReattempt() {
    if (!result || !Array.isArray(result.questions) || !result.questions.length) {
        return;
    }

    const quizType = result.quizType || (reviewMode === "study" ? "study" : "practice");
    const progressKey = quizType === "study" ? "quizProgress_study" : "quizProgress";
    const quizUrl = result.quizUrl || `quiz.html?subject=${encodeURIComponent(result.subjectKey || result.subject)}${quizType === "study" ? "&mode=study" : ""}`;
    const duration = Number(result.duration) || (quizType === "practice" ? 40 : 7200);
    const progress = {
        subject: result.subjectKey || result.subject,
        subjectKey: result.subjectKey || result.subject,
        chapter: result.chapter || "",
        currentQuestion: 0,
        userAnswers: new Array(result.questions.length).fill(null),
        markedForReview: new Array(result.questions.length).fill(false),
        questions: result.questions,
        remainingTime: duration,
        duration,
        quizType,
        quizStartedAt: Date.now(),
        updatedAt: new Date().toISOString()
    };

    localStorage.setItem(progressKey, JSON.stringify(progress));
    window.location.href = quizUrl;
}

function closePalette() {
    if (!paletteOverlay || !paletteToggle) {
        return;
    }
    paletteOverlay.hidden = true;
    paletteToggle.setAttribute("aria-expanded", "false");
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startEditingExplanation(questionIndex) {
    editingExplanationIndex = questionIndex;
    renderQuestions();
}

function cancelEditingExplanation() {
    editingExplanationIndex = null;
    renderQuestions();
}

function saveEditedExplanation(questionIndex) {
    const explanationInput = document.getElementById(`explanationInput-${questionIndex}`);
    if (!explanationInput || !result.questions[questionIndex]) {
        return;
    }
    const newExplanation = explanationInput.value.trim();
    result.questions[questionIndex].explanation = newExplanation;
    
    // Persist to localStorage
    const resultKey = localStorage.getItem("quizResult") ? "quizResult" : "quizResult_study";
    localStorage.setItem(resultKey, JSON.stringify(result));
    
    editingExplanationIndex = null;
    renderQuestions();
}

function startEditingAnswer(questionIndex) {
    editingAnswerIndex = questionIndex;
    renderQuestions();
}

function cancelEditingAnswer() {
    editingAnswerIndex = null;
    renderQuestions();
}

function saveEditedAnswer(questionIndex) {
    const selectedAnswer = document.querySelector(`input[name="correctAnswer-${questionIndex}"]:checked`);
    if (!selectedAnswer || !result.questions[questionIndex]) {
        return;
    }

    result.questions[questionIndex].answer = Number(selectedAnswer.value);
    localStorage.setItem(resultKey, JSON.stringify(result));
    editingAnswerIndex = null;
    renderQuestions();
    renderPalette();
    renderQuickNavigation();
    updateFilterButtons();
    updateResultCount();
    updateActiveQuestion();
}

function renderSummary() {
    const scoreValue = result.finalScore != null ? result.finalScore : result.score;
    const summaryItems = [
        { label: "Total Questions", value: result.total },
        { label: "Attempted", value: result.attempted },
        { label: "Skipped", value: result.skipped },
        { label: "Correct", value: result.correct },
        { label: "Incorrect", value: result.wrong },
        { label: "Score", value: scoreValue },
        { label: "Accuracy", value: `${result.accuracy}%` },
        { label: "Time Taken", value: formatTime(result.timeTaken || 0) }
    ];

    summaryGrid.innerHTML = summaryItems.map(item => `
        <div class="metric-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
        </div>
    `).join("");
}

function getBookmarks() {
    try {
        return JSON.parse(localStorage.getItem("bookmarks") || "[]");
    } catch (error) {
        return [];
    }
}

function isBookmarked(index) {
    if (isHistoricalReview && Array.isArray(result.bookmarked)) {
        return result.bookmarked.includes(index);
    }
    const bookmarks = getBookmarks();
    const questionIndex = savedReviewQuestionIndex === null ? index : savedReviewQuestionIndex;
    return bookmarks.some((item) => item.subjectKey === (result.subjectKey || result.subject) && item.chapter === result.chapter && item.questionIndex === questionIndex);
}

function toggleSavedQuestion(index) {
        if (isHistoricalReview) return;
    const bookmarks = getBookmarks();
    const subjectKey = result.subjectKey || result.subject;
    const questionIndex = savedReviewQuestionIndex === null ? index : savedReviewQuestionIndex;
    const bookmarkIndex = bookmarks.findIndex((item) => item.subjectKey === subjectKey && item.chapter === result.chapter && item.questionIndex === questionIndex);

    if (bookmarkIndex >= 0) {
        bookmarks.splice(bookmarkIndex, 1);
    } else {
        bookmarks.push({
            subjectKey,
            subject: result.subject,
            chapter: result.chapter,
            questionIndex,
            question: result.questions[index]
        });
    }

    localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
    renderQuestions();
    renderPalette();
    renderQuickNavigation();
    updateFilterButtons();
    renderSavedQuestions();
    updateResultCount();
    updateActiveQuestion();
}

function renderSavedQuestions() {
    if (!savedQuestionsToggle || !savedQuestionsList) {
        return;
    }

    const savedIndexes = result.questions
        .map((question, index) => isBookmarked(index) ? index : null)
        .filter((index) => index !== null);

    savedQuestionsToggle.innerText = `Saved for Revision (${savedIndexes.length})`;
    savedQuestionsList.innerHTML = savedIndexes.length
        ? savedIndexes.map((index) => `<button type="button" class="saved-question-link" data-question-index="${index}">Q${index + 1}</button>`).join("")
        : "<span class=\"saved-questions-empty\">No questions saved yet.</span>";

    savedQuestionsList.querySelectorAll(".saved-question-link").forEach((button) => {
        button.onclick = () => {
            activeQuestionIndex = Number(button.dataset.questionIndex);
            activeFilter = "all";
            updateFilterButtons();
            renderQuestions();
            updateActiveQuestion();
            scrollToQuestion(activeQuestionIndex);
            closePalette();
        };
    });
}

function getQuestionStatus(index) {
    const question = result.questions[index];
    const selected = result.userAnswers[index];
    if (selected == null) {
        return "skipped";
    }
    return selected === question.answer ? "correct" : "incorrect";
}

function renderPalette() {
    questionPalette.innerHTML = "";
    result.questions.forEach((question, index) => {
        const status = getQuestionStatus(index);
        const btn = document.createElement("button");
        btn.className = `palette-btn review-palette-btn ${status}`;
        if (isBookmarked(index)) {
            btn.classList.add("bookmarked");
        }
        if (index === activeQuestionIndex) {
            btn.classList.add("current");
        }
        btn.innerText = index + 1;
        btn.onclick = () => {
            activeQuestionIndex = index;
            if (!isQuestionVisible(index)) {
                activeFilter = "all";
                updateFilterButtons();
                renderQuestions();
            }
            updateActiveQuestion();
            renderQuickNavigation();
            scrollToQuestion(index);
        };
        questionPalette.appendChild(btn);
    });
}

function renderQuickNavigation() {
    if (!quickNavigationLabel || !quickNavigationList) {
        return;
    }

    const labels = {
        all: "All",
        correct: "Correct",
        incorrect: "Incorrect",
        skipped: "Skipped",
        bookmarked: "Bookmarked"
    };
    const visibleIndexes = getVisibleQuestionIndexes();
    quickNavigationLabel.innerText = `${labels[activeFilter] || "All"}:`;
    quickNavigationList.innerHTML = "";

    visibleIndexes.forEach((index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `palette-btn quick-navigation-button ${getQuestionStatus(index)}`;
        button.innerText = index + 1;
        button.classList.toggle("current", index === activeQuestionIndex);
        button.onclick = () => {
            activeQuestionIndex = index;
            updateActiveQuestion();
            renderQuickNavigation();
            scrollToQuestion(index);
        };
        quickNavigationList.appendChild(button);
    });

    if (!visibleIndexes.length) {
        quickNavigationList.innerHTML = "<span class=\"quick-navigation-empty\">None</span>";
    }
}

function normalizeSearchQuery(value) {
    return String(value || "").trim().toLowerCase();
}

function getSearchSource(question, index) {
    const id = question.id ?? question.qid ?? question.questionId ?? "";
    const explanation = question.explanation || "";
    const optionText = question.options ? question.options.join(" ") : "";
    return `${question.q} ${optionText} ${explanation} ${String(id)}`.toLowerCase();
}

function doesQuestionMatchSearch(index) {
    if (!activeSearchQuery) {
        return true;
    }
    const question = result.questions[index];
    return getSearchSource(question, index).includes(activeSearchQuery);
}

function getVisibleQuestionIndexes() {
    const visible = [];
    for (let index = 0; index < result.questions.length; index += 1) {
        if (isQuestionVisible(index) && doesQuestionMatchSearch(index)) {
            visible.push(index);
        }
    }
    return visible;
}

function getFilterCounts() {
    const counts = {
        all: result.questions.length,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        bookmarked: 0
    };

    result.questions.forEach((question, index) => {
        const status = getQuestionStatus(index);
        counts[status] += 1;
        if (isBookmarked(index)) {
            counts.bookmarked += 1;
        }
    });

    return counts;
}

function isQuestionVisible(index) {
    if (activeFilter === "all") {
        return true;
    }

    if (activeFilter === "bookmarked") {
        return isBookmarked(index);
    }

    return getQuestionStatus(index) === activeFilter;
}

function highlightText(text, query) {
    const safeText = escapeHtml(text);
    if (!query) {
        return safeText;
    }
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    return safeText.replace(regex, `<mark class="search-highlight">$1</mark>`);
}

function renderQuestions() {
    const visibleIndexes = getVisibleQuestionIndexes();
    if (!visibleIndexes.length) {
        questionReviewList.innerHTML = `
            <div class="review-item question-card">
                <p>No matching questions found.</p>
            </div>
        `;
        return;
    }
    if (!visibleIndexes.includes(activeQuestionIndex)) {
        activeQuestionIndex = visibleIndexes[0];
    }

    questionReviewList.innerHTML = result.questions.map((question, index) => {
        const visible = visibleIndexes.includes(index);
        const selected = result.userAnswers[index];
        const selectedAnswerText = selected == null ? "Not Attempted" : highlightText(question.options[selected], activeSearchQuery);
        const correctAnswerText = highlightText(question.options[question.answer], activeSearchQuery);
        const status = getQuestionStatus(index);
        const explanation = question.explanation;
        const explanationText = explanation && String(explanation).trim();
        const questionText = highlightText(question.q, activeSearchQuery);
        const saved = isBookmarked(index);
        const answerSectionHtml = isHistoricalReview ? `<p><strong>Correct Answer:</strong> ${correctAnswerText}</p>` : editingAnswerIndex === index
            ? `<div class="answer-editor-section">
                    <strong>Edit Correct Answer</strong>
                    <div class="answer-editor-options">${question.options.map((option, optionIndex) => `
                        <label><input type="radio" name="correctAnswer-${index}" value="${optionIndex}"${optionIndex === question.answer ? " checked" : ""}> ${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</label>
                    `).join("")}</div>
                    <div class="answer-editor-actions">
                        <button type="button" class="btn btn-primary btn-small" onclick="saveEditedAnswer(${index})">Save</button>
                        <button type="button" class="btn btn-tertiary btn-small" onclick="cancelEditingAnswer()">Cancel</button>
                    </div>
                </div>`
            : `<p><strong>Correct Answer:</strong> ${correctAnswerText} <button type="button" class="btn-edit-answer" onclick="startEditingAnswer(${index})">Edit Correct Answer</button></p>`;
        const optionsHtml = question.options.map((option, optionIndex) => {
            const isCorrect = optionIndex === question.answer;
            const isSelected = optionIndex === selected;
            const classes = ["review-option"];
            if (isCorrect) classes.push("correct-option");
            if (isSelected) classes.push("selected-option");
            return `
                <li class="${classes.join(" ")}">
                    <span class="option-label">${String.fromCharCode(65 + optionIndex)}.</span>
                    <span>${highlightText(option, activeSearchQuery)}</span>
                    ${isSelected && !isCorrect ? "<strong class=\"option-tag\">Your choice</strong>" : ""}
                    ${isCorrect ? "<strong class=\"option-tag correct\">Correct answer</strong>" : ""}
                </li>
            `;
        }).join("");

        // Build explanation section with edit capability
        let explanationSectionHtml = "";
        if (isHistoricalReview) {
            explanationSectionHtml = `
                <div class="explanation-box${explanationText ? "" : " missing"}">
                    <strong>Explanation:</strong> ${explanationText ? highlightText(explanationText, activeSearchQuery) : "Explanation is currently unavailable for this question."}
                </div>
            `;
        } else if (editingExplanationIndex === index) {
            // Show edit mode
            explanationSectionHtml = `
                <div class="explanation-editor-section">
                    <div class="explanation-editor-header">
                        <h4>📝 Edit Explanation</h4>
                    </div>
                    <textarea id="explanationInput-${index}" class="explanation-input" placeholder="Enter or edit the explanation for this question..." rows="5">${escapeHtml(explanationText || "")}</textarea>
                    <div class="explanation-editor-actions">
                        <button onclick="saveEditedExplanation(${index})" class="btn-save-explanation">💾 Save Explanation</button>
                        <button onclick="cancelEditingExplanation()" class="btn-cancel-explanation">✕ Cancel</button>
                    </div>
                </div>
            `;
        } else {
            // Show view mode with edit button
            explanationSectionHtml = `
                <div class="explanation-box${explanationText ? "" : " missing"}">
                    <strong>Explanation:</strong> ${explanationText ? highlightText(explanationText, activeSearchQuery) : "Explanation is currently unavailable for this question."}
                    <button onclick="startEditingExplanation(${index})" class="btn-edit-explanation">✎ Edit Explanation</button>
                </div>
            `;
        }

        return `
            <div class="review-item question-card${visible ? "" : " hidden-question"}" data-question-index="${index}">
                <div class="review-card-header">
                    <h3>Q${index + 1}. ${questionText}</h3>
                    <div class="review-card-actions">
                        <button type="button" class="save-question-btn${saved ? " saved" : ""}" onclick="toggleSavedQuestion(${index})"${isHistoricalReview ? " disabled" : ""}>${saved ? "★ Saved" : "☆ Save"}</button>
                        <span class="review-status-pill ${status}">${status === "correct" ? "Correct" : status === "incorrect" ? "Incorrect" : "Not Attempted"}</span>
                    </div>
                </div>
                <ul class="review-options">${optionsHtml}</ul>
                <p><strong>Your Answer:</strong> ${selectedAnswerText}</p>
                ${answerSectionHtml}
                ${explanationSectionHtml}
                ${typeof reviewAiPanelHtml === "function" ? reviewAiPanelHtml(index) : ""}
                ${typeof externalAiPanelHtml === "function" ? externalAiPanelHtml(index) : ""}
            </div>
        `;
    }).join("");
    if (typeof bindReviewAiControls === "function") bindReviewAiControls();
}

function scrollToQuestion(index) {
    const card = questionReviewList.querySelector(`[data-question-index="${index}"]`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function getNextVisibleQuestionIndex() {
    const visibleIndexes = getVisibleQuestionIndexes();
    const currentPosition = visibleIndexes.indexOf(activeQuestionIndex);
    if (currentPosition === -1 || currentPosition === visibleIndexes.length - 1) {
        return null;
    }
    return visibleIndexes[currentPosition + 1];
}

function getPreviousVisibleQuestionIndex() {
    const visibleIndexes = getVisibleQuestionIndexes();
    const currentPosition = visibleIndexes.indexOf(activeQuestionIndex);
    if (currentPosition <= 0) {
        return null;
    }
    return visibleIndexes[currentPosition - 1];
}

function updateFilterButtons() {
    const counts = getFilterCounts();
    const labels = {
        all: "All",
        correct: "Correct",
        incorrect: "Incorrect",
        skipped: "Skipped",
        bookmarked: "Bookmarked"
    };

    filterButtons.forEach((btn) => {
        const filter = btn.dataset.filter;
        const label = labels[filter] || btn.dataset.filter;
        btn.classList.toggle("active", filter === activeFilter);
        btn.innerHTML = `${label} <span class="filter-count">(${counts[filter] || 0})</span>`;
    });
}

function updateQuestionVisibility() {
    const visibleIndexes = new Set(getVisibleQuestionIndexes());
    questionReviewList.querySelectorAll(".review-item").forEach((card) => {
        const cardIndex = Number(card.dataset.questionIndex);
        card.classList.toggle("hidden-question", !visibleIndexes.has(cardIndex));
    });
}

function updateActiveQuestion() {
    const paletteButtons = questionPalette.querySelectorAll("button");
    paletteButtons.forEach((btn, index) => {
        btn.classList.toggle("current", index === activeQuestionIndex);
    });
    const statusButtons = questionReviewList.querySelectorAll(".review-item");
    statusButtons.forEach((card) => {
        const cardIndex = Number(card.dataset.questionIndex);
        card.classList.toggle("active-question", cardIndex === activeQuestionIndex);
    });
}

if (!result) {
    window.location.href = "index.html";
} else {
    reviewSubject.innerText = result.subject || "Quiz Review";
    const chapterLabel = result.chapter && result.chapter.trim() ? result.chapter : "Full Length Test";
    reviewSubtitle.innerText = `${chapterLabel} • Accuracy ${result.accuracy}%`;
    renderTestHistory();
    renderSummary();
    renderPalette();
    renderQuestions();
    updateFilterButtons();
    renderSavedQuestions();
    updateActiveQuestion();
    updateResultCount();
}

if (savedQuestionsToggle) {
    savedQuestionsToggle.onclick = () => {
        const isOpen = savedQuestionsToggle.getAttribute("aria-expanded") === "true";
        savedQuestionsToggle.setAttribute("aria-expanded", String(!isOpen));
        savedQuestionsPanel.hidden = isOpen;
    };
}

if (reattemptTestBtn) {
    reattemptTestBtn.onclick = startReattempt;
}

if (paletteToggle && paletteOverlay) {
    paletteToggle.onclick = () => {
        const isOpen = !paletteOverlay.hidden;
        paletteOverlay.hidden = isOpen;
        paletteToggle.setAttribute("aria-expanded", String(!isOpen));
    };
}

if (paletteClose) {
    paletteClose.onclick = closePalette;
}

if (paletteOverlay) {
    paletteOverlay.addEventListener("click", (event) => {
        if (event.target === paletteOverlay) {
            closePalette();
        }
    });
}

filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        activeFilter = btn.dataset.filter;
        renderQuestions();
        updateFilterButtons();
        renderPalette();
        renderQuickNavigation();
        updateActiveQuestion();
        updateResultCount();
    });
});

if (searchInput) {
    searchInput.addEventListener("input", (event) => {
        activeSearchQuery = normalizeSearchQuery(event.target.value);
        renderQuestions();
        renderQuickNavigation();
        updateResultCount();
        updateActiveQuestion();
    });
}

function updateResultCount() {
    const matchedCount = getVisibleQuestionIndexes().length;
    const totalCount = result.questions.length;
    resultCount.innerText = `Showing ${matchedCount} of ${totalCount} questions`;
}

prevQuestionBtn.onclick = function () {
    const previousIndex = getPreviousVisibleQuestionIndex();
    if (previousIndex !== null) {
        activeQuestionIndex = previousIndex;
        updateActiveQuestion();
        renderQuickNavigation();
        scrollToQuestion(activeQuestionIndex);
    }
};

nextQuestionBtn.onclick = function () {
    const nextIndex = getNextVisibleQuestionIndex();
    if (nextIndex !== null) {
        activeQuestionIndex = nextIndex;
        updateActiveQuestion();
        renderQuickNavigation();
        scrollToQuestion(activeQuestionIndex);
    }
};

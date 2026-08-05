const urlParams = new URLSearchParams(window.location.search);
const reviewMode = urlParams.get("mode") || "";
const resultKey = reviewMode === "study" ? "quizResult_study" : "quizResult";
const rawResult = localStorage.getItem(resultKey) || localStorage.getItem("quizResult");
const result = rawResult ? JSON.parse(rawResult) : null;

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

let activeQuestionIndex = 0;
let activeFilter = "all";
let activeSearchQuery = "";

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
    const bookmarks = getBookmarks();
    return bookmarks.some((item) => item.subjectKey === (result.subjectKey || result.subject) && item.chapter === result.chapter && item.questionIndex === index);
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
            scrollToQuestion(index);
        };
        questionPalette.appendChild(btn);
    });
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

        return `
            <div class="review-item question-card${visible ? "" : " hidden-question"}" data-question-index="${index}">
                <div class="review-card-header">
                    <h3>Q${index + 1}. ${questionText}</h3>
                    <span class="review-status-pill ${status}">${status === "correct" ? "Correct" : status === "incorrect" ? "Incorrect" : "Not Attempted"}</span>
                </div>
                <ul class="review-options">${optionsHtml}</ul>
                <p><strong>Your Answer:</strong> ${selectedAnswerText}</p>
                <p><strong>Correct Answer:</strong> ${correctAnswerText}</p>
                <div class="explanation-box${explanationText ? "" : " missing"}">
                    <strong>Explanation:</strong> ${explanationText ? highlightText(explanationText, activeSearchQuery) : "Explanation is currently unavailable for this question."}
                </div>
            </div>
        `;
    }).join("");
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
    reviewSubtitle.innerText = `${result.chapter || "Chapter"} • Accuracy ${result.accuracy}%`;
    renderSummary();
    renderPalette();
    renderQuestions();
    updateFilterButtons();
    updateActiveQuestion();
    updateResultCount();
}

filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        activeFilter = btn.dataset.filter;
        renderQuestions();
        updateFilterButtons();
        renderPalette();
        updateActiveQuestion();
        updateResultCount();
    });
});

if (searchInput) {
    searchInput.addEventListener("input", (event) => {
        activeSearchQuery = normalizeSearchQuery(event.target.value);
        renderQuestions();
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
        scrollToQuestion(activeQuestionIndex);
    }
};

nextQuestionBtn.onclick = function () {
    const nextIndex = getNextVisibleQuestionIndex();
    if (nextIndex !== null) {
        activeQuestionIndex = nextIndex;
        updateActiveQuestion();
        scrollToQuestion(activeQuestionIndex);
    }
};

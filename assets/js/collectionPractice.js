const collectionPracticePayload = (() => {
    try {
        return JSON.parse(sessionStorage.getItem("collectionPracticePayload") || "null");
    } catch (error) {
        return null;
    }
})();

if (!collectionPracticePayload || !Array.isArray(collectionPracticePayload.questions) || !collectionPracticePayload.questions.length) {
    window.location.href = "dashboard.html";
}

const TIMER_DURATION = 40;
let currentQuestionIndex = 0;
let selectedAnswer = null;
let timeRemaining = TIMER_DURATION;
let timerInterval = null;
let isAnswered = false;

const collectionTitle = document.getElementById("collectionTitle");
const questionCounter = document.getElementById("questionCounter");
const timer = document.getElementById("timer");
const questionBox = document.getElementById("questionBox");
const optionsBox = document.getElementById("optionsBox");
const answerBox = document.getElementById("answerBox");
const resultBanner = document.getElementById("resultBanner");
const correctAnswerBox = document.getElementById("correctAnswerBox");
const explanationBox = document.getElementById("explanationBox");
const nextBtn = document.getElementById("nextBtn");
const exitBtn = document.getElementById("exitBtn");
const logoutBtn = document.getElementById("logoutBtn");
const exitConfirmModal = document.getElementById("exitConfirmModal");
const cancelExitBtn = document.getElementById("cancelExitBtn");
const confirmExitBtn = document.getElementById("confirmExitBtn");
const progressFill = document.getElementById("progressFill");

if (collectionTitle) {
    collectionTitle.textContent = collectionPracticePayload.subject || "Collection Practice";
}

function startTimer() {
    timeRemaining = TIMER_DURATION;
    isAnswered = false;
    
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        timeRemaining--;
        if (timer) timer.textContent = formatTime(timeRemaining);
        
        if (progressFill) {
            const percentage = (timeRemaining / TIMER_DURATION) * 100;
            progressFill.style.width = percentage + "%";
        }
        
        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            onTimeExpired();
        }
    }, 1000);
    
    if (timer) timer.textContent = formatTime(timeRemaining);
    if (progressFill) progressFill.style.width = "100%";
}

function onTimeExpired() {
    isAnswered = true;
    if (selectedAnswer === null) {
        selectedAnswer = "timeout";
    }
    showAnswer();
}

function renderQuestion() {
    const questions = collectionPracticePayload.questions;
    if (currentQuestionIndex >= questions.length) {
        endPracticeSession();
        return;
    }

    const question = questions[currentQuestionIndex];
    
    if (questionCounter) {
        questionCounter.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
    }

    questionBox.innerHTML = `<div class="question-text">${escapeHtml(question.q || question.question || "Question")}</div>`;
    
    optionsBox.innerHTML = (question.options || []).map((option, index) => `
        <button
            type="button"
            class="option-btn"
            data-index="${index}"
            onclick="selectOption(${index})"
            ${isAnswered ? "disabled" : ""}
        >
            <span class="option-label">${String.fromCharCode(65 + index)}.</span>
            <span class="option-text">${escapeHtml(option)}</span>
        </button>
    `).join("");

    answerBox.style.display = "none";
    nextBtn.style.display = "none";
    selectedAnswer = null;
    
    startTimer();
}

function selectOption(index) {
    if (isAnswered) return;
    
    clearInterval(timerInterval);
    selectedAnswer = index;
    isAnswered = true;
    showAnswer();
}

function showAnswer() {
    const question = collectionPracticePayload.questions[currentQuestionIndex];
    const isCorrect = selectedAnswer === question.answer;
    const isTimeout = selectedAnswer === "timeout";

    resultBanner.innerHTML = isTimeout
        ? `<div class="result-timeout">⏱ Time Expired</div>`
        : (isCorrect
            ? `<div class="result-correct">✓ Correct Answer</div>`
            : `<div class="result-incorrect">✗ Incorrect Answer</div>`);

    correctAnswerBox.innerHTML = `
        <div class="answer-section">
            <strong>Correct Answer:</strong>
            <div class="correct-option">${String.fromCharCode(65 + question.answer)}. ${escapeHtml(question.options[question.answer])}</div>
        </div>
    `;

    const explanationText = question.explanationDocument || question.explanation || "";
    let explanationHtml = "";
    
    if (window.ExplanationRenderer && question.explanationDocument) {
        explanationHtml = window.ExplanationRenderer.renderExplanationDocument(question.explanationDocument, question.explanation || "");
    } else if (explanationText) {
        explanationHtml = `<p>${escapeHtml(String(explanationText))}</p>`;
    }

    if (explanationHtml) {
        explanationBox.innerHTML = `
            <div class="explanation-section">
                <strong>Explanation:</strong>
                ${explanationHtml}
            </div>
        `;
    } else {
        explanationBox.innerHTML = "";
    }

    answerBox.style.display = "block";
    nextBtn.style.display = "block";
    
    document.querySelectorAll(".option-btn").forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.remove("selected-option", "correct-option", "incorrect-option");
        
        if (idx === question.answer) {
            btn.classList.add("correct-option");
        } else if (selectedAnswer !== "timeout" && idx === selectedAnswer && !isCorrect) {
            btn.classList.add("incorrect-option");
        }
    });
}

function goToNextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < collectionPracticePayload.questions.length) {
        renderQuestion();
    } else {
        endPracticeSession();
    }
}

function endPracticeSession() {
    if (timerInterval) clearInterval(timerInterval);
    sessionStorage.removeItem("collectionPracticePayload");
    window.location.href = "dashboard.html";
}

nextBtn.addEventListener("click", goToNextQuestion);

exitBtn.addEventListener("click", () => {
    exitConfirmModal.style.display = "flex";
});

cancelExitBtn.addEventListener("click", () => {
    exitConfirmModal.style.display = "none";
});

confirmExitBtn.addEventListener("click", endPracticeSession);

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("isAuthenticated");
    window.location.href = "index.html";
});

window.addEventListener("DOMContentLoaded", () => {
    renderQuestion();
});

window.addEventListener("beforeunload", (e) => {
    if (timerInterval) {
        e.preventDefault();
        e.returnValue = "";
    }
});

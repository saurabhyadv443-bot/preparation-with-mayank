// Parse the collection quiz payload
const collectionQuizPayload = (() => {
    try {
        return JSON.parse(sessionStorage.getItem("collectionQuizPayload") || "null");
    } catch (error) {
        return null;
    }
})();

// Redirect to dashboard if no payload
if (!collectionQuizPayload || !Array.isArray(collectionQuizPayload.questions)) {
    window.location.href = "dashboard.html";
}

// State variables
let currentQuestionIndex = collectionQuizPayload.startingQuestionIndex || 0;
let selectedAnswer = null;
let timeRemaining = 40;
let timerInterval = null;
let isAnswered = false;
let allowFinishNavigation = false;

// DOM elements
const subjectTitle = document.getElementById("subjectTitle");
const chapterTitle = document.getElementById("chapterTitle");
const timer = document.getElementById("timer");
const questionBox = document.getElementById("questionBox");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");
const exitBtn = document.getElementById("exitBtn");
const logoutBtn = document.getElementById("logoutBtn");
const exitConfirmModal = document.getElementById("exitConfirmModal");
const cancelExitBtn = document.getElementById("cancelExitBtn");
const confirmExitBtn = document.getElementById("confirmExitBtn");

// Set header
if (subjectTitle) {
    subjectTitle.textContent = collectionQuizPayload.title || "Collection Quiz";
}

if (chapterTitle) {
    chapterTitle.textContent = collectionQuizPayload.title || "Collection Quiz";
}


function startTimer() {
    // Clear existing timer
    if (timerInterval) clearInterval(timerInterval);
    
    // Reset timer state
    timeRemaining = 40;
    isAnswered = false;
    selectedAnswer = null;
    
    // Update display immediately
    if (timer) timer.textContent = formatTime(timeRemaining);
    if (progressFill) progressFill.style.width = "100%";
    
    // Start countdown
    timerInterval = setInterval(() => {
        timeRemaining--;
        if (timer) timer.textContent = formatTime(timeRemaining);
        
        if (progressFill) {
            const percentage = (timeRemaining / 40) * 100;
            progressFill.style.width = percentage + "%";
        }
        
        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            onTimeExpired();
        }
    }, 1000);
}

function onTimeExpired() {
    isAnswered = true;
    selectedAnswer = "timeout";
    showAnswer();
}

function renderQuestion() {
    const questions = collectionQuizPayload.questions;
    
    // Check if we're at the end
    if (currentQuestionIndex >= questions.length) {
        endPracticeSession();
        return;
    }

    const question = questions[currentQuestionIndex];
    if (!question) {
        endPracticeSession();
        return;
    }

    // Update progress
    if (progressText) {
        progressText.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
    }

    // Clear previous state
    isAnswered = false;
    selectedAnswer = null;

    // Render question with options
    let html = `
        <div class="collection-quiz-columns">
            <div class="collection-quiz-answer">
                <div class="question-header">
                    <h3>Question ${currentQuestionIndex + 1}</h3>
                </div>
                <div class="question-statement">
                    <p>${escapeHtml(String(question.q || question.question || "Question"))}</p>
                </div>
    `;

    const options = question.options || [];
    options.forEach((option, index) => {
        html += `
            <label class="option-wrap">
                <input 
                    type="radio" 
                    name="answer" 
                    value="${index}" 
                    data-index="${index}"
                    onchange="selectOption(${index})"
                />
                <span>${escapeHtml(String(option))}</span>
            </label>
        `;
    });

    // Add answer section placeholder (initially hidden)
    html += `
                <div id="answerSection" style="display:none; margin-top: 24px; padding-top: 16px; border-top: 2px solid #e5e7eb;">
                    <div id="resultBanner" style="padding: 16px; border-radius: 4px; margin-bottom: 16px; font-weight: 600;"></div>
                    <div id="correctAnswerBox" style="padding: 16px; background: #f9fafb; border-radius: 8px; margin-bottom: 16px;">
                        <strong>Correct Answer:</strong>
                        <div id="correctAnswerText" style="padding: 8px 12px; background: #ecfdf5; border-left: 3px solid #059669; margin-top: 8px; border-radius: 4px; color: #047857; font-weight: 500;"></div>
                    </div>
                </div>
            </div>
            <aside id="explanationBox" class="collection-quiz-explanation" style="display:none;"></aside>
        </div>
    `;

    questionBox.innerHTML = html;

    // Start fresh timer for this question
    startTimer();
}

function selectOption(index) {
    // Prevent multiple selections or selections after answer is shown
    if (isAnswered) return;
    
    // Stop the timer and mark as answered
    clearInterval(timerInterval);
    selectedAnswer = index;
    isAnswered = true;
    
    // Disable all option inputs
    document.querySelectorAll('input[name="answer"]').forEach(input => {
        input.disabled = true;
    });
    
    // Show answer
    showAnswer();
}

function showAnswer() {
    const questions = collectionQuizPayload.questions;
    const question = questions[currentQuestionIndex];
    
    // Determine if answer is correct
    const isCorrect = selectedAnswer === question.answer;
    const isTimeout = selectedAnswer === "timeout";

    // Get answer section
    const answerSection = document.getElementById("answerSection");
    const resultBanner = document.getElementById("resultBanner");
    const correctAnswerText = document.getElementById("correctAnswerText");
    const explanationBox = document.getElementById("explanationBox");

    // Set result banner
    if (isTimeout) {
        resultBanner.innerHTML = '<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; color: #b45309;">⏱ Time Expired</div>';
    } else if (isCorrect) {
        resultBanner.innerHTML = '<div style="background: #ecfdf5; border-left: 4px solid #059669; padding: 16px; border-radius: 4px; color: #047857;">✓ Correct Answer</div>';
    } else {
        resultBanner.innerHTML = '<div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 4px; color: #b91c1c;">✗ Incorrect Answer</div>';
    }

    // Set correct answer
    const correctAnswerOption = String(question.options[question.answer] || "");
    correctAnswerText.innerHTML = `${String.fromCharCode(65 + question.answer)}. ${escapeHtml(correctAnswerOption)}`;

    // Set explanation
    const explanationText = question.explanationDocument || question.explanation || "";
    let explanationHtml = "";
    
    if (window.ExplanationRenderer && question.explanationDocument) {
        explanationHtml = window.ExplanationRenderer.renderExplanationDocument(question.explanationDocument, question.explanation || "");
    } else if (explanationText) {
        explanationHtml = `<p>${escapeHtml(String(explanationText))}</p>`;
    }

    if (explanationHtml) {
        explanationBox.innerHTML = `<strong>Explanation:</strong>${explanationHtml}`;
    } else {
        explanationBox.innerHTML = "";
    }
    explanationBox.style.display = explanationHtml ? "block" : "none";

    // Show answer section
    if (answerSection) answerSection.style.display = "block";

    // Update option styling
    document.querySelectorAll('input[name="answer"]').forEach((input, idx) => {
        const label = input.closest("label");
        if (label) {
            label.style.opacity = "1";
            
            if (idx === question.answer) {
                label.style.borderColor = "#059669";
                label.style.background = "#ecfdf5";
            } else if (selectedAnswer !== "timeout" && idx === selectedAnswer && !isCorrect) {
                label.style.borderColor = "#dc2626";
                label.style.background = "#fef2f2";
            }
        }
    });

    // Show next button
    nextBtn.style.display = "inline-flex";
    nextBtn.textContent = currentQuestionIndex === questions.length - 1 ? "✓ Finish" : "Next ➜";
}

function goToNextQuestion() {
    currentQuestionIndex++;
    
    if (currentQuestionIndex < collectionQuizPayload.questions.length) {
        // Render next question (completely fresh)
        renderQuestion();
    } else {
        finishPracticeSession();
    }
}

function finishPracticeSession() {
    allowFinishNavigation = true;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;

    if (collectionQuizPayload.collectionListPayload) {
        sessionStorage.setItem("collectionListPayload", JSON.stringify(collectionQuizPayload.collectionListPayload));
        sessionStorage.removeItem("collectionQuizPayload");
        window.location.href = "collection-list.html";
        return;
    }

    sessionStorage.removeItem("collectionQuizPayload");
    window.location.href = collectionQuizPayload.returnUrl || "dashboard.html";
}

function endPracticeSession() {
    if (timerInterval) clearInterval(timerInterval);
    sessionStorage.removeItem("collectionQuizPayload");
    
    // Return to collection list or subject page
    if (collectionQuizPayload.returnUrl) {
        window.location.href = collectionQuizPayload.returnUrl;
    } else {
        window.location.href = "dashboard.html";
    }
}

function goBack() {
    // Go back to collection list
    if (timerInterval) clearInterval(timerInterval);
    
    // Restore collection list payload
    if (collectionQuizPayload.collectionListPayload) {
        sessionStorage.setItem("collectionListPayload", JSON.stringify(collectionQuizPayload.collectionListPayload));
    }
    
    window.location.href = collectionQuizPayload.returnUrl || "collection-list.html";
}

// Event listeners
nextBtn.addEventListener("click", goToNextQuestion);

backBtn.addEventListener("click", goBack);

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

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    renderQuestion();
});

window.addEventListener("beforeunload", (e) => {
    if (timerInterval && !allowFinishNavigation) {
        e.preventDefault();
        e.returnValue = "";
    }
});

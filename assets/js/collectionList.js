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

function renderQuestionsList() {
    if (!questionsList) return;

    if (!collectionPayload.questions.length) {
        if (removalControls) removalControls.hidden = true;
        questionsList.innerHTML = '<div class="empty-state">No questions in this collection.</div>';
        return;
    }

    if (collectionPayload.classificationTag && removalControls) {
        removalControls.hidden = false;
        removalControls.innerHTML = `
            <label><input type="checkbox" class="classification-select-all"> Select All</label>
            <button type="button" class="btn btn-secondary btn-small classification-remove-selected" disabled>Remove Selected</button>
            <span class="classification-selected-count">0 selected</span>
        `;
    }

    const questionKeys = collectionPayload.questions.map((question) => getClassificationKeyForRemoval(question, collectionPayload.classificationTag || ""));
    questionsList.innerHTML = collectionPayload.questions.map((question, index) => {
        const questionText = String(question.q || question.question || question.questionText || question.prompt || "Question").slice(0, 120);
        return `
            <div class="question-list-row">
                <input type="checkbox" class="classification-question-checkbox" data-classification-key="${escapeHtml(questionKeys[index])}" aria-label="Select question ${index + 1}">
                <button type="button" class="question-card" data-index="${index}">
                    <div class="question-card-title">Q${index + 1}</div>
                    <div class="question-card-text">${escapeHtml(questionText)}</div>
                </button>
            </div>
        `;
    }).join("");

    // Add click handlers to all question cards
    questionsList.querySelectorAll(".question-card").forEach((card) => {
        card.addEventListener("click", () => {
            const index = Number(card.getAttribute("data-index"));
            openQuestionInQuiz(index);
        });
    });
    if (collectionPayload.classificationTag && removalControls) {
        attachRemovalControls(removalControls, collectionPayload.classificationTag, (removedKeys) => {
            collectionPayload.questions = collectionPayload.questions.filter((question, index) => !removedKeys.includes(questionKeys[index]));
            renderQuestionsList();
        });
    }
}

function openQuestionInQuiz(questionIndex) {
    // Store the collection and starting question index
    // Preserve the collection list payload for the Back button
    const quizPayload = {
        ...collectionPayload,
        startingQuestionIndex: questionIndex,
        collectionListPayload: collectionPayload
    };
    sessionStorage.setItem("collectionQuizPayload", JSON.stringify(quizPayload));
    window.location.href = "collection-quiz.html";
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

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("isAuthenticated");
    window.location.href = "index.html";
});

// Initialize page
window.addEventListener("DOMContentLoaded", () => {
    renderQuestionsList();
});

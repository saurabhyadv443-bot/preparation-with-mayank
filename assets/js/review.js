const result = JSON.parse(localStorage.getItem("quizResult") || "null");
const reviewMeta = document.getElementById("reviewMeta");
const reviewList = document.getElementById("reviewList");

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const explanationRenderer = window.ExplanationRenderer || {
    normalizeExplanationDocument: (value) => ({ type: "document", blocks: [] }),
    renderExplanationDocument: (value, fallbackText) => `<p>${escapeHtml(fallbackText || "")}</p>`
};

if (!result) {
    window.location.href = "index.html";
} else {
    const chapterLabel = result.chapter && result.chapter.trim() ? result.chapter : "Full Length Test";
    reviewMeta.innerHTML = `${escapeHtml(result.subject)} • ${escapeHtml(chapterLabel)} • Accuracy: ${result.accuracy}%`;

    result.questions.forEach((question, index) => {
        const selectedAnswer = result.userAnswers[index];
        const correctAnswer = question.answer;
        const isCorrect = selectedAnswer === correctAnswer;
        const answerText = selectedAnswer == null ? "Not attempted" : escapeHtml(question.options[selectedAnswer]);
        const correctAnswerText = escapeHtml(question.options[correctAnswer]);
        const explanationDocument = explanationRenderer.normalizeExplanationDocument(question.explanationDocument || question.explanation || "");
        const explanationHtml = explanationRenderer.renderExplanationDocument(explanationDocument, question.explanation || "");

        const card = document.createElement("div");
        card.className = "review-item";
        card.innerHTML = `
            <h3>Q${index + 1}. ${escapeHtml(question.q)}</h3>
            <p><strong>Your answer:</strong> ${answerText}</p>
            <p><strong>Status:</strong> <span class="${isCorrect ? "review-correct" : "review-wrong"}">${isCorrect ? "Correct" : "Incorrect"}</span></p>
            <p><strong>Correct answer:</strong> ${correctAnswerText}</p>
            <div class="explanation-box${explanationHtml ? "" : " missing"}">
                <strong>Explanation:</strong>
                ${explanationHtml || "Explanation is currently unavailable for this question."}
            </div>
        `;
        reviewList.appendChild(card);
    });
}

(function (global) {
    function normalized(value) {
        return String(value ?? "").trim().toLowerCase();
    }

    function hasSectionalSource(attempt, quizId) {
        if (normalized(attempt.source) === "sectional") return true;
        if (String(quizId || "").split("::").some((part) => normalized(part) === "sectional")) return true;
        try {
            return new URL(String(attempt.quizUrl || ""), global.location?.href || "https://example.invalid/")
                .searchParams.get("source")?.trim().toLowerCase() === "sectional";
        } catch (error) {
            return false;
        }
    }

    function isSectionalMockAttempt(attempt, historyQuizId) {
        if (!attempt || typeof attempt !== "object" || Number(attempt.total) <= 0) return false;
        const quizId = String(attempt.quizId || historyQuizId || "");
        const parts = quizId.split("::").map(normalized);
        const subjectKey = normalized(attempt.subjectKey || attempt.subject);
        const isMockSubject = subjectKey === "mock" || subjectKey === "mock test" || parts[0] === "mock";
        let urlMode = "";
        try {
            urlMode = new URL(String(attempt.quizUrl || ""), global.location?.href || "https://example.invalid/")
                .searchParams.get("mode") || "";
        } catch (error) {
            urlMode = "";
        }
        if (normalized(attempt.mode || attempt.quizMode || urlMode) === "study"
            || normalized(attempt.quizType) === "study"
            || parts[parts.length - 1] === "study") {
            return false;
        }
        const isMockMode = normalized(attempt.quizType) === "mock" || parts[parts.length - 1] === "mock";
        return isMockSubject && isMockMode && hasSectionalSource(attempt, quizId);
    }

    function readStoredWrongCount(attempt) {
        const value = attempt.incorrect ?? attempt.wrong;
        if (value === undefined || value === null || value === "") return null;
        const count = Number(value);
        return Number.isInteger(count) && count >= 0 ? count : null;
    }

    function getSelectedAnswer(attempt, question, index) {
        if (Array.isArray(attempt.userAnswers)) {
            return index < attempt.userAnswers.length
                ? { known: true, value: attempt.userAnswers[index] }
                : { known: false };
        }
        const ids = attempt.question_ids;
        const answers = attempt.answers;
        if (ids && typeof ids === "object" && answers && typeof answers === "object") {
            const mappedId = Object.entries(ids).find(([, questionIndex]) => Number(questionIndex) === index)?.[0];
            const questionId = mappedId
                ?? String(question.id ?? question.qid ?? question.questionId ?? index);
            if (Object.prototype.hasOwnProperty.call(answers, questionId)) {
                return { known: true, value: answers[questionId] };
            }
        }
        return { known: false };
    }

    function getIncorrectQuestions(attempt) {
        const expectedCount = readStoredWrongCount(attempt);
        const questions = Array.isArray(attempt?.questions) ? attempt.questions : null;
        if (!questions) {
            return {
                questions: [],
                expectedCount,
                unavailable: expectedCount !== 0,
                message: "This attempt does not contain its original question snapshots."
            };
        }

        const incorrectQuestions = [];
        let unavailable = false;
        questions.forEach((question, index) => {
            if (!question || typeof question !== "object") {
                unavailable = true;
                return;
            }
            const selected = getSelectedAnswer(attempt, question, index);
            if (!selected.known) {
                unavailable = true;
                return;
            }
            if (selected.value === null || selected.value === undefined) return;

            const options = Array.isArray(question.options) ? question.options : [];
            const answerIndex = question.answer;
            if (!Number.isInteger(selected.value)
                || !Number.isInteger(answerIndex)
                || selected.value < 0
                || selected.value >= options.length
                || answerIndex < 0
                || answerIndex >= options.length) {
                unavailable = true;
                return;
            }
            if (selected.value !== answerIndex) {
                const questionText = question.q ?? question.question ?? question.questionText ?? question.prompt;
                if (typeof questionText !== "string" || !questionText.trim()) {
                    unavailable = true;
                    return;
                }
                incorrectQuestions.push({
                    index,
                    question,
                    questionText,
                    options,
                    previousAnswer: selected.value,
                    correctAnswer: answerIndex
                });
            }
        });

        if (expectedCount === null || expectedCount !== incorrectQuestions.length) {
            unavailable = true;
        }
        return {
            questions: incorrectQuestions,
            expectedCount,
            unavailable,
            message: unavailable
                ? "Some required answer or question data is missing or inconsistent in this attempt."
                : ""
        };
    }

    function groupIncorrectAttempts(history) {
        const groups = new Map();
        Object.entries(history || {}).forEach(([historyQuizId, records]) => {
            if (!Array.isArray(records)) return;
            records.forEach((attempt, attemptIndex) => {
                if (!isSectionalMockAttempt(attempt, historyQuizId)) return;
                const result = getIncorrectQuestions(attempt);
                if (!result.questions.length && !result.unavailable) return;
                const quizId = String(attempt.quizId || historyQuizId);
                const groupKey = quizId.trim().toLowerCase();
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, { quizId, attempts: [] });
                }
                groups.get(groupKey).attempts.push({ attempt, attemptIndex, result });
            });
        });
        return [...groups.values()];
    }

    function fingerprintAttempt(attempt) {
        const serialized = JSON.stringify(attempt);
        if (!serialized) return "";
        let first = 2166136261;
        let second = 3339675911;
        for (let index = 0; index < serialized.length; index += 1) {
            const code = serialized.charCodeAt(index);
            first = Math.imul(first ^ code, 16777619) >>> 0;
            second = Math.imul(second ^ code, 2246822519) >>> 0;
        }
        return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function optionLabel(index, option) {
        return `${String.fromCharCode(65 + index)}. ${escapeHtml(option)}`;
    }

    function renderReveal(questionData, currentAnswer, explanationHtml) {
        const options = questionData.options;
        return `
            <div class="incorrect-reader-answer-row previous-answer">
                <strong>Your Previous Answer:</strong>
                <span>${optionLabel(questionData.previousAnswer, options[questionData.previousAnswer])}</span>
            </div>
            <div class="incorrect-reader-answer-row current-answer">
                <strong>Your Current Selection:</strong>
                <span>${optionLabel(currentAnswer, options[currentAnswer])}</span>
            </div>
            <div class="incorrect-reader-answer-row correct-answer">
                <strong>Correct Answer:</strong>
                <span>${optionLabel(questionData.correctAnswer, options[questionData.correctAnswer])}</span>
            </div>
            <div class="incorrect-reader-explanation">
                <strong>Explanation:</strong>
                ${explanationHtml || "<p>Explanation is not available for this question.</p>"}
            </div>
        `;
    }

    const api = { isSectionalMockAttempt, getIncorrectQuestions, groupIncorrectAttempts, fingerprintAttempt, renderReveal, escapeHtml };
    global.IncorrectQuestionsCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));

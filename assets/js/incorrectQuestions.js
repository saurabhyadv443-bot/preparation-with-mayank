(function () {
    const core = window.IncorrectQuestionsCore;
    const pageParams = new URLSearchParams(window.location.search);
    const list = document.getElementById("incorrectAttempts");
    const status = document.getElementById("incorrectStatus");
    const title = document.getElementById("incorrectTitle");
    const subtitle = document.getElementById("incorrectSubtitle");
    const backLink = document.getElementById("incorrectBack");
    const readerMode = pageParams.get("view") === "reader";

    function escapeHtml(value) {
        return core.escapeHtml(value);
    }

    function historyStore() {
        return window.quizAttemptHistoryStore;
    }

    async function loadAttemptHistory() {
        const store = historyStore();
        if (store) {
            await store.ready;
            return await store.getHistory();
        }
        return JSON.parse(localStorage.getItem("quiz_attempt_history") || "{}");
    }

    function parseCompletionTime(attempt) {
        const parsed = new Date(attempt.completedAt || "");
        if (!Number.isNaN(parsed.getTime())) return parsed;
        const legacyDate = `${attempt.date || ""} ${attempt.time || ""}`.trim();
        const legacyParsed = new Date(legacyDate);
        return Number.isNaN(legacyParsed.getTime()) ? null : legacyParsed;
    }

    function attemptDateLabel(attempt) {
        const date = parseCompletionTime(attempt);
        return date
            ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
            : [attempt.date, attempt.time].filter(Boolean).join(" ") || "Date and time unavailable";
    }

    function setName(attempt, quizId) {
        if (attempt.chapter) return String(attempt.chapter);
        const parts = String(quizId || "").split("::");
        return parts.length > 2 && parts[2] ? parts[2] : "Sectional Set";
    }

    function readAttemptGroups(history) {
        return core.groupIncorrectAttempts(history)
            .map((group) => ({
                ...group,
                title: setName(group.attempts[0]?.attempt || {}, group.quizId)
            }))
            .map((group) => ({
                ...group,
                attempts: group.attempts.sort((left, right) => {
                    const leftTime = parseCompletionTime(left.attempt)?.getTime() || 0;
                    const rightTime = parseCompletionTime(right.attempt)?.getTime() || 0;
                    return rightTime - leftTime;
                })
            }))
            .sort((left, right) => left.title.localeCompare(right.title));
    }

    function attemptCountLabel(result) {
        if (result.expectedCount === null) return `${result.questions.length} recoverable · total unavailable`;
        if (result.expectedCount === result.questions.length) {
            return `${result.expectedCount} incorrect question${result.expectedCount === 1 ? "" : "s"}`;
        }
        return `${result.expectedCount} recorded · ${result.questions.length} recoverable · data unavailable`;
    }

    function readerUrl(quizId, attempt, attemptIndex) {
        const params = new URLSearchParams({
            view: "reader",
            quizId,
            attemptIndex: String(attemptIndex),
            fingerprint: core.fingerprintAttempt(attempt)
        });
        if (attempt.attempt !== undefined && attempt.attempt !== null && Number.isInteger(Number(attempt.attempt))) {
            params.set("attempt", String(attempt.attempt));
        }
        return `incorrect-questions.html?${params.toString()}`;
    }

    function renderAttemptList(history) {
        const groups = readAttemptGroups(history);
        title.textContent = "Incorrect Questions";
        subtitle.textContent = "Sectional mock attempts with answered, incorrect questions.";
        backLink.href = "dashboard.html";
        if (!groups.length) {
            list.innerHTML = '<div class="empty-state">No incorrect answered questions are available from completed sectional mock attempts.</div>';
            return;
        }
        list.innerHTML = groups.map((group) => `
            <section class="incorrect-set-card">
                <h2>${escapeHtml(group.title)}</h2>
                <div class="incorrect-attempt-list">
                    ${group.attempts.map(({ attempt, attemptIndex, result }) => `
                        <a class="incorrect-attempt-link" href="${escapeHtml(readerUrl(group.quizId, attempt, attemptIndex))}">
                            <span>
                                <strong>Attempt ${escapeHtml(attempt.attempt ?? attemptIndex + 1)}</strong>
                                <span class="incorrect-attempt-date">${escapeHtml(attemptDateLabel(attempt))}</span>
                            </span>
                            <span class="incorrect-attempt-count">${escapeHtml(attemptCountLabel(result))}</span>
                        </a>
                    `).join("")}
                </div>
            </section>
        `).join("");
    }

    function findSelectedAttempt(history) {
        const requestedQuizId = String(pageParams.get("quizId") || "").trim().toLowerCase();
        const records = Object.entries(history || {}).find(([quizId, attempts]) =>
            Array.isArray(attempts)
            && (String(quizId).trim().toLowerCase() === requestedQuizId
                || attempts.some((attempt) => String(attempt?.quizId || "").trim().toLowerCase() === requestedQuizId))
        );
        if (!records) return null;
        const [historyQuizId, attempts] = records;
        const requestedAttempt = pageParams.get("attempt");
        const requestedFingerprint = pageParams.get("fingerprint");
        const selectedByFingerprint = requestedFingerprint
            ? attempts.find((attempt) => core.fingerprintAttempt(attempt) === requestedFingerprint)
            : null;
        const selected = requestedFingerprint
            ? selectedByFingerprint
            : (requestedAttempt
                ? attempts.find((attempt) => String(attempt.attempt) === requestedAttempt)
                : attempts[Number(pageParams.get("attemptIndex"))]);
        if (!selected || !core.isSectionalMockAttempt(selected, historyQuizId)) return null;
        return { attempt: selected, quizId: String(selected.quizId || historyQuizId) };
    }

    function explanationHtml(question) {
        const documentValue = question.explanationDocument;
        const text = question.explanation;
        const hasDocumentContent = documentValue
            && typeof documentValue === "object"
            && Array.isArray(documentValue.blocks)
            && documentValue.blocks.length > 0;
        if (!hasDocumentContent && !(typeof text === "string" && text.trim())) return "";
        return window.ExplanationRenderer
            ? window.ExplanationRenderer.renderExplanationDocument(documentValue || text, text || "")
            : `<p>${escapeHtml(text || "")}</p>`;
    }

    function renderAttemptReader(selected) {
        if (!selected) {
            title.textContent = "Incorrect Questions";
            subtitle.textContent = "";
            status.textContent = "This sectional mock attempt is no longer available in saved attempt history.";
            return;
        }
        const { attempt, quizId } = selected;
        const result = core.getIncorrectQuestions(attempt);
        title.textContent = setName(attempt, quizId);
        const attemptLabel = attempt.attempt ?? (Number(pageParams.get("attemptIndex")) + 1 || 1);
        subtitle.textContent = `Attempt ${attemptLabel} · ${attemptDateLabel(attempt)}`;
        backLink.href = "incorrect-questions.html";

        const unavailableNotice = result.unavailable
            ? `<p class="incorrect-unavailable" role="status">${escapeHtml(result.message)}${result.expectedCount !== null ? ` ${result.expectedCount} incorrect answer${result.expectedCount === 1 ? " was" : "s were"} recorded; ${result.questions.length} question${result.questions.length === 1 ? " is" : "s are"} available to review.` : ""}</p>`
            : "";
        if (!result.questions.length) {
            list.innerHTML = unavailableNotice || '<div class="empty-state">No incorrect answered questions were recorded for this attempt.</div>';
            return;
        }

        list.innerHTML = `${unavailableNotice}${result.questions.map((item, displayIndex) => {
            const snapshot = { ...item.question, q: item.questionText };
            const renderedQuestion = window.QuestionRenderer
                ? window.QuestionRenderer.renderQuestion(snapshot, item.index + 1, { collectionReader: true })
                : `<div class="question-statement"><p>${escapeHtml(item.questionText)}</p></div>`;
            return `
                <article class="incorrect-reader-question" data-question-index="${displayIndex}">
                    <div class="incorrect-reader-content">
                        ${renderedQuestion}
                        <section class="incorrect-reader-reveal" hidden aria-live="polite"></section>
                    </div>
                </article>
            `;
        }).join("")}`;

        list.addEventListener("click", function handleOptionSelection(event) {
            const option = event.target.closest("[data-reader-option]");
            const card = option?.closest(".incorrect-reader-question");
            if (!option || !card || !list.contains(card)) return;

            const item = result.questions[Number(card.dataset.questionIndex)];
            const currentAnswer = Number(option.dataset.readerOption);
            if (!item || !Number.isInteger(currentAnswer) || currentAnswer < 0 || currentAnswer >= item.options.length) return;
            const optionButtons = Array.from(card.querySelectorAll("[data-reader-option]"));
            optionButtons.forEach((button, index) => {
                button.classList.remove("previous-answer-option", "current-selection-option", "correct-answer-option");
                button.setAttribute("aria-pressed", index === currentAnswer ? "true" : "false");
                button.querySelectorAll(".incorrect-option-label").forEach((label) => label.remove());
                const labels = [];
                if (index === item.previousAnswer) {
                    button.classList.add("previous-answer-option");
                    labels.push("Your Previous Answer");
                }
                if (index === currentAnswer) {
                    button.classList.add("current-selection-option");
                    labels.push("Your Current Selection");
                }
                if (index === item.correctAnswer) {
                    button.classList.add("correct-answer-option");
                    labels.push("Correct Answer");
                }
                labels.forEach((labelText) => {
                    const label = document.createElement("span");
                    label.className = "incorrect-option-label";
                    label.textContent = labelText;
                    button.appendChild(label);
                });
            });

            const reveal = card.querySelector(".incorrect-reader-reveal");
            reveal.innerHTML = core.renderReveal(item, currentAnswer, explanationHtml(item.question));
            reveal.hidden = false;
        });
    }

    async function initialize() {
        if (!core || !list || !status || !title || !subtitle || !backLink) return;
        list.innerHTML = "";
        status.textContent = "Loading saved sectional mock attempts…";
        try {
            const history = await loadAttemptHistory();
            status.textContent = "";
            if (readerMode) {
                renderAttemptReader(findSelectedAttempt(history));
            } else {
                renderAttemptList(history);
            }
        } catch (error) {
            status.textContent = `Unable to read saved attempt history: ${error.message || "Unknown storage error"}`;
        }
    }

    initialize();
}());

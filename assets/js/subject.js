const params = new URLSearchParams(window.location.search);
const subject = params.get("subject") || "ancient";
const chapterList = document.getElementById("chapterList");
const subjectReviewBtn = document.getElementById("subjectReviewBtn");
const reviewSubjects = new Set(["ancient", "medieval", "modern", "geography", "polity", "economy", "mock"]);
let subjectData = null;

function safeParseStoredValue(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function getResumeProgressForTarget(targetName) {
    const progress = safeParseStoredValue("quizProgress", null);
    if (!progress || progress.subject !== subject || progress.chapter !== targetName) {
        return null;
    }
    return progress;
}

function hasCompletedMockAttempt(targetName) {
    if (subject !== "mock") {
        return false;
    }

    const history = safeParseStoredValue("quiz_attempt_history", {});
    const quizId = [subject, targetName, "mock"].join("::");
    return Array.isArray(history[quizId]) && history[quizId].length > 0;
}

async function getSubjectMetaMap() {
    try {
        const resp = await fetch('data/subjects.json');
        if (!resp.ok) throw new Error('manifest');
        const j = await resp.json();
        if (!j || !Array.isArray(j.subjects)) throw new Error('invalid');
        return j.subjects.reduce((acc,s)=>{ acc[s.id]=s; return acc; }, {});
    } catch (e) {
        return null;
    }
}

function getClassifiedQuestionEntries(filterFn) {
    try {
        const store = JSON.parse(localStorage.getItem("questionClassifications") || "{}");
        return Object.values(store).filter((entry) => entry && filterFn(entry));
    } catch (error) {
        return [];
    }
}

function getAttemptedReviewSections() {
    if (!reviewSubjects.has(subject)) return [];

    const history = safeParseStoredValue("quiz_attempt_history", {});
    const grouped = new Map();
    Object.entries(history || {}).forEach(([historyQuizId, records]) => {
        if (!Array.isArray(records)) return;
        records.forEach((attempt, index) => {
            if (!attempt || (attempt.subjectKey || subject) !== subject || !attempt.chapter || Number(attempt.total) <= 0) return;
            const completedAt = new Date(attempt.completedAt || 0).getTime();
            if (!Number.isFinite(completedAt)) return;
            const key = `${subject}::${attempt.chapter}`;
            const attemptWithNumber = {
                ...attempt,
                quizId: historyQuizId,
                attempt: Number(attempt.attempt) || index + 1
            };
            const current = grouped.get(key);
            const marks = Number(attemptWithNumber.finalScore ?? attemptWithNumber.score ?? 0);
            const currentMarks = current ? Number(current.best.finalScore ?? current.best.score ?? 0) : 0;
            if (!current || marks > currentMarks || (marks === currentMarks && completedAt > current.completedAt)) {
                grouped.set(key, { chapter: attempt.chapter, best: attemptWithNumber, completedAt });
            }
        });
    });

    return [...grouped.values()].sort((a, b) => b.completedAt - a.completedAt);
}

function renderAttemptedReviewSections() {
    if (!chapterList) return;
    const sections = getAttemptedReviewSections();
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid", "review-section-list");
    if (!sections.length) {
        chapterList.innerHTML = '<p class="empty-state">No attempted sections yet.</p>';
        return;
    }

    sections.forEach(({ chapter, best }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chapterBtn subject-chapter-btn review-section-btn";
        button.innerHTML = `<div class="subject-card-content"><span class="subject-card-title">${escapeHtmlReviewText(chapter)}</span></div>`;
        button.onclick = () => {
            const query = new URLSearchParams({
                historical: "1",
                quizId: best.quizId,
                attempt: String(best.attempt),
                returnUrl: `subject.html?${new URLSearchParams({ subject, review: "1" }).toString()}`
            });
            window.location.href = `result-review.html?${query.toString()}`;
        };
        chapterList.appendChild(button);
    });
}

function escapeHtmlReviewText(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderClassificationRemovalControls(tag, refresh) {
    const controls = document.getElementById("classificationRemovalControls");
    if (!controls) return;
    controls.hidden = false;
    controls.innerHTML = `
        <label><input type="checkbox" class="classification-select-all"> Select All</label>
        <button type="button" class="btn btn-secondary btn-small classification-remove-selected" disabled>Remove Selected</button>
        <span class="classification-selected-count">0 selected</span>
    `;
    attachRemovalControls(controls, tag, refresh);
}

function buildImportantQuestionsForSubject(subjectKey) {
    const validTags = {
        modern: "H",
        geography: "G",
        polity: "P",
        economy: "E"
    };
    const targetTag = validTags[String(subjectKey)] || null;
    if (!targetTag) {
        return [];
    }
    const entries = getClassifiedQuestionEntries((entry) => Boolean(entry[targetTag]));
    return entries.map((entry) => entry.question || null).filter(Boolean);
}

function buildCurrentAffairsQuestions() {
    const entries = getClassifiedQuestionEntries((entry) => entry.CA === true);
    return entries.map((entry) => entry.question || null).filter(Boolean);
}

function openCollectionListSession(title, questions, subjectKey = subject, returnChapter = title, classificationTag = null) {
    const returnUrl = `subject.html?${new URLSearchParams({ subject: subjectKey, chapter: returnChapter }).toString()}`;
    const payload = {
        title,
        subject: title,
        subjectKey,
        chapter: title,
        questions,
        returnUrl,
        classificationTag
    };
    sessionStorage.setItem("collectionListPayload", JSON.stringify(payload));
    window.location.href = "collection-list.html";
}

function openImportantQuestionsQuiz(title, questions, subjectKey, questionIndex) {
    const returnUrl = `subject.html?${new URLSearchParams({ subject: subjectKey, chapter: "Important Questions" }).toString()}`;
    const payload = {
        title,
        subject: title,
        subjectKey,
        chapter: "Important Questions",
        questions,
        startingQuestionIndex: questionIndex,
        returnUrl
    };
    sessionStorage.setItem("collectionQuizPayload", JSON.stringify(payload));
    window.location.href = "collection-quiz.html";
}

function renderSubjectCardButton(targetName, targetType) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = targetType === "mock" ? "chapterBtn subject-set-btn" : "chapterBtn subject-chapter-btn";

    const progress = getResumeProgressForTarget(targetName);
    if (targetType === "mock" && (progress || hasCompletedMockAttempt(targetName))) {
        button.classList.add("mock-attempted");
    }
    const actionText = targetType === "mock"
        ? (progress ? "Resume Mock Test" : "Start Mock Test")
        : (progress ? "Resume" : "Start Practice");

    button.innerHTML = `
        <div class="subject-card-content">
            <span class="subject-card-title">${targetName}</span>
        </div>
        <small>${actionText}</small>
    `;
    button.onclick = function () {
        if (targetName === "Important Questions") {
            const query = new URLSearchParams({ subject, chapter: targetName });
            window.location.href = `subject.html?${query.toString()}`;
            return;
        }
        const query = new URLSearchParams({ subject, chapter: targetName });
        window.location.href = `quiz.html?${query.toString()}`;
    };
    return button;
}

function collectMockSetNames(data) {
    const nested = data && typeof data === "object" ? data["TEST NUMBER"] : null;
    if (!nested || typeof nested !== "object") {
        return [];
    }
    return Object.keys(nested).filter((name) => Boolean(name));
}

function openClassifiedReviewSession(title, questions, subjectKey = subject) {
    openCollectionListSession(title, questions, subjectKey);
}

function renderClassifiedCollection(title, questions, subjectKey) {
    // Visible classified question rows are rendered here into #chapterList.
    if (!chapterList) return;
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    const tagBySubject = { modern: "H", geography: "G", polity: "P", economy: "E", current_affairs: "CA" };
    const classificationTag = tagBySubject[subjectKey];

    if (!questions.length) {
        const controls = document.getElementById("classificationRemovalControls");
        if (controls) {
            controls.hidden = true;
            controls.innerHTML = "";
        }
        chapterList.innerHTML = `<p class="empty-state">No ${title} questions saved yet.</p>`;
        return;
    }

    questions.forEach((question, index) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "classification-question-checkbox";
        checkbox.dataset.classificationKey = classificationTag ? getClassificationKeyForRemoval(question, classificationTag) : "";
        checkbox.setAttribute("aria-label", `Select question ${index + 1}`);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "chapterBtn subject-chapter-btn";
        card.style.flex = "1";
        card.innerHTML = `
            <div class="subject-card-content">
                <span class="subject-card-title">Q${index + 1}</span>
            </div>
            <small>${String(question.q || question.question || question.questionText || question.prompt || "Question").slice(0, 58)}</small>
        `;
        card.onclick = function () {
            if (["modern", "geography", "polity", "economy"].includes(subjectKey)) {
                openImportantQuestionsQuiz(title, questions, subjectKey, index);
                return;
            }
            openCollectionListSession(title, questions, subjectKey, title, classificationTag);
        };
        row.appendChild(checkbox);
        row.appendChild(card);
        chapterList.appendChild(row);
    });
    if (classificationTag) {
        renderClassificationRemovalControls(classificationTag, () => loadSubjectContent());
    }
}

async function loadSubjectContent() {
    const selectedChapter = new URLSearchParams(window.location.search).get("chapter");

    if (!selectedChapter && new URLSearchParams(window.location.search).get("review") === "1") {
        renderAttemptedReviewSections();
        return;
    }

    if (subject === "current_affairs") {
        const questions = buildCurrentAffairsQuestions();
        if (selectedChapter === "Current Affairs" || selectedChapter === "Important Questions") {
            renderClassifiedCollection("Current Affairs", questions, "current_affairs");
            return;
        }

        if (!chapterList) return;
        chapterList.innerHTML = "";
        chapterList.classList.add("subject-card-grid");
        if (!questions.length) {
            chapterList.innerHTML = '<p class="empty-state">No Current Affairs questions saved yet.</p>';
            return;
        }

        const card = document.createElement("button");
        card.type = "button";
        card.className = "chapterBtn subject-chapter-btn";
        card.innerHTML = `
            <div class="subject-card-content">
                <span class="subject-card-title">Current Affairs</span>
            </div>
            <small>${questions.length} saved</small>
        `;
        card.onclick = function () {
            openCollectionListSession("Current Affairs", questions, "current_affairs", "Current Affairs", "CA");
        };
        chapterList.appendChild(card);
        return;
    }

    const meta = await getSubjectMetaMap();
    const fileName = (meta && meta[subject] && meta[subject].file) || `${subject}.json`;

    try {
        const resp = await fetch(`data/${fileName}?t=${Date.now()}`);
        if (!resp.ok) throw new Error('data missing');
        const data = await resp.json();
        subjectData = data;
        if (selectedChapter === "Important Questions") {
            renderClassifiedCollection("Important Questions", buildImportantQuestionsForSubject(subject), subject);
            return;
        }

        if (subject === "mock") {
            const setNames = collectMockSetNames(data);
            renderMockSets(setNames);
            return;
        }

        const chapters = data && data.chapters ? Object.keys(data.chapters) : [];
        if (["modern", "geography", "polity", "economy"].includes(subject)) {
            chapters.push("Important Questions");
        }
        renderChapters(chapters);
    } catch (error) {
        if (chapterList) {
            if (subject === "mock") {
                chapterList.innerHTML = '<p class="empty-state">Mock Test sets are currently unavailable.</p>';
            } else if (["modern", "geography", "polity", "economy"].includes(subject)) {
                renderChapters(["Important Questions"]);
            } else {
                chapterList.innerHTML = '<p class="empty-state">No chapters are available for this subject.</p>';
            }
        }
    }
}

function renderChapters(chapters) {
    if (!chapterList) {
        return;
    }
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    if (!chapters.length) {
        chapterList.innerHTML = '<p class="empty-state">No chapters are available for this subject.</p>';
        return;
    }

    const uniqueChapters = [...new Set(chapters.filter(Boolean))];
    uniqueChapters.forEach((chapterName) => {
        const button = renderSubjectCardButton(chapterName, "chapter");
        if (chapterName === "Important Questions") {
            const questionCount = buildImportantQuestionsForSubject(subject).length;
            button.innerHTML = `
                <div class="subject-card-content">
                    <span class="subject-card-title">Important Questions</span>
                </div>
                <small>${questionCount ? `${questionCount} saved` : "No Important Questions saved yet"}</small>
            `;
        }
        chapterList.appendChild(button);
    });
}

function renderMockSets(setNames) {
    if (!chapterList) {
        return;
    }
    chapterList.innerHTML = "";
    chapterList.classList.add("subject-card-grid");

    if (!setNames.length) {
        chapterList.innerHTML = '<p class="empty-state">Mock Test sets are currently unavailable.</p>';
        return;
    }

    setNames.forEach((setName) => {
        chapterList.appendChild(renderSubjectCardButton(setName, "mock"));
    });
}

(async function initSubjectPage(){
    const meta = await getSubjectMetaMap();
    const title = (meta && meta[subject] && meta[subject].title) || (subject === "current_affairs" ? "Current Affairs" : subject);
    const subjectTitle = document.getElementById("subjectTitle");
    if (subjectTitle) {
        subjectTitle.innerText = title;
    }

    const heading = document.getElementById("sectionHeading");
    if (heading) {
        heading.textContent = subject === "mock" ? "Mock Test Sets" : (subject === "current_affairs" ? "Current Affairs" : "Chapter Wise Practice");
    }

    if (subjectReviewBtn && reviewSubjects.has(subject)) {
        subjectReviewBtn.hidden = false;
        subjectReviewBtn.onclick = () => {
            const query = new URLSearchParams({ subject, review: "1" });
            window.location.href = `subject.html?${query.toString()}`;
        };
    }

    loadSubjectContent();
})();

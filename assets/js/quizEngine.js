const params = new URLSearchParams(window.location.search);
const subject = params.get("subject") || "ancient";
const selectedChapterFromQuery = params.get("chapter") || "";
let selectedMode = params.get("mode") || "";

let SUBJECT_MANIFEST = null;
let subjects = [];
let selectedSubject = subject;

async function loadSubjectManifest() {
    if (SUBJECT_MANIFEST) return SUBJECT_MANIFEST;
    try {
        const resp = await fetch('data/subjects.json');
        if (!resp.ok) throw new Error('manifest missing');
        const j = await resp.json();
        if (!j || !Array.isArray(j.subjects)) throw new Error('invalid manifest');
        subjects = j.subjects;
        console.log("Subjects loaded:", subjects);
        SUBJECT_MANIFEST = j.subjects.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
        return SUBJECT_MANIFEST;
    } catch (e) {
        SUBJECT_MANIFEST = null;
        subjects = [];
        console.log("Subjects loaded:", subjects);
        return null;
    }
}

function resolveSubjectDataFile(subjectKey) {
    if (SUBJECT_MANIFEST && SUBJECT_MANIFEST[subjectKey]) return SUBJECT_MANIFEST[subjectKey].file;
    return `${subjectKey}.json`;
}

let quizData = {};
let currentChapter = "";
let questions = [];
let currentQuestion = 0;
let userAnswers = [];
let markedForReview = [];
let timer = null;
let remainingTime = 0;
let paused = false;
let currentSubjectKey = subject;
let quizStartedAt = 0;
let cachedProgressQuestions = null;
let cachedProgressQuestionsJson = "";

const timerNode = document.getElementById("timer");
const pauseBtn = document.getElementById("pauseBtn");
const exitBtn = document.getElementById("exitBtn");
const chapterSearch = document.getElementById("chapterSearch");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const chapterList = document.getElementById("chapterList");
const chapterSection = document.getElementById("chapterSection");
const quizSection = document.getElementById("quizSection");
const chapterTitle = document.getElementById("chapterTitle");
const paletteNode = document.getElementById("palette");
const questionBox = document.getElementById("questionBox");
const prevBtn = document.getElementById("prevBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const nextBtn = document.getElementById("nextBtn");
const submitBtn = document.getElementById("submitBtn");
const markReviewBtn = document.getElementById("markReviewBtn");
const submitModal = document.getElementById("submitConfirmModal");
const cancelSubmitBtn = document.getElementById("cancelSubmitBtn");
const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");
const topbarKicker = document.querySelector(".topbar-kicker");

function safeParseStoredValue(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function getQuizMode() {
    if (selectedMode === "study") return "study";
    if (quizData.quizType === "mock") return "mock";
    if (subject === "mock" || quizData.subject === "Mock Test" || quizData.totalTimeSeconds || quizData.duration) return "mock";
    return quizData.quizType || "practice";
}

function isStudyMode() {
    return getQuizMode() === "study";
}

function getProgressKey() {
    return isStudyMode() ? "quizProgress_study" : "quizProgress";
}

function getResultKey() {
    return isStudyMode() ? "quizResult_study" : "quizResult";
}
function getQuizId() {
    return [subject, currentChapter || "all", getQuizMode()].join("::");
}
function getAttemptHistory() {
    return safeParseStoredValue("quiz_attempt_history", {});
}
function saveAttempt(result) {
    const history = getAttemptHistory();
    const completedAt = result.completedAt;
    const completedDate = new Date(completedAt);
    const savedQuestions = getSavedQuestions();
    const isSaved = (index) => savedQuestions.some((item) =>
        item.subjectKey === result.subjectKey && item.chapter === result.chapter && item.questionIndex === index
    );
    const questionIds = {};
    const answers = {};
    const questionStatus = {};
    const correctAnswers = {};
    const saved = [];
    result.questions.forEach((question, index) => {
        const questionId = question.id ?? question.qid ?? question.questionId ?? index;
        const key = String(questionId);
        const selected = result.userAnswers[index];
        questionIds[key] = index;
        answers[key] = selected == null ? null : selected;
        correctAnswers[key] = question.answer;
        questionStatus[key] = selected == null ? "unanswered" : selected === question.answer ? "correct" : "incorrect";
        if (isSaved(index)) saved.push(index);
    });
    const attempt = {
        date: completedDate.toLocaleDateString(),
        time: completedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        total: result.total,
        attempted: result.attempted,
        correct: result.correct,
        incorrect: result.wrong,
        wrong: result.wrong,
        unanswered: result.skipped,
        skipped: result.skipped,
        score: result.finalScore,
        finalScore: result.finalScore,
        percentage: result.percentage,
        accuracy: result.accuracy,
        time_taken: result.timeTaken,
        timeTaken: result.timeTaken,
        answers,
        question_status: questionStatus,
        correct_answers: correctAnswers,
        question_ids: questionIds,
        saved,
        subject: result.subject,
        subjectKey: result.subjectKey,
        chapter: result.chapter,
        quizType: result.quizType,
        quizId: result.quizId,
        duration: result.duration,
        quizUrl: result.quizUrl,
        questions: result.questions,
        userAnswers: result.userAnswers,
        markedForReview: result.markedForReview,
        markedReview: result.markedReview,
        completedAt,
        attempt: 0
    };
    const retained = Array.isArray(history[result.quizId]) ? history[result.quizId].slice(-4) : [];
    retained.push(attempt);
    history[result.quizId] = retained.map((item, index) => ({ ...item, attempt: index + 1 }));
    localStorage.setItem("quiz_attempt_history", JSON.stringify(history));
}
/* Accidental Match List parser fragment removed below.
            const rawText = String(question.q || "");
            const text = rawText.replace(/(?:\s|<br\s*\/?>)+Codes?\s*:?\s*(?:Code\s*:?\s*)?(?:(?:\s|<br\s*\/?>)+[A-D](?:[.)])?){2,}\s*$/i, "").trim();
            const markerPattern = /(?<![A-Za-z0-9])(\(\d{1,2}\)|\d{1,2}[.):]?|\([A-Za-z]\)|[A-Za-z][.):]?|\([IVXivx]+\)|[IVXivx]+[.):]?)(?=\s|<br\s*\/?>|$)/g;
            const headerPattern = /((?:List|Column)\s*[-–—]?\s*(?:I|II|1|2|A|B)\b(?:\s*\([^)]*\))?)/gi;
            const headers = Array.from(text.matchAll(headerPattern));
            const romanValues = { I: 1, V: 5, X: 10 };
            const questionNumber = text.match(/^\s*\d{1,3}[.)]?\s+/);
            const tokens = Array.from(text.matchAll(markerPattern)).filter((token) => {
                const before = text.slice(Math.max(0, token.index - 12), token.index);
                return !(questionNumber && token.index < questionNumber[0].length)
                    && !/(?:List|Column)\s*[-–—]?\s*$/i.test(before);
            });
            const markerInfo = (marker) => {
                const value = marker.replace(/[().,:]/g, "");
                if (/^\d+$/.test(value)) {
                    return [{ family: "numeric", value: Number(value), caseKey: "" }];
                }
                if (/^[IVX]+$/i.test(value)) {
                    const upper = value.toUpperCase();
                    const number = upper.split("").reduce((total, numeral, index, numerals) => {
                        const current = romanValues[numeral];
                        const next = romanValues[numerals[index + 1]] || 0;
                        return total + (current < next ? -current : current);
                    }, 0);
                    const roman = { family: "roman", value: number, caseKey: value === upper ? "upper" : "lower" };
                    return value.length === 1 ? [roman, { family: "letter", value: upper.charCodeAt(0) - 64, caseKey: value === upper ? "upper" : "lower" }] : [roman];
                }
                return [{ family: "letter", value: value.toUpperCase().charCodeAt(0) - 64, caseKey: value === value.toUpperCase() ? "upper" : "lower" }];
            };
            const buildSequences = () => {
                const sequences = [];
                tokens.forEach((startToken, startIndex) => {
                    markerInfo(startToken[1]).forEach((firstInfo) => {
                        if (firstInfo.value !== 1 || startToken.index === 0 || !text.slice(0, startToken.index).trim()) {
                            return;
                        }
                        const sequence = [{ token: startToken, info: firstInfo }];
                        let nextValue = 2;
                        for (let index = startIndex + 1; index < tokens.length; index += 1) {
                            const candidates = markerInfo(tokens[index][1]);
                            const next = candidates.find((candidate) => candidate.family === firstInfo.family
                                && candidate.caseKey === firstInfo.caseKey && candidate.value === nextValue);
                            if (next) {
                                sequence.push({ token: tokens[index], info: next });
                                nextValue += 1;
                            }
                        }
                        if (sequence.length >= 2) {
                            sequences.push(sequence);
                        }
                    });
                });
                return sequences.sort((first, second) => second.length - first.length);
            };
            const sequences = buildSequences();
            const headerOne = headers.find((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:I|1|A)\b/i.test(header[0]));
            const headerTwo = headers.find((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:II|2|B)\b/i.test(header[0]) && header.index > headerOne?.index);
            const hasHeaders = Boolean(headerOne && headerTwo);
            const pairs = [];
            for (let first = 0; first < sequences.length; first += 1) {
                for (let second = first + 1; second < sequences.length; second += 1) {
                    const left = sequences[first];
                    const right = sequences[second];
                    if (left.some((entry) => right.some((other) => entry.token.index === other.token.index))) {
                        continue;
                    }
                    const distinctFamilies = left[0].info.family !== right[0].info.family || left[0].info.caseKey !== right[0].info.caseKey;
                    if (!distinctFamilies && !hasHeaders) {
                        continue;
                    }
                    const confidence = Math.min(left.length, right.length) * 10 + (hasHeaders ? 5 : 0) + (distinctFamilies ? 3 : 0);
                    pairs.push({ left, right, confidence });
                }
            }
            if (!pairs.length || (!hasHeaders && !/\b(?:match|matching|pairs?)\b/i.test(text))) {
                return null;
            }
            const selected = pairs.sort((first, second) => second.confidence - first.confidence)[0];
            let left = selected.left;
            let right = selected.right;
            if (left[0].token.index > right[0].token.index) {
                [left, right] = [right, left];
            }
            const grouped = left[left.length - 1].token.index < right[0].token.index;
            const extractGrouped = (sequence, endIndex) => sequence.map((entry, index) => ({
                marker: entry.token[1],
                text: text.slice(entry.token.index + entry.token[1].length, sequence[index + 1]?.token.index ?? endIndex).replace(/^(?:\s|<br\s*\/?>)+/i, "").trim()
            }));
            const leftEntries = grouped ? extractGrouped(left, right[0].token.index) : null;
            const rightEntries = grouped ? extractGrouped(right, text.length) : null;
            const rows = [];
            const rowCount = Math.max(left.length, right.length);
            for (let index = 0; index < rowCount; index += 1) {
                const leftEntry = grouped ? leftEntries?.[index] : left[index] ? {
                    marker: left[index].token[1],
                    text: text.slice(left[index].token.index + left[index].token[1].length, right[index]?.token.index ?? left[index + 1]?.token.index ?? text.length).replace(/^(?:\s|<br\s*\/?>)+/i, "").trim()
                } : null;
                const rightEntry = grouped ? rightEntries?.[index] : right[index] ? {
                    marker: right[index].token[1],
                    text: text.slice(right[index].token.index + right[index].token[1].length, left[index + 1]?.token.index ?? text.length).replace(/^(?:\s|<br\s*\/?>)+/i, "").trim()
                } : null;
                if (leftEntry || rightEntry) {
                    rows.push({ left: leftEntry ? `${leftEntry.marker} ${leftEntry.text}` : "", right: rightEntry ? `${rightEntry.marker} ${rightEntry.text}` : "" });
                }
            }
            if (!rows.some((row) => row.left && row.right)) {
                return null;
            }
            return {
                prompt: text.slice(0, Math.min(left[0].token.index, right[0].token.index)).trim(),
                listOneHeader: headerOne?.[1] || "List-I",
                listTwoHeader: headerTwo?.[1] || "List-II",
                rows
            };
    const history = getAttemptHistory();
    const completedAt = result.completedAt;
    const completedDate = new Date(completedAt);
    const savedQuestions = getSavedQuestions();
    const isSaved = (index) => savedQuestions.some((item) =>
        item.subjectKey === result.subjectKey && item.chapter === result.chapter && item.questionIndex === index
    );
    const questionIds = {};
    const answers = {};
    const questionStatus = {};
    const correctAnswers = {};
    const saved = [];
    result.questions.forEach((question, index) => {
        const questionId = question.id ?? question.qid ?? question.questionId ?? index;
        const key = String(questionId);
        const selected = result.userAnswers[index];
        questionIds[key] = index;
        answers[key] = selected == null ? null : selected;
        correctAnswers[key] = question.answer;
        questionStatus[key] = selected == null ? "unanswered" : selected === question.answer ? "correct" : "incorrect";
        if (isSaved(index)) saved.push(index);
    });
    const attempt = {
        date: completedDate.toLocaleDateString(),
        time: completedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        total: result.total,
        attempted: result.attempted,
        correct: result.correct,
        incorrect: result.wrong,
        wrong: result.wrong,
        unanswered: result.skipped,
        skipped: result.skipped,
        score: result.finalScore,
        finalScore: result.finalScore,
        percentage: result.percentage,
        accuracy: result.accuracy,
        time_taken: result.timeTaken,
        timeTaken: result.timeTaken,
        answers,
        question_status: questionStatus,
        correct_answers: correctAnswers,
        question_ids: questionIds,
        saved,
        subject: result.subject,
        subjectKey: result.subjectKey,
        chapter: result.chapter,
        quizType: result.quizType,
        quizId: result.quizId,
        duration: result.duration,
        quizUrl: result.quizUrl,
        questions: result.questions,
        userAnswers: result.userAnswers,
        markedForReview: result.markedForReview,
        markedReview: result.markedReview,
        completedAt,
        attempt: 0
    };
    const retained = Array.isArray(history[result.quizId]) ? history[result.quizId].slice(-4) : [];
    retained.push(attempt);
    history[result.quizId] = retained.map((item, index) => ({ ...item, attempt: index + 1 }));
    localStorage.setItem("quiz_attempt_history", JSON.stringify(history));
}
*/
function getQuizDuration() {
    return Number(quizData.duration || quizData.totalTimeSeconds || quizData.durationSeconds || 7200);
}

;(async function loadQuizData() {
    try {
        // ensure manifest is loaded for resolving filenames
        await loadSubjectManifest();
        let data = null;

        if (subject === 'pyq') {
            // pyq param contains encoded payload with selected ids per subject file
            const pyqParam = params.get('pyq');
            let payload = null;
            try {
                if (pyqParam) payload = JSON.parse(atob(decodeURIComponent(pyqParam)));
            } catch (e) {
                try { payload = JSON.parse(decodeURIComponent(pyqParam)); } catch (e2) { payload = null; }
            }

            if (!payload || !payload.ids) {
                alert('No questions selected for practice');
                window.location.href = 'dashboard.html';
                return;
            }

            const ids = payload.ids || {};
            const chaptersCombined = {};
            // fetch each subject file that appears in ids
            await Promise.all(Object.keys(ids).map(async (subjectKey) => {
                const file = `${subjectKey}.json`;
                try {
                    const resp = await fetch(`data/${file}`);
                    if (!resp.ok) return;
                    const j = await resp.json();
                    const chapters = j.chapters || {};
                    Object.keys(ids[subjectKey] || {}).forEach((chapterName) => {
                        const indices = ids[subjectKey][chapterName] || [];
                        const sourceArray = Array.isArray(chapters[chapterName]) ? chapters[chapterName] : [];
                        const selected = indices.map(i => sourceArray[i]).filter(Boolean);
                        if (!chaptersCombined['PYQ Practice']) chaptersCombined['PYQ Practice'] = [];
                        // attach minimal metadata to questions so review shows source
                        selected.forEach(q => {
                            const copy = Object.assign({}, q);
                            copy._pyqSource = j.subject || subjectKey;
                            copy._pyqSubjectKey = subjectKey;
                            copy._pyqChapter = chapterName;
                            chaptersCombined['PYQ Practice'].push(copy);
                        });
                    });
                } catch (e) {
                    // skip missing file
                }
            }));

            data = {
                subject: 'Previous Year Questions',
                quizType: 'practice',
                chapters: chaptersCombined,
                secondsPerQuestion: 40
            };
        } else {
            const response = await fetch(`data/${resolveSubjectDataFile(subject)}`);
            if (!response.ok) throw new Error('Unable to load quiz data for the selected subject.');
            data = await response.json();
        }

        quizData = data;
        selectedSubject = subject;
        console.log("Selected subject:", selectedSubject);
        document.getElementById('subjectTitle').innerText = data.subject;
        
        // Check if this is Mock Test mode and if a set is already selected
        const isMockMode = subject === 'mock' || quizData.subject === 'Mock Test' || quizData.totalTimeSeconds || quizData.duration;
        const mockSetNames = isMockMode ? Object.keys((quizData['TEST NUMBER'] || {})) : [];
        const isMockSetSelected = isMockMode && selectedChapterFromQuery && mockSetNames.includes(selectedChapterFromQuery);
        
        // Only load chapter selector if no chapter/set is pre-selected
        if (!isMockSetSelected) {
            loadChapters();
        }
        if (chapterSearch) {
            chapterSearch.addEventListener('input', () => filterChapters(chapterSearch.value));
        }
        const savedProgress = safeParseStoredValue(getProgressKey(), null);
        const hasSelectedChapter = Boolean(selectedChapterFromQuery && (Object.keys(quizData.chapters || {}).includes(selectedChapterFromQuery) || isMockSetSelected));

        if (hasSelectedChapter) {
            const selectedChapterMatchesResume = savedProgress && savedProgress.subject === subject && savedProgress.chapter === selectedChapterFromQuery;
            if (selectedChapterMatchesResume) {
                selectedMode = savedProgress.quizType === 'study' ? 'study' : selectedMode;
                currentChapter = savedProgress.chapter;
                questions = Array.isArray(quizData.chapters?.[currentChapter])
                    ? quizData.chapters[currentChapter]
                    : Array.isArray(quizData[currentChapter]) ? quizData[currentChapter] : [];
                currentQuestion = typeof savedProgress.currentQuestion === 'number' ? savedProgress.currentQuestion : 0;
                userAnswers = Array.isArray(savedProgress.userAnswers) ? savedProgress.userAnswers : new Array(questions.length).fill(null);
                markedForReview = Array.isArray(savedProgress.markedForReview) ? savedProgress.markedForReview : new Array(questions.length).fill(false);
                if (savedProgress.quizType === 'mock' || subject === 'mock' || quizData.subject === 'Mock Test' || quizData.totalTimeSeconds || quizData.duration) {
                    const duration = Number(savedProgress.duration || getQuizDuration());
                    const savedRemaining = Number(savedProgress.remainingTime) || duration;
                    const updatedAt = savedProgress.updatedAt ? new Date(savedProgress.updatedAt).getTime() : Date.now();
                    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
                    remainingTime = Math.max(0, savedRemaining - elapsedSeconds);
                    quizStartedAt = savedProgress.quizStartedAt || (Date.now() - Math.max(0, (duration - remainingTime) * 1000));
                } else {
                    remainingTime = Number(savedProgress.remainingTime) || Number(quizData.secondsPerQuestion) || 40;
                    quizStartedAt = savedProgress.quizStartedAt || Date.now();
                }
                chapterSection.style.display = 'none';
                quizSection.style.display = 'block';
                chapterTitle.innerText = currentChapter;
                initializeTimer();
                showQuestion();
                createPalette();
            } else {
                startQuiz(selectedChapterFromQuery);
            }
        } else if (savedProgress && savedProgress.subject === subject && savedProgress.chapter) {
            selectedMode = savedProgress.quizType === 'study' ? 'study' : selectedMode;
            currentChapter = savedProgress.chapter;
            questions = Array.isArray(quizData.chapters?.[currentChapter])
                ? quizData.chapters[currentChapter]
                : Array.isArray(quizData[currentChapter]) ? quizData[currentChapter] : [];
            currentQuestion = typeof savedProgress.currentQuestion === 'number' ? savedProgress.currentQuestion : 0;
            userAnswers = Array.isArray(savedProgress.userAnswers) ? savedProgress.userAnswers : new Array(questions.length).fill(null);
            markedForReview = Array.isArray(savedProgress.markedForReview) ? savedProgress.markedForReview : new Array(questions.length).fill(false);
            if (savedProgress.quizType === 'mock' || subject === 'mock' || quizData.subject === 'Mock Test' || quizData.totalTimeSeconds || quizData.duration) {
                const duration = Number(savedProgress.duration || getQuizDuration());
                const savedRemaining = Number(savedProgress.remainingTime) || duration;
                const updatedAt = savedProgress.updatedAt ? new Date(savedProgress.updatedAt).getTime() : Date.now();
                const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
                remainingTime = Math.max(0, savedRemaining - elapsedSeconds);
                quizStartedAt = savedProgress.quizStartedAt || (Date.now() - Math.max(0, (duration - remainingTime) * 1000));
            } else {
                remainingTime = Number(savedProgress.remainingTime) || Number(quizData.secondsPerQuestion) || 40;
                quizStartedAt = savedProgress.quizStartedAt || Date.now();
            }
            chapterSection.style.display = 'none';
            quizSection.style.display = 'block';
            chapterTitle.innerText = currentChapter;
            initializeTimer();
            showQuestion();
            createPalette();
        }
    } catch (err) {
        alert('Unable to load quiz data for the selected subject.');
    }
})();

function loadChapters() {
    if (!chapterList) {
        return;
    }

    chapterList.innerHTML = "";
    const chapterMap = quizData && quizData.chapters ? quizData.chapters : {};
    let chapters = chapterMap;
    if (Object.keys(chapterMap).length === 0 && quizData && typeof quizData === 'object' && quizData.subject === 'Mock Test') {
        const mockGroups = Object.keys(quizData).filter((key) => !['subject', 'quizType', 'totalTimeSeconds', 'secondsPerQuestion', 'duration', 'durationSeconds', 'chapters'].includes(key));
        chapters = mockGroups.reduce((acc, key) => {
            const value = quizData[key];
            if (Array.isArray(value)) {
                acc[key] = value;
            } else if (value && typeof value === 'object') {
                Object.keys(value).forEach((subKey) => {
                    acc[subKey] = value[subKey];
                });
            }
            return acc;
        }, {});
    }

    console.log("Loaded chapters:", Object.keys(chapters));
    Object.keys(chapters || {}).forEach((chapter) => {
        const btn = document.createElement("button");
        btn.innerText = chapter;
        btn.className = "chapterBtn";
        btn.onclick = () => startQuiz(chapter);
        chapterList.appendChild(btn);
    });
}

function filterChapters(term) {
    if (!chapterList) {
        return;
    }

    const searchText = term.trim().toLowerCase();
    const chapterButtons = chapterList.querySelectorAll(".chapterBtn");
    chapterButtons.forEach((btn) => {
        const chapterText = btn.textContent.toLowerCase();
        const matches = !searchText || chapterText.includes(searchText);
        btn.style.display = matches ? "block" : "none";
    });
}

function startQuiz(chapter) {
    currentChapter = chapter;
    const chapterMap = quizData && quizData.chapters ? quizData.chapters : {};
    let chapterQuestions = [];
    if (Object.keys(chapterMap).length > 0) {
        chapterQuestions = Array.isArray(chapterMap[chapter]) ? chapterMap[chapter] : [];
    } else if (quizData && quizData.subject === 'Mock Test') {
        const mockGroups = Object.keys(quizData).filter((key) => !['subject', 'quizType', 'totalTimeSeconds', 'secondsPerQuestion', 'duration', 'durationSeconds', 'chapters'].includes(key));
        const flattened = mockGroups.reduce((acc, key) => {
            const value = quizData[key];
            if (Array.isArray(value)) {
                acc[key] = value;
            } else if (value && typeof value === 'object') {
                Object.keys(value).forEach((subKey) => {
                    acc[subKey] = value[subKey];
                });
            }
            return acc;
        }, {});
        chapterQuestions = Array.isArray(flattened[chapter]) ? flattened[chapter] : [];
    }
    questions = chapterQuestions;
    currentQuestion = 0;
    userAnswers = new Array(questions.length).fill(null);
    markedForReview = new Array(questions.length).fill(false);
    clearInterval(timer);
    timer = null;
    paused = false;
    quizStartedAt = Date.now();

    chapterSection.style.display = "none";
    quizSection.style.display = "block";
    chapterTitle.innerText = chapter;

    if (getQuizMode() === "practice") {
        remainingTime = Number(quizData.secondsPerQuestion) || 40;
    } else {
        remainingTime = getQuizDuration();
    }

    quizStartedAt = Date.now();
    saveProgress();
    initializeTimer();
    showQuestion();
    createPalette();
}

function isMatchListQuestion(question) {
    const text = String(question?.q || "");
    return /\b(?:list|column)\s*[-–—]?\s*(?:i|ii|1|2|a|b)\b/i.test(text)
        || /\b(?:match|matching|pairs?\s+are\s+correct(?:ly)?\s+matched|correctly\s+match)\b/i.test(text);
}

function parseMatchListQuestion(question) {
    if (!isMatchListQuestion(question)) {
        return null;
    }

    const rawText = String(question.q || "");
    const text = rawText.replace(/(?:\s|<br\s*\/?>)+Codes?\s*:?\s*(?:Code\s*:?\s*)?(?:(?:\s|<br\s*\/?>)+[A-D](?:[.)])?){2,}\s*$/i, "").trim();
    const markerPattern = /(?<![A-Za-z0-9])(\(\d{1,2}\)|\d{1,2}[.):]?|\([A-Za-z]\)|[A-Za-z][.):]?|\([IVXivx]+\)|[IVXivx]+[.):]?)(?=\s|<br\s*\/?>|$)/g;
    const headerPattern = /((?:List|Column)\s*[-–—]?\s*(?:I|II|1|2|A|B)\b(?:\s*\([^)]*\))?)/gi;
    const headers = Array.from(text.matchAll(headerPattern));
    const romanValues = { I: 1, V: 5, X: 10 };
    const questionNumber = text.match(/^\s*\d{1,3}[.)]?\s+/);
    const tokens = Array.from(text.matchAll(markerPattern)).filter((token) => {
        const before = text.slice(Math.max(0, token.index - 12), token.index);
        return !(questionNumber && token.index < questionNumber[0].length)
            && !/(?:List|Column)\s*[-–—]?\s*$/i.test(before);
    });
    const markerInfo = (marker) => {
        const value = marker.replace(/[().,:]/g, "");
        if (/^\d+$/.test(value)) {
            return [{ family: "numeric", value: Number(value), caseKey: "" }];
        }
        if (/^[IVX]+$/i.test(value)) {
            const upper = value.toUpperCase();
            const number = upper.split("").reduce((total, numeral, index, numerals) => {
                const current = romanValues[numeral];
                const next = romanValues[numerals[index + 1]] || 0;
                return total + (current < next ? -current : current);
            }, 0);
            const roman = { family: "roman", value: number, caseKey: value === upper ? "upper" : "lower" };
            return value.length === 1 ? [roman, { family: "letter", value: upper.charCodeAt(0) - 64, caseKey: value === upper ? "upper" : "lower" }] : [roman];
        }
        return [{ family: "letter", value: value.toUpperCase().charCodeAt(0) - 64, caseKey: value === value.toUpperCase() ? "upper" : "lower" }];
    };
    const sequences = [];
    tokens.forEach((startToken, startIndex) => {
        markerInfo(startToken[1]).forEach((firstInfo) => {
            if (firstInfo.value !== 1 || startToken.index === 0 || !text.slice(0, startToken.index).trim()) {
                return;
            }
            const sequence = [{ token: startToken, info: firstInfo }];
            let nextValue = 2;
            for (let index = startIndex + 1; index < tokens.length; index += 1) {
                const nextInfo = markerInfo(tokens[index][1]).find((candidate) => candidate.family === firstInfo.family
                    && candidate.caseKey === firstInfo.caseKey && candidate.value === nextValue);
                if (nextInfo) {
                    sequence.push({ token: tokens[index], info: nextInfo });
                    nextValue += 1;
                }
            }
            if (sequence.length >= 2) {
                sequences.push(sequence);
            }
        });
    });
    const uniqueSequences = [];
    sequences.sort((first, second) => second.length - first.length).forEach((sequence) => {
        const key = `${sequence[0].token.index}:${sequence[0].info.family}:${sequence[0].info.caseKey}`;
        if (!uniqueSequences.some((existing) => `${existing[0].token.index}:${existing[0].info.family}:${existing[0].info.caseKey}` === key)) {
            uniqueSequences.push(sequence);
        }
    });
    const headerOneMatches = headers.filter((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:I|1|A)\b/i.test(header[0]));
    const headerOne = headerOneMatches[headerOneMatches.length - 1];
    const headerTwo = headers.find((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:II|2|B)\b/i.test(header[0]) && header.index > headerOne?.index);
    const hasHeaders = Boolean(headerOne && headerTwo);
    const pairs = [];
    for (let first = 0; first < uniqueSequences.length; first += 1) {
        for (let second = first + 1; second < uniqueSequences.length; second += 1) {
            const left = uniqueSequences[first];
            const right = uniqueSequences[second];
            if (left.some((entry) => right.some((other) => entry.token.index === other.token.index))) {
                continue;
            }
            const distinctFamilies = left[0].info.family !== right[0].info.family || left[0].info.caseKey !== right[0].info.caseKey;
            if (!distinctFamilies && !hasHeaders) {
                continue;
            }
            pairs.push({ left, right, confidence: Math.min(left.length, right.length) * 10 + (hasHeaders ? 5 : 0) + (distinctFamilies ? 3 : 0) });
        }
    }
    if (!pairs.length || (!hasHeaders && !/\b(?:match|matching|pairs?)\b/i.test(text))) {
        return null;
    }
    const selected = pairs.sort((first, second) => second.confidence - first.confidence)[0];
    let left = selected.left;
    let right = selected.right;
    if (left[0].token.index > right[0].token.index) {
        [left, right] = [right, left];
    }
    const grouped = left[left.length - 1].token.index < right[0].token.index;
    const cleanText = (value) => value.replace(/^(?:\s|<br\s*\/?>)+/i, "").trim();
    const rows = [];
    const rowCount = Math.max(left.length, right.length);
    for (let index = 0; index < rowCount; index += 1) {
        const leftEntry = left[index] ? {
            marker: left[index].token[1],
            text: cleanText(text.slice(left[index].token.index + left[index].token[1].length, grouped ? left[index + 1]?.token.index ?? right[0]?.token.index ?? text.length : right[index]?.token.index ?? left[index + 1]?.token.index ?? text.length))
        } : null;
        const rightEntry = right[index] ? {
            marker: right[index].token[1],
            text: cleanText(text.slice(right[index].token.index + right[index].token[1].length, grouped ? right[index + 1]?.token.index ?? text.length : left[index + 1]?.token.index ?? text.length))
        } : null;
        if (leftEntry || rightEntry) {
            rows.push({
                left: leftEntry ? `${leftEntry.marker} ${leftEntry.text}` : "",
                right: rightEntry ? `${rightEntry.marker} ${rightEntry.text}` : ""
            });
        }
    }
    if (!rows.some((row) => row.left && row.right)) {
        return null;
    }
    const firstItemIndex = Math.min(left[0].token.index, right[0].token.index);
    return {
        prompt: text.slice(0, hasHeaders ? headerOne.index : firstItemIndex).trim(),
        listOneHeader: headerOne?.[1] || "List-I",
        listTwoHeader: headerTwo?.[1] || "List-II",
        rows
    };
}

function renderMatchListTable(parsed) {
    if (!parsed) {
        return "";
    }

    const escape = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const rows = parsed.rows.map((row) => `
        <div class="match-list-row" role="row">
            <div class="match-list-cell match-list-left" role="cell">${escape(row.left)}</div>
            <div class="match-list-cell match-list-right" role="cell">${escape(row.right)}</div>
        </div>
    `).join("");
    return `
        <div class="match-list-table" role="table" aria-label="${escape(parsed.listOneHeader)} and ${escape(parsed.listTwoHeader)}">
            <div class="match-list-header match-list-left" role="columnheader">${escape(parsed.listOneHeader)}</div>
            <div class="match-list-header match-list-right" role="columnheader">${escape(parsed.listTwoHeader)}</div>
            ${rows}
        </div>
    `;
}

function parseStatementQuestion(question) {
    if (isMatchListQuestion(question)) {
        return null;
    }

    const text = String(question?.q || "");
    const assertionMarker = /Assertion\s*\(A\)\s*:/gi;
    const reasonMarker = /Reason\s*\(R\)\s*:/gi;
    const assertionMatches = Array.from(text.matchAll(assertionMarker));
    const reasonMatches = Array.from(text.matchAll(reasonMarker));
    let assertionMatch = null;
    let reasonMatch = null;
    for (let index = assertionMatches.length - 1; index >= 0; index -= 1) {
        const candidateReason = reasonMatches.find((match) => match.index > assertionMatches[index].index);
        if (candidateReason) {
            assertionMatch = assertionMatches[index];
            reasonMatch = candidateReason;
            break;
        }
    }
    if (assertionMatch && reasonMatch && assertionMatch.index < reasonMatch.index) {
        const instructionPattern = /\bChoose\s+the\s+correct\s+answer\b[\s\S]*$/i;
        const assertionText = text.slice(assertionMatch.index + assertionMatch[0].length, reasonMatch.index).trim();
        const reasonStart = reasonMatch.index + reasonMatch[0].length;
        const reasonAndInstruction = text.slice(reasonStart);
        const instructionMatch = instructionPattern.exec(reasonAndInstruction);
        const reasonText = (instructionMatch ? reasonAndInstruction.slice(0, instructionMatch.index) : reasonAndInstruction).trim();
        return {
            stem: text.slice(0, assertionMatch.index).trim(),
            statements: [
                { marker: "Assertion (A):", text: assertionText },
                { marker: "Reason (R):", text: reasonText }
            ],
            finalInstruction: instructionMatch ? instructionMatch[0].trim() : ""
        };
    }
    const markerPattern = /(?<![A-Za-z0-9])(\(?\d{1,2}\)?[.,):]?|\(?[A-Za-z]\)?[.,):]?|\(?[IVXivx]+\)?[.,):]?)(?=\s|<br\s*\/?>|$)/g;
    const allMarkers = Array.from(text.matchAll(markerPattern)).filter((marker) => {
        const value = marker[1].replace(/[().,:]/g, "");
        if (!/^\d+$/.test(value)) {
            return true;
        }
        const before = text.slice(0, marker.index);
        return !/(?:january|february|march|april|may|june|july|august|september|october|november|december|article|stage|section|chapter|question)\s*$/i.test(before);
    });
    const romanValues = { I: 1, V: 5, X: 10 };
    const getMarkerInfo = (marker) => {
        const value = marker.replace(/[().,:]/g, "");
        if (/^\d+$/.test(value)) {
            return { family: "numeric", value: Number(value), caseKey: "" };
        }
        if (/^[IVX]+$/i.test(value)) {
            const upper = value.toUpperCase();
            const number = upper.split("").reduce((total, numeral, index, numerals) => {
                const current = romanValues[numeral];
                const next = romanValues[numerals[index + 1]] || 0;
                return total + (current < next ? -current : current);
            }, 0);
            return { family: "roman", value: number, caseKey: value === value.toUpperCase() ? "upper" : "lower" };
        }
        return { family: "letter", value: value.toUpperCase().charCodeAt(0) - 64, caseKey: value === value.toUpperCase() ? "upper" : "lower" };
    };
    const isCanonicalStart = (info) => (info.family === "numeric" && info.value === 1)
        || (info.family === "letter" && info.value === 1)
        || (info.family === "roman" && info.value === 1);
    const sequences = [];
    allMarkers.forEach((marker, startIndex) => {
        const firstInfo = getMarkerInfo(marker[1]);
        if (!isCanonicalStart(firstInfo) || marker.index === 0 || !text.slice(0, marker.index).trim()) {
            return;
        }
        const sequence = [marker];
        for (let index = startIndex + 1; index < allMarkers.length; index += 1) {
            const previousInfo = getMarkerInfo(sequence[sequence.length - 1][1]);
            const nextInfo = getMarkerInfo(allMarkers[index][1]);
            if (nextInfo.family !== firstInfo.family || nextInfo.caseKey !== firstInfo.caseKey
                || nextInfo.value !== previousInfo.value + 1) {
                continue;
            }
            sequence.push(allMarkers[index]);
        }
        if (sequence.length >= 2) {
            sequences.push(sequence);
        }
    });
    const markers = sequences.sort((first, second) => second.length - first.length)[0];
    if (!markers) {
        return null;
    }

    const statements = markers.map((marker, index) => ({
        marker: marker[1],
        text: text.slice(marker.index + marker[1].length, markers[index + 1]?.index ?? text.length)
            .replace(/^(?:\s|<br\s*\/?>)+/i, "")
            .trim()
    }));
    const lastStatement = statements[statements.length - 1];
    const questionEnd = Math.max(
        lastStatement.text.lastIndexOf("?"),
        lastStatement.text.lastIndexOf("؟"),
        lastStatement.text.lastIndexOf(":")
    );
    let finalInstruction = "";
    if (questionEnd > 0) {
        const boundary = Math.max(
            lastStatement.text.lastIndexOf(".", questionEnd - 1),
            lastStatement.text.lastIndexOf("!", questionEnd - 1)
        );
        if (boundary >= 0) {
            finalInstruction = lastStatement.text.slice(boundary + 1).trim();
            lastStatement.text = lastStatement.text.slice(0, boundary + 1).trim();
        }
    }

    return {
        stem: text.slice(0, markers[0].index).trim(),
        statements,
        finalInstruction
    };
}

function renderStatementQuestion(parsed) {
    return `
        <div class="question-statement statement-question">
            <p>${parsed.stem}</p>
            ${parsed.statements.map((statement) => `<p class="statement-item">${statement.marker} ${statement.text}</p>`).join("")}
            ${parsed.finalInstruction ? `<p class="statement-instruction">${parsed.finalInstruction}</p>` : ""}
        </div>
    `;
}

function getRenderedQuestionText(question, parsedMatchList) {
    const text = String(question?.q || "");
    if (parsedMatchList) {
        return parsedMatchList.prompt;
    }

    if (!isMatchListQuestion(question)) {
        return text;
    }

    // Keep the question text when matching data is incomplete, but hide only a trailing extracted code block.
    return text.replace(/(?:<br\s*\/?>(?:\s*)|\r?\n|\s)+Code\s*:?\s*(?:Code\s*)?(?:<br\s*\/?>(?:\s*)|\r?\n|\s)+A(?:[.)])?(?:<br\s*\/?>(?:\s*)|\r?\n|\s)+B(?:[.)])?(?:<br\s*\/?>(?:\s*)|\r?\n|\s)+C(?:[.)])?(?:<br\s*\/?>(?:\s*)|\r?\n|\s)+D(?:[.)])?\s*$/i, "").trim();
}

function showQuestion() {
    const q = questions[currentQuestion];
    if (!q) {
        return;
    }

    const isMarkedReview = Boolean(markedForReview[currentQuestion]);
    const isMatchListCandidate = isMatchListQuestion(q);
    const parsedMatchList = isMatchListCandidate ? parseMatchListQuestion(q) : null;
    const isMatchList = Boolean(parsedMatchList);
    const parsedStatementQuestion = isMatchListCandidate ? null : parseStatementQuestion(q);

    // [MATCH-LIST-RENDERER-DIAGNOSTIC] Question rendering started
    if (q.q && q.q.includes("Major States of Deccan")) {
        console.log("[MATCH-LIST-RENDERER-V3] Processing Deccan Question");
        console.log("[MATCH-LIST-RENDERER-V3] isMatchList detected:", isMatchList);
        console.log("[MATCH-LIST-RENDERER-V3] parsedMatchList:", parsedMatchList);
        console.log("[MATCH-LIST-RENDERER-V3] question.q preview:", q.q.substring(0, 200));
        console.log("[MATCH-LIST-RENDERER-V3] question.options:", q.options);
    }

    const renderedQuestionText = getRenderedQuestionText(q, parsedMatchList);
    const questionContent = parsedStatementQuestion
        ? renderStatementQuestion(parsedStatementQuestion)
        : `<div class="question-statement"><p>${renderedQuestionText}</p></div>`;
    let html = `
        <div class="question-header">
            <h3>Question ${currentQuestion + 1}</h3>
        </div>
        ${isMatchList && parsedMatchList ? `${renderedQuestionText ? `<div class="question-statement"><p>${renderedQuestionText}</p></div>` : ""}${renderMatchListTable(parsedMatchList)}` : questionContent}
    `;

    q.options.forEach((option, index) => {
        const optionText = String(option);
        const optionLabel = /^[A-D](?:[.)])\s+/i.test(optionText) ? "" : `${String.fromCharCode(65 + index)}. `;
        html += `
            <label class="option-wrap">
                <input type="radio" name="answer" value="${index}" />
                <span>${isMatchList ? optionLabel : ""}${option}</span>
            </label>
        `;
    });

    questionBox.innerHTML = html;

    const feedbackHtml = isStudyMode() ? renderStudyFeedback(q) : "";
    if (isStudyMode()) {
        questionBox.insertAdjacentHTML("beforeend", feedbackHtml);
    }

    if (userAnswers[currentQuestion] != null) {
        const selected = document.querySelector(`input[value="${userAnswers[currentQuestion]}"]`);
        if (selected) {
            selected.checked = true;
        }
    }

    if (isStudyMode()) {
        const answerInputs = document.querySelectorAll('input[name="answer"]');
        const hasAnswer = userAnswers[currentQuestion] != null;
        answerInputs.forEach((input) => {
            input.disabled = hasAnswer;
            input.addEventListener("change", () => {
                if (!hasAnswer) {
                    userAnswers[currentQuestion] = Number.parseInt(input.value, 10);
                    saveProgress();
                    updatePalette();
                    showQuestion();
                }
            });
        });
    } else {
        const answerInputs = document.querySelectorAll('input[name="answer"]');
        answerInputs.forEach((input) => {
            input.addEventListener("change", () => {
                userAnswers[currentQuestion] = Number.parseInt(input.value, 10);
                saveProgress();
                updatePalette();
                if (getQuizMode() === "mock") {
                    paused = false;
                    pauseBtn.innerHTML = "⏸ Pause";
                }
            });
        });
    }

    progressText.innerHTML = `Question ${currentQuestion + 1} of ${questions.length}`;
    progressFill.style.width = `${((currentQuestion + 1) / questions.length) * 100}%`;

    prevBtn.disabled = currentQuestion === 0;
    const isLastQuestion = currentQuestion === questions.length - 1;
    nextBtn.style.display = isLastQuestion ? "none" : "inline-flex";
    markReviewBtn.style.display = "inline-flex";
    markReviewBtn.classList.toggle("review-active", isMarkedReview);
    markReviewBtn.innerText = isMarkedReview ? "🚩 Review On" : "🚩 Mark for Review";

    if (topbarKicker) {
        topbarKicker.innerText = isStudyMode() ? "Study Mode" : "Exam Mode";
    }

    if (getQuizMode() === "practice") {
        startQuestionTimer();
    } else {
        updateTimer();
    }

    updatePalette();
    saveProgress();
}

function initializeTimer() {
    clearInterval(timer);
    timer = null;

    if (getQuizMode() === "practice") {
        timerNode.style.display = "inline-block";
        pauseBtn.style.display = "inline-flex";
        pauseBtn.innerHTML = "⏸ Pause";
        paused = false;
        remainingTime = Number(quizData.secondsPerQuestion) || 40;
        updateTimer();
        timer = setInterval(runTimer, 1000);
        return;
    }

    if (getQuizMode() === "mock") {
        timerNode.style.display = "inline-block";
        pauseBtn.style.display = "inline-flex";
        pauseBtn.innerHTML = "⏸ Pause";
        paused = false;
        if (!remainingTime || remainingTime <= 0) {
            remainingTime = Number(quizData.duration) || 7200;
        }
        updateTimer();
        timer = setInterval(runTimer, 1000);
        return;
    }

    timerNode.style.display = "none";
    pauseBtn.style.display = "none";
}

function startQuestionTimer() {
    clearInterval(timer);
    timer = null;
    if (getQuizMode() !== "practice") {
        return;
    }
    remainingTime = Number(quizData.secondsPerQuestion) || 40;
    paused = false;
    pauseBtn.innerHTML = "⏸ Pause";
    updateTimer();
    timer = setInterval(runTimer, 1000);
}

function runTimer() {
    if (paused || !timer) {
        return;
    }

    remainingTime -= 1;
    updateTimer();
    saveProgress();

    if (remainingTime <= 0) {
        clearInterval(timer);
        timer = null;
        if (getQuizMode() === "practice") {
            saveCurrentAnswer();
            if (currentQuestion === questions.length - 1) {
                finishQuiz(true);
            } else {
                currentQuestion += 1;
                showQuestion();
            }
        } else {
            finishQuiz(true);
        }
    }
}

function updateTimer() {
    const hours = Math.floor(remainingTime / 3600);
    const minutes = Math.floor((remainingTime % 3600) / 60);
    const seconds = remainingTime % 60;
    const isLowWarning = remainingTime < 600;
    const isCritical = remainingTime < 300;
    const blinkState = isCritical && Math.floor(Date.now() / 1000) % 2 === 0;

    timerNode.innerHTML = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    timerNode.classList.toggle("timer-warning", isLowWarning && !isCritical);
    timerNode.classList.toggle("timer-critical", isCritical);
    timerNode.classList.toggle("timer-blink", blinkState);
}

pauseBtn.onclick = function () {
    paused = !paused;
    pauseBtn.innerHTML = paused ? "▶ Resume" : "⏸ Pause";
};

exitBtn.onclick = function () {
    const shouldExit = window.confirm("Exit this quiz? Your progress can be resumed from the chapter list.");
    if (shouldExit) {
        saveProgress();
        window.location.href = "dashboard.html";
    }
};

if (prevBtn) {
    prevBtn.onclick = function () {
        if (currentQuestion === 0) {
            return;
        }

        currentQuestion -= 1;
        showQuestion();
    };
}

if (nextBtn) {
    nextBtn.onclick = function () {
        currentQuestion += 1;
        showQuestion();
    };
}

if (clearSelectionBtn) {
    clearSelectionBtn.onclick = function () {
        userAnswers[currentQuestion] = null;
        saveProgress();
        updatePalette();
        showQuestion();
    };
}

document.addEventListener("keydown", (event) => {
    if (event.target instanceof Element && event.target.closest("input:not([type=\"radio\"]), textarea, select, [contenteditable=\"true\"], [role=\"textbox\"]")) {
        return;
    }
    if (submitModal && submitModal.style.display !== "none") {
        return;
    }

    const key = event.key.toLowerCase();
    const isSpace = event.key === " " || event.key === "Spacebar" || event.key === "Space";
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const button = event.key === "ArrowLeft" ? prevBtn : nextBtn;
        if (!button || button.disabled) {
            return;
        }
        button.click();
        return;
    }

    if (isSpace || key === "e") {
        const button = isSpace ? pauseBtn : exitBtn;
        if (!button || button.disabled || button.hidden || button.getClientRects().length === 0) {
            return;
        }
        event.preventDefault();
        button.click();
        return;
    }

    if (key === "b") {
        event.preventDefault();
        history.back();
    }
});

if (submitBtn) {
    submitBtn.onclick = function () {
        openSubmitModal();
    };
}

if (markReviewBtn) {
    markReviewBtn.onclick = function () {
        toggleReviewMark(currentQuestion);
    };
}

if (cancelSubmitBtn) {
    cancelSubmitBtn.onclick = function () {
        submitModal.style.display = "none";
    };
}

if (confirmSubmitBtn) {
    confirmSubmitBtn.onclick = function () {
        submitModal.style.display = "none";
        finishQuiz(false);
    };
}

function openSubmitModal() {
    if (!submitModal) {
        finishQuiz(false);
        return;
    }

    const answered = userAnswers.filter((answer) => answer != null).length;
    const notAnswered = questions.length - answered;
    const markedReview = markedForReview.filter(Boolean).length;
    document.getElementById("confirmAnswered").innerText = answered;
    document.getElementById("confirmNotAnswered").innerText = notAnswered;
    document.getElementById("confirmMarkedReview").innerText = markedReview;
    submitModal.style.display = "flex";
}

function saveCurrentAnswer() {
    if (isStudyMode() && userAnswers[currentQuestion] != null) {
        return;
    }
    const selected = document.querySelector('input[name="answer"]:checked');
    if (selected) {
        userAnswers[currentQuestion] = Number.parseInt(selected.value, 10);
    } else if (userAnswers[currentQuestion] == null) {
        userAnswers[currentQuestion] = null;
    }
    saveProgress();
}

function renderStudyFeedback(question) {
    const selected = userAnswers[currentQuestion];
    if (selected == null) {
        return "";
    }
    const status = selected === question.answer ? "Correct" : "Incorrect";
    const statusClass = selected === question.answer ? "study-status-correct" : "study-status-incorrect";
    const selectedText = escapeHtml(question.options[selected]);
    const explanationText = question.explanation && String(question.explanation).trim() ? escapeHtml(question.explanation) : "Explanation is currently unavailable for this question.";
    return `
        <div class="study-feedback">
            <div class="study-status ${statusClass}">✔ ${status} answer</div>
            <p class="study-detail">You selected <strong>${selectedText}</strong>. ${status === "Correct" ? "This choice is right." : "This choice is incorrect."}</p>
            <div class="study-explanation">
                <strong>Explanation:</strong>
                <p>${explanationText}</p>
            </div>
        </div>
    `;
}

function createPalette() {
    if (!paletteNode) {
        return;
    }

    paletteNode.innerHTML = "";
    questions.forEach((q, index) => {
        const btn = document.createElement("button");
        btn.innerText = index + 1;
        btn.className = "palette-btn";
        btn.onclick = () => {
            saveCurrentAnswer();
            currentQuestion = index;
            showQuestion();
        };
        paletteNode.appendChild(btn);
    });
    updatePalette();
}

function updatePalette() {
    if (!paletteNode) {
        return;
    }

    const buttons = paletteNode.querySelectorAll("button");
    buttons.forEach((btn, index) => {
        btn.className = "palette-btn";
        const isReview = Boolean(markedForReview[index]);
        const isAnswered = userAnswers[index] != null;
        if (index === currentQuestion) {
            btn.classList.add("current");
        } else if (isAnswered && isReview) {
            btn.classList.add("answered-review");
        } else if (isReview) {
            btn.classList.add("review");
        } else if (isAnswered) {
            btn.classList.add("answered");
        } else {
            btn.classList.add("notanswered");
        }
    });
}

function saveProgress() {
    if (cachedProgressQuestions !== questions) {
        cachedProgressQuestions = questions;
        cachedProgressQuestionsJson = JSON.stringify(questions);
    }

    const progressPrefix = JSON.stringify({
        subject,
        subjectKey: currentSubjectKey,
        chapter: currentChapter,
        currentQuestion,
        userAnswers,
        markedForReview
    });
    const progressSuffix = JSON.stringify({
        remainingTime,
        duration: getQuizMode() === "practice" ? Number(quizData.secondsPerQuestion) || 40 : getQuizDuration(),
        quizType: getQuizMode(),
        quizStartedAt,
        updatedAt: new Date().toISOString()
    });
    const serializedProgress = `${progressPrefix.slice(0, -1)},"questions":${cachedProgressQuestionsJson},${progressSuffix.slice(1)}`;
    localStorage.setItem(getProgressKey(), serializedProgress);
}

function toggleReviewMark(questionIndex) {
    markedForReview[questionIndex] = !markedForReview[questionIndex];
    saveProgress();
    showQuestion();
    updatePalette();
}

function finishQuiz(timeout = false) {
    clearInterval(timer);
    timer = null;
    saveCurrentAnswer();

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let markedReview = 0;

    questions.forEach((q, i) => {
        if (markedForReview[i]) {
            markedReview += 1;
        }
        if (userAnswers[i] == null) {
            skipped += 1;
        } else if (userAnswers[i] === q.answer) {
            correct += 1;
        } else {
            wrong += 1;
        }
    });

    const attempted = correct + wrong;
    const accuracy = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    const timeTaken = Math.max(0, Math.round((Date.now() - quizStartedAt) / 1000));
    const positiveMarks = getQuizMode() === "mock" ? correct - wrong / 3 : correct;
    const negativeMarks = getQuizMode() === "mock" ? wrong / 3 : 0;
    const finalScore = getQuizMode() === "mock" ? correct - wrong / 3 : correct;
    const normalizedQuestions = questions.map((question) => {
        const explanationSource = question.explanation || "";
        const explanationDocument = explanationSource
            ? (window.ExplanationRenderer ? window.ExplanationRenderer.normalizeExplanationDocument(explanationSource) : { type: "document", blocks: [{ type: "paragraph", content: explanationSource }] })
            : { type: "document", blocks: [] };
        return {
            ...question,
            explanationDocument,
            explanation: explanationSource
        };
    });
    const result = {
        subject: quizData.subject,
        subjectKey: subject,
        chapter: currentChapter,
        quizId: getQuizId(),
        duration: getQuizMode() === "practice" ? Number(quizData.secondsPerQuestion) || 40 : getQuizDuration(),
        quizUrl: `quiz.html${window.location.search}`,
        total: questions.length,
        correct,
        wrong,
        skipped,
        attempted,
        accuracy,
        percentage: accuracy,
        score: correct,
        finalScore,
        positiveMarks,
        negativeMarks,
        quizType: quizData.quizType,
        timeout,
        questions: normalizedQuestions,
        userAnswers,
        markedForReview,
        markedReview,
        timeTaken,
        percentage: accuracy,
        completedAt: new Date().toISOString()
    };

    localStorage.setItem(getResultKey(), JSON.stringify(result));
    saveAttempt(result);
    localStorage.removeItem(getProgressKey());
    const resultUrl = isStudyMode() ? "result-review.html?mode=study" : "result-review.html";
    window.location.href = resultUrl;
}

function getSavedQuestions() {
    return safeParseStoredValue("bookmarks", []);
}


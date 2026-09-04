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
const classifiedReviewPayload = (() => {
    try {
        return JSON.parse(sessionStorage.getItem("classifiedReviewQuestions") || "null");
    } catch (error) {
        return null;
    }
})();
const result = isHistoricalReview
    ? historicalAttempt
    : (rawResult
        ? JSON.parse(rawResult)
        : (savedReviewFocus
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
            : (classifiedReviewPayload
                ? {
                    subject: classifiedReviewPayload.subject || classifiedReviewPayload.subjectKey || "Classified",
                    subjectKey: classifiedReviewPayload.subjectKey || classifiedReviewPayload.subject || "classified",
                    chapter: classifiedReviewPayload.chapter || "Important Questions",
                    total: Array.isArray(classifiedReviewPayload.questions) ? classifiedReviewPayload.questions.length : 0,
                    attempted: 0,
                    correct: 0,
                    wrong: 0,
                    skipped: Array.isArray(classifiedReviewPayload.questions) ? classifiedReviewPayload.questions.length : 0,
                    accuracy: 0,
                    questions: Array.isArray(classifiedReviewPayload.questions) ? classifiedReviewPayload.questions : [],
                    userAnswers: Array.isArray(classifiedReviewPayload.questions) ? new Array(classifiedReviewPayload.questions.length).fill(null) : []
                }
                : null)));
const isPostSubmitReview = Boolean(rawResult && !isHistoricalReview && !savedReviewFocus && !classifiedReviewPayload);
const savedReviewQuestionIndex = savedReviewFocus ? Number(savedReviewFocus.questionIndex || 0) : null;
if (savedReviewFocus) {
    sessionStorage.removeItem("savedReviewFocus");
}
if (classifiedReviewPayload) {
    sessionStorage.removeItem("classifiedReviewQuestions");
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
const returnUrl = urlParams.get("returnUrl");

if (returnUrl) {
    const backButton = document.querySelector(".back-button");
    if (backButton) backButton.href = returnUrl;
}

let activeQuestionIndex = 0;
let activeFilter = "all";
let activeSearchQuery = "";
let editingExplanationIndex = null;
let editingAnswerIndex = null;
let persistentSubjectClassifications = {};
let persistentSubjectClassificationsLoaded = false;
let persistentCurrentAffairsClassifications = {};
let serverClassificationStore = {};
let savedQuestionsCache = [];
let savedQuestionsLoaded = false;
window.reviewResultQuestions = result && Array.isArray(result.questions) ? result.questions : [];

function persistentClassificationIdentity(question, index) {
    const source = getReviewQuestionSource(question, index);
    return `${source.sourceSubjectKey}::${source.chapter}::${source.questionId || ""}::${source.questionIndex ?? index}`;
}

async function loadPersistentSubjectClassifications() {
    if (!quizApiUrl("api/health")) {
        persistentSubjectClassificationsLoaded = true;
        return;
    }
    const targets = { modern: "H", geography: "G", polity: "P", economy: "E" };
    await Promise.all(Object.entries(targets).map(async ([subjectKey, tag]) => {
        try {
            const response = await fetch(quizApiUrl(`api/important-classifications?targetSubjectKey=${subjectKey}`), { cache: "no-store" });
            if (!response.ok) return;
            const data = await response.json();
            (data.questions || []).forEach((question) => {
                const source = question._source;
                if (!source) return;
                const identity = `${source.sourceSubjectKey}::${source.chapter}::${source.questionId || ""}::${source.questionIndex ?? ""}`;
                persistentSubjectClassifications[identity] = {
                    ...(persistentSubjectClassifications[identity] || {}),
                    [tag]: true
                };
            });
        } catch (error) {
            // Classification storage failure must not block Review rendering.
        }
    }));
    try {
        const response = await fetch(quizApiUrl("api/current-affairs"), { cache: "no-store" });
        if (response.ok) {
            const data = await response.json();
            (data.questions || []).forEach((item) => {
                const source = item.source || item._source;
                if (!source) return;
                persistentCurrentAffairsClassifications[`${source.sourceSubjectKey}::${source.chapter}::${source.questionId || ""}::${source.questionIndex ?? ""}`] = { CA: true };
            });
        }
    } catch (error) {
        // Classification storage failure must not block Review rendering.
    }
    persistentSubjectClassificationsLoaded = true;
}

async function loadSavedQuestionsFromServer() {
    if (!quizApiUrl("api/health")) return;
    try {
        const response = await fetch(quizApiUrl("api/saved-questions"), { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        savedQuestionsCache = Object.values(data.groups || {}).flatMap((items) => items.map((item) => ({
            ...item,
            ...(item.source || {}),
            subjectKey: item.source?.sourceSubjectKey,
            chapter: item.source?.chapter,
            questionIndex: item.source?.questionIndex
        })));
        savedQuestionsLoaded = true;
    } catch (error) {
        // Keep Review available when the storage service is unavailable.
    }
}

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

// Reading Mode Highlighter Functions
function getReadingHighlights() {
    try {
        return JSON.parse(localStorage.getItem("readingHighlights") || "{}");
    } catch (e) {
        return {};
    }
}

function saveReadingHighlights(highlights) {
    try {
        localStorage.setItem("readingHighlights", JSON.stringify(highlights));
    } catch (e) {
        console.error("Failed to save highlights:", e);
    }
}

function getQuestionHighlights(questionIndex) {
    const allHighlights = getReadingHighlights();
    return allHighlights[questionIndex] || [];
}

function saveQuestionHighlights(questionIndex, highlights) {
    const allHighlights = getReadingHighlights();
    allHighlights[questionIndex] = highlights;
    saveReadingHighlights(allHighlights);
}

function addHighlight(questionIndex, range, color = "yellow") {
    const highlights = getQuestionHighlights(questionIndex);
    highlights.push({
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startNodePath: getNodePath(range.startContainer),
        endNodePath: getNodePath(range.endContainer),
        color: color,
        text: range.toString()
    });
    saveQuestionHighlights(questionIndex, highlights);
}

function removeHighlight(questionIndex, highlightIndex) {
    const highlights = getQuestionHighlights(questionIndex);
    highlights.splice(highlightIndex, 1);
    saveQuestionHighlights(questionIndex, highlights);
}

function getNodePath(node) {
    const path = [];
    let current = node;
    while (current && current.nodeType !== Node.DOCUMENT_NODE) {
        let index = 0;
        let sibling = current.previousSibling;
        while (sibling) {
            if (sibling.nodeType === current.nodeType) {
                index++;
            }
            sibling = sibling.previousSibling;
        }
        path.unshift({ tagName: current.tagName, index, type: current.nodeType });
        current = current.parentNode;
    }
    return path;
}

function applyReadingHighlights(explanationBox, questionIndex) {
    if (!explanationBox) return;
    
    const highlights = getQuestionHighlights(questionIndex);
    if (!highlights.length) return;
    
    highlights.forEach((highlight) => {
        try {
            applyHighlightToDOM(explanationBox, highlight);
        } catch (e) {
            // Highlight range may be invalid after DOM changes
        }
    });
}

function applyHighlightToDOM(container, highlight) {
    const range = document.createRange();
    
    try {
        const startNode = findNodeByPath(container, highlight.startNodePath);
        const endNode = findNodeByPath(container, highlight.endNodePath);
        
        if (startNode && endNode) {
            range.setStart(startNode, highlight.startOffset);
            range.setEnd(endNode, highlight.endOffset);
            
            const span = document.createElement("span");
            span.className = `reading-highlight-${highlight.color}`;
            span.dataset.highlightColor = highlight.color;
            
            try {
                range.surroundContents(span);
            } catch (e) {
                const contents = range.extractContents();
                span.appendChild(contents);
                range.insertNode(span);
            }
        }
    } catch (e) {
        // Invalid highlight range
    }
}

function findNodeByPath(container, path) {
    let current = container;
    for (const step of path) {
        let index = 0;
        let found = false;
        for (const child of current.childNodes) {
            if (child.nodeType === step.type) {
                if (index === step.index) {
                    current = child;
                    found = true;
                    break;
                }
                index++;
            }
        }
        if (!found) return null;
    }
    return current;
}

function buildInlineNodesFromNode(node) {
    if (!node) {
        return [];
    }
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        return text ? [text] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return [];
    }

    const tagName = node.tagName.toLowerCase();
    const childNodes = Array.from(node.childNodes).flatMap((child) => buildInlineNodesFromNode(child));

    if (tagName === "br") {
        return ["\n"];
    }
    if (tagName === "strong" || tagName === "b") {
        return [{ type: "bold", text: childNodes }];
    }
    if (tagName === "em" || tagName === "i") {
        return [{ type: "italic", text: childNodes }];
    }
    if (tagName === "u") {
        return [{ type: "underline", text: childNodes }];
    }
    if (tagName === "s" || tagName === "strike") {
        return [{ type: "strikethrough", text: childNodes }];
    }
    if (tagName === "mark") {
        return [{ type: "highlight", text: childNodes }];
    }
    if (tagName === "sup") {
        return [{ type: "superscript", text: childNodes }];
    }
    if (tagName === "sub") {
        return [{ type: "subscript", text: childNodes }];
    }
    if (tagName === "code") {
        return [{ type: "code", text: childNodes }];
    }
    if (tagName === "a") {
        const href = node.getAttribute("href") || "";
        return [{ type: "link", href, text: childNodes }];
    }
    if (tagName === "span") {
        return childNodes;
    }
    return childNodes;
}

function buildInlineNodesFromNodeList(nodes) {
    return nodes.flatMap((node) => buildInlineNodesFromNode(node));
}

function extractListItemContent(itemNode) {
    const contentNodes = Array.from(itemNode.childNodes).filter((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === "UL" || child.tagName === "OL")) {
            return false;
        }
        return true;
    });
    const nestedListNodes = Array.from(itemNode.children).filter((child) => child.tagName === "UL" || child.tagName === "OL");
    const content = buildInlineNodesFromNodeList(contentNodes);
    const children = nestedListNodes.map((nestedList) => convertListNodeToBlock(nestedList));
    return {
        type: "list-item",
        content: content.length ? content : "",
        ...(children.length ? { children } : {})
    };
}

function convertListNodeToBlock(listNode) {
    if (!listNode || !listNode.tagName) {
        return { type: "paragraph", content: "" };
    }
    const isOrdered = listNode.tagName.toLowerCase() === "ol";
    const items = Array.from(listNode.children).filter((item) => item.tagName && item.tagName.toLowerCase() === "li").map((item) => extractListItemContent(item));
    return {
        type: isOrdered ? "ordered-list" : "bullet-list",
        items
    };
}

function convertTableNodeToBlock(tableNode) {
    const headers = Array.from(tableNode.querySelectorAll("thead th")).map((header) => header.textContent.trim());
    const rows = Array.from(tableNode.querySelectorAll("tbody tr")).map((row) => Array.from(row.children).map((cell) => cell.textContent.trim()));
    return {
        type: "table",
        headers: headers.length ? headers : [],
        rows
    };
}

function figureNodeToBlock(figureNode) {
    const img = figureNode.querySelector("img");
    const caption = figureNode.querySelector("figcaption");
    const src = img ? img.getAttribute("src") : "";
    if (!src) {
        return null;
    }
    return {
        type: "image",
        src,
        alt: img ? (img.getAttribute("alt") || "") : "",
        caption: caption ? caption.textContent.trim() : ""
    };
}

function convertEditorNodeToBlock(node) {
    if (!node || !node.tagName) {
        return null;
    }
    const tagName = node.tagName.toLowerCase();

    if (tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
        const level = Number(tagName.replace("h", "")) || 2;
        return { type: "heading", level, content: buildInlineNodesFromNodeList(Array.from(node.childNodes)) };
    }
    if (tagName === "p") {
        return { type: "paragraph", content: buildInlineNodesFromNodeList(Array.from(node.childNodes)) };
    }
    if (tagName === "blockquote") {
        return { type: "quote", content: buildInlineNodesFromNodeList(Array.from(node.childNodes)) };
    }
    if (tagName === "ul" || tagName === "ol") {
        return convertListNodeToBlock(node);
    }
    if (tagName === "table") {
        return convertTableNodeToBlock(node);
    }
    if (tagName === "figure") {
        return figureNodeToBlock(node);
    }
    if (tagName === "hr") {
        return { type: "separator" };
    }
    if (tagName === "pre") {
        const codeNode = node.querySelector("code") || node;
        return { type: "code", code: codeNode.textContent || "", language: "text" };
    }
    if (tagName === "div" || tagName === "section") {
        const blocks = [];
        Array.from(node.childNodes).forEach((child) => {
            const block = convertEditorNodeToBlock(child);
            if (block) {
                blocks.push(block);
            }
        });
        return blocks.length ? blocks : null;
    }
    return null;
}

function buildExplanationDocumentFromEditor(editor) {
    if (!editor) {
        return { type: "document", blocks: [] };
    }

    const blocks = [];
    Array.from(editor.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = (node.textContent || "").trim();
            if (text) {
                blocks.push({ type: "paragraph", content: [text] });
            }
            return;
        }

        const block = convertEditorNodeToBlock(node);
        if (Array.isArray(block)) {
            blocks.push(...block.filter(Boolean));
        } else if (block) {
            blocks.push(block);
        }
    });

    if (!blocks.length) {
        const text = (editor.textContent || "").trim();
        return text ? { type: "document", blocks: [{ type: "paragraph", content: [text] }] } : { type: "document", blocks: [] };
    }

    return { type: "document", blocks };
}

function renderEditableInlineContent(content) {
    if (Array.isArray(content)) {
        return content.map((item) => renderEditableInlineContent(item)).join("");
    }
    if (typeof content === "string") {
        return escapeHtml(content);
    }
    if (!content || typeof content !== "object") {
        return escapeHtml(String(content ?? ""));
    }

    if (content.type === "bold") return `<strong>${renderEditableInlineContent(content.text ?? content.content ?? "")}</strong>`;
    if (content.type === "italic") return `<em>${renderEditableInlineContent(content.text ?? content.content ?? "")}</em>`;
    if (content.type === "underline") return `<u>${renderEditableInlineContent(content.text ?? content.content ?? "")}</u>`;
    if (content.type === "highlight") return `<mark>${renderEditableInlineContent(content.text ?? content.content ?? "")}</mark>`;
    if (content.type === "strikethrough") return `<s>${renderEditableInlineContent(content.text ?? content.content ?? "")}</s>`;
    if (content.type === "code") return `<code>${escapeHtml(String(content.text ?? content.content ?? ""))}</code>`;
    if (content.type === "link") return `<a href="${escapeHtml(String(content.href || content.url || "#"))}" target="_blank" rel="noopener noreferrer">${renderEditableInlineContent(content.text ?? content.label ?? content.href ?? content.url ?? "")}</a>`;
    if (content.type === "superscript") return `<sup>${renderEditableInlineContent(content.text ?? content.content ?? "")}</sup>`;
    if (content.type === "subscript") return `<sub>${renderEditableInlineContent(content.text ?? content.content ?? "")}</sub>`;
    return escapeHtml(String(content.text ?? content.content ?? ""));
}

function renderEditorDocument(documentLike) {
    const doc = window.ExplanationRenderer ? window.ExplanationRenderer.normalizeExplanationDocument(documentLike) : { type: "document", blocks: [] };
    if (!doc || !Array.isArray(doc.blocks) || !doc.blocks.length) {
        return "";
    }

    return doc.blocks.map((block) => {
        if (!block || typeof block !== "object") {
            return "";
        }
        switch (block.type) {
            case "heading": {
                const level = Number(block.level) || 2;
                return `<h${level}>${renderEditableInlineContent(block.content || block.text || "")}</h${level}>`;
            }
            case "paragraph":
                return `<p>${renderEditableInlineContent(block.content || block.text || "")}</p>`;
            case "quote":
                return `<blockquote>${renderEditableInlineContent(block.content || block.text || "")}</blockquote>`;
            case "bullet-list":
                return `<ul>${(block.items || []).map((item) => `<li>${renderEditableInlineContent(item && item.content ? item.content : item)}</li>`).join("")}</ul>`;
            case "ordered-list":
                return `<ol>${(block.items || []).map((item) => `<li>${renderEditableInlineContent(item && item.content ? item.content : item)}</li>`).join("")}</ol>`;
            case "table": {
                const headers = Array.isArray(block.headers) && block.headers.length ? `<thead><tr>${block.headers.map((header) => `<th>${escapeHtml(String(header ?? ""))}</th>`).join("")}</tr></thead>` : "";
                const rows = Array.isArray(block.rows) ? block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`).join("") : "";
                return `<table><tbody>${rows}</tbody></table>`;
            }
            case "image":
                return `<figure><img src="${escapeHtml(String(block.src || ""))}" alt="${escapeHtml(String(block.alt || ""))}" /><figcaption>${escapeHtml(String(block.caption || ""))}</figcaption></figure>`;
            case "separator":
                return "<hr />";
            case "code":
                return `<pre><code>${escapeHtml(String(block.code || block.text || ""))}</code></pre>`;
            case "callout":
            case "note":
            case "warning":
            case "important":
                return `<div class="rich-callout"><strong>${escapeHtml(String(block.title || block.kind || "Note"))}</strong><div>${renderEditableInlineContent(block.content || block.text || "")}</div></div>`;
            case "flowchart": {
                const nodes = Array.isArray(block.nodes) ? block.nodes.map((node) => `<div>${renderEditableInlineContent(node.label || node.text || "")}</div>`).join("") : "";
                return `<div class="rich-flowchart">${nodes}</div>`;
            }
            default:
                return `<p>${renderEditableInlineContent(block.content || block.text || "")}</p>`;
        }
    }).join("");
}

function attachExplanationEditorToolbarHandlers() {
    const editorButtons = document.querySelectorAll("[data-editor-command]");
    editorButtons.forEach((button) => {
        button.onclick = () => {
            const command = button.dataset.editorCommand;
            const editor = document.getElementById(button.dataset.editorTargetId);
            if (!editor) {
                return;
            }
            editor.focus();
            if (command === "h2") {
                document.execCommand("formatBlock", false, "h2");
                return;
            }
            if (command === "h3") {
                document.execCommand("formatBlock", false, "h3");
                return;
            }
            if (command === "p") {
                document.execCommand("formatBlock", false, "p");
                return;
            }
            if (command === "blockquote") {
                document.execCommand("formatBlock", false, "blockquote");
                return;
            }
            if (command === "ul") {
                document.execCommand("insertUnorderedList");
                return;
            }
            if (command === "ol") {
                document.execCommand("insertOrderedList");
                return;
            }
            document.execCommand(command, false, null);
        };
    });
}

function startEditingExplanation(questionIndex) {
    editingExplanationIndex = questionIndex;
    renderQuestions();
    requestAnimationFrame(() => attachExplanationEditorToolbarHandlers());
}

function cancelEditingExplanation() {
    editingExplanationIndex = null;
    renderQuestions();
}

function getReviewQuestionSource(question, index) {
    const source = question?._source || question?.source || {};
    return {
        sourceSubjectKey: question?._pyqSubjectKey || source.sourceSubjectKey || result.subjectKey,
        chapter: question?._pyqChapter || source.chapter || result.chapter || "",
        questionId: question?._pyqQuestionId ?? source.questionId ?? question?.id ?? question?.qid ?? question?.questionId ?? question?._id ?? question?.questionID ?? question?.question_id ?? null,
        questionIndex: question?._pyqQuestionIndex ?? source.questionIndex ?? index
    };
}

async function requestReviewQuestion(questionIndex, field, value) {
    if (!quizApiUrl("api/health")) throw new Error(quizApiUnavailableMessage());
    const question = result.questions[questionIndex];
    const response = await fetch(quizApiUrl("api/review-question"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getReviewQuestionSource(question, questionIndex), field, value })
    });
    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new Error("The server returned an invalid save response.");
    }
    if (!response.ok) {
        throw new Error(payload.error || "The question could not be saved.");
    }
    if (!payload || !payload.question || typeof payload.question !== "object") {
        throw new Error("The server did not confirm the question save.");
    }
    return payload.question;
}

function replaceExplanationView(questionIndex) {
    const question = result.questions[questionIndex];
    const card = questionReviewList.querySelector(`[data-question-index="${questionIndex}"]`);
    const editor = card?.querySelector(".explanation-editor-section");
    if (!question || !editor) return;
    const documentValue = question.explanationDocument || question.explanation || "";
    const html = window.ExplanationRenderer
        ? window.ExplanationRenderer.renderExplanationDocument(documentValue, question.explanation || "")
        : `<p>${escapeHtml(String(question.explanation || ""))}</p>`;
    const view = document.createElement("div");
    view.className = `explanation-box${html ? "" : " missing"}`;
    view.innerHTML = `<strong>Explanation:</strong>${html || "Explanation is currently unavailable for this question."}<button type="button" onclick="startEditingExplanation(${questionIndex})" class="btn-edit-explanation">✎ Edit Explanation</button>`;
    editor.replaceWith(view);
}

function replaceAnswerView(questionIndex) {
    const question = result.questions[questionIndex];
    const card = questionReviewList.querySelector(`[data-question-index="${questionIndex}"]`);
    const editor = card?.querySelector(".answer-editor-section");
    if (!question || !editor) return;
    const view = document.createElement("p");
    view.innerHTML = `<strong>Correct Answer:</strong> ${highlightText(question.options[question.answer], activeSearchQuery)} <button type="button" class="btn-edit-answer" onclick="startEditingAnswer(${questionIndex})">Edit Correct Answer</button>`;
    editor.replaceWith(view);
    card.querySelectorAll(".review-option").forEach((option, optionIndex) => {
        option.classList.toggle("correct-option", optionIndex === question.answer);
        const marker = option.querySelector(".option-tag.correct");
        if (optionIndex === question.answer && !marker) {
            const label = document.createElement("strong");
            label.className = "option-tag correct";
            label.textContent = "Correct answer";
            option.appendChild(label);
        } else if (optionIndex !== question.answer && marker) {
            marker.remove();
        }
    });
}

async function loadPersistedReviewQuestions() {
    if (!quizApiUrl("api/health")) return;
    await Promise.all(result.questions.map(async (question, index) => {
        const source = getReviewQuestionSource(question, index);
        const query = new URLSearchParams(Object.entries(source).filter(([, value]) => value != null && value !== ""));
        try {
            const response = await fetch(quizApiUrl(`api/review-question?${query.toString()}`), { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json();
            if (payload.question) {
                question.answer = payload.question.answer;
                question.explanation = payload.question.explanation || "";
                question.explanationDocument = window.ExplanationRenderer
                    ? window.ExplanationRenderer.normalizeExplanationDocument(question.explanation)
                    : question.explanation;
            }
        } catch (error) {
            console.warn("Unable to load the current source question:", error);
        }
    }));
}

async function saveEditedExplanation(questionIndex) {
    const explanationInput = document.getElementById(`explanationInput-${questionIndex}`);
    if (!explanationInput || !result.questions[questionIndex]) {
        return;
    }

    const explanationDocument = buildExplanationDocumentFromEditor(explanationInput);
    const plainText = (window.ExplanationRenderer && window.ExplanationRenderer.getPlainTextFromExplanation(explanationDocument)) || explanationInput.textContent.trim();
    try {
        const savedQuestion = await requestReviewQuestion(questionIndex, "explanation", plainText);
        result.questions[questionIndex].explanationDocument = explanationDocument;
        result.questions[questionIndex].explanation = savedQuestion.explanation;
        localStorage.setItem(resultKey, JSON.stringify(result));
        editingExplanationIndex = null;
        replaceExplanationView(questionIndex);
        window.alert("Explanation saved successfully.");
    } catch (error) {
        window.alert(error.message);
    }
}

function startEditingAnswer(questionIndex) {
    editingAnswerIndex = questionIndex;
    renderQuestions();
}

function cancelEditingAnswer() {
    editingAnswerIndex = null;
    renderQuestions();
}

async function saveEditedAnswer(questionIndex) {
    const selectedAnswer = document.querySelector(`input[name="correctAnswer-${questionIndex}"]:checked`);
    if (!selectedAnswer || !result.questions[questionIndex]) {
        return;
    }

    try {
        const savedQuestion = await requestReviewQuestion(questionIndex, "answer", Number(selectedAnswer.value));
        result.questions[questionIndex].answer = savedQuestion.answer;
        localStorage.setItem(resultKey, JSON.stringify(result));
        editingAnswerIndex = null;
        replaceAnswerView(questionIndex);
        window.alert("Correct answer saved successfully.");
    } catch (error) {
        window.alert(error.message);
    }
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

function getSavedQuestions() {
    try {
        return savedQuestionsLoaded ? savedQuestionsCache : JSON.parse(localStorage.getItem("bookmarks") || "[]");
    } catch (error) {
        return [];
    }
}

const CLASSIFICATION_LABELS = {
    H: "History",
    G: "Geography",
    E: "Economy",
    P: "Polity",
    CA: "Current Affairs"
};

function getClassificationStore() {
    try {
        return JSON.parse(localStorage.getItem("questionClassifications") || "{}");
    } catch (error) {
        return {};
    }
}

function saveClassificationStore(store) {
    try {
        localStorage.setItem("questionClassifications", JSON.stringify(store));
    } catch (error) {
        console.error("Failed to save question classifications:", error);
    }
}

function getQuestionReference(question, index) {
    const subjectKey = result && (result.subjectKey || result.subject || "unknown");
    const chapter = result && (result.chapter || "unknown");
    const questionId = question
        ? (question.id ?? question.qid ?? question.questionId ?? question._id ?? question.questionID ?? question.question_id ?? `${subjectKey}::${chapter}::${index}`)
        : `${subjectKey}::${chapter}::${index}`;
    return {
        subjectKey,
        chapter,
        questionId: String(questionId)
    };
}

function getCollectionTarget(tag) {
    const map = {
        H: { subjectKey: "modern", subject: "Modern History", chapter: "Important Questions" },
        G: { subjectKey: "geography", subject: "Geography", chapter: "Important Questions" },
        P: { subjectKey: "polity", subject: "Polity", chapter: "Important Questions" },
        E: { subjectKey: "economy", subject: "Economy", chapter: "Important Questions" },
        CA: { subjectKey: "current_affairs", subject: "Current Affairs", chapter: "Current Affairs" }
    };
    return map[tag] || null;
}

function getQuestionClassificationKey(index) {
    const question = result && Array.isArray(result.questions) ? result.questions[index] : null;
    return persistentClassificationIdentity(question, index);
}

function getQuestionClassifications(index) {
    const store = getClassificationStore();
    const key = getQuestionClassificationKey(index);
    const question = result && Array.isArray(result.questions) ? result.questions[index] : null;
    const persistent = persistentSubjectClassifications[persistentClassificationIdentity(question, index)] || {};
    const currentAffairs = persistentCurrentAffairsClassifications[persistentClassificationIdentity(question, index)] || {};
    return persistentSubjectClassificationsLoaded ? { ...persistent, ...currentAffairs } : (store[key] || {});
}

function isMockReviewContext() {
    return Boolean(
        result && (
            result.quizType === "mock" ||
            result.subjectKey === "mock" ||
            result.subject === "Mock Test" ||
            String(result.quizId || "").toLowerCase().includes("mock") ||
            String(result.chapter || "").toLowerCase().includes("mock") ||
            String(result.subjectKey || result.subject || "").toLowerCase().includes("mock")
        )
    );
}

function getApplicableClassificationTags() {
    if (isMockReviewContext()) return Object.keys(CLASSIFICATION_LABELS);
    return {
        modern: ["H"],
        geography: ["G"],
        polity: ["P"],
        economy: ["E"]
    }[result?.subjectKey] || [];
}

async function toggleQuestionClassification(index, tag, event) {
    event?.preventDefault();
    if (!quizApiUrl("api/health")) {
        window.alert(quizApiUnavailableMessage());
        return;
    }
    const store = getClassificationStore();
    const question = result && Array.isArray(result.questions) ? result.questions[index] : null;
    const source = getReviewQuestionSource(question, index);
    const { subjectKey, chapter, questionId } = getQuestionReference(question, index);
    const key = `${String(subjectKey)}::${String(chapter)}::${String(questionId)}`;
    const entry = store[key] || {
        subjectKey,
        subject: result.subject,
        chapter,
        questionIndex: index,
        questionId,
        question,
        originalSubjectKey: subjectKey,
        originalSubject: result.subject,
        originalChapter: chapter
    };

    entry.subjectKey = subjectKey;
    entry.subject = result.subject;
    entry.chapter = chapter;
    entry.questionIndex = index;
    entry.questionId = questionId;
    entry.question = question;
    entry.originalSubjectKey = subjectKey;
    entry.originalSubject = result.subject;
    entry.originalChapter = chapter;

    const target = getCollectionTarget(tag);
    if (target) {
        entry.collectionTarget = target.subjectKey;
        entry.collectionTargetSubject = target.subject;
        entry.collectionTargetChapter = target.chapter;
    }

    const button = questionReviewList.querySelector(`[data-question-index="${index}"] [data-tag="${tag}"]`);
    const active = Boolean(button?.classList.contains("active"));
    const endpoint = tag === "CA" ? "api/current-affairs" : "api/important-classifications";
    const targetSubjectKey = target?.subjectKey;
    try {
        const response = await fetch(quizApiUrl(endpoint), {
            method: active ? "DELETE" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...source, tag, targetSubjectKey, originalMockTestSet: source.chapter })
        });
        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new Error("The classification server returned an invalid response.");
        }
        if (!response.ok) throw new Error(payload.error || "The question classification could not be saved.");
        if (!payload || typeof payload !== "object") throw new Error("The classification server did not confirm the change.");
    } catch (error) {
        window.alert(error.message || "The question classification could not be saved.");
        return;
    }
    if (active) {
        delete entry[tag];
        if (serverClassificationStore[key]) delete serverClassificationStore[key][tag];
        const identity = persistentClassificationIdentity(question, index);
        delete persistentSubjectClassifications[identity]?.[tag];
        delete persistentCurrentAffairsClassifications[identity]?.[tag];
    } else {
        entry[tag] = true;
        serverClassificationStore[key] = { ...(serverClassificationStore[key] || {}), [tag]: true };
        const identity = persistentClassificationIdentity(question, index);
        if (tag === "CA") {
            persistentCurrentAffairsClassifications[identity] = { ...(persistentCurrentAffairsClassifications[identity] || {}), CA: true };
        } else {
            persistentSubjectClassifications[identity] = { ...(persistentSubjectClassifications[identity] || {}), [tag]: true };
        }
    }
    if (Object.keys(CLASSIFICATION_LABELS).some((label) => Boolean(entry[label]))) store[key] = entry;
    else delete store[key];
    saveClassificationStore(store);
    if (button) button.classList.toggle("active", !active);
}

function savedQuestionIdentity(item) {
    const source = item?.source || item || {};
    return `${source.sourceSubjectKey ?? item?.subjectKey ?? ""}::${source.chapter ?? item?.chapter ?? ""}::${source.questionId ?? item?.questionId ?? ""}::${source.questionIndex ?? item?.questionIndex ?? ""}`;
}

function isSavedQuestion(index) {
    const savedQuestions = getSavedQuestions();
    const question = result.questions[index];
    const source = getReviewQuestionSource(question, savedReviewQuestionIndex === null ? index : savedReviewQuestionIndex);
    return savedQuestions.some((item) => savedQuestionIdentity(item) === savedQuestionIdentity(source));
}

async function toggleSavedQuestion(index, event) {
    event?.preventDefault();
    if (!quizApiUrl("api/health")) {
        window.alert(quizApiUnavailableMessage());
        return;
    }
    const savedQuestions = getSavedQuestions();
    const subjectKey = result.subjectKey || result.subject;
    const questionIndex = savedReviewQuestionIndex === null ? index : savedReviewQuestionIndex;
    const question = result.questions[index];
    const source = getReviewQuestionSource(question, questionIndex);
    const savedQuestionIndex = savedQuestions.findIndex((item) => savedQuestionIdentity(item) === savedQuestionIdentity(source));
    const endpoint = quizApiUrl("api/saved-questions");
    try {
        const response = await fetch(endpoint, {
            method: savedQuestionIndex >= 0 ? "DELETE" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...source, originalMockTestSet: result.chapter })
        });
        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new Error("The Saved Questions server returned an invalid response.");
        }
        if (!response.ok) throw new Error(payload.error || "The Saved Question could not be saved.");
        if (!payload || typeof payload !== "object") throw new Error("The Saved Questions server did not confirm the change.");
    } catch (error) {
        window.alert(error.message || "The Saved Question could not be saved.");
        return;
    }

    if (savedQuestionsLoaded) {
        if (savedQuestionIndex >= 0) savedQuestions.splice(savedQuestionIndex, 1);
        else savedQuestions.push({ subjectKey, subject: result.subject, chapter: result.chapter, questionIndex, source, question });
    } else if (savedQuestionIndex >= 0) {
        savedQuestions.splice(savedQuestionIndex, 1);
    } else {
        savedQuestions.push({ subjectKey, subject: result.subject, chapter: result.chapter, questionIndex, question });
    }

    if (!savedQuestionsLoaded) localStorage.setItem("bookmarks", JSON.stringify(savedQuestions));
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
        .map((question, index) => isSavedQuestion(index) ? index : null)
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
    };

    result.questions.forEach((question, index) => {
        const status = getQuestionStatus(index);
        counts[status] += 1;
    });

    return counts;
}

function isQuestionVisible(index) {
    if (activeFilter === "all") {
        return true;
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
        const explanationDocument = question.explanationDocument || question.explanation || "";
        const explanationHtml = window.ExplanationRenderer
            ? window.ExplanationRenderer.renderExplanationDocument(explanationDocument, question.explanation || "")
            : (question.explanation ? `<p>${escapeHtml(String(question.explanation))}</p>` : "");
        const explanationText = (window.ExplanationRenderer && window.ExplanationRenderer.getPlainTextFromExplanation(explanationDocument)) || (question.explanation ? String(question.explanation).trim() : "");
        const questionText = highlightText(question.q, activeSearchQuery);
        const saved = isSavedQuestion(index);
        const classifications = getQuestionClassifications(index);
        const applicableClassificationTags = getApplicableClassificationTags();
        const classificationButtonsHtml = applicableClassificationTags.length ? `
            ${Object.entries(CLASSIFICATION_LABELS).map(([tag, label]) => applicableClassificationTags.includes(tag) ? `
                <button
                    type="button"
                    class="classification-mini-btn ${classifications[tag] ? "active" : ""} ${tag === "CA" ? "ca" : tag.toLowerCase()}"
                    data-tag="${tag}"
                    title="${label}"
                    onclick="toggleQuestionClassification(${index}, '${tag}', event)"
                >${tag}</button>
            ` : "").join("")}
        ` : "";
        const answerSectionHtml = editingAnswerIndex === index
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
        if (editingExplanationIndex === index) {
            explanationSectionHtml = `
                <div class="explanation-editor-section">
                    <div class="explanation-editor-header">
                        <h4>📝 Edit Explanation</h4>
                    </div>
                    <div class="explanation-editor-toolbar">
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="bold" data-editor-target-id="explanationInput-${index}"><strong>B</strong></button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="italic" data-editor-target-id="explanationInput-${index}"><em>I</em></button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="underline" data-editor-target-id="explanationInput-${index}"><u>U</u></button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="strikeThrough" data-editor-target-id="explanationInput-${index}">S</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="h2" data-editor-target-id="explanationInput-${index}">H2</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="h3" data-editor-target-id="explanationInput-${index}">H3</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="p" data-editor-target-id="explanationInput-${index}">P</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="blockquote" data-editor-target-id="explanationInput-${index}">Quote</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="ul" data-editor-target-id="explanationInput-${index}">• List</button>
                        <button type="button" class="btn btn-secondary btn-small" data-editor-command="ol" data-editor-target-id="explanationInput-${index}">1. List</button>
                    </div>
                    <div id="explanationInput-${index}" class="explanation-input rich-editor" contenteditable="true" spellcheck="true">${renderEditorDocument(explanationDocument || question.explanation || "") || "<p></p>"}</div>
                    <div class="explanation-editor-actions">
                        <button type="button" onclick="saveEditedExplanation(${index})" class="btn-save-explanation">💾 Save Explanation</button>
                        <button onclick="cancelEditingExplanation()" class="btn-cancel-explanation">✕ Cancel</button>
                    </div>
                </div>
            `;
        } else {
            explanationSectionHtml = `
                <div class="explanation-box${explanationHtml ? "" : " missing"}">
                    <strong>Explanation:</strong>
                    ${explanationHtml || "Explanation is currently unavailable for this question."}
                    <button onclick="startEditingExplanation(${index})" class="btn-edit-explanation">✎ Edit Explanation</button>
                </div>
            `;
        }

        return `
            <div class="review-item question-card${visible ? "" : " hidden-question"}" data-question-index="${index}">
                <div class="review-card-header">
                    <h3>Q${index + 1}. ${questionText}</h3>
                    <div class="review-card-actions">
                        ${isMockReviewContext() ? `<button type="button" class="save-question-btn${saved ? " saved" : ""}" onclick="toggleSavedQuestion(${index}, event)">${saved ? "★" : "S"}</button>` : ""}
                        ${classificationButtonsHtml}
                        ${typeof copyQuestionOptionsButtonHtml === "function" ? copyQuestionOptionsButtonHtml(index) : ""}
                        <span class="review-status-pill ${status}">${status === "correct" ? "Correct" : status === "incorrect" ? "Incorrect" : "Not Attempted"}</span>
                    </div>
                </div>
                <ul class="review-options">${optionsHtml}</ul>
                <p><strong>Your Answer:</strong> ${selectedAnswerText}</p>
                ${answerSectionHtml}
                ${explanationSectionHtml}
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

function applyHighlightsToAllQuestions() {
    questionReviewList.querySelectorAll(".review-item").forEach((card) => {
        const questionIndex = Number(card.dataset.questionIndex);
        const explanationBox = card.querySelector(".explanation-box");
        
        if (explanationBox && !card.classList.contains("hidden-question")) {
            applyReadingHighlights(explanationBox, questionIndex);
        }
    });
}

if (!result) {
    window.location.href = "index.html";
} else {
    Promise.all([
        (isHistoricalReview || isPostSubmitReview) ? Promise.resolve() : loadPersistedReviewQuestions(),
        loadPersistentSubjectClassifications(),
        loadSavedQuestionsFromServer()
    ]).finally(() => {
        reviewSubject.innerText = result.subject || "Quiz Review";
        const chapterLabel = result.chapter && result.chapter.trim() ? result.chapter : "Full Length Test";
        reviewSubtitle.innerText = `${chapterLabel} • Accuracy ${result.accuracy}%`;
        renderTestHistory();
        renderSummary();
        renderPalette();
        renderQuestions();
        applyHighlightsToAllQuestions();
        updateFilterButtons();
        renderSavedQuestions();
        updateActiveQuestion();
        updateResultCount();
    });
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

(function (global) {
    const STORAGE_KEY = "reviewTextHighlights";
    let initialized = false;
    let highlightMode = false;
    let button = null;
    let observer = null;
    let applying = false;
    let highlightsCache = null;

    function readHighlights() {
        if (highlightsCache) return highlightsCache;
        try {
            highlightsCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        } catch (error) {
            highlightsCache = {};
        }
        return highlightsCache;
    }

    function writeHighlights(highlights) {
        highlightsCache = highlights;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(highlights));
        } catch (error) {
            // Highlighting remains available for the current page when storage is unavailable.
        }
    }

    function getExplanationContainers() {
        return Array.from(document.querySelectorAll(
            ".explanation-box, .collection-quiz-explanation, .review-item > h3, .review-item > h4, .question-card h3, #searchResults .review-item h4, #matchesList .review-item > p:first-of-type, .saved-question-item > div p"
        ));
    }

    function getExplanationKey(container) {
        const card = container.closest("[data-question-index], [data-highlight-scope], .review-item, .saved-question-item");
        const cardKey = card?.dataset.questionIndex || card?.dataset.highlightScope || card?.id || Array.from(document.querySelectorAll(".review-item, .saved-question-item")).indexOf(card);
        const explanationIndex = getExplanationContainers().indexOf(container);
        const targetType = container.matches(".explanation-box, .collection-quiz-explanation") ? "explanation" : "question";
        return `review-${targetType}:${window.location.pathname}:${cardKey ?? explanationIndex}`;
    }

    function getTextNodes(container) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || parent.closest(".review-highlight, button, input, select, textarea")) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
    }

    function getTextOffset(container, node, offset) {
        const range = document.createRange();
        range.selectNodeContents(container);
        range.setEnd(node, offset);
        return range.toString().length;
    }

    function getRangeOffsets(container, range) {
        return {
            start: getTextOffset(container, range.startContainer, range.startOffset),
            end: getTextOffset(container, range.endContainer, range.endOffset)
        };
    }

    function createRangeFromOffsets(container, start, end) {
        const nodes = getTextNodes(container);
        let position = 0;
        let startPoint = null;
        let endPoint = null;
        nodes.forEach((node, index) => {
            const nextPosition = position + node.nodeValue.length;
            const isLastNode = index === nodes.length - 1;
            if (!startPoint && start >= position && (start < nextPosition || (isLastNode && start === nextPosition))) {
                startPoint = { node, offset: start - position };
            }
            if (!endPoint && end > position && (end <= nextPosition || isLastNode && end === nextPosition)) {
                endPoint = { node, offset: end - position };
            }
            position = nextPosition;
        });
        if (!endPoint && end === 0 && nodes[0]) endPoint = { node: nodes[0], offset: 0 };
        if (!startPoint || !endPoint) return null;
        const range = document.createRange();
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        return range;
    }

    function wrapRange(range) {
        const mark = document.createElement("mark");
        mark.className = "review-highlight";
        mark.title = "Remove highlight";
        try {
            range.surroundContents(mark);
        } catch (error) {
            mark.appendChild(range.extractContents());
            range.insertNode(mark);
        }
    }

    function restoreContainer(container) {
        if (container.querySelector(".review-highlight")) return;
        const records = readHighlights()[getExplanationKey(container)] || [];
        records
            .slice()
            .sort((left, right) => right.start - left.start)
            .forEach((record) => {
                const range = createRangeFromOffsets(container, record.start, record.end);
                if (range && !range.collapsed) wrapRange(range);
            });
    }

    function restoreHighlights() {
        if (applying) return;
        applying = true;
        getExplanationContainers().forEach(restoreContainer);
        applying = false;
    }

    function getExplanationForSelection(selection) {
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
        const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
        const targetSelector = ".explanation-box, .collection-quiz-explanation, .review-item > h3, .review-item > h4, .question-card h3, #searchResults .review-item h4, #matchesList .review-item > p:first-of-type, .saved-question-item > div p";
        const startContainer = startElement?.closest(targetSelector);
        const endContainer = endElement?.closest(targetSelector);
        return startContainer && startContainer === endContainer ? startContainer : null;
    }

    function addHighlight(selection) {
        const container = getExplanationForSelection(selection);
        if (!container || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (range.commonAncestorContainer.closest?.("button, input, select, textarea")) return;
        const offsets = getRangeOffsets(container, range);
        if (offsets.end <= offsets.start) return;
        const highlights = readHighlights();
        const key = getExplanationKey(container);
        highlights[key] = highlights[key] || [];
        if (!highlights[key].some((record) => record.start === offsets.start && record.end === offsets.end)) {
            highlights[key].push({ start: offsets.start, end: offsets.end });
            writeHighlights(highlights);
            wrapRange(range);
        }
        selection.removeAllRanges();
    }

    function handleSelection() {
        if (!highlightMode) return;
        const selection = global.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
        addHighlight(selection);
    }

    function removeHighlight(mark) {
        const targetSelector = ".explanation-box, .collection-quiz-explanation, .review-item > h3, .review-item > h4, .question-card h3, #searchResults .review-item h4, #matchesList .review-item > p:first-of-type, .saved-question-item > div p";
        const container = mark.closest(targetSelector);
        if (!container) return;
        const range = document.createRange();
        range.selectNode(mark);
        const offsets = getRangeOffsets(container, range);
        const highlights = readHighlights();
        const key = getExplanationKey(container);
        highlights[key] = (highlights[key] || []).filter((record) => !(record.start === offsets.start && record.end === offsets.end));
        writeHighlights(highlights);
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
    }

    function setHighlightMode(enabled) {
        highlightMode = enabled;
        document.body.classList.toggle("highlighter-selection-active", enabled);
        button?.classList.toggle("is-active", enabled);
        button?.setAttribute("aria-pressed", String(enabled));
        button?.setAttribute("aria-label", enabled ? "Turn off highlighter" : "Turn on highlighter");
        button?.setAttribute("title", enabled ? "Highlighter on" : "Highlighter off");
    }

    function findToolbar() {
        return document.querySelector(".review-controls, .review-palette-launcher, .review-header, .saved-library-header, .section-heading, .result-buttons") || document.body;
    }

    function init() {
        if (initialized) return;
        initialized = true;
        global.addEventListener("storage", (event) => {
            if (event.key === STORAGE_KEY) highlightsCache = null;
        });
        const toolbar = findToolbar();
        button = document.createElement("button");
        button.type = "button";
        button.className = "review-highlighter-button";
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", "Turn on highlighter");
        button.title = "Highlighter off";
        button.textContent = "▰";
        toolbar.appendChild(button);
        button.addEventListener("click", () => setHighlightMode(!highlightMode));
        document.addEventListener("mouseup", handleSelection);
        document.addEventListener("keyup", handleSelection);
        document.addEventListener("click", (event) => {
            const mark = event.target.closest(".review-highlight");
            if (mark) {
                event.preventDefault();
                removeHighlight(mark);
            }
        });
        observer = new MutationObserver(() => global.requestAnimationFrame(restoreHighlights));
        observer.observe(document.body, { childList: true, subtree: true });
        restoreHighlights();
    }

    global.ReviewHighlighter = { init, refresh: restoreHighlights };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})(window);

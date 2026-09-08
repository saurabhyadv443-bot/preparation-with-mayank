(function () {
    "use strict";

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function cleanText(value) {
        return String(value ?? "")
            .replace(/<\/?br\s*\/?>/gi, "\n")
            .replace(/[■●]/g, " ")
            .replace(/(^|\s)○(?=\s|$)/g, "$1")
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s+/g, "\n")
            .trim();
    }

    function normalizeQuestionText(value, questionNumber) {
        const number = Number(questionNumber);
        if (!Number.isInteger(number) || number < 1) {
            return cleanText(value);
        }
        const escapedNumber = String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const leadingNumber = new RegExp(`^\\s*(?:Question\\s*)?${escapedNumber}(?:\\s*[:.)-])\\s+`, "i");
        return cleanText(value).replace(leadingNumber, "").trim();
    }

    function formatEmbeddedOptions(value, options) {
        const text = cleanText(value);
        if (!text || /\b(?:list|column|match|matching|assertion|reason)\b/i.test(text)
            || /\bCode\s*:/i.test(text)) {
            return { text, formatted: false };
        }
        const markerPattern = /(?<![A-Za-z0-9])(?:(\(\d{1,2}\))|(\d{1,2})\s*([.)])|(\([A-Ea-e]\))|([A-Ea-e])\s*([.)-])|(\([IVXivx]+\))|([IVXivx]+)\s*([.)]))(?=\s|$|[A-Za-z])/g;
        const romanValues = { I: 1, V: 5, X: 10 };
        const markerInfo = (match) => {
            const marker = match[0].trim();
            const value = marker.replace(/[().\s-]/g, "");
            if (/^\d+$/.test(value)) return { marker, family: "numeric", value: Number(value), index: match.index };
            if (/^[A-E]$/i.test(value)) return { marker, family: "letter", value: value.toUpperCase().charCodeAt(0) - 64, index: match.index };
            const upper = value.toUpperCase();
            const number = upper.split("").reduce((total, numeral, index, numerals) => {
                const current = romanValues[numeral] || 0;
                const next = romanValues[numerals[index + 1]] || 0;
                return total + (current < next ? -current : current);
            }, 0);
            return { marker, family: "roman", value: number, index: match.index };
        };
        const leadingQuestion = text.match(/^\s*\d{1,3}[.)]?\s+/);
        const repeatedMarkerPattern = /(?<![A-Za-z0-9])(\(1\)|1\s*[.)])(?=\s|[A-Za-z]|$)/g;
        const repeatedMarkers = Array.from(text.matchAll(repeatedMarkerPattern))
            .filter((match) => !(leadingQuestion && match.index < leadingQuestion[0].length));
        const repeatedMarkerStyle = repeatedMarkers.length > 1 ? repeatedMarkers[0][1].trim() : "";
        const repeatedMarkersUseOneStyle = repeatedMarkers.every((match) => match[1].trim() === repeatedMarkerStyle);
        const hasMultipleLetterMarkers = (text.match(/(?<![A-Za-z0-9])(?:\([A-Ea-e]\)|[A-Ea-e]\s*[.)-])(?=\s|[A-Za-z]|$)/g) || []).length >= 2;
        if (repeatedMarkers.length >= 2 && repeatedMarkersUseOneStyle && !hasMultipleLetterMarkers) {
            const repeatedItems = repeatedMarkers.map((match, index) => {
                const next = repeatedMarkers[index + 1];
                return {
                    marker: match[1].trim(),
                    index: match.index,
                    end: next ? next.index : text.length,
                    text: text.slice(match.index + match[1].length, next ? next.index : text.length).trim()
                };
            }).filter((item) => item.text.length >= 2);
            if (repeatedItems.length >= 2) {
                const first = repeatedItems[0];
                const prefix = text.slice(0, first.index).trimEnd();
                const hasRepeatedItemStem = /\b(?:consider|following|statements?|pairs?|events?|rows?|information|regarding|represented)\b/i.test(prefix);
                if (prefix && hasRepeatedItemStem) {
                    const last = repeatedItems[repeatedItems.length - 1];
                    const afterLast = text.slice(last.index + last.marker.length);
                    const trailingMatch = afterLast.match(/(?:[.!?]\s+|\s+)(?=(?:In\s+how\s+many|Select|Choose|Which|What|How|Identify|Arrange|According|The\s+correct|How\s+many)\b)/i);
                    const finalEnd = trailingMatch
                        ? last.index + last.marker.length + trailingMatch.index + (/^[.!?]/.test(trailingMatch[0]) ? 1 : 0)
                        : text.length;
                    const items = repeatedItems.map((item, index) => {
                        const next = repeatedItems[index + 1];
                        const end = next ? next.index : finalEnd;
                        return `${index + 1}. ${text.slice(item.index + item.marker.length, end).trim()}`.trim();
                    });
                    const trailing = finalEnd < text.length ? text.slice(finalEnd).trim() : "";
                    return { text: [prefix, ...items, trailing].filter(Boolean).join("\n"), formatted: true };
                }
            }
        }
        const markers = Array.from(text.matchAll(markerPattern))
            .filter((match) => !(leadingQuestion && match.index < leadingQuestion[0].length))
            .filter((match) => !/^[A-Za-z][.)-](?:\s*[A-Za-z][.)])/.test(text.slice(match.index, match.index + 8)))
            .filter((match) => !/^[A-Za-z][.)-]\s*[a-z]/.test(text.slice(match.index, match.index + 6)))
            .map(markerInfo);
        const sequences = [];
        for (let startIndex = 0; startIndex < markers.length; startIndex += 1) {
            const start = markers[startIndex];
            if (start.value !== 1) continue;
            const sequence = [start];
            for (let index = startIndex + 1; index < markers.length; index += 1) {
                const item = markers[index];
                const expected = sequence.length + 1;
                if (item.family !== start.family || item.value !== expected) break;
                sequence.push(item);
            }
            if (sequence.length >= 2) sequences.push(sequence);
        }
        const sequence = sequences
            .filter((candidate) => candidate.length >= 2)
            .sort((first, second) => second.length - first.length)[0];
        if (!sequence) return { text, formatted: false };

        const first = sequence[0];
        const prefix = text.slice(0, first.index).trimEnd();
        if (!prefix && first.family === "numeric") return { text, formatted: false };
        const last = sequence[sequence.length - 1];
        const afterLast = text.slice(last.index + last.marker.length);
        const trailingBoundary = afterLast.search(/(?:[.!?]\s+|\s{2,})(?=(?:Select|Choose|Which|What|How|Identify|Arrange|According|The\s+correct|How\s+many)\b)/i);
        const finalEnd = trailingBoundary >= 0
            ? last.index + last.marker.length + trailingBoundary + 1
            : text.length;
        const parts = sequence.map((item, index) => {
            const next = sequence[index + 1];
            const end = next ? next.index : finalEnd;
            return `${item.marker} ${text.slice(item.index + item.marker.length, end).trim()}`.trim();
        });
        const trailing = finalEnd < text.length ? text.slice(finalEnd).trim() : "";
        return { text: [prefix, ...parts, trailing].filter(Boolean).join("\n"), formatted: true };
    }

    function isMatchListQuestion(question) {
        const text = String(question?.q || "");
        return /\b(?:list|column)\s*[-–—]?\s*(?:i|ii|1|2|a|b)\b/i.test(text)
            || /\b(?:match|matching|pairs?\s+are\s+correct(?:ly)?\s+matched|correctly\s+match)\b/i.test(text);
    }

    function parseMatchListQuestion(question) {
        if (!isMatchListQuestion(question)) return null;
        const rawText = String(question.q || "");
        const text = cleanText(rawText)
            .replace(/\s*\|\s*/g, "\n")
            .replace(/(?:\s|\n)+Codes?\s*:?\s*(?:(?:\s|\n)*(?:\([A-Ea-e1-5ivxIVX]+\)|[A-Ea-e1-5ivxIVX]+[.)-]?)){2,}\s*$/i, "")
            .trim();
        const markerPattern = /(?<![A-Za-z0-9])((?:\(\d{1,2}\)|\d{1,2}[.):]?)(?=\s|\n|$|[A-Za-z])|(?:\([A-Ea-e]\)|[A-Ea-e][.)-]|[A-Ea-e])(?=\s|\n|$)|(?:\([IVXivx]+\)|[IVXivx]+[.)-]|[IVXivx]+)(?=\s|\n|$))/g;
        const headerPattern = /((?:List|Column)\s*[-–—]?\s*(?:II|I|2|1|A|B)\b(?:\s*\([^)]*\))?)/gi;
        const headers = Array.from(text.matchAll(headerPattern));
        const headerTwo = headers.filter((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:II|2|B)\b/i.test(header[0])).pop();
        const headerOne = headers.filter((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:I(?!I)|1|A)\b/i.test(header[0]))
            .filter((header) => header.index < (headerTwo?.index ?? Number.POSITIVE_INFINITY)).pop();
        const hasHeaders = Boolean(headerOne && headerTwo);
        const hasStrongHeaderlessWording = /\b(?:match(?:ing)?\s+(?:the\s+following|schedule|list|pairs?)|correctly\s+match(?:ed|ing)?\s+the\s+following)\b/i.test(text);
        if (!hasHeaders && !hasStrongHeaderlessWording) return null;
        const markerInfo = (marker) => {
            const value = marker.replace(/[().,:]/g, "");
            if (/^\d+$/.test(value)) return { family: "numeric", value: Number(value), caseKey: "" };
            if (/^[IVX]+$/i.test(value)) {
                const romanValues = { I: 1, V: 5, X: 10 };
                const upper = value.toUpperCase();
                const romanNumber = upper.split("").reduce((total, numeral, index, numerals) => {
                    const current = romanValues[numeral];
                    const next = romanValues[numerals[index + 1]] || 0;
                    return total + (current < next ? -current : current);
                }, 0);
                return { family: "roman", value: romanNumber, caseKey: value === upper ? "upper" : "lower" };
            }
            return { family: "letter", value: value.toUpperCase().charCodeAt(0) - 64, caseKey: value === value.toUpperCase() ? "upper" : "lower" };
        };
        const leadingQuestion = text.match(/^\s*\d{1,3}[.)]?\s+/);
        const tokens = Array.from(text.matchAll(markerPattern))
            .filter((token) => !(leadingQuestion && token.index < leadingQuestion[0].length))
            .filter((token) => !/^(?:List|Column)\s*[-–—]?\s*$/i.test(text.slice(Math.max(0, token.index - 12), token.index)))
            .filter((token) => !/\b[A-Ea-e][.)]\s*$/.test(text.slice(Math.max(0, token.index - 8), token.index))
                || !/^[A-Ea-e][.)]\s+[A-Z][a-z]/.test(text.slice(token.index, token.index + 14)))
            .map((token) => ({ token, info: markerInfo(token[1]) }));
        const sequenceFrom = (available, family) => {
            const result = [];
            let expected = 1;
            available.forEach((entry) => {
                if (entry.info.family !== family) return;
                if (entry.info.value === expected) {
                    result.push(entry);
                    expected += 1;
                } else if (entry.info.value === 1 && !result.length) {
                    result.push(entry);
                    expected = 2;
                }
            });
            return result;
        };
        const sideTokens = (start, end, families) => tokens
            .filter((entry) => entry.token.index > start && entry.token.index < end)
            .filter((entry) => families.includes(entry.info.family));
        const leftStart = hasHeaders ? headerOne.index + headerOne[0].length : -1;
        const leftEnd = hasHeaders ? headerTwo.index : text.length;
        const rightStart = hasHeaders ? headerTwo.index + headerTwo[0].length : -1;
        const instruction = /\b(?:select|choose|code|codes|options?)\b/i;
        const rightTail = hasHeaders ? text.slice(rightStart).search(instruction) : -1;
        const rightEnd = hasHeaders && rightTail >= 0 ? rightStart + rightTail : text.length;
        let left = hasHeaders
            ? sequenceFrom(sideTokens(leftStart, leftEnd, ["letter", "roman", "numeric"]), "letter")
            : null;
        let right = hasHeaders
            ? sequenceFrom(sideTokens(rightStart, rightEnd, ["letter", "roman", "numeric"]), "numeric")
            : null;
        if (hasHeaders && (!right || right.length < 2)) {
            right = sequenceFrom(sideTokens(rightStart, rightEnd, ["letter", "roman", "numeric"]), "roman");
            if (!right || right.length < 2) right = sideTokens(rightStart, rightEnd, ["numeric", "roman", "letter"]);
        }
        if (hasHeaders && (!left || left.length < 2)) {
            left = sequenceFrom(sideTokens(leftStart, leftEnd, ["letter", "roman", "numeric"]), "numeric");
            if (!left || left.length < 2) left = sequenceFrom(sideTokens(leftStart, leftEnd, ["letter", "roman", "numeric"]), "roman");
            if (!left || left.length < 2) left = sideTokens(leftStart, leftEnd, ["letter", "roman", "numeric"]);
        }
        if (hasHeaders && (!left || left.length < 2 || !right || right.length < 2)) {
            const globalCandidates = ["letter", "numeric", "roman"]
                .map((family) => sequenceFrom(tokens, family))
                .filter((sequence) => sequence.length >= 2);
            for (const first of globalCandidates) {
                const other = globalCandidates.filter((candidate) => candidate[0].info.family !== first[0].info.family)
                    .sort((a, b) => b.length - a.length)[0];
                if (!other) continue;
                const pair = first[0].token.index < other[0].token.index ? [first, other] : [other, first];
                if (!left || !right || Math.min(pair[0].length, pair[1].length) > Math.min(left.length, right.length)) [left, right] = pair;
            }
        }
        if (!hasHeaders) {
            const candidates = ["letter", "numeric", "roman"].map((family) => sequenceFrom(tokens, family)).filter((sequence) => sequence.length >= 2);
            for (const first of candidates) {
                const other = candidates.filter((candidate) => candidate[0].info.family !== first[0].info.family)
                    .sort((a, b) => b.length - a.length)[0];
                if (!other) continue;
                const pair = first[0].token.index < other[0].token.index ? [first, other] : [other, first];
                if (!left || Math.min(pair[0].length, pair[1].length) > Math.min(left.length, right?.length || 0)) [left, right] = pair;
            }
            if (!left || !right) {
                const letterSide = sequenceFrom(tokens, "letter");
                const numericMarkers = tokens.filter((entry) => entry.info.family === "numeric");
                if (letterSide.length >= 2 && numericMarkers.length >= 2) {
                    left = letterSide;
                    right = numericMarkers;
                }
            }
        }
        if (!left || left.length < 2 || !right || right.length < 2) return null;
        const grouped = left[left.length - 1].token.index < right[0].token.index;
        const leftBoundary = grouped ? (hasHeaders ? headerTwo.index : right[0].token.index) : text.length;
        const rightBoundary = hasHeaders ? rightEnd : text.length;
        const rows = [];
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
            const leftEntry = left[index];
            const rightEntry = right[index];
            const leftItemEnd = grouped ? (left[index + 1] ? left[index + 1].token.index : leftBoundary) : (rightEntry ? rightEntry.token.index : (left[index + 1] ? left[index + 1].token.index : text.length));
            const rightItemEnd = grouped
                ? (right[index + 1] ? right[index + 1].token.index : rightBoundary)
                : (left[index + 1] ? left[index + 1].token.index : (right[index + 1] ? right[index + 1].token.index : text.length));
            rows.push({
                left: leftEntry ? `${leftEntry.token[1]} ${cleanText(text.slice(leftEntry.token.index + leftEntry.token[1].length, leftItemEnd))}`.trim() : "",
                right: rightEntry ? `${rightEntry.token[1]} ${cleanText(text.slice(rightEntry.token.index + rightEntry.token[1].length, rightItemEnd))}`.trim() : ""
            });
        }
        if (!rows.some((row) => row.left && row.right)) return null;
        const firstItemIndex = Math.min(left[0].token.index, right[0].token.index);
        return {
            prompt: cleanText(text.slice(0, hasHeaders ? headerOne.index : firstItemIndex)),
            listOneHeader: headerOne?.[1] || "List-I",
            listTwoHeader: headerTwo?.[1] || "List-II",
            rows
        };
    }

    function parseStatementQuestion(question) {
        if (isMatchListQuestion(question)) return null;
        const text = cleanText(question?.q || "");
        const assertion = text.match(/Assertion\s*\(A\)\s*:\s*([\s\S]*?)\s*Reason\s*\(R\)\s*:\s*([\s\S]*?)(?=\bChoose\s+the\s+correct\s+answer\b|$)/i);
        if (assertion) {
            return { stem: text.slice(0, assertion.index).trim(), statements: [{ marker: "Assertion (A):", text: assertion[1].trim() }, { marker: "Reason (R):", text: assertion[2].trim() }], finalInstruction: (text.match(/\bChoose\s+the\s+correct\s+answer\b[\s\S]*$/i) || [""])[0].trim() };
        }
        return null;
    }

    function renderQuestion(question, questionNumber, settings = {}) {
        const normalizedQuestion = { ...question, q: normalizeQuestionText(question?.q, questionNumber) };
        const parsedMatchList = parseMatchListQuestion(normalizedQuestion);
        const parsedStatement = parsedMatchList ? null : parseStatementQuestion(normalizedQuestion);
        const formattedPrompt = parsedMatchList || parsedStatement
            ? { text: parsedMatchList?.prompt || cleanText(normalizedQuestion.q || ""), formatted: false }
            : formatEmbeddedOptions(normalizedQuestion.q, normalizedQuestion.options);
        const prompt = formattedPrompt.text;
        const promptHtml = formattedPrompt.formatted
            ? escapeHtml(prompt).replace(/\r?\n/g, "<br>")
            : escapeHtml(prompt);
        const questionContent = parsedStatement
            ? `<div class="question-statement statement-question"><p>${escapeHtml(parsedStatement.stem)}</p>${parsedStatement.statements.map((item) => `<p class="statement-item">${escapeHtml(item.marker)} ${escapeHtml(item.text)}</p>`).join("")}${parsedStatement.finalInstruction ? `<p class="statement-instruction">${escapeHtml(parsedStatement.finalInstruction)}</p>` : ""}</div>`
            : `<div class="question-statement"><p>${promptHtml}</p></div>`;
        const table = parsedMatchList ? `<div class="match-list-table" role="table" aria-label="${escapeHtml(parsedMatchList.listOneHeader)} and ${escapeHtml(parsedMatchList.listTwoHeader)}"><div class="match-list-header match-list-left" role="columnheader">${escapeHtml(parsedMatchList.listOneHeader)}</div><div class="match-list-header match-list-right" role="columnheader">${escapeHtml(parsedMatchList.listTwoHeader)}</div>${parsedMatchList.rows.map((row) => `<div class="match-list-row" role="row"><div class="match-list-cell match-list-left" role="cell">${escapeHtml(row.left)}</div><div class="match-list-cell match-list-right" role="cell">${escapeHtml(row.right)}</div></div>`).join("")}</div>` : "";
        const selectedIndex = settings.selectedIndex;
        const options = (question?.options || []).map((option, index) => {
            const label = String.fromCharCode(65 + index);
            const selected = selectedIndex === index ? " selected-option" : "";
            const input = settings.interactive ? `<input type="radio" name="answer" value="${index}"${selectedIndex === index ? " checked" : ""} />` : "";
            return `<${settings.interactive ? "label" : "div"} class="option-wrap shared-option${selected}">${input}<span class="option-label">${label}.</span><span class="option-text">${escapeHtml(cleanText(option))}</span></${settings.interactive ? "label" : "div"}>`;
        }).join("");
        return `<div class="shared-question-renderer"><div class="question-header"><h3>Question ${questionNumber}</h3></div>${parsedMatchList ? `${questionContent}${table}` : questionContent}<div class="shared-options">${options}</div></div>`;
    }

    window.QuestionRenderer = { cleanText, normalizeQuestionText, formatEmbeddedOptions, isMatchListQuestion, parseMatchListQuestion, renderQuestion };
}());

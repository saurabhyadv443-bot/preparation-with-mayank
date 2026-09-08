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
        if (Array.isArray(options) && options.length) {
            return { text, formatted: false };
        }
        if (!text || /\n/.test(text) || /\b(?:list|column|match|matching|assertion|reason|code|codes)\b/i.test(text)) {
            return { text, formatted: false };
        }

        if (/\b\d{1,2}\.\s+\d{1,2}\.\s+\d{4}\.?\b/.test(text)) {
            return { text, formatted: false };
        }

        const markerPattern = /(?:^|\s)((?:\([1-4]\))|(?:[A-Da-d]\s*[.)-])|(?:[1-4]\s*[.)-])|(?:[A-Da-d](?=\s*$)))(?=\s|$)/g;
        const matches = Array.from(text.matchAll(markerPattern)).map((match) => ({
            marker: match[1].trim(),
            value: /^[A-Da-d]/.test(match[1]) ? match[1].charAt(0).toUpperCase() : Number(match[1].replace(/[()\s.)-]/g, "")),
            family: /^[A-Da-d]/.test(match[1]) ? "letter" : "number",
            index: match.index + match[0].indexOf(match[1])
        }));
        let sequence = null;
        for (let startIndex = 0; startIndex < matches.length; startIndex += 1) {
            const start = matches[startIndex];
            const expected = start.family === "letter" ? "A" : 1;
            if (start.value !== expected) continue;
            const found = [];
            for (let index = startIndex; index < matches.length && found.length < 4; index += 1) {
                const item = matches[index];
                const expectedValue = start.family === "letter"
                    ? String.fromCharCode("A".charCodeAt(0) + found.length)
                    : found.length + 1;
                if (item.family !== start.family || item.value !== expectedValue) break;
                found.push(item);
            }
            if (found.length >= 2) {
                sequence = found;
                break;
            }
        }
        if (!sequence) return { text, formatted: false };
        if (sequence.length === 2 && sequence[0].family === "letter"
            && text.slice(0, sequence[0].index).trim()
            && !/\b(?:choose|correct|following|select|option|order|statement)\b/i.test(text.slice(0, sequence[0].index))) {
            return { text, formatted: false };
        }
        if (sequence.length === 2 && sequence[0].family === "number"
            && !sequence[0].marker.startsWith("(")
            && !/\b(?:choose|correct|following|select|option|order|statement)\b/i.test(text)) {
            return { text, formatted: false };
        }

        const selected = sequence;
        const first = selected[0];
        const prefix = text.slice(0, first.index).trimEnd();
        const parts = selected.map((item, index) => {
            const next = selected[index + 1];
            const end = next ? next.index : text.length;
            return `${item.marker} ${text.slice(item.index + item.marker.length, end).trim()}`.trim();
        });
        return { text: [prefix, ...parts].filter(Boolean).join("\n"), formatted: true };
    }

    function isMatchListQuestion(question) {
        const text = String(question?.q || "");
        return /\b(?:list|column)\s*[-–—]?\s*(?:i|ii|1|2|a|b)\b/i.test(text)
            || /\b(?:match|matching|pairs?\s+are\s+correct(?:ly)?\s+matched|correctly\s+match)\b/i.test(text);
    }

    function parseMatchListQuestion(question) {
        if (!isMatchListQuestion(question)) return null;
        const text = cleanText(question.q)
            .replace(/\s*\|\s*/g, "\n")
            .replace(/(?:\s|\n)+Codes?\s*:?\s*(?:(?:\s|\n)+[A-D](?:[.)])?){2,}\s*$/i, "")
            .trim();
        const markerPattern = /(?<![A-Za-z0-9])(\(\d{1,2}\)|\d{1,2}[.):]?|\([A-Za-z]\)|[A-Za-z][.):]?|\([IVXivx]+\)|[IVXivx]+[.):]?)(?=\s|\n|$)/g;
        const headerPattern = /((?:List|Column)\s*[-–—]?\s*(?:II|I|2|1|A|B)\b(?:\s*\([^)]*\))?)/gi;
        const headers = Array.from(text.matchAll(headerPattern));
        const headerTwo = headers.filter((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:II|2|B)\b/i.test(header[0])).pop();
        const headerOne = headers.filter((header) => /\b(?:List|Column)\s*[-–—]?\s*(?:I(?!I)|1|A)\b/i.test(header[0]))
            .filter((header) => header.index < (headerTwo?.index ?? Number.POSITIVE_INFINITY)).pop();
        const hasHeaders = Boolean(headerOne && headerTwo);
        const tokens = Array.from(text.matchAll(markerPattern)).filter((token) => !/(?:List|Column)\s*[-–—]?\s*$/i.test(text.slice(Math.max(0, token.index - 12), token.index)));
        const markerInfo = (marker) => {
            const value = marker.replace(/[().,:]/g, "");
            if (/^\d+$/.test(value)) return { family: "numeric", value: Number(value) };
            if (/^[IVX]+$/i.test(value)) {
                const romanValues = { I: 1, V: 5, X: 10 };
                const upper = value.toUpperCase();
                const romanNumber = upper.split("").reduce((total, numeral, index, numerals) => {
                    const current = romanValues[numeral];
                    const next = romanValues[numerals[index + 1]] || 0;
                    return total + (current < next ? -current : current);
                }, 0);
                return { family: "roman", value: romanNumber };
            }
            return { family: "letter", value: value.toUpperCase().charCodeAt(0) - 64 };
        };
        const sequences = [];
        tokens.forEach((startToken, startIndex) => {
            const first = markerInfo(startToken[1]);
            if (first.value !== 1 || !text.slice(0, startToken.index).trim()) return;
            const sequence = [{ token: startToken, info: first }];
            for (let index = startIndex + 1; index < tokens.length; index += 1) {
                const next = markerInfo(tokens[index][1]);
                if (next.family === first.family && next.value === sequence.length + 1) sequence.push({ token: tokens[index], info: next });
            }
            if (sequence.length >= 2) sequences.push(sequence);
        });
        const candidates = sequences.sort((first, second) => second.length - first.length);
        let left = candidates[0];
        let right = candidates[1];
        if (hasHeaders) {
            const leftTokens = tokens.filter((token) => token.index > headerOne.index + headerOne[0].length && token.index < headerTwo.index)
                .filter((token) => markerInfo(token[1]).family === "letter");
            const rightEnd = text.slice(headerTwo.index + headerTwo[0].length).search(/\b(?:select|choose|code|codes|options?)\b/i);
            const end = rightEnd < 0 ? text.length : headerTwo.index + headerTwo[0].length + rightEnd;
            const rightTokens = tokens.filter((token) => token.index > headerTwo.index + headerTwo[0].length && token.index < end)
                .filter((token) => ["numeric", "roman"].includes(markerInfo(token[1]).family));
            if (leftTokens.length >= 2 && rightTokens.length >= 2) {
                left = leftTokens.map((token, index) => ({ token, info: { family: "letter", value: index + 1 } }));
                right = rightTokens.map((token, index) => ({ token, info: { family: "numeric", value: index + 1 } }));
            }
        }
        if (!left || !right) return null;
        if (left[0].token.index > right[0].token.index) [left, right] = [right, left];
        const grouped = left[left.length - 1].token.index < right[0].token.index;
        const codeStart = hasHeaders ? text.slice(headerTwo.index + headerTwo[0].length).search(/\b(?:select|choose|code|codes|options?)\b/i) : -1;
        const rightEnd = hasHeaders && codeStart >= 0
            ? headerTwo.index + headerTwo[0].length + codeStart
            : text.length;
        const rows = [];
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
            const leftEntry = left[index];
            const rightEntry = right[index];
            const leftEnd = grouped ? left[index + 1]?.token.index ?? (headerTwo?.index ?? right[0]?.token.index ?? text.length) : rightEntry?.token.index ?? left[index + 1]?.token.index ?? text.length;
            const rightItemEnd = grouped ? right[index + 1]?.token.index ?? rightEnd : left[index + 1]?.token.index ?? text.length;
            rows.push({
                left: leftEntry ? `${String.fromCharCode(65 + index)}. ${cleanText(text.slice(leftEntry.token.index + leftEntry.token[1].length, leftEnd))}` : "",
                right: rightEntry ? `${index + 1}. ${cleanText(text.slice(rightEntry.token.index + rightEntry.token[1].length, rightItemEnd))}` : ""
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

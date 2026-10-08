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

    function stripMatchListCodeFooter(value) {
        return String(value ?? "")
            .replace(/\n[^\n]+\n\d{2,4}\nYCT(?=\nCode\b)/i, "")
            .replace(/(?:\s|\n)+Codes?\s*[:\-–—]*\s*(?:(?:\s|\n)+(?:\(?[A-D]\)?|\(?[IVX]+\)?|\(?\d{1,2}\)?)(?:[.)])?){0,8}\s*$/i, "")
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

    function normalizeEmbeddedLineBreaks(value) {
        const text = String(value ?? "");
        if (!text) return text;
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length < 2) return text;

        const structuralPrefixes = [
            "List-I",
            "List-II",
            "Assertion",
            "Reason",
            "Statement",
            "Conclusion",
            "Code",
            "Select",
            "Choose",
            "Which",
            "What",
            "How",
            "Identify",
            "Arrange",
            "According",
            "Given below are",
            "Consider the following",
            "Match List-I with List-II"
        ];

        const isStructuralLine = (line) => {
            if (structuralPrefixes.some((prefix) => line.toLowerCase().startsWith(prefix.toLowerCase()))) {
                return true;
            }
            return /^(?:[A-D][.)]|[1-9]\d*[.)]|[IVX]+[.)]|\([A-D]\)|\([IVX]+\))/i.test(line);
        };

        const normalizedLines = [lines[0]];
        for (let index = 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (isStructuralLine(line)) {
                normalizedLines.push(line);
                continue;
            }
            const previousLine = normalizedLines[normalizedLines.length - 1];
            normalizedLines[normalizedLines.length - 1] = `${previousLine} ${line}`;
        }

        return normalizedLines.join("\n");
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
        const hasListColumnMarkers = /\b(?:list|column)\s*[-–—]?\s*(?:i|ii|1|2|a|b)\b/i.test(text);
        const hasStructuredMatchHeader = /\bmatch\b\s+(?:list|column)\b/i.test(text);
        const hasStructuredMatchPhrase = /\b(?:match(?:ing)?\s+the\s+following|pairs?\s+are\s+correct(?:ly)?\s+matched|correctly\s+match)\b/i.test(text);
        return hasListColumnMarkers || hasStructuredMatchHeader || hasStructuredMatchPhrase;
    }

    function parseMatchListQuestion(question) {
        if (!isMatchListQuestion(question)) return null;
        const text = stripMatchListCodeFooter(cleanText(question.q))
            .replace(/\s*\|\s*/g, "\n")
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
            const leftEnd = grouped ? left[index + 1]?.token.index ?? right[0]?.token.index ?? text.length : rightEntry?.token.index ?? left[index + 1]?.token.index ?? text.length;
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

    function parseMatchListFromOptions(question) {
        const options = Array.isArray(question?.options) ? question.options : [];
        const romanValues = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
        const parseMarker = (marker) => {
            const value = marker.replace(/[().]/g, "");
            if (/^\d+$/.test(value)) return { family: "numeric", value: Number(value) };
            const upper = value.toUpperCase();
            const number = upper.split("").reduce((total, numeral, index, numerals) => {
                const current = romanValues[numeral] || 0;
                const next = romanValues[numerals[index + 1]] || 0;
                return total + (current < next ? -current : current);
            }, 0);
            return { family: "roman", value: number };
        };
        const entries = options.map((option, index) => {
            const text = cleanText(option);
            const markers = Array.from(text.matchAll(/(?<![A-Za-z0-9])(\(?[ivxlcdm]+\)?\.?|\(?\d{1,2}\)?\.?)(?=\s|$)/gi));
            if (markers.length !== 1) return null;
            const marker = markers[0];
            const left = text.slice(0, marker.index).replace(/[-–—,;:\s]+$/g, "").trim();
            const right = text.slice(marker.index + marker[0].length).replace(/^\s*[,;:\-–—]+\s*/, "").replace(/\bCodes?\s*:?\s*$/i, "").trim();
            if (!left || !right) return null;
            return { index, marker: marker[1], ...parseMarker(marker[1]), left, right };
        });

        let bestRun = [];
        for (let start = 0; start < entries.length; start += 1) {
            if (!entries[start]) continue;
            const run = [entries[start]];
            for (let index = start + 1; index < entries.length; index += 1) {
                const previous = run[run.length - 1];
                const current = entries[index];
                if (!current || current.family !== previous.family || current.value !== previous.value + 1) break;
                run.push(current);
            }
            if (run.length > bestRun.length) bestRun = run;
        }
        if (bestRun.length < 2 || options.slice(bestRun[bestRun.length - 1].index + 1).every((option) => !cleanText(option))) {
            return null;
        }

        const text = cleanText(question?.q || "");
        const listOne = text.match(/\bList\s*[-–—]?\s*I\b(?:\s*\([^)]*\))?/i);
        const listTwo = text.match(/\bList\s*[-–—]?\s*II\b(?:\s*\([^)]*\))?/i);
        const firstListIndex = listOne ? listOne.index : -1;
        return {
            prompt: firstListIndex >= 0 ? text.slice(0, firstListIndex).trim() : text,
            listOneHeader: listOne?.[0] || "List-I",
            listTwoHeader: listTwo?.[0] || "List-II",
            rows: bestRun.map((entry, index) => ({
                left: `${String.fromCharCode(65 + index)}. ${entry.left}`,
                right: `${entry.marker} ${entry.right}`
            })),
            optionIndexes: bestRun.map((entry) => entry.index)
        };
    }

    function parseMatchListFromText(question) {
        const text = stripMatchListCodeFooter(cleanText(question?.q || ""));
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const hasListHeaders = /\bList\s*[-–—]?\s*I\b/i.test(text) && /\bList\s*[-–—]?\s*II\b/i.test(text);
        const rowMarkers = lines.map((line, index) => {
            const match = line.match(/^\(?([A-D]|[1-4])\)?(?:[.)]\s*|\s+|$)(.*)$/i);
            if (!match) return null;
            const marker = match[1].toUpperCase();
            const value = /^[A-D]$/.test(marker) ? marker.charCodeAt(0) - 64 : Number(marker);
            return { index, value, text: match[2].trim() };
        });
        const runs = [];
        rowMarkers.forEach((marker, index) => {
            if (!marker || marker.value !== 1) return;
            const run = [marker];
            for (let next = index + 1; next < rowMarkers.length; next += 1) {
                const candidate = rowMarkers[next];
                if (candidate?.value === run.length + 1) {
                    run.push(candidate);
                } else if (candidate) {
                    break;
                }
            }
            if (run.length >= 2) runs.push(run);
        });
        const rows = runs.sort((left, right) => right.length - left.length)[0];
        if (!rows) return null;

        const firstRowIndex = rows[0].index;
        const headerStart = lines.findIndex((line, index) => index < firstRowIndex
            && /\bList\s*[-–—]?\s*I\b/i.test(line));
        const genericHeaders = !hasListHeaders && /\bmatch(?:ing)?\s+the\s+following\b/i.test(text)
            ? lines.slice(0, firstRowIndex).slice(-2)
            : [];
        if (!hasListHeaders && genericHeaders.length < 2) return null;

        const parsedRows = rows.map((marker, rowIndex) => {
            const nextRowIndex = rows[rowIndex + 1]?.index ?? lines.length;
            const content = [
                ...(marker.text ? [marker.text] : []),
                ...lines.slice(marker.index + 1, nextRowIndex)
            ].filter(Boolean);
            const rightStart = content.findIndex((line) =>
                /^\(?[A-Z]\)?[.)]?$|^\(?[ivxlcdm]+\)?[.)]?$|^\(?\d+\)?[.)]?$|^\(?[ivxlcdm]+\)?\.?\s+\S/i.test(line)
            );
            let left;
            let right;
            if (rightStart > 0) {
                left = content.slice(0, rightStart).join(" ");
                right = content.slice(rightStart).join(" ");
            } else if (content.length === 1) {
                const inlinePair = content[0].match(/^(.+?)\s+[–—-]\s+(.+)$/);
                if (!inlinePair) return null;
                left = inlinePair[1].trim();
                right = inlinePair[2].trim();
            } else if (content.length >= 2) {
                left = content.slice(0, -1).join(" ");
                right = content[content.length - 1];
            } else {
                return null;
            }
            return {
                left: `${String.fromCharCode(64 + rowIndex + 1)}. ${left}`,
                right
            };
        });
        if (parsedRows.some((row) => !row)) return null;

        const promptEnd = headerStart >= 0
            ? headerStart
            : Math.max(0, firstRowIndex - genericHeaders.length);
        const listOne = text.match(/\bList\s*[-–—]?\s*I\b(?:\s*\([^)]*\))?/i);
        const listTwo = text.match(/\bList\s*[-–—]?\s*II\b(?:\s*\([^)]*\))?/i);
        return {
            prompt: lines.slice(0, promptEnd).join("\n").trim(),
            listOneHeader: listOne?.[0] || genericHeaders[0],
            listTwoHeader: listTwo?.[0] || genericHeaders[1],
            rows: parsedRows
        };
    }

    function parseInterleavedMatchList(question) {
        const text = stripMatchListCodeFooter(cleanText(question?.q || ""));
        const listTwo = Array.from(text.matchAll(/\bList\s*[-–—]?\s*II\b(?:\s*\([^)]*\))?/gi)).pop();
        const namedHeaders = text.match(/\b(Tribe)\s*\r?\n\s*(State)\b/i);
        const dataStart = listTwo
            ? listTwo.index + listTwo[0].length
            : namedHeaders
                ? namedHeaders.index + namedHeaders[0].length
                : -1;
        if (dataStart < 0) return null;

        const body = text.slice(dataStart);
        const markerPattern = /(?<![A-Za-z0-9])((?:\(?[1-4]\)?\.(?=\s|[A-Za-z])|\(?[1-4]\)?(?=\s|$))|\(?[A-D]\)?\.?(?=\s|$)|\b(?:IV|III|II|I)\b|IB(?=\s|$))/gi;
        const tokens = Array.from(body.matchAll(markerPattern)).map((match) => {
            const marker = match[1];
            const value = marker.replace(/[().]/g, "");
            if (/^\d+$/.test(value)) {
                return { marker, family: "numeric", value: Number(value), index: match.index, end: match.index + match[0].length };
            }
            if (/^I{1,3}V?$/.test(value)) {
                const romanValues = { I: 1, II: 2, III: 3, IV: 4 };
                return { marker, family: "roman", value: romanValues[value], index: match.index, end: match.index + match[0].length };
            }
            const label = value === "IB" ? "B" : value;
            return { marker: value === "IB" ? "B" : marker, family: "letter", value: label.charCodeAt(0) - 64, index: match.index, end: match.index + match[0].length };
        });
        const sequenceFor = (family) => {
            const familyTokens = tokens.filter((token) => token.family === family);
            for (const first of familyTokens) {
                if (first.value !== 1) continue;
                const sequence = [first];
                for (const candidate of familyTokens) {
                    if (candidate.index > sequence[sequence.length - 1].index
                        && candidate.value === sequence.length + 1) {
                        sequence.push(candidate);
                    }
                }
                if (sequence.length >= 2) return sequence;
            }
            return [];
        };
        const letterSequence = sequenceFor("letter");
        const numericSequence = sequenceFor("numeric");
        const romanSequence = sequenceFor("roman");
        const listOne = text.match(/\bList\s*[-–—]?\s*I\b(?:\s*\([^)]*\))?/i);
        const makeInterleavedRows = (leftSequence, rightSequence, allowEmptyLeft = false) => {
            if (leftSequence.length < 2 || rightSequence.length < 2) return null;
            const rows = [];
            for (let index = 0; index < leftSequence.length; index += 1) {
                const leftToken = leftSequence[index];
                const nextLeft = leftSequence[index + 1];
                const rightToken = rightSequence.find((token) => token.index > leftToken.end
                    && token.index < (nextLeft?.index ?? body.length));
                if (!rightToken) return null;
                const left = body.slice(leftToken.end, rightToken.index).trim();
                let right = body.slice(rightToken.end, nextLeft?.index ?? body.length)
                    .replace(/(?:^|\n)\s*[1-4]\.?\s*$/g, "")
                    .trim();
                if ((!left && !allowEmptyLeft) || !right) return null;
                rows.push({
                    left: `${leftToken.marker}${left ? ` ${left}` : ""}`.trim(),
                    right: `${rightToken.marker} ${right}`.trim()
                });
            }
            if (rows.length < 2) return null;
            const prompt = text.slice(0, dataStart).trim();
            return {
                prompt: listOne ? text.slice(0, listOne.index).trim() : prompt,
                listOneHeader: listOne?.[0] || "Tribe",
                listTwoHeader: listTwo?.[0] || "State",
                rows
            };
        };
        const alternateRows = makeInterleavedRows(letterSequence, numericSequence)
            || makeInterleavedRows(romanSequence, letterSequence)
            || makeInterleavedRows(letterSequence, romanSequence, true);
        if (alternateRows) return alternateRows;

        const leftFamily = ["numeric", "roman"].find((family) => tokens.some((token) => token.family === family && token.value === 1));
        if (!leftFamily) return null;
        const leftTokens = tokens.filter((token) => token.family === leftFamily);
        const rows = [];
        for (let index = 0; index < leftTokens.length; index += 1) {
            const leftToken = leftTokens[index];
            if (leftToken.value !== index + 1) break;
            const nextLeft = leftTokens[index + 1];
            const rightToken = tokens.find((token) => token.family === "letter"
                && token.index > leftToken.end
                && token.index < (nextLeft?.index ?? body.length));
            if (!rightToken) break;
            const left = body.slice(leftToken.end, rightToken.index).trim();
            const right = body.slice(rightToken.end, nextLeft?.index ?? body.length).trim();
            if (!left || !right) break;
            rows.push({
                left: `${leftToken.marker} ${left}`,
                right: `${rightToken.marker} ${right}`
            });
        }
        if (rows.length < 2) return null;
        const prompt = text.slice(0, dataStart).trim();
        return {
            prompt: listOne ? text.slice(0, listOne.index).trim() : prompt,
            listOneHeader: listOne?.[0] || "Tribe",
            listTwoHeader: listTwo?.[0] || "State",
            rows
        };
    }

    function normalizeMatchingOptions(question, parsedMatchList) {
        const options = Array.isArray(question?.options) ? question.options : [];
        const groups = [];
        let group = [];
        options.forEach((option) => {
            const text = cleanText(option);
            if (!text) {
                if (group.length) groups.push(group);
                group = [];
            } else {
                group.push(text);
            }
        });
        if (group.length) groups.push(group);

        const getCodeFragment = (value) => {
            const match = cleanText(value).match(/^\s*[-–—]?\s*\(?([ivxlcdm]+|\d+|[a-d])\)?\s*[,.;:]?\s*$/i);
            return match ? match[1].toLowerCase() : null;
        };
        const fragmentGroups = groups.map((items) => items.map(getCodeFragment));
        const canJoinFragments = groups.length > 1
            && groups.every((items) => items.length > 1)
            && fragmentGroups.every((codes) => codes.every(Boolean)
                && codes.length === fragmentGroups[0].length
                && new Set(codes).size === codes.length
                && codes.slice().sort().join("|") === fragmentGroups[0].slice().sort().join("|"));
        const candidates = canJoinFragments
            ? groups.map((items) => ({ text: items.join("\n"), indexes: [] }))
            : options.map((option, index) => ({ text: cleanText(option), indexes: [index] }));
        const tableOptionIndexes = new Set(parsedMatchList.optionIndexes || []);

        const tableValues = parsedMatchList.rows.flatMap((row) => [row.left, row.right])
            .map((value) => cleanText(value).replace(/^(?:[A-Z]\.|(?:\(?[ivxlcdm]+\)?|\d+)\.?)\s*/i, ""))
            .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""))
            .filter((value) => value.length >= 4);
        return candidates.filter(({ text, indexes }) => {
            if (indexes.some((index) => tableOptionIndexes.has(index))) return false;
            const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (!normalized) return false;
            const listValueMatches = tableValues.filter((value) => normalized.includes(value));
            return new Set(listValueMatches).size < 2;
        }).map(({ text }) => text);
    }

    function getSectionalMatchList(question, questionNumber) {
        const normalizedQuestion = { ...question, q: normalizeQuestionText(question?.q, questionNumber) };
        if (!isMatchListQuestion(normalizedQuestion)) return null;

        const parsedMatchList = parseMatchListQuestion(normalizedQuestion);
        const hasTextContent = (value) => cleanText(value)
            .replace(/^(?:[A-D]\.|[1-9]\d*\.|(?:\(?[IVX]+\)?))\s*/i, "")
            .trim().length > 0;
        const completeRows = parsedMatchList?.rows.filter((row) => hasTextContent(row.left) && hasTextContent(row.right)) || [];
        if (completeRows.length) return { ...parsedMatchList, rows: completeRows };
        return parseMatchListFromOptions(normalizedQuestion)
            || parseInterleavedMatchList(normalizedQuestion)
            || parseMatchListFromText(normalizedQuestion);
    }

    function getQuestionOptions(question, settings = {}) {
        const options = Array.isArray(question?.options) ? question.options : [];
        if (settings.preserveSectionalSource) return options;
        if (!settings.sectionalMatching) return options;
        const parsedMatchList = getSectionalMatchList(question, settings.questionNumber);
        return parsedMatchList ? normalizeMatchingOptions(question, parsedMatchList) : options;
    }

    function renderQuestion(question, questionNumber, settings = {}) {
        const preserveSectionalSource = settings.preserveSectionalSource === true;
        const normalizedQuestion = preserveSectionalSource
            ? question
            : { ...question, q: normalizeQuestionText(question?.q, questionNumber) };
        const parsedMatchList = preserveSectionalSource
            ? null
            : settings.sectionalMatching
            ? getSectionalMatchList(question, questionNumber)
            : parseMatchListQuestion(normalizedQuestion);
        const parsedStatement = preserveSectionalSource || parsedMatchList
            ? null
            : parseStatementQuestion(normalizedQuestion);
        const formattedPrompt = parsedMatchList || parsedStatement
            ? { text: parsedMatchList?.prompt || cleanText(normalizedQuestion.q || ""), formatted: false }
            : preserveSectionalSource
                ? { text: String(normalizedQuestion?.q ?? ""), formatted: false }
                : formatEmbeddedOptions(normalizedQuestion.q, normalizedQuestion.options);
        const prompt = preserveSectionalSource ? formattedPrompt.text : normalizeEmbeddedLineBreaks(formattedPrompt.text);
        const promptHtml = formattedPrompt.formatted
            ? escapeHtml(prompt).replace(/\r?\n/g, "<br>")
            : escapeHtml(prompt);
        const normalizedStatementStem = parsedStatement ? normalizeEmbeddedLineBreaks(parsedStatement.stem) : "";
        const normalizedStatementItems = parsedStatement ? parsedStatement.statements.map((item) => ({
            ...item,
            text: normalizeEmbeddedLineBreaks(item.text),
            marker: normalizeEmbeddedLineBreaks(item.marker)
        })) : [];
        const normalizedStatementInstruction = parsedStatement ? normalizeEmbeddedLineBreaks(parsedStatement.finalInstruction || "") : "";
        const questionContent = parsedStatement
            ? `<div class="question-statement statement-question"><p>${escapeHtml(normalizedStatementStem)}</p>${normalizedStatementItems.map((item) => `<p class="statement-item">${escapeHtml(item.marker)} ${escapeHtml(item.text)}</p>`).join("")}${normalizedStatementInstruction ? `<p class="statement-instruction">${escapeHtml(normalizedStatementInstruction)}</p>` : ""}</div>`
            : `<div class="question-statement"><p>${promptHtml}</p></div>`;
        const table = parsedMatchList ? `<div class="match-list-table" role="table" aria-label="${escapeHtml(parsedMatchList.listOneHeader)} and ${escapeHtml(parsedMatchList.listTwoHeader)}"><div class="match-list-header match-list-left" role="columnheader">${escapeHtml(parsedMatchList.listOneHeader)}</div><div class="match-list-header match-list-right" role="columnheader">${escapeHtml(parsedMatchList.listTwoHeader)}</div>${parsedMatchList.rows.map((row) => `<div class="match-list-row" role="row"><div class="match-list-cell match-list-left" role="cell">${escapeHtml(row.left)}</div><div class="match-list-cell match-list-right" role="cell">${escapeHtml(row.right)}</div></div>`).join("")}</div>` : "";
        const selectedIndex = settings.selectedIndex;
        const questionOptions = preserveSectionalSource
            ? (Array.isArray(question?.options) ? question.options : [])
            : settings.sectionalMatching && parsedMatchList
                ? normalizeMatchingOptions(question, parsedMatchList)
                : (question?.options || []);
        const options = questionOptions.map((option, index) => {
            const label = String.fromCharCode(65 + index);
            const selected = selectedIndex === index ? " selected-option" : "";
            const input = settings.interactive ? `<input type="radio" name="answer" value="${index}"${selectedIndex === index ? " checked" : ""} />` : "";
            const optionText = preserveSectionalSource ? option : cleanText(option);
            return `<${settings.interactive ? "label" : "div"} class="option-wrap shared-option${selected}">${input}<span class="option-label">${label}.</span><span class="option-text">${escapeHtml(optionText)}</span></${settings.interactive ? "label" : "div"}>`;
        }).join("");
        const rendererClass = preserveSectionalSource ? "shared-question-renderer sectional-source-rendering" : "shared-question-renderer";
        return `<div class="${rendererClass}"><div class="question-header"><h3>Question ${questionNumber}</h3></div>${parsedMatchList ? `${questionContent}${table}` : questionContent}<div class="shared-options">${options}</div></div>`;
    }

    window.QuestionRenderer = { cleanText, normalizeQuestionText, formatEmbeddedOptions, isMatchListQuestion, parseMatchListQuestion, getQuestionOptions, renderQuestion };
}());

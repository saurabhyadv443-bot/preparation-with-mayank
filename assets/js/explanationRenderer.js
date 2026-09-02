(function (global) {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function inlineStringToHtml(value) {
        let html = escapeHtml(String(value ?? ""));
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/__(.+?)__/g, "<u>$1</u>");
        html = html.replace(/==(.+?)==/g, "<mark>$1</mark>");
        html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
        html = html.replace(/(^|\s)\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<i>$2</i>");
        html = html.replace(/(^|\s)_([^_]+?)_(?!_)/g, "$1<i>$2</i>");
        html = html.replace(/\b(https?:\/\/[^\s<]+)\b/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        return html;
    }

    function renderInlineNode(node) {
        if (Array.isArray(node)) {
            return node.map((item) => renderInlineNode(item)).join("");
        }
        if (typeof node === "string") {
            return inlineStringToHtml(node);
        }
        if (!node || typeof node !== "object") {
            return escapeHtml(String(node ?? ""));
        }
        switch (node.type) {
            case "bold":
                return `<strong>${inlineStringToHtml(node.text ?? node.content ?? "")}</strong>`;
            case "italic":
                return `<em>${inlineStringToHtml(node.text ?? node.content ?? "")}</em>`;
            case "underline":
                return `<u>${inlineStringToHtml(node.text ?? node.content ?? "")}</u>`;
            case "highlight":
                return `<mark>${inlineStringToHtml(node.text ?? node.content ?? "")}</mark>`;
            case "strikethrough":
                return `<s>${inlineStringToHtml(node.text ?? node.content ?? "")}</s>`;
            case "code":
                return `<code>${escapeHtml(String(node.text ?? node.content ?? ""))}</code>`;
            case "link":
                return `<a href="${escapeHtml(String(node.href || node.url || "#"))}" target="_blank" rel="noopener noreferrer">${inlineStringToHtml(node.text || node.label || node.href || node.url || "")}</a>`;
            case "text":
            default:
                return inlineStringToHtml(node.text ?? node.content ?? "");
        }
    }

    function renderInlineContent(content) {
        if (Array.isArray(content)) {
            return content.map((item) => renderInlineNode(item)).join("");
        }
        if (typeof content === "string") {
            return inlineStringToHtml(content);
        }
        if (isPlainObject(content)) {
            return renderInlineNode(content);
        }
        return escapeHtml(String(content ?? ""));
    }

    function serializeDocumentForEditing(documentLike) {
        const doc = normalizeExplanationDocument(documentLike);
        if (!doc || !Array.isArray(doc.blocks) || !doc.blocks.length) {
            return cleanLegacyText(documentLike || "");
        }
        const lines = [];
        doc.blocks.forEach((block) => {
            if (!block || typeof block !== "object") {
                return;
            }
            switch (block.type) {
                case "heading": {
                    const level = Number(block.level) || 2;
                    const prefix = "#".repeat(Math.min(Math.max(level, 1), 6));
                    lines.push(`${prefix} ${block.content || block.text || ""}`);
                    break;
                }
                case "paragraph":
                    lines.push(String(block.content || block.text || ""));
                    break;
                case "quote":
                    lines.push(`> ${String(block.content || block.text || "").replace(/\n/g, "\n> ")}`);
                    break;
                case "bullet-list":
                    if (Array.isArray(block.items)) {
                        block.items.forEach((item) => {
                            const text = getPlainTextFromExplanation(item);
                            if (text) lines.push(`- ${text}`);
                        });
                    }
                    break;
                case "ordered-list":
                    if (Array.isArray(block.items)) {
                        block.items.forEach((item, index) => {
                            const text = getPlainTextFromExplanation(item);
                            if (text) lines.push(`${index + 1}. ${text}`);
                        });
                    }
                    break;
                case "table": {
                    if (Array.isArray(block.headers) && block.headers.length) {
                        lines.push(`| ${block.headers.join(" | ")} |`);
                        lines.push(`| ${block.headers.map(() => "---").join(" | ")} |`);
                    }
                    if (Array.isArray(block.rows)) {
                        block.rows.forEach((row) => {
                            if (Array.isArray(row) && row.length) {
                                lines.push(`| ${row.map((cell) => String(cell ?? "")).join(" | ")} |`);
                            }
                        });
                    }
                    break;
                }
                case "image":
                    if (block.src) {
                        lines.push(`![${block.alt || "image"}](${block.src})`);
                        if (block.caption) lines.push(block.caption);
                    }
                    break;
                case "flowchart": {
                    if (Array.isArray(block.nodes) && block.nodes.length) {
                        const labels = block.nodes.map((node) => node && (node.label || node.text) ? String(node.label || node.text) : "").filter(Boolean);
                        if (labels.length > 0) {
                            lines.push(labels.join("\n↓\n"));
                        }
                    }
                    break;
                }
                case "code":
                    lines.push("```" + (block.language || "text") + "\n" + String(block.code || block.text || "") + "\n```" );
                    break;
                case "callout":
                case "note":
                case "warning":
                case "important": {
                    const title = block.title ? ` ${block.title}` : "";
                    lines.push(`> ${String(block.kind || block.type || "Note")}${title}`);
                    const content = block.content || block.text || "";
                    if (content) lines.push(String(content));
                    break;
                }
                case "separator":
                    lines.push("---");
                    break;
                default:
                    if (block.content || block.text) {
                        lines.push(String(block.content || block.text || ""));
                    }
                    break;
            }
        });
        return lines.join("\n\n").trim();
    }

    function renderListItems(items, ordered) {
        if (!Array.isArray(items) || !items.length) {
            return ordered ? "<ol></ol>" : "<ul></ul>";
        }
        const tag = ordered ? "ol" : "ul";
        const html = items.map((item) => {
            const textContent = item && typeof item === "object" && item.type === "list-item" ? item.content : item;
            const contentHtml = (() => {
                if (!textContent) return "";
                if (typeof textContent === "string") {
                    return renderInlineContent(textContent);
                }
                if (Array.isArray(textContent)) {
                    return renderInlineContent(textContent);
                }
                if (isPlainObject(textContent) && textContent.type === "paragraph") {
                    return renderBlock(textContent);
                }
                if (isPlainObject(textContent) && textContent.type === "list") {
                    return renderBlock(textContent);
                }
                return renderInlineContent(textContent);
            })();
            const nested = item && isPlainObject(item) && Array.isArray(item.children) && item.children.length ? renderBlock({ type: item.ordered ? "ordered-list" : "bullet-list", items: item.children }) : "";
            return `<li>${contentHtml}${nested}</li>`;
        }).join("");
        return `<${tag}>${html}</${tag}>`;
    }

    function renderTable(table) {
        if (!table || !Array.isArray(table.rows)) {
            return "";
        }
        const headers = Array.isArray(table.headers) ? table.headers : [];
        const rows = table.rows.map((row) => row.map((cell) => `<td>${renderInlineContent(cell)}</td>`).join(""));
        const headerCells = headers.length ? `<thead><tr>${headers.map((header) => `<th>${renderInlineContent(header)}</th>`).join("")}</tr></thead>` : "";
        const bodyRows = rows.length ? `<tbody>${rows.map((row) => `<tr>${row}</tr>`).join("")}</tbody>` : "";
        return `<div class="rich-table-wrapper"><table class="rich-table">${headerCells}${bodyRows}</table></div>`;
    }

    function renderImage(image) {
        const src = image && image.src ? image.src : "";
        const alt = image && image.alt ? escapeHtml(String(image.alt)) : "";
        const caption = image && image.caption ? `<figcaption>${renderInlineContent(image.caption)}</figcaption>` : "";
        const credit = image && image.credit ? `<div class="rich-image-credit">${renderInlineContent(image.credit)}</div>` : "";
        const widthStyle = image && image.width ? ` width="${escapeHtml(String(image.width))}"` : "";
        const heightStyle = image && image.height ? ` height="${escapeHtml(String(image.height))}"` : "";
        const alignment = image && image.alignment ? ` style="text-align:${escapeHtml(String(image.alignment))};"` : "";
        const figureClass = image && image.alignment ? ` class="rich-image rich-image-${escapeHtml(String(image.alignment))}"` : ` class="rich-image"`;
        if (!src) {
            return `<figure${figureClass}${alignment}><div class="rich-image-placeholder">Image unavailable</div>${caption}${credit}</figure>`;
        }
        return `<figure${figureClass}${alignment}><img src="${escapeHtml(src)}" alt="${alt}"${widthStyle}${heightStyle} loading="lazy" /><div class="rich-image-meta">${caption}${credit}</div></figure>`;
    }

    function renderFlowchart(flowchart) {
        const nodes = Array.isArray(flowchart && flowchart.nodes) ? flowchart.nodes : [];
        const edges = Array.isArray(flowchart && flowchart.edges) ? flowchart.edges : [];
        const renderedNodes = nodes.map((node, index) => {
            const nodeText = node && node.label ? renderInlineContent(node.label) : "";
            const nodeId = node && node.id ? String(node.id) : `node-${index}`;
            const classes = node && node.type ? ` flowchart-node flowchart-${escapeHtml(String(node.type))}` : "flowchart-node";
            return `<div class="${classes}" data-node-id="${escapeHtml(nodeId)}">${nodeText}</div>`;
        }).join("");
        const renderedEdges = edges.map((edge) => {
            const from = edge && edge.from ? String(edge.from) : "";
            const to = edge && edge.to ? String(edge.to) : "";
            if (!from || !to) return "";
            return `<div class="flowchart-edge" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}">→</div>`;
        }).join("");
        return `<div class="rich-flowchart"><div class="flowchart-nodes">${renderedNodes}</div>${renderedEdges ? `<div class="flowchart-edges">${renderedEdges}</div>` : ""}</div>`;
    }

    function renderCallout(block) {
        const kind = (block && block.kind) || "note";
        const title = block && block.title ? renderInlineContent(block.title) : "Note";
        const contentHtml = block && block.content ? renderInlineContent(block.content) : "";
        return `<div class="rich-callout rich-callout-${escapeHtml(String(kind))}"><strong>${title}</strong><div>${contentHtml}</div></div>`;
    }

    function renderCodeBlock(block) {
        const language = block && block.language ? escapeHtml(String(block.language)) : "";
        const code = block && block.code ? escapeHtml(String(block.code)) : "";
        return `<pre class="rich-code-block"><code${language ? ` class="language-${language}"` : ""}>${code}</code></pre>`;
    }

    function renderSeparator() {
        return "<hr class=\"rich-separator\">";
    }

    function renderBlock(block) {
        if (!block || typeof block !== "object") {
            return "";
        }
        switch (block.type) {
            case "document":
                return ensureArray(block.blocks).map((item) => renderBlock(item)).join("");
            case "heading": {
                const level = Number(block.level) || 2;
                const tag = Math.min(Math.max(level, 1), 6);
                return `<h${tag}>${renderInlineContent(block.content || block.text || "")}</h${tag}>`;
            }
            case "paragraph":
                return `<p>${renderInlineContent(block.content || block.text || "")}</p>`;
            case "quote":
                return `<blockquote>${renderInlineContent(block.content || block.text || "")}</blockquote>`;
            case "bullet-list":
                return renderListItems(block.items || [], false);
            case "ordered-list":
                return renderListItems(block.items || [], true);
            case "table":
                return renderTable(block);
            case "image":
                return renderImage(block);
            case "flowchart":
                return renderFlowchart(block);
            case "callout":
            case "note":
            case "warning":
            case "important":
                return renderCallout(block);
            case "code":
                return renderCodeBlock(block);
            case "separator":
                return renderSeparator();
            case "list-item":
                return `<li>${renderInlineContent(block.content || block.text || "")}</li>`;
            default:
                return `<div>${renderInlineContent(block.content || block.text || "")}</div>`;
        }
    }

    function cleanLegacyText(value) {
        return String(value ?? "").replace(/\r\n/g, "\n").trim();
    }

    function parseListBlock(lines, ordered) {
        const items = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const match = ordered ? /^\d+\.\s*(.+)$/.exec(line) : /^[-*+]\s*(.+)$/.exec(line);
            if (!match) {
                return null;
            }
            items.push({ type: "paragraph", content: match[1] });
        }
        return { type: ordered ? "ordered-list" : "bullet-list", items };
    }

    function parseTableBlock(lines) {
        const rows = lines.map((line) => line.split("|").map((part) => part.trim()).filter((part) => part.length > 0));
        if (rows.length < 2) return null;
        const headers = rows[0];
        const bodyRows = rows.slice(1).filter((row) => row.length >= headers.length || row.length >= 1);
        if (!headers.length || !bodyRows.length) return null;
        return { type: "table", headers, rows: bodyRows }
    }

    function normalizeDocumentContent(raw) {
        const text = cleanLegacyText(raw);
        if (!text) {
            return { type: "document", blocks: [] };
        }
        if (Array.isArray(raw)) {
            return {
                type: "document",
                blocks: raw.map((item) => (typeof item === "string" ? { type: "paragraph", content: item } : normalizeDocumentContent(item)))
            };
        }
        if (isPlainObject(raw)) {
            if (raw.type === "document" && Array.isArray(raw.blocks)) {
                return raw;
            }
            if (raw.type && raw.type !== "document") {
                return { type: "document", blocks: [raw] };
            }
            if (raw.explanationDocument && raw.explanationDocument.type === "document") {
                return raw.explanationDocument;
            }
            if (raw.explanation && typeof raw.explanation !== "undefined") {
                return normalizeDocumentContent(raw.explanation);
            }
            if (raw.blocks && Array.isArray(raw.blocks)) {
                return { type: "document", blocks: raw.blocks };
            }
        }

        const lines = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
        if (!lines.length) {
            return { type: "document", blocks: [] };
        }

        const blocks = [];
        for (const block of lines) {
            const blockLines = block.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
            if (!blockLines.length) continue;
            if (blockLines[0].startsWith("#")) {
                const level = blockLines[0].match(/^#+/)[0].length || 2;
                const content = blockLines[0].replace(/^#+\s*/, "");
                blocks.push({ type: "heading", level, content });
                continue;
            }
            if (blockLines.every((line) => /^[-*+]\s+/.test(line))) {
                blocks.push({ type: "bullet-list", items: blockLines.map((line) => ({ type: "paragraph", content: line.replace(/^[-*+]\s+/, "") })) });
                continue;
            }
            if (blockLines.every((line) => /^\d+\.\s+/.test(line))) {
                blocks.push({ type: "ordered-list", items: blockLines.map((line) => ({ type: "paragraph", content: line.replace(/^\d+\.\s+/, "") })) });
                continue;
            }
            if (blockLines.every((line) => /^>\s?/.test(line))) {
                blocks.push({ type: "quote", content: blockLines.map((line) => line.replace(/^>\s?/, "")).join("\n") });
                continue;
            }
            if (block.includes("|") && blockLines.length > 1) {
                const tableBlock = parseTableBlock(blockLines);
                if (tableBlock) {
                    blocks.push(tableBlock);
                    continue;
                }
            }
            if (block.includes("```")) {
                blocks.push({ type: "code", code: block.replace(/```.*?\n?/g, "").trim(), language: "text" });
                continue;
            }
            if (/\b(->|=>|↓|→)\b/.test(block)) {
                const nodes = block.split(/\n|\s*(?:->|=>|↓|→)\s*/).map((part) => ({ id: part.trim(), label: part.trim() })).filter((part) => part.label);
                blocks.push({ type: "flowchart", nodes, edges: nodes.slice(0, -1).map((node, index) => ({ from: node.id || `node-${index}`, to: nodes[index + 1].id || `node-${index + 1}` })) });
                continue;
            }
            blocks.push({ type: "paragraph", content: block });
        }

        return { type: "document", blocks };
    }

    function getPlainTextFromExplanation(value) {
        if (!value) return "";
        if (typeof value === "string") return value.trim();
        if (Array.isArray(value)) return value.map((item) => getPlainTextFromExplanation(item)).filter(Boolean).join("");
        if (isPlainObject(value)) {
            if (value.type === "document" && Array.isArray(value.blocks)) {
                return value.blocks.map((block) => getPlainTextFromExplanation(block)).filter(Boolean).join("\n");
            }
            if (value.type === "heading" || value.type === "paragraph" || value.type === "quote" || value.type === "callout") {
                const text = value.content ?? value.text ?? "";
                return (Array.isArray(text) ? text.map((item) => (typeof item === "string" ? item : getPlainTextFromExplanation(item))).join("") : String(text || ""));
            }
            if (value.type === "list-item") {
                const text = value.content ?? value.text ?? "";
                return (Array.isArray(text) ? text.map((item) => (typeof item === "string" ? item : getPlainTextFromExplanation(item))).join("") : String(text || ""));
            }
            if (value.type === "table") {
                const rows = Array.isArray(value.rows) ? value.rows : [];
                return rows.map((row) => row.join(" | ")).join("\n");
            }
            if (value.type === "image") {
                return value.caption || value.alt || "Image";
            }
            if (value.type === "ordered-list" || value.type === "bullet-list") {
                return (value.items || []).map((item, index) => `${index + 1}. ${getPlainTextFromExplanation(item)}`).join("\n");
            }
            if (value.type === "flowchart") {
                return (value.nodes || []).map((node) => node && node.label ? String(node.label) : "").filter(Boolean).join(" → ");
            }
            if (value.type === "code") {
                return String(value.code || value.text || "");
            }
            if (value.type === "text" || value.type === "bold" || value.type === "italic" || value.type === "underline" || value.type === "highlight" || value.type === "strikethrough" || value.type === "link" || value.type === "superscript" || value.type === "subscript") {
                const text = value.text ?? value.content ?? value.label ?? value.href ?? "";
                return Array.isArray(text) ? text.map((item) => (typeof item === "string" ? item : getPlainTextFromExplanation(item))).join("") : String(text || "");
            }
        }
        return String(value || "");
    }

    function normalizeExplanationDocument(value) {
        if (value && typeof value === "object" && value.type === "document" && Array.isArray(value.blocks)) {
            return value;
        }
        if (value && typeof value === "object" && value.explanationDocument) {
            return normalizeExplanationDocument(value.explanationDocument);
        }
        if (value && typeof value === "object" && value.type && value.type !== "document") {
            return { type: "document", blocks: [value] };
        }
        if (value === null || typeof value === "undefined" || value === "") {
            return { type: "document", blocks: [] };
        }
        return normalizeDocumentContent(value);
    }

    function renderExplanationDocument(documentLike, fallbackText) {
        const documentValue = normalizeExplanationDocument(documentLike);
        if (!documentValue || !Array.isArray(documentValue.blocks) || !documentValue.blocks.length) {
            const fallback = fallbackText || getPlainTextFromExplanation(documentLike) || "";
            return fallback ? `<p>${inlineStringToHtml(fallback)}</p>` : "";
        }
        return documentValue.blocks.map((block) => renderBlock(block)).join("");
    }

    const api = {
        escapeHtml,
        normalizeExplanationDocument,
        renderExplanationDocument,
        getPlainTextFromExplanation,
        normalizeDocumentContent,
        renderInlineContent,
        serializeDocumentForEditing
    };

    global.ExplanationRenderer = api;
    global.normalizeExplanationDocument = normalizeExplanationDocument;
    global.renderExplanationDocument = renderExplanationDocument;
    global.getPlainTextFromExplanation = getPlainTextFromExplanation;
    global.serializeDocumentForEditing = serializeDocumentForEditing;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof window !== "undefined" ? window : globalThis);

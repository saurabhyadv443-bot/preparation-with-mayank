(function () {
    const CACHE_KEY = "quiz_online_explanation_cache";
    const endpoint = (window.quizPortalConfig && window.quizPortalConfig.onlineExplanationEndpoint)
        || (window.location.protocol === "http:" && window.location.hostname === "127.0.0.1" && window.location.port === "8000"
            ? "/api/online-explanation"
            : "http://127.0.0.1:8000/api/online-explanation");

    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch (error) { return fallback; }
    }

    function saveJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function questionPayload(question) {
        const options = Array.isArray(question.options) ? question.options.map((option) => String(option)) : [];
        const answerIndex = Number.isInteger(question.answer) ? question.answer : null;
        return {
            question: String(question.q || question.question || ""),
            options,
            officialAnswer: answerIndex !== null && options[answerIndex] !== undefined ? options[answerIndex] : String(question.answer || "")
        };
    }

    async function stableQuestionId(payload) {
        const source = JSON.stringify(payload);
        if (window.crypto && window.crypto.subtle) {
            const bytes = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
            return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        }
        return source;
    }

    async function requestOnlineExplanation(payload) {
        let response;
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: payload.question, options: payload.options, officialAnswer: payload.officialAnswer })
            });
        } catch (error) {
            console.error("Online explanation request could not reach the local backend.", error.name);
            throw new Error("Network/server unavailable. Open the portal at http://127.0.0.1:8000 and try again.");
        }
        let data = {};
        try { data = await response.json(); } catch (error) { /* preserve safe HTTP category below */ }
        if (response.status === 400) throw new Error(data.error || "Invalid online search request.");
        if (response.status === 503) throw new Error(data.error || "Online search is temporarily unavailable.");
        if (!response.ok) throw new Error(data.error || "Unexpected server error.");
        return { explanation: Array.isArray(data.explanation) ? data.explanation : [], sources: Array.isArray(data.sources) ? data.sources : [] };
    }

    function renderReviewState(index, state, message) {
        const panel = document.querySelector(`[data-review-ai-index="${index}"]`);
        if (!panel) return;
        const button = panel.querySelector(".review-ai-button");
        const output = panel.querySelector(".review-ai-output");
        if (state === "loading") {
            button.textContent = "🔎 Searching online...";
            button.disabled = true;
            output.textContent = "";
            return;
        }
        button.disabled = false;
        button.textContent = state === "success" ? "🔎 Online Explanation Found" : state === "empty" ? "No online explanation found" : "🔎 Find Online Explanation";
        output.innerHTML = message || "";
        output.hidden = !message;
    }

    async function reviewQuestion(index, force) {
        const question = window.reviewResultQuestions && window.reviewResultQuestions[index];
        if (!question) return;
        const payload = questionPayload(question);
        const id = await stableQuestionId(payload);
        const cache = readJson(CACHE_KEY, {});
        if (!force && cache[id]) {
            const cached = Array.isArray(cache[id]) ? { explanation: cache[id].map((item) => item.snippet || ""), sources: cache[id] } : cache[id];
            renderReviewState(index, cached.explanation.length ? "success" : "empty", renderOnlineResults(cached));
            return;
        }
        renderReviewState(index, "loading");
        try {
            const results = await requestOnlineExplanation(payload);
            cache[id] = results;
            saveJson(CACHE_KEY, cache);
            renderReviewState(index, results.explanation.length ? "success" : "empty", renderOnlineResults(results));
        } catch (error) {
            renderReviewState(index, "error", `<p>${escapeHtml(error.message || "Online search is temporarily unavailable.")}</p>`);
        }
    }

    function renderOnlineResults(result) {
        if (!result.explanation.length) return "<p>Not enough reliable information was found in the retrieved sources to create an explanation.</p>";
        const points = `<div class="online-explanation-points"><strong>🔎 Online Explanation</strong>${result.explanation.map((point) => `<p>• ${escapeHtml(point)}</p>`).join("")}</div>`;
        const sources = result.sources.length ? `<div class="online-explanation-sources"><strong>Sources</strong>${result.sources.map((item, index) => `<p><strong>Source ${index + 1}:</strong> ${escapeHtml(item.title || item.site || "Online source")}<br><small>${escapeHtml(item.site || "")}</small>${item.snippet ? `<br><small>${escapeHtml(item.snippet)}</small>` : ""}<br><a href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">Open Source ↗</a></p>`).join("")}</div>` : "";
        return points + sources;
    }

    function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

    window.reviewAiPanelHtml = (index) => `<div class="review-ai-panel" data-review-ai-index="${index}"><button type="button" class="btn btn-tertiary btn-small review-ai-button">🔎 Find Online Explanation</button><div class="review-ai-output" hidden></div></div>`;
    window.bindReviewAiControls = () => {
        document.querySelectorAll(".review-ai-panel").forEach((panel) => {
            const index = Number(panel.dataset.reviewAiIndex);
            panel.querySelector(".review-ai-button").onclick = () => reviewQuestion(index, false);
        });
    };
})();

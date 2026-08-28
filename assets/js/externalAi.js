function externalAiContext(question, index) {
    return {
        question: question.q || "Not provided",
        options: Array.isArray(question.options) ? question.options : []
    };
}

function buildExternalAiPrompt(index, serviceName) {
    const context = externalAiContext(result.questions[index], index);
    const options = context.options.length
        ? context.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n")
        : "Not provided";
    return `Question:
${context.question}

Options:
${options}`;
}

function showExternalAiNotice(message) {
    const notice = document.createElement("div");
    notice.className = "external-ai-notice";
    notice.textContent = message;
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3500);
}

function showExternalAiPrompt(prompt) {
    const overlay = document.createElement("div");
    overlay.className = "external-ai-prompt-overlay";
    overlay.innerHTML = `<div class="external-ai-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="externalAiPromptTitle"><h3 id="externalAiPromptTitle">Copy Prompt Manually</h3><p>Clipboard access was unavailable. Please copy the prompt manually.</p><textarea class="external-ai-prompt-text" rows="14" readonly></textarea><div class="external-ai-prompt-actions"><button type="button" class="btn btn-primary btn-small external-ai-copy-manual">Select Prompt</button><button type="button" class="btn btn-tertiary btn-small external-ai-close-prompt">Close</button></div></div>`;
    const textarea = overlay.querySelector(".external-ai-prompt-text");
    textarea.value = prompt;
    overlay.querySelector(".external-ai-copy-manual").onclick = () => {
        textarea.focus();
        textarea.select();
    };
    overlay.querySelector(".external-ai-close-prompt").onclick = () => overlay.remove();
    overlay.onclick = (event) => {
        if (event.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
    textarea.focus();
    textarea.select();
}

async function askExternalAi(index, serviceName, website) {
    const prompt = buildExternalAiPrompt(index, serviceName);
    try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
            throw new Error("Clipboard API unavailable");
        }
        await navigator.clipboard.writeText(prompt);
        window.open(website, "_blank", "noopener,noreferrer");
        showExternalAiNotice(`Prompt copied. Paste it into ${serviceName}.`);
    } catch (error) {
        window.open(website, "_blank", "noopener,noreferrer");
        showExternalAiPrompt(prompt);
    }
}

function externalAiPanelHtml(index) {
    return `<details class="ai-research-panel external-ai-panel"><summary>External AI</summary><div class="ai-research-actions"><button type="button" class="btn btn-tertiary btn-small" onclick="askExternalAi(${index}, 'Gemini', 'https://gemini.google.com/')">Ask Gemini</button><button type="button" class="btn btn-tertiary btn-small" onclick="askExternalAi(${index}, 'ChatGPT', 'https://chatgpt.com/')">Ask ChatGPT</button></div></details>`;
}

function buildQuestionCopyText(question) {
    const questionText = question && question.q ? String(question.q) : "";
    const options = Array.isArray(question && question.options) ? question.options : [];

    const lines = [
        "Question:",
        questionText,
        "",
        "Options:"
    ];

    options.forEach((option, optionIndex) => {
        const label = String.fromCharCode(65 + optionIndex);
        lines.push(`${label}. ${String(option)}`);
    });

    return lines.join("\n");
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    helper.style.pointerEvents = "none";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    document.execCommand("copy");
    helper.remove();
}

async function copyQuestionOptionsByIndex(index) {
    const question = window.reviewResultQuestions && Array.isArray(window.reviewResultQuestions)
        ? window.reviewResultQuestions[index]
        : null;

    if (!question) {
        return;
    }

    const text = buildQuestionCopyText(question);
    try {
        await copyTextToClipboard(text);
        const button = document.querySelector(`[data-copy-question-index="${index}"]`);
        if (button) {
            const originalText = button.textContent;
            button.textContent = "Question + options copied";
            window.setTimeout(() => {
                button.textContent = "Copy Question + Options";
            }, 2200);
        }
    } catch (error) {
        const button = document.querySelector(`[data-copy-question-index="${index}"]`);
        if (button) {
            button.textContent = "Copy failed";
            window.setTimeout(() => {
                button.textContent = "Copy Question + Options";
            }, 2200);
        }
    }
}

function copyQuestionOptionsButtonHtml(index) {
    return `<button type="button" class="btn btn-secondary btn-small" data-copy-question-index="${index}" onclick="copyQuestionOptionsByIndex(${index})">Copy Question + Options</button>`;
}

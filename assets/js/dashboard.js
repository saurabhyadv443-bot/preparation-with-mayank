const dashboardSubjects = {
    ancient: {
        icon: "📚",
        title: "Ancient History",
        description: "Ancient India complete practice questions"
    },
    medeival: {
        icon: "🏰",
        title: "Medieval History",
        description: "Practice medieval and modern India"
    },
    // alias using corrected id to match manifest
    medieval: {
        icon: "🏰",
        title: "Medieval History",
        description: "Practice medieval and modern India"
    },
    modern: {
        icon: "🏛",
        title: "Modern History",
        description: "Chapter-wise modern history practice"
    },
    geography: {
        icon: "🌍",
        title: "Geography",
        description: "Geography practice and map-based questions"
    },
    polity: {
        icon: "🏛",
        title: "Polity",
        description: "Constitution, governance and polity practice"
    },
    economy: {
        icon: "💰",
        title: "Economy",
        description: "Economy and public finance practice"
    },
    current_affairs: {
        icon: "📰",
        title: "Current Affairs",
        description: "Daily and monthly current affairs questions"
    }
};

function getSubjectSlugFromFilename(filename) {
    return filename.replace(/\.json$/i, "");
}

function getSubjectTitle(subjectKey) {
    if (dashboardSubjects[subjectKey]) {
        return dashboardSubjects[subjectKey].title;
    }

    const words = subjectKey
        .replace(/[-_]+/g, " ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

    return words.join(" ");
}

function getSubjectDescription(subjectKey) {
    return dashboardSubjects[subjectKey]?.description || "Practice questions for this subject";
}

function getSubjectIcon(subjectKey) {
    return dashboardSubjects[subjectKey]?.icon || "📘";
}

async function fetchSubjectManifest() {
    try {
        const response = await fetch("data/subjects.json");
        if (!response.ok) throw new Error("Subject manifest not found");
        const json = await response.json();
        if (!json || !Array.isArray(json.subjects)) throw new Error("Invalid manifest format");
        return json.subjects;
    } catch (error) {
        return null;
    }
}

function orderSubjectKeys(keys, preferredOrder = ["ancient", "medieval", "modern", "geography", "polity", "economy"]) {
    return [...new Set(keys)]
        .filter((key) => key.toLowerCase() !== "mock")
        .sort((a, b) => {
            const indexA = preferredOrder.indexOf(a);
            const indexB = preferredOrder.indexOf(b);
            if (indexA !== -1 || indexB !== -1) {
                return (indexA !== -1 ? indexA : Number.MAX_SAFE_INTEGER) - (indexB !== -1 ? indexB : Number.MAX_SAFE_INTEGER);
            }
            return a.localeCompare(b);
        });
}

function displayDashboardSubjects(subjects, subjectMeta) {
    const subjectsContainer = document.getElementById("subjects");
    if (!subjectsContainer) {
        return;
    }

    const actionCards = Array.from(subjectsContainer.querySelectorAll(".dashboard-action-card"));
    subjectsContainer.innerHTML = "";
    actionCards.forEach((card) => subjectsContainer.appendChild(card));

    const currentAffairsCard = {
        id: "current_affairs",
        title: "Current Affairs",
        description: "Daily and monthly current affairs questions",
        icon: "📰"
    };

    const mergedSubjects = [...new Set([...subjects, "current_affairs"])];

    mergedSubjects.forEach((subjectKey) => {
        if (subjectKey === "mock") {
            return;
        }

        const meta = subjectKey === "current_affairs" ? currentAffairsCard : (subjectMeta && subjectMeta[subjectKey]);
        const title = meta ? meta.title : getSubjectTitle(subjectKey);
        const description = meta ? meta.description : getSubjectDescription(subjectKey);
        const icon = meta ? meta.icon : getSubjectIcon(subjectKey);

        const card = document.createElement("article");
        card.className = "dashboard-card";
        const cardTarget = subjectKey === "current_affairs" ? `subject.html?subject=${encodeURIComponent(subjectKey)}` : `subject.html?subject=${encodeURIComponent(subjectKey)}`;
        const cardLabel = subjectKey === "current_affairs" ? "Open CA Home" : "Open Subject";

        card.innerHTML = `
            <div class="card-icon">${icon}</div>
            <h2>${title}</h2>
            <p>${description}</p>
            <a href="${cardTarget}" class="btn btn-primary btn-small">${cardLabel}</a>
        `;
        subjectsContainer.appendChild(card);
    });
}

function buildCurrentAffairsSubjectCollection() {
    const classifications = JSON.parse(localStorage.getItem("questionClassifications") || "{}");
    const entries = Object.values(classifications).filter((entry) => entry && entry.CA === true);
    return entries.reduce((acc, entry) => {
        const subjectKey = String(entry.subjectKey || entry.subject || "unknown");
        const chapter = String(entry.chapter || "Current Affairs");
        if (!acc[subjectKey]) {
            acc[subjectKey] = {};
        }
        if (!acc[subjectKey][chapter]) {
            acc[subjectKey][chapter] = [];
        }
        const question = entry.question;
        if (question) {
            acc[subjectKey][chapter].push(question);
        }
        return acc;
    }, {});
}

function readCompletedAttempts() {
    try {
        const history = JSON.parse(localStorage.getItem("quiz_attempt_history") || "{}");
        const attempts = Object.values(history || {})
            .filter((records) => Array.isArray(records))
            .flat()
            .filter((attempt) => attempt && Number(attempt.total) > 0 && attempt.completedAt && !Number.isNaN(new Date(attempt.completedAt).getTime()))
            .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
        const latestBySection = new Map();
        attempts.forEach((attempt) => {
            const sectionKey = `${attempt.subjectKey || attempt.subject || ""}::${attempt.chapter || ""}`;
            const existing = latestBySection.get(sectionKey);
            if (existing) {
                existing.attemptCount += 1;
            } else {
                latestBySection.set(sectionKey, { attempt, attemptCount: 1 });
            }
        });
        return [...latestBySection.values()].slice(0, 50);
    } catch (error) {
        return [];
    }
}

function escapeProgressHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderProgress() {
    const progressList = document.getElementById("progressList");
    if (!progressList) return;

    const attempts = readCompletedAttempts();
    if (!attempts.length) return;

    progressList.innerHTML = `
        <table class="progress-table">
            <thead>
                <tr>
                    <th scope="col">#</th>
                    <th scope="col">Test / Section</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Total</th>
                    <th scope="col">Correct</th>
                    <th scope="col">Incorrect</th>
                    <th scope="col">Skipped</th>
                    <th scope="col">Marks</th>
                    <th scope="col">%</th>
                </tr>
            </thead>
            <tbody>
                ${attempts.map(({ attempt, attemptCount }, index) => `
                    ${(() => {
                        const rawPercentage = Number(attempt.percentage ?? attempt.accuracy ?? 0);
                        const percentage = Number.isFinite(rawPercentage) ? rawPercentage : 0;
                        const rawMarks = Number(attempt.finalScore ?? attempt.score ?? 0);
                        const marks = Number.isFinite(rawMarks) ? rawMarks : 0;
                        const percentageClass = percentage >= 70 ? "high" : percentage >= 40 ? "medium" : "low";
                        return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${escapeProgressHtml(attempt.subject || attempt.subjectKey)} - ${escapeProgressHtml(attempt.chapter || "-")}</td>
                        <td>${attemptCount}</td>
                        <td>${attempt.total || 0}</td>
                        <td><span class="progress-value progress-correct">${attempt.correct || 0}</span></td>
                        <td><span class="progress-value progress-incorrect">${attempt.wrong || attempt.incorrect || 0}</span></td>
                        <td><span class="progress-value progress-skipped">${attempt.skipped || attempt.unanswered || 0}</span></td>
                        <td><span class="progress-value progress-marks">${marks.toFixed(2)}</span></td>
                        <td><span class="progress-value progress-percent ${percentageClass}">${percentage.toFixed(2)}%</span></td>
                    </tr>
                        `;
                    })()}
                `).join("")}
            </tbody>
        </table>
    `;
}

function openProgress() {
    const subjectsContainer = document.getElementById("subjects");
    const progressView = document.getElementById("progressView");
    if (!subjectsContainer || !progressView) return;
    renderProgress();
    subjectsContainer.hidden = true;
    progressView.hidden = false;
}

function closeProgress() {
    const subjectsContainer = document.getElementById("subjects");
    const progressView = document.getElementById("progressView");
    if (!subjectsContainer || !progressView) return;
    progressView.hidden = true;
    subjectsContainer.hidden = false;
}

function formatPendingBatchDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function renderPendingBatchHistory() {
    const list = document.getElementById("pendingBatchList");
    if (!list || typeof getQuizPendingBatches !== "function") return;
    const batches = getQuizPendingBatches()
        .filter((batch) => batch.status !== "synced" || batch.syncedAt)
        .sort((left, right) => Number(right.batchId) - Number(left.batchId));
    list.innerHTML = batches.length
        ? batches.map((batch) => {
            const status = batch.status === "synced" ? "Synced" : "Downloaded, awaiting sync";
            const statusIcon = batch.status === "synced" ? "✅" : "⏳";
            return `<div class="pending-batch-row">
                <span>Batch ${escapeHtml(batch.batchId)} — ${escapeHtml(formatPendingBatchDate(batch.downloadedAt))} — ${status} ${statusIcon}</span>
                <button type="button" class="pending-batch-download" data-batch-id="${escapeHtml(batch.batchId)}" aria-label="Download Batch ${escapeHtml(batch.batchId)} again" title="Download Batch ${escapeHtml(batch.batchId)} again">↓</button>
            </div>`;
        }).join("")
        : `<p class="pending-batches-empty">No downloaded batches yet.</p>`;
    list.querySelectorAll(".pending-batch-download").forEach((button) => {
        button.addEventListener("click", () => exportQuizPendingBatch(button.dataset.batchId));
    });
}

function loadDashboardSubjects() {
    return Promise.resolve().then(async () => {
        const manifest = await fetchSubjectManifest();
        if (!manifest) {
            // If manifest missing, fallback to keys present in `dashboardSubjects` object
            const fallbackKeys = Object.keys(dashboardSubjects);
            displayDashboardSubjects(orderSubjectKeys(fallbackKeys), null);
            return;
        }

        const subjectMeta = {};
        manifest.forEach((s) => {
            subjectMeta[s.id] = { title: s.title, description: s.description, icon: s.icon, file: s.file };
        });

        const subjectKeys = orderSubjectKeys(manifest.map((s) => s.id));
        displayDashboardSubjects(subjectKeys, subjectMeta);
    });
}

window.addEventListener("DOMContentLoaded", loadDashboardSubjects);
window.addEventListener("DOMContentLoaded", renderPendingBatchHistory);
window.addEventListener("quizPendingBatchesChanged", renderPendingBatchHistory);

document.getElementById("progressBtn")?.addEventListener("click", openProgress);
document.getElementById("progressBackBtn")?.addEventListener("click", closeProgress);
document.getElementById("downloadAllChangesBtn")?.addEventListener("click", exportQuizPendingChanges);

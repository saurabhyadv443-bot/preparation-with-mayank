/* Performance Dashboard Enhancement
   - Appends the most recent `quizResult` to a persistent `quizResults` history
   - Renders aggregated metrics, charts, recent tests, export and reset features
*/

const rawResult = localStorage.getItem("quizResult");
const latestResult = rawResult ? JSON.parse(rawResult) : null;
const historyKey = "quizResults";

function safeParse(jsonString, fallback = null) {
    try {
        return jsonString ? JSON.parse(jsonString) : fallback;
    } catch (e) {
        return fallback;
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function readHistory() {
    return safeParse(localStorage.getItem(historyKey), []) || [];
}

function saveHistory(history) {
    try {
        localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (e) {
        console.error("Failed to save history", e);
    }
}

function summariseResult(r) {
    return {
        subjectKey: r.subjectKey || (r.subject || "unknown").toString().toLowerCase(),
        subject: r.subject || "Unknown",
        chapter: r.chapter || "",
        total: Number(r.total || 0),
        correct: Number(r.correct || 0),
        wrong: Number(r.wrong || 0),
        skipped: Number(r.skipped || 0),
        attempted: Number(r.attempted || (Number(r.total || 0) - Number(r.skipped || 0))),
        accuracy: Number(r.accuracy || 0),
        finalScore: Number(r.finalScore || r.score || 0),
        timeTaken: Number(r.timeTaken || 0),
        completedAt: r.completedAt || new Date().toISOString()
    };
}

function appendLatestToHistory() {
    if (!latestResult) return;
    const history = readHistory();
    const summary = summariseResult(latestResult);
    const last = history[history.length - 1];
    if (!last || last.completedAt !== summary.completedAt || last.subjectKey !== summary.subjectKey) {
        history.push(summary);
        // Keep reasonable cap
        if (history.length > 500) history.shift();
        saveHistory(history);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// Rendering: existing single-result rendering preserved below
const explanationList = document.getElementById("explanationList");

function renderSingleResult(result) {
    if (!result) return;
    document.getElementById("subject").innerHTML = result.subject || "Unknown Subject";
    document.getElementById("chapter").innerHTML = result.chapter || "Unknown Chapter";
    document.getElementById("correct").innerHTML = result.correct || 0;
    document.getElementById("wrong").innerHTML = result.wrong || 0;
    document.getElementById("skipped").innerHTML = result.skipped || 0;
    document.getElementById("total").innerHTML = result.total || 0;
    document.getElementById("score").innerHTML = `${result.accuracy || 0}%`;

    const retryBtn = document.getElementById("retryBtn");
    if (retryBtn) {
        retryBtn.href = `quiz.html?subject=${encodeURIComponent(result.subjectKey || result.subject)}`;
        retryBtn.onclick = function (event) {
            event.preventDefault();
            window.location.href = `quiz.html?subject=${encodeURIComponent(result.subjectKey || result.subject)}`;
        };
    }

    const reviewBtn = document.getElementById("reviewBtn");
    if (reviewBtn) reviewBtn.onclick = function () { window.location.href = "review.html"; };

    if (explanationList && Array.isArray(result.questions)) {
        explanationList.innerHTML = "";
        result.questions.forEach((question, index) => {
            const explanation = question.explanation;
            const explanationText = explanation && String(explanation).trim();
            const card = document.createElement("div");
            card.className = "review-item";
            card.innerHTML = `
                <h3>Q${index + 1}. ${escapeHtml(question.q)}</h3>
                <div class="explanation-box${explanationText ? "" : " missing"}">
                    <strong>Explanation:</strong> ${explanationText ? escapeHtml(explanationText) : "Explanation is currently unavailable for this question."}
                </div>
            `;
            explanationList.appendChild(card);
        });
    } else if (explanationList) {
        explanationList.innerHTML = `<div class="explanation-box missing">Explanation is currently unavailable for this question.</div>`;
    }
}

// Performance dashboard rendering
let charts = {};

function computeAggregates(history) {
    const agg = {
        totalTests: history.length,
        totalSolved: 0,
        correct: 0,
        wrong: 0,
        skipped: 0,
        averageScore: 0,
        averageTime: 0,
        subjectStats: {},
        chapterStats: {}
    };

    history.forEach((r) => {
        agg.totalSolved += r.attempted || 0;
        agg.correct += r.correct || 0;
        agg.wrong += r.wrong || 0;
        agg.skipped += r.skipped || 0;
        agg.averageScore += r.finalScore || 0;
        agg.averageTime += r.timeTaken || 0;

        const sk = r.subjectKey || r.subject;
        if (!agg.subjectStats[sk]) agg.subjectStats[sk] = { subject: r.subject || sk, correct: 0, total: 0 };
        agg.subjectStats[sk].correct += r.correct || 0;
        agg.subjectStats[sk].total += r.total || 0;

        const chapterKey = `${sk}||${r.chapter || 'unknown'}`;
        if (!agg.chapterStats[chapterKey]) agg.chapterStats[chapterKey] = { subject: r.subject || sk, chapter: r.chapter || 'unknown', correct: 0, total: 0 };
        agg.chapterStats[chapterKey].correct += r.correct || 0;
        agg.chapterStats[chapterKey].total += r.total || 0;
    });

    if (history.length) {
        agg.averageScore = Math.round((agg.averageScore / history.length) * 100) / 100;
        agg.averageTime = Math.round((agg.averageTime / history.length));
    }

    agg.accuracyPercent = agg.totalSolved ? Math.round((agg.correct / (agg.totalSolved || 1)) * 10000) / 100 : 0;

    // strongest and weakest subjects
    const subjects = Object.keys(agg.subjectStats).map((k) => {
        const s = agg.subjectStats[k];
        return { key: k, subject: s.subject, accuracy: s.total ? (s.correct / s.total) * 100 : 0 };
    });
    subjects.sort((a, b) => b.accuracy - a.accuracy);
    agg.strongest = subjects[0] || null;
    agg.weakest = subjects[subjects.length - 1] || null;

    return agg;
}

function renderPerformance(history) {
    const container = document.getElementById("performanceDashboard");
    if (!container) return;

    const aggregates = computeAggregates(history);
    document.getElementById("totalTests").innerText = aggregates.totalTests;
    document.getElementById("totalSolved").innerText = aggregates.totalSolved;
    document.getElementById("totalCorrect").innerText = aggregates.correct;
    document.getElementById("totalWrong").innerText = aggregates.wrong;
    document.getElementById("totalSkipped").innerText = aggregates.skipped;
    document.getElementById("accuracyPercent").innerText = `${aggregates.accuracyPercent}%`;

    // Accuracy over time
    const accuracyLabels = history.map((h) => new Date(h.completedAt).toLocaleString());
    const accuracyData = history.map((h) => h.accuracy || 0);
    const subjectKeys = Object.keys(aggregates.subjectStats);
    const subjectLabels = subjectKeys.map((k) => aggregates.subjectStats[k].subject || k);
    const subjectAccuracies = subjectKeys.map((k) => aggregates.subjectStats[k].total ? Math.round((aggregates.subjectStats[k].correct / aggregates.subjectStats[k].total) * 10000) / 100 : 0);

    // destroy existing charts
    Object.values(charts).forEach((c) => c && c.destroy && c.destroy());
    charts = {};

    const lineCtx = document.getElementById("accuracyLine").getContext("2d");
    charts.accuracy = new Chart(lineCtx, {
        type: "line",
        data: { labels: accuracyLabels, datasets: [{ label: "Accuracy %", data: accuracyData, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,0.1)", fill: true }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const barCtx = document.getElementById("subjectBar").getContext("2d");
    charts.subject = new Chart(barCtx, {
        type: "bar",
        data: { labels: subjectLabels, datasets: [{ label: "Accuracy %", data: subjectAccuracies, backgroundColor: "#1d4ed8" }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const pieCtx = document.getElementById("overallPie").getContext("2d");
    charts.pie = new Chart(pieCtx, {
        type: "pie",
        data: { labels: ["Correct", "Incorrect", "Skipped"], datasets: [{ data: [aggregates.correct, aggregates.wrong, aggregates.skipped], backgroundColor: ["#10b981", "#ef4444", "#f59e0b"] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    renderRecentTests(history.slice(-10).reverse());
}

function renderRecentTests(list) {
    const container = document.getElementById("recentTestsList");
    if (!container) return;
    container.innerHTML = "";
    if (!list.length) {
        container.innerHTML = "<p>No recent tests available.</p>";
        return;
    }

    list.forEach((item) => {
        const el = document.createElement("div");
        el.className = "recent-test";
        el.innerHTML = `
            <div class="metric-row"><span>${escapeHtml(item.subject || item.subjectKey)} - ${escapeHtml(item.chapter || "-")}</span>
            <strong>${item.accuracy}%</strong></div>
            <div class="metric-row"><span>${new Date(item.completedAt).toLocaleString()}</span><strong>${formatTime(item.timeTaken)}</strong></div>
        `;
        container.appendChild(el);
    });
}

function exportCsv(history) {
    const header = ["completedAt","subjectKey","subject","chapter","total","attempted","correct","wrong","skipped","accuracy","timeTaken","finalScore"];
    const rows = history.map((h) => header.map((k) => (h[k] != null ? String(h[k]) : "")).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "performance_history.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function exportPdf(history) {
    try {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            alert("PDF export requires jsPDF to be available.");
            return;
        }
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        doc.setFontSize(14);
        doc.text("Performance Summary", 40, 40);
        const aggregates = computeAggregates(history);
        doc.setFontSize(11);
        doc.text(`Total Tests: ${aggregates.totalTests}`, 40, 70);
        doc.text(`Accuracy: ${aggregates.accuracyPercent}%`, 40, 90);
        doc.text(`Average Score: ${aggregates.averageScore}`, 40, 110);
        // add charts as images
        const chartCanvases = ["accuracyLine","subjectBar","overallPie"].map(id => document.getElementById(id));
        let y = 140;
        for (const c of chartCanvases) {
            try {
                const dataUrl = c.toDataURL('image/png');
                doc.addImage(dataUrl, 'PNG', 40, y, 500, 160);
                y += 170;
            } catch (e) {
                // ignore
            }
        }
        doc.save('performance_summary.pdf');
    } catch (e) {
        console.error(e);
        alert('PDF export failed');
    }
}

function resetStatistics() {
    if (!confirm('Reset stored performance statistics? This cannot be undone.')) return;
    localStorage.removeItem(historyKey);
    renderPerformance([]);
}

// Initialize view logic
appendLatestToHistory();
const history = readHistory();

// If there is no latestResult (navigated from Dashboard), show performance view
const perfContainer = document.getElementById('performanceDashboard');
const singleResultPresent = !!latestResult;
if (!singleResultPresent && perfContainer) {
    perfContainer.style.display = 'block';
    renderPerformance(history);
} else {
    // render single result as before and wire 'View Performance' button
    renderSingleResult(latestResult);
    const viewPerfBtn = document.getElementById('viewLatestResultBtn');
    if (viewPerfBtn) {
        viewPerfBtn.onclick = function () {
            document.querySelector('.result-shell').scrollIntoView({ behavior: 'smooth' });
            if (perfContainer) {
                perfContainer.style.display = perfContainer.style.display === 'block' ? 'none' : 'block';
                if (perfContainer.style.display === 'block') renderPerformance(history);
            }
        };
    }
}

// Wire export/reset buttons
const resetBtn = document.getElementById('resetStatsBtn');
if (resetBtn) resetBtn.onclick = resetStatistics;
const exportCsvBtn = document.getElementById('exportCsvBtn');
if (exportCsvBtn) exportCsvBtn.onclick = function () { exportCsv(readHistory()); };
const exportPdfBtn = document.getElementById('exportPdfBtn');
if (exportPdfBtn) exportPdfBtn.onclick = function () { exportPdf(readHistory()); };

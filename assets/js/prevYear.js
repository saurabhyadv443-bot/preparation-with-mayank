function parseJsonFilenamesFromDirectoryIndex(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a[href$='.json']"));
    return anchors
        .map((anchor) => anchor.getAttribute("href"))
        .filter(Boolean)
        .map((href) => href.trim().replace(/.*\//, ""));
}

async function fetchDataFilenames() {
    try {
        const resp = await fetch('data/subjects.json');
        if (!resp.ok) return [];
        const j = await resp.json();
        if (!j || !Array.isArray(j.subjects)) return [];
        return j.subjects.map(s => s.file).filter(f => f && f.toLowerCase() !== 'mock.json');
    } catch (e) {
        return [];
    }
}

async function loadAllData(files) {
    const all = [];
    await Promise.all(files.map(async (file) => {
        try {
            const r = await fetch(`data/${file}`);
            if (!r.ok) return;
            const j = await r.json();
            all.push({ file, json: j });
        } catch (e) {
            // skip
        }
    }));
    return all;
}

function collectMetadata(allData) {
    const subjects = new Set();
    const chapters = new Set();
    const years = new Set();
    const sources = new Set();

    const questionsIndex = [];

    allData.forEach(({ file, json }) => {
        const subjectKey = file.replace(/\.json$/i, '');
        const subjectName = json.subject || subjectKey;
        Object.keys(json.chapters || {}).forEach((chapter) => {
            const qs = Array.isArray(json.chapters[chapter]) ? json.chapters[chapter] : [];
            qs.forEach((q, idx) => {
                const year = q.year || q.y || null;
                const difficulty = (q.difficulty || q.level || '').toString().toLowerCase();
                const source = q.source || q.paper || '';
                subjects.add(subjectName);
                chapters.add(chapter);
                if (year) years.add(String(year));
                if (source) sources.add(source);
                questionsIndex.push({ subjectKey, subjectName, chapter, index: idx, question: q, year, difficulty, source });
            });
        });
    });

    return { subjects: Array.from(subjects).sort(), chapters: Array.from(chapters).sort(), years: Array.from(years).sort((a,b)=>b-a), sources: Array.from(sources).sort(), questionsIndex };
}

function populateFilters(meta) {
    const sel = (id, items) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.innerHTML = '<option value="">All</option>' + items.map(i => `<option value="${i}">${i}</option>`).join('');
    };
    sel('filterSubject', meta.subjects);
    sel('filterChapter', meta.chapters);
    sel('filterYear', meta.years);
    sel('filterSource', meta.sources);
}

function matchesFilters(item, filters, searchTerm) {
    if (filters.subject && item.subjectName !== filters.subject) return false;
    if (filters.chapter && item.chapter !== filters.chapter) return false;
    if (filters.year && String(item.year) !== String(filters.year)) return false;
    if (filters.difficulty && String(item.difficulty) !== String(filters.difficulty)) return false;
    if (filters.source && item.source !== filters.source) return false;
    if (searchTerm) {
        const t = searchTerm.toLowerCase();
        const qtext = (item.question.q || '').toString().toLowerCase();
        if (!qtext.includes(t)) return false;
    }
    return true;
}

function renderMatches(list) {
    const container = document.getElementById('matchesList');
    container.innerHTML = '';
    if (!list.length) { container.innerHTML = '<p>No matching questions found.</p>'; return; }
    list.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'review-item';
        const q = item.question.q || ''; 
        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>Q${i+1}</strong>
                <div>
                </div>
            </div>
            <p>${escapeHtml(q)}</p>
            <div class="metric-row"><span>${escapeHtml(item.subjectName)}</span><strong>${escapeHtml(item.chapter)}</strong></div>
        `;
        container.appendChild(div);
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildFilterFromUi() {
    return {
        subject: document.getElementById('filterSubject').value || null,
        chapter: document.getElementById('filterChapter').value || null,
        year: document.getElementById('filterYear').value || null,
        difficulty: document.getElementById('filterDifficulty').value || null,
        source: document.getElementById('filterSource').value || null
    };
}

function applyFiltersToIndex(index) {
    const filters = buildFilterFromUi();
    const searchTerm = (document.getElementById('filterSearch').value || '').trim();
    return index.filter(item => matchesFilters(item, filters, searchTerm));
}

function preparePyqParam(filters, ids) {
    // encode filters and matched question identifiers (subjectKey, chapter, index) so quizEngine can fetch
    const payload = { filters, ids };
    return btoa(JSON.stringify(payload));
}

function buildIdsFromMatches(matches) {
    // group by subjectKey and chapter: { subjectKey: { chapter: [indices] } }
    const ids = {};
    matches.forEach(m => {
        ids[m.subjectKey] = ids[m.subjectKey] || {};
        ids[m.subjectKey][m.chapter] = ids[m.subjectKey][m.chapter] || [];
        ids[m.subjectKey][m.chapter].push(m.index);
    });
    return ids;
}

document.addEventListener('DOMContentLoaded', async () => {
    const files = await fetchDataFilenames();
    const allData = await loadAllData(files);
    const meta = collectMetadata(allData);
    populateFilters(meta);

    const applyBtn = document.getElementById('applyFilters');
    const practiceBtn = document.getElementById('practiceFiltered');
    const randomBtn = document.getElementById('randomPractice');
    const reviewBtn = document.getElementById('reviewMode');

    let currentIndex = meta.questionsIndex;

    applyBtn.onclick = () => {
        const matched = applyFiltersToIndex(currentIndex);
        renderMatches(matched);
        // store matches on window for quick practice
        window.__pyq_matches = matched;
    };

    practiceBtn.onclick = () => {
        const matched = window.__pyq_matches || applyFiltersToIndex(currentIndex);
        if (!matched.length) { alert('No questions selected'); return; }
        const ids = buildIdsFromMatches(matched);
        const param = preparePyqParam({}, ids);
        window.location.href = `quiz.html?subject=pyq&pyq=${encodeURIComponent(param)}`;
    };

    randomBtn.onclick = () => {
        // pick 25 random questions from index
        const shuffled = currentIndex.slice().sort(() => Math.random()-0.5).slice(0,25);
        const ids = buildIdsFromMatches(shuffled);
        const param = preparePyqParam({ random: true }, ids);
        window.location.href = `quiz.html?subject=pyq&pyq=${encodeURIComponent(param)}`;
    };

    reviewBtn.onclick = () => {
        const matched = window.__pyq_matches || applyFiltersToIndex(currentIndex);
        if (!matched.length) { alert('No questions selected'); return; }
        const ids = buildIdsFromMatches(matched);
        const param = preparePyqParam({ review: true }, ids);
        window.location.href = `quiz.html?subject=pyq&mode=study&pyq=${encodeURIComponent(param)}`;
    };

    // initial apply to show some content
    applyBtn.click();
});

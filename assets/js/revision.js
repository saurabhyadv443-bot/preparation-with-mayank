(async function(){
    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function safeParse(v, fallback){ try { return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } }

    // read manifest
    async function readManifest(){
        try{ const r = await fetch('data/subjects.json'); if(!r.ok) return null; const j = await r.json(); return j && Array.isArray(j.subjects) ? j.subjects : null; } catch(e){ return null; }
    }

    // read bookmarks and history
    const bookmarks = safeParse(localStorage.getItem('bookmarks'), []);
    const latestResult = safeParse(localStorage.getItem('quizResult'), null);
    const history = safeParse(localStorage.getItem('quizResults'), []) || [];

    const manifest = await readManifest();
    const subjectMap = {};
    (manifest || []).forEach(s=> subjectMap[s.id]=s);

    // helpers to fetch a chapter's questions
    async function fetchChapterQuestions(subjectId, chapterName, limit){
        const sub = subjectMap[subjectId];
        const file = sub ? sub.file : `${subjectId}.json`;
        try{
            const r = await fetch(`data/${file}?t=${Date.now()}`);
            if(!r.ok) return [];
            const j = await r.json();
            const ch = j.chapters && j.chapters[chapterName] || [];
            return Array.isArray(ch) ? ch.slice(0, limit || ch.length) : [];
        }catch(e){ return []; }
    }

    async function renderQuestionList(containerId, arr, renderQuestion){
        const node = document.getElementById(containerId);
        if(!node) return;
        node.innerHTML = '';
        if(!arr || !arr.length){ node.innerHTML = '<p>None found.</p>'; return; }
        arr.forEach((q,i)=>{
            const el = document.createElement('div'); el.className='review-item';
            el.innerHTML = `<h4>${i+1}. ${escapeHtml(q.q || q.question || q.questionText || q.prompt || '')}</h4>` + (renderQuestion ? renderQuestion(q) : '');
            node.appendChild(el);
        });
    }

    // Today's Revision: pick questions from history items completed today (up to 10)
    (async function todayRev(){
        const node = document.getElementById('todayRevision'); if(!node) return;
        const today = new Date().toISOString().slice(0,10);
        const todays = (history || []).filter(h=> (h.completedAt||'').slice(0,10)===today);
        if(todays.length && subjectMap){
            // for each summary, fetch up to 3 questions from that chapter
            const picks = [];
            for(const s of todays.slice(-5)){
                const subjectId = (s.subjectKey || (s.subject||'').toString().toLowerCase());
                const ch = s.chapter || Object.keys(subjectMap[subjectId] && subjectMap[subjectId].chapters||{})[0];
                const qs = await fetchChapterQuestions(subjectId, s.chapter, 3);
                qs.forEach(q=> picks.push(q));
                if(picks.length>=10) break;
            }
            renderQuestionList('todayRevision', picks.slice(0,10));
        } else {
            node.innerHTML = '<p>No revisions scheduled for today.</p>';
        }
    })();

    // Weak Topics: compute from history aggregated by chapter
    (function weakTopics(){
        const node = document.getElementById('weakTopics'); if(!node) return;
        if(!history.length){ node.innerHTML = '<p>No history available to compute weak topics.</p>'; return; }
        // aggregate wrong rate by subject||chapter
        const map = {};
        history.forEach(h=>{
            const key = `${h.subjectKey||h.subject}||${h.chapter||'__ALL__'}`;
            map[key] = map[key] || {subject: h.subject||h.subjectKey, chapter: h.chapter||'', wrong:0, total:0};
            map[key].wrong += (h.wrong || 0);
            map[key].total += (h.total || 0);
        });
        const arr = Object.keys(map).map(k=> ({key:k, ...map[k], ratio: map[k].total? map[k].wrong / map[k].total : 0})).sort((a,b)=> b.ratio - a.ratio);
        const top = arr.slice(0,6);
        // show list and a button to fetch sample questions
        node.innerHTML = top.map(t=> `<div class="metric-row"><span>${escapeHtml(t.subject)} • ${escapeHtml(t.chapter||'All')}</span><strong>Wrong Rate ${(Math.round(t.ratio*10000)/100).toFixed(2)}%</strong></div>`).join('');
    })();

    // Saved for Revision library: subject -> chapter -> topic -> questions.
    const savedLibraryContent = document.getElementById('savedLibraryContent');
    const savedLibrarySearch = document.getElementById('savedLibrarySearch');
    const savedLibrarySubject = document.getElementById('savedLibrarySubject');
    const savedLibraryChapter = document.getElementById('savedLibraryChapter');
    const savedLibraryBreadcrumb = document.getElementById('savedLibraryBreadcrumb');
    const savedLibraryBack = document.getElementById('savedLibraryBack');
    let savedLibraryLevel = 'subjects';
    let savedLibrarySubjectValue = '';
    let savedLibraryChapterValue = '';
    let savedLibraryTopicValue = '';

    function savedQuestionText(item){
        const question = item.question || {};
        return question.q || question.question || question.questionText || question.prompt || '';
    }

    function savedSubject(item){
        return item.subject || item.subjectKey || item.question?.subject || 'Other / Uncategorized';
    }

    function savedChapter(item){
        return item.chapter || item.question?.chapter || item.question?.section || 'Other / Uncategorized';
    }

    function savedTopic(item){
        const question = item.question || {};
        return item.topic || question.topic || question.category || question.section || '';
    }

    function filteredSavedQuestions(){
        const query = (savedLibrarySearch?.value || '').trim().toLowerCase();
        return bookmarks.filter((item) => {
            if (savedLibrarySubject?.value && savedSubject(item) !== savedLibrarySubject.value) return false;
            if (savedLibraryChapter?.value && savedChapter(item) !== savedLibraryChapter.value) return false;
            if (!query) return true;
            return `${savedQuestionText(item)} ${savedSubject(item)} ${savedChapter(item)} ${savedTopic(item)}`.toLowerCase().includes(query);
        });
    }

    function groupSaved(items, keyFn){
        return items.reduce((groups, item) => {
            const key = keyFn(item) || 'Other / Uncategorized';
            (groups[key] ||= []).push(item);
            return groups;
        }, {});
    }

    function updateSavedLibraryFilters(){
        const subjects = Object.keys(groupSaved(bookmarks, savedSubject)).sort();
        const chapters = Object.keys(groupSaved(bookmarks, savedChapter)).sort();
        if (savedLibrarySubject) savedLibrarySubject.innerHTML = '<option value="">All Subjects</option>' + subjects.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
        if (savedLibraryChapter) savedLibraryChapter.innerHTML = '<option value="">All Chapters</option>' + chapters.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    }

    function openSavedQuestion(item){
        sessionStorage.setItem('savedReviewFocus', JSON.stringify({
            subject: savedSubject(item),
            subjectKey: item.subjectKey || savedSubject(item),
            chapter: savedChapter(item),
            questionIndex: Number(item.questionIndex || 0),
            question: item.question || {}
        }));
        window.location.href = 'result-review.html?from=saved';
    }

    function renderSavedQuestionItems(items){
        savedLibraryContent.innerHTML = items.length ? items.map((item) => `
            <article class="saved-question-item">
                <div><strong>Q${Number(item.questionIndex || 0) + 1}</strong><p>${escapeHtml(savedQuestionText(item))}</p></div>
                <button type="button" class="btn btn-primary btn-small saved-open-button" data-saved-index="${bookmarks.indexOf(item)}">Open Review</button>
            </article>
        `).join('') : '<p class="saved-library-empty">No saved questions match this view.</p>';
        savedLibraryContent.querySelectorAll('.saved-open-button').forEach((button) => {
            button.onclick = () => openSavedQuestion(bookmarks[Number(button.dataset.savedIndex)]);
        });
    }

    function renderSavedLibrary(){
        const items = filteredSavedQuestions();
        let groups;
        if (savedLibraryLevel === 'subjects') {
            groups = groupSaved(items, savedSubject);
            savedLibraryBreadcrumb.textContent = 'Saved for Revision';
        } else if (savedLibraryLevel === 'chapters') {
            groups = groupSaved(items.filter((item) => savedSubject(item) === savedLibrarySubjectValue), savedChapter);
            savedLibraryBreadcrumb.textContent = `Saved for Revision / ${savedLibrarySubjectValue}`;
        } else if (savedLibraryLevel === 'topics') {
            groups = groupSaved(items.filter((item) => savedSubject(item) === savedLibrarySubjectValue && savedChapter(item) === savedLibraryChapterValue), savedTopic);
            savedLibraryBreadcrumb.textContent = `Saved for Revision / ${savedLibrarySubjectValue} / ${savedLibraryChapterValue}`;
        } else if (savedLibraryLevel === 'questions') {
            savedLibraryBreadcrumb.textContent = `Saved for Revision / ${savedLibrarySubjectValue} / ${savedLibraryChapterValue}${savedLibraryTopicValue ? ` / ${savedLibraryTopicValue}` : ''}`;
        }

        savedLibraryBack.hidden = savedLibraryLevel === 'subjects';
        if (!items.length) {
            savedLibraryContent.innerHTML = bookmarks.length ? '<p class="saved-library-empty">No saved questions match this view.</p>' : '<div class="saved-library-empty"><strong>No questions saved yet.</strong><p>Go to Review and use "Save for Revision" to add questions.</p></div>';
            return;
        }

        if (savedLibraryLevel === 'questions') {
            renderSavedQuestionItems(items.filter((item) => savedSubject(item) === savedLibrarySubjectValue && savedChapter(item) === savedLibraryChapterValue && (!savedLibraryTopicValue || savedTopic(item) === savedLibraryTopicValue)));
            return;
        }

        savedLibraryContent.innerHTML = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
            const hasTopic = group.some((item) => savedTopic(item));
            const target = savedLibraryLevel === 'subjects' ? 'chapters' : (hasTopic ? 'topics' : 'questions');
            return `<button type="button" class="saved-library-group" data-group="${escapeHtml(name)}" data-target="${target}"><span>${escapeHtml(name)}</span><strong>${group.length}</strong></button>`;
        }).join('');
        savedLibraryContent.querySelectorAll('.saved-library-group').forEach((button) => {
            button.onclick = () => {
                const name = button.dataset.group;
                if (savedLibraryLevel === 'subjects') savedLibrarySubjectValue = name;
                else if (savedLibraryLevel === 'chapters') savedLibraryChapterValue = name;
                else savedLibraryTopicValue = name;
                savedLibraryLevel = button.dataset.target;
                renderSavedLibrary();
            };
        });
    }

    updateSavedLibraryFilters();
    renderSavedLibrary();
    [savedLibrarySearch, savedLibrarySubject, savedLibraryChapter].forEach((node) => node?.addEventListener('input', () => {
        savedLibraryLevel = 'subjects';
        savedLibrarySubjectValue = savedLibrarySubject?.value || '';
        savedLibraryChapterValue = savedLibraryChapter?.value || '';
        renderSavedLibrary();
    }));
    savedLibraryBack?.addEventListener('click', () => {
        if (savedLibraryLevel === 'questions' || savedLibraryLevel === 'topics') savedLibraryLevel = 'chapters';
        else if (savedLibraryLevel === 'chapters') savedLibraryLevel = 'subjects';
        renderSavedLibrary();
    });

    // Incorrect / Skipped from latest result
    (function incorrectSkipped(){
        const inc = [];
        const skip = [];
        if(latestResult && Array.isArray(latestResult.questions)){
            latestResult.questions.forEach((q,i)=>{
                const ua = (latestResult.userAnswers||[])[i];
                if(ua == null) skip.push(q);
                else if(typeof q.answer !== 'undefined' && ua !== q.answer) inc.push(q);
            });
        }
        renderQuestionList('incorrectList', inc);
        renderQuestionList('skippedList', skip);
    })();

    // Random 20 questions: sample across manifest until 20 collected (cap per-file)
    (async function random20(){
        const files = manifest ? manifest.map(s=>s.file) : ['ancient.json','medeival.json','modern.json','geography.json','polity.json'];
        const pool = [];
        for(const f of files){
            if(pool.length>=20) break;
            try{ const r = await fetch(`data/${f}?t=${Date.now()}`); if(!r.ok) continue; const j = await r.json();
                const chapters = Object.keys(j.chapters||{});
                for(const ch of chapters){
                    const qs = Array.isArray(j.chapters[ch])? j.chapters[ch] : [];
                    for(const q of qs){ pool.push(q); if(pool.length>=20) break; }
                    if(pool.length>=20) break;
                }
            }catch(e){ }
        }
        // shuffle and show 20
        for(let i=pool.length-1;i>0;i--){ const r=Math.floor(Math.random()*(i+1)); [pool[i],pool[r]]=[pool[r],pool[i]]; }
        renderQuestionList('randomList', pool.slice(0,20));
    })();

    // Frequently Incorrect Topics: approximate by selecting chapters with highest wrong counts
    (async function freqIncorrect(){
        const node = document.getElementById('freqIncorrect'); if(!node) return;
        if(!history.length){ node.innerHTML = '<p>No history available.</p>'; return; }
        const map = {};
        history.forEach(h=>{
            const key = `${h.subjectKey||h.subject}||${h.chapter||'__ALL__'}`;
            map[key] = map[key] || {subject: h.subject||h.subjectKey, chapter: h.chapter||'', wrong:0, total:0};
            map[key].wrong += (h.wrong || 0);
            map[key].total += (h.total || 0);
        });
        const arr = Object.keys(map).map(k=> ({key:k, ...map[k], wrongRate: map[k].total? map[k].wrong / map[k].total : 0})).sort((a,b)=> b.wrong - a.wrong);
        const top = arr.slice(0,5);
        const results = [];
        for(const t of top){
            const subjectId = (t.subject || '').toString().toLowerCase();
            const ch = t.chapter || null;
            const qsample = ch ? await fetchChapterQuestions(subjectId, ch, 3) : [];
            if(qsample.length) results.push({topic:`${t.subject} • ${t.chapter||'All'}`, questions: qsample});
        }
        if(!results.length){ node.innerHTML = '<p>No frequently incorrect topics found.</p>'; return; }
        node.innerHTML = results.map(r=> `<div class="panel"><strong>${escapeHtml(r.topic)}</strong>${r.questions.map(q=> `<div class="review-item"><p>${escapeHtml(q.q||'')}</p></div>`).join('')}</div>`).join('');
    })();

    // done
})();
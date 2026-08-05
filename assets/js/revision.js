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

    // Bookmarked Questions
    (function bookmarksSection(){ renderQuestionList('bookmarkedList', bookmarks, (q)=>`<div>${escapeHtml(q.chapter||'')} • ${escapeHtml(q.subject||q.subjectKey||'')}</div>`); })();

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
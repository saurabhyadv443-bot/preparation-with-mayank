// Global Question Search

(async function(){
    const input = document.getElementById('globalSearchInput');
    const resultsNode = document.getElementById('searchResults');
    const clearBtn = document.getElementById('btnClearSearch');

    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    async function discoverFiles(){
        // Read the structured manifest `data/subjects.json` and return file names.
        try {
            const resp = await fetch('data/subjects.json');
            if (!resp.ok) throw new Error('subject manifest not found');
            const j = await resp.json();
            if (!j || !Array.isArray(j.subjects)) throw new Error('invalid manifest');
            return j.subjects.map(s => s.file).filter(Boolean);
        } catch (e) {
            const err = document.createElement('div');
            err.className = 'panel';
            err.innerHTML = '<strong>Search unavailable:</strong> subjects manifest missing or invalid.';
            resultsNode.parentNode.insertBefore(err, resultsNode);
            return [];
        }
    }

    function getSlug(f){ return f.replace(/\.json$/i,''); }

    async function loadAll(files){
        const pool = [];
        await Promise.all(files.map(async (file)=>{
            if (!file.toLowerCase().endsWith('.json')) return;
            try{
                const resp = await fetch(`data/${file}?t=${Date.now()}`);
                if (!resp.ok) return;
                const j = await resp.json();
                const subject = j.subject || getSlug(file);
                Object.keys(j.chapters||{}).forEach(ch=>{
                    const qs = Array.isArray(j.chapters[ch]) ? j.chapters[ch] : [];
                    qs.forEach((q, idx)=>{
                        pool.push({
                            subject, subjectKey: getSlug(file), chapter: ch, index: idx, q: q.q||'', options: q.options||[], explanation: q.explanation||'', year: q.year||q.y||'', source: q.source||q.paper||'', difficulty: q.difficulty||q.level||'', raw: q
                        });
                    });
                });
            }catch(e){console.warn('skip',file,e)}
        }));
        return pool;
    }

    function buildSearchText(item){
        return [item.q, (item.options||[]).join(' '), item.explanation, item.chapter, item.year, item.source, item.difficulty].join(' ').toLowerCase();
    }

    function highlight(text, terms){
        if (!terms || !terms.length) return escapeHtml(text);
        let s = escapeHtml(text);
        // escape regex special for terms and sort by length desc to avoid nested
        const uniq = [...new Set(terms.filter(t=>t.trim()))].sort((a,b)=>b.length-a.length);
        uniq.forEach(t=>{
            try{
                const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')','ig');
                s = s.replace(re, '<mark>$1</mark>');
            }catch(e){}
        });
        return s;
    }

    function renderResults(matches, terms){
        resultsNode.innerHTML = '';
        if (!matches.length) { resultsNode.innerHTML = '<p>No results found</p>'; return; }
        matches.forEach((m,i)=>{
            const div = document.createElement('div'); div.className='review-item';
            const qhtml = `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="flex:1"><h4>${highlight(m.q, terms)}</h4><div class=\"metric-row\"><span>${escapeHtml(m.subject)} • ${escapeHtml(m.chapter)}</span><strong>${escapeHtml(m.year)} ${m.difficulty? '• '+escapeHtml(m.difficulty):''} ${m.source? '• '+escapeHtml(m.source):''}</strong></div></div><div style=\"margin-left:12px;display:flex;flex-direction:column;gap:6px\"><button class=\"btn btn-primary btn-small reviewBtn\" data-i=\"${i}\">Review</button><button class=\"btn btn-secondary btn-small bookmarkBtn\" data-i=\"${i}\">Bookmark</button></div></div>`;
            const optHtml = (m.options||[]).map(o=>`<div class=\"option-wrap\">${highlight(o, terms)}</div>`).join('');
            const expHtml = m.explanation ? `<div class=\"explanation-box\">${highlight(m.explanation, terms)}</div>` : '';
            div.innerHTML = qhtml + '<div style="margin-top:8px">' + optHtml + '</div>' + expHtml;
            resultsNode.appendChild(div);
        });
        // wire buttons
        Array.from(resultsNode.querySelectorAll('.reviewBtn')).forEach(btn=> btn.onclick = (e)=>{ const i=Number(btn.dataset.i); openInReview(matches[i]); });
        Array.from(resultsNode.querySelectorAll('.bookmarkBtn')).forEach(btn=> btn.onclick = (e)=>{ const i=Number(btn.dataset.i); toggleBookmark(matches[i]); });
    }

    function toggleBookmark(item){
        try{
            const raw = localStorage.getItem('bookmarks');
            const arr = raw ? JSON.parse(raw) : [];
            const found = arr.findIndex(b=> b.subjectKey===item.subjectKey && b.chapter===item.chapter && b.index===item.index && b.q===item.q);
            if (found >=0) { arr.splice(found,1); localStorage.setItem('bookmarks', JSON.stringify(arr)); alert('Bookmark removed'); }
            else { arr.push({subjectKey:item.subjectKey, subject:item.subject, chapter:item.chapter, questionIndex:item.index, question:item.raw}); localStorage.setItem('bookmarks', JSON.stringify(arr)); alert('Bookmarked'); }
        }catch(e){console.error(e)}
    }

    function openInReview(item){
        // create quizResult for review page
        const result = { subject: item.subject, subjectKey: item.subjectKey, chapter: item.chapter, total:1, correct:0, wrong:0, skipped:0, attempted:0, accuracy:0, questions:[ item.raw ], completedAt: new Date().toISOString() };
        localStorage.setItem('quizResult', JSON.stringify(result));
        window.location.href = 'review.html';
    }

    // main
    const loadingNode = document.getElementById('searchLoading');
    if (loadingNode) loadingNode.style.display = 'block';
    const files = await discoverFiles();
    const pool = await loadAll(files);
    // precompute searchable text
    pool.forEach(p=> p._searchText = buildSearchText(p));
    if (loadingNode) loadingNode.style.display = 'none';

    let lastVal = '';
    function doSearch(val){
        const v = val.trim().toLowerCase();
        if (!v) { renderResults([], []); return; }
        const terms = v.split(/\s+/).filter(Boolean);
        // AND match all terms
        let matches = pool.filter(p=> terms.every(t=> p._searchText.indexOf(t) !== -1));
        // dedupe by subjectKey|chapter|index
        const seen = new Set();
        const unique = [];
        for (const m of matches) {
            const key = `${m.subjectKey}||${m.chapter}||${m.index}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(m);
        }
        renderResults(unique.slice(0,200), terms); // cap
    }

    let _searchTimer = null;
    input.addEventListener('input', (e)=>{ const v=e.target.value; if (v===lastVal) return; lastVal=v; clearTimeout(_searchTimer); _searchTimer = setTimeout(()=> doSearch(v), 150); });
    clearBtn.onclick = ()=>{ input.value=''; lastVal=''; doSearch(''); };

})();

(async function(){
    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function safeParse(v, fallback){ try { return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } }

    // read manifest
    async function readManifest(){
        try{ const r = await fetch('data/subjects.json'); if(!r.ok) return null; const j = await r.json(); return j && Array.isArray(j.subjects) ? j.subjects : null; } catch(e){ return null; }
    }

    let savedQuestions = safeParse(localStorage.getItem('bookmarks'), []);

    async function loadSavedQuestionsFromServer() {
        try {
            const response = await fetch(quizApiUrl('api/saved-questions'), { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            savedQuestions = Object.values(data.groups || {}).flatMap((items) => items.map((item) => ({
                ...item,
                ...(item.source || {}),
                subjectKey: item.source?.sourceSubjectKey,
                chapter: item.source?.chapter,
                questionIndex: item.source?.questionIndex
            })));
            if (localStorage.getItem('bookmarks')) localStorage.removeItem('bookmarks');
        } catch (error) {
            // Keep the legacy list available if the storage service is unavailable.
        }
    }

    await loadSavedQuestionsFromServer();

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
        return savedQuestions.filter((item) => {
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
        const subjects = Object.keys(groupSaved(savedQuestions, savedSubject)).sort();
        const chapters = Object.keys(groupSaved(savedQuestions, savedChapter)).sort();
        if (savedLibrarySubject) savedLibrarySubject.innerHTML = '<option value="">All Subjects</option>' + subjects.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
        if (savedLibraryChapter) savedLibraryChapter.innerHTML = '<option value="">All Chapters</option>' + chapters.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    }

    function savedQuestionKey(item) {
        return `${item.subjectKey || savedSubject(item)}::${item.chapter || savedChapter(item)}::${Number(item.questionIndex || 0)}`;
    }

    function openSavedQuestion(item, collectionItems){
        const questions = collectionItems.map((savedItem) => savedItem.question || {}).filter((question) => Object.keys(question).length);
        const startingQuestionIndex = Math.max(0, collectionItems.indexOf(item));
        const payload = {
            title: 'Saved Questions',
            subject: savedSubject(item),
            subjectKey: item.subjectKey || savedSubject(item),
            chapter: savedChapter(item),
            questions,
            startingQuestionIndex,
            returnUrl: 'revision.html',
            collectionListPayload: {
                title: 'Saved Questions',
                questions,
                returnUrl: 'revision.html'
            }
        };
        sessionStorage.setItem('collectionQuizPayload', JSON.stringify(payload));
        window.location.href = 'collection-quiz.html';
    }

    // Visible Saved Questions rows are rendered here into #savedLibraryContent.
    function renderSavedQuestionItems(items){
        savedLibraryContent.innerHTML = items.length ? `
            <div id="savedClassificationRemovalControls" class="classification-removal-controls">
                <label><input type="checkbox" class="classification-select-all"> Select All</label>
                <button type="button" class="btn btn-secondary btn-small classification-remove-selected" disabled>Remove Selected</button>
                <span class="classification-selected-count">0 selected</span>
            </div>
            ${items.map((item) => `
                <article class="saved-question-item">
                    <input type="checkbox" class="classification-question-checkbox" data-saved-question-key="${escapeHtml(savedQuestionKey(item))}" aria-label="Select saved question ${Number(item.questionIndex || 0) + 1}">
                    <div><strong>Q${Number(item.questionIndex || 0) + 1}</strong><p>${escapeHtml(savedQuestionText(item))}</p></div>
                    <button type="button" class="btn btn-primary btn-small saved-open-button" data-saved-index="${savedQuestions.indexOf(item)}">Open Quiz</button>
                </article>
            `).join('')}
        ` : '<p class="saved-library-empty">No saved questions match this view.</p>';
        savedLibraryContent.querySelectorAll('.saved-open-button').forEach((button) => {
            button.onclick = () => openSavedQuestion(savedQuestions[Number(button.dataset.savedIndex)], items);
        });
        const controls = document.getElementById('savedClassificationRemovalControls');
        if (controls) {
            const checkboxes = Array.from(savedLibraryContent.querySelectorAll('.classification-question-checkbox'));
            const selectAll = controls.querySelector('.classification-select-all');
            const removeButton = controls.querySelector('.classification-remove-selected');
            const selectedCount = controls.querySelector('.classification-selected-count');
            const updateSavedSelection = () => {
                const selected = checkboxes.filter((checkbox) => checkbox.checked);
                selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
                selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
                removeButton.disabled = selected.length === 0;
                selectedCount.textContent = `${selected.length} selected`;
            };
            checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateSavedSelection));
            selectAll.addEventListener('change', () => {
                checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
                updateSavedSelection();
            });
            removeButton.addEventListener('click', () => {
                const selectedKeys = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.savedQuestionKey);
                if (!selectedKeys.length || !window.confirm(`Remove ${selectedKeys.length} selected saved question${selectedKeys.length === 1 ? '' : 's'}?`)) return;
                console.debug('Removing saved question entries', { selectedKeys, savedEntries: savedQuestions });
                const selectedSet = new Set(selectedKeys);
                const retained = savedQuestions.filter((item) => !selectedSet.has(savedQuestionKey(item)));
                savedQuestions.splice(0, savedQuestions.length, ...retained);
                localStorage.setItem('bookmarks', JSON.stringify(savedQuestions));
                console.debug('Saved question entries after removal', savedQuestions);
                renderSavedLibrary();
            });
            updateSavedSelection();
        }
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
            savedLibraryContent.innerHTML = savedQuestions.length ? '<p class="saved-library-empty">No saved questions match this view.</p>' : '<div class="saved-library-empty"><strong>No questions saved yet.</strong><p>Go to Review and use "Save for Revision" to add questions.</p></div>';
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

    // done
})();
(async function(){
    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function safeParse(v, fallback){ try { return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } }

    // read manifest
    async function readManifest(){
        try{ const j = await loadJson('data/subjects.json'); return j && Array.isArray(j.subjects) ? j.subjects : null; } catch(e){ return null; }
    }

    let savedQuestions = [];
    let revisionPageRendered = false;
    let revisionPendingStorageRefresh = false;

    window.addEventListener("quizPendingStorageReady", async () => {
        if (!revisionPageRendered) {
            revisionPendingStorageRefresh = true;
            return;
        }
        await loadSavedQuestionsFromServer();
        renderSavedLibrary();
    });
    window.addEventListener("quizCollectionsChanged", async () => {
        if (!revisionPageRendered) return;
        await loadSavedQuestionsFromServer();
        renderSavedLibrary();
    });

    async function loadSavedQuestionsFromServer() {
        if (!window.quizCollections) {
            savedQuestions = [];
            return;
        }
        await window.quizCollections.ready;
        savedQuestions = (await window.quizCollections.getCollection("S")).map((record) => ({
            collectionId: record.id,
            subjectKey: record.source.sourceSubjectKey,
            subject: record.subject || record.source.sourceSubjectKey,
            chapter: record.source.chapter,
            questionIndex: record.source.questionIndex,
            question: record.question,
            source: record.source,
            topic: record.question?.topic || record.question?.category || ""
        }));
    }

    await loadSavedQuestionsFromServer();

    const collectionBackupTools = document.getElementById("savedCollectionBackupTools");
    window.quizCollections?.attachBackupTools(collectionBackupTools);
    const collectionBackupStatus = collectionBackupTools?.querySelector("[data-collection-backup-status]");
    if (collectionBackupStatus && window.quizCollections) {
        const status = window.quizCollections.status();
        collectionBackupStatus.textContent = status.durable
            ? "Collection changes are stored in this browser."
            : `Collection changes are temporary only: ${status.message} Export a backup before leaving.`;
        collectionBackupStatus.classList.toggle("is-temporary", !status.durable);
    }

    const manifest = await readManifest();
    const subjectMap = {};
    (manifest || []).forEach(s=> subjectMap[s.id]=s);

    // helpers to fetch a chapter's questions
    async function fetchChapterQuestions(subjectId, chapterName, limit){
        const sub = subjectMap[subjectId];
        const file = sub ? sub.file : `${subjectId}.json`;
        try{
            const j = await loadJson(`data/${file}`);
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
        return item.collectionId || `${item.subjectKey || savedSubject(item)}::${item.chapter || savedChapter(item)}::${Number(item.questionIndex || 0)}`;
    }

    function openSavedQuestion(item, collectionItems){
        const questions = collectionItems.map((savedItem) => {
            const question = savedItem.question || {};
            return Object.keys(question).length
                ? { ...question, _collectionSource: { ...(savedItem.source || {}) } }
                : null;
        }).filter(Boolean);
        const payload = {
            title: 'Saved Questions',
            subject: savedSubject(item),
            subjectKey: 'collections',
            chapter: savedChapter(item),
            questions,
            collectionTag: 'S',
            returnUrl: 'revision.html',
        };
        sessionStorage.setItem('collectionListPayload', JSON.stringify(payload));
        window.location.href = 'collection-list.html';
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
                    <button type="button" class="btn btn-primary btn-small saved-open-button" data-saved-index="${savedQuestions.indexOf(item)}">Open Reader</button>
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
            removeButton.addEventListener('click', async () => {
                const selectedKeys = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.savedQuestionKey);
                if (!selectedKeys.length || !window.confirm(`Remove ${selectedKeys.length} selected saved question${selectedKeys.length === 1 ? '' : 's'}?`)) return;
                const selectedSet = new Set(selectedKeys);
                const selectedItems = savedQuestions.filter((item) => selectedSet.has(savedQuestionKey(item)));
                if (window.quizCollections) {
                    const outcomes = await Promise.all(selectedItems.map((item) => window.quizCollections.removeMembership(item.collectionId, "S")));
                    const storageMessage = savedLibraryContent.querySelector(".collection-storage-status");
                    if (outcomes.some((outcome) => !outcome.durable) && storageMessage) {
                        storageMessage.textContent = "Removals are temporary because durable storage is unavailable. Export a backup before leaving.";
                        storageMessage.classList.add("is-temporary");
                    }
                    await loadSavedQuestionsFromServer();
                } else {
                    const retained = savedQuestions.filter((item) => !selectedSet.has(savedQuestionKey(item)));
                    savedQuestions.splice(0, savedQuestions.length, ...retained);
                    localStorage.setItem('bookmarks', JSON.stringify(savedQuestions));
                }
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
    revisionPageRendered = true;
    if (revisionPendingStorageRefresh) {
        await loadSavedQuestionsFromServer();
        renderSavedLibrary();
    }
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
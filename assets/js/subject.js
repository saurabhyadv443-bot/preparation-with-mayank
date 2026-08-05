const params = new URLSearchParams(window.location.search);
const subject = params.get("subject") || "ancient";

async function getSubjectMetaMap() {
    try {
        const resp = await fetch('data/subjects.json');
        if (!resp.ok) throw new Error('manifest');
        const j = await resp.json();
        if (!j || !Array.isArray(j.subjects)) throw new Error('invalid');
        return j.subjects.reduce((acc,s)=>{ acc[s.id]=s; return acc; }, {});
    } catch (e) {
        return null;
    }
}

(async function initSubjectPage(){
    const meta = await getSubjectMetaMap();
    const title = (meta && meta[subject] && meta[subject].title) || subject;
    document.getElementById("subjectTitle").innerText = title;
})();

const examBtn = document.getElementById("examBtn");
const studyBtn = document.getElementById("studyBtn");
const practiceBtn = document.getElementById("practiceBtn");

if (examBtn) {
    examBtn.onclick = function () {
        window.location.href = "quiz.html?subject=" + subject + "&mode=exam";
    };
}

if (studyBtn) {
    studyBtn.onclick = function () {
        window.location.href = "quiz.html?subject=" + subject + "&mode=study";
    };
}

if (practiceBtn) {
    practiceBtn.onclick = function () {
        window.location.href = "quiz.html?subject=" + subject;
    };
}

document.getElementById("bookmarkBtn").onclick = function () {
    const bookmarks = JSON.parse(localStorage.getItem("bookmarks") || "[]");
    const subjectBookmarks = bookmarks.filter((item) => (item.subjectKey || item.subject) === subject);
    const bookmarkList = document.getElementById("bookmarkList");

    bookmarkList.innerHTML = "";

    if (!subjectBookmarks.length) {
        bookmarkList.innerHTML = "<p>No bookmarks saved for this subject yet.</p>";
        return;
    }

    subjectBookmarks.forEach((item) => {
        const row = document.createElement("div");
        row.className = "review-item";
        row.innerHTML = `
            <h3>Q${item.questionIndex + 1} • ${item.chapter}</h3>
            <p>${item.question.q}</p>
        `;
        bookmarkList.appendChild(row);
    });
};
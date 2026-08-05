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

function orderSubjectKeys(keys, preferredOrder = ["ancient", "medieval", "modern", "geography", "polity"]) {
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

    subjects.forEach((subjectKey) => {
        const meta = subjectMeta && subjectMeta[subjectKey];
        const title = meta ? meta.title : getSubjectTitle(subjectKey);
        const description = meta ? meta.description : getSubjectDescription(subjectKey);
        const icon = meta ? meta.icon : getSubjectIcon(subjectKey);

        const card = document.createElement("article");
        card.className = "dashboard-card";
        card.innerHTML = `
            <div class="card-icon">${icon}</div>
            <h2>${title}</h2>
            <p>${description}</p>
            <a href="subject.html?subject=${encodeURIComponent(subjectKey)}" class="btn btn-primary btn-small">Open Subject</a>
        `;
        subjectsContainer.appendChild(card);
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

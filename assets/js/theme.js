(function () {
    const STORAGE_KEY = "quizTheme";
    const root = document.documentElement;

    function readTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
        } catch (error) {
            return "light";
        }
    }

    function writeTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (error) {
        }
    }

    function setTheme(theme) {
        const nextTheme = theme === "dark" ? "dark" : "light";
        root.dataset.theme = nextTheme;
        const toggle = document.getElementById("themeToggle");
        if (!toggle) return;
        const darkMode = nextTheme === "dark";
        toggle.textContent = darkMode ? "Light mode" : "Dark mode";
        toggle.setAttribute("aria-pressed", String(darkMode));
        toggle.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
        toggle.title = darkMode ? "Switch to light mode" : "Switch to dark mode";
    }

    function createToggle() {
        if (document.getElementById("themeToggle")) {
            setTheme(root.dataset.theme);
            return;
        }

        const host = document.querySelector(".top-nav, .top-right") || document.body;
        const toggle = document.createElement("button");
        toggle.id = "themeToggle";
        toggle.type = "button";
        toggle.className = "theme-toggle";
        toggle.addEventListener("click", function () {
            const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
            writeTheme(nextTheme);
            setTheme(nextTheme);
        });
        host.appendChild(toggle);
        setTheme(root.dataset.theme);
    }

    root.dataset.theme = readTheme();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createToggle, { once: true });
    } else {
        createToggle();
    }
})();

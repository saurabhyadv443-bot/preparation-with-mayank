/**
 * Shared utility functions used across the quiz portal.
 * Consolidated to reduce code duplication while maintaining existing behavior.
 */

/**
 * Escapes HTML special characters to prevent XSS.
 * Converts: & < > " '
 * Used throughout the portal for safe HTML rendering.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Formats seconds into MM:SS format.
 * Used for timer display across quiz, practice, and collection modes.
 * Pads with zeros to ensure consistent two-digit format.
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const quizApiOrigin = window.location.port && window.location.port !== "8000" ? "http://127.0.0.1:8000" : "";
function quizApiUrl(path) {
    return `${quizApiOrigin}/${String(path).replace(/^\//, "")}`;
}


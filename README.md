# Quiz Portal

A static client-side quiz portal built with HTML, CSS and vanilla JavaScript. Designed for deployment on GitHub Pages.

## What this repo contains
- Static pages: `index.html`, `dashboard.html`, `quiz.html`, `result.html`, `review.html`, `subject.html`, `search.html`, `prev-year.html`, and others.
- Client-side authentication: implemented in `assets/js/auth.js` using `localStorage` and `sessionStorage` (password stored in browser; this is not secure for production).
- Data files: JSON datasets in `data/` (used by the app via fetch).
- Assets: CSS in `assets/css/`, JS in `assets/js/`, images in `assets/images/`.

## Deploy to GitHub Pages
1. Create a repository on GitHub (e.g. `username/quiz-portal`).
2. Add the remote and push:

```bash
cd bpsc-quiz-portal
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

3. On GitHub, enable Pages in repository settings and select branch `main` with folder `/ (root)`.

## Notes & Manual Steps
- The app uses a client-side password stored in `localStorage` (`quizPortalPassword`) and a session flag `quizAuthenticated` in `sessionStorage`. This protects pages in the browser only — it is not server-side authentication.
- Default password: `Mayank#123` (change via the app UI). Password reset requires verification code `maya8932`.
- If you want the repo created and pushed automatically from this machine, provide a remote URL and ensure git authentication is configured (SSH key or https token). Otherwise, follow the commands above to push from your machine.

## Troubleshooting
- If push fails due to authentication, configure a personal access token or SSH key as described in GitHub docs.

## License
This project contains educational content. Add a license file if needed.

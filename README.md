# Quiz Portal

>A lightweight, client-side quiz portal for practice tests, previous-year questions and mock exams. Designed to run as a static site and easily deployed to GitHub Pages.

---

## Features

- Full-featured quiz engine (study & exam modes)
- Persistent progress, bookmarks and results stored in browser `localStorage`
- Per-subject quizzes and previous-year question support
- Result review, question palette and per-question explanations
- Responsive UI for desktop, tablet and mobile
- Static-site friendly — deployable to GitHub Pages

---

## Folder structure

Top-level structure (important files/folders):

- `index.html` — startup splash / landing page
- `dashboard.html` — main dashboard
- `quiz.html` — quiz runner view
- `subject.html` — subject page
- `result.html`, `result-review.html`, `review.html` — reporting and review pages
- `assets/`
  - `css/` — stylesheets
  - `js/` — client-side logic and quiz engine
  - `images/` — site images (includes `login-bg.jpeg`)
- `data/` — quiz JSON payloads (e.g., `modern.json`, `mock.json`, etc.)
- `quizzes/` — packaged/legacy quiz HTML files
- `scripts/` — developer scripts to export / repair quiz data
- `README.md` — this file

---

## How to run locally

This is a static site — run any simple static server and open the site in a browser.

Using Python 3 (recommended):

```bash
# from repository root
python -m http.server 8000
# then open http://localhost:8000
```

Using Node `serve`:

```bash
npm install -g serve
serve -s . -l 8000
```

Using VS Code: open folder and use the Live Server extension.

Notes:
- The site expects to be served via HTTP(S); some browser APIs behave differently on `file://`.
- Do not modify `assets/js/` unless you need to change quiz behaviour.

---

## How to deploy to GitHub Pages

Option A — Publish from the `main` branch root (simple):

1. Create a GitHub repository and push your code to `main`.
2. On GitHub: **Settings > Pages**, select branch `main` and folder `/ (root)`. Save.
3. GitHub will publish the site at `https://<your-username>.github.io/<repo>/`.

Quick commands:

```bash
git init
git add .
git commit -m "Initial site"
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

Option B — Use a `gh-pages` branch or GitHub Action for automated deployments.

Notes:
- Internal links are relative — verify pages after deploying to a subpath.
- If you prefer no external CDNs, vendor libraries into `assets/vendor/` and update references.

---

## How to update quiz JSON

Quiz datasets are in the `data/` directory (for example `modern.json`, `mock.json`, `polity.json`). Guidelines:

- Keep the existing JSON schema — inspect a sample file before editing.
- To import or export programmatically, use scripts in the `scripts/` folder (e.g., `export_modern_quiz.js`, `export_modern_quiz.py`).
- After updating JSON, refresh the site and clear cache if you do not see changes.

---

## Browser support

Tested on modern evergreen browsers:

- Google Chrome (latest)
- Microsoft Edge (latest)
- Mozilla Firefox (latest)
- Safari (macOS / iOS recent versions)

The app uses modern JS features and `localStorage`/`sessionStorage` — use recent browser versions for best results.

---

## License

This project is provided under the MIT License. Add a `LICENSE` file to the repository to make this explicit.

---

## Author

Mayank — Designed & Developed

---

If you want, I can:

- Vendor external CDN libraries into `assets/vendor/` and update references for a fully self-contained site.
- Add a GitHub Actions workflow to deploy automatically to GitHub Pages on `main`.
- Add a small `deploy.sh` helper.

# Nexxore (monorepo)

This repository holds the Nexxore landing page and the scaffold for the future frontend, backend and database services.

Structure:

- `frontend/` – Static landing site (HTML/CSS/JS).
- `backend/` – Backend services (placeholder).
- `database/` – Database schema and migrations (placeholder).

Quick preview:

Open `frontend/index.html` in your browser (or run a simple static server):

```bash
# Mac/Linux
cd frontend && python3 -m http.server 3000
# then open http://localhost:3000
```

Next steps:
- Implement backend API for waitlist and integrate email provider.
- Add CI, tests and deployment pipelines.

Hosting
- Automated deployment to GitHub Pages is provided via `.github/workflows/deploy.yml` which publishes the `frontend/` folder to the `gh-pages` branch on push to `main`.
- See [HOSTING.md](HOSTING.md) for alternative hosts (Vercel, Netlify) and local preview steps.

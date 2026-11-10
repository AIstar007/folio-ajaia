# Ajaia AI-Native Full Stack Developer — Submission

Candidate: Alen Thomas  
Project: Folio — a lightweight shared document workspace

## Included

- `app/` — FastAPI application, static frontend, styling, and browser logic.
- `tests/test_app.py` — seven automated API test functions.
- `requirements.txt` — runtime and test dependencies.
- `README.md` — local setup, demo accounts, tests, API routes, deployment notes, and limitations.
- `ARCHITECTURE.md` — architecture, data flow, navigation, tradeoffs, and next steps.
- `AI_WORKFLOW.md` — AI-assisted workflow and verification notes.
- `VERIFICATION.md` — actual automated and HTTP smoke-test results plus the manual QA checklist.
- `WALKTHROUGH_SCRIPT.md` — suggested 3–5 minute demo structure.
- `WALKTHROUGH_URL.txt` — paste the recorded public video URL here.
- `render.yaml` — Render deployment Blueprint configuration.

## Live product

Not deployed yet. Connect this source to Render using `render.yaml`, then replace this line with the public service URL. The included free configuration uses an ephemeral SQLite file: documents persist across page refreshes while the instance is running, but the database may be lost after a service restart or redeploy. For durable reviewer-facing persistence, attach persistent storage or use managed Postgres. Verify the health endpoint and demo flows before submitting.

## Walkthrough video

Not recorded yet. Record a 3–5 minute walkthrough and paste the public Loom/YouTube/Vimeo/Drive URL into `WALKTHROUGH_URL.txt` and the assessment form.

## Review accounts

- `alen@demo.local` — owner of the seeded Welcome to Folio document.
- `priya@demo.local` — collaborator account.
- `alex@demo.local` — collaborator account.

There are no passwords; use the in-product account selector. This is a mocked identity flow for review only.

## Current functionality

Create/edit/autosave, rich-text formatting, import `.txt`/Markdown, owner/viewer/editor sharing, Starred, duplicate, reversible Trash, restore, permanent delete, HTML/text export, print-to-PDF, title search, and browser history navigation.

## Known limitations

No real authentication, live multi-cursor collaboration, conflict resolution, comments, suggestions, version history, folders, DOCX/PDF import, or arbitrary file attachments. The browser-driven UI test was blocked in the build sandbox; use `VERIFICATION.md` to complete the local QA pass before submission.

# AI workflow note

## Tools used

- ChatGPT (GPT-6) for requirement decomposition, architecture tradeoffs, implementation drafting, API test-case design, UX review, and documentation.
- Local Python, FastAPI TestClient, pytest, Node.js syntax validation, Uvicorn, and HTTP smoke checks for executable verification.

## Where AI materially accelerated the work

AI helped convert the open-ended brief into a focused product slice, draft the API/data model and vanilla frontend, identify permission edge cases, and iterate the interface from a basic document list into a more recognizable workspace with browser navigation, contextual document actions, Starred, and Trash.

## What was changed or intentionally rejected

- Kept FastAPI + SQLite + vanilla JavaScript instead of introducing a frontend build chain and several services under a strict timebox.
- Added reversible deletion rather than immediately deleting rows, with permanent deletion as a separate confirmed action.
- Kept real-time collaboration, comments, version history, folders, external auth, and DOCX/PDF import out of scope instead of adding superficial, unverified controls.
- Enforced owner/editor/viewer rules in API routes; hiding controls in the frontend is only a UX measure, not the security boundary.
- Preserved the existing muted green/cream visual direction while improving action discoverability, empty states, and mobile sidebar navigation.

## Verification

- Seven API test functions pass: create/update/reopen and HTML sanitization; viewer/editor permissions; Markdown import and unsupported file rejection; private document isolation; Trash/restore/permanent deletion; Starred and duplication; and migration from the original database schema.
- Python compilation and JavaScript syntax checks pass. A Uvicorn `/api/health` smoke request returned `status: ok`.
- Browser-based automation was attempted but Chromium navigation was blocked by the execution sandbox. I have not claimed that a full browser UX run passed; the manual QA sequence is documented in `VERIFICATION.md`.

## Transparency

The demo user selector is not production authentication. The deployment and walkthrough video still need to be completed by the candidate. Update this note if additional tools or manual verification steps are used before submission.

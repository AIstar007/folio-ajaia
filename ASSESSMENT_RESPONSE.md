# Ajaia AI-Native Full Stack Developer Assignment

**Candidate:** Alen Thomas  
**Project:** Folio — a lightweight shared document workspace

## 1. Product overview

Folio is a focused document workspace built around the core shared-work loop: create a document, edit and format it in the browser, save and reopen it, import existing text, and share it with teammates under explicit permissions. I prioritized a coherent end-to-end slice over recreating the breadth of Google Docs.

## 2. Implemented functionality

- **Document lifecycle:** create, rename, rich-text edit, autosave, refresh, reopen, list, search, and distinguish owned from shared documents.
- **Formatting:** bold, italic, underline, paragraph and heading levels, text size, ordered/unordered lists, block quotes, links, horizontal rules, undo, and redo.
- **File import:** UTF-8 `.txt`, `.md`, and `.markdown` files up to 2 MB become editable documents. Unsupported extensions and invalid encoding are rejected.
- **Sharing:** three seeded demo identities; owners can invite a teammate as viewer/editor, change access, or revoke access.
- **Document organization:** per-user Starred, document duplication, a Trash view, restore, and confirmed permanent deletion.
- **Navigation and export:** clickable Folio logo, Workspace breadcrumb, browser back/forward support, HTML/text download, and print / Save PDF.
- **Authorization:** API-level owner/editor/viewer checks. Viewers cannot write; only owners can manage shares or delete the original; shared users can duplicate a document into their own workspace.
- **Persistence and safety:** SQLite storage, server-side HTML allow-list sanitization, request validation, and visible autosave status.

## 3. Architecture and technical decisions

- **Backend:** FastAPI with SQLite and Pydantic request validation.
- **Frontend:** HTML, responsive CSS, and vanilla JavaScript. No frontend build step is required.
- **Document model:** document metadata and sanitized HTML content are stored in `documents`; sharing roles are stored in `shares`; per-user favorites are in `favorites`; a `trashed_at` field supports soft-delete.
- **Access model:** each API request resolves a seeded user from `X-User-Email`, then checks ownership or an explicit share before returning or mutating a document.
- **Autosave:** the browser waits for 750 ms of inactivity before sending changes, displays save state, and serializes in-flight saves.

The demo identity selector is intentionally mocked to make reviewer testing fast. It is not production authentication. See `ARCHITECTURE.md` for the data flow, tradeoffs, and follow-on design.

## 4. Verification

Recorded checks:

- `python -m py_compile app/main.py` — passed.
- `node --check app/static/app.js` — passed.
- `pytest -q` — 7 passed.
- Local TestClient HTTP smoke checks for `/api/health`, `/api/documents`, and `/api/trash` — HTTP 200.

The automated tests cover CRUD persistence, HTML sanitization, sharing permissions, import validation, private-document isolation, Trash/restore/permanent delete, Starred, duplication, and the schema migration. Chromium navigation was blocked by the execution sandbox, so complete the manual QA checklist in `VERIFICATION.md` before submission.

## 5. AI-native workflow

I used ChatGPT (GPT-6) to decompose the requirements, reason about scope and tradeoffs, draft the initial implementation and API/test structure, and prepare the handoff documentation. I kept judgment over the implementation boundaries: mocked identity is labelled as a prototype, permissions are enforced server-side, imported/editor HTML is sanitized, and real-time collaboration was not added at the expense of core flows. I used executable tests and HTTP checks to validate the backend rather than treating generated code as correct by default. Full detail is in `AI_WORKFLOW.md`.

## 6. Deliberate scope cuts and next work

Not included: real authentication, simultaneous multi-user editing, presence indicators, comments, version history, folders, DOCX/PDF import, and enterprise audit/notification workflows. The current free Render Blueprint uses an ephemeral filesystem; it supports refresh persistence while the service instance is running but is not durable across restarts. A persistent disk or managed Postgres is needed for durable hosted persistence.

With another 2–4 hours, I would prioritize a verified deployment with durable storage, real session-based authentication, and an optimistic document version check to prevent silent last-write-wins conflicts. After that, I would replace the browser editing API with Tiptap/ProseMirror and add document version history and concurrency/paste tests.

## 7. Deliverable links — complete before pressing Submit

- **Google Drive folder:** `[PASTE DRIVE FOLDER URL]`
- **Live product:** `[PASTE DEPLOYED APP URL]`
- **Walkthrough video (3–5 minutes):** `[PASTE PUBLIC VIDEO URL]`
- **Source code:** included in the Drive folder as the `ajaia-docs` project directory.
- **Review accounts:** `alen@demo.local` (owner), `priya@demo.local` (collaborator), `alex@demo.local` (collaborator). No passwords; use the account selector in the app.

Do not submit this response with placeholder links. Replace all three URLs after uploading, deploying, and recording.

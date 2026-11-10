# Verification record

Executed in the build workspace on 2026-11-11.

| Check | Result | Notes |
|---|---|---|
| Python compile check | PASS | `python -m py_compile app/main.py` |
| JavaScript syntax check | PASS | `node --check app/static/app.js` |
| Automated API tests | PASS | `pytest -q` — 7 passed |
| Local HTTP smoke test | PASS | `/api/health` returned `{"status":"ok","service":"folio"}` from Uvicorn |
| Browser-driven UI pass | BLOCKED | Chromium navigation to both the local development server and local file URL was blocked by the execution sandbox (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). This is an environment limitation, not a product result. Complete the walkthrough manually in a normal browser. |

The seven API test functions cover:

- Create, update, sanitize, and reopen a document.
- Viewer write denial and editor write access.
- Markdown import and unsupported extension rejection.
- Private-document isolation.
- Owner-only Trash, restore, and permanent deletion.
- Starred state and independent duplication.
- Forward migration from the original database schema.

## Manual browser QA still recommended

1. Click the Folio logo while in a document; confirm it returns to the workspace.
2. Open a document, use browser Back, and then Forward; confirm the editor/home view follows the URL history.
3. Create a document, edit it, wait for `All changes saved`, refresh, and reopen it.
4. Star a document and verify it appears in Starred; toggle it off.
5. Duplicate a document and verify the copy is independent.
6. Rename from the card action menu and from the title field.
7. Move a document to Trash, restore it, then move it to Trash and permanently delete it.
8. Import `.md` / `.txt`, try an unsupported file, and test share viewer/editor behavior.
9. Use Download HTML, Download plain text, and Print / Save PDF.

Do not describe the browser walkthrough as verified until these checks have been completed locally.

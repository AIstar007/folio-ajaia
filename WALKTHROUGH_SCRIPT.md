# Folio walkthrough script (3–5 minutes)

## 0:00–0:30 — Product and home

“Folio is a focused collaborative document workspace. The goal was not to recreate every feature in Google Docs, but to deliver the core document lifecycle with a coherent, reviewer-friendly interface.”

Show the cream/green workspace, click the Folio mark to demonstrate home navigation, and point out All documents, My documents, Shared with me, Starred, Trash, search, and the account selector.

## 0:30–1:30 — Create and edit

Create a new document, rename it, add a heading and a short list, and use bold/italic/underline, text size, quote, and link controls. Mention autosave, word/character count, manual save, browser back/forward, and the print/export actions.

## 1:30–2:15 — File import and document management

Import a small `.md` or `.txt` file. Return home and demonstrate Starred, Make a copy, Rename, and Move to Trash. Open Trash, restore the item, and explain that permanent deletion is a separate, confirmed action.

## 2:15–3:15 — Sharing and permissions

As Alen, share a document with Priya as Viewer. Switch to Priya and show that the document is read-only. Switch back to Alen, change the share to Editor, switch to Priya, and make a small edit. Mention that API routes enforce permissions independently of the UI.

## 3:15–4:00 — Engineering and AI workflow

Explain the FastAPI + SQLite backend, HTML sanitization, per-user Starred state, soft-delete migration, and seven API test functions. Describe using ChatGPT to decompose the scope and draft code/tests, then checking behavior with pytest, syntax checks, and an HTTP smoke request. Be transparent that the full browser QA is still a manual verification step if not completed before recording.

## 4:00–4:30 — Tradeoffs and next steps

“The timebox went to the full document lifecycle, a working editor, import, and server-side sharing rules. I intentionally deferred real authentication, real-time multi-cursor collaboration, comments, version history, folders, and more document formats. Next I’d move the editor to Tiptap/ProseMirror, add Postgres and authenticated sessions, then build versioning and collaboration with a CRDT.”

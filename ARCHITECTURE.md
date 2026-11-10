# Architecture note — Folio

## Product slice

Folio is a lightweight document workspace with a document lifecycle: create, edit, import, share, organize, export, and delete safely. Documents store a sanitized HTML body and metadata. A `shares` relation grants a seeded user either `viewer` or `editor` access. A `favorites` relation stores per-user Starred state. A nullable `trashed_at` timestamp implements reversible deletion.

## Request and data flow

1. The browser selects a seeded identity and sends it in `X-User-Email` on API requests.
2. FastAPI validates the identity against `users` before reading or mutating data.
3. The access helper resolves owner/editor/viewer access. Missing access is returned as `404`; write attempts by viewers are `403`.
4. The editor sends title and HTML to `PUT /api/documents/{id}` after an idle debounce. The API sanitizes HTML with an allow-list before storing it.
5. SQLite stores documents, share grants, and per-user favorites. Foreign keys and uniqueness constraints maintain the relationships.
6. Import accepts UTF-8 `.txt`, `.md`, and `.markdown`, converts the content to HTML, sanitizes it, and creates a document owned by the current user.
7. Deleting an owned document sets `trashed_at` rather than removing the row. The normal list and document access omit trashed records. The owner can restore it, or permanently delete it from Trash. Shares and favorites are cascade-deleted only on permanent deletion.
8. Duplicating a document creates an independent copy owned by the acting user and does not copy sharing grants.

## Main components

- `app/main.py`: app factory, SQLite schema/seed data, forward-only schema migration, validation models, authorization helpers, and API routes.
- `app/static/index.html`: application shell, workspace navigation, editor toolbar, sharing dialog, and confirmation dialog.
- `app/static/styles.css`: responsive workspace, document cards, contextual action menus, editor paper, and modal surfaces.
- `app/static/app.js`: UI state, API client, autosave, History API navigation, import/export, Starred, Trash, duplicate, and sharing interactions.
- `tests/test_app.py`: API-level regression tests for persistence, sanitization, sharing authorization, import validation, Trash, Starred, duplication, and schema migration.

## Navigation model

The frontend uses the browser History API. Opening a document pushes a `?doc=<id>` location; switching workspace views pushes `?view=<filter>`. The `popstate` handler flushes pending edits, resolves the destination, reloads the accessible document list, and restores the selected page. The Folio mark and Workspace breadcrumb navigate to the workspace home. This supports browser back/forward without a client-side routing dependency.

## Product and engineering tradeoffs

- **Vanilla frontend over a framework:** avoids a build pipeline and keeps setup friction low. The app is small enough for explicit client state.
- **SQLite over Postgres:** fast local setup and no external service credentials. A multi-instance production service would move to managed Postgres.
- **Mocked identity over auth:** lets reviewers exercise ownership and sharing quickly. The identity header is not secure and is clearly labelled demo-only.
- **HTML body over a custom document AST:** expedites headings/lists/inline formatting. The server sanitizes the allow-listed subset. A production editor should use Tiptap/ProseMirror with schema-based JSON.
- **Soft-delete over immediate deletion:** prevents accidental loss and provides a restore flow; permanent deletion requires a second explicit action.
- **Autosave over explicit save:** keeps the editor workflow natural. Save failures are surfaced, but concurrent simultaneous edits are not conflict-resolved.

## Follow-on work

1. Replace demo identity with verified email login and secure server-side sessions.
2. Move persistence to Postgres and add optimistic concurrency (`version`/ETag) to prevent last-write-wins overwrites.
3. Adopt Tiptap/ProseMirror with a structured schema, paste sanitization, accessibility testing, and editor unit tests.
4. Add real-time presence and collaboration using WebSockets plus Yjs/CRDTs.
5. Add document version history, comments, audit events, folders, and an invitation/notification flow.

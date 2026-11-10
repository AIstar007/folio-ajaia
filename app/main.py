from __future__ import annotations

import os
import re
import sqlite3
from html import unescape
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import bleach
import mistune
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MAX_CONTENT_CHARS = 500_000
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
ALLOWED_EXTENSIONS = {".txt", ".md", ".markdown"}
ALLOWED_TAGS = set(bleach.sanitizer.ALLOWED_TAGS).union(
    {"p", "h1", "h2", "h3", "h4", "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code", "span", "div", "u", "s", "del", "table", "thead", "tbody", "tr", "th", "td"}
)
ALLOWED_ATTRIBUTES = {"a": ["href", "title"]}

DEMO_USERS = [
    {"email": "alen@demo.local", "name": "Alen Thomas"},
    {"email": "priya@demo.local", "name": "Priya Sharma"},
    {"email": "alex@demo.local", "name": "Alex Morgan"},
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content_html TEXT NOT NULL DEFAULT '',
                owner_email TEXT NOT NULL REFERENCES users(email),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                trashed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS shares (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email),
                role TEXT NOT NULL CHECK(role IN ('viewer', 'editor')),
                created_at TEXT NOT NULL,
                PRIMARY KEY(document_id, user_email)
            );
            CREATE TABLE IF NOT EXISTS favorites (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY(document_id, user_email)
            );
            CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_email);
            CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_email);
            CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_email);
            """
        )
        # Forward-only schema migration for databases created by Folio v1.
        document_columns = {row[1] for row in conn.execute("PRAGMA table_info(documents)")}
        if "trashed_at" not in document_columns:
            conn.execute("ALTER TABLE documents ADD COLUMN trashed_at TEXT")
        for user in DEMO_USERS:
            conn.execute(
                "INSERT OR IGNORE INTO users(email, name) VALUES (?, ?)",
                (user["email"], user["name"]),
            )
        sample_id = "welcome-ajaia-doc"
        conn.execute(
            """INSERT OR IGNORE INTO documents
               (id, title, content_html, owner_email, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                sample_id,
                "Welcome to Folio",
                "<h1>Welcome to Folio</h1><p>A lightweight shared workspace for clear thinking and getting work done.</p><h2>Try the editor</h2><ul><li>Format text with the toolbar</li><li>Import a Markdown or text file</li><li>Share this document with Priya or Alex</li></ul><p>Your changes are saved automatically.</p>",
                "alen@demo.local",
                utc_now(),
                utc_now(),
            ),
        )
        conn.commit()


class DocumentCreate(BaseModel):
    title: str = Field(default="Untitled document", min_length=1, max_length=160)


class DocumentUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content_html: str = Field(max_length=MAX_CONTENT_CHARS)


class ShareCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: Literal["viewer", "editor"] = "viewer"


class ShareUpdate(BaseModel):
    role: Literal["viewer", "editor"]


def clean_html(value: str) -> str:
    cleaned = bleach.clean(
        value,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols={"http", "https", "mailto"},
        strip=True,
    )
    return bleach.linkify(cleaned, parse_email=False)


def require_user(conn: sqlite3.Connection, email: str | None) -> sqlite3.Row:
    if not email:
        raise HTTPException(status_code=401, detail="Choose a demo user to continue.")
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Unknown demo user.")
    return user


def get_access(conn: sqlite3.Connection, doc_id: str, user_email: str) -> tuple[sqlite3.Row, str]:
    doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc or doc["trashed_at"] is not None:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc["owner_email"] == user_email:
        return doc, "owner"
    share = conn.execute(
        "SELECT role FROM shares WHERE document_id = ? AND user_email = ?",
        (doc_id, user_email),
    ).fetchone()
    if not share:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc, share["role"]


def text_preview(content_html: str, limit: int = 150) -> str:
    plain = unescape(re.sub(r"<[^>]+>", " ", content_html or ""))
    return re.sub(r"\s+", " ", plain).strip()[:limit]


def document_payload(conn: sqlite3.Connection, doc: sqlite3.Row, current_email: str, role: str) -> dict:
    owner = conn.execute("SELECT name, email FROM users WHERE email = ?", (doc["owner_email"],)).fetchone()
    shares = conn.execute(
        """SELECT u.email, u.name, s.role FROM shares s
           JOIN users u ON u.email = s.user_email WHERE s.document_id = ? ORDER BY u.name""",
        (doc["id"],),
    ).fetchall()
    return {
        "id": doc["id"],
        "title": doc["title"],
        "content_html": doc["content_html"],
        "owner": dict(owner),
        "owner_email": doc["owner_email"],
        "access_role": role,
        "is_owner": doc["owner_email"] == current_email,
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
        "shares": [dict(s) for s in shares],
        "is_favorite": conn.execute(
            "SELECT 1 FROM favorites WHERE document_id = ? AND user_email = ?",
            (doc["id"], current_email),
        ).fetchone() is not None,
    }


def create_app(db_path: str | Path | None = None) -> FastAPI:
    resolved_db = str(db_path or os.getenv("DATABASE_PATH", "data/folio.db"))
    init_db(resolved_db)
    app = FastAPI(title="Folio", version="1.1.0", docs_url=None, redoc_url=None)
    app.state.db_path = resolved_db

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "folio"}

    @app.get("/api/users")
    def list_users():
        with closing(connect(app.state.db_path)) as conn:
            return [dict(row) for row in conn.execute("SELECT email, name FROM users ORDER BY name").fetchall()]

    @app.get("/api/documents")
    def list_documents(x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            rows = conn.execute(
                """SELECT d.*, CASE WHEN d.owner_email = ? THEN 'owner' ELSE s.role END AS access_role
                   FROM documents d LEFT JOIN shares s
                     ON s.document_id = d.id AND s.user_email = ?
                   WHERE (d.owner_email = ? OR s.user_email = ?) AND d.trashed_at IS NULL
                   ORDER BY d.updated_at DESC""",
                (user["email"], user["email"], user["email"], user["email"]),
            ).fetchall()
            result = []
            for row in rows:
                payload = document_payload(conn, row, user["email"], row["access_role"])
                item = {k: payload[k] for k in ("id", "title", "owner", "owner_email", "access_role", "is_owner", "updated_at", "is_favorite")}
                item["preview"] = text_preview(row["content_html"])
                result.append(item)
            return result

    @app.post("/api/documents", status_code=201)
    def create_document(body: DocumentCreate, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc_id = __import__("uuid").uuid4().hex
            now = utc_now()
            clean_title = body.title.strip() or "Untitled document"
            conn.execute(
                "INSERT INTO documents(id, title, content_html, owner_email, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?)",
                (doc_id, clean_title, user["email"], now, now),
            )
            conn.commit()
            doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return document_payload(conn, doc, user["email"], "owner")

    @app.get("/api/documents/{doc_id}")
    def get_document(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc, role = get_access(conn, doc_id, user["email"])
            return document_payload(conn, doc, user["email"], role)

    @app.put("/api/documents/{doc_id}")
    def update_document(doc_id: str, body: DocumentUpdate, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc, role = get_access(conn, doc_id, user["email"])
            if role == "viewer":
                raise HTTPException(status_code=403, detail="You have view-only access to this document.")
            title = body.title.strip()
            if not title:
                raise HTTPException(status_code=422, detail="Document title cannot be empty.")
            conn.execute(
                "UPDATE documents SET title = ?, content_html = ?, updated_at = ? WHERE id = ?",
                (title, clean_html(body.content_html), utc_now(), doc_id),
            )
            conn.commit()
            fresh = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return document_payload(conn, fresh, user["email"], role)

    @app.get("/api/trash")
    def list_trash(x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            rows = conn.execute(
                "SELECT * FROM documents WHERE owner_email = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC",
                (user["email"],),
            ).fetchall()
            result = []
            for row in rows:
                payload = document_payload(conn, row, user["email"], "owner")
                payload["trashed_at"] = row["trashed_at"]
                item = {k: payload[k] for k in ("id", "title", "owner", "owner_email", "access_role", "is_owner", "updated_at", "is_favorite", "trashed_at")}
                item["preview"] = text_preview(row["content_html"])
                result.append(item)
            return result

    @app.delete("/api/documents/{doc_id}", status_code=204)
    def trash_document(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc or doc["owner_email"] != user["email"]:
                raise HTTPException(status_code=404, detail="Document not found.")
            if doc["trashed_at"] is None:
                conn.execute("UPDATE documents SET trashed_at = ? WHERE id = ?", (utc_now(), doc_id))
                conn.commit()
            return Response(status_code=204)

    @app.post("/api/documents/{doc_id}/restore")
    def restore_document(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc or doc["owner_email"] != user["email"]:
                raise HTTPException(status_code=404, detail="Document not found.")
            if doc["trashed_at"] is None:
                raise HTTPException(status_code=409, detail="Document is not in the trash.")
            conn.execute("UPDATE documents SET trashed_at = NULL, updated_at = ? WHERE id = ?", (utc_now(), doc_id))
            conn.commit()
            return {"message": "Document restored."}

    @app.delete("/api/documents/{doc_id}/permanent", status_code=204)
    def permanently_delete_document(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc or doc["owner_email"] != user["email"]:
                raise HTTPException(status_code=404, detail="Document not found.")
            if doc["trashed_at"] is None:
                raise HTTPException(status_code=409, detail="Move the document to the trash before deleting it permanently.")
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
            conn.commit()
            return Response(status_code=204)

    @app.post("/api/documents/{doc_id}/duplicate", status_code=201)
    def duplicate_document(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            source, _ = get_access(conn, doc_id, user["email"])
            new_id = __import__("uuid").uuid4().hex
            now = utc_now()
            title = f"{source['title']} (copy)"[:160]
            conn.execute(
                "INSERT INTO documents(id, title, content_html, owner_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (new_id, title, source["content_html"], user["email"], now, now),
            )
            conn.commit()
            created = conn.execute("SELECT * FROM documents WHERE id = ?", (new_id,)).fetchone()
            return document_payload(conn, created, user["email"], "owner")

    @app.put("/api/documents/{doc_id}/favorite")
    def set_favorite(doc_id: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            get_access(conn, doc_id, user["email"])
            existing = conn.execute(
                "SELECT 1 FROM favorites WHERE document_id = ? AND user_email = ?",
                (doc_id, user["email"]),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM favorites WHERE document_id = ? AND user_email = ?", (doc_id, user["email"]))
                is_favorite = False
            else:
                conn.execute(
                    "INSERT INTO favorites(document_id, user_email, created_at) VALUES (?, ?, ?)",
                    (doc_id, user["email"], utc_now()),
                )
                is_favorite = True
            conn.commit()
            return {"is_favorite": is_favorite}

    @app.post("/api/documents/{doc_id}/shares", status_code=201)
    def create_share(doc_id: str, body: ShareCreate, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc, role = get_access(conn, doc_id, user["email"])
            if not doc["owner_email"] == user["email"]:
                raise HTTPException(status_code=403, detail="Only the document owner can manage sharing.")
            target_email = body.email.lower().strip()
            target = conn.execute("SELECT email FROM users WHERE email = ?", (target_email,)).fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="That email is not a seeded demo user.")
            if target_email == user["email"]:
                raise HTTPException(status_code=400, detail="You already own this document.")
            conn.execute(
                "INSERT INTO shares(document_id, user_email, role, created_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(document_id, user_email) DO UPDATE SET role = excluded.role, created_at = excluded.created_at",
                (doc_id, target_email, body.role, utc_now()),
            )
            conn.commit()
            return {"message": f"Shared with {target_email} as {body.role}.", "email": target_email, "role": body.role}

    @app.patch("/api/documents/{doc_id}/shares/{email}")
    def update_share(doc_id: str, email: str, body: ShareUpdate, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc, _ = get_access(conn, doc_id, user["email"])
            if doc["owner_email"] != user["email"]:
                raise HTTPException(status_code=403, detail="Only the document owner can manage sharing.")
            cursor = conn.execute(
                "UPDATE shares SET role = ? WHERE document_id = ? AND user_email = ?",
                (body.role, doc_id, email.lower()),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Share not found.")
            conn.commit()
            return {"message": "Permission updated.", "role": body.role}

    @app.delete("/api/documents/{doc_id}/shares/{email}", status_code=204)
    def delete_share(doc_id: str, email: str, x_user_email: str | None = Header(default=None)):
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc, _ = get_access(conn, doc_id, user["email"])
            if doc["owner_email"] != user["email"]:
                raise HTTPException(status_code=403, detail="Only the document owner can manage sharing.")
            conn.execute("DELETE FROM shares WHERE document_id = ? AND user_email = ?", (doc_id, email.lower()))
            conn.commit()
            return Response(status_code=204)

    @app.post("/api/import")
    async def import_file(file: UploadFile = File(...), x_user_email: str | None = Header(default=None)):
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=415, detail="Supported files: .txt, .md, .markdown")
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File is larger than the 2 MB limit.")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Please upload a UTF-8 encoded text file.")
        title = Path(file.filename or "Imported document").stem[:160] or "Imported document"
        if ext in {".md", ".markdown"}:
            html = mistune.create_markdown(plugins=["table", "strikethrough"])(text)
        else:
            html = "".join(f"<p>{bleach.clean(line) if line else '&nbsp;'}</p>" for line in text.splitlines())
            if not text.strip():
                html = "<p></p>"
        with closing(connect(app.state.db_path)) as conn:
            user = require_user(conn, x_user_email)
            doc_id = __import__("uuid").uuid4().hex
            now = utc_now()
            conn.execute(
                "INSERT INTO documents(id, title, content_html, owner_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (doc_id, title, clean_html(html), user["email"], now, now),
            )
            conn.commit()
            doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return document_payload(conn, doc, user["email"], "owner")

    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()

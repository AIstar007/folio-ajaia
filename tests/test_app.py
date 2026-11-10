from fastapi.testclient import TestClient

from app.main import create_app


def client_for(tmp_path):
    app = create_app(tmp_path / "test.db")
    return TestClient(app)


def headers(email="alen@demo.local"):
    return {"X-User-Email": email}


def test_create_update_and_reopen_document(tmp_path):
    client = client_for(tmp_path)
    created = client.post("/api/documents", headers=headers(), json={"title": "Sprint notes"})
    assert created.status_code == 201
    doc_id = created.json()["id"]

    saved = client.put(
        f"/api/documents/{doc_id}",
        headers=headers(),
        json={"title": "Sprint notes — week 1", "content_html": "<h1>Plan</h1><p><strong>Ship</strong> the editor.</p><script>alert(1)</script>"},
    )
    assert saved.status_code == 200
    assert "<strong>Ship</strong>" in saved.json()["content_html"]
    assert "<script>" not in saved.json()["content_html"]

    reopened = client.get(f"/api/documents/{doc_id}", headers=headers())
    assert reopened.status_code == 200
    assert reopened.json()["title"] == "Sprint notes — week 1"
    assert "Plan" in reopened.json()["content_html"]
    listed = client.get("/api/documents", headers=headers()).json()
    assert "Ship the editor" in next(row for row in listed if row["id"] == doc_id)["preview"]


def test_sharing_enforces_viewer_and_editor_permissions(tmp_path):
    client = client_for(tmp_path)
    created = client.post("/api/documents", headers=headers(), json={"title": "Team plan"})
    doc_id = created.json()["id"]

    grant = client.post(
        f"/api/documents/{doc_id}/shares",
        headers=headers(),
        json={"email": "priya@demo.local", "role": "viewer"},
    )
    assert grant.status_code == 201
    assert client.get(f"/api/documents/{doc_id}", headers=headers("priya@demo.local")).status_code == 200
    denied = client.put(
        f"/api/documents/{doc_id}",
        headers=headers("priya@demo.local"),
        json={"title": "No edit", "content_html": "<p>Unauthorized</p>"},
    )
    assert denied.status_code == 403

    upgrade = client.patch(
        f"/api/documents/{doc_id}/shares/priya@demo.local",
        headers=headers(),
        json={"role": "editor"},
    )
    assert upgrade.status_code == 200
    allowed = client.put(
        f"/api/documents/{doc_id}",
        headers=headers("priya@demo.local"),
        json={"title": "Edited by Priya", "content_html": "<p>Collaborative edit</p>"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["title"] == "Edited by Priya"


def test_import_markdown_and_reject_unsupported_files(tmp_path):
    client = client_for(tmp_path)
    imported = client.post(
        "/api/import",
        headers=headers(),
        files={"file": ("brief.md", b"# Launch plan\n\n- Scope\n- Timeline", "text/markdown")},
    )
    assert imported.status_code == 200
    assert imported.json()["title"] == "brief"
    assert "<h1>Launch plan</h1>" in imported.json()["content_html"]
    rejected = client.post(
        "/api/import",
        headers=headers(),
        files={"file": ("archive.exe", b"nope", "application/octet-stream")},
    )
    assert rejected.status_code == 415


def test_document_is_hidden_from_non_shared_users_and_in_lists(tmp_path):
    client = client_for(tmp_path)
    created = client.post("/api/documents", headers=headers(), json={"title": "Private notes"})
    doc_id = created.json()["id"]
    forbidden = client.get(f"/api/documents/{doc_id}", headers=headers("alex@demo.local"))
    assert forbidden.status_code == 404
    shared_list_before = client.get("/api/documents", headers=headers("priya@demo.local"))
    assert all(item["id"] != doc_id for item in shared_list_before.json())
    client.post(f"/api/documents/{doc_id}/shares", headers=headers(), json={"email":"priya@demo.local", "role":"viewer"})
    shared_list_after = client.get("/api/documents", headers=headers("priya@demo.local"))
    assert any(item["id"] == doc_id and item["access_role"] == "viewer" for item in shared_list_after.json())


def test_trash_restore_and_permanent_delete_are_owner_only(tmp_path):
    client = client_for(tmp_path)
    created = client.post("/api/documents", headers=headers(), json={"title": "Delete me"})
    doc_id = created.json()["id"]
    client.post(
        f"/api/documents/{doc_id}/shares",
        headers=headers(),
        json={"email": "priya@demo.local", "role": "editor"},
    )

    denied = client.delete(f"/api/documents/{doc_id}", headers=headers("priya@demo.local"))
    assert denied.status_code == 404

    trashed = client.delete(f"/api/documents/{doc_id}", headers=headers())
    assert trashed.status_code == 204
    assert all(row["id"] != doc_id for row in client.get("/api/documents", headers=headers()).json())
    assert any(row["id"] == doc_id for row in client.get("/api/trash", headers=headers()).json())
    assert client.get(f"/api/documents/{doc_id}", headers=headers()).status_code == 404
    assert client.get(f"/api/documents/{doc_id}", headers=headers("priya@demo.local")).status_code == 404

    restored = client.post(f"/api/documents/{doc_id}/restore", headers=headers())
    assert restored.status_code == 200
    assert any(row["id"] == doc_id for row in client.get("/api/documents", headers=headers()).json())

    client.delete(f"/api/documents/{doc_id}", headers=headers())
    permanent = client.delete(f"/api/documents/{doc_id}/permanent", headers=headers())
    assert permanent.status_code == 204
    assert all(row["id"] != doc_id for row in client.get("/api/trash", headers=headers()).json())


def test_star_and_duplicate_document(tmp_path):
    client = client_for(tmp_path)
    created = client.post("/api/documents", headers=headers(), json={"title": "Research brief"})
    doc_id = created.json()["id"]
    client.put(
        f"/api/documents/{doc_id}",
        headers=headers(),
        json={"title": "Research brief", "content_html": "<h1>Findings</h1><p>Useful notes.</p>"},
    )

    starred = client.put(f"/api/documents/{doc_id}/favorite", headers=headers())
    assert starred.status_code == 200 and starred.json()["is_favorite"] is True
    listed = client.get("/api/documents", headers=headers()).json()
    assert next(row for row in listed if row["id"] == doc_id)["is_favorite"] is True

    copied = client.post(f"/api/documents/{doc_id}/duplicate", headers=headers())
    assert copied.status_code == 201
    assert copied.json()["title"] == "Research brief (copy)"
    assert "Findings" in copied.json()["content_html"]
    assert copied.json()["owner_email"] == "alen@demo.local"

    unstarred = client.put(f"/api/documents/{doc_id}/favorite", headers=headers())
    assert unstarred.status_code == 200 and unstarred.json()["is_favorite"] is False


def test_old_database_schema_is_migrated(tmp_path):
    import sqlite3
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE documents (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, content_html TEXT NOT NULL DEFAULT '',
            owner_email TEXT NOT NULL REFERENCES users(email), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE shares (
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            user_email TEXT NOT NULL REFERENCES users(email), role TEXT NOT NULL CHECK(role IN ('viewer', 'editor')),
            created_at TEXT NOT NULL, PRIMARY KEY(document_id, user_email)
        );
        """
    )
    conn.commit()
    conn.close()

    app = create_app(db_path)
    with sqlite3.connect(app.state.db_path) as migrated:
        columns = {row[1] for row in migrated.execute("PRAGMA table_info(documents)")}
        assert "trashed_at" in columns
        assert migrated.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 3

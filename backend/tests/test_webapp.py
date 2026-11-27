import http.server
import threading

import pytest
from conftest import H, bm, make_user
from sqlalchemy import create_engine

from app.migrate import migrate
from app.services import fetcher


def push(client, auth, **body):
    body.setdefault("since", 0)
    r = client.post("/api/v1/sync", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def cookie_login(client, user="admin", password="admin-pass-1"):
    client.cookies.clear()
    assert client.post("/ui/login", headers=H, json={"username": user, "password": password}).status_code == 200


# ---------- new bookmark fields and boards ----------

def test_new_fields_roundtrip(client, admin):
    push(client, admin, boards=[{"id": "brd-00000001", "name": "Design", "emoji": "🎨", "color": "#3b82f6", "created_at": 1, "updated_at": 1}],
         bookmarks=[bm("bm-00000001", starred=True, pinned=True, image="https://x.test/i.png", boards=["brd-00000001"], status="reading")])
    got = client.get("/api/v1/sync?since=0", headers=admin).json()
    b = got["bookmarks"][0]
    assert (b["starred"], b["pinned"], b["image"], b["boards"], b["status"]) == (True, True, "https://x.test/i.png", ["brd-00000001"], "reading")
    assert got["boards"][0]["emoji"] == "🎨"


def test_omitted_fields_are_not_wiped(client, admin):
    """An older client (e.g. the extension before an update) does not send new fields."""
    push(client, admin, bookmarks=[bm("bm-00000001", starred=True, tags=["a"], notes="keep me")])
    # update that only knows about title
    r = client.post("/api/v1/sync", headers=admin, json={"since": 0, "bookmarks": [{"id": "bm-00000001", "url": "https://example.com", "title": "renamed", "updated_at": 5000}]})
    b = r.json()["bookmarks"][0]
    assert b["title"] == "renamed" and b["starred"] is True and b["tags"] == ["a"] and b["notes"] == "keep me"


def test_rejects_non_http_images(client, admin):
    r = client.post("/api/v1/sync", headers=admin, json={"bookmarks": [bm("bm-00000001", image="javascript:alert(1)")]})
    assert r.status_code == 422
    r = client.post("/api/v1/sync", headers=admin, json={"bookmarks": [bm("bm-00000001", favicon="data:text/html,x")]})
    assert r.status_code == 422


def test_boards_visibility_and_permissions(client, admin):
    bob = make_user(client, admin, "bob")
    push(client, admin, boards=[{"id": "brd-00000001", "name": "Team", "scope": "global", "created_at": 1, "updated_at": 1},
                                {"id": "brd-00000002", "name": "Mine", "created_at": 1, "updated_at": 1}])
    seen = client.get("/api/v1/sync?since=0", headers=bob).json()["boards"]
    assert [b["id"] for b in seen] == ["brd-00000001"]
    r = push(client, bob, boards=[{"id": "brd-00000001", "name": "hijack", "created_at": 1, "updated_at": 9999}])
    assert r["rejected"][0]["reason"] == "forbidden"
    r = push(client, bob, boards=[{"id": "brd-00000009", "name": "x", "scope": "global", "created_at": 1, "updated_at": 1}])
    assert r["rejected"][0]["reason"] == "forbidden_global"


# ---------- cookie-based web sync ----------

def test_web_sync_matches_extension_sync(client, admin):
    cookie_login(client)
    r = client.post("/ui/sync", headers=H, json={"since": 0, "bookmarks": [bm("bm-00000001", starred=True)]})
    assert r.status_code == 200 and r.json()["bookmarks"][0]["starred"] is True
    # the extension (Bearer) sees what the web app wrote
    assert client.get("/api/v1/sync?since=0", headers=admin).json()["bookmarks"][0]["id"] == "bm-00000001"
    assert client.get("/ui/sync?since=0", headers=H).json()["rev"] >= 1


def test_web_sync_requires_login_and_csrf(client, admin):
    client.cookies.clear()
    assert client.get("/ui/sync").status_code == 401
    cookie_login(client)
    assert client.post("/ui/sync", json={"since": 0}).status_code == 403  # no X-SBM / Origin


def test_pages_are_served(client):
    assert "Smart Bookmark Manager" in client.get("/").text
    assert client.get("/account").status_code == 200
    assert client.get("/static/web/js/main.js").status_code == 200


# ---------- SSRF-safe fetcher ----------

@pytest.mark.parametrize("ip,public", [("127.0.0.1", False), ("10.1.2.3", False), ("192.168.1.5", False), ("169.254.169.254", False),
                                       ("100.64.0.1", False), ("::1", False), ("::ffff:127.0.0.1", False), ("fd00::1", False),
                                       ("8.8.8.8", True), ("2606:4700:4700::1111", True)])
def test_is_public_ip(ip, public):
    assert fetcher.is_public_ip(ip) is public


def test_fetch_blocks_private_targets(client, admin):
    for url in ("http://127.0.0.1:1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "ftp://example.com/", "file:///etc/passwd"):
        r = fetcher.fetch_meta(url)
        assert r["ok"] is False and r["error"] in ("blocked_address", "unsupported_url", "host_not_found"), (url, r)


def test_fetch_meta_endpoint_requires_login(client, admin):
    client.cookies.clear()
    assert client.post("/ui/fetch-meta", headers=H, json={"url": "https://example.com"}).status_code == 401
    cookie_login(client)
    r = client.post("/ui/fetch-meta", headers=H, json={"url": "http://127.0.0.1:9/"})
    assert r.status_code == 200 and r.json() == {"ok": False, "error": "blocked_address"}


PAGE = b"""<html><head><meta charset="utf-8"><title>Fallback title</title>
<meta property="og:title" content="OG Title"><meta property="og:description" content="  A  nice   page ">
<meta property="og:image" content="/img/cover.png"><link rel="icon" href="/fav.png"></head><body>hi</body></html>"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/page")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *a):
        pass


def test_fetch_meta_extracts_fields(monkeypatch):
    monkeypatch.setenv("SBM_FETCH_ALLOW_PRIVATE", "1")  # the test server is on localhost
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        r = fetcher.fetch_meta(f"http://127.0.0.1:{srv.server_port}/redirect")
    finally:
        srv.shutdown()
    assert r["ok"] is True
    assert r["title"] == "OG Title" and r["description"] == "A nice page"
    assert r["image"].endswith("/img/cover.png") and r["favicon"].endswith("/fav.png")


def test_parse_meta_falls_back():
    r = fetcher.parse_meta("<title> Hello  world </title>", "https://example.com/a/b")
    assert r["title"] == "Hello world" and r["favicon"] == "https://example.com/favicon.ico" and r["image"] == ""


# ---------- migration ----------

def test_migration_adds_columns_to_old_database():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE bookmarks (id TEXT PRIMARY KEY, url TEXT)")
        conn.exec_driver_sql("INSERT INTO bookmarks VALUES ('a', 'https://x.test')")
    migrate(engine)
    migrate(engine)  # idempotent
    with engine.begin() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(bookmarks)")}
        row = conn.exec_driver_sql("SELECT starred, pinned, image, boards FROM bookmarks").first()
    assert {"starred", "pinned", "image", "boards"} <= cols
    assert tuple(row) == (0, 0, "", "[]")


def test_extension_download(client, admin):
    import io
    import zipfile
    from pathlib import Path

    assert client.get("/ui/extension.zip").status_code == 401
    cookie_login(client)
    r = client.get("/ui/extension.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "smart-bookmark-extension/manifest.json" in names
    # the committed zip must match extension/ (run scripts/build-extension-zip.py after changes)
    src = Path(__file__).resolve().parents[2] / "extension"
    expected = sorted("smart-bookmark-extension/" + p.relative_to(src).as_posix() for p in src.rglob("*") if p.is_file() and p.name != ".DS_Store")
    assert sorted(names) == expected
    z = zipfile.ZipFile(io.BytesIO(r.content))
    for p in src.rglob("*"):
        if p.is_file() and p.name != ".DS_Store":
            assert z.read("smart-bookmark-extension/" + p.relative_to(src).as_posix()) == p.read_bytes(), p

import os
import tempfile

# Must be set before the app is imported (the DB path is fixed at import time).
os.environ["SBM_DATA_DIR"] = tempfile.mkdtemp(prefix="sbm-test-")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app, init_db  # noqa: E402
from app.routers import api as api_router  # noqa: E402

H = {"X-SBM": "1"}


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS bookmarks_fts")
    api_router._FAILS.clear()
    init_db()
    with TestClient(app) as c:
        yield c


def login(client, username, password):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture()
def admin(client):
    """Admin with the forced password change done."""
    auth = login(client, "admin", "admin")
    r = client.post("/api/v1/auth/change-password", headers=auth, json={"current_password": "admin", "new_password": "admin-pass-1"})
    assert r.status_code == 200
    return auth


def make_user(client, admin_auth, name, password="password-1"):
    """Create a user through the cookie UI as admin, then log in via token."""
    c = client
    r = c.post("/ui/login", headers=H, json={"username": "admin", "password": "admin-pass-1"})
    assert r.status_code == 200, r.text
    r = c.post("/ui/users", headers=H, json={"username": name, "password": "temp-pass-1", "role": "user"})
    assert r.status_code == 200, r.text
    c.cookies.clear()
    auth = login(c, name, "temp-pass-1")
    r = c.post("/api/v1/auth/change-password", headers=auth, json={"current_password": "temp-pass-1", "new_password": password})
    assert r.status_code == 200
    return auth


def bm(id_, url="https://example.com", **kw):
    base = {"id": id_, "url": url, "title": "Example", "created_at": 1000, "updated_at": 1000}
    base.update(kw)
    return base

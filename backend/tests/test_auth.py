from conftest import H, login


def test_default_admin_must_change_password(client):
    auth = login(client, "admin", "admin")
    assert client.get("/api/v1/me", headers=auth).json()["must_change_password"] is True
    # everything but change-password is blocked
    r = client.get("/api/v1/sync", headers=auth)
    assert r.status_code == 403 and r.json()["detail"] == "password_change_required"


def test_change_password_rules(client):
    auth = login(client, "admin", "admin")
    bad = client.post("/api/v1/auth/change-password", headers=auth, json={"current_password": "admin", "new_password": "admin"})
    assert bad.status_code in (400, 422)
    wrong = client.post("/api/v1/auth/change-password", headers=auth, json={"current_password": "nope", "new_password": "long-enough-1"})
    assert wrong.status_code == 400
    ok = client.post("/api/v1/auth/change-password", headers=auth, json={"current_password": "admin", "new_password": "long-enough-1"})
    assert ok.status_code == 200
    assert client.get("/api/v1/sync", headers=auth).status_code == 200
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"}).status_code == 401


def test_requires_token(client):
    assert client.get("/api/v1/sync").status_code == 401
    assert client.get("/api/v1/sync", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_logout_revokes_token(client, admin):
    assert client.post("/api/v1/auth/logout", headers=admin).status_code == 200
    assert client.get("/api/v1/me", headers=admin).status_code == 401


def test_login_throttle(client):
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "x"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "x"}).status_code == 429


def test_csrf_blocks_cookie_write_without_header(client):
    assert client.post("/ui/login", headers=H, json={"username": "admin", "password": "admin"}).status_code == 200
    r = client.post("/ui/logout")  # cookie present, no X-SBM, no Origin
    assert r.status_code == 403
    r = client.post("/ui/logout", headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    r = client.post("/ui/logout", headers={"Origin": "http://testserver"})
    assert r.status_code == 200


def test_admin_only_endpoints(client, admin):
    from conftest import make_user

    make_user(client, admin, "bob")
    assert client.post("/ui/login", headers=H, json={"username": "bob", "password": "password-1"}).status_code == 200
    assert client.get("/ui/users", headers=H).status_code == 403
    assert client.get("/ui/server-settings", headers=H).status_code == 403


def test_registration_toggle(client, admin):
    assert client.post("/ui/register", headers=H, json={"username": "eve", "password": "password-1"}).status_code == 403
    client.post("/ui/login", headers=H, json={"username": "admin", "password": "admin-pass-1"})
    assert client.put("/ui/server-settings", headers=H, json={"allow_registration": True}).status_code == 200
    client.cookies.clear()
    assert client.post("/ui/register", headers=H, json={"username": "eve", "password": "password-1"}).status_code == 200

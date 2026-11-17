from conftest import H, bm, login, make_user


def push(client, auth, **body):
    body.setdefault("since", 0)
    r = client.post("/api/v1/sync", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_push_and_pull_roundtrip(client, admin):
    r = push(client, admin, bookmarks=[bm("bm-00000001", tags=["Docker", "docker", " tools "])])
    assert r["rev"] >= 1
    [b] = r["bookmarks"]
    assert b["tags"] == ["docker", "tools"]  # normalized + deduped
    pulled = client.get("/api/v1/sync?since=0", headers=admin).json()
    assert [x["id"] for x in pulled["bookmarks"]] == ["bm-00000001"]
    # nothing new after the cursor
    again = client.get(f"/api/v1/sync?since={r['rev']}", headers=admin).json()
    assert again["bookmarks"] == []


def test_last_write_wins_and_stale_is_returned(client, admin):
    push(client, admin, bookmarks=[bm("bm-00000001", title="new", updated_at=2000)])
    r = push(client, admin, since=999, bookmarks=[bm("bm-00000001", title="old", updated_at=1500)])
    [b] = r["bookmarks"]  # server returns its authoritative version for stale pushes
    assert b["title"] == "new"


def test_tombstones_sync(client, admin):
    first = push(client, admin, bookmarks=[bm("bm-00000001")])
    push(client, admin, since=first["rev"], bookmarks=[bm("bm-00000001", updated_at=3000, deleted=True)])
    pulled = client.get(f"/api/v1/sync?since={first['rev']}", headers=admin).json()
    assert pulled["bookmarks"][0]["deleted"] is True
    assert client.get("/api/v1/bookmarks", headers=admin).json() == []


def test_private_bookmarks_are_isolated(client, admin):
    bob = make_user(client, admin, "bob")
    push(client, admin, bookmarks=[bm("bm-00000001")])
    assert client.get("/api/v1/sync?since=0", headers=bob).json()["bookmarks"] == []
    # bob cannot overwrite admin's bookmark by reusing the id
    r = push(client, bob, bookmarks=[bm("bm-00000001", title="hijack", updated_at=9999)])
    assert r["rejected"][0]["reason"] == "forbidden"
    mine = client.get("/api/v1/sync?since=0", headers=admin).json()["bookmarks"]
    assert mine[0]["title"] == "Example"


def test_global_bookmarks(client, admin):
    bob = make_user(client, admin, "bob")
    push(client, admin, bookmarks=[bm("bm-glob0001", scope="global", title="Team wiki")])
    seen = client.get("/api/v1/sync?since=0", headers=bob).json()["bookmarks"]
    assert [b["id"] for b in seen] == ["bm-glob0001"]
    # non-admin cannot edit it, nor create global ones
    r = push(client, bob, bookmarks=[bm("bm-glob0001", title="edited", updated_at=5000)])
    assert r["rejected"][0]["reason"] == "forbidden"
    r = push(client, bob, bookmarks=[bm("bm-glob0002", scope="global")])
    assert r["rejected"][0]["reason"] == "forbidden_global"
    # bob can search it
    assert len(client.get("/api/v1/bookmarks?q=wiki", headers=bob).json()) == 1


def test_usage_is_per_user_and_additive(client, admin):
    bob = make_user(client, admin, "bob")
    push(client, admin, bookmarks=[bm("bm-glob0001", scope="global")])
    push(client, admin, usage=[{"bookmark_id": "bm-glob0001", "opens": 2, "last_opened_at": 5000}])
    push(client, admin, usage=[{"bookmark_id": "bm-glob0001", "opens": 3, "last_opened_at": 4000}])
    push(client, bob, usage=[{"bookmark_id": "bm-glob0001", "opens": 1, "last_opened_at": 7000}])
    a = client.get("/api/v1/sync?since=0", headers=admin).json()["usage"]
    b = client.get("/api/v1/sync?since=0", headers=bob).json()["usage"]
    assert a == [{"bookmark_id": "bm-glob0001", "open_count": 5, "last_opened_at": 5000}]
    assert b == [{"bookmark_id": "bm-glob0001", "open_count": 1, "last_opened_at": 7000}]


def test_usage_ignored_for_invisible_bookmark(client, admin):
    bob = make_user(client, admin, "bob")
    push(client, admin, bookmarks=[bm("bm-00000001")])
    r = push(client, bob, usage=[{"bookmark_id": "bm-00000001", "opens": 4, "last_opened_at": 1}])
    assert r["usage"] == []


def test_rejects_bad_input(client, admin):
    r = client.post("/api/v1/sync", headers=admin, json={"bookmarks": [bm("bm-00000001", url="javascript:alert(1)")]})
    assert r.status_code == 422
    r = client.post("/api/v1/sync", headers=admin, json={"bookmarks": [bm("bad id!")]})
    assert r.status_code == 422


def test_search_and_filters(client, admin):
    push(
        client,
        admin,
        collections=[{"id": "col-00000001", "name": "Work", "created_at": 1, "updated_at": 1}],
        bookmarks=[
            bm("bm-00000001", url="https://docs.docker.com", title="Docker docs", tags=["docker"], collection_id="col-00000001"),
            bm("bm-00000002", url="https://python.org", title="Python", tags=["python"], notes="snake language"),
        ],
    )
    q = lambda s: [b["id"] for b in client.get(s, headers=admin).json()]
    assert q("/api/v1/bookmarks?q=dock") == ["bm-00000001"]  # prefix match
    assert q("/api/v1/bookmarks?q=snake") == ["bm-00000002"]  # notes are indexed
    assert q("/api/v1/bookmarks?tag=python") == ["bm-00000002"]
    assert q("/api/v1/bookmarks?collection_id=col-00000001") == ["bm-00000001"]
    # FTS syntax is neutralised: operators become plain terms, never an error
    assert client.get('/api/v1/bookmarks?q="%20OR%20*', headers=admin).status_code == 200
    assert q("/api/v1/bookmarks?q=%22") == []  # no searchable terms


def test_settings_roundtrip(client, admin):
    assert client.get("/api/v1/settings", headers=admin).json()["unused_days"] == 90
    r = client.put("/api/v1/settings", headers=admin, json={"unused_days": 30, "auto_archive_unused": True, "top_n": 5})
    assert r.status_code == 200
    assert client.get("/api/v1/settings", headers=admin).json() == {"unused_days": 30, "auto_archive_unused": True, "top_n": 5}
    assert client.put("/api/v1/settings", headers=admin, json={"unused_days": 0}).status_code == 422


def test_delete_user_keeps_global_content(client, admin):
    bob = make_user(client, admin, "bob")
    client.post("/ui/login", headers=H, json={"username": "admin", "password": "admin-pass-1"})
    users = client.get("/ui/users", headers=H).json()
    bob_id = next(u["id"] for u in users if u["username"] == "bob")
    # make bob an admin so he can publish a global bookmark
    client.patch(f"/ui/users/{bob_id}", headers=H, json={"role": "admin"})
    push(client, bob, bookmarks=[bm("bm-glob0001", scope="global"), bm("bm-priv0001")])
    assert client.delete(f"/ui/users/{bob_id}", headers=H).status_code == 200
    ids = [b["id"] for b in client.get("/api/v1/sync?since=0", headers=admin).json()["bookmarks"]]
    assert ids == ["bm-glob0001"]
    assert client.get("/api/v1/me", headers=bob).status_code == 401

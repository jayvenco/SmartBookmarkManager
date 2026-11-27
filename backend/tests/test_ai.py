import http.server
import json
import threading
import time

import pytest
from conftest import H, bm, make_user

from app.services import ai, fetcher


def cookie_login(client, user="admin", password="admin-pass-1"):
    client.cookies.clear()
    assert client.post("/ui/login", headers=H, json={"username": user, "password": password}).status_code == 200


def push(client, auth, **body):
    body.setdefault("since", 0)
    r = client.post("/api/v1/sync", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def pull(client, auth):
    return {b["id"]: b for b in client.get("/api/v1/sync?since=0", headers=auth).json()["bookmarks"]}


@pytest.fixture()
def fake_model(monkeypatch):
    """Configured provider whose answers the test controls; no network."""
    state = {"reply": '{"tags": ["python", "tutorial"]}', "prompts": []}

    def fake_complete(cfg, system, user, max_tokens=300):
        state["prompts"].append(user)
        return state["reply"]

    monkeypatch.setattr(ai, "complete", fake_complete)
    monkeypatch.setattr(fetcher, "fetch_page", lambda url: {"ok": True, "text": "A page about python", "title": "", "description": ""})
    return state


def configure(client, **over):
    body = {"provider": "claude", "claude_key": "sk-test-secret", "claude_model": "claude-haiku-5-5"}
    body.update(over)
    r = client.put("/ui/ai-settings", headers=H, json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- parsing and normalisation ----------

@pytest.mark.parametrize("raw", [
    '{"tags": ["a", "b"]}',
    '```json\n{"tags": ["a", "b"]}\n```',
    'Sure! Here you go: {"tags": ["a", "b"]} Hope that helps.',
    '["a", "b"]',
])
def test_parse_tags_is_tolerant(raw):
    assert ai.parse_tags(raw) == ["a", "b"]


def test_parse_tags_rejects_garbage():
    with pytest.raises(ai.AIError):
        ai.parse_tags("no json here")


def test_normalize_matches_existing_tags():
    vocab = ["javascript", "home lab"]
    out = ai.normalize_tags(["#Java-Script", "Home_Lab", "  New Thing ", "x" * 80, "one two three four five", ""], vocab)
    assert out == ["javascript", "home lab", "new thing", "x" * 64]


def test_prompt_contains_known_tags_and_untrusted_notice():
    class B:
        url, title, description = "https://e.test", "T", "D"

    p = ai.build_prompt(B(), "body text", ["alpha", "beta"], dict(ai.DEFAULTS))
    assert "alpha, beta" in p and "untrusted" in p and "body text" in p


# ---------- admin settings ----------

def test_settings_are_admin_only_and_keys_never_returned(client, admin):
    user = make_user(client, admin, "carol")
    cookie_login(client, "carol", "password-1")
    assert client.get("/ui/ai-settings").status_code == 403
    assert client.put("/ui/ai-settings", headers=H, json={"provider": "none"}).status_code == 403

    cookie_login(client)
    out = configure(client)
    assert out["enabled"] and out["claude_key_set"] and "claude_key" not in out
    assert "sk-test-secret" not in client.get("/ui/ai-settings").text
    # omitting the key keeps it, empty string removes it
    assert configure(client, claude_key=None)["claude_key_set"] is True
    out = configure(client, claude_key="")
    assert out["claude_key_set"] is False and out["enabled"] is False
    assert client.put("/ui/ai-settings", headers=H, json={"provider": "local", "local_url": "ftp://x"}).status_code == 422


def test_ai_test_button(client, admin, fake_model):
    cookie_login(client)
    configure(client)
    fake_model["reply"] = "ok"
    assert client.post("/ui/ai-test", headers=H).json() == {"ok": True, "reply": "ok"}


# ---------- tagging ----------

def test_tag_requires_configuration(client, admin):
    push(client, admin, bookmarks=[bm("bm-00000001")])
    cookie_login(client)
    r = client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    assert r.status_code == 409


def test_tag_adds_ai_tags_and_keeps_human_tags(client, admin, fake_model):
    push(client, admin, bookmarks=[bm("bm-00000001", tags=["mine"])])
    cookie_login(client)
    configure(client)
    r = client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    assert r.json()["results"] == [{"id": "bm-00000001", "ok": True, "ai_tags": ["python", "tutorial"]}]
    b = pull(client, admin)["bm-00000001"]
    assert b["tags"] == ["mine", "python", "tutorial"] and b["ai_tags"] == ["python", "tutorial"]

    # re-tag replaces only the AI tags
    fake_model["reply"] = '{"tags": ["rust"]}'
    client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    b = pull(client, admin)["bm-00000001"]
    assert b["tags"] == ["mine", "rust"] and b["ai_tags"] == ["rust"]


def test_tag_change_is_synced_to_other_clients(client, admin, fake_model):
    push(client, admin, bookmarks=[bm("bm-00000001")])
    cursor = client.get("/api/v1/sync?since=0", headers=admin).json()["rev"]
    cookie_login(client)
    configure(client)
    client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    got = client.get(f"/api/v1/sync?since={cursor}", headers=admin).json()["bookmarks"]
    assert [b["ai_tags"] for b in got] == [["python", "tutorial"]]


def test_user_removing_an_ai_tag_clears_it_from_ai_tags(client, admin, fake_model):
    push(client, admin, bookmarks=[bm("bm-00000001")])
    cookie_login(client)
    configure(client)
    client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    later = int(time.time() * 1000) + 60_000  # the AI edit counts as a newer write
    push(client, admin, bookmarks=[bm("bm-00000001", tags=["tutorial"], updated_at=later)])
    b = pull(client, admin)["bm-00000001"]
    assert b["tags"] == ["tutorial"] and b["ai_tags"] == ["tutorial"]
    push(client, admin, bookmarks=[bm("bm-00000001", tags=[], updated_at=later + 1)])
    assert pull(client, admin)["bm-00000001"]["ai_tags"] == []


def test_existing_tags_are_offered_and_reused(client, admin, fake_model):
    push(client, admin, bookmarks=[bm("bm-00000001", tags=["javascript"]), bm("bm-00000002", url="https://b.test")])
    cookie_login(client)
    configure(client)
    fake_model["reply"] = '{"tags": ["Java-Script", "web"]}'
    client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000002"]})
    assert "javascript" in fake_model["prompts"][-1]
    assert pull(client, admin)["bm-00000002"]["tags"] == ["javascript", "web"]


def test_cannot_tag_someone_elses_bookmark(client, admin, fake_model):
    other = make_user(client, admin, "dave")
    push(client, other, bookmarks=[bm("bm-00000009")])
    cookie_login(client)
    configure(client)
    r = client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000009"]})
    assert r.json()["results"][0] == {"id": "bm-00000009", "ok": False, "error": "not_found"}


def test_model_errors_are_reported_per_bookmark(client, admin, fake_model):
    push(client, admin, bookmarks=[bm("bm-00000001")])
    cookie_login(client)
    configure(client)
    fake_model["reply"] = "I cannot do that"
    r = client.post("/ui/ai/tag", headers=H, json={"ids": ["bm-00000001"]})
    assert r.json()["results"][0] == {"id": "bm-00000001", "ok": False, "error": "provider_bad_response"}
    assert pull(client, admin)["bm-00000001"]["tags"] == []


# ---------- auto tagging on save ----------

def test_auto_tag_only_for_opted_in_users_and_untagged_bookmarks(client, admin, fake_model):
    cookie_login(client)
    configure(client)
    # not opted in: nothing happens
    push(client, admin, bookmarks=[bm("bm-00000001")])
    assert pull(client, admin)["bm-00000001"]["ai_tags"] == []
    # opt in
    assert client.put("/ui/ai-auto-tag", headers=H, json={"enabled": True}).json() == {"auto_tag": True}
    assert client.get("/ui/ai-status").json() == {"enabled": True, "provider": "claude", "auto_tag": True}
    push(client, admin, bookmarks=[bm("bm-00000002", url="https://b.test"), bm("bm-00000003", url="https://c.test", tags=["own"])])
    got = pull(client, admin)
    assert got["bm-00000002"]["ai_tags"] == ["python", "tutorial"]
    assert got["bm-00000003"]["ai_tags"] == [] and got["bm-00000003"]["tags"] == ["own"]
    # an update of an existing bookmark is not auto-tagged again
    push(client, admin, bookmarks=[bm("bm-00000001", title="renamed", updated_at=5000)])
    assert pull(client, admin)["bm-00000001"]["ai_tags"] == []


def test_auto_tag_failure_never_breaks_the_push(client, admin, monkeypatch):
    cookie_login(client)
    configure(client)
    client.put("/ui/ai-auto-tag", headers=H, json={"enabled": True})

    def boom(*a, **k):
        raise ai.AIError("provider_unreachable")

    monkeypatch.setattr(ai, "complete", boom)
    monkeypatch.setattr(fetcher, "fetch_page", lambda url: {"ok": True, "text": "x", "title": "", "description": ""})
    out = push(client, admin, bookmarks=[bm("bm-00000001")])
    assert [b["id"] for b in out["bookmarks"]] == ["bm-00000001"]


# ---------- provider wire format ----------

class _Provider(http.server.BaseHTTPRequestHandler):
    seen: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Provider.seen.append((self.path, dict(self.headers), body))
        if self.path.endswith("/messages"):
            out = {"content": [{"type": "text", "text": '{"tags": ["claude"]}'}]}
        else:
            out = {"choices": [{"message": {"content": '{"tags": ["local"]}'}}]}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture()
def provider():
    _Provider.seen = []
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Provider)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_local_provider_uses_openai_chat_format(provider):
    cfg = {**ai.DEFAULTS, "provider": "local", "local_url": provider + "/v1", "local_model": "llama3", "local_key": "tok"}
    assert ai.parse_tags(ai.complete(cfg, "sys", "usr")) == ["local"]
    path, headers, body = _Provider.seen[0]
    assert path == "/v1/chat/completions" and headers["Authorization"] == "Bearer tok"
    assert body["model"] == "llama3" and [m["role"] for m in body["messages"]] == ["system", "user"]


def test_claude_provider_uses_messages_api(provider, monkeypatch):
    monkeypatch.setattr(ai, "ANTHROPIC_URL", provider + "/v1/messages")
    cfg = {**ai.DEFAULTS, "provider": "claude", "claude_key": "sk-x"}
    assert ai.parse_tags(ai.complete(cfg, "sys", "usr")) == ["claude"]
    path, headers, body = _Provider.seen[0]
    lower = {k.lower(): v for k, v in headers.items()}
    assert lower["x-api-key"] == "sk-x" and lower["anthropic-version"] == "2023-06-01"
    assert body["system"] == "sys" and body["messages"] == [{"role": "user", "content": "usr"}]


def test_unreachable_provider_gives_a_code_without_secrets():
    cfg = {**ai.DEFAULTS, "provider": "local", "local_url": "http://127.0.0.1:9/v1", "local_model": "m", "local_key": "supersecret"}
    with pytest.raises(ai.AIError) as e:
        ai.complete(cfg, "s", "u")
    assert str(e.value) == "provider_unreachable" and "supersecret" not in str(e.value)

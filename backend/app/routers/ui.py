"""Cookie-only endpoints for the web UI: login, users, tokens, server settings."""

import re
import time
from typing import Literal

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import COOKIE_NAME, ui_admin, ui_user, ui_user_allow_change
from ..models import Board, Bookmark, Collection, Meta, Token, Usage, User
from ..schemas import ChangePasswordIn, LoginIn, SyncIn
from ..security import SESSION_TTL, hash_password, hash_token, new_token, sign_session, verify_password
from ..services import ai, fetcher
from ..services import sync as sync_service
from ..services.search import unindex_bookmark
from ..services.sync import next_rev
from .api import _fail, _throttle, user_info

router = APIRouter(prefix="/ui")

USERNAME_RE = re.compile(r"^[a-z0-9._-]{2,64}$")
EXTENSION_ZIP = Path(__file__).resolve().parent.parent / "assets" / "smart-bookmark-extension.zip"


def _set_cookie(response: Response, request: Request, user: User) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        COOKIE_NAME, sign_session(user.id), max_age=SESSION_TTL, httponly=True, samesite="strict", secure=secure
    )


def _allow_registration(db: Session) -> bool:
    row = db.get(Meta, "allow_registration")
    return bool(row and row.value == "1")


@router.get("/public")
def public(db: Session = Depends(get_db)):
    return {"allow_registration": _allow_registration(db)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else '?'}:{body.username.lower()}"
    _throttle(key)
    user = db.query(User).filter(User.username == body.username.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        _fail(key)
        raise HTTPException(401, "invalid_credentials")
    _set_cookie(response, request, user)
    return user_info(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(ui_user_allow_change)):
    return user_info(user)


@router.post("/change-password")
def change_password(
    body: ChangePasswordIn, user: User = Depends(ui_user_allow_change), db: Session = Depends(get_db)
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "wrong_password")
    if body.new_password == body.current_password or body.new_password.lower() == "admin":
        raise HTTPException(400, "weak_password")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    return {"ok": True}


class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=256)


@router.post("/register")
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not _allow_registration(db):
        raise HTTPException(403, "registration_disabled")
    user = _create_user(db, body.username, body.password, "user", False)
    _set_cookie(response, request, user)
    return user_info(user)


def _create_user(db: Session, username: str, password: str, role: str, must_change: bool) -> User:
    username = username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "invalid_username")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(409, "username_taken")
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role,
        must_change_password=must_change,
        settings={},
        created_at=int(time.time() * 1000),
    )
    db.add(user)
    db.commit()
    return user


# --- bookmark data for the web app (same engine as the extension's /api/v1/sync) ---

@router.get("/sync")
def web_pull(since: int = 0, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    return sync_service.pull(db, user, max(since, 0))


@router.post("/sync")
def web_push(body: SyncIn, background: BackgroundTasks, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    created: list[str] = []
    result = sync_service.sync(db, user, body, created)
    ai.schedule_auto_tag(background, db, user, created)
    return result


class FetchMetaIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)


_FETCHES: dict[int, list[float]] = {}


@router.post("/fetch-meta")
def fetch_meta(body: FetchMetaIn, user: User = Depends(ui_user)):
    """Server-side page fetch (title, description, image, favicon). SSRF-protected."""
    now = time.time()
    recent = [t for t in _FETCHES.get(user.id, []) if now - t < 60]
    if len(recent) >= 40:
        raise HTTPException(429, "too_many_requests")
    _FETCHES[user.id] = recent + [now]
    return fetcher.fetch_meta(body.url)


# --- tokens (own) ---------------------------------------------------------

class TokenIn(BaseModel):
    name: str = Field(default="", max_length=100)


@router.get("/extension.zip")
def download_extension(_: User = Depends(ui_user)):
    if not EXTENSION_ZIP.is_file():
        raise HTTPException(404, "extension_not_available")
    return FileResponse(EXTENSION_ZIP, media_type="application/zip", filename="smart-bookmark-extension.zip")


@router.get("/tokens")
def list_tokens(user: User = Depends(ui_user), db: Session = Depends(get_db)):
    rows = db.query(Token).filter(Token.user_id == user.id).order_by(Token.created_at.desc()).all()
    return [{"id": t.id, "name": t.name, "created_at": t.created_at, "last_used_at": t.last_used_at} for t in rows]


@router.post("/tokens")
def create_token(body: TokenIn, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    token = new_token()
    db.add(Token(user_id=user.id, name=body.name or "token", token_hash=hash_token(token), created_at=int(time.time() * 1000)))
    db.commit()
    return {"token": token}  # shown once


@router.delete("/tokens/{token_id}")
def delete_token(token_id: int, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    t = db.get(Token, token_id)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "not_found")
    db.delete(t)
    db.commit()
    return {"ok": True}


# --- admin: users and server settings --------------------------------------

class UserCreateIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(default="user", pattern="^(admin|user)$")


class UserPatchIn(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|user)$")
    password: str | None = Field(default=None, min_length=8, max_length=256)


@router.get("/users")
def list_users(_: User = Depends(ui_admin), db: Session = Depends(get_db)):
    return [
        {"id": u.id, "username": u.username, "role": u.role, "created_at": u.created_at}
        for u in db.query(User).order_by(User.username)
    ]


@router.post("/users")
def create_user(body: UserCreateIn, _: User = Depends(ui_admin), db: Session = Depends(get_db)):
    u = _create_user(db, body.username, body.password, body.role, must_change=True)
    return {"id": u.id, "username": u.username, "role": u.role}


@router.patch("/users/{user_id}")
def patch_user(user_id: int, body: UserPatchIn, admin: User = Depends(ui_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "not_found")
    if body.role is not None:
        if u.id == admin.id and body.role != "admin":
            raise HTTPException(400, "cannot_demote_self")
        u.role = body.role
    if body.password is not None:
        u.password_hash = hash_password(body.password)
        u.must_change_password = True
        db.query(Token).filter(Token.user_id == u.id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: User = Depends(ui_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "not_found")
    if u.id == admin.id:
        raise HTTPException(400, "cannot_delete_self")
    # Global content stays available: hand it to the acting admin and bump the
    # revision so every client picks up the change.
    rev = next_rev(db)
    for model in (Bookmark, Collection, Board):
        for row in db.scalars(select(model).where(model.owner_id == u.id, model.scope == "global")):
            row.owner_id = admin.id
            row.rev = rev
    for bid in db.scalars(select(Bookmark.id).where(Bookmark.owner_id == u.id)):
        unindex_bookmark(db, bid)
    db.execute(delete(Bookmark).where(Bookmark.owner_id == u.id))
    db.execute(delete(Collection).where(Collection.owner_id == u.id))
    db.execute(delete(Board).where(Board.owner_id == u.id))
    db.execute(delete(Usage).where(Usage.user_id == u.id))
    db.execute(delete(Token).where(Token.user_id == u.id))
    db.delete(u)
    db.commit()
    return {"ok": True}


class ServerSettingsIn(BaseModel):
    allow_registration: bool


@router.get("/server-settings")
def get_server_settings(_: User = Depends(ui_admin), db: Session = Depends(get_db)):
    return {"allow_registration": _allow_registration(db)}


@router.put("/server-settings")
def put_server_settings(body: ServerSettingsIn, _: User = Depends(ui_admin), db: Session = Depends(get_db)):
    row = db.get(Meta, "allow_registration")
    if row is None:
        row = Meta(key="allow_registration")
        db.add(row)
    row.value = "1" if body.allow_registration else "0"
    db.commit()
    return {"allow_registration": body.allow_registration}


# --- AI (admin config, per-user opt-in, tagging) ---------------------------

class AISettingsIn(BaseModel):
    provider: Literal["none", "claude", "local"] = "none"
    claude_model: str = Field(default="claude-haiku-5-5", max_length=100)
    claude_key: str | None = Field(default=None, max_length=300)  # None keeps, "" removes
    local_url: str = Field(default="", max_length=500)
    local_model: str = Field(default="", max_length=200)
    local_key: str | None = Field(default=None, max_length=300)
    max_chars: int = Field(default=6000, ge=500, le=30000)
    language: str = Field(default="english", min_length=2, max_length=40)
    timeout: int = Field(default=30, ge=5, le=300)


@router.get("/ai-settings")
def get_ai_settings(_: User = Depends(ui_admin), db: Session = Depends(get_db)):
    return ai.public_config(ai.load_config(db))


@router.put("/ai-settings")
def put_ai_settings(body: AISettingsIn, _: User = Depends(ui_admin), db: Session = Depends(get_db)):
    values = body.model_dump(exclude={"claude_key", "local_key"})
    if values["local_url"] and not ai.valid_local_url(values["local_url"]):
        raise HTTPException(422, "invalid_local_url")
    for key in ("claude_key", "local_key"):
        if getattr(body, key) is not None:
            values[key] = getattr(body, key).strip()
    ai.save_config(db, values)
    return ai.public_config(ai.load_config(db))


@router.post("/ai-test")
def test_ai(_: User = Depends(ui_admin), db: Session = Depends(get_db)):
    """Tiny round trip so the admin sees whether the key and model work."""
    try:
        reply = ai.complete(ai.load_config(db), "Reply with the single word: ok", "ping", max_tokens=10)
    except ai.AIError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "reply": reply.strip()[:40]}


@router.get("/ai-status")
def ai_status(user: User = Depends(ui_user), db: Session = Depends(get_db)):
    cfg = ai.load_config(db)
    return {"enabled": ai.is_enabled(cfg), "provider": cfg["provider"], "auto_tag": bool((user.settings or {}).get("ai_auto_tag"))}


@router.put("/ai-auto-tag")
def put_auto_tag(body: dict, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    user.settings = {**(user.settings or {}), "ai_auto_tag": bool(body.get("enabled"))}
    db.commit()
    return {"auto_tag": user.settings["ai_auto_tag"]}


class AITagIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=5)


_TAGS: dict[int, list[float]] = {}


@router.post("/ai/tag")
def ai_tag(body: AITagIn, user: User = Depends(ui_user), db: Session = Depends(get_db)):
    """Tag (or re-tag) bookmarks now. Replaces only tags the AI added before."""
    cfg = ai.load_config(db)
    if not ai.is_enabled(cfg):
        raise HTTPException(409, "ai_not_configured")
    now = time.time()
    recent = [t for t in _TAGS.get(user.id, []) if now - t < 60]
    if len(recent) + len(body.ids) > 30:
        raise HTTPException(429, "too_many_requests")
    _TAGS[user.id] = recent + [now] * len(body.ids)
    results = []
    for bid in body.ids:
        bm = db.get(Bookmark, bid)
        if bm is None or bm.deleted or not (bm.owner_id == user.id or (bm.scope == "global" and user.role == "admin")):
            results.append({"id": bid, "ok": False, "error": "not_found"})
            continue
        try:
            results.append({"id": bid, "ok": True, "ai_tags": ai.tag_bookmark(db, bm, cfg)})
        except ai.AIError as e:
            db.rollback()
            results.append({"id": bid, "ok": False, "error": str(e)})
    return {"results": results}

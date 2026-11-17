"""REST API v1 (Bearer tokens). Token/user/key management stays in routers/ui.py."""

import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import api_token, api_user, api_user_allow_change
from ..models import Token, User
from ..schemas import ChangePasswordIn, LoginIn, SyncIn, UserSettings
from ..security import hash_password, hash_token, new_token, verify_password
from ..services import sync as sync_service
from ..services.search import search_bookmarks

router = APIRouter(prefix="/api/v1")

_FAILS: dict[str, list[float]] = {}
_MAX_FAILS, _WINDOW = 10, 300


def _throttle(key: str) -> None:
    now = time.time()
    recent = [t for t in _FAILS.get(key, []) if now - t < _WINDOW]
    _FAILS[key] = recent
    if len(recent) >= _MAX_FAILS:
        raise HTTPException(429, "too_many_attempts")


def _fail(key: str) -> None:
    _FAILS.setdefault(key, []).append(time.time())


def user_info(u: User) -> dict:
    return {"id": u.id, "username": u.username, "role": u.role, "must_change_password": u.must_change_password}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else '?'}:{body.username.lower()}"
    _throttle(key)
    user = db.query(User).filter(User.username == body.username.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        _fail(key)
        raise HTTPException(401, "invalid_credentials")
    token = new_token()
    now = int(time.time() * 1000)
    db.add(Token(user_id=user.id, name=body.device_name or "extension", token_hash=hash_token(token), created_at=now))
    db.commit()
    return {"token": token, "user": user_info(user)}


@router.post("/auth/logout")
def logout(auth=Depends(api_token), db: Session = Depends(get_db)):
    """Revokes only the token used for this request."""
    _, token = auth
    db.delete(token)
    db.commit()
    return {"ok": True}


@router.post("/auth/change-password")
def change_password(
    body: ChangePasswordIn, user: User = Depends(api_user_allow_change), db: Session = Depends(get_db)
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "wrong_password")
    if body.new_password == body.current_password or body.new_password.lower() == "admin":
        raise HTTPException(400, "weak_password")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(api_user_allow_change)):
    return user_info(user)


@router.get("/settings")
def get_settings(user: User = Depends(api_user)):
    return UserSettings(**(user.settings or {})).model_dump()


@router.put("/settings")
def put_settings(body: UserSettings, user: User = Depends(api_user), db: Session = Depends(get_db)):
    user.settings = body.model_dump()
    db.commit()
    return user.settings


@router.get("/sync")
def pull(since: int = Query(default=0, ge=0), user: User = Depends(api_user), db: Session = Depends(get_db)):
    return sync_service.pull(db, user, since)


@router.post("/sync")
def push(body: SyncIn, user: User = Depends(api_user), db: Session = Depends(get_db)):
    return sync_service.sync(db, user, body)


@router.get("/bookmarks")
def list_bookmarks(
    q: str = "",
    tag: str | None = None,
    collection_id: str | None = None,
    status: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(api_user),
    db: Session = Depends(get_db),
):
    rows = search_bookmarks(db, user, q, tag, collection_id, status, limit)
    return [sync_service.serialize_bookmark(b) for b in rows]

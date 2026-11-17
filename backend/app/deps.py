import time

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import Token, User
from .security import hash_token, read_session

COOKIE_NAME = "sbm_session"


def _check_password_flag(user: User, allow_password_change: bool) -> User:
    if user.must_change_password and not allow_password_change:
        raise HTTPException(403, "password_change_required")
    return user


def _bearer_user(authorization: str | None, db: Session) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing_token")
    token = db.query(Token).filter(Token.token_hash == hash_token(authorization[7:].strip())).first()
    if not token:
        raise HTTPException(401, "invalid_token")
    now = int(time.time() * 1000)
    if now - token.last_used_at > 60_000:
        token.last_used_at = now
        db.commit()
    return db.get(User, token.user_id)


def api_token(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Returns (user, token) for a Bearer request."""
    user = _bearer_user(authorization, db)
    token = db.query(Token).filter(Token.token_hash == hash_token(authorization[7:].strip())).first()
    return user, token


def api_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    return _check_password_flag(_bearer_user(authorization, db), False)


def api_user_allow_change(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    return _check_password_flag(_bearer_user(authorization, db), True)


def _cookie_user(session: str | None, db: Session) -> User:
    uid = read_session(session)
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "not_logged_in")
    return user


def ui_user(sbm_session: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> User:
    return _check_password_flag(_cookie_user(sbm_session, db), False)


def ui_user_allow_change(sbm_session: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> User:
    return _cookie_user(sbm_session, db)


def ui_admin(user: User = Depends(ui_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admin_only")
    return user

import hashlib
import hmac
import os
import secrets
import time

from .db import DATA_DIR

_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)
SESSION_TTL = 14 * 24 * 3600


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return "sbm_" + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _secret() -> bytes:
    path = DATA_DIR / "secret.key"
    if not path.exists():
        path.write_bytes(secrets.token_bytes(32))
        path.chmod(0o600)
    return path.read_bytes()


def sign_session(user_id: int, now: float | None = None) -> str:
    exp = int((now or time.time()) + SESSION_TTL)
    payload = f"{user_id}:{exp}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def read_session(value: str | None, now: float | None = None) -> int | None:
    if not value:
        return None
    try:
        uid, exp, sig = value.split(":")
        expected = hmac.new(_secret(), f"{uid}:{exp}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected) or int(exp) < (now or time.time()):
            return None
        return int(uid)
    except ValueError:
        return None

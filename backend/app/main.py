import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .db import Base, SessionLocal, engine
from .deps import COOKIE_NAME
from .models import Meta, User
from .migrate import migrate
from .routers import api, ui
from .security import hash_password
from .services.search import FTS_DDL

STATIC = Path(__file__).parent / "static"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https: http:; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


def init_db() -> None:
    Base.metadata.create_all(engine)
    migrate(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql(FTS_DDL)
    with SessionLocal() as db:
        if db.get(Meta, "rev") is None:
            db.add(Meta(key="rev", value="0"))
        if db.query(User).count() == 0:
            db.add(
                User(
                    username="admin",
                    password_hash=hash_password("admin"),
                    role="admin",
                    must_change_password=True,
                    settings={},
                    created_at=int(time.time() * 1000),
                )
            )
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Smart Bookmark Manager", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def security(request: Request, call_next):
    # CSRF: cookie-authenticated writes need a same-origin Origin or the custom
    # X-SBM header (which a cross-origin page cannot send without a preflight).
    if request.method in UNSAFE and COOKIE_NAME in request.cookies and "authorization" not in request.headers:
        origin = request.headers.get("origin")
        same_origin = origin is not None and origin.split("://", 1)[-1] == request.headers.get("host")
        if not (same_origin or request.headers.get("x-sbm")):
            return JSONResponse({"detail": "csrf_blocked"}, status_code=403)
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith(("/api/", "/ui/")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/healthz")
def healthz():
    return {"ok": True, "version": __version__}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "web" / "index.html")


@app.get("/account", include_in_schema=False)
def account():
    return FileResponse(STATIC / "account.html")


app.include_router(api.router)
app.include_router(ui.router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

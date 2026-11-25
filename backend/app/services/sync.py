"""Pull/push sync with a global revision cursor and last-write-wins per record."""

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from ..models import Board, Bookmark, Collection, Usage, User
from ..schemas import SyncIn, UsageIn
from .search import index_bookmark

# Fields a client may set. Only fields the client actually sent are applied, so an older
# client that does not know a field never wipes it.
BOOKMARK_FIELDS = ("url", "title", "description", "notes", "favicon", "image", "collection_id", "status", "tags", "starred", "pinned", "boards")
COLLECTION_FIELDS = ("name", "parent_id")
BOARD_FIELDS = ("name", "emoji", "color")


def current_rev(db: Session) -> int:
    row = db.execute(text("SELECT value FROM meta WHERE key = 'rev'")).first()
    return int(row[0]) if row else 0


def next_rev(db: Session) -> int:
    """Allocate a revision. The UPDATE takes SQLite's write lock until commit,
    so allocation order equals commit order."""
    db.execute(text("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'"))
    return current_rev(db)


def _can_edit(user: User, existing_owner: int, existing_scope: str) -> bool:
    return existing_owner == user.id or (existing_scope == "global" and user.role == "admin")


def _upsert(db: Session, user: User, model, inc, fields: tuple, rev: int):
    """Returns (status, row). status: ok | stale | forbidden | forbidden_global."""
    ex = db.get(model, inc.id)
    if ex is None:
        if inc.scope == "global" and user.role != "admin":
            return "forbidden_global", None
        ex = model(id=inc.id, owner_id=user.id, scope=inc.scope)
        db.add(ex)
    else:
        if not _can_edit(user, ex.owner_id, ex.scope):
            return "forbidden", None
        if inc.updated_at <= ex.updated_at:
            return "stale", ex
        # Only the owner may change the scope, and only admins may publish.
        if ex.owner_id == user.id and (inc.scope == "private" or user.role == "admin"):
            ex.scope = inc.scope
    given = inc.model_fields_set
    for f in fields:
        if f in given:
            setattr(ex, f, getattr(inc, f))
    ex.created_at = ex.created_at or inc.created_at
    ex.updated_at = inc.updated_at
    ex.deleted = inc.deleted
    ex.rev = rev
    return "ok", ex


def _apply_usage(db: Session, user: User, inc: UsageIn, rev: int) -> bool:
    b = db.get(Bookmark, inc.bookmark_id)
    if b is None or b.deleted or not (b.owner_id == user.id or b.scope == "global"):
        return False
    u = db.get(Usage, (user.id, inc.bookmark_id))
    if u is None:
        u = Usage(user_id=user.id, bookmark_id=inc.bookmark_id, open_count=0, last_opened_at=0)
        db.add(u)
    u.open_count += inc.opens
    u.last_opened_at = max(u.last_opened_at, inc.last_opened_at)
    u.rev = rev
    return True


def serialize_bookmark(b: Bookmark) -> dict:
    return {
        "id": b.id,
        "owner_id": b.owner_id,
        "scope": b.scope,
        "url": b.url,
        "title": b.title,
        "description": b.description,
        "notes": b.notes,
        "favicon": b.favicon,
        "image": b.image or "",
        "collection_id": b.collection_id,
        "status": b.status,
        "tags": b.tags or [],
        "starred": bool(b.starred),
        "pinned": bool(b.pinned),
        "boards": b.boards or [],
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "deleted": b.deleted,
        "rev": b.rev,
    }


def serialize_collection(c: Collection) -> dict:
    return {
        "id": c.id,
        "owner_id": c.owner_id,
        "scope": c.scope,
        "parent_id": c.parent_id,
        "name": c.name,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "deleted": c.deleted,
        "rev": c.rev,
    }


def serialize_board(b: Board) -> dict:
    return {
        "id": b.id,
        "owner_id": b.owner_id,
        "scope": b.scope,
        "name": b.name,
        "emoji": b.emoji or "",
        "color": b.color or "",
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "deleted": b.deleted,
        "rev": b.rev,
    }


def sync(db: Session, user: User, payload: SyncIn) -> dict:
    rejected: list[dict] = []
    touched = {"bookmark": set(), "collection": set(), "board": set(), "usage": set()}
    rev = None

    def alloc() -> int:
        nonlocal rev
        if rev is None:
            rev = next_rev(db)
        return rev

    plan = (
        ("collection", Collection, COLLECTION_FIELDS, payload.collections),
        ("board", Board, BOARD_FIELDS, payload.boards),
        ("bookmark", Bookmark, BOOKMARK_FIELDS, payload.bookmarks),
    )
    for kind, model, fields, items in plan:
        for inc in items:
            status, row = _upsert(db, user, model, inc, fields, rev or alloc())
            touched[kind].add(inc.id)
            if status not in ("ok", "stale"):
                rejected.append({"type": kind, "id": inc.id, "reason": status})
            elif status == "ok" and kind == "bookmark":
                db.flush()
                index_bookmark(db, row)
    for inc in payload.usage:
        if inc.opens > 0 and _apply_usage(db, user, inc, rev or alloc()):
            touched["usage"].add(inc.bookmark_id)
    db.commit()

    return pull(db, user, payload.since, touched, rejected)


def pull(db: Session, user: User, since: int, touched: dict | None = None, rejected: list[dict] | None = None) -> dict:
    touched = touched or {}
    # Read the cursor first: anything committed later gets a higher rev and is
    # picked up by the next pull.
    cur = current_rev(db)

    def select_rows(model, key, id_col):
        cond = (model.rev > since) & (model.rev <= cur)
        if touched.get(key):
            cond = cond | id_col.in_(touched[key])
        return cond

    visible = lambda m: or_(m.owner_id == user.id, m.scope == "global")  # noqa: E731
    bookmarks = db.scalars(select(Bookmark).where(visible(Bookmark), select_rows(Bookmark, "bookmark", Bookmark.id))).all()
    collections = db.scalars(select(Collection).where(visible(Collection), select_rows(Collection, "collection", Collection.id))).all()
    boards = db.scalars(select(Board).where(visible(Board), select_rows(Board, "board", Board.id))).all()
    usage = db.scalars(select(Usage).where(Usage.user_id == user.id, select_rows(Usage, "usage", Usage.bookmark_id))).all()

    return {
        "rev": cur,
        "bookmarks": [serialize_bookmark(b) for b in bookmarks],
        "collections": [serialize_collection(c) for c in collections],
        "boards": [serialize_board(b) for b in boards],
        "usage": [
            {"bookmark_id": u.bookmark_id, "open_count": u.open_count, "last_opened_at": u.last_opened_at}
            for u in usage
        ],
        "rejected": rejected or [],
    }

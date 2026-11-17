"""Pull/push sync with a global revision cursor and last-write-wins per record."""

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from ..models import Bookmark, Collection, Usage, User
from ..schemas import BookmarkIn, CollectionIn, SyncIn, UsageIn
from .search import index_bookmark


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


def _upsert_bookmark(db: Session, user: User, inc: BookmarkIn, rev: int) -> str:
    ex = db.get(Bookmark, inc.id)
    if ex is None:
        if inc.scope == "global" and user.role != "admin":
            return "forbidden_global"
        ex = Bookmark(id=inc.id, owner_id=user.id, scope=inc.scope)
        db.add(ex)
    else:
        if not _can_edit(user, ex.owner_id, ex.scope):
            return "forbidden"
        if inc.updated_at <= ex.updated_at:
            return "stale"
        # Only the owner may change the scope, and only admins may publish.
        if ex.owner_id == user.id and (inc.scope == "private" or user.role == "admin"):
            ex.scope = inc.scope
    ex.url = inc.url
    ex.title = inc.title
    ex.description = inc.description
    ex.notes = inc.notes
    ex.favicon = inc.favicon
    ex.collection_id = inc.collection_id
    ex.status = inc.status
    ex.tags = inc.tags
    ex.created_at = ex.created_at or inc.created_at
    ex.updated_at = inc.updated_at
    ex.deleted = inc.deleted
    ex.rev = rev
    db.flush()
    index_bookmark(db, ex)
    return "ok"


def _upsert_collection(db: Session, user: User, inc: CollectionIn, rev: int) -> str:
    ex = db.get(Collection, inc.id)
    if ex is None:
        if inc.scope == "global" and user.role != "admin":
            return "forbidden_global"
        ex = Collection(id=inc.id, owner_id=user.id, scope=inc.scope)
        db.add(ex)
    else:
        if not _can_edit(user, ex.owner_id, ex.scope):
            return "forbidden"
        if inc.updated_at <= ex.updated_at:
            return "stale"
        if ex.owner_id == user.id and (inc.scope == "private" or user.role == "admin"):
            ex.scope = inc.scope
    ex.name = inc.name
    ex.parent_id = inc.parent_id
    ex.created_at = ex.created_at or inc.created_at
    ex.updated_at = inc.updated_at
    ex.deleted = inc.deleted
    ex.rev = rev
    return "ok"


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
        "collection_id": b.collection_id,
        "status": b.status,
        "tags": b.tags or [],
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


def sync(db: Session, user: User, payload: SyncIn) -> dict:
    rejected: list[dict] = []
    touched_b: set[str] = set()
    touched_c: set[str] = set()
    touched_u: set[str] = set()
    rev = None

    def alloc() -> int:
        nonlocal rev
        if rev is None:
            rev = next_rev(db)
        return rev

    for inc in payload.collections:
        res = _upsert_collection(db, user, inc, rev or alloc())
        touched_c.add(inc.id)
        if res not in ("ok", "stale"):
            rejected.append({"type": "collection", "id": inc.id, "reason": res})
    for inc in payload.bookmarks:
        res = _upsert_bookmark(db, user, inc, rev or alloc())
        touched_b.add(inc.id)
        if res not in ("ok", "stale"):
            rejected.append({"type": "bookmark", "id": inc.id, "reason": res})
    for inc in payload.usage:
        if inc.opens > 0 and _apply_usage(db, user, inc, rev or alloc()):
            touched_u.add(inc.bookmark_id)
    db.commit()

    return pull(db, user, payload.since, touched_b, touched_c, touched_u, rejected)


def pull(
    db: Session,
    user: User,
    since: int,
    extra_b: set[str] = frozenset(),
    extra_c: set[str] = frozenset(),
    extra_u: set[str] = frozenset(),
    rejected: list[dict] | None = None,
) -> dict:
    # Read the cursor first: anything committed later gets a higher rev and is
    # picked up by the next pull.
    cur = current_rev(db)
    bvis = or_(Bookmark.owner_id == user.id, Bookmark.scope == "global")
    cvis = or_(Collection.owner_id == user.id, Collection.scope == "global")

    b_cond = (Bookmark.rev > since) & (Bookmark.rev <= cur)
    if extra_b:
        b_cond = b_cond | Bookmark.id.in_(extra_b)
    c_cond = (Collection.rev > since) & (Collection.rev <= cur)
    if extra_c:
        c_cond = c_cond | Collection.id.in_(extra_c)
    u_cond = (Usage.rev > since) & (Usage.rev <= cur)
    if extra_u:
        u_cond = u_cond | Usage.bookmark_id.in_(extra_u)

    bookmarks = db.scalars(select(Bookmark).where(bvis, b_cond)).all()
    collections = db.scalars(select(Collection).where(cvis, c_cond)).all()
    usage = db.scalars(select(Usage).where(Usage.user_id == user.id, u_cond)).all()

    return {
        "rev": cur,
        "bookmarks": [serialize_bookmark(b) for b in bookmarks],
        "collections": [serialize_collection(c) for c in collections],
        "usage": [
            {"bookmark_id": u.bookmark_id, "open_count": u.open_count, "last_opened_at": u.last_opened_at}
            for u in usage
        ],
        "rejected": rejected or [],
    }

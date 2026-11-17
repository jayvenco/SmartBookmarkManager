import re

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from ..models import Bookmark, User

FTS_DDL = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5("
    "bookmark_id UNINDEXED, title, url, description, notes, tags, content, "
    "tokenize='unicode61 remove_diacritics 2')"
)


def index_bookmark(db: Session, b: Bookmark) -> None:
    db.execute(text("DELETE FROM bookmarks_fts WHERE bookmark_id = :id"), {"id": b.id})
    if b.deleted:
        return
    db.execute(
        text(
            "INSERT INTO bookmarks_fts (bookmark_id, title, url, description, notes, tags, content) "
            "VALUES (:id, :title, :url, :description, :notes, :tags, :content)"
        ),
        {
            "id": b.id,
            "title": b.title,
            "url": b.url,
            "description": b.description,
            "notes": b.notes,
            "tags": " ".join(b.tags or []),
            "content": b.content_text,
        },
    )


def unindex_bookmark(db: Session, bookmark_id: str) -> None:
    db.execute(text("DELETE FROM bookmarks_fts WHERE bookmark_id = :id"), {"id": bookmark_id})


def _fts_query(q: str) -> str | None:
    terms = re.findall(r"[\w]+", q, flags=re.UNICODE)
    if not terms:
        return None
    return " ".join(f'"{t}"*' for t in terms[:12])


def visible(user: User):
    return or_(Bookmark.owner_id == user.id, Bookmark.scope == "global")


def search_bookmarks(
    db: Session,
    user: User,
    q: str = "",
    tag: str | None = None,
    collection_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[Bookmark]:
    stmt = select(Bookmark).where(Bookmark.deleted.is_(False), visible(user))
    fts = _fts_query(q) if q else None
    if q and not fts:
        return []
    if fts:
        ids = [
            r[0]
            for r in db.execute(
                text("SELECT bookmark_id FROM bookmarks_fts WHERE bookmarks_fts MATCH :q ORDER BY rank"),
                {"q": fts},
            )
        ]
        if not ids:
            return []
        stmt = stmt.where(Bookmark.id.in_(ids))
    if collection_id:
        stmt = stmt.where(Bookmark.collection_id == collection_id)
    if status:
        stmt = stmt.where(Bookmark.status == status)
    rows = list(db.scalars(stmt.order_by(Bookmark.updated_at.desc())))
    if fts:
        order = {i: n for n, i in enumerate(ids)}
        rows.sort(key=lambda b: order.get(b.id, 0))
    if tag:
        tag = tag.strip().lower()
        rows = [b for b in rows if tag in (b.tags or [])]
    return rows[:limit]

from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

ID_PATTERN = r"^[A-Za-z0-9-]{8,64}$"
ALLOWED_SCHEMES = {"http", "https", "ftp", "file", "edge", "chrome"}
Status = Literal["unread", "read", "archived", "dead"]
Scope = Literal["private", "global"]


def _clean_tags(tags: list[str]) -> list[str]:
    seen, out = set(), []
    for t in tags:
        t = " ".join(str(t).strip().lower().split())[:64]
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:50]


class BookmarkIn(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    url: str = Field(max_length=4000)
    title: str = Field(default="", max_length=1000)
    description: str = Field(default="", max_length=5000)
    notes: str = Field(default="", max_length=20000)
    favicon: str = Field(default="", max_length=4000)
    collection_id: str | None = Field(default=None, pattern=ID_PATTERN)
    status: Status = "unread"
    tags: list[str] = Field(default_factory=list, max_length=200)
    scope: Scope = "private"
    created_at: int = 0
    updated_at: int = 0
    deleted: bool = False

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if urlparse(v).scheme.lower() not in ALLOWED_SCHEMES:
            raise ValueError("unsupported URL scheme")
        return v

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return _clean_tags(v)


class CollectionIn(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    parent_id: str | None = Field(default=None, pattern=ID_PATTERN)
    scope: Scope = "private"
    created_at: int = 0
    updated_at: int = 0
    deleted: bool = False


class UsageIn(BaseModel):
    bookmark_id: str = Field(pattern=ID_PATTERN)
    opens: int = Field(ge=0, le=100000)
    last_opened_at: int = 0


class SyncIn(BaseModel):
    since: int = Field(default=0, ge=0)
    bookmarks: list[BookmarkIn] = Field(default_factory=list, max_length=2000)
    collections: list[CollectionIn] = Field(default_factory=list, max_length=500)
    usage: list[UsageIn] = Field(default_factory=list, max_length=2000)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    device_name: str = Field(default="", max_length=100)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class UserSettings(BaseModel):
    unused_days: int = Field(default=90, ge=1, le=3650)
    auto_archive_unused: bool = False
    top_n: int = Field(default=10, ge=1, le=100)

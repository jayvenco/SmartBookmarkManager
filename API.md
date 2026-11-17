# REST API v1

Base path `/api/v1`. All endpoints except `/auth/login` need `Authorization: Bearer <token>`. Tokens are created by logging in (below) or on the web page (*API tokens*). Errors are JSON `{"detail": "<code>"}`.

Until the default password is changed, every endpoint except `/me` and `/auth/change-password` returns `403 password_change_required`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | `{username, password, device_name?}` returns `{token, user}` |
| POST | `/auth/logout` | revokes the token used for the request |
| POST | `/auth/change-password` | `{current_password, new_password}` |
| GET | `/me` | `{id, username, role, must_change_password}` |
| GET / PUT | `/settings` | per-user settings: `unused_days` (default 90), `auto_archive_unused`, `top_n` (default 10) |
| GET | `/sync?since=<rev>` | everything changed after `rev` that the user can see |
| POST | `/sync` | push changes and pull in one call (below) |
| GET | `/bookmarks` | server-side search: `q`, `tag`, `collection_id`, `status`, `limit` |

Managing users, tokens, server settings and backups is cookie-only (web UI, `/ui/*`) and not part of this API.

## Sync

`POST /sync` body:

```json
{
  "since": 0,
  "bookmarks":   [{"id": "uuid", "url": "https://…", "title": "", "description": "", "notes": "", "favicon": "",
                   "collection_id": null, "status": "unread|read|archived|dead", "tags": ["a"],
                   "scope": "private|global", "created_at": 0, "updated_at": 0, "deleted": false}],
  "collections": [{"id": "uuid", "name": "", "parent_id": null, "scope": "private", "created_at": 0, "updated_at": 0, "deleted": false}],
  "usage":       [{"bookmark_id": "uuid", "opens": 2, "last_opened_at": 0}]
}
```

Timestamps are milliseconds since the epoch. Ids are client-generated (UUID).

Response: `{rev, bookmarks, collections, usage, rejected}`. Store `rev` and send it as `since` next time.

- **Conflicts:** the record with the higher `updated_at` wins. A stale push is ignored and the server's version is returned.
- **Deletes** are tombstones (`deleted: true`) and are returned to other clients.
- **Usage** is sent as increments (`opens` is added to the server total; `last_opened_at` is a max). The response holds absolute totals (`open_count`).
- **Visibility:** a user sees their own records plus all `scope: "global"` records. Only admins can create global records; only the owner (or an admin, for global records) can edit. Refused changes are listed in `rejected` as `{type, id, reason}`.
- Tags are lowercased and de-duplicated by the server. Allowed URL schemes: http, https, ftp, file, edge, chrome.

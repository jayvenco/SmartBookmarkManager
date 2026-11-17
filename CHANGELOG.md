# Changelog

## 0.1.0 (unreleased)

Phase 1 (MVP).

- Backend: FastAPI + SQLite (FTS5), users with roles, per-device API tokens, forced password change for the default `admin`/`admin`, optional self-registration, login throttling, CSRF and security headers.
- Sync: pull/push with a revision cursor, last-write-wins per record, tombstones, additive usage counters.
- Global bookmarks and categories (admin-published, read-only for other users).
- Web UI: login, password change, API tokens, user management, server settings.
- Unraid: self-contained installer (`unraid/paste-into-unraid.txt`) that builds the image on the server, plus a Docker tab template.
- Extension (MV3): quick-add popup with shortcut and context menu, manager page with search, categories, tags and sorting, options page with login, sync and one-time Edge bookmark import.

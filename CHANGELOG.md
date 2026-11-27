# Changelog

## 0.2.0 (unreleased)

Phase A: web app.

- Web app at `/` (three-column library, cards/list, detail panel, Spotlight, bulk actions, drag and drop, import/export, 4 themes). The previous account page moved to `/account`.
- New bookmark fields: `starred`, `pinned`, `image`, status `reading`; new `boards` (shown as "collections" in the UI) that cut across categories.
- Cookie endpoints for the web app: `GET/POST /ui/sync`, `POST /ui/fetch-meta` (SSRF-protected page details).
- Sync only applies fields a client actually sent, so older clients never wipe new fields.
- Docker image published to `ghcr.io/jayvenco/smartbookmarkmanager` by GitHub Actions; Unraid template `unraid/smartbm-template.xml`.
- Settings: *Download extension* (`GET /ui/extension.zip`, login required) serves the packed extension.
- Additive database migration for existing installs; extension updated to keep the new fields.

## 0.1.0 (unreleased)

Phase 1 (MVP).

- Backend: FastAPI + SQLite (FTS5), users with roles, per-device API tokens, forced password change for the default `admin`/`admin`, optional self-registration, login throttling, CSRF and security headers.
- Sync: pull/push with a revision cursor, last-write-wins per record, tombstones, additive usage counters.
- Global bookmarks and categories (admin-published, read-only for other users).
- Web UI: login, password change, API tokens, user management, server settings.
- Unraid: self-contained installer (`unraid/paste-into-unraid.txt`) that builds the image on the server, plus a Docker tab template.
- Extension (MV3): quick-add popup with shortcut and context menu, manager page with search, categories, tags and sorting, options page with login, sync and one-time Edge bookmark import.

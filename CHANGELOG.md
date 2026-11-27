# Changelog

## 0.3.0 (unreleased)

Phase B1: AI tagging.

- Admin page: choose Claude or a local OpenAI-compatible server (Ollama) and set model, text size, language and timeout. Keys stay on the server and are never shown again.
- Tag with AI from the bookmark detail panel or in bulk; users can switch on automatic tagging of new bookmarks (also for bookmarks added from the extension).
- AI never touches your own tags: it only replaces tags it added before (`ai_tags`, outlined in the UI). Suggested tags are mapped onto your existing tags (`java-script` becomes `javascript`) and your existing tags are offered to the model.
- Server extracts page text (SSRF-protected) for the prompt; page text is treated as untrusted data.

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

# Smart Bookmark Manager — Plan

Self-hosted bookmark manager: an Edge (Chromium, MV3) extension plus a simple Docker backend. Offline-first client, token-based sync, tags, collections, rich filtering, usage stats and optional AI.

## Decisions
- Native browser bookmarks: one-time import only. Our own store is the source of truth.
- AI: Claude (Anthropic API) by default, with an option for a local provider (OpenAI-compatible endpoint, e.g. Ollama). Configured by an admin on the server.
- Multiple users. Admins can publish bookmarks that every user sees (global bookmarks).
- Sync stays as simple as possible: pull/push with a revision cursor, last-write-wins.

## Architecture
```
Edge extension (MV3)  <--HTTPS + Bearer token-->  Backend (1 Docker container)
IndexedDB (offline-first)                         FastAPI + SQLite (FTS5)
Popup / manager page / side panel                 Web UI for admin + AI layer
```

### Extension
- Manifest V3, vanilla JS (or light TypeScript + Vite). No heavy framework.
- Quick-add popup (shortcut `Alt+Shift+B`, since Ctrl+Shift+D is Edge's own "bookmark all tabs"; context menu "Bookmark this page/link"): URL and title prefilled, custom name, tags (autocomplete, create on the fly), category. Enter saves and closes. If the URL already exists, the popup edits the existing bookmark.
- Full manager page (own tab) and optional side panel.
- All data cached in IndexedDB; background sync (on open, after each change, every few minutes).

### Backend
- Python 3.12, FastAPI, SQLAlchemy, SQLite + FTS5, single container, data in `/app/data`. Same conventions as DockerAppBlueprint.
- Web UI (cookie session) for login, user management, tokens, server settings, import/export.
- REST API v1 with Bearer tokens (one token per user/device, stored hashed).

## Users and sharing
- Roles: `admin` and `user`. First start: default admin with forced password change.
- Each user has private bookmarks, collections, tags, settings and usage stats.
- **Global bookmarks**: created by an admin with `scope = global`. Visible to all users, read-only for non-admins.
  - A user can open them, count usage on them (per user), hide them, or copy them into their own bookmarks.
  - Global collections work the same way (admin-owned, visible to all).
- Admin can enable/disable self-registration.

## Data model
- `users`: id, username, password hash, role, settings (JSON).
- `tokens`: id, user_id, name, hash, last_used_at.
- `bookmarks`: id (uuid), owner_id, scope (`private`/`global`), url, title (own name), description, notes, favicon, collection_id, status (`unread`/`read`/`archived`/`dead`), content_text, created_at, updated_at, deleted, rev.
- `collections`: tree (parent_id), owner_id, scope.
- Tags: stored as a JSON list of lowercase names on each bookmark (phase 1). A `tags` table with color/alias comes with phase 2 if needed.
- `usage`: (user_id, bookmark_id) -> open_count, last_opened_at. Per user, so global bookmarks have their own stats per person.
- `saved_filters`: smart collections per user.

## Sync
- Server assigns a monotonically increasing `rev` to every change.
- `GET /api/v1/sync?since=<rev>` returns everything visible to the user that changed (own + global), including tombstones.
- `POST /api/v1/sync` pushes local changes; conflicts are resolved per record by `updated_at` (last-write-wins).
- Usage events are sent as increments (`+n opens`, `last_opened_at = max`), so counting works offline and never conflicts.
- Clients only remember their last `rev`. No websockets.

## Usage dashboard
- Top 10 most used bookmarks (period: 7 days / 30 days / all time).
- "Not used for a while": `last_opened_at` (or `created_at` when never opened) older than the user's period.
  - Bulk actions: archive, delete, keep (resets the clock).
- Per-user settings, stored on the server so they apply on every client:
  - Unused period (default 90 days; presets 30/60/90/180/365 or custom).
  - Auto-mark or auto-archive unused bookmarks (off by default).
  - Number of items in the top list (default 10).
- Only opens via the extension are counted (not the native Edge bookmark bar).

## AI
Provider abstraction with two backends, configured by an admin:
- **Claude** (Anthropic API key, default model a small/cheap one for tagging).
- **Local** (OpenAI-compatible endpoint, e.g. Ollama).

Features (all optional, off by default, content fetched server-side):
- Auto-tag, short summary and category suggestion on save.
- Natural language search.
- Duplicate and near-duplicate detection, dead-link check.
- Bulk organize: AI proposes a structure, the user approves.
- Later: semantic search with embeddings.

## UI and filtering
- List, card and compact views, dark mode, keyboard navigation, command palette (`Ctrl+K`).
- Filter bar with facets: tags (AND/OR/NOT), collection, domain, date, status, has notes, global vs. own.
- Saved filters as smart collections.
- Multi-select with bulk actions (tag, move, archive, delete), drag-and-drop into collections, undo.

## Phases
1. **MVP**: backend (users, tokens, CRUD, sync, FTS search), extension (quick-add popup, shortcut, context menu, manager page), tags, collections, global bookmarks, usage tracking, one-time import of Edge bookmarks.
2. **Filtering and convenience**: facets, saved filters, bulk actions, usage dashboard (the per-user settings API already exists), hide/copy global bookmarks, export (JSON + HTML), tag colors.
3. **AI**: provider setup (Claude/local), auto-tag, summary, dead links, duplicates, natural language search.
4. **Extras**: semantic search, Firefox port.

## Security notes
- Tokens are hashed at rest; the extension stores its token in `chrome.storage.local`.
- HTTPS expected (reverse proxy); CORS limited to the extension origin.
- AI API key stays on the server, never sent to the extension.
- Server-side page fetching must block private IP ranges (SSRF protection).

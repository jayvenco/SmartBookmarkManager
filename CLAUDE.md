# Smart Bookmark Manager — CLAUDE.md

Self-hosted bookmark manager: Edge (MV3) extension + FastAPI backend. See `PLAN.md` for the full design.

## Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite (FTS5), single Docker container, data in `/app/data`.
- Extension: Manifest V3, vanilla JS (no inline scripts, strict CSP), IndexedDB for offline cache.
- AI: Claude (Anthropic API) by default, optional local OpenAI-compatible provider (Ollama).

## Layout
- `backend/app/` — `main.py` (middleware: CSRF, security headers), `routers/` (`api` Bearer v1, `ui` cookie-only), `services/` (`sync`, `search`; `ai` comes in phase 3), `models.py`, `schemas.py`, `deps.py`, `security.py`, `static/` (admin web UI, vanilla JS, no inline scripts/styles)
- Web app: `backend/app/static/web/` (`index.html`, `js/` ES modules: `state.js` data+sync, `view.js` filters, `library.js` cards, `sidebar.js`, `detail.js`, `dialogs.js`, `spotlight.js`, `importer.js`; `css/themes.css` tokens). Admin/token page: `static/account.html`.
- `extension/` — `manifest.json`, `background/service-worker.js` (sync, context menu), `popup/` (quick add), `manager/` (full page), `options/` (login, import), `lib/` (`db` IndexedDB, `store` data layer, `sync`, `api`, `config`)
- `backend/tests/`, `backend/Dockerfile`, `docker-compose.yml`, `README.md`, `CHANGELOG.md`, `API.md`

## Rules
- English everywhere (UI, docs, code). Keep it lightweight: avoid new dependencies.
- Default admin login `admin`/`admin` with forced password change; never weaken that.
- Multi-user: every query is scoped to the current user. Global bookmarks (`scope = global`) are admin-created and read-only for others; usage stats stay per user.
- Token (Bearer) endpoints live in `routers/api.py`; anything that manages users, tokens, keys, AI settings or backups stays cookie-only in `routers/ui.py`.
- The web app talks to cookie-only `/ui/sync` (same engine as `/api/v1/sync`). Keep all colours in `themes.css` tokens; no inline `<script>`/`style=` markup (CSP). DOM is built with `h()` (text nodes only), never `innerHTML` with data.
- Terminology: API `collections` = category tree (UI "Categories"); API `boards` = UI "Collections". New columns need an entry in `app/migrate.py`.
- Sync is pull/push with a `rev` cursor, last-write-wins; usage is sent as increments. Do not add websockets or CRDTs.
- The AI key stays on the server. Page fetching must block private IP ranges (SSRF); `SBM_FETCH_ALLOW_PRIVATE=1` is the only opt-out.
- Native browser bookmarks are imported once; no continuous mirroring.
- After any change under `extension/` run `python3 scripts/build-extension-zip.py` (the web app serves `backend/app/assets/smart-bookmark-extension.zip`), then rebuild the Unraid installer.
- Update README, CHANGELOG and `API.md` with every user-visible change.
- Unraid install: `unraid/*` is generated. After any change under `backend/` (except tests) run `./scripts/build-unraid-installer.sh` and commit the result. The installer must stay free of tabs and `!history` characters (terminal paste).

## Commands
- Run: `docker compose up --build` (http://localhost:7774) or `SBM_DATA_DIR=./data ./.venv/bin/uvicorn app.main:app --app-dir backend --reload --port 7774`
- Tests: `./.venv/bin/python -m pytest -q`
- Extension: load `extension/` unpacked via `edge://extensions` (developer mode).

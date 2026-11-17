# Smart Bookmark Manager

Self-hosted bookmark manager: an Edge (Chromium, Manifest V3) extension plus a small Docker backend. Tag, group and search your bookmarks, share selected bookmarks with all users, and sync between browsers through your own server. See [PLAN.md](PLAN.md) for the roadmap.

## Status: phase 1 (MVP)

- Quick add from the browser: shortcut (`Alt+Shift+B`) or context menu. Set your own name, tags and category; Enter saves.
- Manager page: search, categories (nested), tag filters, sorting, edit, bulk-free simple UI.
- Offline-first: everything is cached in IndexedDB and synced in the background (on change and every 5 minutes).
- Multiple users. Admins can publish **global** bookmarks and categories that every user sees (read-only for others).
- Usage tracking per user (`open count`, `last opened`) is recorded from day one; the dashboard follows in phase 2.
- One-time import of the Edge bookmarks.

Not yet built: filter facets and saved filters, usage dashboard, AI features (see PLAN.md).

## Run the server

```bash
docker compose up --build
```

Open http://localhost:7774 and sign in with `admin` / `admin`. You are forced to choose a new password. Then:

- **Users:** add users on the web page (they must change their temporary password at first login), or enable self-registration under *Server settings*.
- Put the server behind HTTPS (reverse proxy) before using it outside your own network.
- Data (SQLite database and secret key) lives in the Docker volume `sbm-data`. To use a folder instead, replace `sbm-data:/app/data` in `docker-compose.yml` with `./data:/app/data` and back that folder up. On macOS, Docker Desktop needs access to the folder (System Settings > Privacy & Security > Files and Folders).

Without Docker:

```bash
python3.12 -m venv .venv && ./.venv/bin/pip install -r backend/requirements.txt
SBM_DATA_DIR=./data ./.venv/bin/uvicorn app.main:app --app-dir backend --reload --port 7774
```

## Install on Unraid

The image is built on the Unraid server itself, no registry needed. On your Mac copy the installer to the clipboard:

```bash
pbcopy < unraid/paste-into-unraid.txt
```

Open the Unraid terminal, paste, press Enter and answer the port question (default 7774). The script unpacks the source to `/mnt/user/appdata/SmartBM/src`, builds the image, starts the container `SmartBM` (visible in the Docker tab, with a template for *Edit*) and keeps your data in `/mnt/user/appdata/SmartBM/data`.

Running the same paste again updates the app (rebuild and replace the container, data and port are kept). After changing the backend code, regenerate the installer with `./scripts/build-unraid-installer.sh`.

## Install the extension (Edge)

1. Open `edge://extensions`, enable **Developer mode**, click **Load unpacked** and select the `extension/` folder.
2. Open the extension **Settings**: enter the server address, username and password. Edge asks for permission to contact that server only.
3. Optionally click **Import now** to bring in your existing Edge bookmarks.
4. Press `Alt+Shift+B` on any page to bookmark it. Change the shortcut at `edge://extensions/shortcuts`.

The extension also works in Chrome and Brave.

## Develop

```bash
./.venv/bin/python -m pytest -q
```

## Layout

- `backend/app`: FastAPI app (`routers/api.py` Bearer API, `routers/ui.py` cookie-only web UI endpoints, `services/sync.py`, `services/search.py`)
- `extension/`: MV3 extension (`background/`, `popup/`, `manager/`, `options/`, `lib/`)
- `API.md`: REST API for scripts and agents

# Smart Bookmark Manager

Self-hosted bookmark manager: an Edge (Chromium, Manifest V3) extension plus a small Docker backend. Tag, group and search your bookmarks, share selected bookmarks with all users, and sync between browsers through your own server. See [PLAN.md](PLAN.md) for the roadmap.

## Status: phase 1 (MVP) + web app

**Web app** (open `http://<server>:7774/`, no extension needed):

- Three-column library: categories tree, collections, tags, cards or list, detail panel with notes, read status, preview and usage.
- `Ctrl/Cmd+K` Spotlight: search everything, or paste a URL to save it. Page title, description, image and icon are fetched by the server.
- Star, pin, bulk select (`Shift`/`Ctrl` click), move, delete, drag bookmarks onto categories and collections, import (HTML, JSON, CSV) and JSON export.
- Four themes (Midnight, Daylight, Ocean, Graphite).
- Same data and sync engine as the extension, so both always show the same library.

**Extension and server:**

- Quick add from the browser: shortcut (`Alt+Shift+B`) or context menu. Set your own name, tags and category; Enter saves.
- Manager page: search, categories (nested), tag filters, sorting, edit, bulk-free simple UI.
- Offline-first: everything is cached in IndexedDB and synced in the background (on change and every 5 minutes).
- Multiple users. Admins can publish **global** bookmarks and categories that every user sees (read-only for others).
- Usage tracking per user (`open count`, `last opened`) is recorded from day one; the dashboard follows in phase 2.
- One-time import of the Edge bookmarks.

**AI tagging:** an admin picks Claude or a local server (Ollama) on the account page; the page text of a bookmark is sent to that provider to suggest 3 to 5 tags. Use *Tag with AI* in the detail panel or in bulk, or let users switch on automatic tagging in Settings. Your own tags are never changed.

Not yet built: usage dashboard, other AI features (summaries, semantic search, duplicates, link health), knowledge graph, insights report (see PLAN.md).

### Page details and private addresses

The server fetches page details itself and refuses private, loopback and link-local addresses (SSRF protection). To also get details for links to services on your own network, set `SBM_FETCH_ALLOW_PRIVATE=1` on the container (on Unraid: `SBM_FETCH_ALLOW_PRIVATE=1` in front of the install command; it is kept on updates).

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

### Option 1: ready-made image (recommended)

GitHub Actions builds the image on every push to `main` and publishes it to `ghcr.io/jayvenco/smartbookmarkmanager`. The package must be set to public once (GitHub > Packages > smartbookmarkmanager > Package settings > Change visibility), otherwise Unraid cannot pull it.

In the Unraid terminal (one command; data goes to `/mnt/user/appdata/SmartBM/data`):

```bash
mkdir -p /mnt/user/appdata/SmartBM/data && chown 99:100 /mnt/user/appdata/SmartBM/data
docker run -d --name SmartBM --restart unless-stopped --user 99:100 -p 7774:7774 \
  -v /mnt/user/appdata/SmartBM/data:/app/data ghcr.io/jayvenco/smartbookmarkmanager:latest
```

Or use the template: copy `unraid/smartbm-template.xml` to `/boot/config/plugins/dockerMan/templates-user/my-SmartBM.xml`, then Docker tab > *Add Container* > template *SmartBM*. Updates: Docker tab > *Check for updates*.

### Option 2: build on the server (no registry)

The image is built on the Unraid server itself, no registry needed. On your Mac copy the installer to the clipboard:

```bash
pbcopy < unraid/paste-into-unraid.txt
```

Open the Unraid terminal, paste, press Enter and answer the port question (default 7774). The script unpacks the source to `/mnt/user/appdata/SmartBM/src`, builds the image, starts the container `SmartBM` (visible in the Docker tab, with a template for *Edit*) and keeps your data in `/mnt/user/appdata/SmartBM/data`.

Running the same paste again updates the app (rebuild and replace the container, data and port are kept). After changing the backend code, regenerate the installer with `./scripts/build-unraid-installer.sh`.

## Install the extension (Edge)

Easiest: open the web app, *Settings*, **Download extension**, unzip it, then continue at step 1 and pick the unzipped folder. Maintainers: run `python3 scripts/build-extension-zip.py` after changing `extension/` (a test checks the zip is current).

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

#!/usr/bin/env bash
# Install or update Smart Bookmark Manager on Unraid. Builds the image on the server itself.
#
# GENERATED FILE: edit scripts/install-unraid.template.sh and run scripts/build-unraid-installer.sh.
#
# - Source code is unpacked to <appdata>/src, your data lives in <appdata>/data and is never touched.
# - Running it again = update (rebuild + replace the container).
# - Overrides: HOST_PORT=9000 APPDATA=/mnt/cache/appdata/SmartBM CONTAINER_NAME=SmartBM PUID=99 PGID=100
set -euo pipefail

NAME="${CONTAINER_NAME:-SmartBM}"
IMAGE="${IMAGE:-smartbm:latest}"
APPDATA="${APPDATA:-/mnt/user/appdata/SmartBM}"
CONTAINER_PORT=7774
DEFAULT_PORT=7774
PUID="${PUID:-99}"
PGID="${PGID:-100}"
TEMPLATE_DIR="${TEMPLATE_DIR:-/boot/config/plugins/dockerMan/templates-user}"

log() { printf '==> %s\n' "$*"; }

command -v docker >/dev/null 2>&1 || { echo "Docker not found. Run this on the Unraid server." >&2; exit 1; }
command -v base64 >/dev/null 2>&1 || { echo "base64 not found." >&2; exit 1; }

# Keep the port of an existing container on update.
OLD_PORT=""
if docker inspect "${NAME}" >/dev/null 2>&1; then
  OLD_PORT="$(docker inspect -f '{{with index .HostConfig.PortBindings "7774/tcp"}}{{(index . 0).HostPort}}{{end}}' "${NAME}" 2>/dev/null || true)"
fi

# Ask which port to use (skipped when HOST_PORT is set or when not run in a terminal).
if [ -z "${HOST_PORT:-}" ]; then
  HOST_PORT="${OLD_PORT:-${DEFAULT_PORT}}"
  if [ -t 0 ]; then
    read -r -p "Which port should the WebUI use on Unraid? [${HOST_PORT}] " answer || true
    HOST_PORT="${answer:-${HOST_PORT}}"
  fi
fi
case "${HOST_PORT}" in ''|*[!0-9]*) echo "Invalid port: ${HOST_PORT}" >&2; exit 1 ;; esac

# 1. Folders (Unraid default owner nobody:users = 99:100)
log "Creating folders in ${APPDATA}"
mkdir -p "${APPDATA}/data"
chown -R "${PUID}:${PGID}" "${APPDATA}/data" 2>/dev/null || true

# 2. Unpack the source (replaces the previous source, never the data)
SRC="${APPDATA}/src"
log "Unpacking source to ${SRC}"
rm -rf "${SRC}"
mkdir -p "${SRC}"
base64 -d <<'SBM_PAYLOAD' | tar -xz -C "${SRC}"
__SBM_PAYLOAD__
SBM_PAYLOAD

# 3. Build the image on this server
log "Building image ${IMAGE} (first build takes a minute or two)"
docker build -t "${IMAGE}" "${SRC}"
docker image prune -f --filter "label=app=smartbm" >/dev/null 2>&1 || true

# 4. Replace an existing container (data lives on the volume and is kept)
if docker inspect "${NAME}" >/dev/null 2>&1; then
  log "Stopping and removing existing container '${NAME}' (data is kept)"
  docker stop "${NAME}" >/dev/null 2>&1 || true
  docker rm "${NAME}" >/dev/null
fi

# 5. Start the container with Unraid labels so it shows in the Docker tab
log "Starting container '${NAME}' on port ${HOST_PORT}"
docker run -d \
  --name "${NAME}" \
  --restart unless-stopped \
  --user "${PUID}:${PGID}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${APPDATA}/data:/app/data" \
  --label "net.unraid.docker.managed=dockerman" \
  --label "net.unraid.docker.webui=http://[IP]:[PORT:${CONTAINER_PORT}]/" \
  "${IMAGE}" >/dev/null

# 6. User template so "Edit" in the Docker tab shows the right values
if [ -d "${TEMPLATE_DIR}" ]; then
  log "Saving template to ${TEMPLATE_DIR}/my-${NAME}.xml"
  cat > "${TEMPLATE_DIR}/my-${NAME}.xml" <<XML
<?xml version="1.0"?>
<Container version="2">
  <Name>${NAME}</Name>
  <Repository>${IMAGE}</Repository>
  <Registry/>
  <Network>bridge</Network>
  <MyIP/>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support/>
  <Project/>
  <Overview>Smart Bookmark Manager: self-hosted sync server for the Edge extension. Default login after first start: admin / admin (you must change it immediately).</Overview>
  <Category>Tools: Productivity:</Category>
  <WebUI>http://[IP]:[PORT:${CONTAINER_PORT}]/</WebUI>
  <ExtraParams>--restart=unless-stopped --user ${PUID}:${PGID}</ExtraParams>
  <PostArgs/>
  <CPUset/>
  <DateInstalled/>
  <Config Name="WebUI port" Target="${CONTAINER_PORT}" Default="${DEFAULT_PORT}" Mode="tcp" Description="Port on your Unraid server for the web interface and the extension." Type="Port" Display="always" Required="true" Mask="false">${HOST_PORT}</Config>
  <Config Name="Data (database and secret key)" Target="/app/data" Default="${APPDATA}/data" Mode="rw" Description="SQLite database and the session key. Back this folder up." Type="Path" Display="always" Required="true" Mask="false">${APPDATA}/data</Config>
</Container>
XML
  chmod 600 "${TEMPLATE_DIR}/my-${NAME}.xml"
else
  log "No dockerMan folder found (not Unraid?); template skipped"
fi

# 7. Wait for the healthcheck
log "Waiting for the app to become healthy..."
STATUS="starting"
for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${NAME}" 2>/dev/null || echo missing)"
  case "${STATUS}" in healthy|running) break ;; unhealthy|exited|dead|missing) break ;; esac
  sleep 2
done
if [ "${STATUS}" = "healthy" ] || [ "${STATUS}" = "running" ]; then
  :
else
  echo "Container is not healthy (status: ${STATUS}). Last log lines:" >&2
  docker logs --tail 30 "${NAME}" >&2 || true
  exit 1
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
log "Done. Open http://${IP:-<unraid-ip>}:${HOST_PORT}/"
echo "    First login: admin / admin (you must change it right away)."
echo "    In the Edge extension settings use server address: http://${IP:-<unraid-ip>}:${HOST_PORT}"
echo "    Use HTTPS through a reverse proxy before exposing this outside your home network."

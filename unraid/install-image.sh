# Smart Bookmark Manager: install or update on Unraid from the ready-made image.
# Paste in the Unraid terminal, or in a User Script (put a bash shebang line first there).
# Optional: HOST_PORT=9000  SBM_FETCH_ALLOW_PRIVATE=1  (put them in front of the command)
set -eu

NAME="${CONTAINER_NAME:-SmartBM}"
IMAGE="ghcr.io/jayvenco/smartbookmarkmanager:latest"
APPDATA="${APPDATA:-/mnt/user/appdata/SmartBM}"
TEMPLATE_DIR="/boot/config/plugins/dockerMan/templates-user"
PORT="${HOST_PORT:-7774}"

command -v docker >/dev/null 2>&1 || { echo "Docker not found. Run this on the Unraid server." >&2; exit 1; }
echo "${PORT}" | grep -Eq '^[0-9]+$' || { echo "Invalid port: ${PORT}" >&2; exit 1; }

# On update keep the port and the private-links option of the existing container
if docker inspect "${NAME}" >/dev/null 2>&1; then
  if [ -z "${HOST_PORT:-}" ]; then
    OLD="$(docker inspect -f '{{with index .HostConfig.PortBindings "7774/tcp"}}{{(index . 0).HostPort}}{{end}}' "${NAME}" 2>/dev/null || true)"
    PORT="${OLD:-${PORT}}"
  fi
  if [ -z "${SBM_FETCH_ALLOW_PRIVATE:-}" ]; then
    SBM_FETCH_ALLOW_PRIVATE="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${NAME}" 2>/dev/null | sed -n 's/^SBM_FETCH_ALLOW_PRIVATE=//p' | head -n 1)"
  fi
fi

echo "==> Pulling ${IMAGE}"
docker pull "${IMAGE}"

echo "==> Preparing ${APPDATA}/data"
mkdir -p "${APPDATA}/data"
chown 99:100 "${APPDATA}/data" 2>/dev/null || true

if docker inspect "${NAME}" >/dev/null 2>&1; then
  echo "==> Replacing existing container (data is kept)"
  docker stop "${NAME}" >/dev/null 2>&1 || true
  docker rm "${NAME}" >/dev/null
fi

ENVARG=""
if [ -n "${SBM_FETCH_ALLOW_PRIVATE:-}" ]; then ENVARG="-e SBM_FETCH_ALLOW_PRIVATE=${SBM_FETCH_ALLOW_PRIVATE}"; fi

echo "==> Starting ${NAME} on port ${PORT}"
docker run -d --name "${NAME}" --restart unless-stopped --user 99:100 \
  -p "${PORT}:7774" -v "${APPDATA}/data:/app/data" ${ENVARG} \
  --label "net.unraid.docker.managed=dockerman" \
  --label "net.unraid.docker.webui=http://[IP]:[PORT:7774]/" \
  --label "net.unraid.docker.icon=https://raw.githubusercontent.com/jayvenco/SmartBookmarkManager/main/backend/app/static/web/icon.svg" \
  "${IMAGE}" >/dev/null

if [ -d "${TEMPLATE_DIR}" ]; then
  cat > "${TEMPLATE_DIR}/my-${NAME}.xml" <<XML
<?xml version="1.0"?>
<Container version="2">
  <Name>${NAME}</Name>
  <Repository>${IMAGE}</Repository>
  <Network>bridge</Network>
  <Privileged>false</Privileged>
  <Overview>Smart Bookmark Manager. Default login admin / admin (change it immediately).</Overview>
  <Category>Tools: Productivity:</Category>
  <WebUI>http://[IP]:[PORT:7774]/</WebUI>
  <ExtraParams>--user 99:100</ExtraParams>
  <Config Name="WebUI port" Target="7774" Default="7774" Mode="tcp" Description="Web app and extension port." Type="Port" Display="always" Required="true" Mask="false">${PORT}</Config>
  <Config Name="Data" Target="/app/data" Default="${APPDATA}/data" Mode="rw" Description="Database and secret key. Back this up." Type="Path" Display="always" Required="true" Mask="false">${APPDATA}/data</Config>
</Container>
XML
fi

echo "==> Waiting for the app..."
STATUS="starting"
for i in $(seq 1 45); do
  STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${NAME}" 2>/dev/null || echo missing)"
  case "${STATUS}" in healthy|running|unhealthy|exited|dead|missing) break ;; esac
  sleep 2
done
if [ "${STATUS}" != "healthy" ] && [ "${STATUS}" != "running" ]; then
  echo "Container status: ${STATUS}. Last logs:" >&2
  docker logs --tail 30 "${NAME}" >&2 || true
  exit 1
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "Done. Open http://${IP:-<unraid-ip>}:${PORT}/  (first login: admin / admin, change it right away)"

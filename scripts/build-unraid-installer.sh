#!/usr/bin/env bash
# Generates the self-contained Unraid installer (backend source embedded) from the current code.
#   unraid/install-smartbm.sh      runnable script
#   unraid/paste-into-unraid.txt   same script wrapped so it can be pasted into the Unraid terminal
# Run this after every backend change, then commit the results.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p unraid
PAYLOAD="$(COPYFILE_DISABLE=1 tar -czf - -C backend \
  --exclude=tests --exclude='__pycache__' --exclude='*.pyc' --exclude=.pytest_cache --exclude=.DS_Store \
  Dockerfile requirements.txt .dockerignore app | base64 | tr -d '\n' | fold -w 100)"

TEMPLATE=scripts/install-unraid.template.sh
if grep -q "$(printf '\t')" "${TEMPLATE}"; then echo "Template contains tabs (breaks terminal paste)." >&2; exit 1; fi

{
  sed '/^__SBM_PAYLOAD__$/,$d' "${TEMPLATE}"
  printf '%s\n' "${PAYLOAD}"
  sed '1,/^__SBM_PAYLOAD__$/d' "${TEMPLATE}"
} > unraid/install-smartbm.sh
chmod +x unraid/install-smartbm.sh

{
  echo "set +H"
  echo "cat > /tmp/install-smartbm.sh <<'SBM_INSTALLER_EOF'"
  cat unraid/install-smartbm.sh
  echo "SBM_INSTALLER_EOF"
  echo "bash /tmp/install-smartbm.sh"
} > unraid/paste-into-unraid.txt

echo "Wrote unraid/install-smartbm.sh and unraid/paste-into-unraid.txt ($(wc -c < unraid/paste-into-unraid.txt) bytes)"

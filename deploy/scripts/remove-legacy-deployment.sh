#!/usr/bin/env bash
# Remove/stop the previous ElevateTrust deployment before installing Chattiq.
# Run on EC2: sudo bash deploy/scripts/remove-legacy-deployment.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo"
  exit 1
fi

echo "==> Stop legacy systemd services"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP_LEGACY="${SCRIPT_DIR}/stop-legacy-services.sh"
if [[ -f "${STOP_LEGACY}" ]]; then
  bash "${STOP_LEGACY}" || true
else
  curl -fsSL "https://raw.githubusercontent.com/Pandey-A/ET-Revamped/feature/chatops-deploy/deploy/scripts/stop-legacy-services.sh" | bash || true
fi

echo "==> Stop anything listening on app ports 8000-8003"
for port in 8000 8001 8002 8003; do
  if command -v fuser &>/dev/null; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
done
sleep 2

echo "==> Disable old nginx sites"
for site in ai-agent-backend elevatetrust default deepfake_et; do
  rm -f "/etc/nginx/sites-enabled/${site}" 2>/dev/null || true
done

echo "==> Stop legacy Docker stacks (if any)"
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qE 'hr_agent|deepfake'; then
  for dir in /opt/deepfake_et_frontend/HR-Reachout-Agent-main /opt/chattiq/HR-Reachout-Agent-main; do
    if [[ -f "${dir}/docker-compose.yml" ]]; then
      (cd "${dir}" && docker compose down 2>/dev/null) || true
    fi
  done
fi

echo "==> Optional backup of old install tree"
if [[ -d /opt/deepfake_et_frontend && ! -d /opt/deepfake_et_frontend.bak ]]; then
  echo "Backing up /opt/deepfake_et_frontend -> /opt/deepfake_et_frontend.bak"
  mv /opt/deepfake_et_frontend /opt/deepfake_et_frontend.bak
fi

echo "Legacy removal done. Clone ET-Revamped into /opt/deepfake_et_frontend next."

#!/usr/bin/env bash
# Stop old ElevateTrust / single-backend deployments before Chattiq install.
set -euo pipefail

LEGACY_SERVICES=(
  ai-agent-backend
  elevatetrust-backend
  deepfake-backend
  et-backend
  hr-agent-backend
  next-frontend
  express-api
)

echo "Stopping legacy systemd services (if present)..."
for svc in "${LEGACY_SERVICES[@]}"; do
  if systemctl list-unit-files "${svc}.service" &>/dev/null; then
    sudo systemctl stop "${svc}.service" 2>/dev/null || true
    sudo systemctl disable "${svc}.service" 2>/dev/null || true
    echo "  stopped ${svc}"
  fi
done

# Old HR-only docker stack
if docker ps -a --format '{{.Names}}' | grep -q '^hr_agent_app$'; then
  echo "Stopping legacy hr_agent docker compose..."
  (cd /opt/deepfake_et_frontend/HR-Reachout-Agent-main 2>/dev/null && docker compose down) || true
fi

echo "Legacy stop complete. Chattiq services are not started by this script."

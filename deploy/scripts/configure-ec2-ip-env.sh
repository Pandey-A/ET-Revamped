#!/usr/bin/env bash
# Set /opt/deepfake_et_frontend/.env for HTTP + EC2 public IP deploy.
# Usage (on EC2): sudo bash deploy/scripts/configure-ec2-ip-env.sh 3.110.45.67
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deepfake_et_frontend}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
IP="${1:-}"

if [[ -z "${IP}" ]]; then
  IP="$(curl -sf --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
fi
if [[ -z "${IP}" ]]; then
  echo "Usage: sudo bash $0 <EC2_PUBLIC_IP>"
  exit 1
fi

BASE="http://${IP}"
mkdir -p "$(dirname "${ENV_FILE}")"
touch "${ENV_FILE}"

upsert() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    echo "${key}=${val}" >> "${ENV_FILE}"
  fi
}

upsert DEPLOY_TARGET ip
upsert EC2_PUBLIC_IP "${IP}"
upsert APP_DOMAIN "${IP}"
upsert APP_PUBLIC_URL "${BASE}"
upsert COOKIE_SECURE false
upsert TELEGRAM_WEBHOOK_BASE_URL ""
upsert FRONTEND_URL "${BASE}"
upsert CORS_ORIGINS "${BASE}"
upsert NEXT_PUBLIC_API_URL "${BASE}/api"
upsert NEXT_PUBLIC_AI_AGENT_API_URL "${BASE}/api/agent"
upsert NEXT_PUBLIC_APP_ORIGIN "${BASE}"
upsert NEXT_PUBLIC_WIDGET_CHAT_API_URL "${BASE}"
upsert NEXT_ALLOWED_ORIGINS "${IP}"

rm -f "${ENV_FILE}.bak"
echo "Wrote ${ENV_FILE} for http://${IP}"
echo "Next: set POSTGRES_PASSWORD, JWT_SECRET, then sudo bash deploy/scripts/deploy-ec2.sh"

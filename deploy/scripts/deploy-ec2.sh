#!/usr/bin/env bash
# =============================================================================
# Chattiq EC2 production deploy — run on the server as ubuntu (with sudo).
#
# First time:
#   1. Copy deploy/env/production.env.example → /opt/deepfake_et_frontend/.env and edit secrets
#   2. Copy HR-Reachout-Agent-main/AgentManager/config.json (see config.json.example)
#   3. sudo bash deploy/scripts/deploy-ec2.sh
#
# Updates:
#   cd /opt/deepfake_et_frontend && git pull && sudo bash deploy/scripts/deploy-ec2.sh
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deepfake_et_frontend}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
BRANCH="${GIT_BRANCH:-feature/chatops-deploy}"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/scripts/deploy-ec2.sh"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy deploy/env/production.env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

DOMAIN="${APP_DOMAIN:-}"

is_ipv4() {
  [[ "${1}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

# IP deploy: DEPLOY_TARGET=ip or APP_DOMAIN=1.2.3.4
if [[ -z "${DOMAIN}" ]]; then
  if [[ "${DEPLOY_TARGET:-}" == "ip" ]]; then
    DOMAIN="$(curl -sf --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  fi
  DOMAIN="${DOMAIN:-elevatetrust.in}"
fi

if is_ipv4 "${DOMAIN}" || [[ "${DEPLOY_TARGET:-}" == "ip" ]]; then
  DEPLOY_TARGET=ip
  APP_PUBLIC_URL="http://${DOMAIN}"
  COOKIE_SECURE="${COOKIE_SECURE:-false}"
else
  DEPLOY_TARGET=domain
  if [[ -z "${APP_PUBLIC_URL:-}" ]]; then
    APP_PUBLIC_URL="https://${DOMAIN}"
  fi
  APP_PUBLIC_URL="${APP_PUBLIC_URL%/}"
  if [[ "${APP_PUBLIC_URL}" != http* ]]; then
    APP_PUBLIC_URL="https://${APP_PUBLIC_URL}"
  fi
  COOKIE_SECURE="${COOKIE_SECURE:-true}"
fi

APP_PUBLIC_URL="${APP_PUBLIC_URL%/}"
export APP_DOMAIN="${DOMAIN}" APP_PUBLIC_URL DEPLOY_TARGET COOKIE_SECURE

# Ubuntu docker.io often lacks "docker compose" v2; support plugin or docker-compose v1.
docker_compose() {
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    echo "Installing Docker Compose..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin docker-compose
    if docker compose version &>/dev/null 2>&1; then
      docker compose "$@"
    elif command -v docker-compose &>/dev/null; then
      docker-compose "$@"
    else
      echo "ERROR: Docker Compose not available. Run: apt-get install -y docker-compose-plugin"
      exit 1
    fi
  fi
}

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "ERROR: ${APP_DIR} is not a git clone. Clone first:"
  echo "  git clone -b ${BRANCH} ${GIT_REPO:-https://github.com/Pandey-A/ET-Revamped.git} ${APP_DIR}"
  exit 1
fi

echo "==> Stopping legacy deployment"
bash "${APP_DIR}/deploy/scripts/stop-legacy-services.sh" || true

echo "==> Installing system packages (if needed)"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  git curl nginx docker.io docker-compose-plugin docker-compose \
  build-essential python3 python3-venv python3-pip \
  >/dev/null 2>&1 || true
if ! docker compose version &>/dev/null 2>&1 && ! command -v docker-compose &>/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin docker-compose
fi

if ! command -v node &>/dev/null || [[ "$(node -v 2>/dev/null || echo v0)" < "v18" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Pulling latest code (${BRANCH})"
cd "${APP_DIR}"
sudo -u ubuntu git fetch origin
sudo -u ubuntu git checkout "${BRANCH}"
sudo -u ubuntu git pull origin "${BRANCH}" || true

echo "==> Starting PostgreSQL + Redis"
docker_compose -f "${APP_DIR}/deploy/docker-compose.infra.yml" up -d
sleep 5

echo "==> Python virtualenv + dependencies"
cd "${APP_DIR}/HR-Reachout-Agent-main"
sudo -u ubuntu python3 -m venv .venv
sudo -u ubuntu .venv/bin/pip install -q --upgrade pip
# Linux EC2: use lean server requirements (full requirements.txt includes Windows-only pywin32)
REQ_FILE="requirements_server.txt"
if [[ ! -f "${REQ_FILE}" ]]; then
  REQ_FILE="requirements.txt"
fi
LINUX_REQ="$(mktemp)"
grep -vE '^(pywin32|pyreadline3)==' "${REQ_FILE}" > "${LINUX_REQ}"
sudo -u ubuntu .venv/bin/pip install -q -r "${LINUX_REQ}"
rm -f "${LINUX_REQ}"
sudo -u ubuntu .venv/bin/pip install -q gunicorn 'uvicorn[standard]'

if [[ ! -f "${APP_DIR}/HR-Reachout-Agent-main/AgentManager/config.json" ]]; then
  echo "ERROR: Missing AgentManager/config.json — copy from config.json.example and add API keys."
  exit 1
fi

bash "${APP_DIR}/deploy/scripts/init-runtime-stores.sh"

echo "==> PostgreSQL schema migrate"
cd "${APP_DIR}/server"
sudo -u ubuntu npm ci --omit=dev
sudo -u ubuntu env $(grep -v '^#' "${ENV_FILE}" | xargs) npm run db:migrate

echo "==> Build Next.js (standalone)"
cd "${APP_DIR}/client_new"
# Next reads NEXT_PUBLIC_* at build time
sudo -u ubuntu env $(grep -v '^#' "${ENV_FILE}" | xargs) npm ci
sudo -u ubuntu env $(grep -v '^#' "${ENV_FILE}" | xargs) npm run build
rm -rf .next/standalone/public .next/standalone/.next/static 2>/dev/null || true
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static

echo "==> Install systemd units"
cp "${APP_DIR}/deploy/systemd/chattiq-"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable chattiq-fastapi chattiq-express chattiq-next

echo "==> Nginx"
if [[ "${DEPLOY_TARGET}" == "ip" ]]; then
  NGINX_TEMPLATE="chattiq-ip.conf.template"
  echo "Using HTTP nginx for EC2 IP (${DOMAIN})"
  cp "${APP_DIR}/deploy/nginx/${NGINX_TEMPLATE}" /etc/nginx/sites-available/chattiq
else
  NGINX_TEMPLATE="chattiq-http-bootstrap.conf.template"
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    NGINX_TEMPLATE="chattiq.conf.template"
    echo "Using HTTPS nginx for ${DOMAIN}"
  else
    echo "No TLS cert yet — temporary HTTP nginx for ${DOMAIN}"
  fi
  sed "s/__DOMAIN__/${DOMAIN}/g" "${APP_DIR}/deploy/nginx/${NGINX_TEMPLATE}" \
    > /etc/nginx/sites-available/chattiq
fi
rm -f /etc/nginx/sites-enabled/default \
  /etc/nginx/sites-enabled/ai-agent-backend 2>/dev/null || true
ln -sf /etc/nginx/sites-available/chattiq /etc/nginx/sites-enabled/chattiq
nginx -t
systemctl reload nginx

echo "==> Restart application services"
systemctl restart chattiq-fastapi
sleep 3
systemctl restart chattiq-express
systemctl restart chattiq-next

echo "==> Sync agents Postgres → FastAPI"
cd "${APP_DIR}/server"
sudo -u ubuntu env $(grep -v '^#' "${ENV_FILE}" | xargs) npm run agents:sync-fastapi || {
  echo "WARN: Agent sync failed (no agents yet or FastAPI not ready). Retry: cd server && npm run agents:sync-fastapi"
}

echo ""
echo "Deploy complete."
if [[ "${DEPLOY_TARGET}" == "ip" ]]; then
  echo "  Site:    ${APP_PUBLIC_URL}/"
  echo "  Widget:  data-api-base=\"${APP_PUBLIC_URL}\""
  echo "  Note:    HTTP only. When elevatetrust.in (or new domain) is ready, update .env to https URLs and redeploy."
else
  echo "  Site:    ${APP_PUBLIC_URL}/"
  echo "  Widget:  data-api-base=\"${APP_PUBLIC_URL}\""
  echo "  TLS:     sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} && sudo bash deploy/scripts/deploy-ec2.sh"
fi
echo "  Health:  curl -s http://127.0.0.1:8000/agents | head"
echo "  Logs:    journalctl -u chattiq-fastapi -f"
systemctl is-active chattiq-fastapi chattiq-express chattiq-next || true

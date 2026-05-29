#!/usr/bin/env bash
# Full clean redeploy on EC2 (run on server with sudo after code is in APP_DIR).
# Usage:
#   sudo bash /opt/deepfake_et_frontend/deploy/scripts/fresh-redeploy-ec2.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deepfake_et_frontend}"
BACKUP_DIR="/tmp/chattiq-redeploy-backup"
ENV_FILE="${APP_DIR}/.env"
DOMAIN="${APP_DOMAIN:-elevatetrust.in}"

if [[ $EUID -ne 0 ]]; then
  echo "Run with: sudo bash $0"
  exit 1
fi

echo "==> Stop malware / miners (if present)"
pkill -9 -f xmrig 2>/dev/null || true
pkill -9 -f scanner_linux 2>/dev/null || true
for u in ubuntu root; do
  crontab -u "$u" -l 2>/dev/null | grep -vE 'xmrig|scanner_linux' | crontab -u "$u" - 2>/dev/null || true
done

echo "==> Stop Chattiq services"
systemctl stop chattiq-fastapi chattiq-express chattiq-next 2>/dev/null || true
bash "${APP_DIR}/deploy/scripts/stop-legacy-services.sh" 2>/dev/null || true

echo "==> Restore production .env from backup (if uploaded)"
if [[ -f "${BACKUP_DIR}/.env" ]]; then
  cp "${BACKUP_DIR}/.env" "${ENV_FILE}"
  chown ubuntu:ubuntu "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${APP_DIR}/deploy/env/production.env.example" "${ENV_FILE}"
  chown ubuntu:ubuntu "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "WARN: Created .env from example — set secrets before going live."
fi

echo "==> Ensure elevatetrust.in URLs in .env"
python3 << 'PY'
import re
from pathlib import Path
path = Path("/opt/deepfake_et_frontend/.env")
lines = path.read_text().splitlines()
domain = "elevatetrust.in"
base = f"https://{domain}"

def upsert(key, value):
    global lines
    found = False
    out = []
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{key}={value}")
    lines = out

upsert("APP_DOMAIN", domain)
upsert("APP_PUBLIC_URL", base)
upsert("TELEGRAM_WEBHOOK_BASE_URL", base)
upsert("COOKIE_SECURE", "true")
upsert("FRONTEND_URL", base)
upsert("CORS_ORIGINS", f"{base},https://www.{domain}")
upsert("NEXT_PUBLIC_API_URL", f"{base}/api")
upsert("NEXT_PUBLIC_AI_AGENT_API_URL", f"{base}/api/agent")
upsert("NEXT_PUBLIC_APP_ORIGIN", base)
upsert("NEXT_PUBLIC_WIDGET_CHAT_API_URL", base)
path.write_text("\n".join(lines) + "\n")
PY

echo "==> AgentManager/config.json"
CFG="${APP_DIR}/HR-Reachout-Agent-main/AgentManager/config.json"
if [[ -f "${BACKUP_DIR}/config.json" ]]; then
  cp "${BACKUP_DIR}/config.json" "${CFG}"
fi
if [[ ! -f "${CFG}" ]]; then
  cp "${APP_DIR}/HR-Reachout-Agent-main/AgentManager/config.json.example" "${CFG}"
fi
python3 << 'PY'
import json
from pathlib import Path
p = Path("/opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/config.json")
c = json.loads(p.read_text())
c.setdefault("weaviate", {})["url"] = "http://127.0.0.1:8080"
c.setdefault("OpenAI", {})["model"] = c.get("OpenAI", {}).get("model") or "gpt-4o-mini"
p.write_text(json.dumps(c, indent=2) + "\n")
PY
chown ubuntu:ubuntu "${CFG}"

echo "==> Run standard deploy"
bash "${APP_DIR}/deploy/scripts/deploy-ec2.sh"

echo "==> TLS (Let's Encrypt) if port 80 is reachable"
if command -v certbot &>/dev/null; then
  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos \
      -m "admin@${DOMAIN}" --redirect || echo "WARN: certbot failed — open inbound 80/443 and re-run certbot"
    bash "${APP_DIR}/deploy/scripts/deploy-ec2.sh" || true
  fi
else
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos \
    -m "admin@${DOMAIN}" --redirect || echo "WARN: certbot failed"
  bash "${APP_DIR}/deploy/scripts/deploy-ec2.sh" || true
fi

echo "==> Done. Verify: curl -sI https://${DOMAIN}/ | head -5"

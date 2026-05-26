#!/usr/bin/env bash
# Apply Bedrock non-streaming chat + Llama 3 prompt fixes on EC2, then restart FastAPI.
# Run on the server: sudo bash deploy/scripts/patch-bedrock-nonstream-chat.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deepfake_et_frontend}"
HR_DIR="${APP_DIR}/HR-Reachout-Agent-main"
SERVICE="${FASTAPI_SERVICE:-chattiq-fastapi}"

if [[ ! -d "${HR_DIR}/AgentManager" ]]; then
  echo "Missing ${HR_DIR}. Set APP_DIR or clone the repo first."
  exit 1
fi

echo "==> Ensuring JSON store ownership"
chown -R ubuntu:ubuntu "${HR_DIR}/widget_sessions_store.json" \
  "${HR_DIR}/Agents_store.json" 2>/dev/null || true

echo "==> Restarting ${SERVICE}"
systemctl restart "${SERVICE}"
systemctl --no-pager status "${SERVICE}" | head -15

echo "==> Smoke test (adjust AGENT_ID if needed)"
AGENT_ID="${AGENT_ID:-}"
curl -sf --max-time 45 -X POST "http://127.0.0.1:8000/chat/stream/chat" \
  -H "Content-Type: application/json" \
  -d "{\"user_input\":\"hello\",\"session_id\":\"widget_patch_test\",\"agent_id\":\"${AGENT_ID}\"}" \
  | head -c 500 || echo "(curl failed — check journalctl -u ${SERVICE})"

echo ""
echo "Done. Test the widget at your public URL when AGENT_ID is set."

#!/usr/bin/env bash
# Initialize FastAPI JSON stores if missing (safe to re-run).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deepfake_et_frontend}"
HR_DIR="${APP_DIR}/HR-Reachout-Agent-main"

mkdir -p "${HR_DIR}/temp_files" "${HR_DIR}/logs" "${APP_DIR}/temp_files"

init_json_array() {
  local f="$1"
  if [[ ! -f "$f" ]] || [[ ! -s "$f" ]]; then
    echo '[]' > "$f"
    echo "Initialized $f"
  fi
}

init_json_object() {
  local f="$1"
  if [[ ! -f "$f" ]] || [[ ! -s "$f" ]]; then
    echo '{}' > "$f"
    echo "Initialized $f"
  fi
}

init_json_array "${HR_DIR}/Agents_store.json"
init_json_array "${HR_DIR}/tickets_store.json"
init_json_array "${HR_DIR}/leads_store.json"
init_json_object "${HR_DIR}/widget_sessions_store.json"

chmod -R u+rw "${HR_DIR}"/*.json 2>/dev/null || true
echo "Runtime stores ready."

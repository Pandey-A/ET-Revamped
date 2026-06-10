#!/usr/bin/env bash
# Start local Weaviate + Redis for RAG development.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d weaviate redis
echo "Waiting for Weaviate..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:8080/v1/.well-known/ready" >/dev/null; then
    echo "Weaviate is ready at http://localhost:8080"
    exit 0
  fi
  sleep 2
done
echo "Weaviate did not become ready in time. Check: docker compose logs weaviate"
exit 1

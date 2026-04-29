# EC2 Deployment Guide (Backend + AI Agent)

This guide deploys the AI agent backend from this repository to an AWS EC2 instance with:
- FastAPI app (`HR-Reachout-Agent-main/FastAPI-server/main.py`)
- Core agent modules (`HR-Reachout-Agent-main/AgentManager/...`)
- Reverse proxy (Nginx)
- Process manager (systemd)

## 1. Prerequisites

- AWS EC2 instance (Ubuntu 22.04 LTS recommended)
- Domain/subdomain (optional but recommended)
- Security Group open ports:
  - `22` (SSH)
  - `80` (HTTP)
  - `443` (HTTPS)
  - `8000` (only if you want direct backend access; otherwise keep private)
- Python 3.10+
- Access to required external services used by the agent (OpenAI, Weaviate, Telegram)

## 2. SSH and Base Setup

```bash
ssh -i /path/to/key.pem ubuntu@<EC2_PUBLIC_IP>
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3 python3-venv python3-pip nginx
```

## 3. Clone Repository

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> deepfake_et_frontend
sudo chown -R ubuntu:ubuntu /opt/deepfake_et_frontend
cd /opt/deepfake_et_frontend/HR-Reachout-Agent-main
```

## 4. Python Environment and Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

If you use extra backend dependencies from `FastAPI-server`, install them too:

```bash
cd /opt/deepfake_et_frontend/HR-Reachout-Agent-main/FastAPI-server
pip install fastapi uvicorn[standard]
cd /opt/deepfake_et_frontend/HR-Reachout-Agent-main
```

## 5. Runtime Files and Permissions

Ensure these files/directories exist and are writable by the service user:

```bash
cd /opt/deepfake_et_frontend/HR-Reachout-Agent-main
mkdir -p logs
mkdir -p /opt/deepfake_et_frontend/temp_files
touch Agents_store.json tickets_store.json
```

If JSON files are empty, initialize valid JSON arrays:

```bash
echo "[]" > Agents_store.json
echo "[]" > tickets_store.json
```

## 6. Configure Secrets and Endpoints

Update:
- `HR-Reachout-Agent-main/AgentManager/config.json`

Set valid values for:
- OpenAI model + key/env integration
- Weaviate host/port/API credentials
- Telegram bot tokens and chat IDs

Important:
- Do not commit secrets.
- Prefer environment variables and load them in config at startup.

## 7. Production Uvicorn Service (systemd)

Create service file:

```bash
sudo nano /etc/systemd/system/ai-agent-backend.service
```

Paste:

```ini
[Unit]
Description=AI Agent FastAPI Backend
After=network.target

[Service]
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/deepfake_et_frontend/HR-Reachout-Agent-main
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/deepfake_et_frontend/HR-Reachout-Agent-main/.venv/bin/uvicorn FastAPI-server.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ai-agent-backend
sudo systemctl start ai-agent-backend
sudo systemctl status ai-agent-backend
```

View logs:

```bash
journalctl -u ai-agent-backend -f
```

## 8. Nginx Reverse Proxy

Create Nginx site:

```bash
sudo nano /etc/nginx/sites-available/ai-agent-backend
```

Paste:

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN_OR_IP>;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support (/ws, /ws/admin)
    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /ws/admin {
        proxy_pass http://127.0.0.1:8000/ws/admin;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/ai-agent-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 9. HTTPS (Recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
```

Auto-renew check:

```bash
sudo certbot renew --dry-run
```

## 10. Telegram Webhook Setup

Current startup logic sets webhook in `FastAPI-server/main.py` using a hardcoded base URL.

Before production:
- Replace `BASE_WEBHOOK_URL` with your real HTTPS domain.
- Or move it to env/config and read dynamically.

Webhook format expected by app:

```text
https://<YOUR_DOMAIN>/telegram-webhook/<BOT_TOKEN>
```

Manual set webhook test:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<YOUR_DOMAIN>/telegram-webhook/<BOT_TOKEN>"}'
```

## 11. Health and Smoke Tests

```bash
curl http://127.0.0.1:8000/agents
curl http://127.0.0.1:8000/chat/is_escalated/test-session
curl -X POST http://127.0.0.1:8000/chat/session
```

From external host:

```bash
curl https://<YOUR_DOMAIN>/agents
```

## 12. Frontend Connection

Set frontend env (`client_new/.env.production` or deployment env):

```env
NEXT_PUBLIC_AI_AGENT_API_URL=https://<YOUR_DOMAIN>
```

Then rebuild frontend.

## 13. Operational Notes

- Keep one backend process per host unless you explicitly coordinate shared JSON file writes.
- Back up `Agents_store.json` and `tickets_store.json` regularly.
- If Weaviate is remote, verify outbound access from EC2 to required gRPC/HTTP ports.
- For large traffic, migrate JSON stores to a real DB (PostgreSQL or DynamoDB).

## 14. Zero-Downtime Update Pattern

```bash
cd /opt/deepfake_et_frontend
git pull
cd HR-Reachout-Agent-main
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart ai-agent-backend
sudo systemctl status ai-agent-backend
```

## 15. Common Failures and Fixes

- `grpc UNAVAILABLE` to Weaviate:
  - Check security groups, outbound rules, DNS, and remote service availability.
- Telegram not receiving updates:
  - Verify HTTPS certificate and webhook URL/token.
- WebSocket disconnects behind Nginx:
  - Ensure `Upgrade` and `Connection` headers are set.
- Slow startup due to external dependencies:
  - Add timeouts/retries and run expensive indexing in background tasks only.

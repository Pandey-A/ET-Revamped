# Deploy on EC2 (public IP + HTTP)

Repo: **[Pandey-A/ET-Revamped](https://github.com/Pandey-A/ET-Revamped)** (public — no GitHub login on server)  
Server path: `/opt/deepfake_et_frontend`  
IP: **13.200.189.83**

**PEM (local only):** `et_deployment_prod.pem` — do not commit to GitHub.

---

## What you are deploying

| Service | Port (internal) | URL via nginx |
|---------|-----------------|---------------|
| Next.js UI + widget BFF | 8001 | `http://EC2_IP/` |
| Express (auth, agents, Postgres) | 8002 | `http://EC2_IP/api/` |
| FastAPI (chat, widget, RAG) | 8000 | `http://EC2_IP/api/agent/` |
| PostgreSQL | 5432 (Docker, local only) | — |
| Redis | 6379 (Docker, local only) | — |

---

## Part A — On your Mac (before SSH)

### A1. Get your EC2 public IP

1. AWS Console → **EC2** → **Instances** → select your instance.  
2. Copy **Public IPv4 address** (example: `3.110.45.67`).  
   Write it down as `EC2_IP` below.

### A2. Security group

Inbound rules must allow:

| Port | Purpose |
|------|---------|
| 22 | SSH |
| 80 | HTTP (app) |

You do **not** need to open 8000–8002 to the internet (nginx proxies internally).

### A3. Fix PEM permissions (once)

From your project folder on Mac:

```bash
cd /Users/ashutoshpandey/Desktop/Deepfake_ET_Frontend
chmod 400 et_deployment_prod.pem
```

### A4. Test SSH

Replace `EC2_IP` with your real IP:

```bash
ssh -i et_deployment_prod.pem ubuntu@EC2_IP
```

If this works, type `exit` to return to your Mac.

### A5. Push latest code to GitHub (if not already)

On your Mac, ensure `feature/chatops-deploy` is pushed to `https://github.com/Pandey-A/ET-Revamped` so the server can `git clone` / `git pull`.

---

## Part B — SSH into EC2

```bash
ssh -i et_deployment_prod.pem ubuntu@13.200.189.83
```

---

## Part C — Remove old deployment (run from `~`, before clone)

Do **not** run `deploy/scripts/...` from home — that path does not exist until you clone.

**Option 1 — download script from GitHub (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/Pandey-A/ET-Revamped/feature/chatops-deploy/deploy/scripts/remove-legacy-deployment.sh -o /tmp/remove-legacy-deployment.sh
sudo bash /tmp/remove-legacy-deployment.sh
```

**Option 2 — after clone only** (full path):

```bash
sudo bash /opt/deepfake_et_frontend/deploy/scripts/remove-legacy-deployment.sh
```

Run Option 1 **before** `git clone` so a fresh clone is not moved to `.bak`.

---

## Part D — Clone repo

No GitHub login needed — the repo is public.

```bash
sudo mkdir -p /opt/deepfake_et_frontend
sudo chown ubuntu:ubuntu /opt/deepfake_et_frontend

git clone -b feature/chatops-deploy https://github.com/Pandey-A/ET-Revamped.git /opt/deepfake_et_frontend
cd /opt/deepfake_et_frontend
chmod +x deploy/scripts/*.sh
```

---

## Part E — Configure environment (on EC2)

### E1. Auto-fill URLs for your EC2 IP

```bash
cd /opt/deepfake_et_frontend
sudo bash deploy/scripts/configure-ec2-ip-env.sh 13.200.189.83
```

### E2. Edit secrets

```bash
sudo nano /opt/deepfake_et_frontend/.env
```

Set at minimum:

- `POSTGRES_PASSWORD` — strong password  
- `DATABASE_URL` — same password in the connection string  
- `JWT_SECRET` — long random string  
- `EMAIL_VERIFY_SECRET` — long random string  

Confirm these lines match your IP (script should have set them):

```env
DEPLOY_TARGET=ip
APP_DOMAIN=13.200.189.83
APP_PUBLIC_URL=http://13.200.189.83
COOKIE_SECURE=false
NEXT_PUBLIC_API_URL=http://13.200.189.83/api
NEXT_PUBLIC_AI_AGENT_API_URL=http://13.200.189.83/api/agent
NEXT_PUBLIC_APP_ORIGIN=http://13.200.189.83
```

Save (`Ctrl+O`, Enter, `Ctrl+X`).

### E3. FastAPI `config.json` (required)

```bash
cp /opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/config.json.example \
   /opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/config.json

nano /opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/config.json
```

Add your **OpenAI** key, **Weaviate**, **Cohere**, and WhatsApp/Telegram blocks if you use them.

---

## Part F — Run deploy script (on EC2)

```bash
cd /opt/deepfake_et_frontend
sudo bash deploy/scripts/deploy-ec2.sh
```

This will (15–30 min first time):

1. Install Docker, Node 20, Python venv  
2. Start **PostgreSQL + Redis** containers  
3. Run DB migrations (`server/db/schema.sql`)  
4. Build **Next.js** with your `NEXT_PUBLIC_*` URLs  
5. Install **systemd** services (FastAPI, Express, Next)  
6. Configure **nginx** for HTTP on port 80  
7. Sync agents Postgres → FastAPI (if any exist)  

If it fails, read the error, fix `.env` or `config.json`, and run the script again.

---

## Part G — Verify (browser + curl)

### G1. From your Mac

Open in browser:

```text
http://EC2_IP/
```

Register / log in → **Admin** → **AI Agents** → create an agent → **Widget generator**.

### G2. On EC2 (health checks)

```bash
curl -s http://127.0.0.1:8000/agents | head
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8002/api/
sudo systemctl status chattiq-fastapi chattiq-express chattiq-next
```

All three services should be **active (running)**.

### G3. Widget embed (customer site)

```html
<script
  src="http://EC2_IP/widget.js"
  data-agent-id="YOUR_AGENT_ID"
  data-api-base="http://EC2_IP"
></script>
```

Use **`http://`** and your **IP** — not elevatetrust.in until DNS is switched.

### G4. Make yourself admin

After registering on `http://EC2_IP/register`:

```bash
docker exec -it chattiq_postgres psql -U chattiq -d chattiq \
  -c "UPDATE users SET role='admin' WHERE email='your@email.com';"
```

---

## Part H — PostgreSQL (production DB on EC2)

Data lives in Docker volume `chattiq_pg_data`.

**Backup:**

```bash
docker exec chattiq_postgres pg_dump -U chattiq chattiq > ~/chattiq-backup-$(date +%F).sql
```

**Copy local DB to EC2 (optional):**  
Export from your local Postgres, copy file to EC2, then:

```bash
docker exec -i chattiq_postgres psql -U chattiq -d chattiq < chattiq-backup.sql
cd /opt/deepfake_et_frontend/server && npm run agents:sync-fastapi
```

---

## Part I — Logs and restarts

```bash
sudo journalctl -u chattiq-fastapi -f
sudo journalctl -u chattiq-express -f
sudo journalctl -u chattiq-next -f

sudo systemctl restart chattiq-fastapi chattiq-express chattiq-next
```

**After code changes:**

```bash
cd /opt/deepfake_et_frontend
git pull origin feature/chatops-deploy
sudo bash deploy/scripts/deploy-ec2.sh
```

---

## Part J — Later: switch to elevatetrust.in (or new domain)

1. Point DNS A record to this EC2 IP.  
2. Update `/opt/deepfake_et_frontend/.env` — replace `http://IP` with `https://elevatetrust.in` everywhere.  
3. Set `DEPLOY_TARGET=domain`, `COOKIE_SECURE=true`, `APP_DOMAIN=elevatetrust.in`.  
4. Rebuild: `sudo bash deploy/scripts/deploy-ec2.sh`  
5. `sudo certbot --nginx -d elevatetrust.in -d www.elevatetrust.in`  
6. Run deploy script again for HTTPS nginx.

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| SSH permission denied | `chmod 400 et_deployment_prod.pem`, correct `ubuntu@IP`, security group port 22 |
| Site not loading | Security group port 80; `sudo nginx -t`; `systemctl status nginx` |
| 502 / blank page | `journalctl -u chattiq-next -n 50` — Next not built or crashed |
| Login fails (cookie) | Ensure `COOKIE_SECURE=false` and `FRONTEND_URL=http://EC2_IP` |
| Agent create 502 | FastAPI down: `journalctl -u chattiq-fastapi`; check `config.json` |
| Widget no reply | `AI_AGENT_API_URL=http://127.0.0.1:8000` in `.env`; agent `public_embed: true` |
| `Repository not found` on git pull | Use branch `feature/chatops-deploy` or merge PR on GitHub |

---

## Quick command checklist

```bash
# Mac
chmod 400 et_deployment_prod.pem
ssh -i et_deployment_prod.pem ubuntu@EC2_IP

# EC2 — clone FIRST, then remove legacy
git clone -b feature/chatops-deploy https://github.com/Pandey-A/ET-Revamped.git /opt/deepfake_et_frontend
sudo bash /opt/deepfake_et_frontend/deploy/scripts/remove-legacy-deployment.sh
sudo bash /opt/deepfake_et_frontend/deploy/scripts/configure-ec2-ip-env.sh 13.200.189.83
sudo nano /opt/deepfake_et_frontend/.env
nano /opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/config.json
sudo bash /opt/deepfake_et_frontend/deploy/scripts/deploy-ec2.sh

# Browser
http://EC2_IP/
```

See also `PRODUCTION_DEPLOYMENT.md` for architecture and domain-based deploy later.

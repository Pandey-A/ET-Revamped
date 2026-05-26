# Chattiq — Production Deployment on AWS EC2

> **Deploying with EC2 public IP now?** Use the step-by-step guide: **[EC2_IP_DEPLOYMENT.md](./EC2_IP_DEPLOYMENT.md)** (PEM: `et_deployment_prod.pem`, HTTP + IP).

This document describes the **Chattiq** stack deployed from **[Pandey-A/ET-Revamped](https://github.com/Pandey-A/ET-Revamped)** (branch `feature/chatops-deploy`), on EC2 at `/opt/deepfake_et_frontend`.

---

## 1. Architecture (production)

| Component | Port (localhost) | Public path | Purpose |
|-----------|------------------|-------------|---------|
| **Next.js** (`client_new`) | `8001` | `/` | Admin UI, widget BFF (`/api/widget/*`), `widget.js` |
| **Express** (`server`) | `8002` | `/api/*` | Auth, users, **agent CRUD** (Postgres), widget presets |
| **FastAPI** (`HR-Reachout-Agent-main`) | `8000` | `/api/agent/*` | Chat stream, RAG, **widget sessions**, WhatsApp/Telegram |
| **PostgreSQL** | `5432` | — | Users, `ai_agents`, `agent_widget_presets`, usage logs |
| **Redis** | `6379` | — | Chat history |
| **Nginx** | `80` / `443` | — | TLS termination and reverse proxy |

```text
Browser / customer site
    │
    ▼
Nginx (APP_DOMAIN)
    ├── /              → Next.js :8001
    ├── /api/          → Express :8002  (auth, POST /agents, widget presets)
    ├── /api/agent/    → FastAPI :8000  (chat, widget session, /store/agents)
    └── /telegram-webhook/ → FastAPI :8000
```

---

## 2. What we added / changed for production

### New in this repo

| Path | Purpose |
|------|---------|
| `deploy/docker-compose.infra.yml` | PostgreSQL 16 + Redis on EC2 |
| `deploy/env/production.env.example` | Single env template for all services |
| `deploy/nginx/chattiq.conf.template` | Nginx routing (3 backends) |
| `deploy/systemd/chattiq-*.service` | `fastapi`, `express`, `next` process units |
| `deploy/scripts/deploy-ec2.sh` | One-command deploy / update |
| `deploy/scripts/stop-legacy-services.sh` | Stop old `ai-agent-backend` etc. |
| `deploy/scripts/init-runtime-stores.sh` | Initialize `Agents_store.json`, widget sessions JSON |
| `server/scripts/sync-agents-to-fastapi.js` | Sync Postgres agents → FastAPI after deploy |
| `PRODUCTION_DEPLOYMENT.md` | This document |

### Code fixes for production

| File | Change |
|------|--------|
| `HR-Reachout-Agent-main/FastAPI-server/main.py` | `TELEGRAM_WEBHOOK_BASE_URL` env instead of hardcoded ngrok URL |
| `client_new/next.config.mjs` | `NEXT_ALLOWED_ORIGINS` for Server Actions on your domain |
| `server/db/migrate.js` | Loads `/opt/deepfake_et_frontend/.env` (repo root) |
| `server/package.json` | `npm run agents:sync-fastapi` |

### Unchanged behaviour (must work after deploy)

- **Widget generation** — Admin → AI Agents → agent detail → Widget generator; embed uses `/widget.js` and Next routes `/api/widget/session|chat|contact|complete` → FastAPI.
- **Agent creation** — `POST /api/agents` (Express + Postgres) then sync to FastAPI `POST /store/agents` via `FASTAPI_AGENT_SYNC_URL`.

---

## 3. Prerequisites

- Ubuntu 22.04+ EC2, ports **22**, **80**, **443** open
- DNS **A record** for `elevatetrust.in` and `www.elevatetrust.in` → EC2 public IP (same as your previous deploy)
- Repo pushed to [Pandey-A/ET-Revamped](https://github.com/Pandey-A/ET-Revamped)
- Secrets: OpenAI, Weaviate, Cohere, WhatsApp (optional), Telegram (optional)

**Production URL:** `https://elevatetrust.in` (not the raw EC2 IP in env or widget embeds).

---

## 4. First-time EC2 setup

### 4.1 Clone and configure

```bash
sudo mkdir -p /opt/deepfake_et_frontend
sudo chown ubuntu:ubuntu /opt/deepfake_et_frontend
git clone -b feature/chatops-deploy https://github.com/Pandey-A/ET-Revamped.git /opt/deepfake_et_frontend
cd /opt/deepfake_et_frontend

cp deploy/env/production.env.example /opt/deepfake_et_frontend/.env
nano /opt/deepfake_et_frontend/.env   # passwords, JWT_SECRET (domain defaults to elevatetrust.in)

cp HR-Reachout-Agent-main/AgentManager/config.json.example \
   HR-Reachout-Agent-main/AgentManager/config.json
nano HR-Reachout-Agent-main/AgentManager/config.json   # OpenAI, Weaviate, etc.
```

**Critical env values** (in `/opt/deepfake_et_frontend/.env`):

```env
APP_DOMAIN=elevatetrust.in
APP_PUBLIC_URL=https://elevatetrust.in
DATABASE_URL=postgresql://chattiq:YOUR_PASSWORD@127.0.0.1:5432/chattiq
JWT_SECRET=...
COOKIE_SECURE=true
FRONTEND_URL=https://elevatetrust.in
NEXT_PUBLIC_API_URL=https://elevatetrust.in/api
NEXT_PUBLIC_AI_AGENT_API_URL=https://elevatetrust.in/api/agent
NEXT_PUBLIC_APP_ORIGIN=https://elevatetrust.in
AI_AGENT_API_URL=http://127.0.0.1:8000
FASTAPI_AGENT_SYNC_URL=http://127.0.0.1:8000
TELEGRAM_WEBHOOK_BASE_URL=https://elevatetrust.in
```

Rebuild Next after changing any `NEXT_PUBLIC_*` variable.

### 4.2 Run deploy script

```bash
cd /opt/deepfake_et_frontend
chmod +x deploy/scripts/*.sh
sudo bash deploy/scripts/deploy-ec2.sh
```

### 4.3 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d elevatetrust.in -d www.elevatetrust.in
sudo bash deploy/scripts/deploy-ec2.sh   # switch nginx to HTTPS template
```

### 4.4 Create admin user

Use your existing registration flow at `https://elevatetrust.in/register`, then promote in Postgres:

```bash
docker exec -it chattiq_postgres psql -U chattiq -d chattiq \
  -c "UPDATE users SET role='admin' WHERE email='you@company.com';"
```

### 4.5 Verify widget + agents

1. **Agents** — Admin → AI Agents → Create agent → should succeed (Postgres + FastAPI sync).
2. **Widget** — Open agent → Widget generator → copy embed → test with `data-api-base="https://elevatetrust.in"`.
3. **Chat dashboard** — Admin → Chat dashboard → Chats / Leads tabs.
4. **Health**:

```bash
curl -s http://127.0.0.1:8000/agents | head
curl -s http://127.0.0.1:8002/api/health  # if health route exists
curl -I http://127.0.0.1:8001/
```

---

## 5. Replacing the old repo on EC2

`deploy/scripts/stop-legacy-services.sh` stops common old units (`ai-agent-backend`, etc.) and old Docker stack `hr_agent_app`.

**Manual cleanup (if old app lived elsewhere):**

```bash
sudo rm -f /etc/nginx/sites-enabled/ai-agent-backend
sudo rm -f /etc/nginx/sites-enabled/elevatetrust
# Optional backup then remove old tree:
# sudo mv /opt/deepfake_et_frontend /opt/deepfake_et_frontend.bak
```

Only **one** deployment should own ports `8000–8002` and nginx `sites-enabled/chattiq`.

---

## 6. PostgreSQL on AWS

- Runs in Docker (`chattiq_postgres`), data volume `chattiq_pg_data`.
- Schema: `server/db/schema.sql` applied via `npm run db:migrate`.
- **Backup:**

```bash
docker exec chattiq_postgres pg_dump -U chattiq chattiq > backup-$(date +%F).sql
```

- **Restore local data to EC2:** copy dump to server, `psql` into container, then `npm run agents:sync-fastapi`.

---

## 7. Updates (new code on same server)

```bash
cd /opt/deepfake_et_frontend
git pull origin feature/chatops-deploy
sudo bash deploy/scripts/deploy-ec2.sh
```

If only env changed for Next public vars, rebuild is included in the script.

---

## 8. Service management

```bash
sudo systemctl status chattiq-fastapi chattiq-express chattiq-next
sudo journalctl -u chattiq-fastapi -f
sudo journalctl -u chattiq-express -f
sudo journalctl -u chattiq-next -f
docker compose -f /opt/deepfake_et_frontend/deploy/docker-compose.infra.yml ps
```

---

## 9. Troubleshooting

| Issue | Fix |
|-------|-----|
| Agent create returns 502 | FastAPI down or `FASTAPI_AGENT_SYNC_URL` wrong; check `journalctl -u chattiq-fastapi` |
| Widget chat fails | Ensure `AI_AGENT_API_URL` on Next server points to `http://127.0.0.1:8000`; agent has `public_embed: true` |
| Widget CORS on external site | Set `WIDGET_CHAT_CORS_ORIGIN` or allow `*` for testing |
| Agents missing in chat | Run `cd /opt/deepfake_et_frontend/server && npm run agents:sync-fastapi` |
| Telegram not receiving | Set `TELEGRAM_WEBHOOK_BASE_URL=https://elevatetrust.in` and HTTPS |
| Weaviate errors | Check `config.json` weaviate URL and EC2 outbound access |

---

## 10. Security checklist

- [ ] Strong `POSTGRES_PASSWORD`, `JWT_SECRET`
- [ ] `config.json` not committed (chmod 600 on server)
- [ ] HTTPS enabled
- [ ] EC2 security group: only 22/80/443 public; **do not** expose 5432/6379/8000 publicly
- [ ] Rotate OpenAI / WhatsApp keys in `config.json` and `.env`

---

## 11. File map (quick reference)

```
/opt/deepfake_et_frontend/
├── .env                          # production secrets
├── client_new/                   # Next.js → systemd chattiq-next
├── server/                       # Express → systemd chattiq-express
├── HR-Reachout-Agent-main/       # FastAPI → systemd chattiq-fastapi
│   ├── AgentManager/config.json  # AI keys (NOT in git)
│   ├── Agents_store.json         # runtime agent registry (synced from Postgres)
│   └── widget_sessions_store.json
└── deploy/                       # scripts, nginx, compose, systemd
```

For backend-only notes see also `EC2_BACKEND_DEPLOYMENT.md` (partially superseded by this guide).

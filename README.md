# Chattiq — AI Agent Platform

Chattiq is a full-stack platform for deploying and managing AI agents across web widgets, WhatsApp, and Telegram. It features role-based access, a vector database for Retrieval-Augmented Generation (RAG), and a modern web dashboard.

## Architecture

The platform consists of four main layers:

1. **Frontend (Next.js)**: Runs on port `8001`. Provides the admin dashboard, user registration, widget generator, and the Backend-For-Frontend (BFF) proxy for widget interactions.
2. **API Core (Node/Express)**: Runs on port `8002`. Handles authentication, user management, and agent CRUD operations stored in PostgreSQL.
3. **AI Runtime (Python/FastAPI)**: Runs on port `8000`. Handles LLM interactions (OpenAI/Cohere), RAG (Weaviate), chat session state, and messaging integrations (WhatsApp/Telegram).
4. **Data Layer**:
   - **PostgreSQL**: Stores users, agents metadata, and widget configurations.
   - **Redis**: Stores chat history, ephemeral session states, and **message credits** (`chattiq:*` keys).
   - **Weaviate**: Stores vector embeddings for document Q&A.

## Credits system

Production billing runs inside **FastAPI** via `ai-runtime/AgentManager/credits_store.py`. Redis keys use the `chattiq:` namespace; accounts are keyed by platform user ID (agent owner).

| Layer | Role |
|-------|------|
| `credits_store.py` | Credits, plans, metrics, per-session token tracking |
| `credits_greetings.py` | Greeting bypass (no credit charge) |
| FastAPI `/credits/billing`, `/credits/tokens`, `/credits/onboard`, `/credits/add` | Billing API |
| Express `GET /api/credits/me`, `GET /api/credits/tokens` | Authenticated proxy for the dashboard |
| `web/app/credits/` | Credits dashboard UI |

**Requirements:** Redis must be running (`REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` in env). Express proxies to FastAPI on port `8000` via `AI_AGENT_API_URL`.

## Repository layout

| Path | Role |
|------|------|
| `web/` | Next.js frontend (admin, widget, BFF) |
| `server/` | Express API (auth, agents, Postgres) |
| `ai-runtime/` | Python FastAPI AI runtime (LLM, WhatsApp, credits) |
| `deploy/` | EC2 systemd, nginx, docker-compose infra |

## Local Development

### 1. Requirements
- Node.js 20+
- Python 3.10+
- Docker & Docker Compose (for PostgreSQL & Redis)

### 2. Infrastructure Setup
Start the local databases:
```bash
docker compose -f deploy/docker-compose.infra.yml up -d
```

### 3. API Core (Express)
```bash
cd server
cp .env.example .env  # Update with your secrets
npm install
npm run db:migrate
npm run dev
```

### 4. Frontend (Next.js)
```bash
cd web
cp .env.local .env.local  # Update API URLs if needed
npm install
npm run dev
```

### 5. AI Runtime (FastAPI)
```bash
cd ai-runtime
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp AgentManager/config.json.example AgentManager/config.json # Add your API keys
uvicorn FastAPI-server.main:app --reload --port 8000
```

## Production Deployment (AWS EC2)

Deployment is managed via a single bash script that handles installing dependencies, setting up systemd services, building the Next.js app, and configuring Nginx.

### Prerequisites
- Ubuntu 22.04+ EC2 instance
- Security group allowing ports `22` (SSH), `80` (HTTP), and `443` (HTTPS)
- Valid `.pem` file for SSH access

### Deployment Steps (from your local machine)

1. **Connect to the server:**
   ```bash
   ssh -i /path/to/your.pem ubuntu@<YOUR_EC2_IP>
   ```

2. **Clone the repository:**
   ```bash
   sudo mkdir -p /opt/chattiq
   sudo chown ubuntu:ubuntu /opt/chattiq
   git clone -b feature/chatops-deploy <REPO_URL> /opt/chattiq
   cd /opt/chattiq
   ```

3. **Configure Environment:**
   Run the IP configuration script to automatically set the base URLs:
   ```bash
   sudo bash deploy/scripts/configure-ec2-ip-env.sh <YOUR_EC2_IP>
   ```
   
   Next, edit the generated `.env` file to add your secrets (DB password, JWT secret, etc.):
   ```bash
   sudo nano .env
   ```

   Finally, configure the AI Agent API keys:
   ```bash
   cp ai-runtime/AgentManager/config.json.example \
      ai-runtime/AgentManager/config.json
   nano ai-runtime/AgentManager/config.json
   ```

4. **Run the Deployment Script:**
   ```bash
   chmod +x deploy/scripts/*.sh
   sudo bash deploy/scripts/deploy-ec2.sh
   ```

   This script will:
   - Install Docker, Node.js, Python dependencies
   - Start Postgres and Redis
   - Run database migrations
   - Build the Next.js production bundle
   - Install and start systemd services (`chattiq-fastapi`, `chattiq-express`, `chattiq-next`)
   - Configure Nginx

### Updating an existing deployment
To deploy new code changes to a running server:
```bash
cd /opt/chattiq
git pull origin <branch_name>
sudo bash deploy/scripts/deploy-ec2.sh
```

## Service Management

You can manage the background services using `systemctl`:

```bash
# Check status
sudo systemctl status chattiq-fastapi chattiq-express chattiq-next

# Restart services
sudo systemctl restart chattiq-fastapi chattiq-express chattiq-next

# View logs
sudo journalctl -u chattiq-fastapi -f
sudo journalctl -u chattiq-express -f
sudo journalctl -u chattiq-next -f
```

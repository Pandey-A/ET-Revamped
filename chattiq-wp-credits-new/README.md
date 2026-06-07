# chattiq-wp-credits-new

WhatsApp credits microservice (reference implementation). **The main Chattiq app integrates this logic into FastAPI** — see `HR-Reachout-Agent-main/AgentManager/credits_store.py`.

## Main project integration

| This package | Integrated into |
|--------------|-----------------|
| `src/redis_store.py` billing + token tracking | `AgentManager/credits_store.py` (`chattiq:*` Redis keys) |
| `GET /credits`, `GET /tokens` | FastAPI `GET /credits/billing`, `GET /credits/tokens` |
| `src/greetings.py` + `GREETING_DATA.csv` | `AgentManager/credits_greetings.py` |
| SQS producer/consumer | Not deployed in main stack (optional standalone worker) |

## Standalone run (optional)

```bash
cd chattiq-wp-credits-new
cp env_template.txt .env   # Redis, Meta, OpenAI/Gemini keys
pip install -r requirements.txt
uvicorn src.credits_api:app --host 0.0.0.0 --port 8002
```

Standalone mode uses `whatsapp:*` Redis keys and bills by phone number. Do **not** run on port 8002 in production — Express uses that port.

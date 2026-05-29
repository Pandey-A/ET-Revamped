# AWS security group — elevatetrust.in (EC2)

Attach these rules to the **same security group** as instance `13.200.189.83`.

## Inbound (who can reach your server)

| Type  | Port | Source        | Purpose |
|-------|------|---------------|---------|
| SSH   | 22   | **Your IP only** (`x.x.x.x/32`) | Server admin — avoid `0.0.0.0/0` on SSH |
| HTTP  | 80   | `0.0.0.0/0`   | Website + Let's Encrypt HTTP challenge |
| HTTPS | 443  | `0.0.0.0/0`   | `https://elevatetrust.in` (Next, API, widget) |

Optional (only if you need direct access, not required behind nginx):

| Type  | Port | Source     | Purpose |
|-------|------|------------|---------|
| Custom TCP | 8000–8002 | Your IP only | Debug FastAPI/Express/Next — **do not** expose publicly |

Do **not** open Weaviate `8080` or Postgres `5432` to the internet.

## Outbound (server → internet)

| Type  | Port | Destination   | Purpose |
|-------|------|---------------|---------|
| HTTPS | 443  | `0.0.0.0/0`   | OpenAI API, Meta WhatsApp Graph API, npm/git, Let's Encrypt |
| HTTP  | 80   | `0.0.0.0/0`   | apt, certbot, some package mirrors |
| DNS   | 53   | `0.0.0.0/0`   | Name resolution (UDP and TCP) |
| All traffic | All | `0.0.0.0/0` | **Simplest fix** if outbound is blocked today — use “All outbound” default |

Without **outbound 443**, OpenAI and WhatsApp replies will fail.

## DNS

| Record | Type | Value |
|--------|------|--------|
| `elevatetrust.in` | A | `13.200.189.83` |
| `www.elevatetrust.in` | A or CNAME | `13.200.189.83` or `elevatetrust.in` |

## After changing the security group

```bash
sudo systemctl restart chattiq-fastapi chattiq-express chattiq-next nginx
curl -sI https://elevatetrust.in/
```

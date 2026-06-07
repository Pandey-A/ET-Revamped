import json
from fastapi import FastAPI, Request, HTTPException, Query
from src.config import META_VERIFY_TOKEN, SQS_QUEUE_URL, get_sqs_client
from src.redis_store import get_user_account

app = FastAPI()
sqs = get_sqs_client()

@app.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: int = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    if hub_mode == "subscribe" and hub_verify_token == META_VERIFY_TOKEN:
        return hub_challenge
    raise HTTPException(status_code=403, detail="Verification failed")

@app.post("/webhook")
async def receive_message(request: Request):
    try:
        body = await request.json()
    except Exception:
        return {"status": "ignored"}

    try:
        entry = body.get("entry", [])[0]
        changes = entry.get("changes", [])[0]
        value = changes.get("value", {})
        
        # Ignore status updates (read receipts, etc.)
        if "messages" not in value:
            return {"status": "ignored"}
            
        message_data = value["messages"][0]
        contact_data = value["contacts"][0]
        metadata = value.get("metadata", {})
        
        if message_data["type"] != "text":
            return {"status": "ignored", "reason": "Not a text message"}
            
        phone_number = contact_data["wa_id"]
        message_id = message_data["id"]
        query = message_data["text"]["body"]
        business_phone_number_id = metadata.get("phone_number_id")
        
        # FAST PRE-FLIGHT CHECK
        account = get_user_account(phone_number)
        has_credits = account.get("credits", 0) >= 1
        is_pro = account.get("plan") == "Pro"
        is_enterprise_with_overdraft = (account.get("plan") == "Enterprise" and account.get("allow_overdraft") == "true")
        
        if not (has_credits or is_pro or is_enterprise_with_overdraft):
            return {"status": "rejected", "reason": "insufficient_credits"}
            
        # PACKAGE FOR THE QUEUE
        queue_payload = {
            "user_id": phone_number,
            "phone_number": phone_number,
            "query": query,
            "message_id": message_id,
            "business_phone_number_id": business_phone_number_id
        }
        
        # PUSH TO SQS FIFO
        sqs.send_message(
            QueueUrl=SQS_QUEUE_URL,
            MessageBody=json.dumps(queue_payload),
            MessageGroupId=phone_number,
            MessageDeduplicationId=message_id
        )
        
        return {"status": "queued"}
        
    except (IndexError, KeyError):
        return {"status": "ignored", "reason": "Malformed payload"}
import json
from src.config import get_redis_client

CREDIT_TABLE_KEY = "whatsapp:credit_table"

def get_user_account(user_id: str) -> dict:
    client = get_redis_client()
    key = f"whatsapp:account:{user_id}"
    data = client.hgetall(key)
    
    if not data:
        # Check for legacy credits
        legacy_credits = client.hget(CREDIT_TABLE_KEY, user_id)
        if legacy_credits is not None:
            credits_val = int(legacy_credits)
            client.hset(key, mapping={
                "credits": str(credits_val),
                "money": "0",
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": "0"
            })
            return {
                "credits": credits_val,
                "money": 0,
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": 0
            }
        else:
            client.hset(key, mapping={
                "credits": "0",
                "money": "0",
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": "0"
            })
            return {
                "credits": 0,
                "money": 0,
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": 0
            }
            
    return {
        "credits": int(data.get("credits", 0)),
        "money": int(data.get("money", 0)),
        "plan": data.get("plan", "Free"),
        "allow_overdraft": data.get("allow_overdraft", "false"),
        "overdraft_rate": int(data.get("overdraft_rate", 0))
    }

def get_user_credits(user_id: str) -> int:
    return get_user_account(user_id)["credits"]

def deduct_user_credits(user_id: str, amount: int) -> int:
    """Legacy helper. Deducts credits from the new structure."""
    client = get_redis_client()
    key = f"whatsapp:account:{user_id}"
    new_val = client.hincrby(key, "credits", -amount)
    client.hset(CREDIT_TABLE_KEY, user_id, str(new_val))
    return new_val


def add_chat_message(phone_number: str, role: str, content: str):
    client = get_redis_client()
    key = f"whatsapp:chat:{phone_number}"
    msg = json.dumps({"role": role, "content": content})
    client.rpush(key, msg)
    client.ltrim(key, -20, -1) # Maintain a sliding window of N=20

def summarize_chat_context(phone_number: str) -> str:
    client = get_redis_client()
    key = f"whatsapp:chat:{phone_number}"
    msgs = client.lrange(key, 0, -1)
    
    if not msgs:
        return ""
    
    lines = []
    for m in msgs:
        item = json.loads(m)
        lines.append(f"{item['role'].capitalize()}: {item['content']}")
    return "\n".join(lines)

def record_user_metric(user_id: str, field: str, amount: int = 1):
    from datetime import datetime, timezone
    client = get_redis_client()
    key = f"whatsapp:metrics:{user_id}"
    client.hincrby(key, field, amount)
    client.hset(key, "last_active_at", datetime.now(timezone.utc).isoformat() + "Z")

def onboard_user_plan(user_id: str, plan: str, credits_to_add: int, allow_overdraft: bool = False, overdraft_rate: int = 0) -> dict:
    client = get_redis_client()
    key = f"whatsapp:account:{user_id}"
    
    new_credits = client.hincrby(key, "credits", credits_to_add)
    client.hset(key, "plan", plan)
    client.hset(key, "allow_overdraft", "true" if allow_overdraft else "false")
    client.hset(key, "overdraft_rate", str(overdraft_rate))
    
    if not client.hexists(key, "money"):
        client.hset(key, "money", "0")
        
    client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
    return get_user_account(user_id)

def deduct_user_charge(user_id: str, amount: int = 1) -> str:
    """Deducts 1 unit from credits (if > 0) or money based on plan configuration"""
    client = get_redis_client()
    key = f"whatsapp:account:{user_id}"
    account = get_user_account(user_id)
    credits = account["credits"]
    plan = account["plan"]
    allow_overdraft = account["allow_overdraft"] == "true"
    overdraft_rate = account["overdraft_rate"]
    
    if credits >= amount:
        new_credits = client.hincrby(key, "credits", -amount)
        client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
        return "credit"
    elif plan == "Pro":
        # Pro has standard 1 rs overdraft
        client.hincrby(key, "money", -amount)
        return "money"
    elif plan == "Enterprise" and allow_overdraft:
        # Enterprise can have custom overdraft rate
        charge_rupees = amount * overdraft_rate
        client.hincrby(key, "money", -charge_rupees)
        return "money"
    else:
        new_credits = client.hincrby(key, "credits", -amount)
        client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
        return "credit"

def refund_user_charge(user_id: str, charge_type: str, amount: int = 1):
    """Refunds 1 unit of charge_type ('credit' or 'money')"""
    client = get_redis_client()
    key = f"whatsapp:account:{user_id}"
    if charge_type == "money":
        account = get_user_account(user_id)
        plan = account["plan"]
        overdraft_rate = account["overdraft_rate"]
        
        if plan == "Enterprise":
            refund_rupees = amount * overdraft_rate
            client.hincrby(key, "money", refund_rupees)
        else:
            client.hincrby(key, "money", amount)
    else:
        new_credits = client.hincrby(key, "credits", amount)
        client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))

def get_user_billing_and_monitoring(user_id: str) -> dict:
    client = get_redis_client()
    account = get_user_account(user_id)
    available_credits = account["credits"]
    plan = account["plan"]
    money = account["money"]
    allow_overdraft = account["allow_overdraft"] == "true"
    
    if available_credits > 5:
        status = "active"
    elif available_credits > 0:
        status = "low_balance"
    else:
        if plan == "Pro" or (plan == "Enterprise" and allow_overdraft):
            status = "active"
        else:
            status = "suspended"
        
    metrics_key = f"whatsapp:metrics:{user_id}"
    data = client.hgetall(metrics_key)
    
    return {
        "user_id": user_id,
        "billing": {
            "available_credits": available_credits,
            "money": money,
            "plan": plan,
            "status": status,
            "allow_overdraft": allow_overdraft,
            "overdraft_rate": account["overdraft_rate"]
        },
        "monitoring": {
            "total_queries_received": int(data.get("total_queries_received", 0)),
            "total_greetings_bypassed": int(data.get("total_greetings_bypassed", 0)),
            "total_successful_replies": int(data.get("total_successful_replies", 0)),
            "total_failed_replies": int(data.get("total_failed_replies", 0)),
            "last_active_at": data.get("last_active_at", None)
        }
    }

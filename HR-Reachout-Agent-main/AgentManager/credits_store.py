"""
Credit billing + usage metrics (Redis). Ported from chattiq-wp-credits with chattiq: key namespace.
Account user_id = platform user (agent owner), not end-customer phone.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import redis

CREDIT_TABLE_KEY = "chattiq:credit_table"
AGENT_OWNER_PREFIX = "chattiq:agent_owner:"


def _redis_client() -> redis.Redis:
    host = os.environ.get("REDIS_HOST", "localhost")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    password = os.environ.get("REDIS_PASSWORD") or None
    return redis.Redis(host=host, port=port, password=password, decode_responses=True)


def set_agent_owner(agent_id: str, owner_user_id: str) -> None:
    if not agent_id or not owner_user_id:
        return
    _redis_client().set(f"{AGENT_OWNER_PREFIX}{agent_id}", owner_user_id)


def get_agent_owner(agent_id: Optional[str]) -> Optional[str]:
    if not agent_id:
        return None
    val = _redis_client().get(f"{AGENT_OWNER_PREFIX}{agent_id}")
    return val if val else None


def get_user_account(user_id: str) -> dict:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    data = client.hgetall(key)

    if not data:
        legacy_credits = client.hget(CREDIT_TABLE_KEY, user_id)
        if legacy_credits is not None:
            credits_val = int(legacy_credits)
            client.hset(
                key,
                mapping={
                    "credits": str(credits_val),
                    "money": "0",
                    "plan": "Free",
                    "allow_overdraft": "false",
                    "overdraft_rate": "0",
                },
            )
            return {
                "credits": credits_val,
                "money": 0,
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": 0,
            }
        client.hset(
            key,
            mapping={
                "credits": "0",
                "money": "0",
                "plan": "Free",
                "allow_overdraft": "false",
                "overdraft_rate": "0",
            },
        )
        return {
            "credits": 0,
            "money": 0,
            "plan": "Free",
            "allow_overdraft": "false",
            "overdraft_rate": 0,
        }

    return {
        "credits": int(data.get("credits", 0)),
        "money": int(data.get("money", 0)),
        "plan": data.get("plan", "Free"),
        "allow_overdraft": data.get("allow_overdraft", "false"),
        "overdraft_rate": int(data.get("overdraft_rate", 0)),
    }


def ensure_user_account(user_id: str, initial_credits: int = 100) -> dict:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    if client.exists(key):
        return get_user_account(user_id)
    client.hset(
        key,
        mapping={
            "credits": str(initial_credits),
            "money": "0",
            "plan": "Free",
            "allow_overdraft": "false",
            "overdraft_rate": "0",
        },
    )
    client.hset(CREDIT_TABLE_KEY, user_id, str(initial_credits))
    return get_user_account(user_id)


def can_accept_message(user_id: str) -> bool:
    billing = get_user_billing_and_monitoring(user_id)
    return billing["billing"]["status"] != "suspended"


def deduct_user_credits(user_id: str, amount: int) -> int:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    new_val = client.hincrby(key, "credits", -amount)
    client.hset(CREDIT_TABLE_KEY, user_id, str(new_val))
    return int(new_val)


def record_user_metric(user_id: str, field: str, amount: int = 1) -> None:
    client = _redis_client()
    key = f"chattiq:metrics:{user_id}"
    client.hincrby(key, field, amount)
    client.hset(key, "last_active_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))


def log_usage_event(
    user_id: str,
    channel: str,
    charge_type: str,
    amount: int = 1,
    session_id: str = "",
    agent_id: str = "",
) -> None:
    """Append-only usage log in Redis (last 500 events per user)."""
    client = _redis_client()
    key = f"chattiq:usage_log:{user_id}"
    entry = json.dumps(
        {
            "channel": channel,
            "charge_type": charge_type,
            "amount": amount,
            "session_id": session_id,
            "agent_id": agent_id,
            "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    )
    client.lpush(key, entry)
    client.ltrim(key, 0, 499)


def get_usage_log(user_id: str, limit: int = 50) -> list:
    client = _redis_client()
    key = f"chattiq:usage_log:{user_id}"
    raw = client.lrange(key, 0, max(0, limit - 1))
    out = []
    for item in raw:
        try:
            out.append(json.loads(item))
        except json.JSONDecodeError:
            continue
    return out


def onboard_user_plan(
    user_id: str,
    plan: str,
    credits_to_add: int,
    allow_overdraft: bool = False,
    overdraft_rate: int = 0,
) -> dict:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    new_credits = client.hincrby(key, "credits", credits_to_add)
    client.hset(key, "plan", plan)
    client.hset(key, "allow_overdraft", "true" if allow_overdraft else "false")
    client.hset(key, "overdraft_rate", str(overdraft_rate))
    if not client.hexists(key, "money"):
        client.hset(key, "money", "0")
    client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
    return get_user_account(user_id)


def deduct_user_charge(user_id: str, amount: int = 1) -> str:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    account = get_user_account(user_id)
    credits = account["credits"]
    plan = account["plan"]
    allow_overdraft = account["allow_overdraft"] == "true"
    overdraft_rate = account["overdraft_rate"]

    if credits >= amount:
        new_credits = client.hincrby(key, "credits", -amount)
        client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
        return "credit"
    if plan == "Pro":
        client.hincrby(key, "money", -amount)
        return "money"
    if plan == "Enterprise" and allow_overdraft:
        charge_rupees = amount * overdraft_rate
        client.hincrby(key, "money", -charge_rupees)
        return "money"
    new_credits = client.hincrby(key, "credits", -amount)
    client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))
    return "credit"


def refund_user_charge(user_id: str, charge_type: str, amount: int = 1) -> None:
    client = _redis_client()
    key = f"chattiq:account:{user_id}"
    if charge_type == "money":
        account = get_user_account(user_id)
        plan = account["plan"]
        overdraft_rate = account["overdraft_rate"]
        if plan == "Enterprise":
            client.hincrby(key, "money", amount * overdraft_rate)
        else:
            client.hincrby(key, "money", amount)
    else:
        new_credits = client.hincrby(key, "credits", amount)
        client.hset(CREDIT_TABLE_KEY, user_id, str(new_credits))


def get_user_billing_and_monitoring(user_id: str) -> dict:
    client = _redis_client()
    account = get_user_account(user_id)
    available_credits = account["credits"]
    plan = account["plan"]
    money = account["money"]
    allow_overdraft = account["allow_overdraft"] == "true"

    if available_credits > 5:
        status = "active"
    elif available_credits > 0:
        status = "low_balance"
    elif plan == "Pro" or (plan == "Enterprise" and allow_overdraft):
        status = "active"
    else:
        status = "suspended"

    metrics_key = f"chattiq:metrics:{user_id}"
    data = client.hgetall(metrics_key)

    return {
        "user_id": user_id,
        "billing": {
            "available_credits": available_credits,
            "money": money,
            "plan": plan,
            "status": status,
            "allow_overdraft": allow_overdraft,
            "overdraft_rate": account["overdraft_rate"],
        },
        "monitoring": {
            "total_queries_received": int(data.get("total_queries_received", 0)),
            "total_greetings_bypassed": int(data.get("total_greetings_bypassed", 0)),
            "total_successful_replies": int(data.get("total_successful_replies", 0)),
            "total_failed_replies": int(data.get("total_failed_replies", 0)),
            "total_widget_messages": int(data.get("total_widget_messages", 0)),
            "total_whatsapp_messages": int(data.get("total_whatsapp_messages", 0)),
            "last_active_at": data.get("last_active_at"),
        },
        "recent_usage": get_usage_log(user_id, 30),
    }

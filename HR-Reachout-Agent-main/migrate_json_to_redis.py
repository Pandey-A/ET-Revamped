#!/usr/bin/env python3
"""
One-time migration script: loads existing JSON chat history files into Redis.

Usage:
    python migrate_json_to_redis.py [--redis-url redis://localhost:6379]

Prerequisites:
    - Redis must be running and reachable
    - pip install redis llama-index-storage-chat-store-redis
"""

import argparse
import json
import os
import sys
import logging

from llama_index.storage.chat_store.redis import RedisChatStore
from llama_index.core.llms import ChatMessage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Key prefixes — must match Chat_history_handler.py
CHATBOT_PREFIX = "chatbot"
WHATSAPP_PREFIX = "whatsapp_history"

# Default JSON file paths (relative to project root)
CHATBOT_JSON = os.path.join("AgentManager", "chatbot", "chatbot_history_handler.json")
WHATSAPP_JSON = os.path.join("AgentManager", "whatsapp", "whatsapp_history_handler.json")


def load_json_file(path: str) -> dict:
    """Load a JSON history file, return dict of session_id -> messages."""
    if not os.path.exists(path):
        logger.warning(f"File not found: {path} — skipping")
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"Loaded {len(data)} sessions from {path}")
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {path}: {e}")
        return {}
    except Exception as e:
        logger.error(f"Error reading {path}: {e}")
        return {}


def migrate_sessions(store: RedisChatStore, data: dict, prefix: str, include_timestamp: bool = False):
    """Migrate sessions from JSON data into a RedisChatStore."""
    migrated = 0
    skipped = 0

    for session_id, messages in data.items():
        key = f"{prefix}:{session_id}"

        # Check if this session already exists in Redis
        existing = store.get_messages(key)
        if existing:
            logger.info(f"  Session {session_id} already has {len(existing)} messages in Redis — skipping")
            skipped += 1
            continue

        chat_messages = []
        for msg in messages:
            kwargs = {}
            if include_timestamp and "timestamp" in msg:
                kwargs["additional_kwargs"] = {"timestamp": msg["timestamp"]}
            chat_messages.append(
                ChatMessage(role=msg["role"], content=msg["content"], **kwargs)
            )

        store.set_messages(key, chat_messages)
        migrated += 1
        logger.info(f"  Migrated session {session_id} ({len(chat_messages)} messages)")

    return migrated, skipped


def main():
    parser = argparse.ArgumentParser(description="Migrate JSON chat history to Redis")
    parser.add_argument(
        "--redis-url",
        default=os.environ.get("REDIS_URL", "redis://localhost:6379"),
        help="Redis connection URL (default: redis://localhost:6379)",
    )
    parser.add_argument(
        "--chatbot-json",
        default=CHATBOT_JSON,
        help=f"Path to chatbot history JSON (default: {CHATBOT_JSON})",
    )
    parser.add_argument(
        "--whatsapp-json",
        default=WHATSAPP_JSON,
        help=f"Path to WhatsApp history JSON (default: {WHATSAPP_JSON})",
    )
    args = parser.parse_args()

    logger.info(f"Connecting to Redis at {args.redis_url}")
    store = RedisChatStore(redis_url=args.redis_url)

    # ── Migrate Chatbot History ──
    logger.info("=" * 60)
    logger.info("Migrating CHATBOT history...")
    chatbot_data = load_json_file(args.chatbot_json)
    if chatbot_data:
        migrated, skipped = migrate_sessions(store, chatbot_data, CHATBOT_PREFIX, include_timestamp=True)
        logger.info(f"Chatbot: {migrated} migrated, {skipped} skipped")
    else:
        logger.info("No chatbot data to migrate")

    # ── Migrate WhatsApp History ──
    logger.info("=" * 60)
    logger.info("Migrating WHATSAPP history...")
    whatsapp_data = load_json_file(args.whatsapp_json)
    if whatsapp_data:
        migrated, skipped = migrate_sessions(store, whatsapp_data, WHATSAPP_PREFIX, include_timestamp=False)
        logger.info(f"WhatsApp: {migrated} migrated, {skipped} skipped")
    else:
        logger.info("No WhatsApp data to migrate")

    # ── Verification ──
    logger.info("=" * 60)
    logger.info("VERIFICATION — reading back from Redis:")

    total_sessions = 0
    total_messages = 0

    for prefix, data in [(CHATBOT_PREFIX, chatbot_data), (WHATSAPP_PREFIX, whatsapp_data)]:
        for session_id in data:
            key = f"{prefix}:{session_id}"
            msgs = store.get_messages(key)
            total_sessions += 1
            total_messages += len(msgs)
            logger.info(f"  [{prefix}] {session_id}: {len(msgs)} messages ✓")

    logger.info("=" * 60)
    logger.info(f"Migration complete: {total_sessions} sessions, {total_messages} total messages in Redis")
    logger.info("You can now safely archive the old JSON files.")


if __name__ == "__main__":
    main()

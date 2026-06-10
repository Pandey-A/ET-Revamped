import json
import os
import logging
from datetime import datetime
from llama_index.storage.chat_store.redis import RedisChatStore
from llama_index.core.llms import ChatMessage
from typing import List, Optional

logger = logging.getLogger(__name__)


def _load_redis_config() -> dict:
    """Load Redis configuration from config.json or environment variables."""
    redis_url = os.environ.get("REDIS_URL")
    ttl = None

    if not redis_url:
        try:
            config_path = os.path.join(os.path.dirname(__file__), "config.json")
            with open(config_path, "r") as f:
                config = json.load(f)
            redis_cfg = config.get("Redis", {})
            redis_url = redis_cfg.get("url", "redis://localhost:6379")
            ttl = redis_cfg.get("ttl")  # None means persist forever
        except Exception as e:
            logger.warning(f"Could not load Redis config from file, using defaults: {e}")
            redis_url = "redis://localhost:6379"

    return {"url": redis_url, "ttl": ttl}


class ChatHistoryHandler:
    """
    Manages chat history for both chatbot and WhatsApp sessions using Redis.

    Uses two separate RedisChatStore instances with distinct key prefixes
    so chatbot and WhatsApp histories are cleanly separated within the
    same Redis instance.
    """

    # Key prefixes used inside Redis to separate the two stores
    CHATBOT_PREFIX = "chatbot"
    WHATSAPP_PREFIX = "whatsapp_history"

    def __init__(self, redis_url: str = None, ttl: Optional[int] = None):
        logger.info(f"Creating ChatHistoryHandler instance: {id(self)}")

        cfg = _load_redis_config()
        url = redis_url or cfg["url"]
        session_ttl = ttl if ttl is not None else cfg.get("ttl")

        logger.info(f"Connecting to Redis at {url} (ttl={session_ttl})")

        # Build kwargs — only pass ttl if it's set (not None)
        chatbot_kwargs = {"redis_url": url}
        whatsapp_kwargs = {"redis_url": url}
        if session_ttl is not None:
            chatbot_kwargs["ttl"] = session_ttl
            whatsapp_kwargs["ttl"] = session_ttl

        self._chatbot_store = RedisChatStore(**chatbot_kwargs)
        self._whatsapp_store = RedisChatStore(**whatsapp_kwargs)

        logger.info("ChatHistoryHandler initialized with Redis backend")

    # ──────────────────────────────────────────────────────────────────────
    #  Chatbot Methods
    # ──────────────────────────────────────────────────────────────────────

    def add_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a new chatbot message and persist to Redis."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for adding chatbot message: {session_id}")
                return False

            key = f"{self.CHATBOT_PREFIX}:{session_id}"
            messages = self._chatbot_store.get_messages(key)

            timestamp = datetime.now().isoformat()

            if isinstance(content, (dict, list)):
                content = json.dumps(content)
            else:
                content = str(content)

            new_msg = ChatMessage(
                role=role,
                content=content,
                additional_kwargs={"timestamp": timestamp},
            )
            messages.append(new_msg)
            self._chatbot_store.set_messages(key, messages)
            logger.info(f"Added chatbot message for session {session_id}: {role}: {content}")
            return True
        except Exception as e:
            logger.error(f"Error adding chatbot message for session {session_id}: {e}")
            return False

    def get_chat_history(self, session_id: str) -> List[ChatMessage]:
        """Retrieve chatbot history for a session."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for retrieving chatbot history: {session_id}")
                return []
            key = f"{self.CHATBOT_PREFIX}:{session_id}"
            messages = self._chatbot_store.get_messages(key)
            logger.info(f"Retrieved chatbot history for session {session_id}: {len(messages)} messages")
            return messages
        except Exception as e:
            logger.error(f"Error retrieving chatbot history for session {session_id}: {e}")
            return []

    def get_formatted_history(self, session_id: str) -> str:
        """Return formatted chatbot history as a string."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for formatting chatbot history: {session_id}")
                return "Invalid session ID."
            key = f"{self.CHATBOT_PREFIX}:{session_id}"
            messages = self._chatbot_store.get_messages(key)
            if not messages:
                logger.info(f"No chatbot history available for session {session_id}")
                return "No chatbot history available."
            formatted_messages = []
            for msg in messages:
                if hasattr(msg, 'role') and hasattr(msg, 'content'):
                    formatted_messages.append(f"{msg.role}: {msg.content}")
                else:
                    logger.warning(f"Invalid message object in chatbot history for session {session_id}: {msg}")
            if not formatted_messages:
                logger.info(f"No valid messages in chatbot history for session {session_id}")
                return "No chatbot history available."
            logger.info(f"Formatted chatbot history for session {session_id}: {len(formatted_messages)} messages")
            return "\n".join(formatted_messages)
        except Exception as e:
            logger.error(f"Error formatting chatbot history for session {session_id}: {e}")
            return "Error retrieving chatbot history."

    # ──────────────────────────────────────────────────────────────────────
    #  WhatsApp Methods
    # ──────────────────────────────────────────────────────────────────────

    def add_whatsapp_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a new WhatsApp message to the history and persist to Redis."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for adding WhatsApp message: {session_id}")
                return False
            logger.info(f"Attempting to add WhatsApp message for session {session_id}: {role}: {content}")
            key = f"{self.WHATSAPP_PREFIX}:{session_id}"
            messages = self._whatsapp_store.get_messages(key)
            new_msg = ChatMessage(role=role, content=content)
            messages.append(new_msg)
            self._whatsapp_store.set_messages(key, messages)
            logger.info(f"Added WhatsApp message for session {session_id}: {role}: {content}")
            return True
        except Exception as e:
            logger.error(f"Error adding WhatsApp message for session {session_id}: {e}")
            return False

    def get_whatsapp_history(self, session_id: str) -> List[ChatMessage]:
        """Retrieve WhatsApp history for a session."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for retrieving WhatsApp history: {session_id}")
                return []
            key = f"{self.WHATSAPP_PREFIX}:{session_id}"
            messages = self._whatsapp_store.get_messages(key)
            logger.info(f"Retrieved WhatsApp history for session {session_id}: {len(messages)} messages")
            return messages
        except Exception as e:
            logger.error(f"Error retrieving WhatsApp history for session {session_id}: {e}")
            return []

    def get_formatted_whatsapp_history(self, session_id: str) -> str:
        """Return formatted WhatsApp history as a string."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for formatting WhatsApp history: {session_id}")
                return "Invalid session ID."
            key = f"{self.WHATSAPP_PREFIX}:{session_id}"
            messages = self._whatsapp_store.get_messages(key)
            if not messages:
                logger.info(f"No WhatsApp history available for session {session_id}")
                return "No WhatsApp history available."
            formatted_messages = [f"{msg.role}: {msg.content}" for msg in messages]
            logger.info(f"Formatted WhatsApp history for session {session_id}: {len(formatted_messages)} messages")
            return "\n".join(formatted_messages)
        except Exception as e:
            logger.error(f"Error formatting WhatsApp history for session {session_id}: {e}")
            return "Error retrieving WhatsApp history."

    def reload_whatsapp_history(self):
        """No-op: Redis is always live, no reload needed."""
        logger.info("reload_whatsapp_history called — no-op with Redis backend")

    def list_chatbot_session_ids(self) -> List[str]:
        """Scan Redis for all chatbot session keys."""
        try:
            import redis as redis_lib

            cfg = _load_redis_config()
            client = redis_lib.from_url(cfg["url"], decode_responses=True)
            session_ids = set()

            for pattern in ("chatbot:*", "*:chatbot:*"):
                for key in client.scan_iter(match=pattern, count=200):
                    if not key:
                        continue
                    if key.startswith("chatbot:"):
                        session_ids.add(key[len("chatbot:"):])
                    elif ":chatbot:" in key:
                        session_ids.add(key.split(":chatbot:", 1)[1])

            logger.info(f"Found {len(session_ids)} chatbot sessions in Redis")
            return sorted(session_ids)
        except Exception as e:
            logger.error(f"Error listing Redis chatbot sessions: {e}")
            return []

import json
import os
import logging
from datetime import datetime
from llama_index.core.storage.chat_store.simple_chat_store import SimpleChatStore
from llama_index.core.llms import ChatMessage
from typing import List, Set
from filelock import FileLock

logger = logging.getLogger(__name__)

class ChatHistoryHandler:
    def __init__(self,
                whatsapp_persist_path: str = os.path.join("AgentManager", "whatsapp", "whatsapp_history_handler.json"),
                chatbot_persist_path: str = os.path.join("AgentManager", "chatbot", "chatbot_history_handler.json")):
        logger.info(f"Creating ChatHistoryHandler instance: {id(self)}")
        self._whatsapp_persist_path = whatsapp_persist_path
        self._chatbot_persist_path = chatbot_persist_path

        self._chatbot_store = SimpleChatStore() 
        self._whatsapp_store = SimpleChatStore() 

        self._whatsapp_session_ids: Set[str] = set()
        self._chatbot_session_ids: Set[str] = set()

        os.makedirs(os.path.dirname(self._whatsapp_persist_path), exist_ok=True)
        os.makedirs(os.path.dirname(self._chatbot_persist_path), exist_ok=True)

        self._load_whatsapp_from_file()
        self._load_chatbot_from_file()  # NEW

    def _load_whatsapp_from_file(self):
        """Load WhatsApp history from JSON file, falling back to .tmp if needed, or create new file if none exists."""
        temp_path = self._whatsapp_persist_path + '.tmp'
        for path in [self._whatsapp_persist_path, temp_path]:
            if os.path.exists(path):
                try:
                    with FileLock(path + ".lock", timeout=10):  # Added timeout
                        with open(path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                    for session_id, messages in data.items():
                        chat_messages = [
                            ChatMessage(role=msg['role'], content=msg['content'])
                            for msg in messages
                        ]
                        self._whatsapp_store.set_messages(session_id, chat_messages)
                        self._whatsapp_session_ids.add(session_id)
                    logger.info(f"Loaded WhatsApp history for {len(data)} sessions from {path}")
                    return
                except json.JSONDecodeError as e:
                    logger.error(f"Error decoding {path}: {e}")
                except PermissionError as e:
                    logger.error(f"Permission error accessing {path}: {e}")
                except Exception as e:
                    logger.error(f"Error loading {path}: {e}")
        
        # Create new empty JSON file if none exists
        try:
            with FileLock(self._whatsapp_persist_path + ".lock", timeout=10):  # Added timeout
                with open(self._whatsapp_persist_path, 'w', encoding='utf-8') as f:
                    json.dump({}, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
            logger.info(f"Created new empty WhatsApp history file at {self._whatsapp_persist_path}")
        except PermissionError as e:
            logger.error(f"Permission error creating WhatsApp history file at {self._whatsapp_persist_path}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error creating new WhatsApp history file at {self._whatsapp_persist_path}: {e}")
            raise

    def reload_whatsapp_history(self):
        """Reload WhatsApp history from JSON file without resetting store."""
        self._load_whatsapp_from_file()
        # Safely handle empty session IDs
        session_id = next(iter(self._whatsapp_session_ids), "")  # Use next with default
        messages = self._whatsapp_store.get_messages(session_id) if session_id else []
        if messages:
            logger.info(f"Reload successful: {len(messages)} messages for session {session_id}")
        else:
            logger.info(f"Reload found no messages for session {session_id}")

    def _save_whatsapp_to_file(self):
        """Save WhatsApp history to JSON file atomically."""
        data = {}
        temp_path = self._whatsapp_persist_path + '.tmp'
        try:
            with FileLock(self._whatsapp_persist_path + ".lock", timeout=10):  # Added timeout
                for session_id in self._whatsapp_session_ids:
                    messages = self._whatsapp_store.get_messages(session_id)
                    if messages:
                        data[session_id] = [
                            {'role': msg.role, 'content': msg.content}
                            for msg in messages
                        ]
                with open(temp_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
                logger.info(f"Renaming {temp_path} to {self._whatsapp_persist_path}")
                os.replace(temp_path, self._whatsapp_persist_path)
                logger.info(f"Saved WhatsApp history to {self._whatsapp_persist_path}")
        except PermissionError as e:
            logger.error(f"Permission error saving or renaming {temp_path} to {self._whatsapp_persist_path}: {e}")
            if os.path.exists(temp_path):
                logger.warning(f"Temporary file {temp_path} remains due to permission error")
            raise
        except Exception as e:
            logger.error(f"Error saving WhatsApp history to {temp_path} or renaming to {self._whatsapp_persist_path}: {e}")
            if os.path.exists(temp_path):
                logger.warning(f"Temporary file {temp_path} remains due to error")
            raise

    def add_whatsapp_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a new WhatsApp message to the history and persist to file."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for adding WhatsApp message: {session_id}")
                return False
            logger.info(f"Attempting to add WhatsApp message for session {session_id}: {role}: {content}")
            # Reload history to ensure latest state
            self._load_whatsapp_from_file()
            messages = self._whatsapp_store.get_messages(session_id)
            new_msg = ChatMessage(role=role, content=content)
            messages.append(new_msg)
            self._whatsapp_store.set_messages(session_id, messages)
            self._whatsapp_session_ids.add(session_id)
            self._save_whatsapp_to_file()
            logger.info(f"Added WhatsApp message for session {session_id}: {role}: {content}")
            return True
        except Exception as e:
            logger.error(f"Error adding WhatsApp message for session {session_id}: {e}")
            return False
        
    def _load_chatbot_from_file(self):
        """Load chatbot history from JSON file, falling back to .tmp if needed."""
        temp_path = self._chatbot_persist_path + '.tmp'
        for path in [self._chatbot_persist_path, temp_path]:
            if os.path.exists(path):
                try:
                    with FileLock(path + ".lock", timeout=10):
                        with open(path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                    for session_id, messages in data.items():
                        chat_messages = [
                            ChatMessage(role=msg['role'], content=msg['content'] , additional_kwargs={"timestamp": msg.get('timestamp', '')} )
                            for msg in messages
                        ]
                        self._chatbot_store.set_messages(session_id, chat_messages)
                        self._chatbot_session_ids.add(session_id)
                    logger.info(f"Loaded chatbot history for {len(data)} sessions from {path}")
                    return
                except json.JSONDecodeError as e:
                    logger.error(f"Error decoding {path}: {e}")
                except Exception as e:
                    logger.error(f"Error loading chatbot history from {path}: {e}")
        
        # Create new file if none exist
        try:
            with FileLock(self._chatbot_persist_path + ".lock", timeout=10):
                with open(self._chatbot_persist_path, 'w', encoding='utf-8') as f:
                    json.dump({}, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
            logger.info(f"Created new empty chatbot history file at {self._chatbot_persist_path}")
        except Exception as e:
            logger.error(f"Error creating chatbot history file: {e}")
    

    def _save_chatbot_to_file(self):
        """Save chatbot history to JSON file atomically."""
        data = {}
        temp_path = self._chatbot_persist_path + '.tmp'
        try:
            with FileLock(self._chatbot_persist_path + ".lock", timeout=10):
                for session_id in self._chatbot_session_ids:
                    messages = self._chatbot_store.get_messages(session_id)
                    if messages:
                        data[session_id] = [
                            {'role': msg.role, 'content': msg.content , 'timestamp': msg.additional_kwargs.get("timestamp", "")}
                            for msg in messages
                        ]
                with open(temp_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp_path, self._chatbot_persist_path)
                logger.info(f"Saved chatbot history to {self._chatbot_persist_path}")
        except Exception as e:
            logger.error(f"Error saving chatbot history: {e}")
            if os.path.exists(temp_path):
                logger.warning(f"Temporary file {temp_path} remains due to error")


    def add_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a new chatbot message and persist to file."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for adding chatbot message: {session_id}")
                return False
            self._load_chatbot_from_file()  # Ensure latest state
            messages = self._chatbot_store.get_messages(session_id)

            timestamp = datetime.now().isoformat()

            if isinstance(content, (dict, list)):
                content = json.dumps(content)
            else:
                content = str(content)

            new_msg = ChatMessage(role=role, content=content , additional_kwargs={"timestamp": timestamp} )
            messages.append(new_msg)
            self._chatbot_store.set_messages(session_id, messages)
            self._chatbot_session_ids.add(session_id)
            self._save_chatbot_to_file()  # Save to disk
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
            messages = self._chatbot_store.get_messages(session_id)
            logger.info(f"Retrieved chatbot history for session {session_id}: {len(messages)} messages")
            return messages
        except Exception as e:
            logger.error(f"Error retrieving chatbot history for session {session_id}: {e}")
            return []

    def get_whatsapp_history(self, session_id: str) -> List[ChatMessage]:
        """Retrieve WhatsApp history for a session."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for retrieving WhatsApp history: {session_id}")
                return []
            messages = self._whatsapp_store.get_messages(session_id)
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
            messages = self._whatsapp_store.get_messages(session_id)
            if not messages:
                logger.info(f"No WhatsApp history available for session {session_id}")
                return "No WhatsApp history available."
            formatted_messages = [f"{msg.role}: {msg.content}" for msg in messages]
            logger.info(f"Formatted WhatsApp history for session {session_id}: {len(formatted_messages)} messages")
            return "\n".join(formatted_messages)
        except Exception as e:
            logger.error(f"Error formatting WhatsApp history for session {session_id}: {e}")
            return "Error retrieving WhatsApp history."

    def get_formatted_history(self, session_id: str) -> str:
        """Return formatted chatbot history as a string."""
        try:
            if not isinstance(session_id, str) or not session_id.strip():
                logger.error(f"Invalid session_id for formatting chatbot history: {session_id}")
                return "Invalid session ID."
            messages = self._chatbot_store.get_messages(session_id)
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
        

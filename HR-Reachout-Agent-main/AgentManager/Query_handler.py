from typing import Dict, Any, Optional, List
import logging
import json
from datetime import datetime
from pathlib import Path
import requests

from llama_index.core.llms import ChatMessage

# Import pre-initialized handlers and agents
from AgentManager import (
    chat_history_handler
)
from AgentManager.MonitoringAgent import hybrid_monitoring_agent
from AgentManager.ActionAgent import action_agent_handler
from AgentManager.CoreAgent import core_agent


class QueryHandler:
    def __init__(self):
        """Initialize QueryHandler with necessary components"""
        # Initialize logging
        self._setup_logging()

        # Load configuration
        self.config = self._load_config()

        # Initialize session
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    def _setup_logging(self):
        """Setup logging configuration"""
        log_dir = Path("logs")
        log_dir.mkdir(exist_ok=True)

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_dir / f"query_handler_{datetime.now().strftime('%Y%m%d')}.log"),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from config.json"""
        try:
            with open('AgentManager/config.json', 'r') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Error loading config: {str(e)}")
            return {
                'OpenAI': {
                    'model': 'gpt-4o-mini',
                    'temperature': 0.7,
                    'api_key': None
                }
            }
            
    def send_session_to_webhook(self, session_id: str):
        if not session_id:
            self.logger.error("QueryHandler: No session_id provided to send to webhook")
            return False

        self.logger.info(f"QueryHandler: Sending session_id {session_id} to webhook")
        try:
            response = requests.post(
                "https://773c-2401-4900-4824-bdfe-583f-89f7-e596-70b6.ngrok-free.app/set-session-id",
                json={"session_id": session_id},
                timeout=5
            )
            self.logger.info(f"QueryHandler: Sent session_id to webhook. Status: {response.status_code}")
            return True

        except Exception as e:
            self.logger.error(f"QueryHandler: Unexpected error while sending to webhook: {str(e)}")
            return False

    # === ADD: start helper methods (paste these right after send_session_to_webhook) ===
    def _get_collection_from_store(self, agent_id: Optional[str]) -> str:
        """Fetch collection_name from Agents_store.json for given agent_id"""
        try:
            with open("Agents_store.json", "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                if a.get("id") == agent_id:
                    collection = a.get("collection_name", "default_collection")
                    self.logger.info(f"[AgentConfig] collection for agent_id={agent_id} -> {collection}")
                    return collection
            # not found -> fallback
            self.logger.warning(f"[AgentConfig] agent_id {agent_id} not found in Agents_store.json. Using default collection.")
            return "default_collection"
        except Exception as e:
            self.logger.error(f"[AgentConfig] Error fetching collection for {agent_id}: {e}", exc_info=True)
            return "default_collection"

    def _get_description_from_store(self, agent_id: Optional[str]) -> str:
        """Fetch description from Agents_store.json for given agent_id"""
        try:
            with open("Agents_store.json", "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                if a.get("id") == agent_id:
                    desc = a.get("description", "You are a helpful assistant.")
                    self.logger.info(f"[AgentConfig] description for agent_id={agent_id} -> {desc}")
                    return desc
            # not found -> fallback
            self.logger.warning(f"[AgentConfig] agent_id {agent_id} not found in Agents_store.json. Using default description.")
            return "You are a helpful assistant."
        except Exception as e:
            self.logger.error(f"[AgentConfig] Error fetching description for {agent_id}: {e}", exc_info=True)
            return "You are a helpful assistant."
    # === ADD: end helper methods ===
    async def aprocess_query(self,
                      user_input: str,
                      session_id: str,
                      agent_id: Optional[str] = None):
        import asyncio
        try:
            self.logger.info(f"Processing aquery | session_id={session_id} | agent_id={agent_id} | user_input={user_input}")

            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            chat_history = chat_history_handler.get_chat_history(session_id)
            
            if not user_input.strip():
                return {'response': 'Please provide a valid query'}

            # Run synchronous monitoring directly to avoid PyTorch deadlock on macOS threads
            monitoring_result = hybrid_monitoring_agent.monitor_interaction(
                user_input,
                session_id,
                chat_history
            )
            
            collection_name = self._get_collection_from_store(agent_id)
            content = self._get_description_from_store(agent_id)
            
            agent = core_agent.create_core_agent(
                monitoring_result.get("sentiment_analysis", {}), collection_name=collection_name
            )
            
            chat_history += [ChatMessage(role="system", content=content)]
            response = await agent.astream_chat(user_input, chat_history)
            return response.async_response_gen()

        except Exception as e:
            error_msg = f"Error processing query: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            raise e

    def process_query(self,
                      user_input: str,
                      session_id: str,
                      agent_id: Optional[str] = None):
        """
        Process user query through the agent pipeline:
        1. Monitor user sentiment and interaction
        2. Process through core agent (streaming)
        3. Execute actions if needed
        """
        try:
            print(f"[DEBUG] process_query received agent_id 1: {agent_id}")

            # self.logger.info(f"Processing query for session_id {session_id}: {user_input}")
            self.logger.info(f"Processing query | session_id={session_id} | agent_id={agent_id} | user_input={user_input}")

            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                self.logger.info(f"Generated new session_id: {session_id}")
            
            chat_history = chat_history_handler.get_chat_history(session_id)
            
            if not user_input.strip():
                return {'response': 'Please provide a valid query'}

            monitoring_result = hybrid_monitoring_agent.monitor_interaction(
                user_input,
                session_id,
                chat_history
            )
            print(f"Monitoring result: {monitoring_result}")
            collection_name = self._get_collection_from_store(agent_id)
            content = self._get_description_from_store(agent_id)
            print(f"[ProcessQuery] Using collection='{collection_name}' for agent_id={agent_id}")
            
            agent = core_agent.create_core_agent(
                monitoring_result.get("sentiment_analysis", {}), collection_name=collection_name
            )
            print(f"printing chat history: {chat_history}")
            
            chat_history+= [ChatMessage(role="system", content=content)]
            response = agent.stream_chat(user_input, chat_history)
            print(f"printing response: {response.response_gen}")
            return response.response_gen

        except Exception as e:
            error_msg = f"Error processing query: {str(e)}"
            self.logger.error(error_msg, exc_info=True)

    async def post_process_query(self, user_query: str, assistant_response: str, session_id: Optional[str] = None, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Post process the query by adding messages to chat history and performing agent task.
        """
        try:
            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            self.logger.info(f"Post processing query for session_id {session_id} & {agent_id}")
            print(f"[DEBUG] post_process_query received agent_id 2: {agent_id}")

            # Add user query and assistant response to chat history
            chat_history = chat_history_handler.get_chat_history(session_id=session_id)
            if not chat_history:
                chat_history_handler.add_message(session_id, "user", user_query)
                self.logger.info("Added user query to chat history.")
                chat_history_handler.add_message(session_id, "assistant", assistant_response)
                self.logger.info("Added assistant response to chat history.")

            # Perform agent action
            action_result = action_agent_handler.process_user_input(session_id)
            self.logger.info(f"Action result is : {action_result}")
            self.logger.info("Performed action agent task.")

            # Detect escalation
            escalated = False
            if isinstance(action_result, dict) and (
                action_result.get("telegram_msg_success")
                ):
                    escalated = True

            self.logger.info(f"Escalation detected: {escalated}")
            self.send_session_to_webhook(session_id)
            self.logger.info(f"Sent session_id {session_id} to webhook")

            return {
                "status": "success",
                "action_result": action_result,
                "escalated": escalated
            }

        except Exception as e:
            self.logger.error(f"Error in post_process_query: {str(e)}", exc_info=True)
            chat_history_handler.add_message(session_id, "system", f"Error in post_process_query: {str(e)}")
            return {
                "status": "error",
                "error": str(e),
                "error_type": type(e).__name__
            }
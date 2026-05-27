from typing import Dict, Any, Optional, List, AsyncIterator, Iterator
import asyncio
import logging
import json
import re
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
from AgentManager.KnowledgeManagerAgent import knowledge_management_handler

# When a question is about the company but not found in the uploaded knowledge base.
_COMPANY_KB_MISS_REPLY = (
    "I don't have that information in my knowledge base. "
    "If you have further queries, please drop a note to info@elevatetrust.ai."
)


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
                "https://b65c-2405-201-101b-482a-151e-6624-2510-d0fd.ngrok-free.app/set-session-id",
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

    def _get_model_from_store(self, agent_id: Optional[str]) -> Optional[str]:
        """Fetch Bedrock model_id from Agents_store.json for given agent_id."""
        if not agent_id:
            return None
        try:
            with open("Agents_store.json", "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                if a.get("id") == agent_id:
                    model = a.get("model")
                    if model:
                        self.logger.info(f"[AgentConfig] model for agent_id={agent_id} -> {model}")
                        return model
            self.logger.warning(
                f"[AgentConfig] agent_id {agent_id} not found in Agents_store.json for model lookup."
            )
        except Exception as e:
            self.logger.error(f"[AgentConfig] Error fetching model for {agent_id}: {e}", exc_info=True)
        return None

    def _get_name_from_store(self, agent_id: Optional[str]) -> str:
        """Fetch agent/company display name from Agents_store.json for given agent_id."""
        try:
            with open("Agents_store.json", "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                if a.get("id") == agent_id:
                    return (a.get("name") or "ElevateTrust").strip()
        except Exception:
            pass
        return "ElevateTrust"

    def _policy_instruction(self, company_name: str) -> str:
        return (
            "\n\nSTRICT RESPONSE POLICY:\n"
            "1) Respond naturally in chat style. Do NOT prefix replies with agent/company labels.\n"
            "2) Answer ONLY from knowledge base facts retrieved via knowledge_source. "
            "Never use general world knowledge, trivia, geography, math, news, or anything not in the KB.\n"
            "3) If question is out of scope (not about company/KB), reply EXACTLY:\n"
            f"\"sorry i cant answer that specific question but you can ask me about the {company_name}.\"\n"
            "4) If question is about company but KB has no relevant info, reply EXACTLY:\n"
            f"\"{_COMPANY_KB_MISS_REPLY}\"\n"
            "5) Never answer out-of-scope questions with made-up information.\n"
            "6) Keep responses concise and avoid repeating the same sentence repeatedly.\n"
        )

    def _is_brief_social_message(self, user_input: str) -> bool:
        """Short greetings/thanks — skip strict KB preflight so UX stays natural."""
        q = (user_input or "").strip().lower()
        if not q or len(q) > 80:
            return False
        patterns = (
            r"^(hi|hello|hey|hii|helo)\b[\s!.,?]*$",
            r"^(good\s+(morning|afternoon|evening|night))\b[\s!.,?]*$",
            r"^(thanks|thank\s+you|thx|ty)\b[\s!.,?]*$",
            r"^(bye|goodbye|see\s+you)\b[\s!.,?]*$",
            r"^(ok|okay|k)\b[\s!.,?]*$",
            r"^(namaste|namaskar)\b[\s!.,?]*$",
        )
        return any(re.match(p, q) for p in patterns)

    def _kb_hit_from_rag(self, rag_result: Dict[str, Any]) -> bool:
        sol = rag_result.get("solution")
        if isinstance(sol, dict):
            if sol.get("weak_match"):
                return False
            chunk = (sol.get("chunk") or "").strip()
            return bool(chunk)
        return False

    def _rag_relevance_score(self, rag_result: Dict[str, Any]) -> Optional[float]:
        sol = rag_result.get("solution")
        if isinstance(sol, dict):
            score = sol.get("relevance_score")
            if score is not None:
                return float(score)
        return None

    def _out_of_scope_reply(self, company_name: str) -> str:
        return (
            f"sorry i cant answer that specific question but you can ask me about the {company_name}."
        )

    def _is_likely_general_knowledge_query(self, user_input: str) -> bool:
        """Trivia / world knowledge — not answerable from a company KB."""
        q = (user_input or "").strip().lower()
        if not q:
            return False
        regex_patterns = (
            r"\bcapital of\b",
            r"\bpopulation of\b",
            r"\bwho (is|was) the (president|prime minister|king|queen)\b",
            r"\bhow old is\b",
            r"\bwhen was .+ born\b",
            r"\bwhat is \d+\s*[\+\-\*\/]",
            r"\bwho won (the )?(world cup|match|game)\b",
        )
        if any(re.search(p, q) for p in regex_patterns):
            return True
        markers = (
            "temperature",
            "weather",
            "forecast",
            "rain",
            "humidity",
            "stock price",
            "bitcoin",
            "crypto",
            "match score",
            "sports score",
            "news today",
            "movie recommendation",
            "tell me a joke",
            "horoscope",
            "recipe for",
            "convert usd to",
        )
        return any(self._query_contains_term(q, m) if len(m) <= 5 else m in q for m in markers)

    def _maybe_block_unrelated_query(
        self, user_input: str, company_name: str, rag_result: Dict[str, Any]
    ) -> Optional[str]:
        """
        Hard-block only obvious general-knowledge questions with no strong KB match.
        Company/KB questions always continue to the agent even if preflight is weak.
        """
        if self._is_company_related_query(user_input, company_name):
            return None
        if not self._is_likely_general_knowledge_query(user_input):
            return None
        if self._kb_hit_from_rag(rag_result):
            score = self._rag_relevance_score(rag_result)
            if score is not None and score >= 0.4:
                return None
        return self._out_of_scope_reply(company_name)

    def _query_contains_term(self, q: str, term: str) -> bool:
        """Match whole words/phrases so 'api' does not match inside 'capital'."""
        t = (term or "").strip().lower()
        if not t:
            return False
        if " " in t:
            return t in q
        return re.search(rf"\b{re.escape(t)}\b", q) is not None

    def _is_company_related_query(self, user_input: str, company_name: str) -> bool:
        """Heuristic: likely about this business vs random trivia."""
        q = (user_input or "").strip().lower()
        if not q:
            return False
        cn = (company_name or "").strip().lower()
        if cn and cn in q:
            return True
        for token in cn.split():
            if len(token) >= 4 and self._query_contains_term(q, token):
                return True
        markers = (
            "your company",
            "your product",
            "your platform",
            "your service",
            "your app",
            "your pricing",
            "your team",
            "this company",
            "this platform",
            "this product",
            "what do you do",
            "who are you",
            "tell me about you",
            "pricing",
            "subscription",
            "billing",
            "invoice",
            "upload",
            "dashboard",
            "sign up",
            "signup",
            "sign-up",
            "register",
            "login",
            "account",
            "password",
            "documentation",
            "knowledge base",
            "widget",
            "whatsapp",
            "api",
            "demo",
            "contact sales",
            "support",
            "elevatetrust",
            "deepfake",
        )
        return any(self._query_contains_term(q, m) for m in markers)

    def _run_rag_preflight(self, user_input: str, collection_name: str) -> Dict[str, Any]:
        return knowledge_management_handler.rag_function(
            query=(user_input or "").strip(),
            collection_name=collection_name,
        )

    def _enforce_reply_policy(self, reply: str, company_name: str, chat_history: List[ChatMessage]) -> str:
        text = (reply or "").strip()
        if not text:
            return _COMPANY_KB_MISS_REPLY

        lower = text.lower()
        unknown_markers = [
            "no existing solution found",
            "couldn't find any information",
            "i couldn't find",
            "i don't have enough information",
            "i dont have enough information",
            "not enough information",
            "i am not sure",
            "i cannot find",
        ]
        if any(m in lower for m in unknown_markers):
            return _COMPANY_KB_MISS_REPLY

        # Prevent stale repeated assistant responses on new turns.
        last_assistant = None
        for msg in reversed(chat_history or []):
            role = str(getattr(msg, "role", "")).lower()
            if "assistant" in role:
                last_assistant = (getattr(msg, "content", "") or "").strip()
                break
        if last_assistant and last_assistant == text:
            return _COMPANY_KB_MISS_REPLY
        return text
    # === ADD: end helper methods ===

    @staticmethod
    def _extract_chat_text(chat_response: Any) -> str:
        if chat_response is None:
            return ""
        if hasattr(chat_response, "response") and chat_response.response is not None:
            return str(chat_response.response)
        return str(chat_response)

    async def _non_streaming_async_gen(self, text: str) -> AsyncIterator[str]:
        if text:
            yield text

    def _non_streaming_sync_gen(self, text: str) -> Iterator[str]:
        if text:
            yield text

    def _sanitize_chat_history(self, history: List[ChatMessage]) -> List[ChatMessage]:
        """
        Keep only user/assistant turns and collapse consecutive same-role entries.
        This avoids Bedrock Llama prompt formatter assertions on malformed histories.
        """
        cleaned: List[ChatMessage] = []
        for msg in history or []:
            role = str(getattr(msg, "role", "")).lower()
            content = getattr(msg, "content", "")
            if not content:
                continue
            if "user" in role:
                normalized_role = "user"
            elif "assistant" in role:
                normalized_role = "assistant"
            else:
                continue

            if cleaned and str(cleaned[-1].role).lower() == normalized_role:
                merged = (cleaned[-1].content or "") + "\n" + str(content)
                cleaned[-1] = ChatMessage(role=normalized_role, content=merged)
            else:
                cleaned.append(ChatMessage(role=normalized_role, content=str(content)))
        return cleaned

    async def aprocess_query(self,
                      user_input: str,
                      session_id: str,
                      agent_id: Optional[str] = None):
        try:
            self.logger.info(f"Processing aquery | session_id={session_id} | agent_id={agent_id} | user_input={user_input}")

            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            chat_history = chat_history_handler.get_chat_history(session_id)
            chat_history = self._sanitize_chat_history(chat_history)
            
            if not user_input.strip():
                return {'response': 'Please provide a valid query'}

            collection_name = self._get_collection_from_store(agent_id)
            company_name = self._get_name_from_store(agent_id)

            if not self._is_brief_social_message(user_input):
                rag_preflight = await asyncio.to_thread(
                    self._run_rag_preflight, user_input, collection_name
                )
                blocked = self._maybe_block_unrelated_query(
                    user_input, company_name, rag_preflight
                )
                if blocked:
                    return self._non_streaming_async_gen(blocked)

            # Run synchronous monitoring directly to avoid PyTorch deadlock on macOS threads
            monitoring_result = hybrid_monitoring_agent.monitor_interaction(
                user_input,
                session_id,
                chat_history
            )
            
            content = self._get_description_from_store(agent_id)
            model_id = self._get_model_from_store(agent_id)
            content += self._policy_instruction(company_name)
            
            # For website widget / anonymous sessions, inject lead-gen behavior
            if (
                session_id.startswith("anon_")
                or session_id.startswith("whatsapp_")
                or session_id.startswith("widget_")
                or session_id.startswith("w_")
            ):
                is_whatsapp = session_id.startswith("whatsapp_")
                
                lead_gen_instruction = (
                    "\n\nIMPORTANT ADDITIONAL BEHAVIOR — User Guide & Lead Generation:"
                    "\nYou are the ElevateTrust AI assistant. Your goal is to guide users to use our platform and smartly capture their contact details."
                    "\nHere are your strict rules:"
                    "\n1. First and foremost, answer the user's questions clearly using your knowledge base."
                    "\n2. When the user asks how to use the platform or what it does, guide them to SIGN UP and go to the FUNCTIONALITY/UPLOAD page."
                    "\n3. Explain that they can upload videos or paste URLs to detect deepfakes."
                    "\n4. CRITICAL: ONLY when the user appears satisfied, says 'thanks', 'okay', or seems to have finished their questions, YOU MUST naturally ask for their name, email, and phone number (if you don't already have them)."
                )
                if is_whatsapp:
                    lead_gen_instruction += (
                        "\n5. Say something like: 'I am glad I could help! If you'd like our team to follow up or give you a personalized demo, could you share your name and email?'"
                    )
                else:
                    lead_gen_instruction += (
                        "\n5. When they seem done with questions, ask ONE question at a time for: full name, phone number, and email address."
                        "\n6. After collecting contact info (or if they decline), ask: 'Do you have any other questions, or can we mark this chat as complete?'"
                        "\n7. If they say no more questions, thank them warmly and confirm the chat is complete."
                    )
                lead_gen_instruction += (
                    "\n8. NEVER ask for contact details at the very beginning or while they still have product questions."
                    "\n9. NEVER repeat a question you have already asked."
                    "\n10. Keep responses concise (under 60 words) and conversational."
                )
                
                content += lead_gen_instruction
            
            agent = core_agent.create_core_agent(
                monitoring_result.get("sentiment_analysis", {}),
                collection_name=collection_name,
                model_id=model_id,
            )
            
            chat_history += [ChatMessage(role="system", content=content)]

            def run_chat():
                try:
                    return agent.chat(user_input, chat_history)
                except ValueError as exc:
                    if "max iterations" in str(exc).lower():
                        self.logger.warning(
                            "ReAct agent hit max iterations for session %s", session_id
                        )
                        return None
                    raise

            chat_response = await asyncio.to_thread(run_chat)
            if chat_response is None:
                return self._non_streaming_async_gen(
                    "I'm having trouble completing that request. Please try rephrasing your question."
                )
            reply = self._extract_chat_text(chat_response).strip()
            if not reply:
                reply = _COMPANY_KB_MISS_REPLY
            reply = self._enforce_reply_policy(reply, company_name, chat_history)
            return self._non_streaming_async_gen(reply)

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
            chat_history = self._sanitize_chat_history(chat_history)
            
            if not user_input.strip():
                return {'response': 'Please provide a valid query'}

            collection_name = self._get_collection_from_store(agent_id)
            company_name = self._get_name_from_store(agent_id)

            if not self._is_brief_social_message(user_input):
                rag_preflight = self._run_rag_preflight(user_input, collection_name)
                blocked = self._maybe_block_unrelated_query(
                    user_input, company_name, rag_preflight
                )
                if blocked:
                    return self._non_streaming_sync_gen(blocked)

            monitoring_result = hybrid_monitoring_agent.monitor_interaction(
                user_input,
                session_id,
                chat_history
            )
            print(f"Monitoring result: {monitoring_result}")
            content = self._get_description_from_store(agent_id)
            model_id = self._get_model_from_store(agent_id)
            content += self._policy_instruction(company_name)
            print(f"[ProcessQuery] Using collection='{collection_name}' for agent_id={agent_id}")
            
            # For website widget / anonymous sessions, inject lead-gen behavior
            if (
                session_id.startswith("anon_")
                or session_id.startswith("whatsapp_")
                or session_id.startswith("widget_")
                or session_id.startswith("w_")
            ):
                is_start = len(chat_history) <= 2
                is_whatsapp = session_id.startswith("whatsapp_")
                
                lead_gen_instruction = (
                    "\n\nIMPORTANT ADDITIONAL BEHAVIOR — User Guide & Lead Generation:"
                    "\nYou are the ElevateTrust AI assistant. Your goal is to guide users to use our platform and smartly capture their contact details."
                    "\nHere are your strict rules:"
                    "\n1. First and foremost, answer the user's questions clearly using your knowledge base."
                    "\n2. When the user asks how to use the platform or what it does, guide them to SIGN UP and go to the FUNCTIONALITY/UPLOAD page."
                    "\n3. Explain that they can upload videos or paste URLs to detect deepfakes."
                    "\n4. CRITICAL: ONLY when the user appears satisfied, says 'thanks', 'okay', or seems to have finished their questions, YOU MUST naturally ask for their name, email, and phone number (if you don't already have them)."
                )
                if is_whatsapp:
                    lead_gen_instruction += (
                        "\n5. Say something like: 'I am glad I could help! If you'd like our team to follow up or give you a personalized demo, could you share your name and email?'"
                    )
                else:
                    lead_gen_instruction += (
                        "\n5. When they seem done with questions, ask ONE question at a time for: full name, phone number, and email address."
                        "\n6. After collecting contact info (or if they decline), ask: 'Do you have any other questions, or can we mark this chat as complete?'"
                        "\n7. If they say no more questions, thank them warmly and confirm the chat is complete."
                    )
                lead_gen_instruction += (
                    "\n8. NEVER ask for contact details at the very beginning or while they still have product questions."
                    "\n9. NEVER repeat a question you have already asked."
                    "\n10. Keep responses concise (under 60 words) and conversational."
                )
                
                content += lead_gen_instruction
                
            agent = core_agent.create_core_agent(
                monitoring_result.get("sentiment_analysis", {}),
                collection_name=collection_name,
                model_id=model_id,
            )
            print(f"printing chat history: {chat_history}")
            
            chat_history += [ChatMessage(role="system", content=content)]
            chat_response = agent.chat(user_input, chat_history)
            reply = self._enforce_reply_policy(
                self._extract_chat_text(chat_response), company_name, chat_history
            )
            return self._non_streaming_sync_gen(
                reply
            )

        except Exception as e:
            error_msg = f"Error processing query: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            raise e

    async def post_process_query(self, user_query: str, assistant_response: str, session_id: Optional[str] = None, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Post process the query by adding messages to chat history and performing agent task.
        """
        try:
            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            self.logger.info(f"Post processing query for session_id {session_id} & {agent_id}")
            print(f"[DEBUG] post_process_query received agent_id 2: {agent_id}")

            # Add latest user/assistant turn to chat history.
            # Keep a lightweight dedupe guard because analyze_action can be retried.
            chat_history = chat_history_handler.get_chat_history(session_id=session_id)
            add_user = True
            add_assistant = True

            if chat_history:
                last_msg = chat_history[-1]
                last_role = str(getattr(last_msg, "role", "")).lower()
                last_content = getattr(last_msg, "content", "")

                if "user" in last_role and last_content == user_query:
                    add_user = False
                if "assistant" in last_role and last_content == assistant_response:
                    add_assistant = False

                if len(chat_history) >= 2:
                    prev_msg = chat_history[-2]
                    prev_role = str(getattr(prev_msg, "role", "")).lower()
                    prev_content = getattr(prev_msg, "content", "")
                    if (
                        "user" in prev_role
                        and prev_content == user_query
                        and "assistant" in last_role
                        and last_content == assistant_response
                    ):
                        add_user = False
                        add_assistant = False

            if add_user:
                chat_history_handler.add_message(session_id, "user", user_query)
                self.logger.info("Added user query to chat history.")
            if add_assistant:
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
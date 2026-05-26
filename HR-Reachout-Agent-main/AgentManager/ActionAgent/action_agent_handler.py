import os
import sys
import logging
import json
from .function_handler import FunctionHandler
from .tool_handler import ToolHandler
from AgentManager import instruction_handler, llm_handler, chat_history_handler
from llama_index.core.llms import ChatMessage, MessageRole
from datetime import datetime
from .jira_handler import save_ticket_locally
import random
import string

def generate_bind_code(length: int = 5) -> str:
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=length))

# Suppress httpx and twilio INFO logs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("twilio.http_client").setLevel(logging.WARNING)

TICKET_STORE_PATH = "tickets_store.json"

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

try:
    with open('AgentManager/config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

bedrock_cfg = config['Bedrock']
llm = llm_handler.get_llm(bedrock_cfg['model_id'], bedrock_cfg.get('temperature', 0.7))



class ActionAgentHandler:
    def __init__(self):
        self.llm = llm
        self.function_handler = FunctionHandler()
        self.tool_handler = ToolHandler(self.function_handler)
        self.tools = self.tool_handler.get_tools()
        self.system_prompt = instruction_handler.Action_agent_prompt
        self.chat_history_handler = chat_history_handler
        self.message = "Thanks for reaching out. Your query is registered. Our human expert will reach out to you shortly."
        logging.info(f"Initialized ActionAgent with {len(self.tools)} tools")

        try:
            with open('AgentManager/config.json', 'r') as f:
                self.config = json.load(f)
        except Exception as e:
            raise RuntimeError(f"Failed to load required configuration: {str(e)}")

    def create_telegram_ticket(self, session_id,chat_id, bot_token, summary: str = ""):
        chat_history = self.chat_history_handler.get_formatted_history(session_id)
        ticket_data = {
            "session_id": session_id,
            "summary": summary or "Telegram Escalation",
            "description": "Escalated via Telegram. Review the conversation.",
            "created_at": datetime.utcnow().isoformat(),
            "awaiting_human_response": True,
            "messages": [],
            "escalation_channel": "telegram",
            "chat_id": chat_id,
            "bot_token": bot_token,
            "chat_history": chat_history
        }
        save_ticket_locally(ticket_data)
        logging.info(f"Saved Telegram escalation ticket for session: {session_id} using bot: {bot_token}")

    def get_available_bot(self, tickets):
        all_bots = [b["bot_token"] for b in self.config["Telegram"]["bots"]]
        used_bots = [t.get("bot_token") for t in tickets if "bot_token" in t]

        for bot in all_bots:
            if bot not in used_bots:
                return bot
        return None

    def generate_summary(self, session_id: str, chat_history: str) -> str:

        raw_history = self.chat_history_handler.get_chat_history(session_id)

        prompt = f"""
            Please summarize the following chat history in a concise and clear manner
            Rules:
            - Just tell the highlighs of the conversation:
            - user's profile and interests if mentioned
            - provide it in bullet points, to the point crisp and no unnecessary details
            - keep it related with user only, so not include company specific, or escalation specific info.

            Chat History:
            {chat_history}
        """

        response = self.llm.complete(prompt)
        print("\n\nResponse: ", response)
        return response.text.strip()

    def _should_escalate(self, chat_history_messages) -> bool:
        """Use the LLM to decide if the conversation needs human escalation.

        Instead of OpenAI-specific chat_with_tools, we use a simple prompt-based
        approach that works with any LLM (including Bedrock OSS models).
        """
        content = self.system_prompt.template
        system_message = ChatMessage(role=MessageRole.SYSTEM, content=content)
        temp_history = [system_message] + chat_history_messages

        # Build a text prompt asking the LLM to decide
        decision_prompt = (
            "Based on the conversation above, should this conversation be escalated "
            "to a human agent? Consider if the user explicitly asked for a human, "
            "if the AI cannot answer their question, or if there is frustration.\n\n"
            "Reply with ONLY one word: ESCALATE or NO_ESCALATE"
        )
        temp_history.append(ChatMessage(role=MessageRole.USER, content=decision_prompt))

        try:
            response = self.llm.chat(temp_history)
            decision = response.message.content.strip().upper()
            logging.info(f"Escalation decision: {decision}")
            return "ESCALATE" in decision
        except Exception as e:
            logging.error(f"Error during escalation decision: {type(e).__name__}: {e}")
            return False

    def process_user_input(self, session_id: str) -> dict:
        chat_history = self.chat_history_handler.get_chat_history(session_id)
        formatted_history = self.chat_history_handler.get_formatted_history(session_id)
        print("\n\n[DEBUG] Formatted History for LLM: \n", formatted_history)

        # Use prompt-based escalation decision instead of chat_with_tools
        should_escalate = self._should_escalate(chat_history)

        if not should_escalate:
            return {"success": False, "error": "No escalation needed"}

        # Proceed with Telegram escalation
        final_response = {"success": False}

        try:
            with open(TICKET_STORE_PATH, "r") as f:
                tickets = json.load(f)

            # hard coding for now, later logic needs to be added
            bot_token = "8706315248:AAH-pAO4B_LohsrKQNPD-2ONhsnMVVXFZPU"

            if not bot_token:
                raise Exception("No available Telegram bots for escalation")

            self.tool_handler.set_bot_token(bot_token)
            logging.info(f"Selected Telegram bot for escalation: {bot_token}")
            self.chat_history_handler.add_message(session_id, "assistant", self.message)

            # Send only the summary instead of full chat history to telegram bot
            summary = self.generate_summary(session_id, formatted_history)

            message = f"sessionId : {session_id} \n\n Summary : {summary}"

            # Find and call the human_agent tool
            tool_map = {tool.metadata.name: tool.fn for tool in self.tools}
            human_agent_fn = tool_map.get("human_agent")

            if human_agent_fn:
                tool_args = {
                    "message": message,
                    "session_id": session_id,
                    "bot_token": bot_token
                }

                print("-"*15)
                print("Telegram tool arguments: \n")
                print(tool_args)
                print("-"*15)

                result = human_agent_fn(tool_args)
                if isinstance(result, str):
                    parsed_result = json.loads(result)
                else:
                    parsed_result = result

                chat_id = parsed_result.get("chat_id", None)
                status = parsed_result.get("status", "").lower()
                final_response["telegram_msg_success"] = status == "success"

                self.create_telegram_ticket(session_id, chat_id, bot_token, summary=summary)

                logging.info(f"Tool human_agent result: {parsed_result}")
                final_response["success"] = True
            else:
                logging.error("human_agent tool not found in tool_map")

        except json.JSONDecodeError as e:
            logging.error(f"Invalid JSON in ticket store: {e}")
            final_response.setdefault("errors", []).append(f"JSON error: {str(e)}")
        except Exception as e:
            logging.error(f"Error executing escalation: {type(e).__name__}: {e}")
            final_response.setdefault("errors", []).append(f"Error: {str(e)}")

        if not final_response.get("telegram_msg_success"):
            logging.warning("Telegram tool was not successfully executed")
            final_response["success"] = False

        return final_response

import os
import sys
import logging
import json
from .function_handler import FunctionHandler
from .tool_handler import ToolHandler
from AgentManager import instruction_handler, llm_handler, chat_history_handler
from llama_index.llms.openai import OpenAI
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

model = config['OpenAI']['model']
temperature = config['OpenAI']['temperature']
llm = llm_handler.get_llm(model, temperature)



class ActionAgentHandler:
    def __init__(self):
        self.llm = llm
        self.function_handler = FunctionHandler()
        self.tool_handler = ToolHandler(self.function_handler)
        self.tools = self.tool_handler.get_tools()
        self.system_prompt = instruction_handler.Action_agent_prompt
        # llm.system_prompt = self.system_prompt.template
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
        # print("\n\nRaw History: ", raw_history)

        # print("\n\nFormatted Chat History for Summarization: ", chat_history)

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

    def process_user_input(self, session_id: str) -> dict:
        content = self.system_prompt.template
        chat_history = self.chat_history_handler.get_chat_history(session_id)
        system_message = ChatMessage(role=MessageRole.SYSTEM, content=content)
        temp_history = [system_message] + chat_history

        formatted_history = self.chat_history_handler.get_formatted_history(session_id)
        print("\n\n[DEBUG] Formatted History for LLM: \n", formatted_history)

        try:
            response = self.llm.chat_with_tools(
                tools=self.tools,
                chat_history=temp_history,
                allow_parallel_tool_calls=True,
                verbose=True,
            )
        except Exception as e:
            logging.error(f"Error during LLM processing: {type(e).__name__}: {e}")
            return {"success": False, "error": f"LLM processing failed: {str(e)}"}

        tool_map = {tool.metadata.name: tool.fn for tool in self.tools}
        tool_calls = response.message.additional_kwargs.get("tool_calls", [])

        logging.info("\n\nLLM DECISION DEBUG: ")
        logging.info(f"Response Message: {response.message.content}")
        logging.info(f"Tool Calls Found: {tool_calls}")

        if not tool_calls:
            return {"success": False, "error": "No tools called by LLM"}

        final_response = {"success": False}

        for tool_call in tool_calls:
            tool_name = tool_call.function.name
            tool_func = tool_map.get(tool_name)

            if not tool_func:
                logging.error(f"Tool {tool_name} not found in tool_map")
                continue

            try:
                args = tool_call.function.arguments
                try:
                    if isinstance(args, str):
                        args = json.loads(args)
                    elif not isinstance(args, dict):
                        raise ValueError(f"Tool arguments must be a dict or JSON string, got: {type(args)}")
                except Exception as e:
                    logging.error(f"Failed to parse arguments for tool {tool_name}: {args} — {type(e).__name__}: {e}")
                    final_response.setdefault("errors", []).append(f"Invalid args for {tool_name}: {str(e)}")
                    continue  # Skip this tool call


                if tool_name == "human_agent":

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

                    tool_args = {
                        "message": message,
                        "session_id": session_id,
                        "bot_token": bot_token
                    }

                    print("-"*15)
                    print("Telegram tool arguments: \n")
                    print(tool_args)
                    print("-"*15)

                    result = tool_func(tool_args)
                    if isinstance(result, str):
                        parsed_result = json.loads(result)
                    else:
                        parsed_result = result

                    chat_id = parsed_result.get("chat_id", None)
                    status = parsed_result.get("status", "").lower()
                    final_response["telegram_msg_success"] = status == "success"

                    self.create_telegram_ticket(session_id, chat_id, bot_token, summary=summary)

                    logging.info(f"Tool {tool_name} result: {parsed_result}")

                final_response["success"] = True

            except json.JSONDecodeError as e:
                logging.error(f"Invalid JSON in tool call arguments for {tool_name}: {tool_call.function.arguments}")
                final_response.setdefault("errors", []).append(f"Invalid JSON for {tool_name}: {str(e)}")
            except Exception as e:
                logging.error(f"Error executing tool {tool_name}: {type(e).__name__}: {e}")
                final_response.setdefault("errors", []).append(f"Error in {tool_name}: {str(e)}")

        if not final_response.get("telegram_msg_success"):
            logging.warning("Telegram tool was not successfully executed")
            final_response["success"] = False

        return final_response

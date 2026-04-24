from llama_index.core.tools import FunctionTool
import json
import logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

class ToolHandler:
    def __init__(self, function_handler):
        self.function_handler = function_handler
        self.tools = {}
        self.current_bot_token = None  # Holds bot_token temporarily
        self._init_tools()

    def _init_tools(self):
        # Wrapped version of send_telegram_msg that injects bot_token dynamically
        def send_telegram_wrapper(args):
            logging.warning(f"[DEBUG] Raw args in send_telegram_wrapper: {args} (type: {type(args)})")

            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception as e:
                    return f"Error: Failed to parse tool args JSON - {str(e)}"

            if not isinstance(args, dict):
                return "Error: Invalid tool arguments. Expected a dictionary."

            if "args" in args:
                logging.warning(f"[DEBUG] Unwrapping nested 'args': {args}")
                args = args["args"]

            logging.warning(f"[DEBUG] Final unwrapped args: {args}")

            if not self.current_bot_token:
                return "Error: No bot_token set for this session."

            message = args.get("message")
            session_id = args.get("session_id")

            result =  self.function_handler.send_telegram_msg(message, session_id, self.current_bot_token)

            try:
                parsed_result = json.loads(result)
                if parsed_result.get("status") == "success":
                    return parsed_result  # or just return result
                else:
                    return parsed_result.get("error", "Unknown error sending Telegram message")
            except Exception as e:
                return f"Error parsing Telegram result: {str(e)}"



        self.tools["human_agent"] = FunctionTool.from_defaults(
            fn=send_telegram_wrapper,
            name="human_agent",
            description="Use this tool to notify a human via Telegram when the user is upset or requests human help."
        )

    def get_tools(self):
        return list(self.tools.values())

    def set_bot_token(self, bot_token: str):
        """Set the bot_token to be used in the next Telegram tool call."""
        self.current_bot_token = bot_token

import os
import json
import requests
import logging

from AgentManager.telegram.sender import TelegramSender
from AgentManager.telegram.chat_session_mapping import get_chat_id_for_session  # You’ll create this

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load config
try:
    with open("AgentManager/config.json", "r") as file:
        config = json.load(file)
except FileNotFoundError:
    logger.error("Error: config.json not found!")
    config = {}
except json.JSONDecodeError:
    logger.error("Error: Invalid JSON format in config.json!")
    config = {}

class FunctionHandler:
    def __init__(self):
        try:
            self.token = config["ULTRAMSG"]["TOKEN"]
            self.instance_id = config["ULTRAMSG"]["INSTANCE_ID"]
            self.receiver_number = config["ULTRAMSG"]["PHONE_NUMBER"]
        except KeyError as e:
            logger.error(f"Error: Missing UltraMsg config key {e}")
            self.token = None
            self.instance_id = None
            self.receiver_number = None

        self.telegram_sender = TelegramSender()

    def send_whatsapp_msg(self, message: str) -> str:
        if not all([self.token, self.instance_id, self.receiver_number]):
            return "Error: UltraMsg configuration is incomplete."

        message_body = str(message) if message else "No message provided"
        url = f"https://api.ultramsg.com/{self.instance_id}/messages/chat"
        payload = {
            "token": self.token,
            "to": self.receiver_number,
            "body": message_body,
            "priority": 10
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            response = requests.post(url, data=payload, headers=headers)
            response.raise_for_status()
            result = response.json()
            logger.info(f"Message Sent Successfully to {self.receiver_number}: {message_body}")
            return f"Message sent successfully! Message ID: {result.get('id', 'N/A')}"
        except requests.exceptions.RequestException as e:
            logger.error(f"Error sending WhatsApp message: {e}")
            return f"Error sending WhatsApp message: {str(e)}"
        

    def send_telegram_msg(self, message: str, session_id: str, bot_token: str) -> str:

        # Load config to fetch corresponding chat_id
        with open("AgentManager/config.json", "r") as f:
            config = json.load(f)

        bots = config["Telegram"]["bots"]
        selected_bot = next((b for b in bots if b["bot_token"] == bot_token), None)

        if not selected_bot or "agent_chat_id" not in selected_bot:
            return f"Error: No agent_chat_id found for bot_token: {bot_token}"

        chat_id = selected_bot["agent_chat_id"]

        send_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown"
        }

        import requests
        resp = requests.post(send_url, json=payload)

        if resp.status_code == 200:
            # Store chat_id somewhere if needed
            return json.dumps({
                "status": "success",
                "chat_id": chat_id
            })
        else:
            return json.dumps({
                "status": "error",
                "error": resp.text
            })

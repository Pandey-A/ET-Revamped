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
        # Load WhatsApp Cloud API config
        wa_config = config.get("WhatsApp", {})
        self.wa_phone_number_id = wa_config.get("phone_number_id")
        self.wa_access_token = wa_config.get("access_token")
        self.wa_admin_phone = wa_config.get("admin_phone")

        if not all([self.wa_phone_number_id, self.wa_access_token, self.wa_admin_phone]):
            logger.error("WhatsApp Cloud API config is incomplete in config.json")

        self.telegram_sender = TelegramSender()

    def send_whatsapp_msg(self, message: str) -> str:
        """Send a WhatsApp message via Meta Cloud API."""
        if not all([self.wa_phone_number_id, self.wa_access_token, self.wa_admin_phone]):
            return "Error: WhatsApp Cloud API configuration is incomplete."

        message_body = str(message) if message else "No message provided"
        url = f"https://graph.facebook.com/v22.0/{self.wa_phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.wa_access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": self.wa_admin_phone.replace("+", "").replace(" ", ""),
            "type": "text",
            "text": {"body": message_body},
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=15)
            result = response.json()
            if response.status_code in (200, 201):
                logger.info(f"WhatsApp message sent to {self.wa_admin_phone}: {message_body[:100]}")
                return f"Message sent successfully to {self.wa_admin_phone}"
            else:
                logger.error(f"WhatsApp API error {response.status_code}: {result}")
                return f"Error sending WhatsApp message: {result}"
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

import requests
import logging

logger = logging.getLogger(__name__)


class TelegramSender:
    def send_message(self, chat_id: str, message: str, bot_token: str) -> bool:
        if not bot_token:
            logger.error("Telegram bot token is not provided.")
            return False

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message
        }

        try:
            response = requests.post(url, json=payload)
            response.raise_for_status()
            logger.info(f"Telegram message sent to {chat_id}: {message}")
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to send Telegram message: {e}")
            return False

import json
import logging
import requests

logger = logging.getLogger(__name__)

# Load config
try:
    with open("AgentManager/config.json", "r") as f:
        _config = json.load(f)
    WA_CONFIG = _config.get("WhatsApp", {})
except Exception as e:
    logger.error(f"Failed to load WhatsApp config: {e}")
    WA_CONFIG = {}

GRAPH_API_VERSION = "v22.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"


class WhatsAppCloudAPI:
    """Wrapper for Meta WhatsApp Cloud API to send lead notifications."""

    def __init__(self, phone_number_id: str = None, access_token: str = None, admin_phone: str = None):
        # Allow callers to supply the phone_number_id from the inbound webhook
        # metadata so replies always originate from the correct bot/business number.
        self.phone_number_id = phone_number_id or WA_CONFIG.get("phone_number_id")
        self.access_token = access_token or WA_CONFIG.get("access_token")
        self.admin_phone = admin_phone or WA_CONFIG.get("admin_phone")

    def _send_message(self, to: str, text: str) -> dict:
        """Send a text message via WhatsApp Cloud API."""
        if not self.phone_number_id or not self.access_token:
            logger.error("[WhatsApp] Missing phone_number_id/access_token. Cannot send message.")
            return {"status": "error", "error": "WhatsApp credentials missing"}
        url = f"{GRAPH_API_BASE}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": to.replace("+", "").replace(" ", ""),
            "type": "text",
            "text": {"body": text},
        }

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=15)
            result = resp.json()
            if resp.status_code in (200, 201):
                logger.info(f"[WhatsApp] Message sent to {to}: {result}")
                return {"status": "success", "response": result}
            else:
                logger.error(f"[WhatsApp] API error {resp.status_code}: {result}")
                return {"status": "error", "error": result}
        except requests.exceptions.RequestException as e:
            logger.error(f"[WhatsApp] Request failed: {e}")
            return {"status": "error", "error": str(e)}

    def send_whatsapp_message(
        self,
        to: str,
        text: str,
        access_token: str = None,
        phone_number_id: str = None,
    ) -> dict:
        if access_token:
            self.access_token = access_token
        if phone_number_id:
            self.phone_number_id = phone_number_id
        return self._send_message(to, text)

    def send_lead_notification(
        self,
        lead_data: dict,
        admin_phone: str = None,
        access_token: str = None,
        phone_number_id: str = None,
    ) -> dict:
        """
        Send a formatted lead notification to the admin WhatsApp number.

        lead_data should contain:
            - name (str)
            - email (str)
            - phone (str)
            - summary (str) — AI-generated conversation summary
            - session_id (str)
        """
        if access_token:
            self.access_token = access_token
        if phone_number_id:
            self.phone_number_id = phone_number_id
        if admin_phone:
            self.admin_phone = admin_phone

        if not all([self.phone_number_id, self.access_token, self.admin_phone]):
            logger.error("[WhatsApp] Missing configuration. Cannot send lead.")
            return {"status": "error", "error": "WhatsApp config incomplete"}

        name = lead_data.get("name", "Unknown")
        email = lead_data.get("email", "Not provided")
        phone = lead_data.get("phone", "Not provided")
        summary = lead_data.get("summary", "No summary available")
        session_id = lead_data.get("session_id", "N/A")

        message = (
            f"🔔 *New Lead Captured — ElevateTrust*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 *Name:* {name}\n"
            f"📧 *Email:* {email}\n"
            f"📱 *Phone:* {phone}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💬 *Conversation Summary:*\n{summary}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Session: {session_id}\n"
        )

        return self._send_message(self.admin_phone, message)


# Singleton instance
whatsapp_api = WhatsAppCloudAPI()

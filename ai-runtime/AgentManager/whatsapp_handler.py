import json
import logging
import os
import time
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

# Typing indicators require Graph API v23.0+ (Meta docs).
GRAPH_API_VERSION = (os.getenv("WHATSAPP_GRAPH_API_VERSION") or "v23.0").strip()
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
_SEND_RETRIES = 3
_SEND_RETRY_DELAY_SEC = 1.5


class WhatsAppCloudAPI:
    """Wrapper for Meta WhatsApp Cloud API to send lead notifications."""

    def __init__(self, phone_number_id: str = None, access_token: str = None, admin_phone: str = None):
        # Allow callers to supply the phone_number_id from the inbound webhook
        # metadata so replies always originate from the correct bot/business number.
        self.phone_number_id = phone_number_id or WA_CONFIG.get("phone_number_id")
        self.access_token = access_token or WA_CONFIG.get("access_token")
        self.admin_phone = admin_phone or WA_CONFIG.get("admin_phone")

    def mark_message_read(self, message_id: str) -> dict:
        """Mark an inbound user message as read (no typing bubble)."""
        if not self.phone_number_id or not self.access_token or not message_id:
            return {"status": "skipped"}
        url = f"{GRAPH_API_BASE}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=8)
            result = resp.json() if resp.text else {}
            if resp.status_code in (200, 201):
                return {"status": "success", "response": result}
            logger.error("[WhatsApp] mark read %s: %s", resp.status_code, result)
            return {"status": "error", "error": result}
        except requests.exceptions.RequestException as e:
            logger.error("[WhatsApp] mark read failed: %s", e)
            return {"status": "error", "error": str(e)}

    def send_typing_indicator(self, to: str = None, message_id: str = None) -> dict:
        """
        Show the typing bubble and mark the user's message as read.
        Requires messages[].id from the inbound webhook (wamid…).
        https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators/
        """
        del to  # recipient inferred from message_id; kept for call-site compatibility
        if not self.phone_number_id or not self.access_token:
            return {"status": "error", "error": "WhatsApp credentials missing"}
        if not message_id:
            logger.debug("[WhatsApp] typing skipped — no inbound message_id")
            return {"status": "skipped", "reason": "message_id required for typing indicator"}

        url = f"{GRAPH_API_BASE}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
            "typing_indicator": {"type": "text"},
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=8)
            result = resp.json() if resp.text else {}
            if resp.status_code in (200, 201):
                logger.info("[WhatsApp] typing indicator sent for message %s", message_id[:24])
                return {"status": "success", "response": result}
            logger.error(
                "[WhatsApp] typing indicator %s (API %s): %s",
                resp.status_code,
                GRAPH_API_VERSION,
                result,
            )
            return {"status": "error", "error": result}
        except requests.exceptions.RequestException as e:
            logger.error("[WhatsApp] typing indicator request failed: %s", e)
            return {"status": "error", "error": str(e)}

    def pause_with_typing(
        self,
        message_id: str | None,
        seconds: float,
        *,
        refresh_interval: float = 18.0,
    ) -> None:
        """Keep typing visible for `seconds` (refreshes before Meta's 25s timeout)."""
        if not message_id or seconds <= 0:
            time.sleep(max(0, seconds))
            return
        self.send_typing_indicator(message_id=message_id)
        remaining = seconds
        while remaining > 0:
            chunk = min(remaining, refresh_interval)
            time.sleep(chunk)
            remaining -= chunk
            if remaining > 0:
                self.send_typing_indicator(message_id=message_id)

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

        import time

        last_error = None
        for attempt in range(1, _SEND_RETRIES + 1):
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=20)
                result = resp.json()
                if resp.status_code in (200, 201):
                    logger.info(f"[WhatsApp] Message sent to {to}: {result}")
                    return {"status": "success", "response": result}
                last_error = result
                err_obj = result.get("error", {}) if isinstance(result, dict) else {}
                err_code = err_obj.get("code")
                err_msg = err_obj.get("message", "")
                logger.error(
                    f"[WhatsApp] API error {resp.status_code} (attempt {attempt}/{_SEND_RETRIES}): {result}"
                )
                if err_code in (190, 102) or "expired" in str(err_msg).lower():
                    return {
                        "status": "error",
                        "error": "WhatsApp access token expired or invalid. Update the token in WhatsApp Channels.",
                        "meta": result,
                    }
                if resp.status_code >= 500 and attempt < _SEND_RETRIES:
                    time.sleep(_SEND_RETRY_DELAY_SEC * attempt)
                    continue
                return {"status": "error", "error": result}
            except requests.exceptions.RequestException as e:
                last_error = str(e)
                logger.error(
                    f"[WhatsApp] Request failed (attempt {attempt}/{_SEND_RETRIES}): {e}"
                )
                if attempt < _SEND_RETRIES:
                    time.sleep(_SEND_RETRY_DELAY_SEC * attempt)
                    continue
        return {"status": "error", "error": last_error}

    def _post_payload(self, to: str, payload: dict) -> dict:
        if not self.phone_number_id or not self.access_token:
            return {"status": "error", "error": "WhatsApp credentials missing"}
        url = f"{GRAPH_API_BASE}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {**payload, "messaging_product": "whatsapp", "to": to.replace("+", "").replace(" ", "")}
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=25)
            result = resp.json()
            if resp.status_code in (200, 201):
                return {"status": "success", "response": result}
            logger.error(f"[WhatsApp] API error {resp.status_code}: {result}")
            return {"status": "error", "error": result}
        except requests.exceptions.RequestException as e:
            logger.error(f"[WhatsApp] Request failed: {e}")
            return {"status": "error", "error": str(e)}

    def send_image_message(self, to: str, image_url: str, caption: str = "") -> dict:
        image_payload = {"link": image_url}
        if caption:
            image_payload["caption"] = caption[:1024]
        return self._post_payload(to, {"type": "image", "image": image_payload})

    @staticmethod
    def _mime_for_path(file_path: str) -> str:
        ext = os.path.splitext(file_path or "")[1].lower()
        mime_map = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        return mime_map.get(ext, "image/jpeg")

    def upload_image_media(self, file_path: str) -> dict:
        """Upload image to Meta once; returns {status, media_id} for reuse across recipients."""
        if not self.phone_number_id or not self.access_token:
            return {"status": "error", "error": "WhatsApp credentials missing"}
        if not file_path or not os.path.isfile(file_path):
            return {"status": "error", "error": f"Image file not found: {file_path}"}

        mime = self._mime_for_path(file_path)
        upload_url = f"{GRAPH_API_BASE}/{self.phone_number_id}/media"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        try:
            with open(file_path, "rb") as img_file:
                resp = requests.post(
                    upload_url,
                    headers=headers,
                    data={"messaging_product": "whatsapp", "type": mime},
                    files={"file": (os.path.basename(file_path), img_file, mime)},
                    timeout=90,
                )
            upload_result = resp.json() if resp.text else {}
            if resp.status_code not in (200, 201):
                logger.error("[WhatsApp] media upload %s: %s", resp.status_code, upload_result)
                return {"status": "error", "error": upload_result}
            media_id = upload_result.get("id")
            if not media_id:
                return {"status": "error", "error": "No media id from upload"}
            return {"status": "success", "media_id": media_id}
        except requests.exceptions.RequestException as e:
            logger.error("[WhatsApp] media upload failed: %s", e)
            return {"status": "error", "error": str(e)}

    def send_image_by_media_id(self, to: str, media_id: str, caption: str = "") -> dict:
        if not media_id:
            return {"status": "error", "error": "media_id required"}
        image_payload = {"id": media_id}
        if caption:
            image_payload["caption"] = caption[:1024]
        return self._post_payload(to, {"type": "image", "image": image_payload})

    def send_image_from_file(self, to: str, file_path: str, caption: str = "") -> dict:
        """
        Upload a local image to Meta, then send by media id.
        Works without a public URL (ngrok) — preferred for welcome images.
        """
        uploaded = self.upload_image_media(file_path)
        if uploaded.get("status") != "success":
            return uploaded
        return self.send_image_by_media_id(to, uploaded["media_id"], caption=caption)

    def send_interactive_list(
        self,
        to: str,
        *,
        header: str,
        body: str,
        button_label: str,
        rows: list,
        section_title: str = "Services",
    ) -> dict:
        section_rows = []
        for row in rows[:10]:
            section_rows.append(
                {
                    "id": str(row.get("id") or "item")[:200],
                    "title": str(row.get("title") or "Option")[:24],
                    "description": str(row.get("description") or "")[:72],
                }
            )
        interactive = {
            "type": "list",
            "header": {"type": "text", "text": header[:60]},
            "body": {"text": body[:1024]},
            "action": {
                "button": button_label[:20],
                "sections": [{"title": (section_title or "Services")[:24], "rows": section_rows}],
            },
        }
        return self._post_payload(to, {"type": "interactive", "interactive": interactive})

    def send_whatsapp_message(
        self,
        to: str,
        text: str,
        access_token: str = None,
        phone_number_id: str = None,
        *,
        inbound_message_id: str | None = None,
        typing_seconds: float = 1.2,
    ) -> dict:
        if access_token:
            self.access_token = access_token
        if phone_number_id:
            self.phone_number_id = phone_number_id
        if inbound_message_id and typing_seconds > 0:
            self.pause_with_typing(inbound_message_id, typing_seconds)
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
            f"🔔 *New Lead Captured — Chattiq*\n"
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

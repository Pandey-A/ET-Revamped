import logging
from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn
from datetime import datetime

class SessionPayload(BaseModel):
    session_id: str

class WhatsAppWebhook:
    def __init__(self):
        self.app = FastAPI()
        self._setup_logging()
        self.session_id = None
        self.setup_routes()

    def _setup_logging(self):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(),
                logging.FileHandler('logs/webhook.log', mode='a')
            ]
        )
        self.logger = logging.getLogger(__name__)

    def setup_routes(self):
        @self.app.post("/set-session-id")
        async def receive_session_id(payload: SessionPayload):
            self.session_id = payload.session_id
            self.logger.info(f"whatsapp_webhook.py: Received session_id via /set-session-id: {self.session_id}")
            return {"status": "success"}

        @self.app.post("/webhook")
        async def receive_message(request: Request):
            # Lazy import to avoid circular import
            from AgentManager import chat_history_handler

            try:
                payload = await request.json()
                self.logger.info(f"whatsapp_webhook.py: Received payload: {payload}")

                # Extract message details
                message_hash = payload.get("hash")
                message_time = payload["data"].get("time")
                phone_number = payload["data"]["from"]
                phone_number = "+" + phone_number.split("@")[0]
                body = payload["data"]["body"]

                # Validate message timestamp
                if message_time:
                    current_time = int(datetime.now().timestamp())
                    if abs(current_time - int(message_time)) > 5:
                        self.logger.info(f"whatsapp_webhook.py: Stale message with timestamp {message_time} from {phone_number}, skipping")
                        return {"status": "received", "message": "Stale message"}

                # Validate message body
                if not body:
                    self.logger.info(f"whatsapp_webhook.py: Empty message body from {phone_number}, skipping")
                    return {"status": "received", "message": "Empty message"}

                # Process messages only from allowed phone number (+918897282373)
                if self.session_id:
                    if phone_number == "+918897282373":
                        # Add [whatsapp] prefix to user message
                        formatted_body = body
                        chat_history_handler.add_whatsapp_message(self.session_id, "user", formatted_body)
                        self.logger.info(f"whatsapp_webhook.py: Added WhatsApp message for session {self.session_id}: {formatted_body}")
                    else:
                        self.logger.info(f"whatsapp_webhook.py: Message from {phone_number} skipped (not +918897282373): {body}")
                    # Log WhatsApp history
                    history = chat_history_handler.get_formatted_whatsapp_history(self.session_id)
                    self.logger.info(f"whatsapp_webhook.py: WhatsApp history for {self.session_id}:\n{history}")
                else:
                    self.logger.warning(f"whatsapp_webhook.py: No session_id set, skipping message from {phone_number}: {body}")

                return {"status": "received"}
            except Exception as e:
                self.logger.error(f"whatsapp_webhook.py: Webhook error: {str(e)}")
                return {"status": "error", "message": str(e)}

    def run(self):
        uvicorn.run(self.app, host="0.0.0.0", port=8081, log_level="info", reload=False)

if __name__ == "__main__":
    webhook = WhatsAppWebhook()
    webhook.run()
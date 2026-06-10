from fastapi import WebSocket
import json
import logging

class UserWebSocketManager:
    def __init__(self):
        self.active_connections = {} 
    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        logging.info(f"[UserWS] Connected: {session_id}")

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            logging.info(f"[UserWS] Disconnected: {session_id}")
            self.active_connections.pop(session_id, None)

    async def send_personal_message(self, session_id: str, message: str, agent_name: str, escalated: bool = False):
        logging.info(f"[UserWS] Trying to send to {session_id}. Active: {list(self.active_connections.keys())}")
        websocket = self.active_connections.get(session_id)

        if websocket:
            try:
                payload = {
                    "session_id": session_id,
                    "agent_name": agent_name,
                    "message": message
                }

                if escalated:
                    payload["escalated"] = True  # only include if true

                await websocket.send_text(json.dumps(payload))
                logging.info(f"[UserWS] Sent message to session {session_id}: {payload}")
            except Exception as e:
                logging.warning(f"[UserWS] Failed to send to {session_id}: {e}")
                self.disconnect(session_id)
        else:
            logging.warning(f"[UserWS] No active connection for session {session_id}")


user_ws_manager = UserWebSocketManager()

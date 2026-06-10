from fastapi import WebSocket
import json
import logging

from managers.user_ws_manager import user_ws_manager

class AgentWebSocketManager:
    def __init__(self):
        self.active_connections = {}  # agent_id -> WebSocket

    async def connect(self, websocket: WebSocket, agent_id: str):
        await websocket.accept()
        self.active_connections[agent_id] = websocket
        logging.info(f"[AgentWS] Connected: {agent_id}")
        logging.info(f"[AgentWS] Active: {list(self.active_connections.keys())}")

    def disconnect(self, agent_id: str):
        if agent_id in self.active_connections:
            logging.info(f"[AgentWS] Disconnected: {agent_id}")
            self.active_connections.pop(agent_id, None)

    async def broadcast(self, message_data: dict):
        text = json.dumps(message_data)
        session_id = message_data.get("session_id")
        message = message_data.get("message")
        agent_name = message_data.get("agent_name", "Agent")

        # First: notify user if needed
        if session_id and message:
            await user_ws_manager.send_personal_message(message, session_id, agent_name)

        # Then: broadcast to agents
        disconnected = []
        for agent_id, ws in self.active_connections.items():
            try:
                await ws.send_text(text)
                logging.info(f"[AgentWS] Broadcasted to {agent_id}")
            except Exception as e:
                logging.warning(f"[AgentWS] Failed to broadcast to {agent_id}: {e}")
                disconnected.append(agent_id)

        for agent_id in disconnected:
            self.disconnect(agent_id)

    async def send_ticket_to_agents(self, ticket: dict):
        text = json.dumps({
            "type": "ticket_escalated",
            "ticket": ticket
        })

        disconnected = []

        for agent_id, ws in self.active_connections.items():
            try:
                logging.info(f"[AgentWS] Sending escalated ticket to {agent_id}")
                await ws.send_text(text)
            except Exception as e:
                logging.warning(f"[AgentWS] Failed to send ticket to {agent_id}: {e}")
                disconnected.append(agent_id)

        for agent_id in disconnected:
            self.disconnect(agent_id)

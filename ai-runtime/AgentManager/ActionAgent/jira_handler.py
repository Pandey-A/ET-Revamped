import json
import os
import logging
from datetime import datetime
from managers.agent_ws_manager import AgentWebSocketManager

try:
    with open("AgentManager/config.json", "r") as file:
        config = json.load(file)
except FileNotFoundError:
    print("Error: config.json not found!")
    config = {}

# File where human dashboard will read from
TICKETS_DB_PATH = "tickets_store.json"

def save_ticket_locally(ticket_data):
    """Append new ticket to local ticket storage."""
    if os.path.exists(TICKETS_DB_PATH):
        with open(TICKETS_DB_PATH, 'r') as f:
            data = json.load(f)
    else:
        data = []

    data.append(ticket_data)

    with open(TICKETS_DB_PATH, 'w') as f:
        json.dump(data, f, indent=2)

    # Real-time notification to admin dashboard
    import asyncio
    agent_ws_manager = AgentWebSocketManager()
    asyncio.create_task(agent_ws_manager.broadcast({
        "type": "ticket_escalated",
        "ticket": ticket_data 
    }))   
import json
import os

TICKET_STORE_PATH = "tickets_store.json"

def get_session_id_for_chat_id(chat_id: str):
    if not os.path.exists(TICKET_STORE_PATH):
        return None
    with open(TICKET_STORE_PATH, "r") as f:
        tickets = json.load(f)
    for ticket in reversed(tickets):
        if ticket.get("chat_id") == str(chat_id):
            return ticket.get("session_id")
    return None

def get_chat_id_for_session(session_id: str):
    if not os.path.exists(TICKET_STORE_PATH):
        return None
    with open(TICKET_STORE_PATH, "r") as f:
        tickets = json.load(f)
    for ticket in reversed(tickets):
        if ticket.get("session_id") == session_id:
            return ticket.get("chat_id")
    return None

def get_bot_token_for_chat_id(chat_id: str):
    if not os.path.exists(TICKET_STORE_PATH):
        return None
    with open(TICKET_STORE_PATH, "r") as f:
        tickets = json.load(f)
    for ticket in reversed(tickets):
        if ticket.get("chat_id") == str(chat_id):
            return ticket.get("bot_token")
    return None

def get_bot_token_for_session(session_id: str):
    if not os.path.exists(TICKET_STORE_PATH):
        return None
    with open(TICKET_STORE_PATH, "r") as f:
        tickets = json.load(f)
    for ticket in reversed(tickets):
        if ticket.get("session_id") == session_id:
            return ticket.get("bot_token")
    return None

def get_session_id_for_bot_token(bot_token: str):
    if not os.path.exists(TICKET_STORE_PATH):
        return None
    with open(TICKET_STORE_PATH, "r") as f:
        tickets = json.load(f)
    for ticket in reversed(tickets):
        if ticket.get("bot_token") == bot_token:
            return ticket.get("session_id")
    return None


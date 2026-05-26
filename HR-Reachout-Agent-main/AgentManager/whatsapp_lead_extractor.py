import os
import json
import logging
from datetime import datetime
import pandas as pd
import requests

from AgentManager import chat_history_handler, llm_handler
from AgentManager.whatsapp_handler import whatsapp_api

logger = logging.getLogger(__name__)

EXCEL_FILE = "WhatsApp_Leads.xlsx"
EXTRACTED_STORE = "whatsapp_extracted_leads.json"
AGENTS_STORE = "Agents_store.json"

def _is_already_extracted(session_id: str) -> bool:
    if not os.path.exists(EXTRACTED_STORE):
        return False
    try:
        with open(EXTRACTED_STORE, "r") as f:
            data = json.load(f)
            return session_id in data
    except Exception:
        return False

def _mark_as_extracted(session_id: str):
    data = []
    if os.path.exists(EXTRACTED_STORE):
        try:
            with open(EXTRACTED_STORE, "r") as f:
                data = json.load(f)
        except Exception:
            pass
    if session_id not in data:
        data.append(session_id)
    with open(EXTRACTED_STORE, "w") as f:
        json.dump(data, f)

def _save_to_excel(lead_data: dict):
    try:
        df_new = pd.DataFrame([lead_data])
        if os.path.exists(EXCEL_FILE):
            # Append to existing
            with pd.ExcelWriter(EXCEL_FILE, engine='openpyxl', mode='a', if_sheet_exists='overlay') as writer:
                # Read existing to get the length so we can append
                existing_df = pd.read_excel(EXCEL_FILE)
                startrow = len(existing_df) + 1
                df_new.to_excel(writer, index=False, header=False, startrow=startrow)
        else:
            # Create new
            df_new.to_excel(EXCEL_FILE, index=False)
        logger.info(f"Saved lead to {EXCEL_FILE}: {lead_data}")
    except Exception as e:
        logger.error(f"Failed to save to Excel: {e}")

def _send_to_webhook(lead_data: dict, agent_id: str):
    if not os.path.exists(AGENTS_STORE):
        return
    try:
        with open(AGENTS_STORE, "r", encoding="utf-8") as f:
            agents = json.load(f)
            
        excel_url = None
        for a in agents:
            if a.get("id") == agent_id:
                excel_url = a.get("excel_url") or a.get("webhook_url")
                break
        
        # If agent_id not found or excel_url not set, try to find a global one or first one with url
        if not excel_url:
            for a in agents:
                url = a.get("excel_url") or a.get("webhook_url")
                if url:
                    excel_url = url
                    break
                    
        if excel_url:
            resp = requests.post(excel_url, json=lead_data, timeout=10)
            logger.info(f"Sent lead to dynamic URL {excel_url}. Status: {resp.status_code}")
        else:
            logger.info("No dynamic excel_url or webhook_url configured in Agents_store.")
    except Exception as e:
        logger.error(f"Failed to send lead to webhook: {e}")

def extract_and_save_lead(
    session_id: str,
    phone: str,
    agent_id: str = None,
    admin_phone: str = None,
    access_token: str = None,
    phone_number_id: str = None,
):
    """
    Checks if Name and Email are present in the chat history.
    If so, extracts them, summarizes chat, saves to Excel, and pushes to Webhook.
    """
    if _is_already_extracted(session_id):
        return

    chat_history = chat_history_handler.get_formatted_history(session_id)
    if not chat_history or len(chat_history.strip()) < 20:
        return

    try:
        # Get central Bedrock LLM from llm_handler
        llm = llm_handler.get_llm()
        
        prompt = (
            "Analyze the following conversation history.\n"
            "Extract the user's name and email if both have been explicitly provided by the user.\n"
            "If BOTH name and email are present, generate a 3-4 bullet point summary of the user's needs or questions.\n"
            "If either name or email is missing, return status as 'incomplete'.\n\n"
            "RESPOND STRICTLY IN JSON FORMAT ONLY (no markdown blocks, just raw JSON):\n"
            "{\n"
            '  "status": "complete" or "incomplete",\n'
            '  "name": "extracted name",\n'
            '  "email": "extracted email",\n'
            '  "summary": "bullet point summary..."\n'
            "}\n\n"
            f"Conversation History:\n{chat_history}"
        )
        
        resp = llm.complete(prompt)
        content = resp.text.strip()
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("```"):
            content = content[3:-3].strip()
            
        data = json.loads(content)
        
        if data.get("status") == "complete" and data.get("name") and data.get("email"):
            # Prepare payload
            lead_data = {
                "Timestamp": datetime.utcnow().isoformat(),
                "Session_ID": session_id,
                "Phone": phone,
                "Name": data.get("name"),
                "Email": data.get("email"),
                "Summary": data.get("summary")
            }
            
            # Save and Send
            _save_to_excel(lead_data)
            _send_to_webhook(lead_data, agent_id)
            whatsapp_api.send_lead_notification(
                {
                    "name": data.get("name"),
                    "email": data.get("email"),
                    "phone": phone,
                    "summary": data.get("summary"),
                    "session_id": session_id,
                },
                admin_phone=admin_phone,
                access_token=access_token,
                phone_number_id=phone_number_id,
            )
            
            # Mark as done
            _mark_as_extracted(session_id)
            
    except Exception as e:
        logger.error(f"Error during WhatsApp lead extraction: {e}")

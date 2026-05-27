import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

import uuid
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
from fastapi import Body
import traceback
from pydantic import BaseModel
import uvicorn
import asyncio
import logging
import json
from datetime import datetime
from typing import List, Optional, Any, Dict
from fastapi import UploadFile, File, Form, APIRouter
from fastapi.staticfiles import StaticFiles
import os
import re
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from managers.user_ws_manager import UserWebSocketManager
from managers.agent_ws_manager import AgentWebSocketManager

from AgentManager import query_handler, chat_history_handler
from AgentManager.KnowledgeManagerAgent.resources import WebPageIndexer, PDFIndexer
from .models import ChatRequest, AnalyzeAction

from .routes.livekit_token import router as livekit_router

from AgentManager.telegram.chat_session_mapping import (
    get_session_id_for_chat_id,
    get_chat_id_for_session,
    get_bot_token_for_chat_id,
    get_bot_token_for_session,
    get_session_id_for_bot_token
)
from AgentManager.telegram.sender import TelegramSender
from AgentManager.whatsapp_handler import whatsapp_api, WhatsAppCloudAPI
from AgentManager.whatsapp_lead_extractor import extract_and_save_lead
from AgentManager import widget_session_manager as wsm

TICKETS_DB = "tickets_store.json"
AGENTS_DB = "Agents_store.json"
LEADS_DB = "leads_store.json"
WHATSAPP_CHANNELS_COLLECTION = "whatsapp_channels"
DEFAULT_MONGO_URI = "mongodb+srv://admin:admin1926@cluster0.86fzwx8.mongodb.net/deepfake_et?retryWrites=true&w=majority&appName=Cluster0"

# ─── Indexing Status Tracker ──────────────────────────────────────────────────
# Tracks background indexing tasks so frontend can poll for completion
indexing_tasks = {}  # task_id -> {"status": "processing"|"success"|"error", "message": str}

app = FastAPI()

# Absolute path to `temp_files` at root level
temp_files_path = os.path.abspath(os.path.join(os.getcwd(), "./temp_files"))
app.mount("/files", StaticFiles(directory=temp_files_path), name="files")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app.include_router(livekit_router, prefix="/chat")

user_ws_manager = UserWebSocketManager()
agent_ws_manager = AgentWebSocketManager()

with open("AgentManager/config.json") as f:
    config = json.load(f)

mongo_client: Optional[AsyncIOMotorClient] = None
mongo_db = None


def _load_mongo_uri() -> str:
    return (
        os.getenv("MONGO_URI")
        or config.get("MongoDB", {}).get("uri")
        or DEFAULT_MONGO_URI
    )


def _serialize_channel(doc: Dict[str, Any]) -> Dict[str, Any]:
    serialized = dict(doc)
    serialized["_id"] = str(serialized.get("_id"))
    return serialized


def _parse_object_id(id_str: str) -> ObjectId:
    if not ObjectId.is_valid(id_str):
        raise HTTPException(status_code=400, detail="Invalid channel id")
    return ObjectId(id_str)


def _normalize_whatsapp_business_account_id(val: Any) -> str:
    """Digits-only WABA id (Meta); tolerates spaces/dashes in pasted UI values."""
    if val is None:
        return ""
    s = str(val).strip()
    digits = re.sub(r"\D", "", s)
    return digits if len(digits) >= 8 else s


def _normalize_whatsapp_phone_number_id(val: Any) -> str:
    """Digits-only phone number id from Meta; tolerates pasted labels/spaces."""
    if val is None:
        return ""
    s = str(val).strip()
    digits = re.sub(r"\D", "", s)
    return digits if len(digits) >= 8 else s


async def _resolve_whatsapp_channel(waba_id: Any, phone_number_id: Any) -> Optional[Dict[str, Any]]:
    """
    Find Mongo channel row for this inbound webhook.
    Tries normalized ids, then raw stripped strings, then phone_number_id only (wrong WABA in UI).
    """
    if mongo_db is None:
        return None

    w_norm = _normalize_whatsapp_business_account_id(waba_id)
    p_norm = _normalize_whatsapp_phone_number_id(phone_number_id)
    w_raw = str(waba_id).strip() if waba_id is not None else ""
    p_raw = str(phone_number_id).strip() if phone_number_id is not None else ""

    if not p_norm and not p_raw:
        return None

    coll = mongo_db[WHATSAPP_CHANNELS_COLLECTION]

    if w_norm and p_norm:
        doc = await coll.find_one(
            {"whatsapp_business_account_id": w_norm, "phone_number_id": p_norm}
        )
        if doc:
            return doc

    if w_raw and p_raw:
        doc = await coll.find_one(
            {"whatsapp_business_account_id": w_raw, "phone_number_id": p_raw}
        )
        if doc:
            return doc

    # Legacy rows: phone_number_id pasted with spaces
    if w_norm and p_norm:
        ws_rx = re.compile(r"^\s*" + re.escape(p_norm) + r"\s*$")
        doc = await coll.find_one(
            {
                "whatsapp_business_account_id": w_norm,
                "phone_number_id": {"$regex": ws_rx},
            }
        )
        if doc:
            return doc

    # Wrong WABA pasted in dashboard is common; phone_number_id is unique per number.
    if p_norm:
        matches = await coll.find({"phone_number_id": p_norm}).to_list(length=5)
        if len(matches) == 1:
            logging.warning(
                "[WhatsApp] Matched channel by phone_number_id only (check WABA id in dashboard). "
                f"webhook_waba={waba_id!r} stored_waba={matches[0].get('whatsapp_business_account_id')!r}"
            )
            return matches[0]
        if len(matches) > 1:
            logging.error(
                f"[WhatsApp] Multiple channels share phone_number_id={p_norm}; cannot disambiguate."
            )

    if p_raw and p_raw != p_norm:
        matches = await coll.find({"phone_number_id": p_raw}).to_list(length=5)
        if len(matches) == 1:
            logging.warning(
                "[WhatsApp] Matched channel by raw phone_number_id only. "
                f"webhook_waba={waba_id!r} stored_waba={matches[0].get('whatsapp_business_account_id')!r}"
            )
            return matches[0]

    return None


def _send_whatsapp_auto_reply(channel_config: Dict[str, Any], customer_phone: str, text_body: str) -> None:
    """Sync helper for BackgroundTasks (non-text hints, etc.)."""
    try:
        from AgentManager.whatsapp_handler import WhatsAppCloudAPI

        api = WhatsAppCloudAPI(
            phone_number_id=channel_config.get("phone_number_id"),
            access_token=channel_config.get("access_token"),
            admin_phone=channel_config.get("admin_phone"),
        )
        to = "+" + str(customer_phone).replace("+", "").replace(" ", "")
        api.send_whatsapp_message(to, text_body)
    except Exception as e:
        logging.error(f"[WhatsApp] Auto-reply send failed: {e}")


def _is_greeting_message(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    greeting_keywords = (
        "hi",
        "hello",
        "hey",
        "hii",
        "hola",
        "good morning",
        "good afternoon",
        "good evening",
    )
    return any(t.startswith(g) for g in greeting_keywords)


def _should_prefix_greeting(session_id: str, user_text: str) -> bool:
    """
    Prefix greeting whenever the user sends a greeting-like message.
    """
    return _is_greeting_message(user_text)


def _get_agent_config(agent_id: str) -> Dict[str, Any]:
    if not agent_id or not os.path.exists(AGENTS_DB):
        return {}
    try:
        with open(AGENTS_DB, "r", encoding="utf-8") as f:
            agents = json.load(f)
        for agent in agents:
            if agent.get("id") == agent_id:
                return agent
    except Exception as e:
        logging.warning(f"Failed to load agent config for {agent_id}: {e}")
    return {}


class WhatsAppChannelCreate(BaseModel):
    whatsapp_business_account_id: str
    phone_number_id: str
    display_phone_number: Optional[str] = ""
    access_token: str
    ai_agent_id: str
    ai_agent_name: Optional[str] = ""
    admin_phone: Optional[str] = ""


class WhatsAppChannelUpdate(BaseModel):
    whatsapp_business_account_id: Optional[str] = None
    phone_number_id: Optional[str] = None
    display_phone_number: Optional[str] = None
    access_token: Optional[str] = None
    ai_agent_id: Optional[str] = None
    ai_agent_name: Optional[str] = None
    admin_phone: Optional[str] = None

# TELEGRAM MODELS & HELPERS
class TelegramUpdate(BaseModel):
    message: dict

@app.post("/chat/session")
async def create_or_get_session():
    session_id = f"session_{datetime.utcnow().date()}_{uuid.uuid4()}"
    return {"session_id": session_id}


# ─── WhatsApp Webhook ─────────────────────────────────────────────────────────

@app.get("/webhook/whatsapp")
async def verify_whatsapp_webhook(request: Request):
    """Verify webhook from Meta"""
    hub_mode = request.query_params.get("hub.mode")
    hub_verify_token = request.query_params.get("hub.verify_token")
    hub_challenge = request.query_params.get("hub.challenge")

    VERIFY_TOKEN = "12345"

    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return int(hub_challenge)
    return JSONResponse(status_code=403, content={"error": "Verification failed"})


async def async_process_whatsapp(
    session_id: str,
    phone: str,
    text: str,
    waba_id: str = None,
    phone_number_id: str = None,
    display_phone_number: str = None,
):
    try:
        if mongo_db is None:
            logging.error("[WhatsApp] MongoDB is not configured. Cannot process incoming message.")
            return

        logging.info(
            f"[WhatsApp] Incoming message | WABA ID: {waba_id} | "
            f"Bot phone_number_id: {phone_number_id} | "
            f"Bot display number: {display_phone_number} | "
            f"From: {phone} | Text: {text}"
        )
        chat_history_handler.add_message(session_id, "user", text)

        channel_config = await _resolve_whatsapp_channel(waba_id, phone_number_id)
        if not channel_config:
            logging.warning(
                f"[WhatsApp] No channel mapping found for WABA={waba_id}, phone_number_id={phone_number_id}"
            )
            return

        agent_id = channel_config.get("ai_agent_id")
        access_token = channel_config.get("access_token")
        admin_phone = channel_config.get("admin_phone")
        mapped_phone_number_id = channel_config.get("phone_number_id") or phone_number_id

        if not agent_id:
            logging.warning(
                f"[WhatsApp] Channel mapping {_serialize_channel(channel_config).get('_id')} missing ai_agent_id"
            )
            return

        response_gen = await query_handler.aprocess_query(text, session_id, agent_id)

        full_response = ""
        async for chunk in response_gen:
            if chunk:
                full_response += chunk

        if not full_response.strip():
            full_response = (
                "Sorry, I couldn't generate a reply just now. Please try again in a moment, "
                "or rephrase your question."
            )

        if full_response:
            agent_config = _get_agent_config(agent_id)
            greeting_message = (agent_config.get("greeting_message") or "").strip()
            if greeting_message and _should_prefix_greeting(session_id, text):
                full_response = f"{greeting_message}\n\n{full_response}"

            chat_history_handler.add_message(session_id, "assistant", full_response)
            from AgentManager.whatsapp_handler import WhatsAppCloudAPI

            dynamic_api = WhatsAppCloudAPI(
                phone_number_id=mapped_phone_number_id,
                access_token=access_token,
                admin_phone=admin_phone,
            )
            dynamic_api.send_whatsapp_message("+" + phone.replace("+", ""), full_response)

            extract_and_save_lead(
                session_id,
                phone,
                agent_id,
                admin_phone=admin_phone,
                access_token=access_token,
                phone_number_id=mapped_phone_number_id,
            )

    except Exception as e:
        logging.error(f"Failed in async_process_whatsapp: {e}")


@app.post("/webhook/whatsapp")
async def receive_whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        if mongo_db is None:
            return JSONResponse(status_code=500, content={"error": "MongoDB is not configured"})

        data = await request.json()

        if "entry" in data:
            for entry in data["entry"]:
                # WABA ID — identifies which Meta Business Account owns this bot
                waba_id = entry.get("id")

                for change in entry.get("changes", []):
                    value = change.get("value", {})

                    # Metadata block identifies the specific bot (phone number) that
                    # received the message. This is present even before "messages" is.
                    metadata = value.get("metadata", {})
                    phone_number_id = metadata.get("phone_number_id")
                    display_phone_number = metadata.get("display_phone_number")

                    logging.info(
                        f"[WhatsApp Webhook] WABA ID: {waba_id} | "
                        f"Bot phone_number_id: {phone_number_id} | "
                        f"Bot display number: {display_phone_number}"
                    )

                    channel_config = await _resolve_whatsapp_channel(waba_id, phone_number_id)
                    if not channel_config:
                        logging.warning(
                            f"[WhatsApp Webhook] No mapping for WABA={waba_id}, phone_number_id={phone_number_id}"
                        )
                        continue

                    if "messages" in value:
                        for msg in value["messages"]:
                            phone = msg.get("from")
                            if not phone:
                                continue
                            if msg.get("type") == "text":
                                text = msg["text"]["body"]
                                # Include WABA ID and bot phone_number_id in the session
                                # so different bots/accounts produce distinct sessions.
                                session_id = f"whatsapp_{waba_id}_{phone_number_id}_{phone}"

                                background_tasks.add_task(
                                    async_process_whatsapp,
                                    session_id,
                                    phone,
                                    text,
                                    waba_id,
                                    phone_number_id,
                                    display_phone_number,
                                )
                            else:
                                msg_type = msg.get("type") or "unknown"
                                hint = (
                                    "Thanks for your message. I can only read text messages right now. "
                                    "Please type your question as a plain text message."
                                )
                                background_tasks.add_task(
                                    _send_whatsapp_auto_reply,
                                    dict(channel_config),
                                    phone,
                                    hint,
                                )
                                logging.info(
                                    f"[WhatsApp Webhook] Non-text inbound type={msg_type} from={phone}; queued hint reply."
                                )

        return {"status": "success"}
    except Exception as e:
        logging.error(f"WhatsApp webhook error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


# ─── Lead Capture ─────────────────────────────────────────────────────────────

@app.post("/leads/capture")
async def capture_lead(request: Request):
    """
    Capture a lead from the floating chat widget.
    Expects JSON with: session_id, name, email, phone
    Generates a conversation summary and sends it to WhatsApp.
    """
    try:
        data = await request.json()
        session_id = data.get("session_id")
        name = data.get("name", "Unknown")
        email = data.get("email", "Not provided")
        phone = data.get("phone", "Not provided")

        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")

        # Generate conversation summary from chat history
        try:
            chat_history = chat_history_handler.get_formatted_history(session_id)
            if chat_history and chat_history.strip():
                # Use Bedrock via llm_handler
                from AgentManager import llm_handler
                summary_llm = llm_handler.get_llm()
                summary_prompt = (
                    f"Summarize this customer conversation in 3-4 bullet points. "
                    f"Focus on what the user was interested in and any key details:\n\n{chat_history}"
                )
                summary_resp = summary_llm.complete(summary_prompt)
                summary = summary_resp.text.strip()
            else:
                summary = "No conversation history available."
        except Exception as e:
            logging.error(f"Failed to generate summary: {e}")
            summary = "Summary generation failed."

        # Build lead data
        lead_data = {
            "session_id": session_id,
            "name": name,
            "email": email,
            "phone": phone,
            "summary": summary,
            "captured_at": datetime.utcnow().isoformat(),
            "whatsapp_sent": False,
        }

        # Save to leads_store.json
        try:
            if os.path.exists(LEADS_DB):
                with open(LEADS_DB, "r") as f:
                    leads = json.load(f)
            else:
                leads = []

            leads.append(lead_data)
            with open(LEADS_DB, "w") as f:
                json.dump(leads, f, indent=2)
        except Exception as e:
            logging.error(f"Failed to save lead: {e}")

        # Disabled by product requirement:
        # never send chat summaries to any WhatsApp number.
        lead_data["whatsapp_sent"] = False

        # Update the saved record with whatsapp status
        try:
            with open(LEADS_DB, "r") as f:
                leads = json.load(f)
            for ld in reversed(leads):
                if ld["session_id"] == session_id:
                    ld["whatsapp_sent"] = lead_data["whatsapp_sent"]
                    break
            with open(LEADS_DB, "w") as f:
                json.dump(leads, f, indent=2)
        except Exception:
            pass

        logging.info(f"[LeadCapture] Lead saved for session {session_id}: {name} / {email} / {phone}")
        return {
            "status": "captured",
            "whatsapp_sent": lead_data["whatsapp_sent"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[LeadCapture] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/leads")
async def get_leads():
    """Return all captured leads."""
    try:
        if os.path.exists(LEADS_DB):
            with open(LEADS_DB, "r") as f:
                return json.load(f)
        return []
    except Exception as e:
        logging.error(f"Failed to load leads: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

def auto_bind_chat_id(bot_token: str, chat_id: str) -> str | None:
    with open(TICKETS_DB, "r+") as f:
        tickets = json.load(f)

        # Prefer most-recent unbound telegram ticket so new sessions can take over.
        for ticket in reversed(tickets):
            if (
                ticket.get("escalation_channel") == "telegram"
                and ticket.get("bot_token") == bot_token
                and ticket.get("chat_id") is None
                and ticket.get("awaiting_human_response", False)
            ):
                print("Inside auto bind function")
                ticket["chat_id"] = chat_id
                session_id = ticket["session_id"]
                f.seek(0)
                json.dump(tickets, f, indent=2)
                print("Json dumped successfully")
                f.truncate()
                logging.info(f"[Auto-BIND] Bound chat_id {chat_id} to session {session_id}")
                return session_id
    return None

def get_latest_active_session_for_chat(chat_id: str, bot_token: str | None = None) -> str | None:
    if not os.path.exists(TICKETS_DB):
        return None

    with open(TICKETS_DB, "r") as f:
        tickets = json.load(f)

    # Pick the newest active ticket for this chat_id.
    for ticket in reversed(tickets):
        if str(ticket.get("chat_id")) != str(chat_id):
            continue
        if bot_token and ticket.get("bot_token") != bot_token:
            continue
        if not ticket.get("awaiting_human_response", False):
            continue
        return ticket.get("session_id")

    # Fallback: newest ticket for chat_id even if awaiting flag is absent.
    for ticket in reversed(tickets):
        if str(ticket.get("chat_id")) == str(chat_id):
            if bot_token and ticket.get("bot_token") != bot_token:
                continue
            return ticket.get("session_id")

    return None

@app.post("/telegram-webhook/{bot_token}")
async def telegram_webhook(bot_token: str, update: TelegramUpdate):
    try:
        msg = update.message
        chat_id = str(msg["chat"]["id"])
        user_text = msg.get("text")
        logging.info(f"chat_id :{chat_id} user text : {user_text}")

        if not user_text:
            return {"status": "ignored", "reason": "No text"}

        # First bind to latest pending unbound ticket for this bot (new-session friendly).
        # Then prefer latest active mapped session for this chat_id.
        # Final fallback keeps backward compatibility with older mapping behavior.
        session_id = (
            auto_bind_chat_id(bot_token, chat_id)
            or get_latest_active_session_for_chat(chat_id, bot_token)
            or get_session_id_for_chat_id(chat_id)
        )
        logging.info(f"session_id : {session_id}")
        if not session_id:
            return {"status": "error", "message": "No active session associated"}

        # change: 1
        chat_history_handler.add_message(session_id, "user", user_text)
        # change: 2
        print("--- Telegram Webhook ---")
        print("Session ID:", session_id)
        print("User Text:", user_text)
        await user_ws_manager.send_personal_message(
            session_id = session_id,
            message=user_text,
            agent_name= "human agent")

        return {"status": "received", "session_id": session_id}

    except Exception as e:
        logging.error(f"Telegram Webhook Error: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.post("/reply")
async def reply_to_user(payload: dict):
    session_id = payload.get("session_id")
    message = payload.get("message")
    if not session_id or not message:
        return {"status": "error", "message": "Missing session_id or message"}

    chat_id = get_chat_id_for_session(session_id)
    bot_token = get_bot_token_for_chat_id(chat_id) if chat_id else None
    if not chat_id or not bot_token:
        return {"status": "error", "message": "Chat ID or Bot Token not found"}

    send_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = requests.post(send_url, json={"chat_id": chat_id, "text": message})

    return {"status": "sent" if resp.status_code == 200 else "error", "response": resp.json()}



class HumanReply(BaseModel):
    session_id: str
    message: str
    agent_name: str

class IndexUrlRequest(BaseModel):
    url: str
    collection_name: str
    agent_id: str

class IndexPDFRequest(BaseModel):
    pdf_url: str
    collection_name: str


async def agent_response_generator(user_input: str, session_id: str, agent_id: str):
    try:
        print("i am received here agent id from user 1", agent_id)
        response_gen = await query_handler.aprocess_query(user_input, session_id, agent_id)
        full_response = ""

        async for chunk in response_gen:
            if chunk:
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk})}\n\n"
                await asyncio.sleep(0.01)

        chat_history_handler.add_message(session_id, "user", user_input)
        if full_response:
            chat_history_handler.add_message(session_id, "assistant", full_response)
            logging.info(f"Response Generated: {full_response}")
        else:
            yield "An error occurred. Please try again."
    except Exception as e:
        logging.error(f"Error during response generation: {e}")
        yield "An internal error occurred."


async def agent_response_generator_chat(user_input: str, session_id: str, agent_id: str):
    try:
        print("i am received here agent id from user 2", agent_id)
        agent_cfg = _get_agent_config(agent_id) if agent_id else {}
        wsm.upsert_session(
            session_id,
            agent_id or "",
            agent_cfg.get("name", ""),
            channel=wsm.channel_for_session(session_id),
        )
        response_gen = await query_handler.aprocess_query(user_input, session_id, agent_id)
        full_response = ""

        async for chunk in response_gen:
            if chunk:
                full_response += chunk
                yield chunk

        chat_history_handler.add_message(session_id, "user", user_input)
        if full_response:
            chat_history_handler.add_message(session_id, "assistant", full_response)
            logging.info(f"Response Generated: {full_response}")
            wsm.touch_activity(session_id, increment_messages=2)
        else:
            logging.info("Some Error has occurred. Unexpected Response")
            yield "Some Error has occurred. Please try once again"
    except Exception as e:
        print(f"Error: {e}")
        yield "An error occurred. Please try again."


def is_escalated(session_id: str) -> bool:
    with open(TICKETS_DB, "r") as f:
        tickets = json.load(f)
    return any(t["session_id"] == session_id for t in tickets)

@app.post("/chat/stream/{stream_type}")
async def stream_agent_response(stream_type: str, request: Request):
    body = await request.json()
    print("body: ", body)
    user_input = body.get("user_input")
    session_id = body.get("session_id")
    agent_id = body.get("agent_id")
    logging.info(f"Received {stream_type} request for agent response {user_input} in session {session_id } request from agent {agent_id}")

    if stream_type == "voice":
        return StreamingResponse(
            agent_response_generator(user_input, session_id, agent_id),
            media_type="text/plain"
        )
    elif stream_type == "chat":
        return StreamingResponse(
            agent_response_generator_chat(user_input, session_id, agent_id),
            media_type="text/event-stream" 
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid stream type. Use 'chat' or 'voice'.")

@app.get("/agents")
async def get_all_agents():
    """Return all agents from the Agents_store.json file."""
    try:
        if os.path.exists(AGENTS_DB):
            with open(AGENTS_DB, "r", encoding="utf-8") as f:
                agents = json.load(f)
            return agents
        return []
    except Exception as e:
        logging.error(f"Failed to load agents: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/whatsapp/config")
async def create_whatsapp_channel(payload: WhatsAppChannelCreate):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="MongoDB is not configured")
    now = datetime.utcnow().isoformat()
    waba = _normalize_whatsapp_business_account_id(payload.whatsapp_business_account_id)
    phone_id = _normalize_whatsapp_phone_number_id(payload.phone_number_id)
    doc = {
        "whatsapp_business_account_id": waba,
        "phone_number_id": phone_id,
        "display_phone_number": (payload.display_phone_number or "").strip(),
        "access_token": payload.access_token.strip(),
        "ai_agent_id": payload.ai_agent_id.strip(),
        "ai_agent_name": (payload.ai_agent_name or "").strip(),
        "admin_phone": (payload.admin_phone or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    existing = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({
        "whatsapp_business_account_id": doc["whatsapp_business_account_id"],
        "phone_number_id": doc["phone_number_id"],
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A channel with this WhatsApp Business Account ID and Phone Number ID already exists",
        )
    result = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].insert_one(doc)
    created = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({"_id": result.inserted_id})
    return _serialize_channel(created)


@app.get("/whatsapp/config")
async def list_whatsapp_channels():
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="MongoDB is not configured")
    docs = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find({}).sort("created_at", -1).to_list(length=1000)
    return [_serialize_channel(d) for d in docs]


@app.put("/whatsapp/config/{id}")
async def update_whatsapp_channel(id: str, payload: WhatsAppChannelUpdate):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="MongoDB is not configured")
    object_id = _parse_object_id(id)
    update_data = payload.dict(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    cleaned_updates = {}
    for key, value in update_data.items():
        if isinstance(value, str):
            cleaned_updates[key] = value.strip()
        else:
            cleaned_updates[key] = value
    if "whatsapp_business_account_id" in cleaned_updates:
        cleaned_updates["whatsapp_business_account_id"] = _normalize_whatsapp_business_account_id(
            cleaned_updates["whatsapp_business_account_id"]
        )
    if "phone_number_id" in cleaned_updates:
        cleaned_updates["phone_number_id"] = _normalize_whatsapp_phone_number_id(
            cleaned_updates["phone_number_id"]
        )
    cleaned_updates["updated_at"] = datetime.utcnow().isoformat()

    if "whatsapp_business_account_id" in cleaned_updates or "phone_number_id" in cleaned_updates:
        current = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({"_id": object_id})
        if not current:
            raise HTTPException(status_code=404, detail="Channel not found")
        check_waba = cleaned_updates.get("whatsapp_business_account_id", current.get("whatsapp_business_account_id"))
        check_phone_number_id = cleaned_updates.get("phone_number_id", current.get("phone_number_id"))
        duplicate = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({
            "_id": {"$ne": object_id},
            "whatsapp_business_account_id": check_waba,
            "phone_number_id": check_phone_number_id,
        })
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail="Another channel already uses this WhatsApp Business Account ID and Phone Number ID",
            )

    result = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": cleaned_updates},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Channel not found")
    updated = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({"_id": object_id})
    return _serialize_channel(updated)


@app.delete("/whatsapp/config/{id}")
async def delete_whatsapp_channel(id: str):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="MongoDB is not configured")
    object_id = _parse_object_id(id)
    result = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].delete_one({"_id": object_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"status": "deleted", "id": id}


@app.post("/store/agents")
async def upload_agent_data(request: Request):
    try:
        agent_data = await request.json()

        print("agent_data", agent_data)
        AGENTS_DB = "Agents_store.json"

        if os.path.exists(AGENTS_DB):
            try:
                with open(AGENTS_DB, "r") as file:
                    existing_data = json.load(file)
            except json.JSONDecodeError as e:
                existing_data = []
        else:
            existing_data = []

        agent_ids = [agent.get("id") for agent in existing_data]

        if agent_data.get("id") in agent_ids:
            return {"message": "Agent with this ID already exists. Skipped saving."}

        existing_data.append(agent_data)

        with open(AGENTS_DB, "w") as file:
            json.dump(existing_data, file, indent=4)

        return {"message": "Agent saved successfully"}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(content={"error": str(e)}, status_code=500)

# ─── Background indexing helpers ──────────────────────────────────────────────
def _update_agent_resource(agent_id: str, resource_path: str):
    """Update Agents_store.json with a new resource entry."""
    try:
        if os.path.exists(AGENTS_DB):
            with open(AGENTS_DB, "r", encoding="utf-8") as f:
                agents = json.load(f)
        else:
            agents = []

        for agent in agents:
            if agent["id"] == agent_id:
                merged_name = f"{agent['name']}_{agent['id']}"
                agent["collection_name"] = merged_name

                if "resource_list" in agent:
                    if isinstance(agent["resource_list"], list):
                        agent["resource_list"].append(resource_path)
                    else:
                        agent["resource_list"] = [agent["resource_list"], resource_path]
                else:
                    agent["resource_list"] = [resource_path]

                with open(AGENTS_DB, "w", encoding="utf-8") as f:
                    json.dump(agents, f, indent=4, ensure_ascii=False)
                logging.info(f"✅ Resource saved for bot ID: {agent_id}")
                return True

        logging.warning(f"⚠️ Bot with ID {agent_id} not found in {AGENTS_DB}")
        return False
    except Exception as e:
        logging.error(f"Failed to update agent resource: {e}")
        return False


def _bg_index_url(task_id: str, url: str, collection_name: str):
    """Background task: index a URL into Weaviate."""
    try:
        indexing_tasks[task_id] = {"status": "processing", "message": "Connecting to Weaviate and indexing URL..."}
        WebPageIndexer().index_url_to_qdrant(url, collection_name)
        indexing_tasks[task_id] = {"status": "success", "message": "URL indexed successfully."}
    except Exception as e:
        logging.error(f"Background URL indexing failed: {e}")
        indexing_tasks[task_id] = {"status": "error", "message": str(e)}


def _bg_index_pdf(task_id: str, file_path: str, collection_name: str):
    """Background task: index a PDF into Weaviate."""
    try:
        indexing_tasks[task_id] = {"status": "processing", "message": "Extracting text and creating embeddings..."}
        indexer = PDFIndexer()
        indexer.index_pdf_url_to_qdrant(file_path, collection_name)
        indexing_tasks[task_id] = {"status": "success", "message": "PDF indexed successfully."}
    except Exception as e:
        logging.error(f"Background PDF indexing failed: {e}")
        indexing_tasks[task_id] = {"status": "error", "message": str(e)}


@app.get("/index/status/{task_id}")
async def get_indexing_status(task_id: str):
    """Poll endpoint for checking background indexing status."""
    task = indexing_tasks.get(task_id)
    if not task:
        return {"status": "not_found", "message": "Task not found"}
    return task


@app.post("/index/url")
async def index_url_to_qdrant_endpoint(request: IndexUrlRequest, background_tasks: BackgroundTasks):
    try:
        logging.info(f"📥 Full request: {request.dict()}")

        # Update agent store immediately
        _update_agent_resource(request.agent_id, request.url)

        # Start background indexing
        task_id = f"url_{uuid.uuid4().hex[:12]}"
        indexing_tasks[task_id] = {"status": "processing", "message": "Starting URL indexing..."}
        background_tasks.add_task(_bg_index_url, task_id, request.url, request.collection_name)

        return {
            "status": "accepted",
            "message": "URL upload accepted. Indexing started in background.",
            "task_id": task_id,
            "resource_added_for": request.agent_id
        }

    except Exception as e:
        logging.error(f"Failed to index URL: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})



@app.post("/index/pdf")
async def index_file_to_qdrant(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    collection_name: str = Form(...),
    agent_id: str = Form(...)
):
    try:
        # Step 1: Create temp_files directory & save file
        temp_dir = os.path.join(os.getcwd(), "temp_files")
        os.makedirs(temp_dir, exist_ok=True)

        file_path = os.path.join(temp_dir, file.filename)
        with open(file_path, "wb") as f:
            file_data = await file.read()
            f.write(file_data)

        # Step 2: Update agent store immediately (so UI shows resource right away)
        resource_path = f"temp_files/{file.filename}"
        _update_agent_resource(agent_id, resource_path)

        # Step 3: Start background indexing (Weaviate + embeddings)
        task_id = f"pdf_{uuid.uuid4().hex[:12]}"
        indexing_tasks[task_id] = {"status": "processing", "message": "File saved. Starting indexing..."}
        background_tasks.add_task(_bg_index_pdf, task_id, file_path, collection_name)

        return {
            "status": "accepted",
            "message": "File uploaded. Indexing started in background.",
            "task_id": task_id,
            "resource_added_for": agent_id
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})



@app.post("/chat/analyze_action")
async def stream_agent_response(request: AnalyzeAction):
    
    user_input = request.user_input
    assistant_response = request.assistant_response
    session_id = request.session_id
    agent_id = request.agent_id
    logging.info(f"Received request for analyzing action for session {session_id}")
    logging.info(f"[AnalyzeAction] HIT: {session_id} | User: {user_input[:20]} | Assistant: {assistant_response[:20]}")
    
    task = await query_handler.post_process_query(  
        user_query=user_input, 
        assistant_response=assistant_response, 
        session_id=session_id,
        agent_id=agent_id
    )

    if not task or task.get("status") != "success":
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": task.get("error", "Post-processing failed")}
        )

    logging.info(f"task : {task}")
    if task.get("escalated"):
        try:
            logging.info("Escalation flag detected. Creating ticket...")
            with open(TICKETS_DB, "r") as f:
                tickets = json.load(f)
        except FileNotFoundError:
            tickets = []

        existing_ticket = next((t for t in tickets if t["session_id"] == session_id), None)

        if existing_ticket:
            await agent_ws_manager.send_ticket_to_agents(existing_ticket)
            await user_ws_manager.send_personal_message(session_id=session_id , message="", agent_name="system", escalated=True )
            logging.info("Existing TICKET ESCALATED message SENT to AGENT") 
        else:
            logging.error(f"[CRITICAL] Escalation was triggered, but ticket not found for session {session_id}. Possible bug.")

    response_data = {
        "status": "success",
        "action_result": task["action_result"],
    }
    logging.info(f"Returning from analyze_action: {response_data}")
    return JSONResponse(content=response_data)


@app.get("/tickets/escalated")
def get_escalated_tickets():
    try:
        with open(TICKETS_DB, 'r') as f:
            tickets = json.load(f)
        return [t for t in tickets if t.get("awaiting_human_response")]
    except Exception as e:
        logging.error(f"Error reading tickets: {e}")
        return []


@app.get("/chat/is_escalated/{session_id}")
async def is_escalated(session_id: str):
    try:
        with open(TICKETS_DB, "r") as f:
            tickets = json.load(f)
        for ticket in tickets:
            if ticket["session_id"] == session_id:
                return {"escalated": True, "agent_name": ticket.get("agent_name", "system")}
        return {"escalated": False}
    except Exception as e:
        logging.error(f"Error checking escalation: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})



@app.post("/tickets/reply")
async def post_human_reply(request: Request):
    data = await request.json()
    session_id = data.get("session_id")
    message = data.get("message")
    agent_name = data.get("agent_name", "Support Agent")

    try:
        # Update ticket store
        with open(TICKETS_DB, "r") as f:
            tickets = json.load(f)

            print("Inside Ticket Reply")

        for t in tickets:
            if t["session_id"] == session_id:
                t["messages"].append({
                    "agent_name": agent_name,
                    "message": message
                })

        with open(TICKETS_DB, "w") as f:
            json.dump(tickets, f, indent=2)
        print("JSON saved")

        # Save to chat history
        if isinstance(message, dict):
            message = json.dumps(message)

        chat_history_handler.add_message(session_id, agent_name, message)

        # Determine if it's a Telegram escalation
        chat_id = get_chat_id_for_session(session_id)
        
        if chat_id:
            # Telegram Escalation
            bot_token = get_bot_token_for_session(session_id)
            TelegramSender().send_message(chat_id, message , bot_token)
            return {"status": "sent-to-telegram"}
        
        # Else: it's an admin panel escalation
        if agent_name.lower() != "user":
            await user_ws_manager.send_personal_message(
                session_id=session_id,
                message=message,
                agent_name=agent_name
            )

        await agent_ws_manager.broadcast({
            "session_id": session_id,
            "agent_name": agent_name,
            "message": message,
            "timestamp": datetime.utcnow().isoformat()
        })

        return {"status": "success"}

    except Exception as e:
        logging.error("Failed to post human reply: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/chat/history/{session_id}")
def get_chat_history(session_id: str):
    try:
        history = chat_history_handler.get_chat_history(session_id)
        transformed = []
        for entry in history:
            agent_name = "User" if entry.role == "user" else \
                         "AI" if entry.role == "assistant" else \
                         "System"
            transformed.append({
                "agent_name": agent_name,
                "message": entry.content,
                "timestamp": getattr(entry, "timestamp", datetime.utcnow().isoformat())
            })
        return {"session_id": session_id, "messages": transformed}
    except Exception as e:
        logging.error(f"Failed to fetch history: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/chat/save")
async def save_message(data: dict):
    logging.info(f"Received save_message payload: {data}")
    session_id = data.get("session_id")
    agent_name = data.get("agent_name")
    message = data.get("message")

    # logging.info(f"Save Msg | session={session_id} | {agent_name}: {message}")

    if not (session_id and agent_name and message):
        raise HTTPException(status_code=400, detail="Missing data")

    chat_history_handler.add_message(session_id, agent_name, message)
    return {"status": "saved"}


@app.websocket("/ws")
async def user_websocket(websocket: WebSocket):
    session_id = websocket.query_params.get("session_id")
    print("session_id from websocket:", session_id)
    # agent_id = websocket.query_params.get("agent_id", None)
    if not session_id:
        await websocket.close(code=1008)
        return

    await user_ws_manager.connect(websocket, session_id)


    async def keepalive():
        while True:
            try:
                await websocket.send_text("ping")
                await asyncio.sleep(30)
            except:
                break
    asyncio.create_task(keepalive())

    try:
        while True:
            message = await websocket.receive_text()

            chat_history_handler.add_message(session_id, "user", message)
            print("Message received from user websocket:", message)

            logging.info(f"[WS] Received user msg | session={session_id} | msg={message}")

            await agent_ws_manager.broadcast({
                "session_id": session_id,
                "agent_name": "user",
                "message": message,
                "timestamp": datetime.utcnow().isoformat()
            })

    except:
        user_ws_manager.disconnect(session_id)


@app.websocket("/ws/admin")
async def admin_ws(websocket: WebSocket, session_id: str):
    logging.info("[ADMIN WS] Connection accepted")
    agent_id = session_id
    await agent_ws_manager.connect(websocket, agent_id)

    async def keepalive():
        while True:
            try:
                await websocket.send_text("ping")
                await asyncio.sleep(30)
            except:
                break
    asyncio.create_task(keepalive())

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)

            # Send to the user
            logging.info(f"[ADMIN WS] Received from admin: {parsed}")
            await user_ws_manager.send_personal_message(parsed["message"], parsed["session_id"] , parsed["agent_name"])

            # Optional: also broadcast to other agents (if needed)
            # await agent_ws_manager.broadcast(parsed)

    except WebSocketDisconnect:
        agent_ws_manager.disconnect(agent_id)


# ─── Widget session & admin dashboard ─────────────────────────────────────────

def _generate_conversation_summary(session_id: str) -> str:
    try:
        chat_history = chat_history_handler.get_formatted_history(session_id)
        if not chat_history or not chat_history.strip():
            return "No conversation history available."
        from AgentManager import llm_handler
        summary_llm = llm_handler.get_llm()
        summary_prompt = (
            "Summarize this website widget customer conversation in 3-5 bullet points. "
            "Include what they asked, any products/services discussed, and contact details if mentioned:\n\n"
            f"{chat_history}"
        )
        summary_resp = summary_llm.complete(summary_prompt)
        return summary_resp.text.strip()
    except Exception as e:
        logging.error(f"[WidgetSummary] Failed: {e}")
        return "Summary generation failed."


async def _whatsapp_credentials_for_agent(agent_id: str) -> Dict[str, str]:
    """Resolve WhatsApp send credentials: Mongo channel for agent, else config.json."""
    wa_cfg = config.get("WhatsApp", {})
    if mongo_db is not None and agent_id:
        try:
            doc = await mongo_db[WHATSAPP_CHANNELS_COLLECTION].find_one({"ai_agent_id": agent_id})
            if doc:
                return {
                    "admin_phone": doc.get("admin_phone") or wa_cfg.get("admin_phone", ""),
                    "access_token": doc.get("access_token") or wa_cfg.get("access_token", ""),
                    "phone_number_id": doc.get("phone_number_id") or wa_cfg.get("phone_number_id", ""),
                }
        except Exception as e:
            logging.warning(f"[WidgetWA] Mongo lookup failed: {e}")
    return {
        "admin_phone": wa_cfg.get("admin_phone", ""),
        "access_token": wa_cfg.get("access_token", ""),
        "phone_number_id": wa_cfg.get("phone_number_id", ""),
    }


async def _complete_widget_chat(session_id: str, reason: str = "inactivity") -> Dict[str, Any]:
    existing = wsm.get_session(session_id)
    if existing and existing.get("status") == "completed":
        return existing

    agent_id = (existing or {}).get("agent_id", "")
    contact = (existing or {}).get("contact") or {}
    summary = _generate_conversation_summary(session_id)

    lead_data = {
        "session_id": session_id,
        "name": contact.get("name") or "Unknown",
        "email": contact.get("email") or "Not provided",
        "phone": contact.get("phone") or "Not provided",
        "summary": summary,
    }

    # Disabled by product requirement:
    # never send chat summaries to any WhatsApp number.
    whatsapp_sent = False

    record = wsm.mark_completed(session_id, reason=reason, summary=summary, whatsapp_sent=whatsapp_sent)
    if not record:
        record = wsm.upsert_session(session_id, agent_id)
        record = wsm.mark_completed(session_id, reason=reason, summary=summary, whatsapp_sent=whatsapp_sent)

    # Also append to leads_store for unified lead list
    try:
        leads = []
        if os.path.exists(LEADS_DB):
            with open(LEADS_DB, "r", encoding="utf-8") as f:
                leads = json.load(f)
        leads.append({
            **lead_data,
            "captured_at": datetime.utcnow().isoformat(),
            "whatsapp_sent": whatsapp_sent,
            "source": "website_widget",
            "completion_reason": reason,
        })
        with open(LEADS_DB, "w", encoding="utf-8") as f:
            json.dump(leads, f, indent=2)
    except Exception as e:
        logging.error(f"[WidgetComplete] leads save failed: {e}")

    return record or {}


class WidgetSessionStart(BaseModel):
    session_id: str
    agent_id: str
    origin: Optional[str] = ""
    page_url: Optional[str] = ""


class WidgetContactUpdate(BaseModel):
    session_id: str
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""


class WidgetSessionComplete(BaseModel):
    session_id: str
    reason: Optional[str] = "inactivity"


@app.post("/widget/session/start")
async def widget_session_start(body: WidgetSessionStart):
    if not body.session_id or not body.agent_id:
        raise HTTPException(status_code=400, detail="session_id and agent_id required")
    agent_cfg = _get_agent_config(body.agent_id)
    record = wsm.upsert_session(
        body.session_id,
        body.agent_id,
        agent_cfg.get("name", ""),
        origin=body.origin or "",
        page_url=body.page_url or "",
    )
    return {"status": "ok", "session": record}


@app.post("/widget/session/contact")
async def widget_session_contact(body: WidgetContactUpdate):
    if not body.session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    record = wsm.update_contact(body.session_id, body.name or "", body.email or "", body.phone or "")
    if not record:
        agent_id = ""
        record = wsm.upsert_session(body.session_id, agent_id)
        record = wsm.update_contact(body.session_id, body.name or "", body.email or "", body.phone or "")
    return {"status": "ok", "session": record}


@app.post("/widget/session/complete")
async def widget_session_complete(body: WidgetSessionComplete):
    if not body.session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    record = await _complete_widget_chat(body.session_id, reason=body.reason or "inactivity")
    return {
        "status": "completed",
        "whatsapp_sent": record.get("whatsapp_sent") if record else False,
        "session": record,
    }


@app.get("/dashboard/stats")
async def dashboard_stats(days: int = 30):
    stats = wsm.compute_stats(days=days, chat_history_handler=chat_history_handler)
    try:
        if os.path.exists(LEADS_DB):
            with open(LEADS_DB, "r", encoding="utf-8") as f:
                leads = json.load(f)
            stats["total_leads"] = len(leads) if isinstance(leads, list) else 0
        else:
            stats["total_leads"] = stats.get("leads_with_contact", 0)
    except Exception:
        stats["total_leads"] = stats.get("leads_with_contact", 0)
    return stats


@app.get("/dashboard/sessions")
async def dashboard_sessions(status: Optional[str] = None, agent_id: Optional[str] = None, limit: int = 100):
    return wsm.list_sessions(
        status=status,
        agent_id=agent_id,
        limit=limit,
        chat_history_handler=chat_history_handler,
    )


@app.get("/dashboard/sessions/{session_id}")
async def dashboard_session_detail(session_id: str):
    meta = wsm.get_session(session_id)
    if not meta:
        history = chat_history_handler.get_chat_history(session_id)
        if not history:
            raise HTTPException(status_code=404, detail="Session not found")
        meta = wsm._enrich_record(wsm._session_from_redis(session_id, len(history)))
        agent_cfg = _get_agent_config(meta.get("agent_id", ""))
        if agent_cfg.get("name"):
            meta["agent_name"] = agent_cfg["name"]
    try:
        history = chat_history_handler.get_chat_history(session_id)
        messages = []
        for msg in history:
            role = str(getattr(msg, "role", "assistant")).lower()
            content = getattr(msg, "content", "")
            messages.append({"role": role, "content": content})
    except Exception as e:
        logging.error(f"[Dashboard] history load failed: {e}")
        messages = []
    return {"session": meta, "messages": messages}


@app.on_event("startup")
async def setup_webhooks():
    global mongo_client, mongo_db
    mongo_uri = _load_mongo_uri()
    try:
        mongo_client = AsyncIOMotorClient(mongo_uri)
        mongo_db = mongo_client["deepfake_et"]
        logging.info("[MongoDB] Connected for WhatsApp channel routing")
    except Exception as e:
        mongo_client = None
        mongo_db = None
        logging.error(f"[MongoDB] Failed to initialize: {e}")

    # Sometimes, Telegram webhooks fail during FastAPI cold startup if the public domain isn’t reachable yet (e.g., in ngrok, Docker, Cloud Run).
    await asyncio.sleep(2)  # Give services a bit of time to settle
    try:
        BASE_WEBHOOK_URL = (os.getenv("TELEGRAM_WEBHOOK_BASE_URL") or "").strip().rstrip("/")
        if not BASE_WEBHOOK_URL:
            logging.warning(
                "[Webhook Setup] TELEGRAM_WEBHOOK_BASE_URL not set; skipping Telegram webhook registration."
            )
            return

        for bot in config["Telegram"]["bots"]:
            bot_token = bot["bot_token"]
            webhook_url = f"{BASE_WEBHOOK_URL}/telegram-webhook/{bot_token}"

            set_url = f"https://api.telegram.org/bot{bot_token}/setWebhook"
            response = requests.post(set_url, json={"url": webhook_url})

            logging.info(   
                f"[Webhook Setup] Bot {bot_token[:10]}... set to {webhook_url} | Response: {response.json()}"
            )

    except Exception as e:
        logging.error(f"[Webhook Setup] Failed to set Telegram webhook: {e}")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

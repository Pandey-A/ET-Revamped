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
from datetime import datetime, timezone
from typing import List, Optional, Any, Dict
from fastapi import UploadFile, File, Form, APIRouter
from fastapi.staticfiles import StaticFiles
import os
import re
import time
import requests

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
from AgentManager import credits_store
from AgentManager.credits_greetings import greeting_reply
from AgentManager import whatsapp_flow
from AgentManager import whatsapp_booking
from AgentManager import whatsapp_broadcast

TICKETS_DB = "tickets_store.json"
AGENTS_DB = "Agents_store.json"
LEADS_DB = "leads_store.json"
CORE_API_BASE = (os.getenv("CORE_API_URL") or "http://127.0.0.1:5001/api").strip().rstrip("/")
CORE_INTERNAL_API_KEY = (os.getenv("INTERNAL_API_KEY") or "").strip()
WHATSAPP_VERIFY_TOKEN = (os.getenv("WHATSAPP_VERIFY_TOKEN") or "12345").strip()
WHATSAPP_APP_SECRET = (os.getenv("WHATSAPP_APP_SECRET") or "").strip()

# Meta may retry webhooks — ignore duplicate inbound message ids.
_WHATSAPP_SEEN_MSG_IDS: Dict[str, float] = {}
_WHATSAPP_DEDUPE_TTL_SEC = 3600


def _whatsapp_message_already_handled(message_id: str | None) -> bool:
    if not message_id:
        return False
    now = time.time()
    expired = [k for k, ts in _WHATSAPP_SEEN_MSG_IDS.items() if now - ts > _WHATSAPP_DEDUPE_TTL_SEC]
    for k in expired:
        _WHATSAPP_SEEN_MSG_IDS.pop(k, None)
    if message_id in _WHATSAPP_SEEN_MSG_IDS:
        logging.info("[WhatsApp] Duplicate webhook ignored: %s", message_id[:24])
        return True
    _WHATSAPP_SEEN_MSG_IDS[message_id] = now
    return False
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or os.getenv("TELEGRAM_WEBHOOK_BASE_URL") or "").strip().rstrip("/")

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

def _core_api_request(method: str, path: str, *, json_body: Optional[dict] = None, params: Optional[dict] = None):
    url = f"{CORE_API_BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if CORE_INTERNAL_API_KEY:
        headers["x-internal-api-key"] = CORE_INTERNAL_API_KEY
    resp = requests.request(method, url, headers=headers, json=json_body, params=params, timeout=12)
    try:
        body = resp.json()
    except Exception:
        body = {}
    if not resp.ok:
        detail = body.get("message") or body.get("error") or f"Core API error ({resp.status_code})"
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return body


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
    w_norm = _normalize_whatsapp_business_account_id(waba_id)
    p_norm = _normalize_whatsapp_phone_number_id(phone_number_id)
    if not p_norm:
        return None
    try:
        body = _core_api_request(
            "GET",
            "/whatsapp-channels/internal/resolve",
            params={"waba_id": w_norm, "phone_number_id": p_norm},
        )
        return body.get("channel")
    except Exception as e:
        logging.error(f"[WhatsApp] Core API resolve failed: {e}")
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


def _require_agent_in_runtime(agent_id: str) -> None:
    """WhatsApp channels must reference an agent present in Agents_store.json (Express sync)."""
    if not agent_id or not str(agent_id).strip():
        raise HTTPException(status_code=400, detail="ai_agent_id is required")
    if not _get_agent_config(agent_id.strip()):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Agent '{agent_id}' is not registered on the AI runtime. "
                "Open AI Agents in the dashboard, edit the agent, and save it once (or run "
                "npm run agents:sync-fastapi on the server) before linking WhatsApp."
            ),
        )


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

def _verify_whatsapp_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    if not WHATSAPP_APP_SECRET:
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    import hmac
    import hashlib

    expected = "sha256=" + hmac.new(
        WHATSAPP_APP_SECRET.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header.strip())


@app.get("/webhook/whatsapp")
async def verify_whatsapp_webhook(request: Request):
    """Verify webhook from Meta"""
    hub_mode = request.query_params.get("hub.mode")
    hub_verify_token = request.query_params.get("hub.verify_token")
    hub_challenge = request.query_params.get("hub.challenge")

    if hub_mode == "subscribe" and hub_verify_token == WHATSAPP_VERIFY_TOKEN:
        return int(hub_challenge)
    return JSONResponse(status_code=403, content={"error": "Verification failed"})


def _billing_user_for_agent(agent_id: Optional[str]) -> Optional[str]:
    if not agent_id:
        return None
    return credits_store.get_agent_owner(agent_id)


async def _collect_ai_response(response_gen) -> str:
    """Normalize aprocess_query return value (async gen, dict, or str) into plain text."""
    if response_gen is None:
        return ""
    if isinstance(response_gen, dict):
        return str(response_gen.get("response") or response_gen.get("message") or "")
    if isinstance(response_gen, str):
        return response_gen
    full = ""
    if hasattr(response_gen, "__aiter__"):
        async for chunk in response_gen:
            if chunk is not None:
                full += str(chunk)
        return full
    return str(response_gen)


async def _whatsapp_send_ai_reply(
    *,
    session_id: str,
    to_phone: str,
    phone: str,
    user_text: str,
    agent_id: str,
    dynamic_api: WhatsAppCloudAPI,
    inbound_message_id: str | None,
    channel_config: Dict[str, Any],
    billing_user: str | None,
) -> None:
    """Run KB+RAG+LLM and send the reply on WhatsApp."""
    charge_type = None
    if billing_user:
        if not credits_store.can_accept_message(billing_user):
            dynamic_api.send_whatsapp_message(
                to_phone,
                "Your account is out of message credits. Please contact support to add more credits.",
            )
            return
        charge_type = credits_store.deduct_user_charge(billing_user, 1)

    if inbound_message_id:
        dynamic_api.send_typing_indicator(message_id=inbound_message_id)
        await asyncio.sleep(1.0)

    async def _refresh_typing_loop():
        while True:
            await asyncio.sleep(18)
            if inbound_message_id:
                dynamic_api.send_typing_indicator(message_id=inbound_message_id)

    typing_task = None
    if inbound_message_id:
        typing_task = asyncio.create_task(_refresh_typing_loop())

    full_response = ""
    try:
        response_gen = await query_handler.aprocess_query(user_text, session_id, agent_id)
        full_response = await _collect_ai_response(response_gen)
    except Exception as exc:
        logging.error("[WhatsApp] AI reply failed for session %s: %s", session_id, exc, exc_info=True)
        full_response = ""
    finally:
        if typing_task:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    if not full_response.strip():
        full_response = (
            "Sorry, I couldn't generate a reply just now. Please try again or reply *menu*."
        )

    agent_config = _get_agent_config(agent_id)
    greeting_message = (agent_config.get("greeting_message") or "").strip()
    if greeting_message and _should_prefix_greeting(session_id, user_text):
        full_response = f"{greeting_message}\n\n{full_response}"

    chat_history_handler.add_message(session_id, "assistant", full_response)
    mapped_phone_number_id = channel_config.get("phone_number_id")
    if not full_response.strip():
        logging.error("[WhatsApp] Refusing to send empty message for session %s", session_id)
        return
    if inbound_message_id:
        dynamic_api.pause_with_typing(inbound_message_id, 0.8)
    send_result = dynamic_api.send_whatsapp_message(to_phone, full_response)
    if send_result.get("status") != "success":
        logging.error(
            f"[WhatsApp] Outbound reply failed for session {session_id}: {send_result.get('error')}"
        )
        if billing_user and charge_type:
            credits_store.refund_user_charge(billing_user, charge_type, 1)
            charge_type = None
    elif billing_user:
        credits_store.record_user_metric(billing_user, "total_successful_replies")
        if charge_type:
            credits_store.log_usage_event(
                billing_user,
                "whatsapp",
                charge_type or "credit",
                1,
                session_id,
                agent_id or "",
            )
            credits_store.record_token_usage(
                billing_user,
                session_id,
                credits_store.estimate_tokens(user_text, full_response),
            )

    extract_and_save_lead(
        session_id,
        phone,
        agent_id,
        admin_phone=channel_config.get("admin_phone"),
        access_token=channel_config.get("access_token"),
        phone_number_id=mapped_phone_number_id,
    )


async def async_process_whatsapp(
    session_id: str,
    phone: str,
    text: str,
    waba_id: str = None,
    phone_number_id: str = None,
    display_phone_number: str = None,
    inbound_message_id: str = None,
):
    billing_user = None
    dynamic_api = None
    to_phone = "+" + str(phone).replace("+", "").replace(" ", "")

    try:
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
                f"[WhatsApp] Channel mapping {channel_config.get('id')} missing ai_agent_id"
            )
            return

        dynamic_api = WhatsAppCloudAPI(
            phone_number_id=mapped_phone_number_id,
            access_token=access_token,
            admin_phone=admin_phone,
        )

        billing_user = _billing_user_for_agent(agent_id)
        if billing_user:
            credits_store.ensure_user_account(billing_user)
            credits_store.record_user_metric(billing_user, "total_queries_received")
            credits_store.record_user_metric(billing_user, "total_whatsapp_messages")

        wa_cfg = whatsapp_flow.parse_channel_config(channel_config)

        normalized = (text or "").strip().lower()
        if normalized in ("menu", "services", "help"):
            whatsapp_flow.send_service_menu(
                dynamic_api, to_phone, wa_cfg, inbound_message_id
            )
            chat_history_handler.add_message(session_id, "assistant", wa_cfg.get("service_menu_message") or "Service menu sent")
            if billing_user:
                credits_store.record_user_metric(billing_user, "total_greetings_bypassed")
            return

        if whatsapp_booking.handle_text_message(
            dynamic_api,
            to_phone,
            session_id,
            text,
            phone,
            agent_id or "",
            inbound_message_id=inbound_message_id,
        ):
            chat_history_handler.add_message(session_id, "assistant", "[booking flow]")
            return

        service_pick = whatsapp_flow.match_service_from_text(text, wa_cfg.get("services") or [])
        if service_pick and str(service_pick.get("id", "")).lower() == whatsapp_booking.BOOK_VISIT_ID:
            whatsapp_booking.start_booking(
                dynamic_api, to_phone, session_id, inbound_message_id=inbound_message_id
            )
            chat_history_handler.add_message(session_id, "assistant", "[booking started]")
            return

        if whatsapp_flow.is_greeting_message(text):
            whatsapp_flow.send_welcome_flow(
                dynamic_api, to_phone, wa_cfg, PUBLIC_BASE_URL, inbound_message_id
            )
            chat_history_handler.add_message(session_id, "assistant", wa_cfg.get("welcome_message") or "Welcome")
            if billing_user:
                credits_store.record_user_metric(billing_user, "total_greetings_bypassed")
            return

        canned_greeting = greeting_reply(text)
        if canned_greeting:
            if billing_user:
                credits_store.record_user_metric(billing_user, "total_greetings_bypassed")
            chat_history_handler.add_message(session_id, "assistant", canned_greeting)
            dynamic_api.send_whatsapp_message(
                to_phone, canned_greeting, inbound_message_id=inbound_message_id
            )
            return

        await _whatsapp_send_ai_reply(
            session_id=session_id,
            to_phone=to_phone,
            phone=phone,
            user_text=text,
            agent_id=agent_id,
            dynamic_api=dynamic_api,
            inbound_message_id=inbound_message_id,
            channel_config=channel_config,
            billing_user=billing_user,
        )

    except Exception as e:
        logging.error(f"Failed in async_process_whatsapp: {e}")


async def async_process_whatsapp_interactive(
    session_id: str,
    phone: str,
    selection_id: str,
    waba_id: str = None,
    phone_number_id: str = None,
    inbound_message_id: str = None,
    selection_title: str = None,
):
    try:
        channel_config = await _resolve_whatsapp_channel(waba_id, phone_number_id)
        if not channel_config:
            return
        agent_id = channel_config.get("ai_agent_id")
        if not agent_id:
            return

        access_token = channel_config.get("access_token")
        mapped_phone_number_id = channel_config.get("phone_number_id") or phone_number_id
        dynamic_api = WhatsAppCloudAPI(
            phone_number_id=mapped_phone_number_id,
            access_token=access_token,
            admin_phone=channel_config.get("admin_phone"),
        )
        to_phone = "+" + str(phone).replace("+", "").replace(" ", "")

        billing_user = _billing_user_for_agent(agent_id)

        if whatsapp_booking.is_booking_selection(selection_id):
            whatsapp_booking.handle_selection(
                dynamic_api,
                to_phone,
                session_id,
                selection_id,
                phone,
                agent_id,
                inbound_message_id=inbound_message_id,
            )
            return

        wa_cfg = whatsapp_flow.parse_channel_config(channel_config)
        services = wa_cfg.get("services") or []
        service = whatsapp_flow.resolve_service_selection(
            services, selection_id, selection_title
        )
        if not service:
            dynamic_api.send_whatsapp_message(
                to_phone,
                "Sorry, I didn't recognize that option. Reply *menu* to see services again.",
                inbound_message_id=inbound_message_id,
            )
            return

        if str(service.get("id", "")).lower() == whatsapp_booking.BOOK_VISIT_ID:
            whatsapp_booking.start_booking(
                dynamic_api, to_phone, session_id, inbound_message_id=inbound_message_id
            )
            return

        user_message = whatsapp_flow.service_as_user_message(
            service, selection_title=selection_title
        )
        logging.info(
            "[WhatsApp] Service menu → AI | id=%s | user_message=%s",
            selection_id,
            user_message,
        )
        chat_history_handler.add_message(session_id, "user", user_message)
        await _whatsapp_send_ai_reply(
            session_id=session_id,
            to_phone=to_phone,
            phone=phone,
            user_text=user_message,
            agent_id=agent_id,
            dynamic_api=dynamic_api,
            inbound_message_id=inbound_message_id,
            channel_config=channel_config,
            billing_user=billing_user,
        )
        if str(service.get("id", "")).lower() == "bca":
            whatsapp_flow.record_bca_completed(phone)
    except Exception as e:
        logging.error(f"Failed in async_process_whatsapp_interactive: {e}")


@app.post("/internal/whatsapp/bca-reminders/run")
async def run_bca_reminders_internal(request: Request):
    key = (request.headers.get("x-internal-api-key") or "").strip()
    if CORE_INTERNAL_API_KEY and key != CORE_INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorised")
    sent = 0
    channels: List[Dict[str, Any]] = []
    try:
        ch_body = _core_api_request("GET", "/whatsapp-channels/internal/all")
        channels = ch_body.get("channels") or []
    except Exception as e:
        logging.error(f"[BCA] Failed to load channels: {e}")

    force = str(request.query_params.get("force") or "").lower() in ("1", "true", "yes")

    for channel in channels:
        cfg = whatsapp_flow.parse_channel_config(channel)
        bca = cfg.get("bca_reminder") or {}
        if not bca.get("enabled"):
            continue
        interval = int(bca.get("interval_days") or 45)
        message = str(bca.get("message") or "")
        api = WhatsAppCloudAPI(
            phone_number_id=channel.get("phone_number_id"),
            access_token=channel.get("access_token"),
        )
        store = whatsapp_flow._load_bca_store()
        targets = list(store.keys()) if force else whatsapp_flow.phones_due_for_bca(interval)
        now_iso = datetime.now(timezone.utc).isoformat()
        for digits in targets:
            to_phone = f"+{digits}"
            api.send_whatsapp_message(to_phone, message)
            if not force:
                store[digits] = now_iso
            sent += 1
        if not force and targets:
            whatsapp_flow._save_bca_store(store)
    return {"success": True, "sent": sent, "force": force}


@app.post("/internal/whatsapp/broadcast")
async def whatsapp_broadcast_internal(request: Request):
    """Send a custom text message to multiple WhatsApp numbers for one channel."""
    key = (request.headers.get("x-internal-api-key") or "").strip()
    if CORE_INTERNAL_API_KEY and key != CORE_INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorised")

    try:
        body = await request.json()
    except Exception:
        body = {}

    phone_number_id = str(body.get("phone_number_id") or "").strip()
    access_token = str(body.get("access_token") or "").strip()
    message = str(body.get("message") or "").strip()
    audience = str(body.get("audience") or "manual").strip().lower()
    agent_id = str(body.get("agent_id") or "").strip() or None
    manual_phones = body.get("phones")
    if isinstance(manual_phones, str):
        manual_phones = [manual_phones]
    elif not isinstance(manual_phones, list):
        manual_phones = []

    if not phone_number_id or not access_token:
        raise HTTPException(status_code=400, detail="phone_number_id and access_token are required")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    api = WhatsAppCloudAPI(
        phone_number_id=phone_number_id,
        access_token=access_token,
        admin_phone=str(body.get("admin_phone") or "").strip() or None,
    )
    image_url = str(body.get("image_url") or "").strip() or None
    image_path = str(body.get("image_path") or "").strip() or None
    image_public_url = str(body.get("image_public_url") or "").strip() or None
    image_base64 = str(body.get("image_base64") or "").strip() or None
    image_mime = str(body.get("image_mime") or "").strip() or None

    dry_run = str(body.get("dry_run") or "").lower() in ("1", "true", "yes")
    if dry_run:
        rows = whatsapp_broadcast.collect_recipient_rows(
            audience=audience,
            manual_phones=manual_phones,
            agent_id=agent_id,
        )
        return {
            "success": True,
            "dry_run": True,
            "recipients": len(rows),
            "preview": rows[:20],
        }

    result = whatsapp_broadcast.run_broadcast(
        api,
        message=message,
        audience=audience,
        manual_phones=manual_phones,
        agent_id=agent_id,
        image_url=image_url,
        image_path=image_path,
        image_public_url=image_public_url,
        image_base64=image_base64,
        image_mime=image_mime,
    )
    return result


@app.post("/webhook/whatsapp")
async def receive_whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        raw_body = await request.body()
        signature = request.headers.get("X-Hub-Signature-256")
        if not _verify_whatsapp_signature(raw_body, signature):
            return JSONResponse(status_code=403, content={"error": "Invalid signature"})

        data = json.loads(raw_body.decode("utf-8") or "{}")

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
                            if _whatsapp_message_already_handled(msg.get("id")):
                                continue
                            phone = msg.get("from")
                            if not phone:
                                continue
                            session_id = f"whatsapp_{waba_id}_{phone_number_id}_{phone}"
                            msg_type = msg.get("type")

                            if msg_type == "text":
                                text = msg["text"]["body"]
                                background_tasks.add_task(
                                    async_process_whatsapp,
                                    session_id,
                                    phone,
                                    text,
                                    waba_id,
                                    phone_number_id,
                                    display_phone_number,
                                    msg.get("id"),
                                )
                            elif msg_type == "interactive":
                                interactive = msg.get("interactive") or {}
                                selection_id = None
                                selection_title = None
                                if interactive.get("type") == "list_reply":
                                    list_reply = interactive.get("list_reply") or {}
                                    selection_id = list_reply.get("id")
                                    selection_title = list_reply.get("title")
                                elif interactive.get("type") == "button_reply":
                                    btn = interactive.get("button_reply") or {}
                                    selection_id = btn.get("id")
                                    selection_title = btn.get("title")
                                if selection_id:
                                    background_tasks.add_task(
                                        async_process_whatsapp_interactive,
                                        session_id,
                                        phone,
                                        selection_id,
                                        waba_id,
                                        phone_number_id,
                                        msg.get("id"),
                                        selection_title,
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
                # Use OpenAI via llm_handler
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
    charge_type = None
    billing_user = None
    is_widget = session_id.startswith("widget_") or session_id.startswith("w_") or session_id.startswith("anon_")
    usage_channel = "website_widget" if is_widget else "agent_chat"

    try:
        print("i am received here agent id from user 2", agent_id)
        agent_cfg = _get_agent_config(agent_id) if agent_id else {}
        wsm.upsert_session(
            session_id,
            agent_id or "",
            agent_cfg.get("name", ""),
            channel=wsm.channel_for_session(session_id),
        )

        if agent_id:
            billing_user = _billing_user_for_agent(agent_id)
            if billing_user:
                credits_store.ensure_user_account(billing_user)
                credits_store.record_user_metric(billing_user, "total_queries_received")
                if is_widget:
                    credits_store.record_user_metric(billing_user, "total_widget_messages")
                else:
                    credits_store.record_user_metric(billing_user, "total_agent_chat_messages")
                if not credits_store.can_accept_message(billing_user):
                    yield "This agent is out of message credits. Please contact the account owner to add more credits."
                    return
                charge_type = credits_store.deduct_user_charge(billing_user, 1)

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
            if billing_user:
                credits_store.record_user_metric(billing_user, "total_successful_replies")
                credits_store.log_usage_event(
                    billing_user,
                    usage_channel,
                    charge_type or "credit",
                    1,
                    session_id,
                    agent_id or "",
                )
                credits_store.record_token_usage(
                    billing_user,
                    session_id,
                    credits_store.estimate_tokens(user_input, full_response),
                )
        else:
            if billing_user and charge_type:
                credits_store.refund_user_charge(billing_user, charge_type, 1)
                credits_store.record_user_metric(billing_user, "total_failed_replies")
            logging.info("Some Error has occurred. Unexpected Response")
            yield "Some Error has occurred. Please try once again"
    except Exception as e:
        print(f"Error: {e}")
        if billing_user and charge_type:
            try:
                credits_store.refund_user_charge(billing_user, charge_type, 1)
            except Exception:
                pass
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
    _require_agent_in_runtime(payload.ai_agent_id)
    body = _core_api_request(
        "POST",
        "/whatsapp-channels",
        json_body={
            "whatsapp_business_account_id": _normalize_whatsapp_business_account_id(payload.whatsapp_business_account_id),
            "phone_number_id": _normalize_whatsapp_phone_number_id(payload.phone_number_id),
            "display_phone_number": (payload.display_phone_number or "").strip(),
            "access_token": payload.access_token.strip(),
            "ai_agent_id": payload.ai_agent_id.strip(),
            "ai_agent_name": (payload.ai_agent_name or "").strip(),
            "admin_phone": (payload.admin_phone or "").strip(),
        },
    )
    return body.get("channel")


@app.get("/whatsapp/config")
async def list_whatsapp_channels():
    body = _core_api_request("GET", "/whatsapp-channels")
    return body.get("channels", [])


@app.put("/whatsapp/config/{id}")
async def update_whatsapp_channel(id: str, payload: WhatsAppChannelUpdate):
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
    if "ai_agent_id" in cleaned_updates:
        _require_agent_in_runtime(cleaned_updates["ai_agent_id"])
    body = _core_api_request("PUT", f"/whatsapp-channels/{id}", json_body=cleaned_updates)
    return body.get("channel")


@app.delete("/whatsapp/config/{id}")
async def delete_whatsapp_channel(id: str):
    _core_api_request("DELETE", f"/whatsapp-channels/{id}")
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

        agent_id = agent_data.get("id")
        updated = False
        for idx, agent in enumerate(existing_data):
            if agent.get("id") == agent_id:
                merged = {**agent, **agent_data}
                existing_data[idx] = merged
                updated = True
                break

        if not updated:
            existing_data.append(agent_data)

        with open(AGENTS_DB, "w") as file:
            json.dump(existing_data, file, indent=4)

        owner_user_id = (agent_data.get("owner_user_id") or "").strip()
        if agent_id and owner_user_id:
            credits_store.set_agent_owner(agent_id, owner_user_id)

        return {
            "message": "Agent updated successfully" if updated else "Agent saved successfully"
        }

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(content={"error": str(e)}, status_code=500)


class CreditsOnboardBody(BaseModel):
    user_id: str
    plan: str
    custom_credits: Optional[int] = None
    allow_overdraft: Optional[bool] = False
    overdraft_rate: Optional[int] = 0


@app.get("/credits/billing")
async def get_credits_billing(user_id: str):
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    uid = user_id.strip()
    credits_store.ensure_user_account(uid, initial_credits=100)
    return credits_store.get_user_billing_and_monitoring(uid)


@app.get("/credits/tokens")
async def get_credits_tokens(user_id: str):
    """Per-session LLM token usage (chattiq-wp-credits-new parity)."""
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    uid = user_id.strip()
    return credits_store.get_token_usage_per_session(uid)


@app.post("/credits/onboard")
async def post_credits_onboard(body: CreditsOnboardBody):
    plan = (body.plan or "").strip()
    if plan not in ("Basic", "Pro", "Enterprise", "Free"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    uid = body.user_id.strip()
    if not uid:
        raise HTTPException(status_code=400, detail="user_id is required")

    if plan in ("Basic", "Pro"):
        credits_to_add = body.custom_credits if body.custom_credits is not None else 2000
        allow_overdraft = plan == "Pro"
        overdraft_rate = 1 if plan == "Pro" else 0
    elif plan == "Enterprise":
        credits_to_add = body.custom_credits if body.custom_credits is not None else 0
        allow_overdraft = bool(body.allow_overdraft)
        overdraft_rate = int(body.overdraft_rate or 0)
    else:
        credits_to_add = body.custom_credits if body.custom_credits is not None else 100
        allow_overdraft = False
        overdraft_rate = 0

    account = credits_store.onboard_user_plan(
        uid, plan, credits_to_add, allow_overdraft, overdraft_rate
    )
    return {"status": "success", "account": account}


@app.post("/credits/add")
async def post_credits_add(payload: dict = Body(...)):
    """Add credits to an account (negative amount in deduct = add)."""
    user_id = (payload.get("user_id") or "").strip()
    amount = int(payload.get("amount") or 0)
    if not user_id or amount <= 0:
        raise HTTPException(status_code=400, detail="user_id and positive amount required")
    credits_store.deduct_user_credits(user_id, -amount)
    return credits_store.get_user_billing_and_monitoring(user_id)


# ─── Background indexing helpers ──────────────────────────────────────────────
SSQUARE_AGENT_ID = "agent_1780319230183_2blh5h"
SSQUARE_KB_PDF = "temp_files/S_Square_Fitness_Club_Complete_Document.pdf"


def _set_agent_resources(agent_id: str, resource_list: List[str]) -> bool:
    """Replace agent resource_list in Agents_store.json and PostgreSQL."""
    paths = [str(p).strip() for p in (resource_list or []) if str(p).strip()]
    try:
        if os.path.exists(AGENTS_DB):
            with open(AGENTS_DB, "r", encoding="utf-8") as f:
                agents = json.load(f)
        else:
            agents = []
        found = False
        for agent in agents:
            if agent.get("id") == agent_id:
                agent["resource_list"] = paths
                found = True
                break
        if not found:
            logging.warning(f"Agent {agent_id} not in {AGENTS_DB}")
            return False
        with open(AGENTS_DB, "w", encoding="utf-8") as f:
            json.dump(agents, f, indent=4, ensure_ascii=False)
        try:
            _core_api_request(
                "PUT",
                f"/internal/agents/{agent_id}/resources",
                json_body={"resource_list": paths},
            )
        except Exception as sync_err:
            logging.warning(f"[KnowledgeBase] PG resource sync failed for {agent_id}: {sync_err}")
        return True
    except Exception as e:
        logging.error(f"Failed to set agent resources: {e}")
        return False


def _bg_rebuild_agent_kb(task_id: str, agent_id: str, pdf_path: str, collection_name: str):
    from AgentManager.KnowledgeManagerAgent.resources import rebuild_pdf_knowledge_base

    try:
        indexing_tasks[task_id] = {
            "status": "processing",
            "message": "Clearing old vectors and indexing PDF…",
        }
        rebuild_pdf_knowledge_base(pdf_path, collection_name, clear_existing=True)
        indexing_tasks[task_id] = {
            "status": "success",
            "message": f"Knowledge base rebuilt from {os.path.basename(pdf_path)}",
        }
    except Exception as e:
        logging.error(f"KB rebuild failed for {agent_id}: {e}", exc_info=True)
        indexing_tasks[task_id] = {"status": "error", "message": str(e)}


@app.post("/internal/agents/{agent_id}/rebuild-knowledge")
async def rebuild_agent_knowledge_internal(
    agent_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Clear Weaviate collection and re-index from the agent's sole PDF (internal)."""
    key = (request.headers.get("x-internal-api-key") or "").strip()
    if CORE_INTERNAL_API_KEY and key != CORE_INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorised")

    agent = _get_agent_config(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    collection_name = agent.get("collection_name") or ""
    resources = agent.get("resource_list") or []
    if not resources:
        resources = [SSQUARE_KB_PDF]
    pdf_path = resources[0]
    if not pdf_path.startswith("temp_files"):
        pdf_path = os.path.join("temp_files", os.path.basename(pdf_path))
    if not os.path.isfile(pdf_path):
        raise HTTPException(status_code=400, detail=f"PDF not found: {pdf_path}")

    _set_agent_resources(agent_id, [pdf_path.replace("\\", "/")])

    task_id = f"rebuild_{uuid.uuid4().hex[:12]}"
    indexing_tasks[task_id] = {"status": "processing", "message": "Starting rebuild…"}
    background_tasks.add_task(_bg_rebuild_agent_kb, task_id, agent_id, pdf_path, collection_name)
    return {
        "status": "accepted",
        "task_id": task_id,
        "agent_id": agent_id,
        "collection_name": collection_name,
        "pdf": pdf_path,
    }


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
                # Keep existing collection_name (must match Weaviate index from upload form).
                if not agent.get("collection_name"):
                    safe_name = re.sub(r"\s+", "_", str(agent.get("name") or "agent").strip())
                    agent["collection_name"] = f"{safe_name}_{agent_id}"

                if "resource_list" in agent:
                    if isinstance(agent["resource_list"], list):
                        agent["resource_list"].append(resource_path)
                    else:
                        agent["resource_list"] = [agent["resource_list"], resource_path]
                else:
                    agent["resource_list"] = [resource_path]

                with open(AGENTS_DB, "w", encoding="utf-8") as f:
                    json.dump(agents, f, indent=4, ensure_ascii=False)
                try:
                    _core_api_request(
                        "POST",
                        f"/internal/agents/{agent_id}/resources",
                        json_body={"resource_path": resource_path},
                    )
                except Exception as sync_err:
                    logging.warning(f"[KnowledgeBase] Failed to sync resource to PostgreSQL for {agent_id}: {sync_err}")
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
    """Resolve WhatsApp send credentials: PostgreSQL channel for agent, else config.json."""
    wa_cfg = config.get("WhatsApp", {})
    if agent_id:
        try:
            body = _core_api_request("GET", f"/whatsapp-channels/internal/by-agent/{agent_id}")
            doc = body.get("channel") or {}
            if doc:
                return {
                    "admin_phone": doc.get("admin_phone") or wa_cfg.get("admin_phone", ""),
                    "access_token": doc.get("access_token") or wa_cfg.get("access_token", ""),
                    "phone_number_id": doc.get("phone_number_id") or wa_cfg.get("phone_number_id", ""),
                }
        except Exception as e:
            logging.warning(f"[WidgetWA] Postgres channel lookup failed: {e}")
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

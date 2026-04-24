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
from typing import List
from fastapi import UploadFile, File, Form, APIRouter
from fastapi.staticfiles import StaticFiles
import os
import requests

from managers.user_ws_manager import UserWebSocketManager
from managers.agent_ws_manager import AgentWebSocketManager

from AgentManager import query_handler, chat_history_handler
from AgentManager.KnowledgeManagerAgent.resources import WebPageIndexer, PDFIndexer
from .models import ChatRequest, AnalyzeAction

from .routes.livekit_token import router as livekit_router

from AgentManager.telegram.chat_session_mapping import (
    get_chat_id_for_session,
    get_bot_token_for_chat_id,
    get_bot_token_for_session,
    get_session_id_for_bot_token
)
from AgentManager.telegram.sender import TelegramSender

TICKETS_DB = "tickets_store.json"
AGENTS_DB = "Agents_store.json"

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

# TELEGRAM MODELS & HELPERS
class TelegramUpdate(BaseModel):
    message: dict

@app.post("/chat/session")
async def create_or_get_session():
    session_id = f"session_{datetime.utcnow().date()}_{uuid.uuid4()}"
    return {"session_id": session_id}

def auto_bind_chat_id(bot_token: str, chat_id: str) -> str | None:
    with open(TICKETS_DB, "r+") as f:
        tickets = json.load(f)
        for ticket in tickets:
            if (
                ticket.get("escalation_channel") == "telegram"
                and ticket.get("bot_token") == bot_token
                and ticket.get("chat_id") is None
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

@app.post("/telegram-webhook/{bot_token}")
async def telegram_webhook(bot_token: str, update: TelegramUpdate):
    try:
        msg = update.message
        chat_id = str(msg["chat"]["id"])
        user_text = msg.get("text")
        logging.info(f"chat_id :{chat_id} user text : {user_text}")

        if not user_text:
            return {"status": "ignored", "reason": "No text"}

        session_id = get_session_id_for_bot_token(bot_token) or auto_bind_chat_id(bot_token, chat_id)
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
        response_gen = await query_handler.aprocess_query(user_input, session_id, agent_id)
        full_response = ""

        async for chunk in response_gen:
            if chunk:
                full_response += chunk
                yield chunk

        if full_response:
            logging.info(f"Response Generated: {full_response}")
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


@app.on_event("startup")
async def setup_webhooks():
    # Sometimes, Telegram webhooks fail during FastAPI cold startup if the public domain isn’t reachable yet (e.g., in ngrok, Docker, Cloud Run).
    await asyncio.sleep(2)  # Give services a bit of time to settle
    try:
        # Replace with your actual public URL or tunnel URL (e.g. ngrok)
        BASE_WEBHOOK_URL = "https://4c95afbebd82.ngrok-free.app"  # Change this

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
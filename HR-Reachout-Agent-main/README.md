## 🚀 Project Setup & Run Guide

This repository contains multiple components:

* UI (Agent Chat)
* Admin Panel
* FastAPI Backend
* Voice Agent Backend
* Telegram Escalation Handling
* Website Chat Widget Integration

## 🖥️ UI – Agent Chat

* Navigate to frontend directory
* Start development server

```bash
cd frontend
npm run dev
```

* App will start in development mode
* Make sure backend is running for full functionality

---

## 🧑‍💼 Admin Panel

* Navigate to admin directory
* Start development server

```bash
cd admin
npm run dev
```

* Used for managing agents, configurations, and escalations

---

## ⚙️ FastAPI Backend Server

* Start the FastAPI server using `uvicorn`

```bash
uvicorn FastAPI-server.main:app
```

### ⚠️ Suggestions (Important)

* You **should** add `--reload` for development:

```bash
uvicorn FastAPI-server.main:app --reload
```

* If this runs on a different port, update frontend configs accordingly

---

## 🎙️ Voice Agent Backend

* Navigate to Voice Manager backend
* Run agent in development mode

```bash
cd VoiceManagerBE
python agent.py dev
```

## 📲 Telegram Escalation Handling

* Telegram escalations are stored locally
* Before testing new escalations:

```bash
ngrok http 8000
# paste the generated link in main.py
```
and 

```text
Clear escalation tickets in:
ticket_store.json
```

### Why this matters

* Old tickets can block or confuse new escalation flows
* Always reset before testing fresh scenarios

## 🌐 Website Chat Widget Integration

Use the following JavaScript snippet to embed the chat widget into any website.

### 🔧 Configuration

* Replace `add agent id` with your actual agent ID

```js
const agentId = "add agent id";

const iframe = document.createElement('iframe');
iframe.src = `http://localhost:8080/user/mini?agent_id=${agentId}`;
iframe.style.position = 'fixed';
iframe.style.bottom = '10px';
iframe.style.right = '10px';
iframe.style.width = '600px';
iframe.style.height = '800px';
iframe.style.zIndex = '9999';
iframe.style.border = 'none';
iframe.style.background = 'transparent';
iframe.allow = 'microphone; camera';
iframe.setAttribute('allowtransparency', 'true');

document.body.appendChild(iframe);
```

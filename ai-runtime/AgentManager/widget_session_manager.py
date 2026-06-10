"""
Persist widget chat sessions for the admin dashboard (JSON file store).
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

WIDGET_SESSIONS_DB = os.environ.get(
    "WIDGET_SESSIONS_DB",
    os.path.join(os.getcwd(), "widget_sessions_store.json"),
)


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _load() -> List[Dict[str, Any]]:
    if not os.path.exists(WIDGET_SESSIONS_DB):
        return []
    try:
        with open(WIDGET_SESSIONS_DB, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.error(f"[WidgetSessions] load failed: {e}")
        return []


def _save(sessions: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(WIDGET_SESSIONS_DB) or ".", exist_ok=True)
    with open(WIDGET_SESSIONS_DB, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)


def parse_whatsapp_user_phone(session_id: str) -> str:
    """Session format: whatsapp_{waba_id}_{phone_number_id}_{user_phone}."""
    if not session_id or not session_id.startswith("whatsapp_"):
        return ""
    parts = session_id.split("_")
    if len(parts) < 4:
        return ""
    phone = parts[-1].strip()
    if phone.isdigit() and len(phone) >= 8:
        return f"+{phone}" if not phone.startswith("+") else phone
    return phone


def channel_for_session(session_id: str) -> str:
    if not session_id:
        return "other"
    if session_id.startswith("whatsapp_"):
        return "whatsapp"
    if session_id.startswith("widget_") or session_id.startswith("w_"):
        return "website_widget"
    if session_id.startswith("anon_"):
        return "site_chat"
    if session_id.startswith("session_"):
        return "ai_agent"
    return "other"


def _parse_agent_id_from_session(session_id: str) -> str:
    """Extract agent id from widget session ids: widget_{agentId}_{suffix}."""
    if not session_id.startswith("widget_"):
        return ""
    rest = session_id[len("widget_") :]
    try:
        agents_path = os.environ.get(
            "AGENTS_DB",
            os.path.join(os.getcwd(), "Agents_store.json"),
        )
        if os.path.exists(agents_path):
            with open(agents_path, "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                aid = a.get("id") or ""
                if aid and rest.startswith(f"{aid}_"):
                    return aid
    except Exception:
        pass
    return ""


def _load_agent_name(agent_id: str) -> str:
    if not agent_id:
        return ""
    try:
        agents_path = os.environ.get(
            "AGENTS_DB",
            os.path.join(os.getcwd(), "Agents_store.json"),
        )
        if os.path.exists(agents_path):
            with open(agents_path, "r", encoding="utf-8") as f:
                agents = json.load(f)
            for a in agents:
                if a.get("id") == agent_id:
                    return a.get("name", "") or ""
    except Exception as e:
        logger.warning(f"[WidgetSessions] agent name lookup failed: {e}")
    return ""


def channel_label(channel: str) -> str:
    return {
        "website_widget": "Website Widget",
        "ai_agent": "AI Agent",
        "site_chat": "Site Chat",
        "whatsapp": "WhatsApp",
        "other": "Other",
    }.get(channel, channel or "Other")


def is_widget_session(session_id: str) -> bool:
    if not session_id:
        return False
    return (
        session_id.startswith("widget_")
        or session_id.startswith("w_")
        or session_id.startswith("anon_")
    )


def upsert_session(
    session_id: str,
    agent_id: str,
    agent_name: str = "",
    origin: str = "",
    page_url: str = "",
    channel: str = "",
) -> Dict[str, Any]:
    sessions = _load()
    existing = next((s for s in sessions if s.get("session_id") == session_id), None)
    now = _now_iso()

    if existing:
        existing["last_activity_at"] = now
        if agent_id:
            existing["agent_id"] = agent_id
        if agent_name:
            existing["agent_name"] = agent_name
        if origin:
            existing["origin"] = origin
        if page_url:
            existing["page_url"] = page_url
        if channel:
            existing["channel"] = channel
        _save(sessions)
        return existing

    ch = channel or channel_for_session(session_id)
    record = {
        "session_id": session_id,
        "agent_id": agent_id or "",
        "agent_name": agent_name or "",
        "origin": origin or "",
        "page_url": page_url or "",
        "channel": ch,
        "status": "active",
        "contact": {"name": "", "email": "", "phone": ""},
        "message_count": 0,
        "started_at": now,
        "last_activity_at": now,
        "completed_at": None,
        "completion_reason": None,
        "summary": "",
        "whatsapp_sent": False,
    }
    sessions.append(record)
    _save(sessions)
    return record


def touch_activity(session_id: str, increment_messages: int = 0) -> Optional[Dict[str, Any]]:
    sessions = _load()
    for s in sessions:
        if s.get("session_id") == session_id:
            s["last_activity_at"] = _now_iso()
            if increment_messages:
                s["message_count"] = int(s.get("message_count") or 0) + increment_messages
            _save(sessions)
            return s
    return None


def update_contact(session_id: str, name: str = "", email: str = "", phone: str = "") -> Optional[Dict[str, Any]]:
    sessions = _load()
    for s in sessions:
        if s.get("session_id") == session_id:
            contact = s.setdefault("contact", {})
            if name:
                contact["name"] = name.strip()
            if email:
                contact["email"] = email.strip()
            if phone:
                contact["phone"] = phone.strip()
            s["last_activity_at"] = _now_iso()
            _save(sessions)
            return s
    return None


def mark_completed(
    session_id: str,
    reason: str = "inactivity",
    summary: str = "",
    whatsapp_sent: bool = False,
) -> Optional[Dict[str, Any]]:
    sessions = _load()
    for s in sessions:
        if s.get("session_id") == session_id:
            if s.get("status") == "completed":
                return s
            s["status"] = "completed"
            s["completed_at"] = _now_iso()
            s["completion_reason"] = reason
            if summary:
                s["summary"] = summary
            s["whatsapp_sent"] = whatsapp_sent
            _save(sessions)
            return s
    return None


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    found = next((s for s in _load() if s.get("session_id") == session_id), None)
    return _enrich_record(dict(found)) if found else None


def _session_from_redis(session_id: str, message_count: int = 0) -> Dict[str, Any]:
    now = _now_iso()
    ch = channel_for_session(session_id)
    return {
        "session_id": session_id,
        "agent_id": "",
        "agent_name": "",
        "origin": "",
        "page_url": "",
        "channel": ch,
        "channel_label": channel_label(ch),
        "status": "active",
        "contact": {"name": "", "email": "", "phone": ""},
        "message_count": message_count,
        "started_at": now,
        "last_activity_at": now,
        "completed_at": None,
        "completion_reason": None,
        "summary": "",
        "whatsapp_sent": False,
        "from_redis_only": True,
    }


def _enrich_record(record: Dict[str, Any]) -> Dict[str, Any]:
    sid = record.get("session_id", "")
    ch = record.get("channel") or channel_for_session(sid)
    record["channel"] = ch
    record["channel_label"] = channel_label(ch)
    if ch == "whatsapp":
        contact = record.setdefault("contact", {})
        if not contact.get("phone"):
            wa_phone = parse_whatsapp_user_phone(sid)
            if wa_phone:
                contact["phone"] = wa_phone
    return record


def list_sessions(
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: int = 100,
    chat_history_handler=None,
) -> List[Dict[str, Any]]:
    stored_list = _load()
    by_id: Dict[str, Dict[str, Any]] = {
        s["session_id"]: _enrich_record(dict(s)) for s in stored_list if s.get("session_id")
    }

    if chat_history_handler is not None:
        try:
            for sid in chat_history_handler.list_chatbot_session_ids():
                msgs = chat_history_handler.get_chat_history(sid)
                count = len(msgs) if msgs else 0
                if count == 0:
                    continue
                if sid in by_id:
                    by_id[sid]["message_count"] = max(
                        int(by_id[sid].get("message_count") or 0), count
                    )
                else:
                    rec = _enrich_record(_session_from_redis(sid, count))
                    if not rec.get("agent_id"):
                        aid = _parse_agent_id_from_session(sid)
                        if aid:
                            rec["agent_id"] = aid
                            rec["agent_name"] = _load_agent_name(aid)
                    by_id[sid] = rec
                if sid in by_id and not by_id[sid].get("agent_name") and by_id[sid].get("agent_id"):
                    by_id[sid]["agent_name"] = _load_agent_name(by_id[sid]["agent_id"])
        except Exception as e:
            logger.error(f"[WidgetSessions] Redis merge failed: {e}")

    sessions = list(by_id.values())
    if status:
        sessions = [s for s in sessions if s.get("status") == status]
    if agent_id:
        sessions = [s for s in sessions if s.get("agent_id") == agent_id]
    sessions.sort(key=lambda x: x.get("last_activity_at") or "", reverse=True)
    return sessions[:limit]


def compute_stats(days: int = 30, chat_history_handler=None) -> Dict[str, Any]:
    sessions = list_sessions(limit=10_000, chat_history_handler=chat_history_handler)
    cutoff = datetime.utcnow() - timedelta(days=days)
    recent = []
    for s in sessions:
        ts = s.get("started_at") or ""
        try:
            dt = datetime.fromisoformat(ts.replace("Z", ""))
            if dt >= cutoff:
                recent.append(s)
        except Exception:
            recent.append(s)

    total = len(recent)
    active = sum(1 for s in recent if s.get("status") == "active")
    completed = sum(1 for s in recent if s.get("status") == "completed")
    with_contact = sum(
        1
        for s in recent
        if any((s.get("contact") or {}).get(k) for k in ("name", "email", "phone"))
    )
    wa_sent = sum(1 for s in recent if s.get("whatsapp_sent"))

    # Daily chat counts for chart (last 7 days)
    daily: Dict[str, int] = {}
    for i in range(7):
        d = (datetime.utcnow() - timedelta(days=6 - i)).strftime("%Y-%m-%d")
        daily[d] = 0
    for s in recent:
        day = (s.get("started_at") or "")[:10]
        if day in daily:
            daily[day] += 1

    source_counts: Dict[str, int] = {}
    for s in recent:
        label = s.get("channel_label") or channel_label(s.get("channel", ""))
        source_counts[label] = source_counts.get(label, 0) + 1
    sources = [
        {
            "source": name,
            "count": count,
            "percent": round((count / total) * 100) if total else 0,
        }
        for name, count in sorted(source_counts.items(), key=lambda x: -x[1])
    ]
    if not sources:
        sources = [{"source": "Website Widget", "count": 0, "percent": 0}]

    return {
        "total_chats": total,
        "active_chats": active,
        "completed_chats": completed,
        "leads_with_contact": with_contact,
        "whatsapp_summaries_sent": wa_sent,
        "daily_chats": [{"date": k, "count": v} for k, v in sorted(daily.items())],
        "sources": sources,
    }

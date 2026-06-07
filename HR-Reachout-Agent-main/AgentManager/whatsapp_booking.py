"""WhatsApp gym visit booking: CSV slots, session state, leads + Excel."""
from __future__ import annotations

import csv
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLOTS_CSV = os.path.join(_ROOT, "data", "gym_24_hour_booking_slots.csv")
SLOTS_RUNTIME = os.path.join(_ROOT, "data", "whatsapp_booking_slots_runtime.json")
STATE_PATH = os.path.join(_ROOT, "data", "whatsapp_booking_sessions.json")
LEADS_DB = os.path.join(_ROOT, "leads_store.json")
BOOKINGS_EXCEL = os.path.join(_ROOT, "Gym_Visit_Bookings.xlsx")
BOOKING_CONFIRM_IMAGE = os.path.join(_ROOT, "temp_files", "ssquare-booking-confirmed.png")

BOOK_VISIT_ID = "book_visit"
PERIOD_PREFIX = "book_period_"
SLOT_PREFIX = "slot_"

BOOKING_KEYWORDS = (
    "book",
    "booking",
    "appointment",
    "schedule",
    "visit",
    "book a visit",
    "book visit",
)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")


def _period_row_id(period: str) -> str:
    return f"{PERIOD_PREFIX}{_slug(period)}"


def _slot_row_id(slot_id: str) -> str:
    return f"{SLOT_PREFIX}{slot_id}"


def _parse_period_from_row_id(row_id: str) -> Optional[str]:
    if not row_id.startswith(PERIOD_PREFIX):
        return None
    slug = row_id[len(PERIOD_PREFIX) :]
    for period in _unique_periods(_load_slots()):
        if _slug(period) == slug:
            return period
    return None


def _parse_slot_id_from_row_id(row_id: str) -> Optional[str]:
    rid = (row_id or "").strip()
    if len(rid) <= len(SLOT_PREFIX) or not rid.lower().startswith(SLOT_PREFIX):
        return None
    # Preserve original casing (e.g. SLOT-001); do not lowercase the full row id.
    return rid[len(SLOT_PREFIX) :]


def _format_time_12h(t: str) -> str:
    t = (t or "").strip()
    if not t:
        return t
    parts = t.split(":")
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 else 0
    suffix = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {suffix}"


def _load_slots() -> List[Dict[str, Any]]:
    if os.path.exists(SLOTS_RUNTIME):
        try:
            with open(SLOTS_RUNTIME, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass

    slots: List[Dict[str, Any]] = []
    if not os.path.exists(SLOTS_CSV):
        logger.warning("Booking slots CSV missing: %s", SLOTS_CSV)
        return slots

    with open(SLOTS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            slots.append(
                {
                    "slot_id": row.get("slot_id", "").strip(),
                    "start_time": row.get("start_time", "").strip(),
                    "end_time": row.get("end_time", "").strip(),
                    "duration_minutes": int(row.get("duration_minutes") or 30),
                    "day_period": row.get("day_period", "").strip(),
                    "max_bookings": int(row.get("max_bookings") or 20),
                    "current_bookings": int(row.get("current_bookings") or 0),
                    "available_slots": int(row.get("available_slots") or 20),
                    "status": row.get("status", "Available").strip(),
                }
            )
    _save_slots_runtime(slots)
    return slots


def _save_slots_runtime(slots: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(SLOTS_RUNTIME), exist_ok=True)
    with open(SLOTS_RUNTIME, "w", encoding="utf-8") as f:
        json.dump(slots, f, indent=2)


def _unique_periods(slots: List[Dict[str, Any]]) -> List[str]:
    seen: List[str] = []
    for s in slots:
        p = s.get("day_period") or ""
        if p and p not in seen:
            seen.append(p)
    return seen


def _slots_for_period(slots: List[Dict[str, Any]], period: str) -> List[Dict[str, Any]]:
    out = [s for s in slots if s.get("day_period") == period and _slot_available(s)]
    return out[:10]


def _slot_available(slot: Dict[str, Any]) -> bool:
    if (slot.get("status") or "").lower() != "available":
        return False
    avail = int(slot.get("available_slots") or 0)
    cur = int(slot.get("current_bookings") or 0)
    mx = int(slot.get("max_bookings") or 0)
    return avail > 0 and cur < mx


def _get_slot(slots: List[Dict[str, Any]], slot_id: str) -> Optional[Dict[str, Any]]:
    needle = (slot_id or "").strip().upper()
    if not needle:
        return None
    for s in slots:
        if (s.get("slot_id") or "").strip().upper() == needle:
            return s
    return None


def _load_state() -> Dict[str, Any]:
    if not os.path.exists(STATE_PATH):
        return {}
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_state(data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_session_state(session_id: str) -> Dict[str, Any]:
    return dict(_load_state().get(session_id) or {})


def set_session_state(session_id: str, state: Dict[str, Any]) -> None:
    store = _load_state()
    if state:
        store[session_id] = state
    elif session_id in store:
        del store[session_id]
    _save_state(store)


def clear_session_state(session_id: str) -> None:
    set_session_state(session_id, {})


def is_booking_selection(selection_id: str) -> bool:
    sid = (selection_id or "").strip().lower()
    return (
        sid == BOOK_VISIT_ID
        or sid.startswith(PERIOD_PREFIX)
        or sid.startswith(SLOT_PREFIX)
    )


def is_booking_intent(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return any(k in t for k in BOOKING_KEYWORDS)


def send_period_picker(
    api, to_phone: str, inbound_message_id: str | None = None
) -> None:
    slots = _load_slots()
    rows = []
    for period in _unique_periods(slots):
        count = len([s for s in slots if s.get("day_period") == period and _slot_available(s)])
        if count == 0:
            continue
        rows.append(
            {
                "id": _period_row_id(period),
                "title": period[:24],
                "description": f"{count} slots available"[:72],
            }
        )
    if not rows:
        _typing_then_send(
            api,
            to_phone,
            "Sorry, no visit slots are available right now. Please try again later or call us.",
            inbound_message_id,
        )
        return
    if inbound_message_id and hasattr(api, "pause_with_typing"):
        api.pause_with_typing(inbound_message_id, 1.0)
    api.send_interactive_list(
        to_phone,
        header="Book a gym visit",
        body="Choose a time of day for your visit:",
        button_label="Select period",
        rows=rows,
        section_title="Time of day",
    )


def send_slot_picker(
    api, to_phone: str, period: str, inbound_message_id: str | None = None
) -> None:
    slots = _slots_for_period(_load_slots(), period)
    if not slots:
        _typing_then_send(
            api,
            to_phone,
            f"No open slots in *{period}*. Reply *book* to pick another time.",
            inbound_message_id,
        )
        return
    if inbound_message_id and hasattr(api, "pause_with_typing"):
        api.pause_with_typing(inbound_message_id, 1.0)
    rows = []
    for s in slots:
        start = _format_time_12h(s.get("start_time", ""))
        end = _format_time_12h(s.get("end_time", ""))
        rows.append(
            {
                "id": _slot_row_id(s["slot_id"]),
                "title": f"{start} - {end}"[:24],
                "description": f"{s.get('available_slots', 0)} spots left"[:72],
            }
        )
    api.send_interactive_list(
        to_phone,
        header=period[:60],
        body="Pick your preferred 30-minute visit slot:",
        button_label="Select time",
        rows=rows,
        section_title="Available slots",
    )


def start_booking(
    api,
    to_phone: str,
    session_id: str,
    inbound_message_id: str | None = None,
) -> None:
    set_session_state(session_id, {"step": "choosing_period"})
    _typing_then_send(
        api,
        to_phone,
        "📅 *Book a gym visit*\n\nLet's find a time that works for you.",
        inbound_message_id,
    )
    send_period_picker(api, to_phone, inbound_message_id=inbound_message_id)


def _book_slot(slot_id: str) -> Optional[Dict[str, Any]]:
    slots = _load_slots()
    slot = _get_slot(slots, slot_id)
    if not slot or not _slot_available(slot):
        return None
    slot["current_bookings"] = int(slot.get("current_bookings") or 0) + 1
    slot["available_slots"] = max(
        0, int(slot.get("max_bookings") or 0) - int(slot["current_bookings"])
    )
    if slot["available_slots"] <= 0:
        slot["status"] = "Full"
    _save_slots_runtime(slots)
    return slot


def _save_lead(
    *,
    session_id: str,
    name: str,
    phone: str,
    agent_id: str,
    slot: Dict[str, Any],
) -> None:
    start = slot.get("start_time", "")
    end = slot.get("end_time", "")
    period = slot.get("day_period", "")
    slot_id = slot.get("slot_id", "")
    summary = (
        f"Gym visit booked: {period}, {_format_time_12h(start)}–{_format_time_12h(end)} "
        f"(slot {slot_id})."
    )
    captured_at = datetime.now(timezone.utc).isoformat()
    lead = {
        "session_id": session_id,
        "name": name,
        "email": "",
        "phone": phone,
        "summary": summary,
        "captured_at": captured_at,
        "whatsapp_sent": False,
        "source": "WhatsApp Booking",
        "agent_id": agent_id or "",
        "booking": {
            "slot_id": slot_id,
            "day_period": period,
            "start_time": start,
            "end_time": end,
        },
    }
    try:
        leads: List[Dict[str, Any]] = []
        if os.path.exists(LEADS_DB):
            with open(LEADS_DB, "r", encoding="utf-8") as f:
                leads = json.load(f)
        if not isinstance(leads, list):
            leads = []
        leads.append(lead)
        with open(LEADS_DB, "w", encoding="utf-8") as f:
            json.dump(leads, f, indent=2)
    except Exception as e:
        logger.error("Failed to save booking lead: %s", e)

    try:
        import pandas as pd

        row = {
            "Timestamp": captured_at,
            "Session_ID": session_id,
            "Name": name,
            "Phone": phone,
            "Slot_ID": slot_id,
            "Day_Period": period,
            "Start_Time": start,
            "End_Time": end,
            "Agent_ID": agent_id or "",
        }
        df_new = pd.DataFrame([row])
        if os.path.exists(BOOKINGS_EXCEL):
            with pd.ExcelWriter(BOOKINGS_EXCEL, engine="openpyxl", mode="a", if_sheet_exists="overlay") as writer:
                existing = pd.read_excel(BOOKINGS_EXCEL)
                df_new.to_excel(writer, index=False, header=False, startrow=len(existing) + 1)
        else:
            df_new.to_excel(BOOKINGS_EXCEL, index=False)
    except Exception as e:
        logger.error("Failed to save booking Excel: %s", e)


def _booking_confirmation_image_path() -> str:
    if os.path.isfile(BOOKING_CONFIRM_IMAGE):
        return BOOKING_CONFIRM_IMAGE
    return ""


def _typing_then_send(
    api,
    to_phone: str,
    text: str,
    inbound_message_id: str | None,
    *,
    typing_seconds: float = 1.2,
) -> None:
    if inbound_message_id and hasattr(api, "pause_with_typing"):
        api.pause_with_typing(inbound_message_id, typing_seconds)
    api.send_whatsapp_message(to_phone, text)


def _send_booking_confirmation(
    api,
    to_phone: str,
    text: str,
    inbound_message_id: str | None,
    *,
    typing_seconds: float = 1.5,
) -> None:
    """Send booking success with gym photo (caption = confirmation text)."""
    if inbound_message_id and hasattr(api, "pause_with_typing"):
        api.pause_with_typing(inbound_message_id, typing_seconds)

    image_path = _booking_confirmation_image_path()
    if image_path and hasattr(api, "send_image_from_file"):
        result = api.send_image_from_file(
            to_phone,
            image_path,
            caption=text[:1024],
        )
        if result.get("status") == "success":
            return
        logger.warning("Booking confirmation image failed: %s", result.get("error"))

    api.send_whatsapp_message(to_phone, text)


def handle_selection(
    api,
    to_phone: str,
    session_id: str,
    selection_id: str,
    phone: str,
    agent_id: str,
    inbound_message_id: str | None = None,
) -> bool:
    sid = (selection_id or "").strip()
    lower = sid.lower()

    if lower == BOOK_VISIT_ID:
        start_booking(api, to_phone, session_id, inbound_message_id=inbound_message_id)
        return True

    if lower.startswith(PERIOD_PREFIX):
        period = _parse_period_from_row_id(lower)
        if period:
            set_session_state(session_id, {"step": "choosing_slot", "period": period})
            send_slot_picker(api, to_phone, period, inbound_message_id=inbound_message_id)
            return True

    if lower.startswith(SLOT_PREFIX):
        slot_id = _parse_slot_id_from_row_id(sid)
        if not slot_id:
            return False
        slot = _book_slot(slot_id)
        if not slot:
            _typing_then_send(
                api,
                to_phone,
                "That slot was just taken. Reply *book* to choose another time.",
                inbound_message_id,
            )
            clear_session_state(session_id)
            return True
        set_session_state(
            session_id,
            {
                "step": "awaiting_name",
                "slot_id": slot.get("slot_id") or slot_id,
                "slot": slot,
                "phone": phone,
                "agent_id": agent_id,
            },
        )
        start_l = _format_time_12h(slot.get("start_time", ""))
        end_l = _format_time_12h(slot.get("end_time", ""))
        _typing_then_send(
            api,
            to_phone,
            f"Great! You selected *{start_l} – {end_l}* ({slot.get('day_period', '')}).\n\n"
            "Please reply with your *full name* to confirm the booking.",
            inbound_message_id,
        )
        return True

    return False


def handle_text_message(
    api,
    to_phone: str,
    session_id: str,
    text: str,
    phone: str,
    agent_id: str,
    inbound_message_id: str | None = None,
) -> bool:
    state = get_session_state(session_id)
    step = state.get("step")

    if step == "awaiting_name":
        name = (text or "").strip()
        if len(name) < 2 or name.lower() in ("menu", "book", "cancel"):
            _typing_then_send(
                api,
                to_phone,
                "Please send your full name (at least 2 characters) to confirm your visit.",
                inbound_message_id,
            )
            return True
        slot = state.get("slot") or _get_slot(_load_slots(), state.get("slot_id", ""))
        if not slot:
            _typing_then_send(
                api,
                to_phone,
                "Your session expired. Reply *book* to start again.",
                inbound_message_id,
            )
            clear_session_state(session_id)
            return True
        _save_lead(
            session_id=session_id,
            name=name,
            phone=phone,
            agent_id=state.get("agent_id") or agent_id,
            slot=slot,
        )
        start_l = _format_time_12h(slot.get("start_time", ""))
        end_l = _format_time_12h(slot.get("end_time", ""))
        confirmation = (
            f"✅ *Visit booked!*\n\n"
            f"Name: {name}\n"
            f"Phone: +{str(phone).lstrip('+')}\n"
            f"Time: {start_l} – {end_l} ({slot.get('day_period', '')})\n\n"
            "We look forward to seeing you at S Square Fitness Club! "
            "Reply *menu* anytime for services."
        )
        _send_booking_confirmation(
            api,
            to_phone,
            confirmation,
            inbound_message_id,
            typing_seconds=1.5,
        )
        clear_session_state(session_id)
        return True

    if is_booking_intent(text):
        start_booking(api, to_phone, session_id, inbound_message_id=inbound_message_id)
        return True

    return False

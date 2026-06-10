"""WhatsApp greeting, service menu, and BCA reminder helpers."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

GREETING_KEYWORDS = (
    "hi",
    "hello",
    "hey",
    "hii",
    "hola",
    "good morning",
    "good afternoon",
    "good evening",
    "namaste",
    "start",
)

DEFAULT_SSQUARE_SERVICES: List[Dict[str, str]] = [
    {
        "id": "membership",
        "title": "Membership Plans",
        "description": (
            "Monthly ₹3,200 | 3 Months ₹7,500 | 6 Months ₹9,500 | Yearly ₹16,500. "
            "Includes weight training, yoga, zumba, cardio, aerobics & crossfit."
        ),
    },
    {
        "id": "facilities",
        "title": "Facilities & Amenities",
        "description": (
            "7500 sq ft club in Pimple Saudagar with modern equipment, exciting group classes, "
            "rehab programs, and a motivating community."
        ),
    },
    {
        "id": "bca",
        "title": "BCA Body Check-up",
        "description": (
            "Track your progress with BCA at reception. We recommend every 45 days "
            "to monitor body composition and stay on track."
        ),
    },
    {
        "id": "contact",
        "title": "Visit & Contact",
        "description": (
            "1st Floor, Kokane Height, near Chhatrapati Shivaji Maharaj Statue, "
            "Rahatani Chowk, Pimple Saudagar 411027. Call 744 744 6787 / 957 935 9119."
        ),
    },
    {
        "id": "book_visit",
        "title": "Book a Gym Visit",
        "description": (
            "Schedule a 30-minute visit slot at the club. Pick a time, share your name, "
            "and we will confirm your appointment."
        ),
    },
]

BCA_STORE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "whatsapp_bca_reminders.json",
)


def is_greeting_message(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return any(t == g or t.startswith(f"{g} ") for g in GREETING_KEYWORDS)


def parse_channel_config(channel: Dict[str, Any]) -> Dict[str, Any]:
    raw = channel.get("config_json") or channel.get("config") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        raw = {}

    services = raw.get("services")
    if not isinstance(services, list) or not services:
        services = DEFAULT_SSQUARE_SERVICES
    else:
        ids = {str(s.get("id", "")).lower() for s in services if isinstance(s, dict)}
        if "book_visit" not in ids:
            book_svc = next(
                (s for s in DEFAULT_SSQUARE_SERVICES if s.get("id") == "book_visit"),
                None,
            )
            if book_svc:
                services = list(services) + [book_svc]

    welcome_message = (
        raw.get("welcome_message")
        or channel.get("welcome_message")
        or (
            "Welcome to *S Square Fitness Club*! 🏋️\n\n"
            "Pune's trusted fitness destination since 2011. "
            "Our certified trainers are here to help you reach your goals."
        )
    )

    service_menu_message = (
        raw.get("service_menu_message")
        or "Please select a service below to learn more:"
    )

    welcome_image_url = raw.get("welcome_image_url") or "/files/ssquare-welcome-team.png"

    bca = raw.get("bca_reminder") if isinstance(raw.get("bca_reminder"), dict) else {}
    bca_reminder = {
        "enabled": bool(bca.get("enabled", False)),
        "interval_days": int(bca.get("interval_days") or 45),
        "message": bca.get("message")
        or (
            "Hi! Your *BCA (body composition) check-up* is due. "
            "Please visit reception for a quick scan — it helps you monitor progress. "
            "We recommend BCA every 45 days. 💪"
        ),
    }

    welcome_timing = raw.get("welcome_timing") if isinstance(raw.get("welcome_timing"), dict) else {}

    return {
        "welcome_message": str(welcome_message).strip(),
        "service_menu_message": str(service_menu_message).strip(),
        "welcome_image_url": str(welcome_image_url).strip(),
        "services": services,
        "bca_reminder": bca_reminder,
        "welcome_timing": welcome_timing,
    }


def resolve_welcome_image_path(image_ref: str) -> str:
    """Map config path like /files/ssquare-welcome-team.png to a local file."""
    ref = (image_ref or "").strip()
    if not ref:
        return ""
    if ref.startswith("http://") or ref.startswith("https://"):
        return ""
    name = ref.split("/")[-1] or ref
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.path.join(root, "temp_files", name),
        os.path.join(root, "temp_files", ref.lstrip("/")),
        os.path.join(os.path.dirname(root), "server", "uploads", name),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return ""


def _public_url(relative_or_absolute: str, public_base: str) -> str:
    url = (relative_or_absolute or "").strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    base = (public_base or "").strip().rstrip("/")
    if not base:
        return ""
    if url.startswith("/"):
        return f"{base}{url}"
    return f"{base}/{url.lstrip('/')}"


def find_service_by_id(services: List[Dict[str, Any]], service_id: str) -> Optional[Dict[str, Any]]:
    sid = (service_id or "").strip().lower()
    for item in services:
        if str(item.get("id", "")).lower() == sid:
            return item
    return None


def resolve_service_selection(
    services: List[Dict[str, Any]],
    selection_id: str,
    selection_title: str | None = None,
) -> Optional[Dict[str, Any]]:
    """Match menu tap by row id, visible title, or fuzzy text."""
    service = find_service_by_id(services, selection_id)
    if service:
        return service
    title = (selection_title or "").strip()
    if title:
        for item in services:
            if str(item.get("title", "")).strip().lower() == title.lower():
                return item
        service = match_service_from_text(title, services)
        if service:
            return service
    return match_service_from_text(selection_id, services)


def match_service_from_text(text: str, services: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    t = (text or "").strip().lower()
    if not t:
        return None
    for item in services:
        sid = str(item.get("id", "")).lower()
        title = str(item.get("title", "")).lower()
        if t == sid or t == title or sid in t or title in t:
            return item
    if t.isdigit():
        idx = int(t) - 1
        if 0 <= idx < len(services):
            return services[idx]
    return None


def service_as_user_message(
    service: Dict[str, Any],
    *,
    selection_title: str | None = None,
) -> str:
    """Use the menu label as the user message so RAG/AI handles it like typed text."""
    title = (selection_title or service.get("title") or "").strip()
    if title:
        return title
    sid = (service.get("id") or "").strip().replace("_", " ")
    return sid or "Tell me about your services"


def _load_bca_store() -> Dict[str, str]:
    if not os.path.exists(BCA_STORE_PATH):
        return {}
    try:
        with open(BCA_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_bca_store(data: Dict[str, str]) -> None:
    os.makedirs(os.path.dirname(BCA_STORE_PATH), exist_ok=True)
    with open(BCA_STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def record_bca_completed(phone: str) -> None:
    key = re.sub(r"\D", "", str(phone or ""))
    if not key:
        return
    store = _load_bca_store()
    store[key] = datetime.now(timezone.utc).isoformat()
    _save_bca_store(store)


def phones_due_for_bca(interval_days: int) -> List[str]:
    """Phones that completed BCA before and are due for a follow-up reminder."""
    store = _load_bca_store()
    due: List[str] = []
    now = datetime.now(timezone.utc)
    for phone_digits, iso in store.items():
        try:
            last = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            days = (now - last).days
            if days >= interval_days:
                due.append(phone_digits)
        except Exception as exc:
            logger.warning("Skipping BCA reminder for %s: bad timestamp %r (%s)", phone_digits, iso, exc)
    return due


def register_phone_for_bca(phone: str) -> None:
    """No-op: reminders only go to users who completed BCA via the menu (record_bca_completed)."""
    del phone


def _welcome_timing(cfg: Dict[str, Any]) -> Dict[str, float]:
    """Delays (seconds) between welcome steps — configurable via channel config or env."""
    timing = cfg.get("welcome_timing") if isinstance(cfg.get("welcome_timing"), dict) else {}
    after_greeting = timing.get("after_greeting_sec") or timing.get("before_menu_sec")
    return {
        "after_image": float(
            timing.get("after_image_sec")
            or os.getenv("WHATSAPP_WELCOME_DELAY_AFTER_IMAGE", "2.0")
        ),
        "after_greeting": float(
            after_greeting or os.getenv("WHATSAPP_WELCOME_DELAY_AFTER_GREETING", "8.0")
        ),
        "menu_typing": float(
            timing.get("menu_typing_sec")
            or os.getenv("WHATSAPP_WELCOME_DELAY_MENU_TYPING", "3.0")
        ),
    }


def send_welcome_flow(
    api,
    to_phone: str,
    cfg: Dict[str, Any],
    public_base: str,
    inbound_message_id: str | None = None,
) -> None:
    """Send welcome image/text only — no delayed follow-up messages. User replies *menu* for services."""
    image_url = _public_url(cfg.get("welcome_image_url") or "", public_base)
    greeting_text = (cfg.get("welcome_message") or "Welcome to S Square Fitness Club!").strip()
    menu_hint = "Reply *menu* anytime to see our services."

    if inbound_message_id:
        api.mark_message_read(inbound_message_id)

    # 1) Greeting phase — image with welcome text as caption (no dead ngrok URL needed)
    image_ref = cfg.get("welcome_image_url") or ""
    local_image = resolve_welcome_image_path(image_ref)
    if not local_image:
        local_image = resolve_welcome_image_path("/files/ssquare-welcome-team.png")
    full_greeting = f"{greeting_text}\n\n{menu_hint}".strip()
    image_caption = full_greeting[:1024]
    image_sent = False

    if local_image and hasattr(api, "send_image_from_file"):
        img_result = api.send_image_from_file(
            to_phone,
            local_image,
            caption=image_caption,
        )
        if img_result.get("status") == "success":
            image_sent = True
        elif image_url:
            logger.warning(
                "Welcome image upload failed (%s), trying public URL",
                img_result.get("error"),
            )
            url_result = api.send_image_message(to_phone, image_url, caption=image_caption)
            image_sent = url_result.get("status") == "success"
    elif image_url:
        img_result = api.send_image_message(to_phone, image_url, caption=image_caption)
        if img_result.get("status") == "success":
            image_sent = True
        else:
            logger.warning("Welcome image URL failed: %s", img_result.get("error"))

    if not image_sent and greeting_text:
        body = f"{greeting_text}\n\n{menu_hint}"
        api.send_whatsapp_message(
            to_phone,
            body,
            inbound_message_id=inbound_message_id,
            typing_seconds=1.0 if inbound_message_id else 0,
        )
    elif not image_sent and (local_image or image_url):
        logger.error(
            "Welcome image could not be delivered to %s (local=%s url=%s)",
            to_phone,
            bool(local_image),
            bool(image_url),
        )
        api.send_whatsapp_message(
            to_phone,
            f"{greeting_text}\n\n{menu_hint}".strip(),
            inbound_message_id=inbound_message_id,
            typing_seconds=1.0 if inbound_message_id else 0,
        )


def send_service_menu(
    api,
    to_phone: str,
    cfg: Dict[str, Any],
    inbound_message_id: str | None = None,
) -> None:
    """Interactive service list — only when user asks (menu / help / services)."""
    service_intro = (cfg.get("service_menu_message") or "Please select a service below:").strip()
    services: List[Dict[str, Any]] = cfg.get("services") or DEFAULT_SSQUARE_SERVICES
    if inbound_message_id and hasattr(api, "pause_with_typing"):
        api.pause_with_typing(inbound_message_id, 1.0)
    rows = []
    for svc in services[:10]:
        rows.append(
            {
                "id": str(svc.get("id") or "service"),
                "title": str(svc.get("title") or "Service")[:24],
                "description": str(svc.get("description") or "")[:72],
            }
        )
    if rows:
        api.send_interactive_list(
            to_phone,
            header="Our Services",
            body=service_intro,
            button_label="View services",
            rows=rows,
        )



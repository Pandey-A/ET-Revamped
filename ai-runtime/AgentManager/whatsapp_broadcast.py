"""WhatsApp broadcast — personalized templates and optional image."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import tempfile
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from AgentManager.whatsapp_flow import BCA_STORE_PATH

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEADS_DB = os.path.join(_ROOT, "leads_store.json")
SEND_DELAY_SEC = float(os.getenv("WHATSAPP_BROADCAST_DELAY_SEC", "0.6"))

# Temporary: always attach this BCA image on every broadcast (set WHATSAPP_BROADCAST_HARDCODED_IMAGE=0 to disable)
HARDCODED_BROADCAST_IMAGE = os.path.join(_ROOT, "temp_files", "ssquare-broadcast-bca.png")


def get_hardcoded_broadcast_image_path() -> str:
    if os.getenv("WHATSAPP_BROADCAST_HARDCODED_IMAGE", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return ""
    path = HARDCODED_BROADCAST_IMAGE
    return path if os.path.isfile(path) else ""

DEFAULT_BROADCAST_TEMPLATE = (
    "Hello {User},\n\n"
    "We have an update from *S Square Fitness Club* for you.\n\n"
    "Reply *menu* anytime to explore our services."
)

# Placeholders: {User}, {user}, {Name}, {name}
_PLACEHOLDER_PATTERN = re.compile(
    r"\{user\}|\{name\}",
    re.IGNORECASE,
)


def _normalize_phone_digits(phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    return digits if len(digits) >= 8 else ""


def render_broadcast_message(template: str, name: Optional[str] = None) -> str:
    """Replace {User} / {Name} with the contact's name (fallback: 'there')."""
    display = (name or "").strip() or "there"
    if not template:
        return ""

    def _repl(match: re.Match) -> str:
        return display

    return _PLACEHOLDER_PATTERN.sub(_repl, template).strip()


def resolve_broadcast_image_path(image_ref: str, image_path: str = "") -> str:
    """Map /api/uploads/…, full URL, or absolute path to a local file for Meta media upload."""
    direct = (image_path or "").strip()
    if direct and os.path.isfile(direct):
        return direct

    ref = (image_ref or "").strip()
    if not ref:
        return ""

    if ref.startswith("http://") or ref.startswith("https://"):
        try:
            from urllib.parse import urlparse

            ref = urlparse(ref).path or ""
        except Exception:
            return ""

    name = ref.split("/")[-1] or ref
    if "/api/uploads/" in ref:
        name = ref.split("/api/uploads/")[-1].lstrip("/")
    elif ref.startswith("/uploads/"):
        name = ref[len("/uploads/") :].lstrip("/")

    repo_parent = os.path.dirname(_ROOT)
    candidates = [
        os.path.join(repo_parent, "server", "uploads", name),
        os.path.join(_ROOT, "temp_files", name),
        os.path.join(_ROOT, "temp_files", ref.lstrip("/")),
        ref if os.path.isabs(ref) and os.path.isfile(ref) else "",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    logger.warning("Broadcast image not found on disk for ref=%s", image_ref[:120])
    return ""


def materialize_image_base64(image_base64: str, image_mime: str = "") -> str:
    """Write base64 image payload to a temp file for Meta upload."""
    raw = (image_base64 or "").strip()
    if not raw:
        return ""
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception as e:
        logger.warning("Invalid broadcast image base64: %s", e)
        return ""
    if not data or len(data) > 5 * 1024 * 1024:
        return ""
    mime = (image_mime or "").lower()
    suffix = ".jpg"
    if "png" in mime:
        suffix = ".png"
    elif "webp" in mime:
        suffix = ".webp"
    elif "gif" in mime:
        suffix = ".gif"
    fd, path = tempfile.mkstemp(prefix="wa_broadcast_", suffix=suffix)
    os.close(fd)
    with open(path, "wb") as f:
        f.write(data)
    return path


def _load_leads() -> List[Dict[str, Any]]:
    if not os.path.exists(LEADS_DB):
        return []
    try:
        with open(LEADS_DB, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning("Failed to load leads for broadcast: %s", e)
        return []


def _build_name_index(agent_id: Optional[str] = None) -> Dict[str, str]:
    """Latest lead name per phone (digits)."""
    index: Dict[str, Tuple[str, str]] = {}
    for lead in _load_leads():
        if agent_id:
            lead_agent = str(lead.get("agent_id") or "").strip()
            if lead_agent and lead_agent != agent_id:
                continue
        digits = _normalize_phone_digits(lead.get("phone") or "")
        if not digits:
            continue
        name = str(lead.get("name") or "").strip()
        if not name:
            continue
        ts = str(lead.get("captured_at") or "")
        prev = index.get(digits)
        if not prev or ts >= prev[0]:
            index[digits] = (ts, name)
    return {k: v[1] for k, v in index.items()}


def _load_bca_phones() -> Set[str]:
    if not os.path.exists(BCA_STORE_PATH):
        return set()
    try:
        with open(BCA_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {k for k in data if _normalize_phone_digits(k)}
    except Exception:
        pass
    return set()


def _parse_manual_line(line: str) -> Tuple[str, str]:
    """Parse '919876543210' or '919876543210, Rahul' or '919876543210|Rahul'."""
    raw = (line or "").strip()
    if not raw:
        return "", ""
    name = ""
    phone_part = raw
    for sep in (",", "|", "\t"):
        if sep in raw:
            phone_part, name = raw.split(sep, 1)
            name = name.strip()
            break
    return _normalize_phone_digits(phone_part), name


def collect_recipient_rows(
    *,
    audience: str,
    manual_phones: Optional[List[str]] = None,
    agent_id: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Returns [{phone_digits, name}, …] deduped by phone.
    audience: manual | leads | all
    """
    audience = (audience or "manual").strip().lower()
    name_index = _build_name_index(agent_id)
    rows: Dict[str, Dict[str, str]] = {}

    def add_row(digits: str, name: str = "") -> None:
        if not digits:
            return
        resolved_name = (name or "").strip() or name_index.get(digits, "")
        if digits in rows:
            if resolved_name and not rows[digits].get("name"):
                rows[digits]["name"] = resolved_name
            return
        rows[digits] = {"phone_digits": digits, "name": resolved_name}

    if audience in ("leads", "all"):
        for lead in _load_leads():
            if agent_id:
                lead_agent = str(lead.get("agent_id") or "").strip()
                if lead_agent and lead_agent != agent_id:
                    continue
            digits = _normalize_phone_digits(lead.get("phone") or "")
            if digits:
                add_row(digits, str(lead.get("name") or ""))

    if audience == "all":
        for digits in _load_bca_phones():
            add_row(digits)

    if audience == "manual" or manual_phones:
        for raw in manual_phones or []:
            if isinstance(raw, str) and "," in raw and "\n" not in raw:
                chunks = [raw]
            else:
                chunks = str(raw).replace(";", "\n").splitlines()
            for line in chunks:
                digits, name = _parse_manual_line(line)
                add_row(digits, name)

    if audience == "manual" and not rows:
        return []

    return [rows[k] for k in sorted(rows.keys())]


def collect_recipients(
    *,
    audience: str,
    manual_phones: Optional[List[str]] = None,
    agent_id: Optional[str] = None,
) -> List[str]:
    return [r["phone_digits"] for r in collect_recipient_rows(
        audience=audience, manual_phones=manual_phones, agent_id=agent_id
    )]


def _send_to_recipient(
    api,
    to_phone: str,
    body: str,
    media_id: str = "",
    image_path: str = "",
    image_public_url: str = "",
) -> Dict[str, Any]:
    text = (body or "").strip()
    caption = text[:1024] if text else ""

    if media_id and hasattr(api, "send_image_by_media_id"):
        result = api.send_image_by_media_id(to_phone, media_id, caption=caption)
        if result.get("status") == "success":
            if len(text) > 1024:
                api.send_whatsapp_message(to_phone, text[1024:])
            result["image_delivered"] = True
            return result
        logger.warning("Broadcast image (media_id) failed for %s: %s", to_phone, result.get("error"))

    if image_path and hasattr(api, "send_image_from_file"):
        result = api.send_image_from_file(to_phone, image_path, caption=caption)
        if result.get("status") != "success" and image_public_url and hasattr(api, "send_image_message"):
            logger.warning(
                "Broadcast file upload failed for %s, trying public URL: %s",
                to_phone,
                result.get("error"),
            )
            result = api.send_image_message(to_phone, image_public_url, caption=caption)
        if result.get("status") == "success":
            if len(text) > 1024:
                api.send_whatsapp_message(to_phone, text[1024:])
            result["image_delivered"] = True
            return result
        logger.warning("Broadcast image failed for %s: %s", to_phone, result.get("error"))

    result = api.send_whatsapp_message(to_phone, text)
    result["image_delivered"] = False
    return result


def run_broadcast(
    api,
    *,
    message: str,
    audience: str = "manual",
    manual_phones: Optional[List[str]] = None,
    agent_id: Optional[str] = None,
    image_url: Optional[str] = None,
    image_path: Optional[str] = None,
    image_public_url: Optional[str] = None,
    image_base64: Optional[str] = None,
    image_mime: Optional[str] = None,
) -> Dict[str, Any]:
    template = (message or "").strip()
    if not template:
        return {"success": False, "error": "Message template is required", "sent": 0, "failed": 0}

    recipients = collect_recipient_rows(
        audience=audience,
        manual_phones=manual_phones,
        agent_id=agent_id,
    )
    if not recipients:
        return {
            "success": False,
            "error": "No recipients found. Add phone numbers or choose a different audience.",
            "sent": 0,
            "failed": 0,
            "recipients": 0,
        }

    hardcoded_image = get_hardcoded_broadcast_image_path()
    if hardcoded_image:
        resolved_image = hardcoded_image
        image_requested = True
        image_resolve_error = None
        temp_image_path = ""
    else:
        resolved_image = resolve_broadcast_image_path(image_url or "", image_path or "")
        temp_image_path = ""
        if not resolved_image and image_base64:
            temp_image_path = materialize_image_base64(image_base64, image_mime or "")
            resolved_image = temp_image_path

        image_resolve_error = None
        if (image_url or image_path or image_base64) and not resolved_image:
            image_resolve_error = (
                "Image file could not be found on the server. Re-upload the image and try again."
            )

        image_requested = bool(image_url or image_path or image_base64)
    shared_media_id = ""
    if resolved_image and hasattr(api, "upload_image_media"):
        upload_result = api.upload_image_media(resolved_image)
        if upload_result.get("status") == "success":
            shared_media_id = upload_result.get("media_id") or ""
        else:
            err = upload_result.get("error")
            logger.error("Broadcast shared media upload failed: %s", err)
            image_resolve_error = (
                "WhatsApp rejected the image upload. Use JPG or PNG under 5MB, then try again."
            )
            if isinstance(err, dict):
                msg = (err.get("error") or {}).get("message") or err.get("message")
                if msg:
                    image_resolve_error = str(msg)

    if image_requested and not shared_media_id:
        if temp_image_path and os.path.isfile(temp_image_path):
            try:
                os.remove(temp_image_path)
            except OSError:
                pass
        return {
            "success": False,
            "error": image_resolve_error or "Could not upload image to WhatsApp.",
            "sent": 0,
            "failed": len(recipients),
            "recipients": len(recipients),
            "with_image": False,
            "image_requested": True,
            "image_resolve_error": image_resolve_error,
            "errors": [],
        }

    sent = 0
    failed = 0
    images_sent = 0
    errors: List[Dict[str, str]] = []

    for i, row in enumerate(recipients):
        digits = row["phone_digits"]
        name = row.get("name") or ""
        to_phone = f"+{digits}"
        body = render_broadcast_message(template, name)
        result = _send_to_recipient(
            api,
            to_phone,
            body,
            media_id=shared_media_id,
            image_path=resolved_image if not shared_media_id else "",
            image_public_url=image_public_url or "",
        )
        if result.get("status") == "success":
            sent += 1
            if result.get("image_delivered"):
                images_sent += 1
        else:
            failed += 1
            if len(errors) < 5:
                errors.append({
                    "phone": to_phone,
                    "name": name or "—",
                    "error": str(result.get("error") or "send failed"),
                })
        if i < len(recipients) - 1 and SEND_DELAY_SEC > 0:
            time.sleep(SEND_DELAY_SEC)

    if image_requested and sent > 0 and images_sent == 0:
        image_resolve_error = (
            image_resolve_error
            or "Message sent as text only — WhatsApp did not accept the image. "
            "Use JPG/PNG under 5MB; the recipient must have messaged your number in the last 24 hours."
        )

    summary_error = None
    if sent == 0 and errors:
        first = errors[0].get("error")
        if isinstance(first, dict):
            err_obj = first.get("error") or first
            summary_error = err_obj.get("message") if isinstance(err_obj, dict) else str(first)
        else:
            summary_error = str(first)
    elif sent == 0:
        summary_error = "No messages were delivered. Check phone numbers and WhatsApp access token."

    payload_out = {
        "success": sent > 0 and (not image_requested or images_sent > 0),
        "sent": sent,
        "failed": failed,
        "images_sent": images_sent,
        "recipients": len(recipients),
        "personalized": bool(_PLACEHOLDER_PATTERN.search(template)),
        "with_image": images_sent > 0,
        "image_requested": image_requested,
        "image_resolve_error": image_resolve_error,
        "errors": errors,
        "error": summary_error or image_resolve_error,
    }
    if temp_image_path and os.path.isfile(temp_image_path):
        try:
            os.remove(temp_image_path)
        except OSError:
            pass
    return payload_out

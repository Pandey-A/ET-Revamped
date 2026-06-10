"""Pydantic validation for API form payloads."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def normalize_meta_digits(value: Any, *, min_digits: int = 8, field_label: str = "ID") -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_label} is required")
    digits = re.sub(r"\D", "", raw)
    if len(digits) >= min_digits:
        return digits
    raise ValueError(f"{field_label} must contain at least {min_digits} digits")


def _optional_email(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "@" not in text or "." not in text.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    return text.lower()


def _optional_http_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("/"):
        return text
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Enter a valid http(s) URL or site path")
    return text


class WhatsAppServiceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    image_url: str = Field(default="", max_length=2048)

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str) -> str:
        return _optional_http_url(value)


class WhatsAppWelcomeTiming(BaseModel):
    model_config = ConfigDict(extra="ignore")

    after_image_sec: int = Field(default=0, ge=0, le=120)
    after_greeting_sec: int = Field(default=0, ge=0, le=120)
    menu_typing_sec: int = Field(default=0, ge=0, le=120)


class WhatsAppBcaReminder(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    interval_days: int = Field(default=45, ge=1, le=365)
    message: str = Field(default="", max_length=2000)


class WhatsAppChannelConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    welcome_message: str = Field(default="", max_length=4096)
    service_menu_message: str = Field(default="", max_length=1024)
    welcome_image_url: str = Field(default="", max_length=2048)
    welcome_timing: Optional[WhatsAppWelcomeTiming] = None
    services: list[WhatsAppServiceItem] = Field(default_factory=list, max_length=20)
    bca_reminder: Optional[WhatsAppBcaReminder] = None

    @field_validator("welcome_image_url")
    @classmethod
    def validate_welcome_image(cls, value: str) -> str:
        return _optional_http_url(value)


class WhatsAppChannelCreate(BaseModel):
    whatsapp_business_account_id: str
    phone_number_id: str
    display_phone_number: Optional[str] = ""
    access_token: str
    ai_agent_id: str
    ai_agent_name: Optional[str] = ""
    admin_phone: Optional[str] = ""
    config_json: Optional[WhatsAppChannelConfig] = None

    @field_validator("whatsapp_business_account_id")
    @classmethod
    def validate_waba(cls, value: str) -> str:
        return normalize_meta_digits(value, field_label="WhatsApp Business Account ID")

    @field_validator("phone_number_id")
    @classmethod
    def validate_phone_number_id(cls, value: str) -> str:
        return normalize_meta_digits(value, field_label="Phone Number ID")

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: str) -> str:
        token = str(value or "").strip()
        if not token or token == "••••••••":
            raise ValueError("Access token is required")
        if len(token) < 20:
            raise ValueError("Access token looks too short")
        if len(token) > 4096:
            raise ValueError("Access token is too long")
        return token

    @field_validator("ai_agent_id")
    @classmethod
    def validate_ai_agent_id(cls, value: str) -> str:
        agent_id = str(value or "").strip()
        if len(agent_id) < 3:
            raise ValueError("Linked AI agent is required")
        if len(agent_id) > 128:
            raise ValueError("Linked AI agent id is invalid")
        return agent_id

    @field_validator("display_phone_number", "ai_agent_name", "admin_phone")
    @classmethod
    def strip_optional_text(cls, value: Optional[str]) -> str:
        return str(value or "").strip()


class WhatsAppChannelUpdate(BaseModel):
    whatsapp_business_account_id: Optional[str] = None
    phone_number_id: Optional[str] = None
    display_phone_number: Optional[str] = None
    access_token: Optional[str] = None
    ai_agent_id: Optional[str] = None
    ai_agent_name: Optional[str] = None
    admin_phone: Optional[str] = None
    config_json: Optional[WhatsAppChannelConfig] = None

    @model_validator(mode="after")
    def require_at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("No fields provided for update")
        return self

    @field_validator("whatsapp_business_account_id")
    @classmethod
    def validate_waba(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return normalize_meta_digits(value, field_label="WhatsApp Business Account ID")

    @field_validator("phone_number_id")
    @classmethod
    def validate_phone_number_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return normalize_meta_digits(value, field_label="Phone Number ID")

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        token = str(value).strip()
        if not token or "••••" in token:
            return None
        if len(token) < 20:
            raise ValueError("Access token looks too short")
        if len(token) > 4096:
            raise ValueError("Access token is too long")
        return token

    @field_validator("ai_agent_id")
    @classmethod
    def validate_ai_agent_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        agent_id = str(value).strip()
        if len(agent_id) < 3:
            raise ValueError("Linked AI agent is required")
        return agent_id


class IndexUrlRequest(BaseModel):
    url: str
    collection_name: str
    agent_id: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        text = str(value or "").strip()
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Enter a valid http or https URL")
        return text

    @field_validator("collection_name")
    @classmethod
    def validate_collection(cls, value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("Collection name is required")
        if len(name) > 200:
            raise ValueError("Collection name is too long")
        return name

    @field_validator("agent_id")
    @classmethod
    def validate_agent_id(cls, value: str) -> str:
        agent_id = str(value or "").strip()
        if len(agent_id) < 3:
            raise ValueError("Agent id is required")
        return agent_id


class IndexPdfMeta(BaseModel):
    collection_name: str
    agent_id: str

    @field_validator("collection_name")
    @classmethod
    def validate_collection(cls, value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("Collection name is required")
        return name

    @field_validator("agent_id")
    @classmethod
    def validate_agent_id(cls, value: str) -> str:
        agent_id = str(value or "").strip()
        if len(agent_id) < 3:
            raise ValueError("Agent id is required")
        return agent_id


class ChatStreamRequest(BaseModel):
    user_input: str
    session_id: str
    agent_id: str

    @field_validator("user_input")
    @classmethod
    def validate_user_input(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("Message cannot be empty")
        if len(text) > 8000:
            raise ValueError("Message is too long")
        return text

    @field_validator("session_id", "agent_id")
    @classmethod
    def validate_required_ids(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("Session and agent ids are required")
        return text


class AnalyzeActionRequest(BaseModel):
    user_input: str
    assistant_response: str
    session_id: str
    agent_id: str

    @field_validator("user_input", "assistant_response", "session_id", "agent_id")
    @classmethod
    def strip_required(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("All analyze_action fields are required")
        return text


class AgentStorePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    owner_user_id: Optional[str] = ""
    name: str
    description: Optional[str] = ""
    greeting_message: Optional[str] = ""
    model: Optional[str] = "gpt-4o-mini"
    temperature: Optional[float] = 0.7
    collection_name: Optional[str] = ""
    resource_list: Optional[list[str]] = None
    widget_contact_email: Optional[str] = ""
    whatsapp_contact_email: Optional[str] = ""
    company_name: Optional[str] = ""

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        agent_id = str(value or "").strip()
        if len(agent_id) < 3:
            raise ValueError("Agent id is required")
        return agent_id

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        name = str(value or "").strip()
        if len(name) < 2:
            raise ValueError("Agent name must be at least 2 characters")
        if len(name) > 120:
            raise ValueError("Agent name is too long")
        return name

    @field_validator("description", "greeting_message", "company_name", "collection_name")
    @classmethod
    def strip_optional(cls, value: Optional[str]) -> str:
        return str(value or "").strip()

    @field_validator("widget_contact_email", "whatsapp_contact_email")
    @classmethod
    def validate_emails(cls, value: Optional[str]) -> str:
        return _optional_email(value)

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, value: Optional[float]) -> float:
        temp = float(value if value is not None else 0.7)
        if temp < 0 or temp > 2:
            raise ValueError("Temperature must be between 0 and 2")
        return temp


class WidgetSessionStart(BaseModel):
    session_id: str
    agent_id: str
    origin: Optional[str] = ""
    page_url: Optional[str] = ""

    @field_validator("session_id", "agent_id")
    @classmethod
    def validate_ids(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("session_id and agent_id are required")
        return text


class WidgetContactUpdate(BaseModel):
    session_id: str
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""

    @field_validator("session_id")
    @classmethod
    def validate_session(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("session_id is required")
        return text

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> str:
        return _optional_email(value)


class WidgetSessionComplete(BaseModel):
    session_id: str
    reason: Optional[str] = ""

    @field_validator("session_id")
    @classmethod
    def validate_session(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("session_id is required")
        return text

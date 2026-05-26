"""Llama 3 prompt formatting for Amazon Bedrock (LlamaIndex defaults to Llama 2)."""

from typing import List, Optional, Sequence

from llama_index.core.base.llms.types import ChatMessage, MessageRole

BOS = "<|begin_of_text|>"
HEADER_START = "<|start_header_id|>"
HEADER_END = "<|end_header_id|>"
EOT = "<|eot_id|>"

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, respectful and honest assistant. "
    "Always answer as helpfully as possible and follow ALL given instructions."
)


def _role_header(role: str) -> str:
    return f"{HEADER_START}{role}{HEADER_END}\n\n"


def messages_to_llama3_prompt(
    messages: Sequence[ChatMessage], system_prompt: Optional[str] = None
) -> str:
    """Format chat messages using Meta Llama 3 instruct tokens for Bedrock."""
    parts: List[str] = [BOS]
    idx = 0
    system_str = system_prompt

    if messages and messages[0].role == MessageRole.SYSTEM:
        system_str = messages[0].content or system_str
        idx = 1
    elif system_str is None:
        system_str = DEFAULT_SYSTEM_PROMPT

    if system_str:
        parts.append(_role_header("system"))
        parts.append(system_str.strip())
        parts.append(EOT)

    for msg in messages[idx:]:
        content = (msg.content or "").strip()
        if not content:
            continue
        if msg.role == MessageRole.USER:
            parts.append(_role_header("user"))
            parts.append(content)
            parts.append(EOT)
        elif msg.role == MessageRole.ASSISTANT:
            parts.append(_role_header("assistant"))
            parts.append(content)
            parts.append(EOT)
        elif msg.role == MessageRole.SYSTEM:
            parts.append(_role_header("system"))
            parts.append(content)
            parts.append(EOT)

    parts.append(_role_header("assistant"))
    return "".join(parts)


def completion_to_llama3_prompt(
    completion: str, system_prompt: Optional[str] = None
) -> str:
    system_str = (system_prompt or DEFAULT_SYSTEM_PROMPT).strip()
    user_str = completion.strip()
    return (
        f"{BOS}{_role_header('system')}{system_str}{EOT}"
        f"{_role_header('user')}{user_str}{EOT}"
        f"{_role_header('assistant')}"
    )


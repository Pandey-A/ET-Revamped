from pathlib import Path
import json
import os

from llama_index.llms.openai import OpenAI

_config_path = Path(__file__).parent / "config.json"


def _load_config() -> dict:
    if not _config_path.exists():
        return {}
    with open(_config_path, encoding="utf-8") as f:
        return json.load(f)


def get_openai_api_key() -> str:
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if key:
        return key
    cfg = _load_config().get("OpenAI", {})
    return (cfg.get("Key") or cfg.get("api_key") or "").strip()


def get_openai_config() -> dict:
    cfg = _load_config().get("OpenAI", {})
    return {
        "model": (os.getenv("OPENAI_MODEL") or cfg.get("model") or "gpt-4o-mini").strip(),
        "temperature": float(
            os.getenv("OPENAI_TEMPERATURE") or cfg.get("temperature") or 0.7
        ),
    }


def get_openai_embedding_model() -> str:
    return (
        os.getenv("OPENAI_EMBEDDING_MODEL")
        or _load_config().get("OpenAI", {}).get("embed_model")
        or "text-embedding-3-small"
    ).strip()


def _looks_like_openai_model(model: str) -> bool:
    m = (model or "").strip().lower()
    if not m:
        return False
    return m.startswith(
        ("gpt-", "o1", "o3", "o4", "text-", "chatgpt-", "davinci", "ada", "babbage", "curie")
    )


def resolve_openai_model(model: str | None = None) -> str:
    candidate = (model or "").strip()
    if candidate and _looks_like_openai_model(candidate):
        return candidate
    if candidate:
        # Old agents may still have Bedrock ids (meta.llama3-8b-instruct-v1:0, etc.)
        return get_openai_config()["model"]
    return get_openai_config()["model"]


class LLMHandler:
    def __init__(self):
        return

    def get_llm(self, model=None, temperature=None):
        cfg = get_openai_config()
        api_key = get_openai_api_key()
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Add it to the environment or AgentManager/config.json OpenAI.Key."
            )
        return OpenAI(
            model=resolve_openai_model(model),
            api_key=api_key,
            temperature=temperature if temperature is not None else cfg["temperature"],
        )

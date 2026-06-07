import asyncio
import logging

from llama_index.core.agent import ReActAgent
from llama_index.core.tools import FunctionTool

from AgentManager import instruction_handler, llm_handler
from AgentManager.KnowledgeManagerAgent import knowledge_management_handler
from .tool_handler import ToolHandler
import json

logger = logging.getLogger(__name__)

try:
    with open("AgentManager/config.json", "r") as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

_openai_cfg = config.get("OpenAI", {})


class CoreAgentHandler:
    def __init__(self):
        self.tool_handler = ToolHandler()
        logging.info("Initialized Core Agent")

    def create_core_agent(
        self,
        query_sentiment,
        collection_name,
        model_id=None,
        extra_system_prompt: str = "",
    ):
        """Build a ReAct agent (LlamaIndex 0.14+ workflow API)."""
        base_prompt = instruction_handler.core_agent_prompt.format(
            sentiment=query_sentiment, collection_name=collection_name
        )
        system_prompt = base_prompt
        extra = (extra_system_prompt or "").strip()
        if extra:
            system_prompt = f"{base_prompt}\n\n{extra}"

        llm = llm_handler.get_llm(
            model_id,
            _openai_cfg.get("temperature", 0.7),
        )

        def knowledge_source(query: str) -> dict:
            return knowledge_management_handler.rag_function(
                query=query,
                collection_name=collection_name,
            )

        knowledge_source_tool = FunctionTool.from_defaults(
            fn=knowledge_source,
            name="knowledge_source",
            description=(
                "Fetch answers from the agent's uploaded knowledge base. "
                "Input: query (string). Output: solution/escalate."
            ),
        )

        return ReActAgent(
            tools=[knowledge_source_tool],
            llm=llm,
            system_prompt=system_prompt,
            verbose=True,
        )

    @staticmethod
    def run_agent_sync(agent: ReActAgent, user_input: str):
        """Run async workflow agent from a worker thread (WhatsApp handler)."""

        async def _run():
            handler = agent.run(user_msg=user_input)
            return await handler

        return asyncio.run(_run())


def _text_from_message(msg) -> str:
    if msg is None:
        return ""
    content = getattr(msg, "content", None)
    if content:
        return str(content).strip()
    blocks = getattr(msg, "blocks", None) or []
    parts = []
    for block in blocks:
        text = getattr(block, "text", None)
        if text:
            parts.append(str(text).strip())
    return "\n".join(p for p in parts if p).strip()


def extract_agent_reply(chat_response) -> str:
    """Normalize LlamaIndex 0.14 AgentOutput / legacy chat responses to plain text."""
    if chat_response is None:
        return ""
    if hasattr(chat_response, "response") and chat_response.response is not None:
        inner = chat_response.response
        if hasattr(inner, "response") and inner.response is not None:
            text = _text_from_message(inner) or str(inner.response).strip()
        else:
            text = _text_from_message(inner) or str(inner).strip()
        if text.lower().startswith("assistant:"):
            text = text.split(":", 1)[1].strip()
        return text
    if hasattr(chat_response, "response"):
        text = str(getattr(chat_response, "response", "")).strip()
        if text.lower().startswith("assistant:"):
            text = text.split(":", 1)[1].strip()
        return text
    text = str(chat_response).strip()
    if text.lower().startswith("assistant:"):
        text = text.split(":", 1)[1].strip()
    return text

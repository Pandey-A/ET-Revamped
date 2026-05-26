import asyncio
import os
import sys

# Add HR-Reachout-Agent-main to sys.path
sys.path.append('/opt/deepfake_et_frontend/HR-Reachout-Agent-main')

from llama_index.core.llms import ChatMessage
from AgentManager.llm_handler import LLMHandler

llm = LLMHandler().get_llm(model="meta.llama3-8b-instruct-v1:0")

response = llm.stream_chat([ChatMessage(role="user", content="hello")])
for chunk in response:
    print(chunk.delta, end="")
print("\nDone")

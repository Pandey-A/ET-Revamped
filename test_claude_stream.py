import asyncio
import os
import sys

# Add HR-Reachout-Agent-main to sys.path
sys.path.append('/opt/deepfake_et_frontend/HR-Reachout-Agent-main')

from llama_index.core.llms import ChatMessage
from AgentManager.llm_handler import LLMHandler
from llama_index.llms.bedrock import Bedrock

llm = Bedrock(model="anthropic.claude-3-haiku-20240307-v1:0")

try:
    response = llm.stream_chat([ChatMessage(role="user", content="hello")])
    for chunk in response:
        print(chunk.delta, end="")
    print("\nDone")
except Exception as e:
    print(f"Error: {e}")

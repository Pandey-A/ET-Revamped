import asyncio
import os
import sys

# Add HR-Reachout-Agent-main to sys.path
sys.path.append('/opt/deepfake_et_frontend/HR-Reachout-Agent-main')

from llama_index.core.llms import ChatMessage
from llama_index.llms.bedrock import Bedrock

llm = Bedrock(model="anthropic.claude-3-haiku-20240307-v1:0", region_name="ap-south-1")

response = llm.chat([ChatMessage(role="user", content="hello")])
print("Response:", str(response))

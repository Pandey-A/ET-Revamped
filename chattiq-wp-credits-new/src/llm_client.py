import json
import requests
import typing_extensions as typing
from google import genai
from google.genai import types
from src.config import GEMINI_API_KEY, OPENAI_API_KEY, LLM_PROVIDER

# Initialize Gemini client if API key is configured
gemini_client = None
if GEMINI_API_KEY:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)

class AgentResponse(typing.TypedDict):
    is_answered: bool
    reply: str

def call_llm_rag(context: str, query: str, provider: str = None) -> dict:
    """Answers user queries based on context using OpenAI or Gemini (returns is_answered, reply)."""
    if provider is None:
        provider = LLM_PROVIDER
        
    prompt = f"""
    You are a helpful assistant. Answer the user using ONLY the provided context and knowledge.
    If you cannot answer the question, you MUST set 'is_answered' to false.
    
    Context: {context}
    User Query: {query}
    """
    
    if provider.lower() == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "agent_response",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "is_answered": {"type": "boolean"},
                            "reply": {"type": "string"}
                        },
                        "required": ["is_answered", "reply"],
                        "additionalProperties": False
                    }
                }
            },
            "temperature": 0.1
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        content_str = data["choices"][0]["message"]["content"]
        result = json.loads(content_str)
        if "usage" in data and "total_tokens" in data["usage"]:
            result["tokens_used"] = data["usage"]["total_tokens"]
        else:
            result["tokens_used"] = 0
        return result
        
    else:
        if gemini_client is None:
            raise ValueError("GEMINI_API_KEY is not configured.")
            
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AgentResponse,
                temperature=0.1,
            ),
        )
        result = json.loads(response.text)
        result["tokens_used"] = response.usage_metadata.total_token_count if response.usage_metadata else 0
        return result

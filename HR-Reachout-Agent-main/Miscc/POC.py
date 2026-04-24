# !pip install vaderSentiment flair numpy

from llama_index.llms.openai import OpenAI
from llama_index.core import Document, VectorStoreIndex, StorageContext
from llama_index.core.tools import FunctionTool, QueryEngineTool
from llama_index.core.tools import ToolMetadata
from llama_index.core.bridge.pydantic import BaseModel
from llama_index.core.llms import ChatMessage
from llama_index.core.agent import FunctionCallingAgent, FunctionCallingAgentWorker
from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models
from llama_index.core.schema import NodeWithScore
from typing import Optional, Dict, Any, List
import pandas as pd
import openai
import os
from dotenv import load_dotenv
import json
import asyncio
from abc import abstractmethod
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Union
from llama_index.core.base.llms.types import (
    ChatMessage,
    ChatResponse,
    ChatResponseAsyncGen,
    ChatResponseGen,
)
from llama_index.core.llms.llm import LLM, ToolSelection
from groq import Groq
from transformers import pipeline
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from flair.models import TextClassifier
from flair.data import Sentence
import numpy as np
from datetime import datetime

# ------------------------- Load Environment -------------------------
load_dotenv()
openai_key = os.getenv("OPENAI_API_KEY")
qdrant_url = os.getenv("Qdrant_URL")
qdrant_api_key = os.getenv("Qdrant_API_Key")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
os.environ["COHERE_API_KEY"] = os.getenv("COHERE_API_KEY")

# Initialize Groq client
client = Groq(api_key=GROQ_API_KEY)

# ------------------------- Constants -------------------------
MIN_CHAT_HISTORY_FOR_SENTIMENT = 3
SENTIMENT_THRESHOLD = 2
SENSITIVE_OPERATIONS = ["address change", "payment", "password", "account update"]
UNCERTAINTY_THRESHOLD = 0.3  # VADER compound score threshold for deep analysis

# ------------------------- Sample Data -------------------------
gaming_csv_path = 'samples_issues_gaming.csv'
ecommerce_csv_path = 'samples_issues_ecommerce_fixed.csv'

df_gaming = pd.read_csv(gaming_csv_path)
df_ecommerce = pd.read_csv(ecommerce_csv_path)

past_resolutions_gaming = df_gaming['body'].tolist()
past_resolutions_ecommerce = df_ecommerce['body'].tolist()

# ------------------------- LLM Initialization -------------------------
llm = OpenAI(model="gpt-4o-mini", api_key=openai_key)


# ------------------------- Hybrid Monitoring Agent -------------------------
class HybridMonitoringAgent:
    def __init__(self):
        # Initialize VADER (fast rule-based analyzer)
        self.fast_analyzer = SentimentIntensityAnalyzer()

        # Initialize Flair (accurate deep learning model)
        self.accurate_analyzer = TextClassifier.load('en-sentiment')

        # Conversation tracking
        self.negative_count = 0
        self.sentiment_history = []
        self.conversation_trend = 0  # Tracks overall trend (-1 to 1)

    def _vader_analysis(self, text: str) -> dict:
        """Fast initial sentiment analysis"""
        scores = self.fast_analyzer.polarity_scores(text)
        return {
            'sentiment': 'negative' if scores['compound'] <= -UNCERTAINTY_THRESHOLD else
            'positive' if scores['compound'] >= UNCERTAINTY_THRESHOLD else
            'neutral',
            'confidence': abs(scores['compound']),
            'compound': scores['compound']
        }

    def _flair_analysis(self, text: str) -> dict:
        """Accurate deep learning analysis"""
        sentence = Sentence(text)
        self.accurate_analyzer.predict(sentence)
        label = sentence.labels[0]
        return {
            'sentiment': label.value.lower(),
            'confidence': label.score,
            'compound': label.score * (-1 if label.value == 'NEGATIVE' else 1)
        }

    def _update_trend_analysis(self, compound_score: float):
        """Track conversation trend over time"""
        self.conversation_trend = 0.8 * self.conversation_trend + 0.2 * np.tanh(compound_score * 3)
        self.sentiment_history.append({
            'timestamp': datetime.now().isoformat(),
            'trend': self.conversation_trend,
            'score': compound_score
        })

    def get_sentiment(self, text: str) -> dict:
        """Hybrid sentiment analysis pipeline"""
        # First pass with VADER
        fast_result = self._vader_analysis(text)

        # Only use Flair for uncertain cases
        if abs(fast_result['compound']) < UNCERTAINTY_THRESHOLD:
            accurate_result = self._flair_analysis(text)
            final_sentiment = accurate_result['sentiment']
            compound_score = accurate_result['compound']
        else:
            final_sentiment = fast_result['sentiment']
            compound_score = fast_result['compound']

        # Update trend analysis
        self._update_trend_analysis(compound_score)

        # Update negative count
        if final_sentiment == 'negative':
            self.negative_count += 1 + (0.5 * abs(compound_score))  # Weight by intensity
        elif final_sentiment == 'positive':
            self.negative_count = max(0, self.negative_count - 1)

        return {
            'sentiment': final_sentiment,
            'confidence': abs(compound_score),
            'trend': self.conversation_trend,
            'negative_count': self.negative_count
        }

    def should_escalate(self, chat_history: List[Dict[str, str]]) -> bool:
        """Dynamic escalation decision considering multiple factors"""
        if not chat_history:
            return False

        # 1. Immediate escalation for strong negative trend
        if self.conversation_trend < -0.6:
            return True

        # 2. Escalate after consecutive negatives
        if self.negative_count >= SENTIMENT_THRESHOLD:
            return True

        # 3. Check recent messages for frustration patterns
        recent_messages = [msg['content'] for msg in chat_history[-3:] if msg['role'] == 'user']
        if len(recent_messages) >= 2:
            frustration_keywords = sum(
                1 for msg in recent_messages
                if any(word in msg.lower() for word in ['angry', 'frustrated', 'terrible', 'unacceptable'])
            )
            if frustration_keywords >= 2:
                return True

        return False

    def monitor_interaction(self, user_query: str, chat_history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        """Complete monitoring analysis"""
        if chat_history is None:
            chat_history = []

        # Get sentiment analysis
        sentiment_result = self.get_sentiment(user_query)

        # Check for escalation
        escalation = self.should_escalate(chat_history + [{'role': 'user', 'content': user_query}])

        return {
            'status': f"Analyzed: {user_query[:50]}..." + ("⚠️" if escalation else ""),
            'sentiment': sentiment_result['sentiment'],
            'confidence': sentiment_result['confidence'],
            'should_escalate': escalation,
            'analysis': {
                'trend': round(sentiment_result['trend'], 2),
                'negative_count': self.negative_count,
                'recent_sentiments': [s['sentiment'] for s in self.sentiment_history[-3:]]
            }
        }


# ------------------------- Additional Agents -------------------------
class GuardrailsAgent:
    def check_content(self, user_query: str) -> bool:
        return True


class UserDataAgent:
    def get_user_data(self, user_id: str, domain: str = "gaming") -> dict:
        if domain == "gaming":
            return {
                "username": "Player123",
                "game": "BATTLEGROUNDS MOBILE INDIA",
                "level": 10,
                "last_login": "2025-02-15",
                "achievements": ["Top 10 in Leaderboard", "Completed Level 50"],
                "friends": ["Player456", "Player789"]
            }
        elif domain == "ecommerce":
            return {
                "username": "Customer123",
                "email": "customer123@example.com",
                "order_history": [
                    {
                        "order_id": "O582535",
                        "order_date": "2024-12-24",
                        "status": "Resolved",
                        "items": [{"product_name": "Smartphone X", "quantity": 1, "price": 699.99}],
                        "total_amount": 699.99,
                        "delivery_address": "123 Main St, Springfield, IL, 62701"
                    }
                ],
                "payment_methods": [
                    {"type": "Credit Card", "last_four_digits": "1234"},
                    {"type": "PayPal", "email": "customer123@example.com"}
                ],
                "preferred_delivery_address": "123 Main St, Springfield, IL, 62701",
                "last_login": "2025-02-15"
            }
        else:
            raise ValueError(f"Unsupported domain: {domain}")


class IntentAgent:
    def get_intent(self, query: str) -> Dict[str, str]:
        messages = [
            ChatMessage(
                role="system",
                content="Analyze the query and return JSON with: domain, intent, is_sensitive (boolean)"
            ),
            ChatMessage(role="user", content=query)
        ]
        response = llm.chat(messages)
        try:
            return json.loads(response.content)
        except:
            return {"domain": "general", "intent": "unknown", "is_sensitive": False}


def escalate_to_human(user_query: str) -> str:
    return "Your query has been escalated to human support. Please wait for further assistance."


# ------------------------- RAG Implementation -------------------------
class RAG:
    def __init__(self, collection_name="collection_2", top_k=5):
        self.collection_name = collection_name
        self.top_k = top_k
        self.embed_model = OpenAIEmbedding(model="text-embedding-3-small", api_key=openai_key)
        self.qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key, timeout=60)
        self.vector_store = QdrantVectorStore(
            client=self.qdrant_client,
            collection_name=self.collection_name,
            prefer_grpc=True
        )
        self.storage_context = StorageContext.from_defaults(vector_store=self.vector_store)
        self.index = VectorStoreIndex.from_vector_store(
            vector_store=self.vector_store,
            embed_model=self.embed_model
        )
        self.retriever = self.index.as_retriever(similarity_top_k=self.top_k)

    def search_past_resolutions(self, query: str) -> Optional[str]:
        results = self.retriever.retrieve(query)
        return results[0].text if results else None


# ------------------------- Knowledge Manager Agent -------------------------
class KnowledgeManagerAgent:
    def __init__(self, rag_instance: RAG):
        self.rag = rag_instance
        self.monitoring_agent = HybridMonitoringAgent()
        self.escalation_history = []

    def find_solution(self, query: str, chat_history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        if chat_history is None:
            chat_history = []

        # Monitor the interaction
        monitoring_result = self.monitoring_agent.monitor_interaction(query, chat_history)

        # Try to find solution
        rag_result = self.rag.search_past_resolutions(query)

        # Determine escalation
        should_escalate = monitoring_result['should_escalate']
        if should_escalate:
            self.escalation_history.append({
                'query': query,
                'reason': monitoring_result['analysis'],
                'timestamp': datetime.now().isoformat()
            })

        return {
            'solution': rag_result if rag_result else "No existing solution found",
            'escalate': should_escalate,
            'sentiment': monitoring_result['sentiment'],
            'analysis': monitoring_result['analysis']
        }


# ------------------------- Agent Creation -------------------------
def create_agent():
    # Initialize components
    guardrails_agent = GuardrailsAgent()
    monitoring_agent = HybridMonitoringAgent()
    user_data_agent = UserDataAgent()
    intent_agent = IntentAgent()

    # Initialize RAG systems
    rag_gaming = RAG(collection_name="collection_gaming")
    rag_ecommerce = RAG(collection_name="collection_ecommerce")

    # Create Knowledge Managers
    km_gaming = KnowledgeManagerAgent(rag_gaming)
    km_ecommerce = KnowledgeManagerAgent(rag_ecommerce)

    # Create query engines
    gaming_query_engine = RetrieverQueryEngine(retriever=rag_gaming.retriever)
    ecommerce_query_engine = RetrieverQueryEngine(retriever=rag_ecommerce.retriever)

    # Create tools
    gaming_tool = QueryEngineTool(
        query_engine=gaming_query_engine,
        metadata=ToolMetadata(
            name="gaming_tool",
            description="Useful for answering gaming-related queries."
        )
    )

    ecommerce_tool = QueryEngineTool(
        query_engine=ecommerce_query_engine,
        metadata=ToolMetadata(
            name="ecommerce_tool",
            description="Useful for answering ecommerce-related queries."
        )
    )

    guardrails_tool = FunctionTool.from_defaults(fn=guardrails_agent.check_content)
    monitoring_tool = FunctionTool.from_defaults(fn=monitoring_agent.monitor_interaction)
    get_user_data_tool = FunctionTool.from_defaults(fn=user_data_agent.get_user_data)
    get_intent_tool = FunctionTool.from_defaults(fn=intent_agent.get_intent)
    escalate_to_human_tool = FunctionTool.from_defaults(fn=escalate_to_human)

    # Updated system prompt
    system_prompt = """
    You are an advanced customer support agent that orchestrates multiple tools. Follow this **strict workflow** for each query:

    1. **Guardrails Check** (First Step):  
       - Use `check_content` to block policy-violating queries.  
       - *Response if blocked*: "This request violates our policies. Please rephrase or contact support."  

    2. **Intent & Sentiment Analysis** (Parallel):  
       - Use `get_intent` to identify:  
         - `domain` ("gaming" or "ecommerce").  
         - `is_sensitive` (e.g., payments, account changes).  
       - Use `monitor_interaction` (includes sentiment analysis) to:  
         - Detect frustration/anger (e.g., "furious", "unacceptable").  
         - Track conversation trends (escalate if 3+ negative interactions).  

    3. **Sensitive Query Handling**:  
       - If `is_sensitive=True`:  
         - Verify user identity using `get_user_data`.  
         - *Example*: "For security, confirm your account email."  

    4. **Knowledge Retrieval (RAG)**:  
       - Use `gaming_tool` or `ecommerce_tool` based on `domain`.  
       - *If no solution found*: "Let me escalate this to a specialist."  

    5. **Escalation Rules** (Priority):  
       - **Immediate Escalation** if:  
         - `check_content` blocks the query.  
         - Sentiment is negative + high confidence (`monitor_interaction`).  
         - Sensitive action + identity unverified.  
       - **After RAG Failure**: Always escalate; never guess.  

    6. **Personalization**:  
       - Use `get_user_data` sparingly (e.g., order status, account details).  

    **Critical Rules**:  
    - Never invent answers. Admit uncertainty: "I’ll connect you to a specialist."  
    - For payments/account changes, **always** verify identity first.  
    - De-escalate tense conversations with empathy: "I understand this is frustrating."  
    """

    agent = FunctionCallingAgent.from_tools(
        tools=[
            guardrails_tool,
            monitoring_tool,
            get_user_data_tool,
            get_intent_tool,
            gaming_tool,
            ecommerce_tool,
            escalate_to_human_tool
        ],
        llm=llm,
        system_prompt=system_prompt,
        max_function_calls=10,
        allow_parallel_tool_calls=False,
        verbose=True,
    )

    return agent

# from llama_index.llms.openai import OpenAI
# from llama_index.core import Document, VectorStoreIndex, StorageContext
# from llama_index.core.tools import FunctionTool, QueryEngineTool
# from llama_index.core.tools import ToolMetadata
# from llama_index.core.bridge.pydantic import BaseModel
# from llama_index.core.llms import ChatMessage
# from llama_index.core.agent import FunctionCallingAgent, FunctionCallingAgentWorker
# from llama_index.core.retrievers import VectorIndexRetriever
# from llama_index.core.query_engine import RetrieverQueryEngine
# from llama_index.embeddings.openai import OpenAIEmbedding
# from llama_index.vector_stores.qdrant import QdrantVectorStore
# from qdrant_client import QdrantClient
# from qdrant_client.http import models
# from llama_index.core.schema import NodeWithScore
# from typing import Optional, Dict, Any, List
# import pandas as pd
# import openai
# import os
# from dotenv import load_dotenv
# import json
# import asyncio
# from abc import abstractmethod
# from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Union
# from llama_index.core.base.llms.types import (
#     ChatMessage,
#     ChatResponse,
#     ChatResponseAsyncGen,
#     ChatResponseGen,
# )
# from llama_index.core.llms.llm import LLM, ToolSelection
# from groq import Groq
#
# # ------------------------- Load Environment -------------------------
# load_dotenv()
# openai_key = os.getenv("OPENAI_API_KEY")
# qdrant_url = os.getenv("Qdrant_URL")
# qdrant_api_key = os.getenv("Qdrant_API_Key")
# GROQ_API_KEY = os.getenv("GROQ_API_KEY")
# os.environ["COHERE_API_KEY"] = os.getenv("COHERE_API_KEY")
#
# # Initialize Groq client
# client = Groq(api_key=GROQ_API_KEY)
#
# # ------------------------- Constants -------------------------
# MIN_CHAT_HISTORY_FOR_SENTIMENT = 3  # Skip sentiment check for first N messages
# SENTIMENT_THRESHOLD = 2  # Number of negative messages before escalation
#
# # ------------------------- Sample Data (Optional) -------------------------
# # Paths to CSV files
# gaming_csv_path = 'samples_issues_gaming.csv'
# ecommerce_csv_path = 'samples_issues_ecommerce_fixed.csv'
#
# # Load CSV files into DataFrames
# df_gaming = pd.read_csv(gaming_csv_path)
# df_ecommerce = pd.read_csv(ecommerce_csv_path)
#
# # Extract data from DataFrames
# past_resolutions_gaming = df_gaming['body'].tolist()
# past_resolutions_ecommerce = df_ecommerce['body'].tolist()
#
# # ------------------------- LLM Initialization -------------------------
# # Replace "gpt-4o-mini" with the appropriate model if needed.
# llm = OpenAI(model="gpt-4o-mini", api_key=openai_key)
#
#
# # ------------------------- Enhanced Monitoring Agent -------------------------
# class MonitoringAgent:
#     """Enhanced monitoring agent with chat history awareness."""
#
#     def __init__(self):
#         self.negative_count = 0
#
#     def get_sentiment(self, chat_history: List[Dict[str, str]]) -> str:
#         """
#         Analyze sentiment of conversation with chat history awareness.
#         Returns: "positive", "neutral", or "negative"
#         """
#         # Skip sentiment analysis for first few messages
#         if len(chat_history) < MIN_CHAT_HISTORY_FOR_SENTIMENT:
#             return "neutral"
#
#         # Combine recent messages for sentiment analysis
#         chat_text = "\n".join([f"{msg['role']}: {msg['content']}" for msg in chat_history[-5:]])
#
#         try:
#             response = client.chat.completions.create(
#                 model="gemma2-9b-it",
#                 messages=[
#                     {
#                         "role": "system",
#                         "content": "Analyze the sentiment of this conversation. Return ONLY one word: 'positive', 'neutral', or 'negative'."
#                     },
#                     {"role": "user", "content": chat_text}
#                 ],
#                 temperature=0.2,
#                 max_tokens=10
#             )
#
#             sentiment = response.choices[0].message.content.strip().lower()
#
#             # Track consecutive negative sentiments
#             if sentiment == "negative":
#                 self.negative_count += 1
#             else:
#                 self.negative_count = max(0, self.negative_count - 1)
#
#             return sentiment if sentiment in ["positive", "neutral", "negative"] else "neutral"
#
#         except Exception as e:
#             print(f"Sentiment analysis error: {str(e)}")
#             return "neutral"
#
#     def should_escalate(self) -> bool:
#         """Check if we should escalate based on sentiment history"""
#         return self.negative_count >= SENTIMENT_THRESHOLD
#
#     def monitor_interaction(self, user_query: str, chat_history: List[Dict[str, str]] = None) -> str:
#         """Monitor and log user queries with sentiment analysis."""
#         if chat_history is None:
#             chat_history = []
#
#         sentiment = self.get_sentiment(chat_history)
#         monitoring_status = f"Monitoring: Logged query -> {user_query} | Sentiment: {sentiment}"
#
#         if self.should_escalate():
#             monitoring_status += " | ESCALATION TRIGGERED"
#
#         return monitoring_status
#
#
# # ------------------------- Additional Agents (from Diagram) -------------------------
# class GuardrailsAgent:
#     """Check incoming user queries for policy compliance or restricted content."""
#
#     def check_content(self, user_query: str) -> bool:
#         # Placeholder logic: Always returns True (i.e., content is allowed).
#         # Implement your real guardrail logic here.
#         return True
#
#
# class UserDataAgent:
#     def get_user_data(self, user_id: str, domain: str = "gaming") -> dict:
#         """
#         Fetch user-specific data based on the domain (gaming or ecommerce).
#
#         Args:
#             user_id: The ID of the user.
#             domain: The domain for which to fetch data ("gaming" or "ecommerce").
#
#         Returns:
#             A dictionary containing user-specific data for the specified domain.
#         """
#         if domain == "gaming":
#             # Return gaming-specific user data
#             return {
#                 "username": "Player123",
#                 "game": "BATTLEGROUNDS MOBILE INDIA",
#                 "level": 10,
#                 "last_login": "2025-02-15",
#                 "achievements": ["Top 10 in Leaderboard", "Completed Level 50"],
#                 "friends": ["Player456", "Player789"]
#             }
#         elif domain == "ecommerce":
#             # Return ecommerce-specific user data
#             return {
#                 "username": "Customer123",
#                 "email": "customer123@example.com",
#                 "order_history": [
#                     {
#                         "order_id": "O582535",
#                         "order_date": "2024-12-24",
#                         "status": "Resolved",
#                         "items": [
#                             {"product_name": "Smartphone X", "quantity": 1, "price": 699.99}
#                         ],
#                         "total_amount": 699.99,
#                         "delivery_address": "123 Main St, Springfield, IL, 62701"
#                     },
#                     {
#                         "order_id": "O412512",
#                         "order_date": "2025-01-01",
#                         "status": "In Progress",
#                         "items": [
#                             {"product_name": "Laptop Pro", "quantity": 1, "price": 1299.99}
#                         ],
#                         "total_amount": 1299.99,
#                         "delivery_address": "456 Elm St, Springfield, IL, 62701"
#                     }
#                 ],
#                 "payment_methods": [
#                     {"type": "Credit Card", "last_four_digits": "1234"},
#                     {"type": "PayPal", "email": "customer123@example.com"}
#                 ],
#                 "preferred_delivery_address": "123 Main St, Springfield, IL, 62701",
#                 "last_login": "2025-02-15"
#             }
#         else:
#             raise ValueError(f"Unsupported domain: {domain}. Use 'gaming' or 'ecommerce'.")
#
#
# class IntentAgent:
#     def get_intent(self, query: str) -> str:
#         """Determine user intent using LLM."""
#         messages = [
#             ChatMessage(role="system", content="Determine the intent of the following user query."),
#             ChatMessage(role="user", content=query)
#         ]
#         response = llm.chat(messages)
#         return response
#
#
# def escalate_to_human(user_query: str) -> str:
#     """Escalate to human support."""
#     return "Your query has been escalated to human support. Please wait for further assistance."
#
#
# # ------------------------- RAG Implementation with Qdrant -------------------------
# class RAG:
#     def __init__(self, collection_name="collection_2", top_k=5):
#         """
#         Initialize RAG with connection to existing Qdrant collection
#
#         Args:
#             collection_name: Name of the Qdrant collection to connect to
#             top_k: Number of similar issues to retrieve by default
#         """
#         self.collection_name = collection_name
#         self.top_k = top_k
#
#         # Configure the embedding model
#         self.embed_model = OpenAIEmbedding(
#             model="text-embedding-3-small",
#             api_key=openai_key
#         )
#
#         # Initialize Qdrant client
#         self.qdrant_client = QdrantClient(
#             url=qdrant_url,
#             api_key=qdrant_api_key,
#             timeout=60
#         )
#
#         # Initialize vector store
#         self.vector_store = QdrantVectorStore(
#             client=self.qdrant_client,
#             collection_name=self.collection_name,
#             prefer_grpc=True
#         )
#
#         # Create storage context from existing vector store
#         self.storage_context = StorageContext.from_defaults(vector_store=self.vector_store)
#
#         # Load the vector index from the existing storage
#         self.index = VectorStoreIndex.from_vector_store(
#             vector_store=self.vector_store,
#             embed_model=self.embed_model
#         )
#
#         # Create the retriever
#         self.retriever = self.index.as_retriever(similarity_top_k=self.top_k)
#
#     def search_past_resolutions(self, query: str) -> Optional[str]:
#         """
#         Retrieve the most relevant resolution for a given query
#
#         Args:
#             query: The issue description or query to search for
#
#         Returns:
#             The text of the most relevant resolution or None if no results found
#         """
#         results = self.retriever.retrieve(query)
#         if results:
#             return results[0].text  # Return the most relevant resolution
#         return None
#
#
# # ------------------------- Knowledge Manager Agent -------------------------
# class KnowledgeManagerAgent:
#     """
#     Orchestrates knowledge lookups using RAG.
#     Could be extended to manage multiple indices, route queries, etc.
#     """
#
#     def __init__(self, rag_instance: RAG):
#         self.rag = rag_instance
#         self.monitoring_agent = MonitoringAgent()
#
#     def find_solution(self, query: str, chat_history: List[Dict[str, str]] = None) -> Dict[str, Any]:
#         """
#         Find solutions using RAG and determine if escalation is needed
#
#         Args:
#             query: The user's query
#             chat_history: List of previous messages in the conversation
#
#         Returns:
#             Dictionary with solution and whether to escalate
#         """
#         # Check sentiment and escalation status
#         if chat_history:
#             sentiment = self.monitoring_agent.get_sentiment(chat_history)
#             if self.monitoring_agent.should_escalate():
#                 return {
#                     "solution": "Multiple negative interactions detected. Escalating to human support.",
#                     "escalate": True
#                 }
#
#         # Proceed with RAG search
#         rag_result = self.rag.search_past_resolutions(query)
#         if rag_result:
#             return {"solution": rag_result, "escalate": False}
#         else:
#             return {"solution": "No existing solution found in our database.", "escalate": True}
#
#
# def create_agent():
#     """
#     The Core Agent orchestrates all sub-agents/tools:
#     1. Guardrails (content check)
#     2. Monitoring
#     3. Sentiment check
#     5. Intent detection
#     6. Knowledge Manager for RAG-based solutions
#     7. Escalation if needed
#     """
#     # Instantiate additional agents
#     guardrails_agent = GuardrailsAgent()
#     monitoring_agent = MonitoringAgent()
#     user_data_agent = UserDataAgent()
#     intent_agent = IntentAgent()
#
#     # Instantiate RAG for gaming and ecommerce
#     rag_gaming = RAG(collection_name="collection_gaming", top_k=5)
#     rag_ecommerce = RAG(collection_name="collection_ecommerce", top_k=5)
#
#     # Create Knowledge Manager with monitoring capabilities
#     km_gaming = KnowledgeManagerAgent(rag_gaming)
#     km_ecommerce = KnowledgeManagerAgent(rag_ecommerce)
#
#     # Create a QueryEngine from the retriever
#     gaming_query_engine = RetrieverQueryEngine(retriever=rag_gaming.retriever)
#     ecommerce_query_engine = RetrieverQueryEngine(retriever=rag_ecommerce.retriever)
#
#     # Create query engine tools for gaming and ecommerce
#     gaming_tool = QueryEngineTool(
#         query_engine=gaming_query_engine,
#         metadata=ToolMetadata(
#             name="gaming_tool",
#             description="Useful for answering gaming-related queries."
#         )
#     )
#
#     ecommerce_tool = QueryEngineTool(
#         query_engine=ecommerce_query_engine,
#         metadata=ToolMetadata(
#             name="ecommerce_tool",
#             description="Useful for answering ecommerce-related queries."
#         )
#     )
#
#     # Wrap each agent method as a FunctionTool
#     guardrails_tool = FunctionTool.from_defaults(fn=guardrails_agent.check_content)
#     monitoring_tool = FunctionTool.from_defaults(fn=monitoring_agent.monitor_interaction)
#     get_user_data_tool = FunctionTool.from_defaults(fn=user_data_agent.get_user_data)
#     get_intent_tool = FunctionTool.from_defaults(fn=intent_agent.get_intent)
#     escalate_to_human_tool = FunctionTool.from_defaults(fn=escalate_to_human)
#
#     # System prompt describing the entire multi-agent flow
#     system_prompt = """
#         You are the Core Agent in a multi-domain customer support system.
#         Follow these steps for each user query:
#
#         1. Use `check_content` (guardrails) to ensure the user query is allowed.
#            - If disallowed, respond with a policy message or escalate.
#         2. Use `monitor_interaction` to log or track the user query.
#         3. Use `get_user_data` to personalize responses based on the user.
#         4. Use `get_intent` to determine the user's goal or request.
#         5. Use the appropriate query engine tool (`gaming_tool` or `ecommerce_tool`) to search for any known solutions via RAG.
#         6. If no solution is found or negative sentiment is detected, use `escalate_to_human`.
#
#         Do NOT generate any fallback answers if no solution is found in the database. Simply escalate.
#         If the guardrails or monitoring step detects an issue, you may also escalate.
#     """
#
#     # Create the Core Agent with function tools
#     agent = FunctionCallingAgent.from_tools(
#         tools=[
#             guardrails_tool,
#             monitoring_tool,
#             get_user_data_tool,
#             get_intent_tool,
#             gaming_tool,
#             ecommerce_tool,
#             escalate_to_human_tool
#         ],
#         llm=llm,
#         system_prompt=system_prompt,
#         max_function_calls=10,
#         allow_parallel_tool_calls=False,
#         verbose=True,
#     )
#
#     return agent

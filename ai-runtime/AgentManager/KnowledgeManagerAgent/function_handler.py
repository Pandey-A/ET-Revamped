import os
import json
import weaviate
from weaviate.classes.init import AdditionalConfig, Timeout

from llama_index.core import Document, VectorStoreIndex, StorageContext
from llama_index.vector_stores.weaviate import WeaviateVectorStore
from llama_index.embeddings.openai import OpenAIEmbedding
from AgentManager.llm_handler import get_openai_api_key, get_openai_embedding_model

from typing import Optional, Dict, Any
import cohere


# ─── Load Configuration ───────────────────────────────────────────────────────
with open("AgentManager/config.json", "r") as config_file:
    config = json.load(config_file)

wc = config.get("weaviate") or {}
weaviate_url = (os.getenv("WEAVIATE_URL") or wc.get("url") or "http://localhost:8080").strip()
weaviate_api_key = os.getenv("WEAVIATE_API_KEY") or wc.get("api_key")
cohere_api_key = (os.getenv("COHERE_API_KEY") or (config.get("cohere") or {}).get("api_key") or "").strip()
# Ignore weak KB matches when Cohere rerank score is below this (filters trivia/unrelated queries).
MIN_RERANK_RELEVANCE = float(config.get("rag", {}).get("min_rerank_relevance", 0.12))

_co_client: Optional[cohere.Client] = None
if cohere_api_key:
    os.environ["COHERE_API_KEY"] = cohere_api_key
    _co_client = cohere.Client(api_key=cohere_api_key)
else:
    print("[RAG] COHERE_API_KEY not set — using vector retrieval only (no rerank).")


def _connect_weaviate():
    """
    Connects to Weaviate.
    - If URL is http:// or localhost → self-hosted on EC2 via connect_to_custom
    - Otherwise → Weaviate Cloud via connect_to_weaviate_cloud
    """
    if weaviate_url.startswith("http://") or "localhost" in weaviate_url:
        # Parse host and port from URL like http://13.235.4.10:8080
        stripped = weaviate_url.replace("http://", "").replace("https://", "")
        if ":" in stripped:
            host, port_str = stripped.rsplit(":", 1)
            port = int(port_str)
        else:
            host = stripped
            port = 8080
        grpc_port = config["weaviate"].get("grpc_port", 50051)
        client = weaviate.connect_to_custom(
            http_host=host,
            http_port=port,
            http_secure=False,
            grpc_host=host,
            grpc_port=grpc_port,
            grpc_secure=False,
            skip_init_checks=True,
            additional_config=AdditionalConfig(
                timeout=Timeout(init=60, query=60, insert=120)
            )
        )
    else:
        from weaviate.classes.init import Auth
        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=weaviate_url,
            auth_credentials=weaviate.auth.AuthApiKey(weaviate_api_key),
            skip_init_checks=True,
            additional_config=AdditionalConfig(
                timeout=Timeout(init=60, query=60, insert=120)
            )
        )
    print("Weaviate Connection Status:", client.is_ready())
    return client


def _to_weaviate_class(collection_name: str) -> str:
    """Weaviate class names must start with uppercase and be alphanumeric+underscore."""
    clean = collection_name.replace("-", "_").replace(" ", "_")
    return clean[0].upper() + clean[1:] if clean else "DefaultCollection"


class RAG:
    def __init__(self, top_k: int = 5):
        self.top_k = top_k
        self.embed_model = OpenAIEmbedding(
            model=get_openai_embedding_model(),
            api_key=get_openai_api_key(),
        )
        self.weaviate_client = _connect_weaviate()

    def search_past_resolutions(self, query: str, collection_name: str) -> Any:
        try:
            weaviate_class = _to_weaviate_class(collection_name)
            print(f"[RAG] Searching Weaviate class '{weaviate_class}' for: {query[:60]}")

            vector_store = WeaviateVectorStore(
                weaviate_client=self.weaviate_client,
                index_name=weaviate_class,
            )
            index = VectorStoreIndex.from_vector_store(
                vector_store=vector_store,
                embed_model=self.embed_model
            )

            retriever = index.as_retriever(similarity_top_k=self.top_k)
            results = retriever.retrieve(query)

            print("Retrieval Results Received")
            doc_texts = [node.text.strip() for node in results if node.text and node.text.strip()]

            if not doc_texts:
                print("[RAG] No documents retrieved from Weaviate for this query.")
                return None

            if _co_client:
                rerank_docs = _co_client.rerank(
                    query=query, documents=doc_texts, top_n=min(3, len(doc_texts)), model="rerank-v3.5"
                )
                print("Reranking Done")
                if rerank_docs.results:
                    best = rerank_docs.results[0]
                    score = getattr(best, "relevance_score", None)
                    chunk = doc_texts[best.index]
                    if score is None or score < MIN_RERANK_RELEVANCE:
                        # Low rerank often happens for valid business questions that
                        # sound like general geography (e.g. "where is the gym located").
                        print(
                            f"[RAG] Best relevance {score} below threshold "
                            f"{MIN_RERANK_RELEVANCE} — falling back to top vector match"
                        )
                        return {
                            "chunk": chunk,
                            "relevance_score": score,
                            "rerank_weak": True,
                        }
                    return {
                        "chunk": chunk,
                        "relevance_score": score,
                    }
                return None

            # No Cohere key: use best vector match directly
            return {
                "chunk": doc_texts[0],
                "relevance_score": 1.0,
            }

        except Exception as e:
            print(f"[RAG] Retrieval error: {e}")
            return None
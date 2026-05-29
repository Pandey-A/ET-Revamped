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

weaviate_url = config["weaviate"]["url"]
weaviate_api_key = config["weaviate"].get("api_key", None)
cohere_api_key = config["cohere"]["api_key"]
# Ignore weak KB matches when Cohere rerank score is below this (filters trivia/unrelated queries).
MIN_RERANK_RELEVANCE = float(config.get("rag", {}).get("min_rerank_relevance", 0.12))

os.environ["COHERE_API_KEY"] = cohere_api_key
co = cohere.Client()


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
                return None

            rerank_docs = co.rerank(
                query=query, documents=doc_texts, top_n=3, model="rerank-v3.5"
            )
            print("Reranking Done")

            if rerank_docs.results:
                best = rerank_docs.results[0]
                score = getattr(best, "relevance_score", None)
                if score is None or score < MIN_RERANK_RELEVANCE:
                    print(
                        f"[RAG] Best relevance {score} below threshold "
                        f"{MIN_RERANK_RELEVANCE} — weak match only"
                    )
                    return {
                        "weak_match": True,
                        "relevance_score": score,
                    }
                return {
                    "chunk": doc_texts[best.index],
                    "relevance_score": score,
                }
            return None

        except Exception as e:
            return f"An error occurred during retrieval: {str(e)}"
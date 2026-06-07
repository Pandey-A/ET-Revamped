import os

from .function_handler import RAG

class KnowledgeManagerHandler:
    def __init__(self):
        self.rag = None
        if os.getenv("SKIP_RAG_INIT", "").strip() not in ("1", "true", "yes"):
            try:
                self.rag = RAG(top_k=5)
            except Exception as exc:
                import logging
                logging.warning("RAG init skipped (Weaviate unavailable): %s", exc)
        return

    def rag_function(self, query: str, collection_name: str) -> dict:
        if not self.rag:
            return {"solution": "Knowledge base is temporarily unavailable.", "escalate": True}
        rag_result = self.rag.search_past_resolutions(query, collection_name)
        if isinstance(rag_result, dict):
            chunk = (rag_result.get("chunk") or "").strip()
            if chunk:
                return {"solution": rag_result, "escalate": False}
            if rag_result.get("weak_match"):
                return {"solution": "No existing solution found in our database.", "escalate": True}
        if isinstance(rag_result, str) and rag_result.strip():
            return {"solution": rag_result, "escalate": False}
        return {"solution": "No existing solution found in our database.", "escalate": True}


from .function_handler import RAG

class KnowledgeManagerHandler:
    def __init__(self):
        self.rag = RAG(top_k=5)
        return

    def rag_function(self, query: str, collection_name:str) -> dict:
        rag_result = self.rag.search_past_resolutions(query, collection_name)
        if rag_result:
            return {"solution": rag_result, "escalate": False}
        else:
            return {"solution": "No existing solution found in our database.", "escalate": True}


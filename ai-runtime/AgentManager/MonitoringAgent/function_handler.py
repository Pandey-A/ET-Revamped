from transformers import pipeline
from datetime import datetime
from typing import Dict, Any, List
from AgentManager import meta_store

class HybridMonitoringAgent:
    def __init__(self):
        # Lazy initialization for PyTorch pipeline to prevent macOS fork deadlocks
        self.model = None
        # Escalation: 3 consecutive negatives triggers escalation
        self.escalation_count = 3
        self.escalation_message = (
            "It seems you’re facing difficulties. Would you like to talk to a human agent?"
        )
        # History per session
        self.history: Dict[str, List[str]] = {}

    def analyze_sentiment(self, text: str) -> Dict[str, Any]:
        # MOCK: Disabled PyTorch pipeline due to macOS libomp/threading deadlocks
        # This was causing the entire chat backend to hang and drop connections.
        return {'sentiment': 'positive', 'confidence': 0.99}

    def monitor_interaction(self,
                user_query: str,
                session_id: str,
                chat_history: List[Dict[str, str]] = None
                ) -> Dict[str, Any]:
        chat_history = chat_history or []
        session_id = (
            "_".join(session_id) if isinstance(session_id, list) else session_id
        )

        analysis = self.analyze_sentiment(user_query)
        sentiment = analysis['sentiment']

        # Track sentiment history
        self.history.setdefault(session_id, []).append(sentiment)
        if not chat_history:
            meta_store.put(session_id,{"sentiment":None})
        meta= meta_store.get(session_id)
        if meta is None:
            meta = {}
        meta["sentiment"]=sentiment
        meta_store.put(session_id,meta)

        # Check for escalation
        recent = self.history[session_id][-self.escalation_count:]
        escalation = (
            self.escalation_message
            if len(recent) == self.escalation_count and all(s == 'negative' for s in recent)
            else None
        )

        return {
            'user_query': user_query,
            'sentiment_analysis': {
                'sentiment': sentiment,
                'confidence': analysis['confidence']
            },
            'timestamp': datetime.now().isoformat(),
            'session_id': session_id,
            'chat_history_length': len(chat_history),
            'escalation': escalation
        }

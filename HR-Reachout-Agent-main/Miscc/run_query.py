# run_query.py
from AgentManager.Query_handler import QueryHandler

if __name__ == "__main__":
    handler = QueryHandler()
    handler.process_query("Hello, how to level up in game?", "live_chat_001")
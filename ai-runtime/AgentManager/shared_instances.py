from .Chat_history_handler import ChatHistoryHandler
from .Instruction_handler import InstructionHandler
from .Meta_store_handler import meta_store
from .llm_handler import LLMHandler

chat_history_handler = ChatHistoryHandler()
instruction_handler = InstructionHandler()
llm_handler= LLMHandler()

def get_query_handler():
    from .Query_handler import QueryHandler
    return QueryHandler()

__all__ = [
    'chat_history_handler',
    'instruction_handler',
    'llm_handler',
    'get_query_handler',
    'meta_store'
]
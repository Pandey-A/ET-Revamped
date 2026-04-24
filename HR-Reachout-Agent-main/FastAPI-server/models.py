from pydantic import BaseModel

class ChatRequest(BaseModel):
    user_input: str
    session_id: str
    agent_id: str

class AnalyzeAction(BaseModel):
    user_input: str
    assistant_response: str
    session_id: str
    agent_id: str

from llama_index.core.tools import FunctionTool
from AgentManager.ActionAgent import action_agent_handler
from AgentManager.KnowledgeManagerAgent import knowledge_management_handler
from AgentManager.MonitoringAgent import hybrid_monitoring_agent

class ToolHandler:
    def __init__(self):
        
        # Create tools for gaming and ecommerce using direct function calls
        self.knowledge_source_tool = FunctionTool.from_defaults(fn=knowledge_management_handler.rag_function,
                                                                name="knowledge_source",
                                                                description="This is the knowledge source tool. it takes collection name as string and query in string to fetch the knowledge about that query."
                                                                )

        # Wrap each agent method as a FunctionTool
        self.monitoring_tool = FunctionTool.from_defaults(fn=hybrid_monitoring_agent.monitor_interaction)
        self.action_tool = FunctionTool.from_defaults(fn=action_agent_handler.process_user_input)

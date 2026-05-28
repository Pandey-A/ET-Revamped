from llama_index.core.agent import ReActAgent
from llama_index.core.tools import FunctionTool
from AgentManager import instruction_handler, llm_handler
from .tool_handler import ToolHandler
from AgentManager.KnowledgeManagerAgent import knowledge_management_handler
import json
import logging

try:
    with open('AgentManager/config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

bedrock_cfg = config['Bedrock']


class CoreAgentHandler:
    def __init__(self):
        self.tool_handler = ToolHandler()
        logging.info("Initialized Core Agent")
        pass

    def create_core_agent(self, query_sentiment, collection_name, model_id=None):
        """
        The Core Agent orchestrates all sub-agents/tools:
        1. Monitoring
        2. Sentiment check
        3. Knowledge Manager for RAG-based solutions
        4. Escalation if needed

        Uses ReActAgent which works with any LLM (no native function-calling required).
        """

        # System prompt describing the entire multi-agent flow
        system_prompt = instruction_handler.core_agent_prompt.format(sentiment=query_sentiment, collection_name=collection_name)

        llm = llm_handler.get_llm(
            model_id or bedrock_cfg['model_id'],
            bedrock_cfg.get('temperature', 0.7),
        )

        # Bind the collection_name server-side so the LLM can't call the tool
        # with an incorrect collection (which would look like an empty knowledge base).
        def knowledge_source(query: str) -> dict:
            return knowledge_management_handler.rag_function(
                query=query,
                collection_name=collection_name,
            )

        knowledge_source_tool = FunctionTool.from_defaults(
            fn=knowledge_source,
            name="knowledge_source",
            description=(
                "Fetch answers from the agent's uploaded knowledge base. "
                "Input: query (string). Output: solution/escalate."
            ),
        )

        # Create the Core Agent with ReAct (compatible with any LLM)
        agent = ReActAgent.from_tools(
            tools=[
                    knowledge_source_tool,
            ],
            llm=llm,
            system_prompt=system_prompt,
            verbose=True,
            max_iterations=15,
        )
        return agent
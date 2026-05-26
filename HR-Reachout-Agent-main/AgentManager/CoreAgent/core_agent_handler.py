from llama_index.core.agent import ReActAgent
from AgentManager import instruction_handler, llm_handler
from .tool_handler import ToolHandler
import json
import logging

try:
    with open('AgentManager/config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

bedrock_cfg = config['Bedrock']
llm = llm_handler.get_llm(bedrock_cfg['model_id'], bedrock_cfg.get('temperature', 0.7))


class CoreAgentHandler:
    def __init__(self):
        self.tool_handler = ToolHandler()
        logging.info("Initialized Core Agent")
        pass

    def create_core_agent(self, query_sentiment, collection_name):
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

        # Create the Core Agent with ReAct (compatible with any LLM)
        agent = ReActAgent.from_tools(
            tools=[
                    self.tool_handler.knowledge_source_tool,
            ],
            llm=llm,
            system_prompt=system_prompt,
            verbose=True,
        )
        return agent
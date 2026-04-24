from llama_index.agent.openai import OpenAIAgent
from AgentManager import instruction_handler, llm_handler
from .tool_handler import ToolHandler
import json
import logging

try:
    with open('AgentManager/config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

model = config['OpenAI']['model']
temperature = config['OpenAI']['temperature']

llm = llm_handler.get_llm(model, temperature)


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
        """

        # System prompt describing the entire multi-agent flow
        system_prompt = instruction_handler.core_agent_prompt.format(sentiment=query_sentiment, collection_name=collection_name)

        # Create the Core Agent with function tools
        agent = OpenAIAgent.from_tools(
            tools=[
                    self.tool_handler.knowledge_source_tool,
            ],
            llm=llm,
            system_prompt=system_prompt,
            allow_parallel_tool_calls=False,
            verbose=True,
        )
        return agent
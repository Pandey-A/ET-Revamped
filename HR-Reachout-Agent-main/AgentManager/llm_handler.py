from llama_index.llms.bedrock import Bedrock
from pathlib import Path
import json

# Reading the Bedrock Model config
config_path = Path(__file__).parent / "config.json"
with open(config_path) as config_file:
    config = json.load(config_file)

_bedrock_cfg = config["Bedrock"]


class LLMHandler:
    def __init__(self):
        return

    def get_llm(self, model=None, temperature=None):
        """Return a Bedrock LLM instance.

        Credentials are resolved automatically from the EC2 IAM role
        via the default boto3 credential chain — no API keys required.
        """
        llm = Bedrock(
            model=model or _bedrock_cfg["model_id"],
            temperature=temperature or _bedrock_cfg.get("temperature", 0.7),
            region_name=_bedrock_cfg.get("region", "ap-south-1"),
            context_size=128000
            # boto3 picks up IAM role creds automatically
        )
        return llm
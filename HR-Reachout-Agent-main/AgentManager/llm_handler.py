from llama_index.llms.bedrock import Bedrock
import llama_index.llms.bedrock.utils as bedrock_utils
import llama_index.llms.bedrock.base as bedrock_base
from pathlib import Path
import json

# Monkey-patch get_provider to handle the custom "openai" provider prefix.
# We must patch BOTH bedrock_utils AND bedrock_base because base.py does
# `from .utils import get_provider` which creates a separate local reference.
original_get_provider = bedrock_utils.get_provider
def patched_get_provider(model: str):
    try:
        return original_get_provider(model)
    except ValueError:
        # If the provider (e.g. openai) is not supported by LlamaIndex natively,
        # fallback to MetaProvider which supports standard chat formatting well.
        return bedrock_utils.ProviderType.META.provider

bedrock_utils.get_provider = patched_get_provider
bedrock_base.get_provider = patched_get_provider


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
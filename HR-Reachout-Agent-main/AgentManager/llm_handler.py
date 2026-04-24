from llama_index.llms.openai import OpenAI
from pathlib import Path
import json

# Reading the OpenAI Model and API key
config_path = Path(__file__).parent / "config.json"
with open(config_path) as config_file:
    config = json.load(config_file)

class LLMHandler:
    def __init__(self):
        return

    def get_llm(self, model, temperature):

        llm = OpenAI(model=model,
                     api_key=config["OpenAI"]["Key"],
                     temperature=temperature
                    )
        return llm
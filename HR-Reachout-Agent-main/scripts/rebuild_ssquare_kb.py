#!/usr/bin/env python3
"""Rebuild S Square Fitness Weaviate KB from the single complete PDF."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

from dotenv import load_dotenv

load_dotenv(os.path.join(ROOT, ".env"))

from AgentManager.KnowledgeManagerAgent.resources import rebuild_pdf_knowledge_base

AGENT_ID = "agent_1780319230183_2blh5h"
COLLECTION = "S_Square_Fitness_agent_1780319230183_2blh5h"
PDF = os.path.join(ROOT, "temp_files", "S_Square_Fitness_Club_Complete_Document.pdf")


def main():
    if not os.path.isfile(PDF):
        print(f"ERROR: PDF missing at {PDF}")
        sys.exit(1)
    print(f"Rebuilding {COLLECTION} from {PDF} …")
    rebuild_pdf_knowledge_base(PDF, COLLECTION, clear_existing=True)
    print("Done. Restart FastAPI if it is running.")


if __name__ == "__main__":
    main()

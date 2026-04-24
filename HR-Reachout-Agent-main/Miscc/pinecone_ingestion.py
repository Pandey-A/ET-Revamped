import os
from dotenv import load_dotenv

from llama_index.core import (
    SimpleDirectoryReader,
    VectorStoreIndex,
    StorageContext,
    Document
)
from llama_index.core.node_parser import SemanticSplitterNodeParser
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.llms.openai import OpenAI

from llama_index.vector_stores.pinecone import PineconeVectorStore

from pinecone import Pinecone, ServerlessSpec

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENV = os.getenv("PINECONE_ENVIRONMENT")
INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")

print("✅ credentials imported")

embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    api_key=OPENAI_API_KEY,
)

llm = OpenAI(
    model="gpt-4o-mini",
    api_key=OPENAI_API_KEY,
)

pc = Pinecone(api_key=PINECONE_API_KEY)
print("✅ embedding model and pinecone client initialized")

# if INDEX_NAME in [idx.name for idx in pc.list_indexes()]:
#     pc.delete_index(INDEX_NAME)
#     print(f"✅ deleted existing pinecone index: {INDEX_NAME}")

# if INDEX_NAME not in [idx.name for idx in pc.list_indexes()]:
#     pc.create_index(
#         name=INDEX_NAME,
#         dimension=1536,
#         metric="cosine",
#         spec=ServerlessSpec(
#             cloud="aws",
#             region=PINECONE_ENV,
#         ),
#     )
#     print(f"✅ created new pinecone index: {INDEX_NAME}")

pinecone_index = pc.Index(INDEX_NAME)
print("✅ connected to pinecone index")

text = """
 Banana Technologies: Corporate Profile & Employee Handbook
Confidential | For Internal Use & HR Agent Training Only
Last Updated: October 2025
1. Company Overview
Banana Technologies is a global leader in "frugal innovation" and sustainable AI solutions. Founded
in 2018, our mission is to peel back the layers of technological complexity to provide simple,
nutritious software solutions for complex global problems.
- Headquarters: Pune, India (Global Tech Park).
- Regional Hubs: San Francisco, London, Singapore.
- Industry: Enterprise AI, Cloud Infrastructure, and Agrotech.
- Mission: "To code a future where technology is as accessible and essential as fruit."
- Vision: To become the world's most trusted partner in sustainable digital transformation by
2030.
2. Why Work With Us? (Employee Value Proposition)
Candidates often ask, "Why Banana?" Here are our key selling points:
1. The "Green Code" Initiative: We are a carbon-negative company. Every line of code we ship
is optimized for energy efficiency.
2. Unpeeled Potential: We have a flattened hierarchy. A Junior Dev’s idea can become a
flagship product if it solves a real problem.
3. Learning Stipend: Every employee gets an annual budget of $2,000 (or local equivalent) for
upskilling, conferences, or certifications.
4. Wellness First: We offer comprehensive mental health support, including mandatory "Digital
Detox" days once a quarter.
3. Work Modes & Location Policies
Crucial Section for HR Agent: Candidates will frequently ask about flexibility.
Banana Technologies operates on a "Role-Based Flexibility" model. We do not believe in a one-sizefits-all approach.
A. Fully Remote (The "Nomad" Track)
- Eligibility: Engineering (Senior+), Content, Design, and Customer Support roles.
- Policy: Employees can work from anywhere within their hired country. International remote
work is allowed for up to 90 days a year (visa permitting).
- Stipend: One-time Home Office Setup allowance of $1,000.
B. Hybrid (The "Split" Track)
- Eligibility: Product Management, Junior Engineering, HR, and Sales.
- Policy: Employees are required to be in the office 2 days a week (usually Tuesday and
Thursday). The remaining 3 days are flexible.
- Benefit: Free lunch and commute reimbursement on in-office days.
C. Fully Onsite (The "Hub" Track)
- Eligibility: Hardware R&D, Data Center Operations, and Security teams.
- Policy: 5 days a week at the office due to access to specialized equipment (The "Banana
Lab").
- Benefit: Premium shift allowances, dedicated relaxation zones, and higher annual bonus
percentage (15% vs standard 10%).
4. Key Policies & Benefits
Leave Policy (Annual)
Leave Type Days Notes
Privilege/Earned 21 Can be carried forward (max 45 days).
Sick/Casual 12 No medical certificate needed for < 2 days.
Wellness Days 4 Quarterly mandatory days off for mental health.
Parental Leave 26 Weeks Primary Caregiver (fully paid).
Partner Leave 4 Weeks Secondary Caregiver (fully paid).
Equipment Policy (BYOD vs. Company Issued)
- Standard Issue: All employees receive a MacBook Pro (M-Series) or Dell XPS, plus a 27-inch
4K monitor.
- BYOD: Not permitted for Engineering/Security roles due to IP protection protocols.
Performance Reviews
- Reviews happen bi-annually (June and December).
- We use a "360-degree feedback" mechanism.
- Promotions are merit-based, not tenure-based.
5. Current Flagship Projects
Use this data when candidates ask, "What kind of work will I be doing?"
Project "Yellow Stone" (AI & Cloud)
- Description: An AI-driven cloud optimization tool that reduces server costs by predicting
traffic spikes with 99.9% accuracy.
- Tech Stack: Python, Kubernetes, TensorFlow, AWS.
- Status: In Production (Version 2.0).
Project "Potassium" (AgroTech)
- Description: IoT sensors for vertical farming that monitor soil nutrient levels and automate
hydration.
- Tech Stack: C++, Embedded C, Rust, Azure IoT Hub.
- Status: Beta Testing in European markets.
Project "Peel" (Cybersecurity)
- Description: A zero-trust security framework designed for fintech startups. It "peels" away
malicious traffic layers before they hit the core database.
- Tech Stack: GoLang, Blockchain, React (Dashboard).
- Status: R&D Phase.
6. Hiring Process Overview
1. Screening: Resume review by AI + HR.
2. Technical Round: 60-minute coding/domain challenge (Focus on logic, not syntax
memorization).
3. Culture Fit: "The Banana Split" interview – a casual chat with cross-functional team members
to assess values alignment.
4. Offer: Rolled out within 48 hours of final selection.
"""

documents = [Document(text=text)]

# semantic_splitter = SemanticSplitterNodeParser(
#     embed_model=embed_model,
#     buffer_size=1,
#     breakpoint_percentile_threshold=95,
# )

# nodes = semantic_splitter.get_nodes_from_documents(documents)

# print(f"✅ Document split into {len(nodes)} semantic chunks.")

vector_store = PineconeVectorStore(
    pinecone_index=pinecone_index
)

# storage_context = StorageContext.from_defaults(
#     vector_store=vector_store
# )

# print(f"✅ vector store and storage created")

index = VectorStoreIndex.from_vector_store(
    # nodes,
    # storage_context=storage_context,
    vector_store=vector_store,
    embed_model=embed_model,
)

print("✅ Documents indexed successfully!")

query_engine = index.as_query_engine(
    similarity_top_k=5,
    llm=llm,
)

print("✅ initialized query engine")

# response = query_engine.query(
#     "What are company leave policies?"
# )
# print("✅ querying done")

# print("\n🔍 Query Response:\n")
# print(response)


retriever = index.as_retriever(similarity_top_k=3)

print("✅ retriever intialized")

nodes = retriever.retrieve("Explain the core idea")

print("\n🔍 retriever response \n")

print(nodes)
import os
import weaviate
from weaviate.classes.init import Auth
from weaviate.classes.init import AdditionalConfig, Timeout
from weaviate.classes.config import Configure, Property, DataType

from llama_index.core import (
    SimpleDirectoryReader,
    VectorStoreIndex,
    StorageContext,
    Document
)
from llama_index.core.node_parser import SemanticSplitterNodeParser
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.llms.openai import OpenAI
from AgentManager.llm_handler import get_openai_api_key, get_openai_config, get_openai_embedding_model
import json

from llama_index.vector_stores.weaviate import WeaviateVectorStore

from dotenv import load_dotenv
load_dotenv()

WEAVIATE_API_KEY = os.getenv("WEAVIATE_API_KEY")
WEAVIATE_URL = os.getenv("WEAVIATE_URL")

print("✅ credentials imported")

with open("AgentManager/config.json", "r") as f:
    config = json.load(f)
_openai_cfg = get_openai_config()

embed_model = OpenAIEmbedding(
    model=get_openai_embedding_model(),
    api_key=get_openai_api_key(),
)

llm = OpenAI(
    model=_openai_cfg["model"],
    api_key=get_openai_api_key(),
    temperature=_openai_cfg["temperature"],
)

# weaviate_client = weaviate.connect_to_weaviate_cloud(
#             cluster_url=WEAVIATE_URL,
#             auth_credentials=Auth.api_key(WEAVIATE_API_KEY),
#         )

weaviate_client = weaviate.connect_to_weaviate_cloud(
    cluster_url=WEAVIATE_URL,
    auth_credentials=weaviate.auth.AuthApiKey(WEAVIATE_API_KEY),
    # Increase the 'init' timeout to 30 or 60 seconds
    additional_config=AdditionalConfig(
        timeout=Timeout(init=60, query=60, insert=120)
    )
)

print("Weaviate Connection Status : ", weaviate_client.is_ready())
print("✅ embedding model and weaviate client initialized")

collection_name = "Test"

# Create collection only if it doesn't exist
if not weaviate_client.collections.exists(collection_name):
    weaviate_client.collections.create(
        name=collection_name,
        properties=[
            Property(
                name="text",
                data_type=DataType.TEXT
            )
        ],
        vectorizer_config=Configure.Vectorizer.none(),  # IMPORTANT
    )

print(f"✅ Collection '{collection_name}' is ready")

text = """
    Page 1: Company Overview
Welcome to QJumpers
“Live for the giant leaps.”
Who We Are
QJumpers is a leading provider of web-based recruitment soŌware and AI-driven talent sourcing
soluƟons. Born in New Zealand and operaƟng globally (with a strong presence in the US), we have
over 15 years of pedigree in building and implemenƟng recruitment plaƞorms.
We are not just a soŌware company; we are a team of innovators, problem-solvers, and “sherpas”
guiding organizaƟons through the complex terrain of modern hiring. Our technology puts the power
of recruitment back into the hands of the people who know the business best—the hiring
managers—while ensuring HR maintains control and transparency.
Our Mission
To streamline the recruitment process through agile, collaboraƟve, and cuƫng-edge technology. We
aim to help companies find the best talent faster, using the power of AI to scour the globe for the
perfect candidates, all while keeping the "human" in Human Resources.
Our Core Values
- Agility: We move fast. In a world where the best talent is gone in days, our soŌware—and
our team—must be faster.
- InnovaƟon: We embrace the future. From AI talent sourcing to automated workflows, we
are constantly evolving our tech stack to stay ahead of the curve.
- CollaboraƟon: We believe recruitment is a team sport. Our tools are designed to foster
communicaƟon between recruiters, managers, and candidates.
- Simplicity: Complexity is the enemy of execuƟon. We make powerful tools that are
ridiculously simple to use.
Global Reach, Local Roots
Headquartered in Tauranga, New Zealand, with operaƟons expanding into the United States (Dallas,
TX), QJumpers offers the unique culture of a Ɵght-knit Kiwi tech company with the ambiƟon and
reach of a global SaaS player.
Page 2: Life at QJumpers
Why Join Our Team?
Joining QJumpers means becoming part of a forward-thinking technology company that is reshaping
how the world hires. We don't just build soŌware; we build connecƟons between people and their
dream jobs.
Our Culture
At QJumpers, we foster an environment of trust and autonomy. We treat our employees like adults,
focusing on outcomes rather than hours clocked.
- Tech-Forward: You will work with the latest technologies, including Machine Learning and AI,
in a cloud-based environment.
- Flat Structure: Good ideas can come from anywhere. We maintain an open-door policy
where your voice is heard, regardless of your job Ɵtle.
- Fun & Social: We work hard, but we also know how to celebrate our wins. From team
lunches to social events, we believe a connected team is a producƟve team.
Career Growth & Development
We are growing fast, and we want you to grow with us.
- Upskilling: We encourage conƟnuous learning. Whether it's mastering a new coding
language, aƩending a sales conference, or developing leadership skills, we support your
professional journey.
- Internal Mobility: As we expand into new markets (like the US), opportuniƟes for internal
transfer and promoƟon arise frequently.
Diversity & Inclusion
We are commiƩed to building a diverse workforce. Our own AI technology is designed to help reduce
bias in hiring, and we apply those same principles internally. We welcome candidates from all
backgrounds, believing that diverse perspecƟves lead to beƩer innovaƟon.
Page 3: Benefits & Policies
We believe in taking care of the people who take care of our business. Our benefits package is
designed to support your health, wealth, and work-life balance.
Employee Benefits Package
- Health & Wellness:
o Life & CriƟcal Illness Insurance: comprehensive coverage to provide peace of mind
for you and your family.
o Employee Assistance Programme (EAP): ConfidenƟal support services for mental
health and personal maƩers.
o Wellbeing Leave: dedicated leave days to recharge and focus on your mental and
physical health, separate from standard sick leave.
- Financial Rewards:
o Profit Share Scheme: When the company wins, you win. Eligible employees share in
the company’s financial success.
o Banking Benefits: Exclusive banking packages and perks for QJumpers staff.
o CompeƟƟve Salaries: We conƟnually benchmark our remuneraƟon against the tech
industry to ensure fair compensaƟon.
- Lifestyle & Commute:
o Workride: Access to a ride-to-work scheme (e.g., e-bike leasing/purchasing support)
to help you commute sustainably and affordably.
o Social Club: Regular team events, drinks, and celebraƟons.
General Policies
Leave Policy
We go beyond the statutory minimums to ensure you have Ɵme to rest.
- Annual Leave: Generous annual leave allowance (typically 4 weeks minimum in NZ, adjusted
for US employees per state/federal norms).
- Parental Leave: Enhanced parental leave benefits to support new parents returning to the
workforce.
- Sick & DomesƟc Leave: Flexible sick leave to care for yourself or your dependents.
Remote & Flexible Work Policy
As a company that builds tools for remote hiring, we embody the "Work from Anywhere" capability.
- Hybrid Model: Most roles offer a hybrid mix of office collaboration and home-based focus
time.
- Flexible Hours: We understand that life doesn't always fit into a 9-to-5 box. We offer flexible
start and finish times to accommodate school drop-offs, appointments, or life administration.
Equipment
- BYOD / Company Tech: We provide high-spec laptops and necessary hardware to ensure you
can work seamlessly from the office or home.
(Note: Specific details regarding benefit eligibility may vary by role and locaƟon, e.g., New Zealand
vs. USA).
"""


documents = [Document(text=text)]

semantic_splitter = SemanticSplitterNodeParser(
    embed_model=embed_model,
    buffer_size=1,
    breakpoint_percentile_threshold=95,
)

nodes = semantic_splitter.get_nodes_from_documents(documents)

print(f"✅ Document split into {len(nodes)} semantic chunks.")

vector_store = WeaviateVectorStore(
    weaviate_client=weaviate_client,
    index_name="Test",
)

storage_context = StorageContext.from_defaults(
    vector_store=vector_store
)


print(f"✅ vector store and storage created")
print("✅ connected to weaviate index")

index = VectorStoreIndex(
    nodes=nodes,
    storage_context=storage_context,
    embed_model=embed_model,
)

print("✅ Data ingested into Weaviate collection")

# for existing only
# index = VectorStoreIndex.from_vector_store(
#     nodes=nodes,
#     storage_context=storage_context,
#     vector_store=vector_store,
#     embed_model=embed_model,
# )

print("✅ Documents indexed successfully!")

query_engine = index.as_query_engine(
    similarity_top_k=5,
    llm=llm,
)

print("✅ initialized query engine")

response = query_engine.query(
    "What are company leave policies?"
)
print("✅ querying done")

print("\n🔍 Query Response:\n")
print(response)


retriever = index.as_retriever(similarity_top_k=3)

print("✅ retriever intialized")

nodes = retriever.retrieve("Explain the core idea")

print("\n🔍 retriever response \n")

print(nodes)

weaviate_client.close()
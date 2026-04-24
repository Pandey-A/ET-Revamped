# Indexing URL
import json
from llama_index.readers.web import SimpleWebPageReader
from llama_index.core.node_parser import SemanticSplitterNodeParser
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core import Document, StorageContext, VectorStoreIndex
from qdrant_client.http.models import Distance, VectorParams
from llama_index.embeddings.openai import OpenAIEmbedding
from qdrant_client import QdrantClient

# loading credentials
try:
    with open('AgentManager/config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    raise RuntimeError(f"Failed to load required configuration from config.json: {str(e)}")

embed_model_name = config['OpenAI']['embed_model']
openai_api_key = config['OpenAI']['Key']
Qdrant_URL = config['Qdrant']['url']
Qdrant_API_Key = config['Qdrant']['api_key']

embed_model = OpenAIEmbedding(
    model=embed_model_name, 
    api_key=openai_api_key,
)

splitter = SemanticSplitterNodeParser(
    buffer_size=1, 
    breakpoint_percentile_threshold=80, 
    embed_model=embed_model
)

qdrant_client = QdrantClient(
    url=Qdrant_URL,
    api_key=Qdrant_API_Key,
)

def load_web_page(url:str):
    documents = SimpleWebPageReader(html_to_text=True).load_data(
        [url]
    )
    
    return documents

def chunking(document, url:str):
    """chunks the documents"""
    nodes = splitter.get_nodes_from_documents(document)
    for node in nodes:
        node.metadata = {"source_url": url}
        print("\n", "-"*20)
        print(node.get_content())
    
    return nodes

def upload_embedding(
    nodes:list,
    collection:str):
    
    # Check if collection exists
    if collection in [collection.name for collection in qdrant_client.get_collections().collections]:
        print(f"Collection already exists.")
    else:
        print(f"Collection '{collection}' not found. Creating now...")
        qdrant_client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(
                size=1536,
                distance=Distance.COSINE
            )
        )
        print(f"✅ Collection '{collection}' created successfully.")
    
    vector_store = QdrantVectorStore(
        client=qdrant_client,
        collection_name=collection,
        prefer_grpc=True
    )
    
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    
    # Create vector index from chunked documents using the embedding model
    try:
        vector_index = VectorStoreIndex(
            nodes,
            storage_context=storage_context,
            embed_model=embed_model
        )
        print("Vector index creation completed")
    except Exception as e:
        raise RuntimeError(f"Failed to create vector index: {e}")

if __name__ == '__main__':
    print("Starting...")
    
    # url = "https://support.boat-lifestyle.com/articles/popular-help-topics/order-related/6242c50f8bf57c0729efaeb5"
    # url = "https://support.boat-lifestyle.com/articles/popular-help-topics/payment-issues/6242c5139f565e24683a4955"
    # url = "https://support.boat-lifestyle.com/articles/popular-help-topics/shipping/6242c5109f565e24683a4954"
    url = "https://support.boat-lifestyle.com/articles/popular-help-topics/exchanges/6242c50c9f565e24683a4953"
    collection = input("Enter Collection Name: ")
    
    print("Loading Page")
    document = load_web_page(url)
    print("Document : \n", "-"* 30)
    print(type(document))
    print(document)
    nodes = chunking(document, url)
    print("nodes : \n", "-"* 30)
    print(nodes)
    # upload_embedding(nodes, collection)
    
    print("Embedding Uploaded Successfully 👍")

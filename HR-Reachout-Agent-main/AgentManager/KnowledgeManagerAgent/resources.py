import os
import json
import weaviate
from weaviate.classes.init import AdditionalConfig, Timeout

from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.readers.file import PDFReader
from llama_index.core.node_parser import SentenceSplitter
from llama_index.vector_stores.weaviate import WeaviateVectorStore
from llama_index.readers.web import SimpleWebPageReader
from llama_index.embeddings.bedrock import BedrockEmbedding


def _load_config(path='AgentManager/config.json'):
    with open(path, 'r') as f:
        return json.load(f)


def _connect_weaviate(config):
    """Connect to self-hosted Weaviate on EC2 (HTTP) or Weaviate Cloud (HTTPS)."""
    weaviate_url = config['weaviate']['url']          # e.g. http://<EC2-IP>:8080
    weaviate_api_key = config['weaviate'].get('api_key', None)

    # Self-hosted on EC2 — use connect_to_custom
    if weaviate_url.startswith("http://") or "localhost" in weaviate_url:
        host = weaviate_url.replace("http://", "").replace("https://", "").split(":")[0]
        port = int(weaviate_url.split(":")[-1]) if ":" in weaviate_url.replace("http://", "") else 8080
        grpc_port = config['weaviate'].get('grpc_port', 50051)
        client = weaviate.connect_to_custom(
            http_host=host,
            http_port=port,
            http_secure=False,
            grpc_host=host,
            grpc_port=grpc_port,
            grpc_secure=False,
            skip_init_checks=True,
            additional_config=AdditionalConfig(
                timeout=Timeout(init=60, query=60, insert=120)
            )
        )
    else:
        # Weaviate Cloud
        from weaviate.classes.init import Auth
        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=weaviate_url,
            auth_credentials=weaviate.auth.AuthApiKey(weaviate_api_key),
            skip_init_checks=True,
            additional_config=AdditionalConfig(
                timeout=Timeout(init=60, query=60, insert=120)
            )
        )
    print("Weaviate Connection Status:", client.is_ready())
    return client


def _get_embed_model(config):
    """Create a BedrockEmbedding instance using the IAM role credentials."""
    bedrock_cfg = config['Bedrock']
    return BedrockEmbedding(
        model_name=bedrock_cfg.get('embed_model_id', 'amazon.titan-embed-text-v2:0'),
        region_name=bedrock_cfg.get('region', 'ap-south-1'),
    )


class WebPageIndexer:
    def __init__(self, config_path='AgentManager/config.json'):
        self.config = _load_config(config_path)
        self.embed_model = _get_embed_model(self.config)
        self.weaviate_client = _connect_weaviate(self.config)
        self.splitter = SentenceSplitter(
            chunk_size=1024,
            chunk_overlap=200
        )

    def load_web_page(self, url: str):
        return SimpleWebPageReader(html_to_text=True).load_data([url])

    def chunk_document(self, document, url: str):
        nodes = self.splitter.get_nodes_from_documents(document)
        for node in nodes:
            node.metadata = {"source_url": url}
            print("\n", "-" * 20)
            print(node.get_content())
        return nodes

    def upload_embedding(self, nodes: list, collection: str):
        # Weaviate class names must start with uppercase letter
        weaviate_class = _to_weaviate_class(collection)

        vector_store = WeaviateVectorStore(
            weaviate_client=self.weaviate_client,
            index_name=weaviate_class,
        )
        storage_context = StorageContext.from_defaults(vector_store=vector_store)

        try:
            VectorStoreIndex(
                nodes,
                storage_context=storage_context,
                embed_model=self.embed_model,
                insert_batch_size=16
            )
            print(f"Vector index created in Weaviate class '{weaviate_class}'.")
        except Exception as e:
            raise RuntimeError(f"Failed to create vector index: {e}")

    def index_url_to_qdrant(self, url: str, collection_name: str):
        """Kept same name for API compatibility — now indexes to Weaviate."""
        try:
            print("Loading web page...")
            document = self.load_web_page(url)
            print("Page loaded. Chunking now...")
            nodes = self.chunk_document(document, url)
            print("Document chunked. Uploading to Weaviate...")
            self.upload_embedding(nodes, collection_name)
            print("Embedding uploaded successfully.")
        finally:
            if self.weaviate_client:
                self.weaviate_client.close()


class PDFIndexer:
    def __init__(self, config_path='AgentManager/config.json'):
        self.config = _load_config(config_path)
        self.embed_model = _get_embed_model(self.config)
        self.weaviate_client = _connect_weaviate(self.config)
        self.splitter = SentenceSplitter(
            chunk_size=1024,
            chunk_overlap=200
        )

    def extract_text_from_pdf(self, file_path: str) -> Document:
        reader = PDFReader()
        return reader.load_data(file_path)

    def chunk_document(self, document, source_path: str):
        nodes = self.splitter.get_nodes_from_documents(document)
        for node in nodes:
            node.metadata = {"source_path": source_path}
            print("\n", "-" * 20)
            print(node.get_content())
        return nodes

    def upload_embedding(self, nodes: list, collection: str):
        weaviate_class = _to_weaviate_class(collection)

        vector_store = WeaviateVectorStore(
            weaviate_client=self.weaviate_client,
            index_name=weaviate_class,
        )
        storage_context = StorageContext.from_defaults(vector_store=vector_store)

        try:
            VectorStoreIndex(
                nodes,
                storage_context=storage_context,
                embed_model=self.embed_model,
                insert_batch_size=16
            )
            print(f"Vector index created in Weaviate class '{weaviate_class}'.")
        except Exception as e:
            raise RuntimeError(f"Failed to create vector index: {e}")

    def index_pdf_url_to_qdrant(self, pdf_path: str, collection_name: str):
        """Kept same name for API compatibility — now indexes to Weaviate."""
        try:
            print("Using local file path. Extracting text...")
            document = self.extract_text_from_pdf(pdf_path)
            print("Text extracted. Chunking...")
            nodes = self.chunk_document(document, pdf_path)
            print("Chunked. Uploading to Weaviate...")
            self.upload_embedding(nodes, collection_name)
            print("Embedding uploaded successfully.")
        finally:
            if self.weaviate_client:
                self.weaviate_client.close()


def _to_weaviate_class(collection_name: str) -> str:
    """
    Weaviate class names must start with an uppercase letter and
    contain only alphanumeric characters + underscores.
    e.g. 'hr_bot_agent_123' → 'Hr_bot_agent_123'
    """
    # Replace hyphens/spaces with underscores
    clean = collection_name.replace("-", "_").replace(" ", "_")
    # Ensure first char is uppercase
    return clean[0].upper() + clean[1:] if clean else "DefaultCollection"

from .knowledge_management_handler import KnowledgeManagerHandler
from .resources import WebPageIndexer, PDFIndexer
knowledge_management_handler = KnowledgeManagerHandler()
pdf_indexer = PDFIndexer()
web_page_indexer = WebPageIndexer()
__all__ = ['knowledge_management_handler','web_page_indexer','pdf_indexer']

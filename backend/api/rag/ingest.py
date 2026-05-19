from langchain_core.documents import Document
from api.rag.vector_store import get_retriever

def ingest_spec(text: str):
    db = get_retriever()
    
    docs = [Document(page_content=text)]
    db.add_documents(docs)
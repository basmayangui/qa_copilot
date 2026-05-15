from langchain_core.documents import Document
from db.vector_store import get_vector_store

def ingest_spec(text: str):
    db = get_vector_store()
    
    docs = [Document(page_content=text)]
    db.add_documents(docs)
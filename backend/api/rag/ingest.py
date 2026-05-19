from langchain_core.documents import Document
from api.rag.vector_store import embedding_model, CHROMA_DIR
from langchain_chroma import Chroma

def ingest_spec(text: str):
    vectorbd = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embedding_model,
        collection_name="expersi_qa",
    )
    vectorbd.add_documents([Document(page_content=text)])
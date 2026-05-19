from api.rag.vector_store import get_retriever

def retrieve_context(query: str):
    retriever = get_retriever()
    docs = retriever.invoke(query)
    return docs
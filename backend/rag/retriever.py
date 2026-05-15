from db.vector_store import get_vector_store

def retrieve_context(query: str):
    db = get_vector_store()
    retriever = db.as_retriever(search_kwargs={"k": 3})
    return retriever.invoke(query)
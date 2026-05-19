from api.rag.vector_store import get_retriever

retriever = get_retriever()


def retrieve_context(query: str):

    docs = retriever.invoke(query)

    return "\n\n".join(
        [doc.page_content for doc in docs]
    )
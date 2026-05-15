from langchain_chroma import Chroma
from langchain_openai.embeddings.base import OpenAIEmbeddings

def get_vector_store():
    embeddings = OpenAIEmbeddings()
    return Chroma(
        collection_name="specs",
        embedding_function=embeddings,
        persist_directory="./chroma_db"
    )
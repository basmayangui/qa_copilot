import shutil
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

from api.rag.loaders import load_document

UPLOAD_DIR = Path("uploaded_docs")
CHROMA_DIR = Path("chroma_db")

embedding_model = OpenAIEmbeddings()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)


def rebuild_rag():

    # suppression ancien index
    if CHROMA_DIR.exists():
        shutil.rmtree(CHROMA_DIR)

    documents = []

    # reload tous les documents
    for file in UPLOAD_DIR.iterdir():

        if file.is_file():

            try:
                docs = load_document(str(file))
                documents.extend(docs)

            except Exception as e:
                print(f"Erreur {file.name}: {e}")

    # chunking
    chunks = text_splitter.split_documents(documents)

    # rebuild Chroma
    vectordb = Chroma.from_documents(
        documents=chunks,
        embedding=embedding_model,
        persist_directory=str(CHROMA_DIR),
        collection_name="expersi_qa",
    )

    vectordb.persist()

    print("RAG reconstruit")

    return vectordb

def get_retriever():

    vectordb = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embedding_model,
        collection_name="expersi_qa",
    )

    return vectordb.as_retriever(search_kwargs={"k": 4})
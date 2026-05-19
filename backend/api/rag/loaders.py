from pathlib import Path

from langchain_community.document_loaders import (
    PyPDFLoader,
    TextLoader,
    Docx2txtLoader,
)


def load_document(file_path: str):

    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        loader = PyPDFLoader(file_path)

    elif ext == ".docx":
        loader = Docx2txtLoader(file_path)

    elif ext == ".txt":
        loader = TextLoader(file_path)

    else:
        raise ValueError(f"Format non supporté : {ext}")

    return loader.load()
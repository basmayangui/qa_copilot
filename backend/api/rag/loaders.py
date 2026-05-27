from pathlib import Path

from langchain_community.document_loaders import (
    PyPDFium2Loader,
    TextLoader,
    Docx2txtLoader,
)


def load_document(file_path: str):
    """
    Routeur de loaders. Renvoie une liste de `langchain_core.documents.Document`.

    On utilise PyPDFium2Loader (pypdfium2 / PDFium en C++) qui est nettement
    plus rapide que PyPDFLoader (pypdf en Python pur) sur les gros PDFs.
    Les deux exposent la même API et produisent des Documents avec le
    même format de métadonnées ({"source", "page"}).
    """
    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        loader = PyPDFium2Loader(file_path)

    elif ext == ".docx":
        loader = Docx2txtLoader(file_path)

    elif ext == ".txt":
        loader = TextLoader(file_path)

    else:
        raise ValueError(f"Format non supporté : {ext}")

    return loader.load()
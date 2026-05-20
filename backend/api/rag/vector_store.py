import json
import shutil
import threading
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

from api.rag.loaders import load_document


# Verrou global : empêche deux rebuilds simultanés (watcher + endpoint
# upload, ou deux uploads concurrents).
_rebuild_lock = threading.Lock()

UPLOAD_DIR = Path("uploaded_docs")
CHROMA_DIR = Path("chroma_db")
MANIFEST_FILE = CHROMA_DIR / ".manifest.json"

SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}

embedding_model = OpenAIEmbeddings()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)


def _release_chroma_clients() -> None:
    """
    Libère tous les clients Chroma encore en cache dans le processus.

    Sans ça, un handle SQLite peut rester ouvert sur chroma.sqlite3 et
    provoquer une erreur SQLITE_READONLY_DBMOVED (code 1032) quand on
    fait shutil.rmtree(CHROMA_DIR) juste après. On essaie les deux APIs
    connues selon la version de chromadb.
    """
    try:
        # chromadb >= 0.4.x (backend Python et Rust)
        from chromadb.api.client import SharedSystemClient
        SharedSystemClient.clear_system_cache()
        return
    except Exception:
        pass

    try:
        # fallback éventuel pour des builds plus exotiques
        import chromadb
        if hasattr(chromadb, "reset"):
            chromadb.reset()
    except Exception:
        pass


def rebuild_rag():

    with _rebuild_lock:

        # On libère les handles ouverts par chromadb avant de toucher au
        # dossier, sinon SQLite refuse d'écrire dans la nouvelle base
        # (code 1032 SQLITE_READONLY_DBMOVED).
        _release_chroma_clients()

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

        # On sauvegarde un manifeste pour pouvoir détecter, au prochain
        # tour, si uploaded_docs/ a été modifié à la main.
        _write_manifest(_current_manifest())

        print("RAG reconstruit")
        return vectordb

def get_retriever():

    vectordb = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embedding_model,
        collection_name="expersi_qa",
    )

    return vectordb.as_retriever(search_kwargs={"k": 4})


# --------------------------------------------------------------------
# Helpers de bootstrap (utilisés au démarrage de l'API)
# --------------------------------------------------------------------
def _current_manifest() -> dict:
    """
    Snapshot {nom_fichier: mtime} de uploaded_docs/ — sert à détecter
    les ajouts/suppressions/modifications manuels entre deux démarrages.
    """
    if not UPLOAD_DIR.exists():
        return {}
    return {
        f.name: f.stat().st_mtime
        for f in UPLOAD_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS
    }


def _saved_manifest() -> dict:
    if not MANIFEST_FILE.exists():
        return {}
    try:
        return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_manifest(manifest: dict) -> None:
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def _chroma_is_ready() -> bool:
    """
    Heuristique simple : un index Chroma est considéré « prêt »
    si CHROMA_DIR existe et n'est pas vide. Suffisant car Chroma
    crée toujours au moins chroma.sqlite3 lors de la première écriture.
    """
    if not CHROMA_DIR.exists():
        return False
    return any(CHROMA_DIR.iterdir())


def ensure_rag_ready() -> None:
    """
    Bootstrap du RAG au démarrage de l'API.

    On compare le contenu actuel de uploaded_docs/ avec le manifeste
    sauvegardé lors de la dernière indexation :

      - uploaded_docs/ vide               → rien à faire ;
      - manifest identique + index prêt    → on garde l'index, pas de rebuild ;
      - sinon (ajout / suppression / modif
        manuelle, ou pas d'index)          → reconstruction complète.
    """
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    current = _current_manifest()
    if not current:
        print("[startup] uploaded_docs/ vide — aucun RAG à construire.")
        return

    saved = _saved_manifest()

    if current == saved and _chroma_is_ready():
        print(
            f"[startup] uploaded_docs/ inchangé "
            f"({len(current)} fichier(s)) — index conservé."
        )
        return

    added = sorted(set(current) - set(saved))
    removed = sorted(set(saved) - set(current))
    modified = sorted(
        name for name in (set(current) & set(saved))
        if current[name] != saved[name]
    )
    if added or removed or modified:
        print(
            f"[startup] Changements détectés dans uploaded_docs/ — "
            f"ajout(s)={added} suppression(s)={removed} modif(s)={modified}"
        )
    else:
        print("[startup] Pas de manifeste ou index absent — reconstruction.")

    rebuild_rag()
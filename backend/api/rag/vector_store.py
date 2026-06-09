import json
import os
import shutil
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

# Charge .env AVANT toute lecture os.getenv() au niveau module. Sans
# ça, les variables comme RAG_EMBED_MODEL définies dans backend/.env
# ne seraient pas honorées (vector_store est importé avant que
# gherkin_agent n'appelle load_dotenv).
load_dotenv()

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma

from api.rag.loaders import load_document
from api.embeddings_client import get_embeddings


# Modèle d'embedding effectif — lu depuis l'env via embeddings_client.
# Le nom est aussi conservé ici pour le manifest (détection de changement
# de modèle, qui déclenche un rebuild complet automatique).
EMBED_MODEL = os.getenv("RAG_EMBED_MODEL", "").strip()

# Taille de batch pour l'envoi des chunks au service d'embeddings.
# 256 reste sous les limites TPM des principaux fournisseurs.
EMBED_BATCH_SIZE = int(os.getenv("RAG_EMBED_BATCH_SIZE", "256"))

# Pause entre deux batches — utile sur les fournisseurs à TPM contraint.
EMBED_BATCH_PAUSE_SEC = float(os.getenv("RAG_EMBED_BATCH_PAUSE_SEC", "0.1"))

# Nombre de PROCESS workers pour le chargement parallèle (Phase 1).
# Contrairement à l'intuition, pypdf est CPU-bound (Python pur sous GIL),
# donc seul multiprocessing donne un vrai gain. Idéal = nb de cœurs
# physiques. Aller au-dessus de cpu_count() est contre-productif.
LOAD_MAX_WORKERS = int(
    os.getenv("RAG_LOAD_MAX_WORKERS", str(max(1, (os.cpu_count() or 4) - 1)))
)

# Backoff exponentiel sur 429 Rate Limit : 2s, 4s, 8s, 16s, 32s (puis cap 60s)
_RETRY_MAX_ATTEMPTS = 6
_RETRY_BACKOFF_CAP_SEC = 60


def _is_rate_limit_error(exc: Exception) -> bool:
    """Détecte les erreurs 429 (rate limit), typées ou wrappées."""
    try:
        from openai import RateLimitError
        if isinstance(exc, RateLimitError):
            return True
    except Exception:
        pass
    msg = str(exc).lower()
    return (
        "rate limit" in msg
        or "rate_limit_exceeded" in msg
        or "429" in msg
    )


def _call_with_retry(fn, *, label: str):
    """Exécute fn() avec retry exponentiel sur erreur de rate limit."""
    for attempt in range(_RETRY_MAX_ATTEMPTS):
        try:
            return fn()
        except Exception as exc:
            if not _is_rate_limit_error(exc) or attempt == _RETRY_MAX_ATTEMPTS - 1:
                raise
            wait = min(2 ** (attempt + 1), _RETRY_BACKOFF_CAP_SEC)
            print(
                f"[rag]   ⏳ {label} : rate limit, "
                f"retry dans {wait}s (tentative {attempt + 2}/{_RETRY_MAX_ATTEMPTS})"
            )
            time.sleep(wait)


# Verrou global : protège toutes les opérations d'écriture sur l'index
# (rebuild complet, ajout, suppression). NON réentrant : les helpers
# internes "unsafe" doivent être appelés sans détenir le lock par un
# autre chemin.
_rebuild_lock = threading.Lock()

UPLOAD_DIR = Path("uploaded_docs")
CHROMA_DIR = Path("chroma_db")
MANIFEST_FILE = CHROMA_DIR / ".manifest.json"

SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}

embedding_model = get_embeddings()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)


# --------------------------------------------------------------------
# Cache de l'instance Chroma — partagée par add/remove/get_retriever
# --------------------------------------------------------------------
_vectordb_instance: Chroma | None = None


def _get_vectordb() -> Chroma:
    """
    Renvoie une instance Chroma persistée, créée à la demande et
    réutilisée. Réinitialisée par _invalidate_vectordb_cache() après
    un rebuild complet (rmtree).
    """
    global _vectordb_instance
    if _vectordb_instance is None:
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _vectordb_instance = Chroma(
            persist_directory=str(CHROMA_DIR),
            embedding_function=embedding_model,
            collection_name="expersi_qa",
        )
    return _vectordb_instance


def _invalidate_vectordb_cache() -> None:
    global _vectordb_instance
    _vectordb_instance = None


def _release_chroma_clients() -> None:
    """
    Libère tous les clients Chroma encore en cache dans le processus.

    Sans ça, un handle SQLite peut rester ouvert sur chroma.sqlite3 et
    provoquer une erreur SQLITE_READONLY_DBMOVED (code 1032) quand on
    fait shutil.rmtree(CHROMA_DIR) juste après. On essaie les deux APIs
    connues selon la version de chromadb.
    """
    _invalidate_vectordb_cache()
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


# --------------------------------------------------------------------
# Helpers chunks + chunks tagués par source_filename
# --------------------------------------------------------------------
def _tag_chunks_with_source(chunks: list, filename: str) -> list:
    """
    Ajoute metadata['source_filename'] sur chaque chunk pour permettre
    une suppression ciblée plus tard (delete by metadata).
    """
    for c in chunks:
        if getattr(c, "metadata", None) is None:
            c.metadata = {}
        c.metadata["source_filename"] = filename
    return chunks


def _build_chunks_for_file(file_path: Path) -> list:
    """Charge un fichier, le chunke, et tague les chunks."""
    docs = load_document(str(file_path))
    chunks = text_splitter.split_documents(docs)
    return _tag_chunks_with_source(chunks, file_path.name)


def _embed_and_index_chunks(chunks: list, *, label_prefix: str) -> None:
    """
    Embed et indexe une liste de chunks par batches, avec retry sur
    rate limit et pacing entre batches. Le lock global doit être détenu
    par l'appelant.
    """
    if not chunks:
        return

    vectordb = _get_vectordb()
    total = len(chunks)
    n_batches = (total + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE

    for batch_idx in range(n_batches):
        start = batch_idx * EMBED_BATCH_SIZE
        end = min(start + EMBED_BATCH_SIZE, total)
        batch = chunks[start:end]
        label = f"{label_prefix} batch {batch_idx + 1}/{n_batches}"

        _call_with_retry(
            lambda b=batch: vectordb.add_documents(b),
            label=label,
        )

        # pacing entre deux batches, sauf après le dernier
        if EMBED_BATCH_PAUSE_SEC > 0 and batch_idx + 1 < n_batches:
            time.sleep(EMBED_BATCH_PAUSE_SEC)


# --------------------------------------------------------------------
# Primitives incrémentales : add / remove un fichier
# --------------------------------------------------------------------
def _remove_chunks_unsafe(filename: str) -> int:
    """
    Supprime de Chroma tous les chunks tagués source_filename=filename.
    Renvoie le nombre de chunks supprimés. Variante SANS lock — pour
    usage interne, l'appelant doit détenir _rebuild_lock.
    """
    try:
        vectordb = _get_vectordb()
        # On récupère d'abord les IDs pour pouvoir les compter, puis on
        # supprime par IDs (plus portable que delete(where=...) selon
        # les versions de chromadb).
        existing = vectordb._collection.get(
            where={"source_filename": filename},
        )
        ids = existing.get("ids", []) or []
        if ids:
            vectordb._collection.delete(ids=ids)
        return len(ids)
    except Exception as exc:  # noqa: BLE001
        print(f"[rag]   ⚠️  suppression chunks({filename}) : {exc}")
        return 0


def add_file_to_index(file_path: Path) -> int:
    """
    Ajout INCRÉMENTAL d'un fichier à l'index existant. Si le fichier
    était déjà indexé, ses chunks précédents sont supprimés d'abord
    (idempotent / re-upload safe). Renvoie le nombre de chunks ajoutés.
    """
    if not file_path.exists() or not file_path.is_file():
        print(f"[rag] add: fichier introuvable {file_path}")
        return 0
    if file_path.suffix.lower() not in SUPPORTED_EXTS:
        print(f"[rag] add: extension non supportée ({file_path.suffix})")
        return 0

    with _rebuild_lock:
        t0 = time.time()
        print(f"[rag] Ajout incrémental : {file_path.name}")

        # 1. Idempotence : on supprime d'abord d'éventuels chunks
        #    précédents pour ce fichier (re-upload, modification).
        n_old = _remove_chunks_unsafe(file_path.name)
        if n_old > 0:
            print(f"[rag]   {n_old} chunk(s) précédents supprimés (re-index)")

        # 2. Charger + chunker (CPU bound, mais 1 seul fichier)
        try:
            chunks = _build_chunks_for_file(file_path)
        except Exception as exc:  # noqa: BLE001
            print(f"[rag]   ⚠️  Erreur chargement/chunking {file_path.name} : {exc}")
            return 0

        if not chunks:
            print(f"[rag]   {file_path.name} : aucun chunk généré")
            _update_manifest_for_file(file_path)
            return 0

        # 3. Embedder + indexer
        try:
            _embed_and_index_chunks(
                chunks, label_prefix=f"add({file_path.name})"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[rag]   ⚠️  Indexation {file_path.name} : {exc}")
            return 0

        # 4. Mettre à jour le manifeste
        _update_manifest_for_file(file_path)

        print(
            f"[rag] {file_path.name} indexé : "
            f"{len(chunks)} chunk(s) en {time.time() - t0:.1f}s"
        )
        return len(chunks)


def remove_file_from_index(filename: str) -> int:
    """
    Suppression INCRÉMENTALE des chunks d'un fichier. Renvoie le nombre
    de chunks supprimés. Le fichier disque n'est PAS touché ici (c'est
    le rôle de l'endpoint DELETE).
    """
    with _rebuild_lock:
        t0 = time.time()
        print(f"[rag] Suppression incrémentale : {filename}")
        n = _remove_chunks_unsafe(filename)
        _remove_manifest_entry(filename)
        print(f"[rag] {filename} retiré : {n} chunk(s) en {time.time() - t0:.1f}s")
        return n


# --------------------------------------------------------------------
# Rebuild COMPLET — utilisé uniquement quand le modèle d'embedding
# change ou que l'index est incohérent. Pour l'usage courant, préférer
# add_file_to_index / remove_file_from_index.
# --------------------------------------------------------------------
def rebuild_rag():

    with _rebuild_lock:

        t0 = time.time()

        # On libère les handles ouverts par chromadb avant de toucher au
        # dossier, sinon SQLite refuse d'écrire dans la nouvelle base
        # (code 1032 SQLITE_READONLY_DBMOVED).
        _release_chroma_clients()

        # suppression ancien index
        if CHROMA_DIR.exists():
            shutil.rmtree(CHROMA_DIR)

        # -- Phase 1/3 : chargement des fichiers (parallèle) ----------
        files = [
            f for f in UPLOAD_DIR.iterdir()
            if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS
        ]
        print(
            f"[rag] Phase 1/3 — chargement de {len(files)} fichier(s) "
            f"({LOAD_MAX_WORKERS} process workers)..."
        )

        # On stocke des paires (filename, list[Document]) pour pouvoir
        # tagger les chunks à la phase 2.
        loaded: list[tuple[str, list]] = []
        t_phase = time.time()
        completed = 0
        with ProcessPoolExecutor(max_workers=LOAD_MAX_WORKERS) as executor:
            future_to_file = {
                executor.submit(load_document, str(f)): f for f in files
            }
            for future in as_completed(future_to_file):
                f = future_to_file[future]
                completed += 1
                try:
                    docs = future.result()
                    loaded.append((f.name, docs))
                except Exception as e:
                    print(f"[rag]   ⚠️  Erreur {f.name}: {e}")
                if completed % 20 == 0 or completed == len(files):
                    print(f"[rag]   {completed}/{len(files)} fichier(s) chargé(s)")
        n_documents = sum(len(d) for _, d in loaded)
        print(
            f"[rag] Phase 1 OK — {n_documents} document(s) en mémoire "
            f"({time.time() - t_phase:.1f}s)"
        )

        # -- Phase 2/3 : chunking + tagging --------------------------
        t_phase = time.time()
        print("[rag] Phase 2/3 — chunking (1000 chars / 200 overlap)...")
        chunks: list = []
        for fname, docs in loaded:
            file_chunks = text_splitter.split_documents(docs)
            _tag_chunks_with_source(file_chunks, fname)
            chunks.extend(file_chunks)
        print(f"[rag] Phase 2 OK — {len(chunks)} chunk(s) "
              f"({time.time() - t_phase:.1f}s)")

        if not chunks:
            print("[rag] Aucun chunk — rien à indexer.")
            _write_manifest(_current_manifest())
            return None

        # -- Phase 3/3 : embeddings + indexation Chroma --------------
        t_phase = time.time()
        total = len(chunks)
        n_batches = (total + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE
        print(
            f"[rag] Phase 3/3 — embeddings + indexation "
            f"({total} chunks en {n_batches} batch(es) de {EMBED_BATCH_SIZE})..."
        )

        for batch_idx in range(n_batches):
            start = batch_idx * EMBED_BATCH_SIZE
            end = min(start + EMBED_BATCH_SIZE, total)
            batch = chunks[start:end]
            label = f"batch {batch_idx + 1}/{n_batches}"
            t_batch = time.time()

            vectordb = _get_vectordb()
            _call_with_retry(
                lambda b=batch: vectordb.add_documents(b),
                label=label,
            )

            print(
                f"[rag]   {label} ({end}/{total} chunks) — "
                f"{time.time() - t_batch:.1f}s, total {time.time() - t_phase:.1f}s"
            )

            if EMBED_BATCH_PAUSE_SEC > 0 and batch_idx + 1 < n_batches:
                time.sleep(EMBED_BATCH_PAUSE_SEC)

        print(f"[rag] Phase 3 OK — index Chroma prêt "
              f"({time.time() - t_phase:.1f}s)")

        # On sauvegarde le manifeste pour détecter les changements
        # ultérieurs.
        _write_manifest(_current_manifest())

        print(f"[rag] RAG reconstruit en {time.time() - t0:.1f}s total")
        return _get_vectordb()


def get_retriever():
    """Renvoie un retriever par similarité top-k=4 sur la collection."""
    return _get_vectordb().as_retriever(search_kwargs={"k": 4})


# --------------------------------------------------------------------
# Manifeste — état persistant de l'index
# --------------------------------------------------------------------
def _current_manifest() -> dict:
    """
    Snapshot du contenu indexé. Contient :
      - embed_model : le modèle d'embedding utilisé (change ⇒ rebuild forcé)
      - files       : {nom_fichier: mtime} pour détecter les modifs disque
    """
    if not UPLOAD_DIR.exists():
        return {"embed_model": EMBED_MODEL, "files": {}}
    files = {
        f.name: f.stat().st_mtime
        for f in UPLOAD_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS
    }
    return {"embed_model": EMBED_MODEL, "files": files}


def _saved_manifest() -> dict:
    """
    Lit le manifeste persisté. Tolère l'ancien format à plat
    ({filename: mtime}) pour ne pas forcer un rebuild faussement positif
    lors de la première mise à jour vers le format enrichi.
    """
    if not MANIFEST_FILE.exists():
        return {"embed_model": None, "files": {}}
    try:
        data = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        # Ancien format à plat → on l'enveloppe (modèle inconnu).
        if isinstance(data, dict) and "files" not in data and "embed_model" not in data:
            return {"embed_model": None, "files": data}
        return data
    except Exception:
        return {"embed_model": None, "files": {}}


def _write_manifest(manifest: dict) -> None:
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def _update_manifest_for_file(file_path: Path) -> None:
    """Met à jour (ou ajoute) une entrée pour ce fichier dans le manifeste."""
    manifest = _saved_manifest()
    files = manifest.get("files", {}) or {}
    files[file_path.name] = file_path.stat().st_mtime
    manifest["files"] = files
    manifest["embed_model"] = EMBED_MODEL
    _write_manifest(manifest)


def _remove_manifest_entry(filename: str) -> None:
    manifest = _saved_manifest()
    files = manifest.get("files", {}) or {}
    files.pop(filename, None)
    manifest["files"] = files
    manifest["embed_model"] = EMBED_MODEL
    _write_manifest(manifest)


def _chroma_is_ready() -> bool:
    """
    Heuristique simple : un index Chroma est considéré « prêt »
    si CHROMA_DIR existe et n'est pas vide. Suffisant car Chroma
    crée toujours au moins chroma.sqlite3 lors de la première écriture.
    """
    if not CHROMA_DIR.exists():
        return False
    return any(CHROMA_DIR.iterdir())


# --------------------------------------------------------------------
# Bootstrap au démarrage : sync INCRÉMENTAL si possible, sinon rebuild
# --------------------------------------------------------------------
def ensure_rag_ready() -> None:
    """
    Synchronise l'index avec uploaded_docs/ au démarrage de l'API.

    Logique :
      - uploaded_docs/ vide                → rien à faire
      - manifest + index OK + pas de diff  → on garde l'index
      - modèle d'embedding changé          → rebuild COMPLET (vecteurs incompatibles)
      - manifest absent / index absent     → rebuild COMPLET (premier démarrage)
      - sinon (ajouts/suppressions/modifs) → SYNC INCRÉMENTAL
    """
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    current = _current_manifest()
    current_files = current["files"]
    if not current_files:
        print("[startup] uploaded_docs/ vide — aucun RAG à construire.")
        return

    saved = _saved_manifest()
    saved_files = saved.get("files", {}) or {}
    saved_model = saved.get("embed_model")

    # Cas 1 : tout identique → rien à faire
    if current == saved and _chroma_is_ready():
        print(
            f"[startup] uploaded_docs/ inchangé "
            f"({len(current_files)} fichier(s), modèle {EMBED_MODEL}) "
            f"— index conservé."
        )
        return

    # Cas 2 : modèle d'embedding différent → rebuild complet nécessaire
    if saved_model != EMBED_MODEL:
        print(
            f"[startup] Modèle d'embedding changé : "
            f"{saved_model!r} → {EMBED_MODEL!r} — rebuild COMPLET forcé."
        )
        try:
            rebuild_rag()
        except Exception as exc:  # noqa: BLE001
            print(
                f"[startup] ⚠️  rebuild_rag() a échoué : {exc}\n"
                "[startup] L'API démarre quand même."
            )
        return

    # Cas 3 : pas d'index physique sur le disque → rebuild complet
    if not _chroma_is_ready():
        print("[startup] Index Chroma absent — rebuild COMPLET.")
        try:
            rebuild_rag()
        except Exception as exc:  # noqa: BLE001
            print(
                f"[startup] ⚠️  rebuild_rag() a échoué : {exc}\n"
                "[startup] L'API démarre quand même."
            )
        return

    # Cas 4 : sync incrémental
    added = sorted(set(current_files) - set(saved_files))
    removed = sorted(set(saved_files) - set(current_files))
    modified = sorted(
        name for name in (set(current_files) & set(saved_files))
        if current_files[name] != saved_files[name]
    )
    print(
        f"[startup] Sync incrémental — "
        f"ajout(s)={len(added)} suppression(s)={len(removed)} "
        f"modif(s)={len(modified)}"
    )
    if added:
        print(f"[startup]   ajouts : {added}")
    if removed:
        print(f"[startup]   suppressions : {removed}")
    if modified:
        print(f"[startup]   modifications : {modified}")

    try:
        for name in removed:
            remove_file_from_index(name)
        for name in modified:
            # modif = supprime puis ré-ajoute (mtime / contenu peuvent
            # avoir changé)
            remove_file_from_index(name)
            add_file_to_index(UPLOAD_DIR / name)
        for name in added:
            add_file_to_index(UPLOAD_DIR / name)
    except Exception as exc:  # noqa: BLE001
        print(
            f"[startup] ⚠️  sync incrémental partiel : {exc}\n"
            "[startup] L'API démarre quand même."
        )

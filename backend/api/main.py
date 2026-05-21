import asyncio
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from api.gherkin_agent import app_graph
from api.rag.ingest import ingest_spec
from api.rag.vector_store import rebuild_rag, ensure_rag_ready

from fastapi.middleware.cors import CORSMiddleware

UPLOAD_DIR = Path("uploaded_docs")
UPLOAD_DIR.mkdir(exist_ok=True)


# Intervalle (en secondes) entre deux scans de uploaded_docs/.
# Configurable via la variable d'env RAG_WATCH_INTERVAL_SEC.
RAG_WATCH_INTERVAL_SEC = int(os.getenv("RAG_WATCH_INTERVAL_SEC", "30"))


async def _rag_watcher() -> None:
    """
    Boucle de fond : toutes les RAG_WATCH_INTERVAL_SEC, on appelle
    ensure_rag_ready() qui ne reconstruit que si le manifeste a changé.
    L'appel est lancé dans un thread (asyncio.to_thread) pour ne pas
    bloquer la boucle d'événements pendant les embeddings.
    """
    print(f"[watcher] démarré (intervalle = {RAG_WATCH_INTERVAL_SEC}s)")
    try:
        while True:
            await asyncio.sleep(RAG_WATCH_INTERVAL_SEC)
            try:
                await asyncio.to_thread(ensure_rag_ready)
            except Exception as exc:  # noqa: BLE001
                print(f"[watcher] erreur : {exc}")
    except asyncio.CancelledError:
        print("[watcher] arrêté")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup : on garantit que le RAG est prêt avant d'accepter des requêtes.
    ensure_rag_ready()

    # Puis on lance le watcher périodique en arrière-plan.
    watcher_task = asyncio.create_task(_rag_watcher())

    try:
        yield
    finally:
        # Shutdown : on arrête proprement la tâche de fond.
        watcher_task.cancel()
        try:
            await watcher_task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SpecRequest(BaseModel):
    text: str


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    use_rag: bool = True

@app.get("/")
def root():
    return {"message": "EXPERSI QA Copilot API running"}

@app.post("/ingest")
def ingest(req: SpecRequest):
    ingest_spec(req.text)
    return {"status": "ok"}

@app.post("/generate")
def generate(req: SpecRequest):

    result = app_graph.invoke({
        "input": req.text
    })

    print("GRAPH RESULT =", result)

    if result is None:
        return {
            "gherkin": "Graph returned None"
        }

    return {
        "gherkin": result.get("output", "No output")
    }
    
@app.post("/upload-specification")
async def upload_specification(file: UploadFile = File(...)):

    file_path = UPLOAD_DIR / file.filename

    # sauvegarde fichier
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # reconstruction complète du RAG
    rebuild_rag()

    return {
        "message": f"{file.filename} uploadé et RAG reconstruit"
    }


# ------------------------------------------------------------------
# Historique des spécifications (vue persistante du dossier disque)
# ------------------------------------------------------------------
SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}


def _safe_filename(name: str) -> str:
    """Anti path-traversal : on garde uniquement le basename."""
    cleaned = Path(name).name
    if not cleaned or cleaned in {".", ".."}:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    return cleaned


@app.get("/specifications")
def list_specifications():
    """Liste les fichiers actuellement présents dans uploaded_docs/."""
    if not UPLOAD_DIR.exists():
        return []
    items = []
    for p in sorted(UPLOAD_DIR.iterdir()):
        if not p.is_file() or p.suffix.lower() not in SUPPORTED_EXTS:
            continue
        stat = p.stat()
        items.append({
            "name": p.name,
            "size": stat.st_size,
            "uploaded_at": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
        })
    return items


@app.delete("/specifications/{filename}")
def delete_specification(filename: str):
    """Supprime un fichier puis reconstruit le RAG."""
    safe = _safe_filename(filename)
    target = UPLOAD_DIR / safe
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    target.unlink()
    rebuild_rag()
    return {"status": "success", "filename": safe}


# ------------------------------------------------------------------
# Endpoint conversationnel — assistant IA QA branché sur le RAG
# ------------------------------------------------------------------
from langchain_openai import ChatOpenAI

from api.rag.retriever import retrieve_context

# LLM partagé avec gherkin_agent — modèle léger, suffisant pour le chat
_chat_llm = ChatOpenAI(model="gpt-5-nano")

_SYSTEM_PROMPT = (
    "Tu es l'assistant IA d'EXPERSI QA Copilot. Tu aides l'équipe QA à "
    "comprendre les spécifications fonctionnelles, à concevoir des cas de "
    "tests, et à analyser les anomalies. Tu réponds en français, de façon "
    "claire, concise et professionnelle. Quand le contexte RAG fourni est "
    "pertinent, appuie-toi dessus explicitement ; sinon réponds avec tes "
    "connaissances générales en QA."
)


@app.post("/chat")
def chat(req: ChatRequest):
    """
    Conversation libre avec l'assistant IA.

    - `messages` : historique (user/assistant) — le dernier doit être un message user.
    - `use_rag`  : si True, on récupère du contexte depuis Chroma sur la base
                   du dernier message utilisateur.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages vide")

    last_user_msg = next(
        (m for m in reversed(req.messages) if m.role == "user"),
        None,
    )
    if last_user_msg is None:
        raise HTTPException(
            status_code=400,
            detail="Pas de message utilisateur dans l'historique",
        )

    # Contexte RAG (best effort — ne casse pas si l'index n'existe pas encore)
    context = ""
    if req.use_rag:
        try:
            docs = retrieve_context(last_user_msg.content)
            if docs:
                context = "\n\n".join(d.page_content for d in docs)
        except Exception as exc:  # noqa: BLE001
            print(f"[chat] RAG indisponible : {exc}")

    # Construction du prompt façon ChatML
    chat_messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    if context:
        chat_messages.append({
            "role": "system",
            "content": (
                "Contexte issu des spécifications indexées (RAG) :\n\n"
                f"{context}"
            ),
        })
    chat_messages.extend(
        {"role": m.role, "content": m.content} for m in req.messages
    )

    response = _chat_llm.invoke(chat_messages)

    return {
        "reply": response.content,
        "used_rag": bool(context),
    }
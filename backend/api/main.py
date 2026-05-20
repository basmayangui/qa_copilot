import asyncio
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
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
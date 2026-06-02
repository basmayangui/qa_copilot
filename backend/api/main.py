import asyncio
import json
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from api.gherkin_agent import app_graph
from api.rag.ingest import ingest_spec
from api.rag.vector_store import (
    rebuild_rag,
    ensure_rag_ready,
    add_file_to_index,
    remove_file_from_index,
)
from api.test_cases import (
    list_test_cases,
    get_test_case,
    create_test_case,
    update_test_case,
    delete_test_case,
)
from api.script_generator import generate_scripts_for_cases
from api.validated_scripts import (
    list_validated_scripts,
    get_validated_script,
    create_validated_script,
    update_validated_script,
    delete_validated_script,
)

from fastapi.middleware.cors import CORSMiddleware

UPLOAD_DIR = Path("uploaded_docs")
UPLOAD_DIR.mkdir(exist_ok=True)


# ------------------------------------------------------------------
# Registre des fichiers uploadés via l'UI
# ------------------------------------------------------------------
# Sert à distinguer les fichiers ajoutés via /upload-specification
# des fichiers déposés à la main dans uploaded_docs/. Le frontend ne
# montre que les fichiers présents dans ce registre.
# Fichier vide au premier démarrage (clean slate explicite).
_UI_UPLOADS_FILE = Path(".ui_uploads.json")


def _load_ui_uploads() -> set[str]:
    if not _UI_UPLOADS_FILE.exists():
        _save_ui_uploads(set())
        return set()
    try:
        data = json.loads(_UI_UPLOADS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return set(data)
        if isinstance(data, dict) and "files" in data:
            return set(data["files"])
    except Exception:
        pass
    return set()


def _save_ui_uploads(filenames: set[str]) -> None:
    _UI_UPLOADS_FILE.write_text(
        json.dumps(sorted(filenames), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _register_ui_upload(filename: str) -> None:
    s = _load_ui_uploads()
    s.add(filename)
    _save_ui_uploads(s)


def _unregister_ui_upload(filename: str) -> None:
    s = _load_ui_uploads()
    s.discard(filename)
    _save_ui_uploads(s)


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
    # Nom du projet : sert à la fois de métadonnée et de requête pour le
    # RAG (le LLM va chercher dans Chroma les chunks les plus proches
    # sémantiquement de ce nom).
    project_name: str
    # Type de tests à générer.
    # Valeurs : "fonctionnels" | "non_regression" | "performance" | "stress"
    test_type: str = "fonctionnels"
    # Niveau de détail attendu sur la génération Gherkin.
    # Valeurs : "standard" | "avance" | "expert" (cf. gherkin_agent.py)
    detail_level: str = "standard"


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

    # Le nom du projet sert de "spec" virtuelle pour le LLM (et de
    # requête pour le RAG). Le contenu réel viendra du contexte RAG.
    result = app_graph.invoke({
        "input": req.project_name,
        "detail_level": req.detail_level,
        "test_type": req.test_type,
        "project_name": req.project_name,
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

    # Indexation INCRÉMENTALE : seul ce fichier est embedded + ajouté
    # à Chroma. Si une version précédente existait, ses chunks sont
    # remplacés (re-upload safe).
    n_chunks = add_file_to_index(file_path)

    # Trace l'origine UI pour le filtrage de l'historique côté front.
    _register_ui_upload(file.filename)

    return {
        "message": f"{file.filename} uploadé et indexé ({n_chunks} chunk(s))"
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
    """
    Liste les fichiers actuellement présents dans uploaded_docs/.

    Chaque entrée porte un flag `ui_uploaded` :
      - True  → fichier ajouté via l'interface UI (présent dans le registre)
      - False → fichier ajouté à la main dans uploaded_docs/ (indexé via
                le watcher, mais invisible dans l'historique UI)

    Auto-cleanup : si le registre référence un fichier qui n'existe plus
    sur disque, on retire silencieusement l'entrée du registre.
    """
    if not UPLOAD_DIR.exists():
        return []

    ui_set = _load_ui_uploads()
    on_disk: set[str] = set()
    items = []
    for p in sorted(UPLOAD_DIR.iterdir()):
        if not p.is_file() or p.suffix.lower() not in SUPPORTED_EXTS:
            continue
        on_disk.add(p.name)
        stat = p.stat()
        items.append({
            "name": p.name,
            "size": stat.st_size,
            "uploaded_at": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
            "ui_uploaded": p.name in ui_set,
        })

    # Auto-cleanup : on retire du registre les fichiers qui ne sont
    # plus sur disque (suppression manuelle, déplacement, etc.)
    stale = ui_set - on_disk
    if stale:
        _save_ui_uploads(ui_set - stale)

    return items


@app.delete("/specifications/{filename}")
def delete_specification(filename: str):
    """Supprime un fichier et retire ses chunks de l'index (incrémental)."""
    safe = _safe_filename(filename)
    target = UPLOAD_DIR / safe
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    target.unlink()

    # Suppression INCRÉMENTALE : on retire uniquement les chunks de ce
    # fichier, le reste de l'index est intact.
    n_removed = remove_file_from_index(safe)

    # Retire du registre UI (no-op si le fichier n'y était pas).
    _unregister_ui_upload(safe)

    return {
        "status": "success",
        "filename": safe,
        "chunks_removed": n_removed,
    }


# ------------------------------------------------------------------
# Ouverture du fichier brut dans un nouvel onglet (bouton œil)
# ------------------------------------------------------------------
import mimetypes
from fastapi.responses import FileResponse


@app.get("/specifications/{filename}/raw")
def raw_specification(filename: str):
    """
    Sert le fichier brut (PDF/DOCX/TXT) avec Content-Disposition inline,
    pour que le navigateur l'affiche directement quand c'est possible.

    Note : les PDF et TXT s'affichent nativement dans l'onglet ;
    les DOCX déclencheront un téléchargement (limitation navigateur).
    """
    safe = _safe_filename(filename)
    target = UPLOAD_DIR / safe
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    if target.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Format non supporté")

    media_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(
        path=str(target),
        media_type=media_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe}"'},
    )


# ------------------------------------------------------------------
# Endpoint conversationnel — assistant IA QA branché sur le RAG
# ------------------------------------------------------------------
from langchain_openai import ChatOpenAI

from api.rag.retriever import retrieve_context

# LLM partagé avec gherkin_agent — modèle léger, suffisant pour le chat
_chat_llm = ChatOpenAI(model="gpt-5-nano")

_SYSTEM_PROMPT = (
    "Tu es l'assistant IA d'EXPERSI QA Copilot. Ton rôle principal est "
    "d'aider l'équipe QA (comprendre les spécifications fonctionnelles, "
    "concevoir des cas de tests, analyser des anomalies), mais tu peux "
    "aussi répondre à toute question sur le contenu des documents "
    "indexés dans le RAG, quel que soit le sujet.\n\n"
    "Règles importantes :\n"
    "- Quand un contexte RAG t'est fourni, considère-le comme la "
    "source de vérité prioritaire et utilise-le activement pour "
    "répondre, MÊME si le sujet semble éloigné de la QA.\n"
    "- Si l'utilisateur pose une question sur un sujet présent dans "
    "le contexte RAG, réponds à partir de ce contexte sans hésiter.\n"
    "- Si l'information n'est ni dans le contexte ni dans tes "
    "connaissances générales, dis-le honnêtement.\n"
    "- Réponds en français, de façon claire, concise et "
    "professionnelle."
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
                # Debug : on log quels fichiers ont nourri la réponse
                sources = sorted({
                    (d.metadata or {}).get("source_filename")
                    or (d.metadata or {}).get("source")
                    or "?"
                    for d in docs
                })
                print(
                    f"[chat] question='{last_user_msg.content[:80]}...' "
                    f"→ {len(docs)} chunk(s) récupéré(s) de : {sources}"
                )
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


# ------------------------------------------------------------------
# Cas de test validés — CRUD
# ------------------------------------------------------------------
class TestCaseCreate(BaseModel):
    title: str
    gherkin: str
    tags: list[str] = []
    source_spec: str = ""
    detail_level: str = "standard"
    feature: str = ""
    # Nom du projet d'où vient le cas, saisi côté UI dans /test-cases.
    project_name: str = ""
    # Type de tests (fonctionnels / non_regression / performance / stress).
    test_type: str = "fonctionnels"


class TestCaseUpdate(BaseModel):
    title: str | None = None
    tags: list[str] | None = None
    gherkin: str | None = None


@app.get("/test-cases")
def get_test_cases_route():
    """Liste tous les cas de test validés, du plus récent au plus ancien."""
    return list_test_cases()


@app.get("/test-cases/{tc_id}")
def get_test_case_route(tc_id: str):
    tc = get_test_case(tc_id)
    if tc is None:
        raise HTTPException(status_code=404, detail="Cas de test introuvable")
    return tc


@app.post("/test-cases")
def create_test_case_route(payload: TestCaseCreate):
    """Enregistre un cas de test validé. Renvoie le cas avec son ID."""
    return create_test_case(payload.model_dump())


@app.patch("/test-cases/{tc_id}")
def update_test_case_route(tc_id: str, payload: TestCaseUpdate):
    """Met à jour partiellement un cas de test (title, tags, gherkin)."""
    updated = update_test_case(
        tc_id, payload.model_dump(exclude_none=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Cas de test introuvable")
    return updated


@app.delete("/test-cases/{tc_id}")
def delete_test_case_route(tc_id: str):
    if not delete_test_case(tc_id):
        raise HTTPException(status_code=404, detail="Cas de test introuvable")
    return {"status": "ok", "id": tc_id}


# ------------------------------------------------------------------
# Génération de scripts de tests (Playwright, ...) à partir des cas
# validés.
# ------------------------------------------------------------------
class TestScriptGenerateRequest(BaseModel):
    test_case_ids: list[str]
    framework: str = "playwright"
    language: str = "typescript"
    # Nom du projet, utilisé pour le test.describe() en haut du fichier.
    # Si vide, on dérive du premier cas trouvé.
    project_name: str = ""


@app.post("/test-scripts/generate")
def generate_test_script_route(req: TestScriptGenerateRequest):
    """
    Génère UN script par cas validé sélectionné. Renvoie une liste de
    scripts, un par cas, chacun indépendant. Pour l'instant :
    Playwright TypeScript uniquement.
    """
    if not req.test_case_ids:
        raise HTTPException(
            status_code=400,
            detail="Au moins un cas de test doit être sélectionné.",
        )

    cases: list[dict] = []
    missing: list[str] = []
    for tc_id in req.test_case_ids:
        tc = get_test_case(tc_id)
        if tc is None:
            missing.append(tc_id)
        else:
            cases.append(tc)

    if not cases:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun cas trouvé pour les IDs fournis ({missing}).",
        )

    # Nom de projet : on prend celui passé en payload, ou à défaut le
    # project_name du premier cas. Le script_generator utilisera ensuite
    # le project_name de chaque cas individuellement.
    project_name = req.project_name or (
        cases[0].get("project_name") or cases[0].get("feature") or ""
    )

    try:
        scripts = generate_scripts_for_cases(
            cases,
            framework=req.framework,
            language=req.language,
            project_name=project_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Erreur LLM : {exc}",
        ) from exc

    return {
        "framework": req.framework,
        "language": req.language,
        "project_name": project_name,
        "scripts": scripts,
        "missing_ids": missing,
    }


# ------------------------------------------------------------------
# Scripts de tests validés — CRUD (utilisé par /executions côté front)
# ------------------------------------------------------------------
class ValidatedScriptCreate(BaseModel):
    test_case_id: str | None = None
    test_case_title: str = ""
    framework: str = "playwright"
    language: str = "typescript"
    code: str
    project_name: str = ""
    tags: list[str] = []
    test_type: str = "fonctionnels"


class ValidatedScriptUpdate(BaseModel):
    test_case_title: str | None = None
    code: str | None = None
    tags: list[str] | None = None
    project_name: str | None = None


@app.get("/validated-scripts")
def list_validated_scripts_route():
    """Liste tous les scripts de test validés, du plus récent au plus ancien."""
    return list_validated_scripts()


@app.get("/validated-scripts/{script_id}")
def get_validated_script_route(script_id: str):
    s = get_validated_script(script_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Script introuvable")
    return s


@app.post("/validated-scripts")
def create_validated_script_route(payload: ValidatedScriptCreate):
    return create_validated_script(payload.model_dump())


@app.patch("/validated-scripts/{script_id}")
def update_validated_script_route(
    script_id: str, payload: ValidatedScriptUpdate
):
    updated = update_validated_script(
        script_id, payload.model_dump(exclude_none=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Script introuvable")
    return updated


@app.delete("/validated-scripts/{script_id}")
def delete_validated_script_route(script_id: str):
    if not delete_validated_script(script_id):
        raise HTTPException(status_code=404, detail="Script introuvable")
    return {"status": "ok", "id": script_id}
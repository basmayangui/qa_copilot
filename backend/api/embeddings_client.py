"""
Factory centralisée pour le client d'embeddings du pipeline RAG.

Le module RAG (vector_store, retriever, ingest) appelle `get_embeddings()`
plutôt que d'instancier un client directement. Ça permet de piloter le
fournisseur d'embeddings depuis les variables d'environnement sans
toucher au code.

Deux familles de providers sont supportées :

  1. Modèles locaux Hugging Face (sentence-transformers). Aucune API
     externe n'est appelée : les embeddings sont calculés sur le CPU
     (ou GPU) du serveur QA Copilot. Souveraineté maximale, compatible
     air-gap une fois le modèle téléchargé.

  2. Endpoints compatibles OpenAI (Mistral via api.mistral.ai, OVH AI
     Endpoints, vLLM auto-hébergé...). Le client est `OpenAIEmbeddings`
     de langchain-openai, paramétré par RAG_EMBED_BASE_URL.

Variables d'environnement (cf. backend/.env) :

  RAG_EMBED_PROVIDER  Sélectionne le mode :
                       - "huggingface"   → modèle local (sentence-transformers)
                       - autre valeur    → endpoint compatible OpenAI

  RAG_EMBED_MODEL     Nom du modèle. Pour HuggingFace, c'est l'identifiant
                      du Hub (ex : "BAAI/bge-m3"). Pour les endpoints,
                      c'est le nom attendu côté API (ex : "mistral-embed").

  RAG_EMBED_BASE_URL  (endpoints uniquement) URL de base de l'API
                      compatible OpenAI.

  RAG_EMBED_API_KEY   (endpoints uniquement) Token d'authentification.
                      À défaut, fallback sur LLM_API_KEY.

  RAG_EMBED_DEVICE    (HuggingFace uniquement) "cpu" ou "cuda" — par
                      défaut "cpu". Mettre "cuda" si un GPU NVIDIA est
                      disponible (5-50× plus rapide).

  RAG_EMBED_NORMALIZE (HuggingFace uniquement) "true"/"false" — normalise
                      les vecteurs à la sortie. Recommandé "true" pour
                      les modèles modernes (bge, e5) et la similarité
                      cosinus utilisée par Chroma. Défaut : "true".

  RAG_EMBED_ENCODE_BATCH_SIZE (HuggingFace uniquement) Taille du mini-batch
                      INTERNE de sentence-transformers (un forward pass du
                      modèle). Différent de RAG_EMBED_BATCH_SIZE qui est
                      le batch côté langchain/Chroma. Par défaut
                      sentence-transformers utilise 32, on monte à 64 pour
                      mieux amortir la GEMM sur CPU. Défaut : 64.

Souveraineté :
  - Mode "huggingface" : aucune donnée ne quitte le serveur.
  - Mode endpoint UE (Mistral, OVH) : données hébergées en UE, hors
    portée du CLOUD Act américain.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


# On ne peut pas typer précisément le retour sans importer les deux
# clients ; HuggingFaceEmbeddings n'est chargé qu'à la demande pour
# éviter l'import lourd de sentence-transformers en mode endpoint.
_cached_embeddings = None


def _read_config() -> dict:
    provider = os.getenv("RAG_EMBED_PROVIDER", "").strip().lower()
    base_url = os.getenv("RAG_EMBED_BASE_URL", "").strip() or None
    api_key = (
        os.getenv("RAG_EMBED_API_KEY")
        or os.getenv("LLM_API_KEY")
        or ""
    ).strip()
    model = os.getenv("RAG_EMBED_MODEL", "").strip()
    device = os.getenv("RAG_EMBED_DEVICE", "cpu").strip().lower() or "cpu"
    normalize = (
        os.getenv("RAG_EMBED_NORMALIZE", "true").strip().lower() != "false"
    )
    try:
        encode_batch_size = int(
            os.getenv("RAG_EMBED_ENCODE_BATCH_SIZE", "64")
        )
    except ValueError:
        encode_batch_size = 64

    if not model:
        raise RuntimeError(
            "RAG_EMBED_MODEL n'est pas défini dans backend/.env. "
            "Configure-le avec le nom du modèle d'embedding (ex : "
            "'BAAI/bge-m3' pour HuggingFace, 'mistral-embed' pour un "
            "endpoint compatible OpenAI)."
        )

    return {
        "provider": provider or "default",
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
        "device": device,
        "normalize": normalize,
        "encode_batch_size": encode_batch_size,
    }


def _build_huggingface_embeddings(cfg: dict):
    """
    Construit un client HuggingFaceEmbeddings (modèle local).
    L'import est différé pour ne pas charger sentence-transformers
    quand le mode endpoint est utilisé.
    """
    try:
        from langchain_huggingface import HuggingFaceEmbeddings
    except ImportError as exc:
        raise RuntimeError(
            "Le provider 'huggingface' nécessite les paquets "
            "'langchain-huggingface' et 'sentence-transformers'. "
            "Installe-les avec :\n"
            "    pip install langchain-huggingface sentence-transformers"
        ) from exc

    print(
        f"[embeddings] Initialisation HuggingFace (local) — "
        f"model={cfg['model']!r}, device={cfg['device']!r}, "
        f"normalize={cfg['normalize']}, "
        f"encode_batch_size={cfg['encode_batch_size']}"
    )
    print(
        "[embeddings] Premier chargement : téléchargement du modèle "
        "depuis huggingface.co (peut prendre quelques minutes). "
        "Les exécutions suivantes utiliseront le cache local."
    )

    return HuggingFaceEmbeddings(
        model_name=cfg["model"],
        model_kwargs={"device": cfg["device"]},
        encode_kwargs={
            "normalize_embeddings": cfg["normalize"],
            "batch_size": cfg["encode_batch_size"],
        },
    )


def _build_openai_compatible_embeddings(cfg: dict):
    """
    Construit un client OpenAIEmbeddings pour un endpoint compatible
    OpenAI (Mistral, OVH, vLLM, ...).
    """
    from langchain_openai import OpenAIEmbeddings

    if not cfg["api_key"]:
        raise RuntimeError(
            "RAG_EMBED_API_KEY (ou LLM_API_KEY en fallback) n'est pas "
            "défini dans backend/.env."
        )

    kwargs: dict = {
        "model": cfg["model"],
        "api_key": cfg["api_key"],
    }
    if cfg.get("base_url"):
        kwargs["base_url"] = cfg["base_url"]

    print(
        f"[embeddings] Initialisation endpoint — provider={cfg['provider']!r}, "
        f"model={cfg['model']!r}, "
        f"base_url={cfg.get('base_url') or '(défaut)'}"
    )

    return OpenAIEmbeddings(**kwargs)


def get_embeddings():
    """
    Renvoie un client d'embeddings configuré (instancié au premier
    appel, réutilisé ensuite).

    Le type concret dépend de RAG_EMBED_PROVIDER :
      - "huggingface" → langchain_huggingface.HuggingFaceEmbeddings
      - autre         → langchain_openai.OpenAIEmbeddings
    """
    global _cached_embeddings
    if _cached_embeddings is not None:
        return _cached_embeddings

    cfg = _read_config()

    if cfg["provider"] == "huggingface":
        _cached_embeddings = _build_huggingface_embeddings(cfg)
    else:
        _cached_embeddings = _build_openai_compatible_embeddings(cfg)

    return _cached_embeddings


def reset_cache() -> None:
    """Invalide le cache (utile en tests ou changement de config à chaud)."""
    global _cached_embeddings
    _cached_embeddings = None

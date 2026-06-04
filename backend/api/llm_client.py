"""
Factory centralisée pour le LLM de l'application.

Toute la pile (gherkin_agent, script_generator, /chat) appelle
`get_chat_llm()` plutôt que d'instancier un client directement. Ça
permet de configurer le fournisseur LLM en un seul endroit, à partir
des variables d'environnement.

Variables d'environnement (cf. backend/.env) :

  LLM_PROVIDER     Étiquette informative (apparait dans les logs).

  LLM_BASE_URL     URL de base de l'endpoint LLM (Mistral via OVH AI
                   Endpoints, vLLM auto-hébergé, etc.).

  LLM_API_KEY      Token d'authentification de l'endpoint.

  LLM_MODEL        Nom du modèle attendu par l'endpoint
                   (ex : "Mistral-Small-24B-Instruct-2501").

  LLM_TEMPERATURE  Optionnel. Float, non passé si vide.
  LLM_MAX_TOKENS   Optionnel. Int, non passé si vide.

Souveraineté : tant que LLM_BASE_URL pointe vers un endpoint hébergé
en UE (typiquement OVH) ou on-premise, aucune donnée (specs, chunks
RAG, prompts) ne sort de la zone juridique européenne.
"""

from __future__ import annotations

import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from langchain_openai import ChatOpenAI


_cached_llm: Optional[ChatOpenAI] = None


def _read_config() -> dict:
    provider = os.getenv("LLM_PROVIDER", "").strip().lower()
    base_url = os.getenv("LLM_BASE_URL", "").strip() or None
    api_key = (os.getenv("LLM_API_KEY") or "").strip()
    model = os.getenv("LLM_MODEL", "").strip()
    temperature_raw = os.getenv("LLM_TEMPERATURE", "").strip()
    max_tokens_raw = os.getenv("LLM_MAX_TOKENS", "").strip()

    if not model:
        raise RuntimeError(
            "LLM_MODEL n'est pas défini dans backend/.env. "
            "Configure-le avec le nom du modèle attendu par ton endpoint "
            "(ex : 'Mistral-Small-24B-Instruct-2501')."
        )
    if not api_key:
        raise RuntimeError(
            "LLM_API_KEY n'est pas défini dans backend/.env. "
            "Génère un token sur la console de ton fournisseur LLM."
        )

    cfg: dict = {
        "provider": provider or "default",
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
    }

    if temperature_raw:
        try:
            cfg["temperature"] = float(temperature_raw)
        except ValueError:
            print(
                f"[llm] LLM_TEMPERATURE invalide ({temperature_raw!r}) — ignoré"
            )

    if max_tokens_raw:
        try:
            cfg["max_tokens"] = int(max_tokens_raw)
        except ValueError:
            print(
                f"[llm] LLM_MAX_TOKENS invalide ({max_tokens_raw!r}) — ignoré"
            )

    return cfg


def get_chat_llm() -> ChatOpenAI:
    """
    Renvoie un client LLM configuré (instancié au premier appel,
    réutilisé ensuite).
    """
    global _cached_llm
    if _cached_llm is not None:
        return _cached_llm

    cfg = _read_config()

    kwargs: dict = {
        "model": cfg["model"],
        "api_key": cfg["api_key"],
    }
    if cfg.get("base_url"):
        kwargs["base_url"] = cfg["base_url"]
    if "temperature" in cfg:
        kwargs["temperature"] = cfg["temperature"]
    if "max_tokens" in cfg:
        kwargs["max_tokens"] = cfg["max_tokens"]

    print(
        f"[llm] Initialisation — provider={cfg['provider']!r}, "
        f"model={cfg['model']!r}, "
        f"base_url={cfg.get('base_url') or '(défaut)'}"
    )

    _cached_llm = ChatOpenAI(**kwargs)
    return _cached_llm


def reset_cache() -> None:
    """Invalide le cache (utile en tests ou changement de config à chaud)."""
    global _cached_llm
    _cached_llm = None

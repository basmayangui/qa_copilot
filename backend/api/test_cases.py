"""
Persistance des cas de test validés.

Stockage : backend/.validated_test_cases.json (clean local state, gitignored).

Chaque cas validé porte :
  - id           : UUID stable
  - title        : titre du Scenario (sans le mot-clé "Scenario:")
  - tags         : liste de tags Gherkin (@happy, @critical, ...)
  - gherkin      : bloc Gherkin complet du scénario (tags + Scenario + steps)
  - source_spec  : extrait (tronqué) de la spec qui a servi à le générer
  - detail_level : "standard" | "avance" | "expert"
  - feature      : nom de la Feature parente si fournie
  - created_at   : ISO datetime
  - updated_at   : ISO datetime

Le module est thread-safe (lock global), comme le reste du code RAG.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


TEST_CASES_FILE = Path(".validated_test_cases.json")
_lock = threading.Lock()

# Tronque la spec source pour ne pas exploser la taille du fichier.
_SOURCE_SPEC_MAX_CHARS = 4000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> list[dict]:
    """Lit le fichier de persistance. Tolérant aux formats anciens."""
    if not TEST_CASES_FILE.exists():
        return []
    try:
        data = json.loads(TEST_CASES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "test_cases" in data:
            return data["test_cases"]
        if isinstance(data, list):
            return data
    except Exception as exc:  # noqa: BLE001
        print(f"[test_cases] fichier illisible : {exc}")
    return []


def _save(items: list[dict]) -> None:
    TEST_CASES_FILE.write_text(
        json.dumps({"test_cases": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_test_cases() -> list[dict]:
    """Renvoie la liste complète, du plus récent au plus ancien."""
    items = _load()
    items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return items


def get_test_case(tc_id: str) -> Optional[dict]:
    for t in _load():
        if t.get("id") == tc_id:
            return t
    return None


def create_test_case(payload: dict) -> dict:
    """Ajoute un nouveau cas validé. Renvoie le cas créé (avec id)."""
    with _lock:
        items = _load()
        now = _now_iso()
        tc = {
            "id": str(uuid.uuid4()),
            "title": (payload.get("title") or "").strip()
                     or "Scenario sans titre",
            "tags": list(payload.get("tags") or []),
            "gherkin": (payload.get("gherkin") or "").strip(),
            "source_spec": (payload.get("source_spec") or "")[
                :_SOURCE_SPEC_MAX_CHARS
            ],
            "detail_level": payload.get("detail_level") or "standard",
            "feature": (payload.get("feature") or "").strip(),
            "created_at": now,
            "updated_at": now,
        }
        items.append(tc)
        _save(items)
        return tc


def update_test_case(tc_id: str, payload: dict) -> Optional[dict]:
    """
    Modifie les champs autorisés (title, tags, gherkin) d'un cas existant.
    Renvoie le cas mis à jour, ou None si l'id n'existe pas.
    """
    with _lock:
        items = _load()
        for tc in items:
            if tc.get("id") == tc_id:
                if "title" in payload and payload["title"] is not None:
                    tc["title"] = str(payload["title"]).strip()
                if "tags" in payload and payload["tags"] is not None:
                    tc["tags"] = list(payload["tags"])
                if "gherkin" in payload and payload["gherkin"] is not None:
                    tc["gherkin"] = str(payload["gherkin"]).strip()
                tc["updated_at"] = _now_iso()
                _save(items)
                return tc
        return None


def delete_test_case(tc_id: str) -> bool:
    with _lock:
        items = _load()
        new_items = [t for t in items if t.get("id") != tc_id]
        if len(new_items) == len(items):
            return False
        _save(new_items)
        return True

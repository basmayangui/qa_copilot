"""
Persistance des scripts de tests validés (Playwright, ...).

Stockage : backend/.validated_scripts.json — gitignored.

Chaque script validé porte :
  - id                : UUID stable
  - test_case_id      : référence vers le cas Gherkin source (si dispo)
  - test_case_title   : titre du cas au moment de la génération
  - framework         : "playwright" (pour l'instant)
  - language          : "typescript" (pour l'instant)
  - code              : le code TypeScript du test
  - project_name      : nom du projet
  - tags              : tags Gherkin associés
  - test_type         : "fonctionnels" | "non_regression" | "performance" | "stress"
  - created_at / updated_at : ISO datetime UTC
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


VALIDATED_SCRIPTS_FILE = Path(".validated_scripts.json")
_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> list[dict]:
    if not VALIDATED_SCRIPTS_FILE.exists():
        return []
    try:
        data = json.loads(VALIDATED_SCRIPTS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "scripts" in data:
            return data["scripts"]
        if isinstance(data, list):
            return data
    except Exception as exc:  # noqa: BLE001
        print(f"[validated_scripts] fichier illisible : {exc}")
    return []


def _save(items: list[dict]) -> None:
    VALIDATED_SCRIPTS_FILE.write_text(
        json.dumps({"scripts": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_validated_scripts() -> list[dict]:
    items = _load()
    items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return items


def get_validated_script(script_id: str) -> Optional[dict]:
    for s in _load():
        if s.get("id") == script_id:
            return s
    return None


def create_validated_script(payload: dict) -> dict:
    with _lock:
        items = _load()
        now = _now_iso()
        s = {
            "id": str(uuid.uuid4()),
            "test_case_id": payload.get("test_case_id"),
            "test_case_title": (payload.get("test_case_title") or "").strip(),
            "framework": payload.get("framework") or "playwright",
            "language": payload.get("language") or "typescript",
            "code": (payload.get("code") or "").strip(),
            "project_name": (payload.get("project_name") or "").strip(),
            "tags": list(payload.get("tags") or []),
            "test_type": payload.get("test_type") or "fonctionnels",
            "created_at": now,
            "updated_at": now,
        }
        items.append(s)
        _save(items)
        return s


def update_validated_script(
    script_id: str, payload: dict
) -> Optional[dict]:
    with _lock:
        items = _load()
        for s in items:
            if s.get("id") == script_id:
                for key in ("test_case_title", "code", "tags", "project_name"):
                    if key in payload and payload[key] is not None:
                        if key == "tags":
                            s[key] = list(payload[key])
                        else:
                            s[key] = str(payload[key]).strip()
                s["updated_at"] = _now_iso()
                _save(items)
                return s
        return None


def delete_validated_script(script_id: str) -> bool:
    with _lock:
        items = _load()
        new_items = [s for s in items if s.get("id") != script_id]
        if len(new_items) == len(items):
            return False
        _save(new_items)
        return True

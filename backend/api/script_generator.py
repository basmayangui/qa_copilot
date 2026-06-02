"""
Génération de scripts de tests automatisés à partir de cas Gherkin validés.

Approche : on demande au LLM de traduire une liste de scénarios Gherkin
en code de tests pour un framework donné (Playwright TypeScript pour
l'instant ; Cypress / Selenium à venir).

Le LLM partagé (cf. gherkin_agent.py) est utilisé.
"""

from __future__ import annotations

from typing import Optional


# --------------------------------------------------------------------
# Prompts par framework — version PER-CASE (1 fichier par scénario)
# --------------------------------------------------------------------
_PLAYWRIGHT_TS_PER_CASE_PROMPT = """Tu es un expert en automatisation de tests Playwright.

Voici UN scénario Gherkin validé par l'équipe QA. Ta tâche :
produire un fichier de test Playwright TypeScript COMPLET et AUTONOME
pour CE SEUL scénario.

PROJET : {project_name}
TITRE : {title}
TAGS  : {tags}
TYPE  : {test_type}

GHERKIN :
{gherkin}

RÈGLES DE FORMAT STRICTES :
- Démarre le fichier par `import {{ test, expect }} from '@playwright/test';`
- Encapsule dans un `test.describe('{project_name}', () => {{ ... }})`
- Préserve les tags Gherkin comme commentaire TypeScript au-dessus du test :
    // {tags}
    test('{title}', async ({{ page, request }}) => {{ ... }});
- Traduis chaque step Gherkin en code Playwright idiomatique :
  • UI : `await page.goto(...)`, `await page.click(...)`, `await page.fill(...)`,
    `await expect(page.locator(...)).toBeVisible()`
  • API / Performance : `const response = await request.get('/url')`,
    `expect(response.status()).toBe(200)`, etc.
  • Temps de réponse :
        const t0 = Date.now();
        const response = await request.get('/url');
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(2000);
  • Scenario Outline avec Examples : déplie-les via une boucle `for`
    sur les jeux de données.
- N'invente pas d'endpoints exotiques : si la spec ne mentionne pas
  l'URL, utilise un placeholder avec `// TODO: confirmer l'URL`.
- Pour les pré-conditions (auth, données de test), utilise
  `test.beforeEach` si pertinent.
- Réponds UNIQUEMENT avec le code TypeScript brut, SANS bloc markdown
  ```typescript ... ```.

Produis maintenant le fichier `.spec.ts` pour ce seul scénario.
"""


def _build_per_case_prompt(
    case: dict,
    *,
    framework: str,
    language: str,
    project_name: str,
) -> str:
    """Construit le prompt focalisé sur UN seul cas."""
    if framework == "playwright" and language == "typescript":
        tags_str = " ".join(case.get("tags") or []) or "(aucun)"
        return _PLAYWRIGHT_TS_PER_CASE_PROMPT.format(
            project_name=project_name or case.get("project_name") or "Tests",
            title=case.get("title") or "Test",
            tags=tags_str,
            test_type=case.get("test_type") or "fonctionnels",
            gherkin=(case.get("gherkin") or "").strip(),
        )
    raise ValueError(
        f"Combinaison non supportée : framework={framework!r} language={language!r}"
    )


# --------------------------------------------------------------------
# Génération case-par-case
# --------------------------------------------------------------------
def generate_script_for_case(
    case: dict,
    *,
    framework: str = "playwright",
    language: str = "typescript",
    project_name: str = "",
) -> dict:
    """
    Génère le code d'un fichier .spec.ts dédié à UN SEUL cas validé.

    Renvoie un dict :
      {
        "test_case_id": str,
        "test_case_title": str,
        "framework": str,
        "language": str,
        "code": str,
        "tags": list[str],
        "project_name": str,
      }
    """
    from api.gherkin_agent import llm  # import paresseux

    prompt = _build_per_case_prompt(
        case,
        framework=framework,
        language=language,
        project_name=project_name,
    )

    try:
        response = llm.invoke(prompt)
        code = (response.content or "").strip()
    except Exception as exc:  # noqa: BLE001
        print(
            f"[script_generator] ECHEC LLM (case={case.get('id')!r}, "
            f"framework={framework}) : {exc}"
        )
        raise

    code = _strip_markdown_fences(code)

    print(
        f"[script_generator] Script {framework} pour "
        f"{case.get('title')!r} — {len(code)} chars"
    )

    return {
        "test_case_id": case.get("id"),
        "test_case_title": case.get("title", ""),
        "framework": framework,
        "language": language,
        "code": code,
        "tags": list(case.get("tags") or []),
        "project_name": project_name or case.get("project_name") or "",
        "test_type": case.get("test_type") or "fonctionnels",
    }


def generate_scripts_for_cases(
    cases: list[dict],
    *,
    framework: str = "playwright",
    language: str = "typescript",
    project_name: str = "",
) -> list[dict]:
    """
    Génère 1 script par cas, en série (séquentiel). Si un cas échoue,
    on continue les autres et on remonte une erreur partielle dans le
    champ `error` de l'entrée correspondante.
    """
    if not cases:
        raise ValueError("Aucun cas de test fourni.")

    results: list[dict] = []
    for case in cases:
        try:
            results.append(
                generate_script_for_case(
                    case,
                    framework=framework,
                    language=language,
                    project_name=project_name,
                )
            )
        except Exception as exc:  # noqa: BLE001
            results.append({
                "test_case_id": case.get("id"),
                "test_case_title": case.get("title", ""),
                "framework": framework,
                "language": language,
                "code": "",
                "tags": list(case.get("tags") or []),
                "project_name": project_name or case.get("project_name") or "",
                "test_type": case.get("test_type") or "fonctionnels",
                "error": str(exc),
            })
    return results


def _strip_markdown_fences(text: str) -> str:
    """Retire les fences ```...``` qui enrobent éventuellement la réponse."""
    s = text.strip()
    if s.startswith("```"):
        # Retire la 1ère ligne (```typescript ou ```ts) et la dernière (```).
        lines = s.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        s = "\n".join(lines)
    return s.strip()

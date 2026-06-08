from typing import TypedDict

from langgraph.graph import StateGraph, END

from api.rag.retriever import retrieve_context
from api.rag.vector_store import get_retriever
from api.llm_client import get_chat_llm

import os
from dotenv import load_dotenv
load_dotenv() ## loading all the environment variable

# Le LLM est configuré via env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)
# dans backend/.env. Voir api/llm_client.py.
llm = get_chat_llm()

class AgentState(TypedDict, total=False):
    input: str
    context: str
    output: str
    detail_level: str  # "standard" | "avance" | "expert"
    test_type: str     # "fonctionnels" | "non_regression" | "performance" | "stress"
    project_name: str


# Consignes spécifiques par TYPE de tests. Chaque type oriente le LLM
# vers un style de scénarios très différent.
TEST_TYPE_INSTRUCTIONS = {
    "fonctionnels": (
        "Type de tests : FONCTIONNELS.\n"
        "Génère des scénarios qui valident le comportement métier : "
        "user flows nominaux, règles de validation, transitions d'état, "
        "vérifications des écrans et messages. C'est le mode par défaut, "
        "centré sur 'le système fait-il ce qu'il est censé faire ?'."
    ),
    "non_regression": (
        "Type de tests : NON-RÉGRESSION.\n"
        "Génère des scénarios qui couvrent les CHEMINS CRITIQUES qu'il "
        "ne faut PAS casser entre deux versions. Concentre-toi sur :\n"
        "- les fonctionnalités les plus utilisées (un scénario = UNE "
        "fonctionnalité ou UNE action critique, JAMAIS un parcours "
        "multi-étapes enchaîné)\n"
        "- les règles métier sensibles (calculs, autorisations, totaux)\n"
        "- les intégrations clés\n"
        "RAPPEL STRUCTUREL : même pour un parcours utilisateur multi-pages, "
        "tu écris UN scénario PAR transition (1 clic → 1 vérification), pas "
        "un seul mégascénario qui enchaîne plusieurs When/Then. Si "
        "l'utilisateur navigue de la page A vers B puis vers C, ça fait "
        "DEUX scénarios : 'A→B' avec Given A / When clic / Then B, et "
        "'B→C' avec Given B / When clic / Then C.\n"
        "Tague chaque scénario avec @regression et @critical pour qu'ils "
        "soient pris en compte par la CI à chaque livraison."
    ),
    "performance": (
        "Type de tests : PERFORMANCE.\n"
        "Génère des scénarios mesurant la performance : temps de réponse, "
        "débit, scalabilité. Chaque scénario doit inclure des ASSERTIONS "
        "DE SEUIL explicites, par exemple :\n"
        "  Then le temps de réponse est inférieur à 2 secondes\n"
        "  Then le système traite au moins 500 requêtes par seconde\n"
        "Précise les pré-conditions de charge (ex : 'Étant donné 100 "
        "utilisateurs simultanés'). Tague avec @perf, et précise le seuil "
        "métier ciblé quand pertinent (@p95, @p99)."
    ),
    "stress": (
        "Type de tests : STRESS.\n"
        "Génère des scénarios qui poussent le système à ses LIMITES "
        "et au-delà :\n"
        "- charge extrême (10x la nominale)\n"
        "- ressources saturées (mémoire, connexions, disque)\n"
        "- pics soutenus dans le temps\n"
        "- conditions de dégradation (réseau lent, dépendance indisponible)\n"
        "Vérifie que le système dégrade ÉLÉGAMMENT (file d'attente, "
        "circuit breaker, message d'erreur clair) plutôt que de crasher. "
        "Tague avec @stress, @perf, et @edge."
    ),
}


# Consignes spécifiques par niveau de détail. Le LLM les reçoit
# inline dans le prompt, en plus de la spécification et du contexte RAG.
DETAIL_LEVEL_INSTRUCTIONS = {
    "standard": (
        "Niveau de détail attendu : STANDARD.\n"
        "- Génère entre 5 et 8 scénarios.\n"
        "- Couvre les chemins nominaux (happy paths) et les cas d'usage "
        "principaux.\n"
        "- Tague chaque scénario avec AU MOINS UN tag de base parmi : "
        "@smoke (parcours essentiel), @nominal (cas standard), "
        "@happy (chemin sans erreur). Le tag est placé sur la ligne "
        "JUSTE AVANT 'Scenario:'.\n"
        "- Pas de Scenario Outline.\n"
        "- Style clair et concis, accessible à un non-spécialiste QA."
    ),
    "avance": (
        "Niveau de détail attendu : AVANCÉ.\n"
        "- Génère entre 10 et 15 scénarios.\n"
        "- Inclus en plus des happy paths : les cas d'erreur, les messages "
        "d'erreur attendus, les valeurs limites (boundary values), et au "
        "moins un cas de validation d'entrée invalide.\n"
        "- Utilise des tags Gherkin pour catégoriser : @happy, @error, "
        "@edge selon les scénarios.\n"
        "- RAPPEL : chaque Scenario commence par ses propres Given — "
        "tu ne factorises JAMAIS dans un Background."
    ),
    "expert": (
        "Niveau de détail attendu : EXPERT QA.\n"
        "- Génère ENTRE 15 ET 25 scénarios — NE DÉPASSE JAMAIS 25, "
        "même si le projet est riche. Si tu as plus de cas à couvrir, "
        "garde ceux qui ont la plus forte valeur business et écarte "
        "les autres. Compte tes Scenario/Scenario Outline avant de "
        "renvoyer la réponse.\n"
        "- Couvre : chemins nominaux et alternatifs, cas d'erreur (avec "
        "messages et codes retour attendus), valeurs limites et "
        "équivalence partitionnée, scénarios de sécurité (autorisation, "
        "injection, accès interdit), cas de performance ou de charge si "
        "pertinent.\n"
        "- Utilise des Scenario Outline + Examples pour les cas "
        "data-driven (paramétrage par jeu de données).\n"
        "- Utilise des tags riches : @smoke, @regression, @security, "
        "@perf, @edge, @critical selon le scénario.\n"
        "- RAPPEL : chaque Scenario commence par ses propres Given — "
        "tu ne factorises JAMAIS dans un Background. La répétition de "
        "Given identiques entre scénarios est acceptée et préférée à "
        "un Background partagé.\n"
        "- Précise les pré-conditions techniques quand pertinent."
    ),
}


def retrieve_node(state: AgentState):

    user_input = state.get("input", "")

    docs = retrieve_context(user_input)

    context = "\n".join([
        d.page_content for d in docs
    ])

    return {
        "input": user_input,
        "context": context
    }

def generate_gherkin(state: AgentState):

    level = state.get("detail_level", "standard")
    test_type = state.get("test_type", "fonctionnels")
    project_name = state.get("project_name") or state.get("input", "")

    level_instructions = DETAIL_LEVEL_INSTRUCTIONS.get(
        level, DETAIL_LEVEL_INSTRUCTIONS["standard"]
    )
    type_instructions = TEST_TYPE_INSTRUCTIONS.get(
        test_type, TEST_TYPE_INSTRUCTIONS["fonctionnels"]
    )

    prompt = f"""
    Tu es un expert QA.

    Génère des scénarios Gherkin (Given/When/Then) pour le projet
    suivant, en t'appuyant sur les extraits de spécifications fournis.

    RÈGLES IMPORTANTES DE FORMAT (à respecter STRICTEMENT) :
    - Utilise IMPÉRATIVEMENT les mots-clés Gherkin EN ANGLAIS :
      Feature, Background, Scenario, Scenario Outline, Examples,
      Given, When, Then, And, But.
    - UNE SEULE ligne "Feature:" dans toute la réponse. Si le projet
      couvre plusieurs sujets, regroupe-les sous une Feature unique
      dont le titre est le nom du projet. JAMAIS plusieurs "Feature:"
      dans la même réponse.
    - INTERDIT : séparateurs horizontaux ("---", "***", "___") ou
      titres markdown (#, ##) entre les scénarios. Tu produis du
      Gherkin pur, pas du markdown structuré.
    - Chaque scénario DOIT commencer EXACTEMENT par "Scenario: " (avec
      les deux-points et un espace) suivi du titre. Exemple :
        Scenario: Connexion réussie
      JAMAIS "Scenario Connexion réussie" sans deux-points.
      Idem pour "Scenario Outline: Titre", "Feature: Titre",
      "Background:", "Examples:".
    - Les tags (@perf, @critical, etc.) doivent être placés sur la
      ligne JUSTE AVANT "Scenario:", JAMAIS après. Exemple :
        @perf @critical
        Scenario: Titre
          Given ...
    - Le contenu (titres, descriptions, étapes) peut être en français.
    - Ne mets PAS de bloc markdown ```gherkin ... ``` autour du résultat,
      renvoie le Gherkin brut directement.

    RÈGLES BDD (qualité des scénarios) :
    - Chaque "Scenario:" doit être AUTO-SUFFISANT : il commence
      IMPÉRATIVEMENT par au moins un "Given" qui pose le contexte
      initial, MÊME SI ce contexte est partagé par plusieurs scénarios.
      Ne factorise JAMAIS les pré-conditions dans un "Background:"
      séparé.
    - INTERDIT : la section "Background:" est interdite. Chaque
      scénario doit pouvoir être exécuté indépendamment des autres et
      être converti en script Playwright autonome — sans cela, le
      contexte initial est perdu lors de la génération du script.
    - Chaque "Scenario:" ne décrit QU'UN SEUL comportement. Structure
      attendue : UN OU PLUSIEURS Given (contexte), UN SEUL When
      (éventuellement étendu par "And"), puis UN OU PLUSIEURS Then
      (étendus par "And").
    - INTERDIT : enchaîner plusieurs cycles When → Then dans le même
      scénario (When → Then → When → Then → When → Then). Si tu
      ressens le besoin de tester plusieurs entrées / variantes :
        * Soit tu écris PLUSIEURS scénarios distincts (un par variante),
          chacun avec son propre couple When/Then.
        * Soit tu utilises UN "Scenario Outline:" avec une table
          "Examples:" qui paramètre la valeur d'entrée et la sortie
          attendue. Exemple :
            Scenario Outline: Validation du format email
              Given je suis sur le formulaire de candidature
              When je saisis "<email>" dans le champ "Courriel"
              And je clique sur "Envoyer ma candidature"
              Then je vois "<message>"
              Examples:
                | email                  | message                          |
                | jeandupont             | Format d'email invalide          |
                | jeandupont@test        | Format d'email invalide          |
                | jeandupont@test.fr     | (aucun message)                  |
    - Un scénario qui tient en 5-8 steps reste préférable à un
      mégascénario qui valide 3 variantes d'affilée.

    PROJET : {project_name}

    {type_instructions}

    {level_instructions}

    CONTEXTE (extraits issus du RAG, recherchés à partir du nom du projet) :
    {state.get("context", "")}

    Réponds uniquement en Gherkin, en respectant strictement le TYPE de
    tests et le NIVEAU de détail demandés ci-dessus. Si le contexte RAG
    semble pauvre ou non pertinent, base-toi sur ta connaissance générale
    en QA pour générer des cas plausibles autour de "{project_name}".
    """

    try:
        response = llm.invoke(prompt)
    except Exception as exc:  # noqa: BLE001
        # On loggue précisément l'erreur côté backend, et on renvoie un
        # texte explicite côté client plutôt que de planter le graph.
        print(
            f"[gherkin_agent] ECHEC LLM (project={project_name!r}, "
            f"type={test_type}, level={level}) : {exc}"
        )
        return {
            "output": (
                f"# Erreur LLM : {exc}\n"
                "# (consultez les logs uvicorn pour le détail)\n"
            )
        }

    content = response.content or ""
    # Indice utile : si la réponse est suspectement courte ou se finit
    # sans un step typique, c'est probablement une troncature.
    stripped = content.rstrip()
    likely_truncated = (
        not stripped
        or not stripped.endswith((".", "\"", "|", ":"))
        and len(stripped) < 200
    )
    print(
        f"[gherkin_agent] LLM RESPONSE (project={project_name!r}, "
        f"type={test_type}, level={level}) — "
        f"{len(content)} chars"
        f"{' ⚠️  RÉPONSE SUSPECTE (probable troncature)' if likely_truncated else ''}"
    )
    print(content[:200].replace("\n", " | "), "...")

    return {"output": content}


graph = StateGraph(AgentState)

graph.add_node("retrieve", retrieve_node)
graph.add_node("generate", generate_gherkin)

graph.set_entry_point("retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

app_graph = graph.compile()
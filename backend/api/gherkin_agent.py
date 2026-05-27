from typing import TypedDict

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

from api.rag.retriever import retrieve_context
from api.rag.vector_store import get_retriever

import os
from dotenv import load_dotenv
load_dotenv() ## loading all the environment variable

os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")

llm = ChatOpenAI(model="gpt-5-nano")

class AgentState(TypedDict, total=False):
    input: str
    context: str
    output: str
    detail_level: str  # "standard" | "avance" | "expert"


# Consignes spécifiques par niveau de détail. Le LLM les reçoit
# inline dans le prompt, en plus de la spécification et du contexte RAG.
DETAIL_LEVEL_INSTRUCTIONS = {
    "standard": (
        "Niveau de détail attendu : STANDARD.\n"
        "- Génère entre 5 et 8 scénarios.\n"
        "- Couvre les chemins nominaux (happy paths) et les cas d'usage "
        "principaux.\n"
        "- Pas de tags Gherkin avancés, pas de Scenario Outline, pas de "
        "Background sauf nécessité évidente.\n"
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
        "- Tu peux utiliser un Background si plusieurs scénarios partagent "
        "le même contexte initial."
    ),
    "expert": (
        "Niveau de détail attendu : EXPERT QA.\n"
        "- Génère une couverture exhaustive : 15 à 25 scénarios.\n"
        "- Couvre : chemins nominaux et alternatifs, cas d'erreur (avec "
        "messages et codes retour attendus), valeurs limites et "
        "équivalence partitionnée, scénarios de sécurité (autorisation, "
        "injection, accès interdit), cas de performance ou de charge si "
        "pertinent.\n"
        "- Utilise des Scenario Outline + Examples pour les cas "
        "data-driven (paramétrage par jeu de données).\n"
        "- Utilise des tags riches : @smoke, @regression, @security, "
        "@perf, @edge, @critical selon le scénario.\n"
        "- Utilise un Background pour factoriser les pré-conditions "
        "partagées.\n"
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
    level_instructions = DETAIL_LEVEL_INSTRUCTIONS.get(
        level, DETAIL_LEVEL_INSTRUCTIONS["standard"]
    )

    prompt = f"""
    Tu es un expert QA.

    Génère des scénarios Gherkin (Given/When/Then)
    à partir des spécifications suivantes.

    {level_instructions}

    CONTEXTE (extraits issus du RAG) :
    {state.get("context", "")}

    SPÉCIFICATION DE L'UTILISATEUR :
    {state.get("input", "")}

    Réponds uniquement en Gherkin, en respectant strictement le niveau
    de détail demandé ci-dessus.
    """

    response = llm.invoke(prompt)
    print(f"LLM RESPONSE (level={level}) =", response.content[:200], "...")
    return {"output": response.content}


graph = StateGraph(AgentState)

graph.add_node("retrieve", retrieve_node)
graph.add_node("generate", generate_gherkin)

graph.set_entry_point("retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

app_graph = graph.compile()
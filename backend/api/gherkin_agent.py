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
    prompt = f"""
    Tu es un expert QA.

    Génère des scénarios Gherkin (Given/When/Then)
    à partir des spécifications suivantes :

    CONTEXTE:
    {state.get("context", "")}

    INPUT:
    {state.get("input", "")}

    Répond uniquement en Gherkin.
    """

    response = llm.invoke(prompt)
    print("LLM RESPONSE =", response.content)
    return {"output": response.content}


graph = StateGraph(AgentState)

graph.add_node("retrieve", retrieve_node)
graph.add_node("generate", generate_gherkin)

graph.set_entry_point("retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

app_graph = graph.compile()
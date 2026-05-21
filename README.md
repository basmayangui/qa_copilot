# EXPERSI QA Copilot

![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![Node 20](https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white)
![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-0.3-1C3C3C?logo=langchain&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-0.2-FF6F00)
![Chroma](https://img.shields.io/badge/Chroma-0.5-FF6B6B)
![OpenAI](https://img.shields.io/badge/OpenAI-API-412991?logo=openai&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-lightgrey)

Copilote IA de Quality Assurance — génère automatiquement des cas de tests Gherkin, des scripts d'automatisation et des analyses d'anomalies à partir de vos spécifications fonctionnelles, en s'appuyant sur un moteur RAG local.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Lancement](#lancement)
- [API backend](#api-backend)
- [Pipeline RAG](#pipeline-rag)
- [Développement](#développement)
- [Roadmap](#roadmap)

---

## Fonctionnalités

**Disponibles**

- **Génération de cas de tests Gherkin** à partir d'une spécification libre, enrichis par les documents indexés (RAG).
- **Ajout de spécifications** via une interface drag & drop. Chaque upload déclenche la reconstruction complète du RAG.
- **Historique des spécifications** persistant côté backend (lecture depuis `uploaded_docs/`).
- **Suppression de spécifications** avec reconstruction automatique du RAG.
- **Assistant IA conversationnel** (chat flottant) connecté au RAG, accessible depuis toutes les pages.
- **Détection automatique des fichiers ajoutés à la main** dans `uploaded_docs/` au démarrage et toutes les 30 s (configurable).
- **Sidebar dynamique** avec route active et navigation rapide vers la home via le logo.

**À venir** (cf. [Roadmap](#roadmap))

- Génération de scripts Playwright / Cypress / Selenium
- Campagnes de tests
- Exécution de scripts et tableaux de rapports
- Analyse IA des anomalies
- Streaming des réponses LLM

---

## Stack technique

| Couche   | Choix                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Frontend | Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS v3 · lucide-react · axios |
| Backend  | FastAPI · LangGraph · LangChain · OpenAI                                                 |
| RAG      | Chroma (persistant local) + OpenAI Embeddings + `RecursiveCharacterTextSplitter`         |
| Loaders  | `PyPDFLoader` · `Docx2txtLoader` · `TextLoader`                                          |
| Langage  | Python 3.11 · Node 20                                                                    |

---

## Architecture

```
qa_copilot/
├── backend/
│   ├── api/
│   │   ├── main.py                 # FastAPI app, lifespan, endpoints
│   │   ├── gherkin_agent.py        # Graphe LangGraph retrieve -> generate
│   │   └── rag/
│   │       ├── vector_store.py     # Chroma, rebuild_rag, ensure_rag_ready
│   │       ├── loaders.py          # Routeur PDF/DOCX/TXT
│   │       ├── retriever.py        # Wrapper retrieve_context
│   │       └── ingest.py
│   ├── uploaded_docs/              # Documents source (versionné: non)
│   ├── chroma_db/                  # Index vectoriel (versionné: non)
│   ├── requirements.txt
│   └── .env                        # OPENAI_API_KEY (versionné: non)
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx              # Layout racine, monte Sidebar + ChatPanel
│   │   ├── page.tsx                # Landing page
│   │   ├── test-cases/page.tsx     # Génération Gherkin
│   │   ├── specifications/page.tsx # Upload + historique
│   │   └── ...
│   ├── components/
│   │   ├── Sidebar.tsx             # Navigation + logo cliquable
│   │   └── ChatPanel.tsx           # Chat IA flottant
│   ├── public/
│   └── package.json
│
└── README.md
```

**Flux RAG**

```
Upload PDF/DOCX/TXT
   -> sauvegarde dans uploaded_docs/
   -> rebuild_rag()
        -> shutil.rmtree(chroma_db/)
        -> relecture de tous les fichiers
        -> chunking (1000 chars / 200 overlap)
        -> embeddings OpenAI
        -> réindexation Chroma (collection "expersi_qa")
        -> écriture du manifeste {fichier: mtime}
   -> LangGraph utilise immédiatement l'index courant
```

---

## Prérequis

- **Python 3.11** (l'écosystème LangChain n'est pas encore parfaitement stable sur 3.13)
- **Node 20** (gestion via `nvm` recommandée)
- **Clé OpenAI API** valide
- (macOS) `conda` / `miniconda` pour isoler l'environnement Python

---

## Installation

### 1. Cloner et préparer l'environnement Python

```bash
git clone <url-du-repo> qa_copilot
cd qa_copilot/backend

conda create -n qacopilot_env python=3.11 -y
conda activate qacopilot_env

pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

### 2. Installer les dépendances frontend

```bash
cd ../frontend
nvm use 20    # ou nvm install 20 si non installé
npm install
```

---

## Configuration

### Backend — `backend/.env`

Créer le fichier `backend/.env` :

```env
OPENAI_API_KEY=sk-...

# Optionnel — intervalle (en secondes) entre deux scans automatiques de uploaded_docs/
RAG_WATCH_INTERVAL_SEC=30
```

### Frontend — `frontend/.env.local` (optionnel)

Par défaut, le frontend appelle `http://localhost:8000`. Pour pointer ailleurs :

```env
NEXT_PUBLIC_API_BASE=https://api.exemple.com
```

---

## Lancement

### Backend

Depuis `backend/` avec l'env Conda activé :

```bash
python -m uvicorn api.main:app --reload --port 8000
```

Au démarrage, vous verrez dans les logs :

```
[startup] uploaded_docs/ vide — aucun RAG à construire.
        # ou
[startup] Documents détectés sans index — reconstruction du RAG...
RAG reconstruit
[watcher] démarré (intervalle = 30s)
INFO:     Application startup complete.
```

### Frontend

Depuis `frontend/` :

```bash
npm run dev
```

L'application est accessible sur **http://localhost:3000**.

---

## API backend

| Méthode  | Endpoint                     | Description                                                                            |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/`                          | Healthcheck (`{"message": "EXPERSI QA Copilot API running"}`)                          |
| `POST`   | `/generate`                  | Génère des scénarios Gherkin à partir d'un texte libre. Utilise le RAG comme contexte. |
| `POST`   | `/upload-specification`      | Upload un fichier (PDF/DOCX/TXT) et reconstruit le RAG.                                |
| `GET`    | `/specifications`            | Liste les fichiers actuellement indexés (`[{name, size, uploaded_at}]`).               |
| `DELETE` | `/specifications/{filename}` | Supprime un fichier et reconstruit le RAG.                                             |
| `POST`   | `/chat`                      | Conversation libre avec l'assistant IA, ancré sur le RAG.                              |
| `POST`   | `/ingest`                    | Ingestion brute d'un texte dans la base vectorielle (legacy).                          |

**Documentation Swagger interactive** : http://localhost:8000/docs

---

## Pipeline RAG

### Chunking

`RecursiveCharacterTextSplitter` avec `chunk_size=1000` (caractères) et `chunk_overlap=200`. Le splitter tente les séparateurs dans l'ordre `["\n\n", "\n", " ", ""]` pour préserver paragraphes et phrases.

### Embeddings

`OpenAIEmbeddings()` (modèle par défaut `text-embedding-ada-002`, 1536 dimensions). Pour passer au modèle moderne :

```python
embedding_model = OpenAIEmbeddings(model="text-embedding-3-small")
```

et supprimer `chroma_db/` pour reconstruire avec les nouveaux vecteurs.

### Retrieval

Recherche par similarité top-`k=4` via `vectordb.as_retriever()`. Pas de MMR, pas de reranking, pas de hybrid search dans la V1.

### Persistance

Chroma stocke l'index dans `backend/chroma_db/` (SQLite + HNSW). La collection se nomme `expersi_qa`.

### Détection des changements

Un fichier `chroma_db/.manifest.json` contient un snapshot `{filename: mtime}` du contenu indexé. Au démarrage et toutes les `RAG_WATCH_INTERVAL_SEC` secondes, on compare le contenu de `uploaded_docs/` au manifeste :

- **Aucun changement** → rien à faire.
- **Ajout / suppression / modification détectée** → `rebuild_rag()` complet.

Ce mécanisme couvre les ajouts de fichiers à la main, sans passer par l'API.

---

## Développement

### Hot reload

Les deux serveurs supportent le rechargement à chaud :

- Backend : `--reload` d'uvicorn redémarre à chaque modif Python.
- Frontend : Next.js HMR sur tous les `.tsx` / `.ts` / `.css`.

### Branche de travail

```bash
git checkout -b feat/<sujet>
# ...
git add .
git commit -m "feat: <description>"
git push -u origin feat/<sujet>
```

### Linter / format

```bash
# Frontend
cd frontend
npm run lint

# Backend (à ajouter)
pip install ruff black
ruff check api/
black api/
```

### Ne pas versionner

Déjà couvert par `.gitignore` :

```
backend/chroma_db/
backend/uploaded_docs/
backend/.env
backend/__pycache__/
frontend/node_modules/
frontend/.next/
.DS_Store
**/.DS_Store
```

---

## Roadmap

**Court terme**

- Génération de scripts Playwright / Cypress / Selenium à partir des cas Gherkin.
- Streaming SSE des réponses LLM pour une UX type ChatGPT.
- Citations des sources RAG dans les réponses du chat et de Gherkin.
- Authentification utilisateur.

**Moyen terme**

- Campagnes de tests (groupement, planification, exécution).
- Tableaux de rapports avec métriques de couverture.
- Multi-projets (cloisonnement par collection Chroma).
- Reranking (Cohere Rerank ou cross-encoder).
- Hybrid search (BM25 + dense via `EnsembleRetriever`).

**Long terme**

- Multi-agents : `Gherkin Agent`, `Test Script Agent`, `Bug Analysis Agent`, `Coverage Agent`.
- Analyse IA des anomalies à partir de logs d'exécution.
- Intégration CI/CD (GitHub Actions, GitLab CI).

---

## Licence

Propriétaire EXPERSI — usage interne.

---

## Contact

Pour toute question : équipe QA Copilot — EXPERSI.

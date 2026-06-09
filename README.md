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

Copilote IA d'Assurance Qualité — génère automatiquement des cas de tests Gherkin, des scripts d'automatisation et des analyses d'anomalies à partir des spécifications fonctionnelles, en s'appuyant sur un moteur RAG local.

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

**Flux RAG** (incrémental)

```
Upload PDF/DOCX/TXT
   -> sauvegarde dans uploaded_docs/
   -> add_file_to_index(fichier)
        -> suppression d'éventuels chunks précédents (re-upload safe)
        -> chargement + chunking du fichier (1000 chars / 200 overlap)
        -> embeddings HuggingFace (local) + ajout à Chroma existant
        -> mise à jour du manifeste pour ce fichier
   -> LangGraph utilise immédiatement l'index enrichi

Suppression d'un fichier
   -> remove_file_from_index(fichier)
        -> delete des chunks où metadata.source_filename == fichier
        -> mise à jour du manifeste
   -> Aucun rebuild complet, le reste de l'index est intact
```

Un **rebuild COMPLET** (wipe + réindex parallélisé en Phase 1 / chunking / batches d'embedding) n'est déclenché que dans trois cas :

- Changement de `RAG_EMBED_MODEL` (les vecteurs existants deviennent incompatibles)
- Premier démarrage sans index
- Index Chroma physiquement absent ou corrompu

Au démarrage normal, le bootstrap compare le manifeste sauvegardé au contenu réel de `uploaded_docs/` et applique uniquement les **diffs** (ajouts / suppressions / modifications) de façon incrémentale.

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
git clone https://github.com/basmayangui/qa_copilot.git qa_copilot
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
# --- LLM (chat + génération Gherkin + scripts Playwright) ---
LLM_PROVIDER=mistral
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_API_KEY=<clé-mistral>
LLM_MODEL=mistral-small-latest
# Optionnels :
# LLM_TEMPERATURE=0.4
# LLM_MAX_TOKENS=8000

# --- Embeddings (pipeline RAG) — modèle local HuggingFace ---
# Calcul des embeddings 100 % en local via sentence-transformers.
# Aucune donnée ne quitte le serveur QA Copilot.
RAG_EMBED_PROVIDER=huggingface
RAG_EMBED_MODEL=BAAI/bge-m3
RAG_EMBED_DEVICE=cpu          # "cuda" si GPU NVIDIA disponible
RAG_EMBED_NORMALIZE=true

# --- Performance du pipeline RAG (optionnels) ---
RAG_EMBED_BATCH_SIZE=64
RAG_EMBED_BATCH_PAUSE_SEC=0
RAG_LOAD_MAX_WORKERS=8
RAG_WATCH_INTERVAL_SEC=10
```

**Note** : un changement de `RAG_EMBED_MODEL` est détecté automatiquement (le nom du modèle est inclus dans `chroma_db/.manifest.json`) et déclenche un rebuild complet au prochain démarrage. Indispensable si on change de fournisseur, car les vecteurs n'ont pas la même dimension d'un modèle à l'autre.

#### Souveraineté du LLM

Le projet est conçu pour être déployé en environnement **souverain**. Le module `api/llm_client.py` centralise l'instanciation du LLM : il suffit de pointer `LLM_BASE_URL` vers un endpoint Mistral hébergé en UE (typiquement OVH AI Endpoints).

- **OVH AI Endpoints** sert des modèles Mistral (Apache 2.0) depuis des datacenters européens. Pas de Cloud Act US. Recours juridique en France en cas de litige.
- L'application n'est pas couplée à un fournisseur précis : tout endpoint qui respecte le format de l'API conventionnel des LLM (Mistral via OVH, vLLM auto-hébergé, etc.) fonctionne sans modification de code.

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

Le module `api/embeddings_client.py` centralise la création du client d'embeddings à partir des variables d'environnement. Deux familles de providers sont supportées :

1. **`huggingface`** (défaut recommandé pour la souveraineté maximale) : modèles **locaux** chargés via `sentence-transformers`. Aucune donnée ne quitte le serveur, compatible air-gap une fois le modèle téléchargé. Modèle recommandé : **`BAAI/bge-m3`** (multilingue, dimension 1024, licence MIT).

2. **Endpoint compatible OpenAI** : utile pour rester sur un service cloud souverain UE (Mistral via `api.mistral.ai`, OVH AI Endpoints, vLLM auto-hébergé). Variables : `RAG_EMBED_BASE_URL`, `RAG_EMBED_API_KEY`, `RAG_EMBED_MODEL`.

Le mode est sélectionné par `RAG_EMBED_PROVIDER`. En mode HuggingFace, `RAG_EMBED_DEVICE` (`cpu`/`cuda`) et `RAG_EMBED_NORMALIZE` (`true`/`false`) permettent de piloter le calcul local.

Le nom du modèle est inclus dans `chroma_db/.manifest.json` : tout changement déclenche un rebuild complet automatique au prochain démarrage, sans intervention manuelle. Indispensable lors d'un changement de fournisseur ou de modèle, car la dimension vectorielle varie (1024 pour `bge-m3` et `mistral-embed`, 768 pour `e5-base`, etc.).

### Chargement des PDF

`PyPDFium2Loader` (basé sur Google PDFium, en C++) est utilisé à la place de `PyPDFLoader` (pypdf, Python pur). C'est **3-5× plus rapide** sur les gros corpus, avec la même API et le même format de métadonnées.

La Phase 1 (parsing) est en plus parallélisée via `ProcessPoolExecutor` — pas `ThreadPoolExecutor` — pour contourner le GIL Python : pypdfium2 reste partiellement CPU-bound côté Python. Le nombre de workers est piloté par `RAG_LOAD_MAX_WORKERS` (défaut : `cpu_count() - 1`).

### Retrieval

Quand l'utilisateur pose une question, on transforme cette question en vecteur, puis on demande à Chroma les **4 morceaux de texte les plus proches** (les plus ressemblants au sens du modèle). Ces 4 extraits sont ensuite injectés dans le prompt du LLM comme contexte pour qu'il puisse répondre en s'appuyant sur les spécifications.

En V1, on s'arrête à cette recherche simple : pas de diversification des résultats (MMR), pas de re-classement par un second modèle (reranking), pas de combinaison avec une recherche par mots-clés (hybrid search). C'est volontairement minimaliste — ça suffit pour des spécifications fonctionnelles bien rédigées.

### Persistance

Tout l'index vectoriel vit dans le dossier **`backend/chroma_db/`**, sur le disque local. Concrètement, c'est une petite base SQLite (pour les métadonnées) accompagnée d'un index HNSW (pour la recherche rapide entre vecteurs). Les documents sont regroupés dans une collection unique appelée **`expersi_qa`**.

L'intérêt : tant que ce dossier existe, le RAG est disponible immédiatement au redémarrage du backend, sans avoir à ré-embedder les fichiers. Si on supprime le dossier, il sera reconstruit automatiquement au prochain démarrage à partir des fichiers présents dans `uploaded_docs/`.

### Indexation incrémentale

Chaque chunk indexé porte une métadonnée `source_filename`. Cela permet d'ajouter ou de retirer un fichier de l'index sans toucher au reste :

- **Upload via l'API** → `add_file_to_index(fichier)` : charge ce seul fichier, l'embedde, l'ajoute à Chroma. Si une version précédente existait, ses chunks sont supprimés d'abord (re-upload safe).
- **Suppression via l'API** → `remove_file_from_index(fichier)` : `delete(where={"source_filename": fichier})` sur la collection Chroma, puis mise à jour du manifeste.

Un **rebuild complet** ne reste utile que pour : changement du modèle d'embedding, premier démarrage, ou index physiquement absent.

### Détection des changements disque

Un fichier `chroma_db/.manifest.json` contient `{embed_model, files: {filename: mtime}}`. Au démarrage et toutes les `RAG_WATCH_INTERVAL_SEC` secondes, on compare ce manifeste au contenu réel de `uploaded_docs/` :

- **Aucun changement** → rien à faire.
- **Diff (ajouts / suppressions / modifs)** → on applique les diffs de manière **incrémentale** (un `add_file_to_index` ou `remove_file_from_index` par fichier concerné), pas de rebuild complet.
- **Modèle d'embedding changé** → rebuild COMPLET (les vecteurs ne sont plus compatibles).

Ce mécanisme couvre les ajouts de fichiers à la main dans `uploaded_docs/`, sans passer par l'API.

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
- Citations des sources RAG dans les réponses du chat et de Gherkin.

**Moyen terme**

- Campagnes de tests (groupement, planification, exécution).
- Tableaux de rapports avec métriques de couverture.
- Multi-projets (cloisonnement par collection Chroma).
- Authentification utilisateur.

**Long terme**

- Analyse IA des anomalies à partir de logs d'exécution.
- Intégration CI/CD (GitHub Actions, GitLab CI).

---

## Licence

Propriétaire EXPERSI — usage interne.

---

## Contact

Pour toute question : équipe QA Copilot — EXPERSI.

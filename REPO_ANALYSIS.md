# Repo Analysis: `d:\fastapi`

_Read-only analysis. No existing files were modified; this file is the only addition._

## 1. What this project is

An early-stage, work-in-progress **"Agentic RAG" backend** built with **FastAPI + LangChain + Google Gemini**. The long-term goal (from comments and the home-route text) is a pipeline like:

```
User query
   -> Query Translation Hub (4 parallel LLM calls: A, B, C, D)
   -> Query Routing (choose auth-db / vector-store / S3)
   -> Retrieval from data stores
   -> Final generation (an "expensive" LLM, "Call F")
```

Right now, **only a plain single-LLM Q&A endpoint is live**. The translation hub, routing, retrieval and generation stages are not implemented (or are commented out).

## 2. Layout

```
d:\fastapi
├── .env                         # holds GOOGLE_API_KEY (secret, not read into this doc)
├── venv\                        # Python 3.12.10 virtualenv (not part of source)
└── app\
    ├── main.py                  # FastAPI app + routes
    ├── core\
    │   └── query_translation.py # 4 query-transformation LLM helpers
    ├── data_stores\             # EMPTY (planned: vector store / DB / S3)
    ├── models\                  # EMPTY (planned: schemas/models)
    └── pipelines\               # EMPTY (planned: routing / RAG pipelines)
```

Notes:
- Only **2 source files** contain code. No `__init__.py` files (works via namespace packages), no `requirements.txt`/`pyproject.toml`, no README, no tests, no `.gitignore`, and it is **not a git repo**.
- `venv` contains: `fastapi`, `uvicorn`, `pydantic`, `langchain` (+ `langchain_classic`, `langchain_core`, `langchain_community`), `langchain_google_genai`, `langchain_openai`, `langgraph`, `openai`, `tiktoken`, `sqlalchemy`, `numpy`, `python-dotenv`, `aiohttp`, `httpx`, etc. This hints at planned use of LangGraph (agents), SQLAlchemy (auth DB), and OpenAI as an alternative provider — none used in code yet.

## 3. File-by-file

### `app/main.py` (140 lines, mostly commented-out history)
The file is layered: old iterations are kept as commented blocks, then **three live-code sections** stack on top of each other.

| Lines | State | Content |
|---|---|---|
| 1–24 | commented | v1: OpenAI (`gpt-4o-mini`) 4-call `/query` using `dict` payload |
| 26–46 | **live** | `FastAPI(title="...Gemini Free - Translation Hub")`, `QueryRequest` model, `GET /` returning a status message. Imports the four `llm_call_*` functions from `query_translation` |
| 48–70 | commented | v2: `/query` calling all four translation functions (sequentially, despite the "parallel" comment) |
| 73–91 | commented | v3: simple `/query` using `llm.invoke` |
| 94–140 | **live** | Re-imports, **creates a second `app = FastAPI(title="Agentic RAG - Simple Q&A")`**, redefines `QueryRequest`, builds `ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", temperature=0.2)`, defines `GET /` and `POST /query` |

**Effective runtime behavior:** because the second `app = FastAPI(...)` overwrites the first, the served app is "Simple Q&A":
- `GET /` -> `{"status": "Simple Q&A Ready - Go to POST /query"}`
- `POST /query` body `{"query": "..."}` -> sends `"Answer this clearly and concisely: {query}"` to Gemini, returns `{"your_question", "answer"}`; on any exception returns `{"your_question", "error"}` with **HTTP 200**.

The first `GET /` route (line 40) was registered on the discarded first `app`, so it is dead code.

### `app/core/query_translation.py` (156 lines, first ~105 commented)
Implements the "Query Translation Hub" — four prompt variants over one shared cheap LLM (`llm_cheap`), differentiated **only by prompt**:

| Function | Technique | Prompt intent |
|---|---|---|
| `llm_call_A_step_back` | Step-back prompting (more abstraction) | One abstract, high-level question |
| `llm_call_B_rewrite` | Query rewriting | 3 alternative phrasings for vector search |
| `llm_call_C_decompose` | Decomposition (less abstraction) | 2–3 sub-questions |
| `llm_call_D_hyde` | HyDE | 3-line hypothetical answer paragraph for embedding search |

Each wraps `llm_cheap.invoke(prompt).content` in try/except and returns `"ERROR: ..."` as a string on failure. Module-level code loads `.env`, prints a debug line with the first 10 chars of the API key, and raises `ValueError` if `GOOGLE_API_KEY` is missing. Earlier commented versions show the intent of a second, more capable `llm_expensive` (Gemini Pro) for final generation.

### `.env`
Single variable: `GOOGLE_API_KEY`. (Value deliberately not reproduced here.)

## 4. How the pieces connect

- `main.py` imports `query_translation` at import time (line 28), so **importing `app.main` executes the module-level code in `query_translation.py`**: loads `.env`, prints key prefix, constructs `llm_cheap`. If the key is missing the app fails to start.
- The imported translation functions are currently **unused** by any live route.
- Two separate `ChatGoogleGenerativeAI` instances exist (`llm_cheap` in core, `llm` in main) with different model names.

## 5. Issues and risks observed

1. **Duplicate app definition** – `app` and `QueryRequest` are defined twice in `main.py`; the first (translation hub) is silently discarded. Confusing and easy to break.
2. **Translation hub not wired up** – the 4-call `/query` endpoint is commented out; the live `/query` bypasses it.
3. **Secret leakage in logs** – `query_translation.py:114` prints the first 10 characters of `GOOGLE_API_KEY` on every import. Remove it.
4. **Questionable model names** – `gemini-3.8-flash` (core, line 121) and `gemini-3.5-flash-lite` (main, line 109) differ from each other, and the inline comment says "Changed from 1.5-flash to 2.0-flash", which doesn't match the value. I can't verify either exists; a wrong name would show up as runtime API errors. Worth confirming against Google's current model list.
5. **Misleading text** – home message says "Gemini 1.5 Flash" and comments claim calls are "parallel" and "FREE"; the code is sequential and model names differ.
6. **Error handling** – failures return HTTP 200 with an `error` field (main), or an `"ERROR: ..."` string that looks like valid content (core). Could leak internal error details to clients; better to raise `HTTPException`.
7. **Blocking sync endpoints** – `llm.invoke` is synchronous. In plain `def` routes FastAPI runs them in a threadpool, so it works, but true parallel A–D calls would need `ainvoke` + `asyncio.gather` or `RunnableParallel`.
8. **Project hygiene** – no dependency manifest, no `.gitignore` (so `.env` and `venv` would be committed if git is initialized), no tests, no README, no `__init__.py`, empty placeholder packages.
9. **Large commented-out code** – roughly two-thirds of both files is dead history; version control would be a cleaner place for it.

## 6. How to run (inferred, not executed)

```powershell
cd D:\fastapi
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
# then POST http://127.0.0.1:8000/query  {"query": "What is TDZ in JavaScript?"}
# interactive docs at http://127.0.0.1:8000/docs
```

Requires a valid `GOOGLE_API_KEY` in `.env` and network access to Google's API.

## 7. Likely roadmap (inferred from comments and empty folders)

1. Re-enable `/query` using the four translation calls (ideally in parallel).
2. **Query routing** (Step 4): decide between auth-db, vector store, or S3.
3. Fill `data_stores/` (vector DB, SQL via SQLAlchemy, S3), `models/` (Pydantic/ORM schemas), `pipelines/` (RAG/LangGraph flows).
4. Final answer generation with a stronger model ("Call F").

## 8. Suggested first cleanups (not applied)

- Keep a single `app`/`QueryRequest` in `main.py`; delete commented history.
- Remove the API-key debug print.
- Centralize LLM construction and model names in config (env vars).
- Add `requirements.txt`, `.gitignore` (`venv/`, `.env`, `__pycache__/`), and a README.
- Return proper HTTP errors; add a basic test for `GET /`.

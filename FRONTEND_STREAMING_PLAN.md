# Plan: Frontend + Streaming AI Replies

_Plan only. No existing file has been edited; this is the only file added._

## Goal
A simple chat page in the browser where you type a question, and the Gemini answer appears **token by token** as it is generated, instead of waiting for the full reply.

## Key decisions (and why)

| Decision | Why |
|---|---|
| **Plain HTML + CSS + vanilla JS**, no React/build step | The app is tiny. No Node, no bundler, nothing to install. Easy to read and learn from. |
| **Serve the frontend from FastAPI itself** (`StaticFiles`) | Same origin as the API, so **no CORS setup**, one command (`uvicorn`) runs everything. |
| **Streaming over HTTP using Server-Sent Events (SSE) format** (`text/event-stream`) | One-way server -> browser text stream is exactly what SSE is for. Simpler than WebSockets, works through normal HTTP. |
| **Browser uses `fetch()` + `ReadableStream`, not `EventSource`** | `EventSource` only supports GET. We want to POST the question in a JSON body (matches the existing `/query` style and avoids long text in URLs). |
| **New endpoint `POST /query/stream`; keep `POST /query`** | Non-breaking: the old endpoint still works for curl/tests. |
| **LangChain `llm.stream(...)`** | `ChatGoogleGenerativeAI` already supports streaming; it yields message chunks as Gemini produces them. No new dependency. |

## Files to add / change

```
d:\fastapi
└── app
    ├── main.py                  # CHANGE (small): new stream route + static mount
    └── static
        ├── index.html           # NEW: page structure
        ├── style.css            # NEW: look and feel
        └── app.js               # NEW: send question, read stream, render text
```

### 1. `app/main.py` — changes (backend)

**a) `from fastapi.responses import StreamingResponse` and `from fastapi.staticfiles import StaticFiles`**
- *Why:* `StreamingResponse` lets a route return data piece by piece as a generator instead of one finished body. `StaticFiles` serves the HTML/CSS/JS.

**b) `def sse_event(data: str, event: str | None = None) -> str`** (small helper)
- *What:* formats text as an SSE message: `event: ...\ndata: ...\n\n`. Newlines inside the text are split into multiple `data:` lines.
- *Why:* SSE requires this exact framing, and AI text contains newlines that would otherwise break the protocol. A helper keeps the route readable and avoids repeating formatting.

**c) `def token_stream(question: str)`** (generator)
- *What:* loops over `llm.stream(prompt)` and `yield`s `sse_event(chunk_text)` for each chunk. At the end yields a `done` event. Wrapped in `try/except` that yields an `error` event.
- *Why a generator:* `StreamingResponse` consumes it lazily, so each token is sent the moment it arrives.
- *Why `try/except` inside it:* once streaming has started, the HTTP status (200) is already sent and cannot change. The only way to tell the browser something failed is an in-stream `error` event.
- *Why extract chunk text carefully (`chunk.text` / `chunk.content`):* newer Gemini integrations can return content as a list of parts rather than a plain string, so I will normalize it to text and skip empty chunks.
- *Why a plain `def` (sync) generator rather than `async`:* `llm.stream` is blocking. FastAPI runs sync generators in a threadpool, so the server stays responsive. (Later upgrade option: `llm.astream` + `async def`, once we need many simultaneous users or parallel calls.)

**d) `@app.post("/query/stream")` -> `def handle_query_stream(req: QueryRequest)`**
- *What:* returns `StreamingResponse(token_stream(req.query), media_type="text/event-stream")` with headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- *Why those headers:* stop browsers/proxies from caching or buffering the stream, which would make text arrive in one lump instead of live.
- *Why reuse `QueryRequest`:* same input shape as `/query`; Pydantic validates it for free.

**e) `app.mount("/ui", StaticFiles(directory="app/static", html=True), name="ui")`**
- *Why:* serves `index.html` at `/ui/`. Mounted **after** API routes so it never shadows them. Using a path based on `__file__` (not a relative string) so it works regardless of where uvicorn is launched.

**f) Placement note — the duplicate `app`**
`main.py` currently creates `app` twice (lines 35 and 102); the second wins. New code must go **below line 102 and use that second `app`**, otherwise routes land on the discarded object. I recommend (but won't do without your OK) deleting the commented-out history and the first duplicate block so this can't bite again.

### 2. `app/static/index.html` — NEW
- *What:* a text area (or input) for the question, a Send button, a Stop button, and a `<div id="answer">` where the reply appears. Links `style.css` and `app.js`.
- *Why:* minimal structure; element `id`s are the hooks `app.js` uses.

### 3. `app/static/style.css` — NEW
- *What:* centered column layout, readable font, `white-space: pre-wrap` on the answer box, a subtle blinking cursor while streaming, disabled-button styling.
- *Why `pre-wrap`:* Gemini replies contain line breaks and lists; this preserves them without needing a Markdown library. (Optional later: render Markdown with a small library like `marked`.)

### 4. `app/static/app.js` — NEW (functions)

**`async function ask()`**
- *What:* reads the input, clears the answer box, creates an `AbortController`, `fetch("/query/stream", {method:"POST", body: JSON.stringify({query})})`, then reads `response.body.getReader()` in a loop, decoding with `TextDecoder`, passing text to `handleChunk`.
- *Why this way:* it is the standard way to consume a streamed POST body in the browser.

**`function handleChunk(text)`** (SSE parser)
- *What:* keeps a buffer, splits on the blank line (`\n\n`) that ends each SSE event, reads `event:` / `data:` lines, and dispatches: default -> append to answer; `done` -> finish; `error` -> show error.
- *Why a buffer:* network chunks don't align with event boundaries; an event can arrive split across two reads, so we only parse complete events.

**`function appendToAnswer(text)`**
- *What:* appends using `textContent` (never `innerHTML`).
- *Why:* the AI output is untrusted text; `textContent` prevents HTML/script injection (XSS).

**`function setBusy(isBusy)`**
- *What:* toggles Send/Stop buttons and the cursor animation.
- *Why:* prevents double submits and shows the user that something is happening.

**`function stop()`**
- *What:* calls `abortController.abort()`.
- *Why:* lets the user cancel a long answer; the server generator stops when the client disconnects.

**Event wiring:** Send click, and Enter to send (Shift+Enter for new line).
- *Why:* normal chat ergonomics.

## Request/response flow

```
Browser (app.js ask())
  POST /query/stream {"query": "..."}
        |
FastAPI handle_query_stream -> StreamingResponse(token_stream)
        |  llm.stream(prompt)  ->  Gemini
        v
  data: Hel\n\n   data: lo \n\n   data: world\n\n   event: done\n data: \n\n
        |
Browser reads chunks -> handleChunk -> appendToAnswer (live typing effect)
```

## Things to verify during implementation
1. That `llm.stream` actually yields multiple chunks with the installed `langchain_google_genai` and the configured model name (the model names in the repo are unverified — see REPO_ANALYSIS.md).
2. Chunk shape (`str` vs list of parts) and handle both.
3. Behavior when the API key is invalid or the model name is wrong: the browser should show a clear error message from the `error` event.
4. Test with `curl -N -X POST localhost:8000/query/stream -H "Content-Type: application/json" -d '{"query":"hi"}'` to see raw streaming before testing the UI.

## Out of scope (possible next steps)
- Chat history / multi-turn memory (needs sending previous messages to the model).
- Wiring in the 4-call query translation hub and showing its stages in the UI.
- Markdown rendering and code highlighting.
- Auth, rate limiting, and a proper config for model names / API key.

## Run
```powershell
cd D:\fastapi
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
# open http://127.0.0.1:8000/ui/
```

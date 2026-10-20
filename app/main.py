import logging
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field, field_validator

from app.core.prompts import SYSTEM_PROMPT

# Locally the key comes from .env; on Vercel it comes from the project's Environment Variables.
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / "public"

logger = logging.getLogger("app")

MAX_HISTORY = 20  # most recent messages kept per request; bounds token cost

app = FastAPI(title="Agentic RAG - Simple Q&A")

# Only needed if the frontend is hosted on a different origin, e.g. ALLOWED_ORIGINS=https://my-site.com
# (comma separated). Same-origin deploys (the default here) need no CORS.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["POST", "GET"], allow_headers=["*"])


class QueryRequest(BaseModel):
    # Cap input size so one request cannot burn through the paid API quota.
    query: str = Field(min_length=1, max_length=4000)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class ChatRequest(BaseModel):
    # The full recent conversation, oldest first. The server is stateless, so the browser sends the history.
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_HISTORY)

    @field_validator("messages")
    @classmethod
    def last_message_is_user_question(cls, v):
        if v[-1].role != "user" or len(v[-1].content) > 4000:
            raise ValueError("last message must be a user message of at most 4000 characters")
        return v


GENERIC_ERROR = "The AI service failed to answer. Please try again."


# One LLM - simple and fast. Model name is overridable without a code change.
llm = ChatGoogleGenerativeAI(
    model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    temperature=0.2,
    google_api_key=os.getenv("GOOGLE_API_KEY"),
)


def build_messages(history: list[ChatMessage]):
    # The system message sets behaviour; the rest is the conversation so far, which gives the model memory.
    messages = [SystemMessage(content=os.getenv("SYSTEM_PROMPT") or SYSTEM_PROMPT)]
    for m in history:
        messages.append(HumanMessage(content=m.content) if m.role == "user" else AIMessage(content=m.content))
    return messages


def sse_event(data: str, event: str | None = None) -> str:
    """Format text as one Server-Sent Event. Newlines must be split into separate `data:` lines."""
    head = f"event: {event}\n" if event else ""
    body = "".join(f"data: {line}\n" for line in data.split("\n"))
    return f"{head}{body}\n"


def chunk_text(chunk) -> str:
    """Gemini chunks may carry a plain string or a list of content parts; normalise to text."""
    content = chunk.content
    if isinstance(content, str):
        return content
    parts = []
    for part in content or []:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict) and part.get("type") == "text":
            parts.append(part.get("text", ""))
    return "".join(parts)


def token_stream(history: list[ChatMessage]):
    # Once streaming starts the HTTP status is already sent, so failures are reported as an in-stream event.
    try:
        for chunk in llm.stream(build_messages(history)):
            text = chunk_text(chunk)
            if text:
                yield sse_event(text)
        yield sse_event("", event="done")
    except Exception:
        logger.exception("stream failed")  # details stay in server logs, not sent to the browser
        yield sse_event(GENERIC_ERROR, event="error")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/query")
def handle_query(req: QueryRequest):
    try:
        answer = llm.invoke(build_messages([ChatMessage(role="user", content=req.query)])).text
        return {"your_question": req.query, "answer": answer}
    except Exception:
        logger.exception("query failed")
        raise HTTPException(status_code=502, detail=GENERIC_ERROR)


@app.post("/query/stream")
def handle_query_stream(req: ChatRequest):
    return StreamingResponse(
        token_stream(req.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


# Local dev: serve the frontend from /. On Vercel, files in public/ are served by the CDN instead.
# Mounted last so it never shadows the API routes.
if PUBLIC_DIR.exists():
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")

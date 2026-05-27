"""Co-Thinker FastAPI entry point."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load .env BEFORE any router/store import — store.py reads
# `os.getenv("COTHINKER_DB")` at module-init time to decide between
# SQLite and InMemorySessionStore. If load_dotenv runs after the routers
# imports (which transitively trigger store.py init), the env var is
# always None, and the app silently falls back to in-memory state — every
# backend restart loses every session. Order matters here.
_BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_BASE, "..", ".env"))

from routers.brief import router as brief_router
from routers.judge import router as judge_router
from routers.session import router as session_router
from routers.workshop import router as workshop_router


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("cothinker")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Co-Thinker backend starting on port %s", os.getenv("PORT", "8000"))
    yield
    log.info("Co-Thinker backend shutting down")


app = FastAPI(title="Co-Thinker", lifespan=lifespan)


def _allowed_origins() -> list[str]:
    """Comma-separated list from ALLOWED_ORIGINS, defaulting to local dev hosts."""
    raw = os.getenv("ALLOWED_ORIGINS", "")
    if raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Id"],
    expose_headers=["X-Session-Id"],
)

app.include_router(workshop_router)
app.include_router(judge_router)
app.include_router(brief_router)
app.include_router(session_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

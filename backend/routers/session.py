"""Session-scoped GET/POST endpoints: history, foundation, sense, reset.

Also: cross-session list/delete used by the sidebar (no Depends — these
endpoints don't auto-create or read the X-Session-Id header).
"""

from fastapi import APIRouter, Depends

from deps import get_session
from store import Session, store

router = APIRouter(prefix="/api/chat", tags=["session"])


@router.get("/sessions")
async def list_sessions():
    """Return all conversations, newest first. Title = first user message
    verbatim (frontend truncates for display)."""
    summaries = store.list_sessions()
    return {
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "updated_at": s.updated_at,
                "message_count": s.message_count,
            }
            for s in summaries
        ]
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    store.drop(session_id)
    return {"ok": True}


@router.get("/history")
async def get_history(session: Session = Depends(get_session)):
    return {"messages": list(session.messages)}


@router.get("/foundation")
async def get_foundation(session: Session = Depends(get_session)):
    return {
        "foundation": session.foundation,
        "foundation_narrative": session.foundation_narrative,
        "plan": session.plan,
    }


@router.get("/sense")
async def get_sense(session: Session = Depends(get_session)):
    return {
        "certainty": session.sense.get("certainty", 0.5),
        "resonance": session.sense.get("resonance", 0.5),
    }


@router.get("/clarity")
async def get_clarity(session: Session = Depends(get_session)):
    return {
        "clarity": session.clarity,
        "drift": session.drift,
        "seed": session.seed,
    }


@router.post("/reset")
async def reset(session: Session = Depends(get_session)):
    session.reset()
    store.save(session)
    return {"ok": True, "session_id": session.id}

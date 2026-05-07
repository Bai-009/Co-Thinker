"""Execution-brief streaming endpoint.

Compresses the entire conversation (history + foundation) into a markdown
brief shaped for hand-off to coding agents (Cursor / Lovable / Kimi etc).
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from deps import SESSION_HEADER, get_session
from llm import chat_completion_stream
from sse import sse_event
from store import Session, get_brief_system_prompt

router = APIRouter(prefix="/api/chat", tags=["brief"])

_VOICE_OPEN_RE = re.compile(r"\[VOICE\]\s*")
_VOICE_CLOSE_RE = re.compile(r"\s*\[/VOICE\]")
_FOUNDATION_BLOCK_RE = re.compile(r"\[FOUNDATION\][\s\S]*?\[/FOUNDATION\]")
_NARRATIVE_BLOCK_RE = re.compile(r"\[FOUNDATION_NARRATIVE\][\s\S]*?\[/FOUNDATION_NARRATIVE\]")
_SENSE_BLOCK_RE = re.compile(r"\[SENSE\][\s\S]*?\[/SENSE\]")


def _strip_markers(content: str) -> str:
    content = _VOICE_OPEN_RE.sub("", content)
    content = _VOICE_CLOSE_RE.sub("", content)
    content = _NARRATIVE_BLOCK_RE.sub("", content)
    content = _FOUNDATION_BLOCK_RE.sub("", content)
    content = _SENSE_BLOCK_RE.sub("", content)
    return content.strip()


def _format_history(history: list[dict]) -> str:
    lines: list[str] = []
    for m in history:
        role = m.get("role", "")
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            lines.append(f"用户：{content}")
        elif role == "assistant":
            cleaned = _strip_markers(content)
            if cleaned:
                lines.append(f"AI：{cleaned}")
    return "\n\n".join(lines)


async def _stream_brief(session: Session):
    if not session.messages:
        yield sse_event({
            "type": "error",
            "detail": "还没有对话内容——先聊几轮再来生成简报。",
        })
        return

    parts: list[str] = []
    if session.foundation_narrative.strip():
        parts.append("# 共识地基（散文自述）\n\n" + session.foundation_narrative.strip())
    if session.foundation.strip():
        parts.append("# 共识地基（编号清单）\n\n" + session.foundation.strip())
    convo = _format_history(session.messages)
    if convo:
        parts.append("# 对话历史\n\n" + convo)
    parts.append("请基于以上内容，按 `## 我想做什么` 开头的结构输出执行简报。")

    messages = [
        {"role": "system", "content": get_brief_system_prompt()},
        {"role": "user", "content": "\n\n".join(parts)},
    ]

    full = ""
    try:
        async for chunk in chat_completion_stream(messages):
            if not chunk:
                continue
            full += chunk
            yield sse_event({"type": "brief_delta", "content": chunk})
        yield sse_event({"type": "brief_done", "brief": full.strip()})
    except Exception as exc:
        yield sse_event({"type": "error", "detail": f"LLM 调用失败: {exc}"})


@router.post("/brief")
async def stream_brief(session: Session = Depends(get_session)):
    """Stream a markdown execution brief based on the current session."""
    return StreamingResponse(
        _stream_brief(session),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            SESSION_HEADER: session.id,
        },
    )

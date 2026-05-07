"""Workshop streaming endpoint — thinker phase only.

A turn now has TWO independent timelines:

    1. Thinker (foreground, streamed)
       Sees full session context, emits a [VOICE] block (1-3 sentences
       typical, with [CONF] self-rating) or [SILENCE]. The SSE stream
       closes the moment the thinker finishes, so the user can
       immediately type the next message.

    2. Metabolize (background, detached)
       Foundation rewriter + judge run in a single asyncio task that lives
       past the request. Per-session asyncio lock serializes concurrent
       turns' rewrites so they don't trample each other. The frontend
       learns about new foundation / clarity via light polling on
       /api/chat/foundation and /api/chat/clarity, not via this stream.

This split is intentional: the thinker is the interactive heartbeat, the
rewriter is metabolic. Forcing them into the same SSE made the IM rhythm
gate on metabolic latency. See `prompts/foundation_rewriter.md` — the
rewriter explicitly frames itself as 回看与沉淀, which should run a beat
behind the浮现, not in lockstep.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from deps import SESSION_HEADER, get_session
from llm import chat_completion_stream
from models import ChatRequest
from sse import (
    StreamParser,
    parse_clamped_float,
    parse_sense_block,
    sse_event,
)
from store import (
    Session,
    get_foundation_rewriter_prompt,
    get_thinker_prompt,
    session_async_lock,
    store,
)


router = APIRouter(prefix="/api/chat", tags=["workshop"])
log = logging.getLogger("cothinker.workshop")


# --- prompt builders ----------------------------------------------------

def _build_thinker_system_prompt(session: Session) -> str:
    """Compose the thinker's system prompt with current state injected."""
    parts = [get_thinker_prompt()]

    if session.foundation_narrative.strip():
        parts.append("# 当前地基（散文自述）\n\n" + session.foundation_narrative.strip())

    if session.foundation.strip():
        parts.append("# 当前地基（编号清单）\n\n" + session.foundation.strip())

    if session.scratchpad.strip():
        parts.append(
            "# 当前 scratchpad（这次思考活动的内部状态）\n\n"
            + session.scratchpad.strip()
        )

    return "\n\n".join(parts)


def _build_rewriter_messages(
    session: Session,
    voices_this_turn: list[tuple[float, str]],
) -> list[dict]:
    """Assemble the foundation rewriter's input."""
    user_parts: list[str] = []

    if session.foundation_narrative.strip():
        user_parts.append("# 上一版地基（散文）\n\n" + session.foundation_narrative.strip())
    else:
        user_parts.append("# 上一版地基（散文）\n\n（这是对话开始，地基为空）")

    if session.foundation.strip():
        user_parts.append("# 上一版地基（清单）\n\n" + session.foundation.strip())
    else:
        user_parts.append("# 上一版地基（清单）\n\n（这是对话开始，地基为空）")

    if session.scratchpad.strip():
        user_parts.append("# 上一版 scratchpad\n\n" + session.scratchpad.strip())
    else:
        user_parts.append("# 上一版 scratchpad\n\n（暂无）")

    last_user = next(
        (m for m in reversed(session.messages) if m.get("role") == "user"),
        None,
    )
    if last_user:
        user_parts.append("# 人那边最新一句\n\n" + (last_user.get("content") or "").strip())

    if voices_this_turn:
        lines = ["# 本轮浮现的内容"]
        for i, (conf, content) in enumerate(voices_this_turn, start=1):
            label = "浮现" if len(voices_this_turn) == 1 else f"浮现 {i}"
            lines.append(f"\n[{label} CONF {conf:.2f}]\n{content}\n[/{label}]")
        user_parts.append("\n".join(lines))
    else:
        user_parts.append(
            "# 本轮浮现的内容\n\n"
            "（这一轮 thinker 选择整体沉默——通常意味着输入是空/纯标点/明显误操作。）"
        )

    user_parts.append(
        "现在请严格按 [FOUNDATION_CHANGE] → [FOUNDATION_NARRATIVE] → "
        "[FOUNDATION] → [SCRATCHPAD] → [SENSE] 的顺序输出。"
    )

    return [
        {"role": "system", "content": get_foundation_rewriter_prompt()},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


# --- thinker streaming runner -------------------------------------------

async def _run_thinker(session: Session) -> AsyncIterator[tuple]:
    """Run the thinker call, streaming its SSE events.

    Yields ("event", payload) for each SSE event. Finally yields
    ("done", voices) where voices is list[(conf, content)] — possibly
    empty if the thinker chose [SILENCE].
    """
    messages = [{"role": "system", "content": _build_thinker_system_prompt(session)}]
    messages.extend(session.messages)

    parser = StreamParser()
    voices: list[tuple[float, str]] = []
    voice_buf = ""
    conf_buf = ""
    last_voice_idx = -1

    def _ensure_voice_slot(idx: int) -> None:
        nonlocal voices
        while len(voices) <= idx:
            voices.append((0.5, ""))

    try:
        async for chunk in chat_completion_stream(messages):
            for ev in parser.feed(chunk):
                if ev.kind == "silence":
                    yield ("done", [])
                    return

                if ev.block == "voice":
                    if ev.kind == "block_start":
                        if last_voice_idx >= 0 and voice_buf.strip():
                            _ensure_voice_slot(last_voice_idx)
                            existing_conf = voices[last_voice_idx][0]
                            voices[last_voice_idx] = (existing_conf, voice_buf.strip())
                        voice_buf = ""
                        conf_buf = ""
                        last_voice_idx = ev.index or 0
                        _ensure_voice_slot(last_voice_idx)
                        yield ("event", {"type": "voice_start", "index": last_voice_idx})
                    elif ev.kind == "block_delta" and ev.content:
                        voice_buf += ev.content
                        yield ("event", {
                            "type": "voice_delta",
                            "index": ev.index,
                            "content": ev.content,
                        })
                    elif ev.kind == "block_end":
                        if last_voice_idx >= 0:
                            _ensure_voice_slot(last_voice_idx)
                            existing_conf = voices[last_voice_idx][0]
                            voices[last_voice_idx] = (existing_conf, voice_buf.strip())
                        yield ("event", {"type": "voice_end", "index": ev.index})

                elif ev.block == "conf":
                    if ev.kind == "block_delta" and ev.content:
                        conf_buf += ev.content
                    elif ev.kind == "block_end":
                        c = parse_clamped_float(conf_buf, default=0.5)
                        if last_voice_idx >= 0:
                            _ensure_voice_slot(last_voice_idx)
                            _, existing_text = voices[last_voice_idx]
                            voices[last_voice_idx] = (c, existing_text)
                        yield ("event", {
                            "type": "voice_conf",
                            "index": last_voice_idx,
                            "confidence": c,
                        })
                        conf_buf = ""

        for ev in parser.flush():
            if ev.block == "voice" and ev.kind == "block_delta" and ev.content:
                voice_buf += ev.content
                yield ("event", {
                    "type": "voice_delta",
                    "index": ev.index,
                    "content": ev.content,
                })
            elif ev.block == "voice" and ev.kind == "block_end":
                if last_voice_idx >= 0:
                    _ensure_voice_slot(last_voice_idx)
                    existing_conf = voices[last_voice_idx][0]
                    voices[last_voice_idx] = (existing_conf, voice_buf.strip())
                yield ("event", {"type": "voice_end", "index": ev.index})

    except Exception as exc:
        log.warning("thinker call failed: %s", exc)
        yield ("done", [])
        return

    if last_voice_idx >= 0 and voice_buf.strip():
        _ensure_voice_slot(last_voice_idx)
        existing_conf = voices[last_voice_idx][0]
        if not voices[last_voice_idx][1]:
            voices[last_voice_idx] = (existing_conf, voice_buf.strip())

    cleaned = [(c, t) for (c, t) in voices if t and t.strip()]

    if parser.silence_seen:
        yield ("done", [])
        return

    yield ("done", cleaned)


# --- foundation rewriter (non-yielding, runs in background task) --------

async def _run_rewriter_to_session(
    session: Session,
    voices_this_turn: list[tuple[float, str]],
) -> None:
    """Run the rewriter LLM call, parse the four blocks, and persist them
    onto `session`. No SSE events — this runs in a background task that
    has no client connection to stream to.

    By the time we get here we hold the session's async lock, so no other
    rewriter for this session is running concurrently. Concurrent thinker
    reads are GIL-atomic per attribute; the worst they can see is the new
    narrative + the old list (or vice versa) for a few microseconds, never
    a torn string within a single field.
    """
    messages = _build_rewriter_messages(session, voices_this_turn)
    parser = StreamParser()
    foundation_text = ""
    narrative_text = ""

    try:
        async for chunk in chat_completion_stream(messages):
            for ev in parser.feed(chunk):
                if ev.block == "foundation" and ev.kind == "block_delta" and ev.content:
                    foundation_text += ev.content
                elif ev.block == "narrative" and ev.kind == "block_delta" and ev.content:
                    narrative_text += ev.content
        for ev in parser.flush():
            if ev.block == "foundation" and ev.kind == "block_delta" and ev.content:
                foundation_text += ev.content
            elif ev.block == "narrative" and ev.kind == "block_delta" and ev.content:
                narrative_text += ev.content
    except Exception:
        log.warning("rewriter background call failed", exc_info=True)
        return

    new_foundation = foundation_text.strip()
    new_narrative = narrative_text.strip()
    new_scratchpad = parser.scratchpad_buf.strip()
    sense_values = parse_sense_block(parser.sense_buf) if parser.sense_buf.strip() else {}

    final_sense = dict(session.sense)
    final_sense.update(sense_values)

    if new_foundation:
        session.foundation = new_foundation
    if new_narrative:
        session.foundation_narrative = new_narrative
    if new_scratchpad:
        session.scratchpad = new_scratchpad
    session.sense = final_sense

    store.save(session)


# --- background metabolize task ----------------------------------------

async def _metabolize_turn(
    session_id: str,
    voices_this_turn: list[tuple[float, str]],
) -> None:
    """Detached background task — rewriter then judge, serialized via
    per-session lock. Both halves soft-fail; UI degrades gracefully.

    Imported lazily to avoid a circular import with routers.judge (which
    can also live downstream of workshop in some test setups).
    """
    from routers.judge import run_judge_inline

    lock = session_async_lock(session_id)
    async with lock:
        session = store.get(session_id)
        if session is None:
            return
        try:
            await _run_rewriter_to_session(session, voices_this_turn)
        except Exception:
            log.warning("metabolize: rewriter step failed", exc_info=True)
        try:
            await run_judge_inline(session)
        except Exception:
            log.warning("metabolize: judge step failed", exc_info=True)


# --- main turn orchestrator ---------------------------------------------

async def _stream_workshop(session: Session, user_text: str):
    """Stream the thinker phase only. Spawn the metabolize task at the end
    and close the SSE — the rest happens out of band.
    """
    session.add_message("user", user_text)
    session.turn += 1
    store.save(session)

    voices_this_turn: list[tuple[float, str]] = []
    async for item in _run_thinker(session):
        tag = item[0]
        if tag == "event":
            yield sse_event(item[1])
        elif tag == "done":
            voices_this_turn = item[1]

    silent_turn = len(voices_this_turn) == 0

    if silent_turn:
        # Truly empty turn — pop the orphan user message so we don't leave
        # an unanswered prompt in conversation history. No metabolize task.
        if session.messages and session.messages[-1].get("role") == "user":
            session.messages.pop()
            session.turn = max(0, session.turn - 1)
        store.save(session)
        yield sse_event({
            "type": "done",
            "voices": [],
            "voice_confs": [],
            "silent": True,
        })
        return

    # Save assistant message immediately so subsequent turns' thinker calls
    # see this turn's voices in session.messages — even if metabolize is
    # still running. Foundation snapshot is not stored on the message body
    # anymore (it lives only on session.foundation, kept fresh by the
    # background task). parseStoredVoices on the frontend reads only the
    # [VOICE] blocks anyway.
    parts = [
        f"[VOICE]\n[CONF]{conf:.2f}[/CONF]\n{content}\n[/VOICE]"
        for conf, content in voices_this_turn
    ]
    session.add_message("assistant", "\n\n".join(parts))
    store.save(session)

    # Detach the rewriter + judge from the request lifecycle. asyncio.create_task
    # is enough — the task runs on the same event loop and survives the
    # response generator returning. Per-session lock inside the task
    # serializes against any future turn's metabolize.
    asyncio.create_task(_metabolize_turn(session.id, voices_this_turn))

    yield sse_event({
        "type": "done",
        "voices": [c for _, c in voices_this_turn],
        "voice_confs": [conf for conf, _ in voices_this_turn],
        "silent": False,
    })


@router.post("/workshop")
async def stream_workshop(req: ChatRequest, session: Session = Depends(get_session)):
    """Stream the thinker phase. Foundation/judge happen async; poll for them."""
    return StreamingResponse(
        _stream_workshop(session, req.content),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            SESSION_HEADER: session.id,
        },
    )

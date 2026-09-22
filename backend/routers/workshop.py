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
from copy import deepcopy
import os
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from deps import SESSION_HEADER, get_session
from llm import chat_completion_stream
from models import ChatRequest
from runtime import runtime_for, spawn, memory_status
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

    if session.plan.strip():
        parts.append(
            "# 当前 plan（阶段化工作流，`- [x]` 已完成，`- [ ]` 未完成）\n\n"
            + session.plan.strip()
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

    if session.plan.strip():
        user_parts.append("# 上一版 plan\n\n" + session.plan.strip())
    else:
        user_parts.append("# 上一版 plan\n\n（还没立 plan）")

    # Include the unsummarized range, including turns completed while memory lagged.
    covered = max((h.get("prefix", 0) for h in session.foundation_history
                   if h.get("prefix", 0) <= len(session.messages)), default=0)
    pending = session.messages[covered:]
    if pending:
        user_parts.append("# 尚未沉淀的对话（按时间排列）\n\n" + "\n\n".join(
            ("人：" if m["role"] == "user" else "模型：") + m["content"] for m in pending))

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
            "（没有额外传入本轮回复；请以上方尚未沉淀的完整对话为准，不推断为沉默。）"
        )

    user_parts.append(
        "现在请严格按 [FOUNDATION_CHANGE] → [FOUNDATION_NARRATIVE] → "
        "[FOUNDATION] → [PLAN] → [SCRATCHPAD] → [SENSE] 的顺序输出。"
        "[PLAN] 块必须出现，但如果当前讨论还没到立 plan 的阶段，留空 [PLAN][/PLAN]。"
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
        raise

    if last_voice_idx >= 0 and voice_buf.strip():
        _ensure_voice_slot(last_voice_idx)
        existing_conf = voices[last_voice_idx][0]
        if not voices[last_voice_idx][1]:
            voices[last_voice_idx] = (existing_conf, voice_buf.strip())

    cleaned = [(c, t) for (c, t) in voices if t and t.strip()]

    if parser.silence_seen:
        yield ("done", [])
        return

    if not cleaned:
        raise RuntimeError("模型没有返回可用的回复格式")
    yield ("done", cleaned)


# --- foundation rewriter (non-yielding, runs in background task) --------

async def _run_rewriter_to_session(
    session: Session,
    voices_this_turn: list[tuple[float, str]],
    *, persist: bool = True,
) -> bool:
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
        return False

    if not {"foundation", "narrative", "scratchpad"}.issubset(parser.seen_blocks):
        return False

    new_foundation = foundation_text.strip()
    new_narrative = narrative_text.strip()
    new_scratchpad = parser.scratchpad_buf.strip()
    sense_values = parse_sense_block(parser.sense_buf) if parser.sense_buf.strip() else {}

    final_sense = dict(session.sense)
    final_sense.update(sense_values)

    if "foundation" in parser.seen_blocks:
        session.foundation = new_foundation
    if "narrative" in parser.seen_blocks:
        session.foundation_narrative = new_narrative
    if "scratchpad" in parser.seen_blocks:
        session.scratchpad = new_scratchpad
    session.sense = final_sense

    # Plan field: only overwrite if the rewriter explicitly emitted [PLAN]
    # (even if empty — that's how rewriter signals "clear the plan"). If it
    # skipped the block entirely (parser.plan_seen=False), keep existing.
    if parser.plan_seen:
        session.plan = parser.plan_buf.strip()

    if persist:
        store.save(session)
    return True


# --- versioned background memory and foreground turns -------------------

MEMORY_FIELDS = ("foundation", "foundation_narrative", "scratchpad", "sense", "plan")


async def _metabolize_turn(session_id, voices_this_turn, messages=None, epoch=None):
    rt = runtime_for(session_id)
    epoch = rt.epoch if epoch is None else epoch
    live = store.get(session_id)
    if live is None:
        return
    # Capture before waiting: a queued job must never borrow a later user's input.
    frozen_messages = deepcopy(live.messages if messages is None else messages)
    prefix = len(frozen_messages)
    async with rt.memory_lock:
        live = store.get(session_id)
        if live is None or rt.epoch != epoch:
            return
        working = deepcopy(live)
        working.messages = frozen_messages
        working.foundation_history = [h for h in working.foundation_history if h["prefix"] <= prefix]
        ok = await _run_rewriter_to_session(working, voices_this_turn, persist=False)
        live = store.get(session_id)
        if live is None or rt.epoch != epoch:
            return
        if not ok:
            rt.memory_error = "共同记录暂未更新，对话已保存。"
            return
        for name in MEMORY_FIELDS:
            setattr(live, name, deepcopy(getattr(working, name)))
        live.push_snapshot(prefix=prefix)
        rt.memory_error = ""
        rt.memory_prefix = prefix
        store.save(live)
        # Optional atmosphere evaluation cannot hold up the next memory update.
        if os.getenv("COTHINKER_JUDGE", "0") == "1":
            spawn(_judge_snapshot(session_id, working, epoch, prefix), rt, epoch, memory=False)


async def _judge_snapshot(session_id, working, epoch, prefix):
    from routers.judge import run_judge_inline
    rt = runtime_for(session_id)
    await run_judge_inline(working, persist=False)
    live = store.get(session_id)
    if live is None or rt.epoch != epoch or rt.memory_prefix != prefix:
        return
    for name in ("clarity", "drift", "seed"):
        setattr(live, name, getattr(working, name))
    live.push_snapshot(prefix=prefix)
    store.save(live)


def queue_memory(session, voices):
    rt = runtime_for(session.id)
    rt.memory_error = ""
    return spawn(_metabolize_turn(session.id, voices, deepcopy(session.messages), rt.epoch), rt, rt.epoch)


def _latest_user_msg_index(session):
    return next((i for i in range(len(session.messages)-1, -1, -1)
                 if session.messages[i].get("role") == "user"), None)


async def _stream_workshop(session: Session, user_text: str, mode="send"):
    rt = runtime_for(session.id)
    # Serializes abort cleanup and the next turn, independently of memory jobs.
    async with rt.foreground_lock:
        if mode in ("edit", "retry"):
            idx = _latest_user_msg_index(session)
            if idx is not None:
                if mode == "retry":
                    user_text = session.messages[idx]["content"]
                rt.epoch += 1
                session.restore_to_prefix(idx)
                session.turn = sum(m["role"] == "user" for m in session.messages)
                rt.memory_error = ""
        session.add_message("user", user_text)
        session.turn += 1
        store.save(session)
        rt.generating = True
        # The thinker also reads a frozen view; background updates cannot change
        # the input partway through constructing a request.
        working = deepcopy(session)
        generation_epoch = rt.epoch
        partial, confs, ended = {}, {}, set()
        voices = []
        try:
            yield sse_event({"type": "turn_started", "turn": session.turn})
            async for tag, value in _run_thinker(working):
                if tag == "done":
                    voices = value
                    continue
                ev = value
                i = ev.get("index", 0) or 0
                if ev["type"] == "voice_delta":
                    partial[i] = partial.get(i, "") + ev.get("content", "")
                elif ev["type"] == "voice_conf":
                    confs[i] = ev["confidence"]
                elif ev["type"] == "voice_end":
                    ended.add(i)
                yield sse_event(ev)
        except asyncio.CancelledError:
            if rt.epoch != generation_epoch:
                raise
            pieces = []
            for i, text in sorted(partial.items()):
                if text.strip():
                    mark = "" if i in ended else "[INTERRUPTED]\n"
                    pieces.append(f"[VOICE][CONF]{confs.get(i, .5):.2f}[/CONF]\n{mark}{text}[/VOICE]")
            if pieces:
                session.add_message("assistant", "\n\n".join(pieces))
            # Keep the user's input even when cancellation happens before output.
            store.save(session)
            raise
        except Exception:
            log.warning("workshop response failed", exc_info=True)
            yield sse_event({"type": "error", "detail": "暂时无法连接模型。你的输入已保存，可以重试。"})
            return
        finally:
            rt.generating = False
        if rt.epoch != generation_epoch:
            return
        if voices:
            session.add_message("assistant", "\n\n".join(
                f"[VOICE][CONF]{conf:.2f}[/CONF]\n{text}[/VOICE]" for conf, text in voices))
            store.save(session)
        queue_memory(session, voices)
        yield sse_event({"type": "done", "voices": [t for _, t in voices],
                         "voice_confs": [c for c, _ in voices], "silent": not voices})


def stream_response(session, text, mode="send"):
    return StreamingResponse(_stream_workshop(session, text, mode), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", SESSION_HEADER: session.id})


@router.post("/workshop")
async def stream_workshop(req: ChatRequest, session: Session = Depends(get_session)):
    return stream_response(session, req.content)


@router.post("/edit")
async def stream_edit(req: ChatRequest, session: Session = Depends(get_session)):
    return stream_response(session, req.content, "edit")


@router.post("/retry")
async def stream_retry(session: Session = Depends(get_session)):
    return stream_response(session, "", "retry")


@router.post("/memory/retry")
async def retry_memory(session: Session = Depends(get_session)):
    rt = runtime_for(session.id)
    if not any(e == rt.epoch for e in rt.memory_jobs.values()) and session.messages:
        queue_memory(session, [])
    return memory_status(session)

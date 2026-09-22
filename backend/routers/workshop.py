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
from foundation import check_ratchet, describe_for_model
from llm import call_options, chat_completion_stream
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

def _state_sections(session: Session) -> list[str]:
    """当前状态的四段。顺序固定、不带时间戳，序列化是确定的，缓存才不会白白作废。"""
    parts: list[str] = []
    if session.foundation_narrative.strip():
        parts.append("# 当前地基（散文自述）\n\n" + session.foundation_narrative.strip())
    if session.foundation.strip():
        parts.append("# 当前地基（编号清单）\n\n" + session.foundation.strip())
    if session.scratchpad.strip():
        parts.append("# 当前 scratchpad（这次思考活动的内部状态）\n\n" + session.scratchpad.strip())
    if session.plan.strip():
        parts.append("# 当前 plan（阶段化工作流，`- [x]` 已完成，`- [ ]` 未完成）\n\n" + session.plan.strip())
    return parts


def _build_thinker_system_prompt(session: Session) -> str:
    """旧排法（COTHINKER_CONTEXT_LAYOUT=head）：状态放在系统提示里。"""
    return "\n\n".join([get_thinker_prompt(), *_state_sections(session)])


_STATE_POINTER = (
    "# 当前状态在哪\n\n"
    "当前地基（散文与清单）、scratchpad、plan 不在这里，而是附在对话最后一条 user 消息的前面，"
    "以「# 当前状态」开头，后面跟着「# 现在这句」。先读状态，再读这句。"
    "如果最后一条消息没有附状态，说明地基还是空的，对话刚开始。"
)


def _build_thinker_messages(session: Session) -> list[dict]:
    """thinker 这次调用的完整消息列表。

    默认排法 tail：静态指令在最前，每轮一字不变，前缀缓存能命中；历史原样追加；
    当前状态附在最新一句前面。状态每轮都变，放在最前会让整条历史的缓存每轮作废；
    放在末尾还让它紧挨着最新一句，是模型最看重的位置。head 是原来的排法，留作对照。
    """
    layout = os.getenv("COTHINKER_CONTEXT_LAYOUT", "tail").strip().lower()
    messages = list(session.messages)
    if layout != "tail" or not messages or messages[-1].get("role") != "user":
        return [{"role": "system", "content": _build_thinker_system_prompt(session)}, *messages]
    state = _state_sections(session)
    content = messages[-1].get("content") or ""
    if state:
        content = "# 当前状态\n\n" + "\n\n".join(state) + "\n\n# 现在这句\n\n" + content
    return [
        {"role": "system", "content": get_thinker_prompt() + "\n\n" + _STATE_POINTER},
        *messages[:-1],
        {"role": "user", "content": content},
    ]


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

THINKER_RETRIES = int(os.getenv("COTHINKER_THINKER_RETRIES", "1") or 0)


async def _run_thinker(session: Session) -> AsyncIterator[tuple]:
    """Run the thinker call, streaming its SSE events.

    Yields ("event", payload) for each SSE event. Finally yields
    ("done", voices) where voices is list[(conf, content)] — possibly
    empty if the thinker chose [SILENCE].

    模型偶尔写坏格式，连接偶尔抖一下。只要还没有任何东西流给用户，就静默重来一次；
    已经开始输出就不重来，半截话交给上层处理。
    """
    for attempt in range(1 + THINKER_RETRIES):
        started = False
        try:
            async for item in _run_thinker_once(session):
                if item[0] == "event":
                    started = True
                yield item
            return
        except Exception as exc:
            if started or attempt >= THINKER_RETRIES:
                raise
            log.warning("thinker attempt %d failed before any output, retrying: %s", attempt + 1, exc)


async def _run_thinker_once(session: Session) -> AsyncIterator[tuple]:
    messages = _build_thinker_messages(session)

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
        async for chunk in chat_completion_stream(messages, **call_options("thinker")):
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

REWRITER_RETRIES = int(os.getenv("COTHINKER_REWRITER_RETRIES", "2") or 0)
_REQUIRED_BLOCKS = {"foundation": "[FOUNDATION]", "narrative": "[FOUNDATION_NARRATIVE]", "scratchpad": "[SCRATCHPAD]"}


async def _call_rewriter(messages: list[dict]) -> tuple[StreamParser, str, str, str]:
    """跑一次 rewriter，返回 (parser, foundation, narrative, 原始全文)。"""
    parser = StreamParser()
    foundation_text = ""
    narrative_text = ""
    raw = ""
    async for chunk in chat_completion_stream(messages, **call_options("rewriter")):
        raw += chunk
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
    return parser, foundation_text, narrative_text, raw


async def _run_rewriter_to_session(
    session: Session,
    voices_this_turn: list[tuple[float, str]],
    *, persist: bool = True,
) -> bool:
    """Run the rewriter LLM call, check it, and persist the blocks onto `session`.

    这是后台的循环：重写、校验、修补，有界。缺块，或者清单没过棘轮（见 foundation.py），
    就把上一次的输出和违规点一起回给模型再来一次；几次都不过就保留旧版，
    上层把记忆标成未更新。循环只放在代谢这边，心跳那边没有。

    By the time we get here we hold the session's async lock, so no other
    rewriter for this session is running concurrently.
    """
    base = _build_rewriter_messages(session, voices_this_turn)
    feedback: list[dict] = []
    for attempt in range(1 + REWRITER_RETRIES):
        try:
            parser, foundation_text, narrative_text, raw = await _call_rewriter(base + feedback)
        except Exception:
            log.warning("rewriter background call failed (attempt %d)", attempt + 1, exc_info=True)
            if attempt >= REWRITER_RETRIES:
                return False
            continue

        missing = [tag for name, tag in _REQUIRED_BLOCKS.items() if name not in parser.seen_blocks]
        if missing:
            reason = f"上一次输出缺少 {'、'.join(missing)} 块。六个块都必须出现，顺序不变，请重新输出全部块。"
        else:
            problems = check_ratchet(session.foundation, foundation_text.strip())
            reason = describe_for_model(problems) if problems else ""
        if reason:
            log.warning("rewriter output rejected (attempt %d): %s", attempt + 1, reason.splitlines()[0][:80])
            if attempt >= REWRITER_RETRIES:
                return False
            feedback = [{"role": "assistant", "content": raw}, {"role": "user", "content": reason}]
            continue

        final_sense = dict(session.sense)
        final_sense.update(parse_sense_block(parser.sense_buf) if parser.sense_buf.strip() else {})

        session.foundation = foundation_text.strip()
        session.foundation_narrative = narrative_text.strip()
        session.scratchpad = parser.scratchpad_buf.strip()
        session.sense = final_sense
        # Plan field: only overwrite if the rewriter explicitly emitted [PLAN]
        # (even if empty — that's how rewriter signals "clear the plan"). If it
        # skipped the block entirely (parser.plan_seen=False), keep existing.
        if parser.plan_seen:
            session.plan = parser.plan_buf.strip()

        if persist:
            store.save(session)
        return True
    return False


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
    # 合并排队：连着几轮排队时，后面的重写本来就覆盖前面的（它读的是上次快照之后
    # 的全部对话），等待中的旧任务让位给最新的一个。只在同一纪元内比较。
    if rt.memory_newest[0] != epoch or prefix > rt.memory_newest[1]:
        rt.memory_newest = (epoch, prefix)
    async with rt.memory_lock:
        live = store.get(session_id)
        if live is None or rt.epoch != epoch:
            return
        if rt.memory_newest[0] == epoch and prefix < rt.memory_newest[1]:
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

"""Foundation judge endpoint.

A separate metacognitive AI pass that evaluates the current foundation's
clarity (0–1), names the loosest piece (drift), and seeds a possible
next user line (seed). The frontend uses these to drive grain density,
foundation hover annotation, and the composer's ghost placeholder.

The judge is *not* part of the workshop turn — it runs after, in a
separate request. The conversation history isn't mutated by it.
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from deps import SESSION_HEADER, get_session
from llm import chat_completion_stream, get_reasoner_model
from sse import (
    StreamParser,
    parse_clamped_float,
    sse_event,
)
from store import Session, store

router = APIRouter(prefix="/api/chat", tags=["judge"])
log = logging.getLogger("cothinker.judge")


JUDGE_SYSTEM_PROMPT_PATH = "judge"  # prompts/judge.md


def _load_judge_prompt() -> str:
    # Lazy import so test environments can monkeypatch.
    from store import load_prompt, with_principles
    return with_principles(load_prompt(JUDGE_SYSTEM_PROMPT_PATH))


_VOICE_OPEN_RE = re.compile(r"\[VOICE\]\s*")
_VOICE_CLOSE_RE = re.compile(r"\s*\[/VOICE\]")
_CONF_BLOCK_RE = re.compile(r"\[CONF\][\s\S]*?\[/CONF\]\s*")
_FOUNDATION_BLOCK_RE = re.compile(r"\[FOUNDATION\][\s\S]*?\[/FOUNDATION\]")
_NARRATIVE_BLOCK_RE = re.compile(r"\[FOUNDATION_NARRATIVE\][\s\S]*?\[/FOUNDATION_NARRATIVE\]")
_SENSE_BLOCK_RE = re.compile(r"\[SENSE\][\s\S]*?\[/SENSE\]")
_INTERRUPTED_RE = re.compile(r"\s*\[INTERRUPTED\]\s*")


def _strip_markers(content: str) -> str:
    content = _CONF_BLOCK_RE.sub("", content)
    content = _VOICE_OPEN_RE.sub("", content)
    content = _VOICE_CLOSE_RE.sub("", content)
    content = _NARRATIVE_BLOCK_RE.sub("", content)
    content = _FOUNDATION_BLOCK_RE.sub("", content)
    content = _SENSE_BLOCK_RE.sub("", content)
    # Interrupted partials: keep the half-said text (it informs judge's
    # sense of where the turn was going) but drop the structural marker.
    content = _INTERRUPTED_RE.sub("", content)
    return content.strip()


def _build_judge_user_payload(session: Session) -> str:
    parts: list[str] = []
    if session.foundation_narrative.strip():
        parts.append("# 当前共识地基（散文）\n\n" + session.foundation_narrative.strip())
    if session.foundation.strip():
        parts.append("# 当前共识地基（清单）\n\n" + session.foundation.strip())
    if not session.foundation_narrative.strip() and not session.foundation.strip():
        parts.append("# 当前共识地基\n\n（暂无）")

    # Last 6 turns (3 user + 3 assistant pairs typically).
    recent = session.messages[-12:]
    if recent:
        lines: list[str] = []
        for m in recent:
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
        if lines:
            parts.append("# 最近对话\n\n" + "\n\n".join(lines))

    parts.append(
        "请按 [CLARITY][DRIFT][SEED] 三个标签的顺序输出。"
        "DRIFT 和 SEED 可以为空字符串，但标签必须存在。"
    )
    return "\n\n".join(parts)


async def run_judge_inline(session: Session) -> None:
    """Non-streaming judge pass — runs the LLM, parses [CLARITY][DRIFT][SEED],
    and persists the results to `session`. Soft-fails (judge is decorative).

    Used by the workshop background metabolize task so the frontend doesn't
    have to fire a separate /api/chat/judge request after every turn.
    """
    if not session.messages and not session.foundation.strip():
        return

    messages = [
        {"role": "system", "content": _load_judge_prompt()},
        {"role": "user", "content": _build_judge_user_payload(session)},
    ]
    parser = StreamParser()

    # Judge runs on the reasoning-tier model (v4-pro by default) — it is
    # metabolize-side, async, and元认知 by nature. The seconds-to-minutes
    # latency vs thinker's IM rhythm is acceptable here because the
    # frontend polls /api/chat/clarity rather than blocking on a stream.
    try:
        async for chunk in chat_completion_stream(messages, model=get_reasoner_model()):
            for _ in parser.feed(chunk):
                pass
        for _ in parser.flush():
            pass
    except Exception:
        log.warning("judge inline call failed", exc_info=True)
        return

    clarity = parse_clamped_float(parser.clarity_buf) if parser.clarity_buf else 0.5
    drift = parser.drift_buf.strip()
    seed = parser.seed_buf.strip()

    session.clarity = clarity
    session.drift = drift
    session.seed = seed
    store.save(session)


async def _stream_judge(session: Session):
    """Stream the judge's output and persist clarity/drift/seed on the session."""
    messages = [
        {"role": "system", "content": _load_judge_prompt()},
        {"role": "user", "content": _build_judge_user_payload(session)},
    ]

    parser = StreamParser()
    sent_clarity = False

    # Same as run_judge_inline — escalate to the reasoning model since
    # judge is元认知, not interactive浮现.
    try:
        async for chunk in chat_completion_stream(messages, model=get_reasoner_model()):
            for ev in parser.feed(chunk):
                # The judge only emits clarity/drift/seed (and we only
                # surface them on block_end).
                pass

            if not sent_clarity and parser.clarity_buf:
                # Try to emit clarity early — it's a single float, parses fast.
                try:
                    c = parse_clamped_float(parser.clarity_buf)
                    yield sse_event({"type": "clarity", "clarity": c})
                    session.clarity = c
                    sent_clarity = True
                except Exception:
                    pass

        for _ in parser.flush():
            pass

        clarity = parse_clamped_float(parser.clarity_buf) if parser.clarity_buf else 0.5
        drift = parser.drift_buf.strip()
        seed = parser.seed_buf.strip()

        session.clarity = clarity
        session.drift = drift
        session.seed = seed
        store.save(session)

        if not sent_clarity:
            yield sse_event({"type": "clarity", "clarity": clarity})
        yield sse_event({"type": "drift", "drift": drift})
        yield sse_event({"type": "seed", "seed": seed})
        yield sse_event({
            "type": "judge_done",
            "clarity": clarity,
            "drift": drift,
            "seed": seed,
        })

    except Exception as exc:
        yield sse_event({"type": "error", "detail": f"判官调用失败: {exc}"})


@router.post("/judge")
async def stream_judge(session: Session = Depends(get_session)):
    """Run the metacognitive judge on the current session and stream its output."""
    if not session.messages and not session.foundation.strip():
        # Nothing to judge yet.
        async def _empty():
            yield sse_event({"type": "clarity", "clarity": 0.0})
            yield sse_event({"type": "drift", "drift": ""})
            yield sse_event({"type": "seed", "seed": ""})
            yield sse_event({
                "type": "judge_done",
                "clarity": 0.0,
                "drift": "",
                "seed": "",
            })
        return StreamingResponse(
            _empty(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                SESSION_HEADER: session.id,
            },
        )

    return StreamingResponse(
        _stream_judge(session),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            SESSION_HEADER: session.id,
        },
    )

"""Server-Sent Events helpers and a streaming marker parser.

Co-Thinker's model output uses marker-delimited blocks. The architecture
splits the workshop turn into multiple sequential LLM calls:

    Per-tendency call (probe / expand / translate):
        [VOICE]
        [CONF]0.7[/CONF]
        ...content...
        [/VOICE]
      ── or ──
        [SILENCE]

    Foundation rewriter (final call of the turn):
        [FOUNDATION_CHANGE]append|revise|unchanged[/FOUNDATION_CHANGE]
        [FOUNDATION]numbered consensus list[/FOUNDATION]
        [SCRATCHPAD]key: value lines[/SCRATCHPAD]
        [SENSE]certainty: 0.X / resonance: 0.X[/SENSE]

Markers may be split across SSE chunks, so the parser keeps a lookahead
tail and only emits content that's safely past any partial marker prefix.
[CONF] is *nested* inside [VOICE]; [SILENCE] is a self-closing token.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterator


def sse_event(payload: dict) -> str:
    """Encode one SSE event line. `ensure_ascii=False` so Chinese passes through."""
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


# --- Marker constants -----------------------------------------------------

VOICE_OPEN = "[VOICE]"
VOICE_CLOSE = "[/VOICE]"
CONF_OPEN = "[CONF]"
CONF_CLOSE = "[/CONF]"
SILENCE = "[SILENCE]"  # self-closing — appears alone

FOUNDATION_OPEN = "[FOUNDATION]"
FOUNDATION_CLOSE = "[/FOUNDATION]"
FOUNDATION_CHANGE_OPEN = "[FOUNDATION_CHANGE]"
FOUNDATION_CHANGE_CLOSE = "[/FOUNDATION_CHANGE]"
FOUNDATION_NARRATIVE_OPEN = "[FOUNDATION_NARRATIVE]"
FOUNDATION_NARRATIVE_CLOSE = "[/FOUNDATION_NARRATIVE]"
SCRATCHPAD_OPEN = "[SCRATCHPAD]"
SCRATCHPAD_CLOSE = "[/SCRATCHPAD]"
SENSE_OPEN = "[SENSE]"
SENSE_CLOSE = "[/SENSE]"
PLAN_OPEN = "[PLAN]"
PLAN_CLOSE = "[/PLAN]"

# Judge AI markers
CLARITY_OPEN = "[CLARITY]"
CLARITY_CLOSE = "[/CLARITY]"
DRIFT_OPEN = "[DRIFT]"
DRIFT_CLOSE = "[/DRIFT]"
SEED_OPEN = "[SEED]"
SEED_CLOSE = "[/SEED]"

ALL_MARKERS = (
    VOICE_OPEN, VOICE_CLOSE, CONF_OPEN, CONF_CLOSE, SILENCE,
    FOUNDATION_OPEN, FOUNDATION_CLOSE,
    FOUNDATION_CHANGE_OPEN, FOUNDATION_CHANGE_CLOSE,
    FOUNDATION_NARRATIVE_OPEN, FOUNDATION_NARRATIVE_CLOSE,
    SCRATCHPAD_OPEN, SCRATCHPAD_CLOSE,
    SENSE_OPEN, SENSE_CLOSE,
    PLAN_OPEN, PLAN_CLOSE,
    CLARITY_OPEN, CLARITY_CLOSE,
    DRIFT_OPEN, DRIFT_CLOSE,
    SEED_OPEN, SEED_CLOSE,
)
MARKER_LOOKAHEAD = max(len(m) for m in ALL_MARKERS)


def find_first(buf: str, *markers: str) -> tuple[int, str | None]:
    """Return (index, marker) for whichever marker appears first in buf, or (-1, None)."""
    best_idx = -1
    best_marker: str | None = None
    for m in markers:
        i = buf.find(m)
        if i < 0:
            continue
        if best_idx < 0 or i < best_idx:
            best_idx = i
            best_marker = m
    return best_idx, best_marker


def parse_sense_block(text: str) -> dict[str, float]:
    """Parse a [SENSE] body of `key: float` lines into a clamped {key: float}."""
    out: dict[str, float] = {}
    for line in text.split("\n"):
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip().lower()
        if key not in ("certainty", "resonance"):
            continue
        try:
            f = float(val.strip())
        except ValueError:
            continue
        out[key] = max(0.0, min(1.0, f))
    return out


def parse_clamped_float(text: str, default: float = 0.5) -> float:
    """Parse a [CONF]/[CLARITY] body into a [0, 1] float."""
    try:
        return max(0.0, min(1.0, float(text.strip())))
    except (ValueError, AttributeError):
        return default


def parse_foundation_change(text: str) -> str:
    """Normalize a FOUNDATION_CHANGE label to one of {append, revise, unchanged}.

    Lenient about Chinese variants — but checks negation BEFORE change verbs
    so that "没改"/"未变" map to "unchanged" rather than "revise".
    """
    t = text.strip().lower()
    if t in ("append", "revise", "unchanged"):
        return t
    if any(neg in t for neg in ("未", "没", "unchanged", "no change", "no-change")):
        return "unchanged"
    if any(rv in t for rv in ("改", "推翻", "修", "revise", "rewrite")):
        return "revise"
    return "append"  # safest default


# --- Block parser ---------------------------------------------------------

@dataclass
class ParsedEvent:
    kind: str       # "block_start" | "block_delta" | "block_end" | "silence"
    block: str      # "voice" | "conf" | "foundation" | "narrative" | "foundation_change" | "scratchpad" | "sense" | "clarity" | "drift" | "seed"
    content: str = ""
    index: int | None = None  # voice index for voice/conf events


@dataclass
class StreamParser:
    """Marker state machine. Call .feed(chunk) and consume yielded events.

    States:
        preamble      — looking for any opening marker (or [SILENCE])
        in_voice      — inside [VOICE], looking for [CONF] or [/VOICE]
        in_conf       — inside [CONF] (nested in current voice)
        in_foundation — inside [FOUNDATION]
        in_narrative  — inside [FOUNDATION_NARRATIVE]
        in_change     — inside [FOUNDATION_CHANGE]
        in_scratchpad — inside [SCRATCHPAD]
        in_sense      — inside [SENSE]; collected to self.sense_buf
        in_clarity / in_drift / in_seed — judge markers
        done          — terminal
    """

    voice_count: int = 0
    state: str = "preamble"
    buf: str = ""

    silence_seen: bool = False
    change_buf: str = ""
    scratchpad_buf: str = ""
    sense_buf: str = ""
    clarity_buf: str = ""
    drift_buf: str = ""
    seed_buf: str = ""
    plan_buf: str = ""
    # True once [PLAN] open was seen — distinguishes "rewriter emitted an
    # empty plan" (clear the session.plan) from "rewriter didn't emit [PLAN]
    # at all" (leave existing plan untouched). Without this, an empty
    # buffer is ambiguous.
    plan_seen: bool = False

    # Voice index offset, so a parser can be told "voices in this stream
    # actually start at index N" — useful when one workshop turn aggregates
    # voices from multiple sequential LLM calls.
    voice_offset: int = 0

    def _voice_idx(self) -> int:
        return self.voice_offset + self.voice_count - 1

    def feed(self, chunk: str) -> Iterator[ParsedEvent]:
        self.buf += chunk
        while True:
            if self.state == "preamble":
                idx, marker = find_first(
                    self.buf,
                    VOICE_OPEN, SILENCE,
                    FOUNDATION_OPEN, FOUNDATION_CHANGE_OPEN, FOUNDATION_NARRATIVE_OPEN,
                    SCRATCHPAD_OPEN, SENSE_OPEN, PLAN_OPEN,
                    CLARITY_OPEN, DRIFT_OPEN, SEED_OPEN,
                )
                if idx < 0:
                    if len(self.buf) > MARKER_LOOKAHEAD:
                        self.buf = self.buf[-MARKER_LOOKAHEAD:]
                    return
                self.buf = self.buf[idx + len(marker):]
                if marker == VOICE_OPEN:
                    self.state = "in_voice"
                    self.voice_count += 1
                    yield ParsedEvent(kind="block_start", block="voice", index=self._voice_idx())
                elif marker == SILENCE:
                    self.silence_seen = True
                    yield ParsedEvent(kind="silence", block="voice")
                elif marker == FOUNDATION_OPEN:
                    self.state = "in_foundation"
                    yield ParsedEvent(kind="block_start", block="foundation")
                elif marker == FOUNDATION_NARRATIVE_OPEN:
                    self.state = "in_narrative"
                    yield ParsedEvent(kind="block_start", block="narrative")
                elif marker == FOUNDATION_CHANGE_OPEN:
                    self.state = "in_change"
                elif marker == SCRATCHPAD_OPEN:
                    self.state = "in_scratchpad"
                elif marker == SENSE_OPEN:
                    self.state = "in_sense"
                elif marker == PLAN_OPEN:
                    self.state = "in_plan"
                    self.plan_seen = True
                elif marker == CLARITY_OPEN:
                    self.state = "in_clarity"
                elif marker == DRIFT_OPEN:
                    self.state = "in_drift"
                elif marker == SEED_OPEN:
                    self.state = "in_seed"
                continue

            if self.state == "in_voice":
                idx, marker = find_first(self.buf, CONF_OPEN, VOICE_CLOSE)
                if idx < 0:
                    safe = len(self.buf) - MARKER_LOOKAHEAD
                    if safe > 0:
                        yield ParsedEvent(
                            kind="block_delta", block="voice",
                            content=self.buf[:safe], index=self._voice_idx(),
                        )
                        self.buf = self.buf[safe:]
                    return
                if idx > 0:
                    yield ParsedEvent(
                        kind="block_delta", block="voice",
                        content=self.buf[:idx], index=self._voice_idx(),
                    )
                self.buf = self.buf[idx + len(marker):]
                if marker == CONF_OPEN:
                    self.state = "in_conf"
                    yield ParsedEvent(kind="block_start", block="conf", index=self._voice_idx())
                else:  # VOICE_CLOSE
                    yield ParsedEvent(kind="block_end", block="voice", index=self._voice_idx())
                    self.state = "preamble"
                continue

            if self.state == "in_conf":
                idx = self.buf.find(CONF_CLOSE)
                if idx >= 0:
                    if idx > 0:
                        yield ParsedEvent(
                            kind="block_delta", block="conf",
                            content=self.buf[:idx], index=self._voice_idx(),
                        )
                    self.buf = self.buf[idx + len(CONF_CLOSE):]
                    yield ParsedEvent(kind="block_end", block="conf", index=self._voice_idx())
                    self.state = "in_voice"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    yield ParsedEvent(
                        kind="block_delta", block="conf",
                        content=self.buf[:safe], index=self._voice_idx(),
                    )
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_foundation":
                idx = self.buf.find(FOUNDATION_CLOSE)
                if idx >= 0:
                    if idx > 0:
                        yield ParsedEvent(
                            kind="block_delta", block="foundation", content=self.buf[:idx],
                        )
                    self.buf = self.buf[idx + len(FOUNDATION_CLOSE):]
                    yield ParsedEvent(kind="block_end", block="foundation")
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    yield ParsedEvent(
                        kind="block_delta", block="foundation", content=self.buf[:safe],
                    )
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_narrative":
                idx = self.buf.find(FOUNDATION_NARRATIVE_CLOSE)
                if idx >= 0:
                    if idx > 0:
                        yield ParsedEvent(
                            kind="block_delta", block="narrative", content=self.buf[:idx],
                        )
                    self.buf = self.buf[idx + len(FOUNDATION_NARRATIVE_CLOSE):]
                    yield ParsedEvent(kind="block_end", block="narrative")
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    yield ParsedEvent(
                        kind="block_delta", block="narrative", content=self.buf[:safe],
                    )
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_change":
                idx = self.buf.find(FOUNDATION_CHANGE_CLOSE)
                if idx >= 0:
                    self.change_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(FOUNDATION_CHANGE_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.change_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_scratchpad":
                idx = self.buf.find(SCRATCHPAD_CLOSE)
                if idx >= 0:
                    self.scratchpad_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(SCRATCHPAD_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.scratchpad_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_sense":
                idx = self.buf.find(SENSE_CLOSE)
                if idx >= 0:
                    self.sense_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(SENSE_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.sense_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_plan":
                idx = self.buf.find(PLAN_CLOSE)
                if idx >= 0:
                    self.plan_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(PLAN_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.plan_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_clarity":
                idx = self.buf.find(CLARITY_CLOSE)
                if idx >= 0:
                    self.clarity_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(CLARITY_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.clarity_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_drift":
                idx = self.buf.find(DRIFT_CLOSE)
                if idx >= 0:
                    self.drift_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(DRIFT_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.drift_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            if self.state == "in_seed":
                idx = self.buf.find(SEED_CLOSE)
                if idx >= 0:
                    self.seed_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(SEED_CLOSE):]
                    self.state = "preamble"
                    continue
                safe = len(self.buf) - MARKER_LOOKAHEAD
                if safe > 0:
                    self.seed_buf += self.buf[:safe]
                    self.buf = self.buf[safe:]
                return

            return

    def flush(self) -> Iterator[ParsedEvent]:
        """Emit any remaining content when the upstream stream ends."""
        if self.state == "in_voice" and self.buf:
            yield ParsedEvent(
                kind="block_delta", block="voice",
                content=self.buf, index=self._voice_idx(),
            )
            yield ParsedEvent(kind="block_end", block="voice", index=self._voice_idx())
            self.buf = ""
        elif self.state == "in_conf" and self.buf:
            yield ParsedEvent(
                kind="block_delta", block="conf",
                content=self.buf, index=self._voice_idx(),
            )
            yield ParsedEvent(kind="block_end", block="conf", index=self._voice_idx())
            self.buf = ""
        elif self.state == "in_foundation" and self.buf:
            yield ParsedEvent(kind="block_delta", block="foundation", content=self.buf)
            yield ParsedEvent(kind="block_end", block="foundation")
            self.buf = ""
        elif self.state == "in_narrative" and self.buf:
            yield ParsedEvent(kind="block_delta", block="narrative", content=self.buf)
            yield ParsedEvent(kind="block_end", block="narrative")
            self.buf = ""
        elif self.state == "in_change" and self.buf:
            self.change_buf += self.buf
            self.buf = ""
        elif self.state == "in_scratchpad" and self.buf:
            self.scratchpad_buf += self.buf
            self.buf = ""
        elif self.state == "in_sense" and self.buf:
            self.sense_buf += self.buf
            self.buf = ""
        elif self.state == "in_plan" and self.buf:
            self.plan_buf += self.buf
            self.buf = ""
        elif self.state == "in_clarity" and self.buf:
            self.clarity_buf += self.buf
            self.buf = ""
        elif self.state == "in_drift" and self.buf:
            self.drift_buf += self.buf
            self.buf = ""
        elif self.state == "in_seed" and self.buf:
            self.seed_buf += self.buf
            self.buf = ""

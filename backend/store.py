"""Session state for Co-Thinker.

`SessionStore` is the public interface. Two implementations are wired:
  - InMemorySessionStore : per-process dict, used in tests and when
                           COTHINKER_DB is unset.
  - SqliteSessionStore   : durable, default in production. Schema is one
                           row per session + one row per message.

Both implementations expose the same `Session` dataclass so routers don't
need to care which is in use.

Prompts are loaded fresh from disk on every call so that iterating on
`prompts/*.md` doesn't require a backend restart. The cost is reading
a few KB of text per LLM call — negligible compared to the LLM round-trip.
"""

from __future__ import annotations

import asyncio
import os
import re
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


# Per-session async lock registry. Used by the workshop background
# metabolize task (rewriter + judge) to serialize itself against other
# turns of the same session, while leaving the thinker path unlocked so
# rapid IM-style turns aren't blocked. Locks are created lazily and never
# evicted — at human conversation rates the leak is negligible.
_session_async_locks: dict[str, asyncio.Lock] = {}


def session_async_lock(session_id: str) -> asyncio.Lock:
    lock = _session_async_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _session_async_locks[session_id] = lock
    return lock


def load_prompt(name: str) -> str:
    """Load a prompt from prompts/<name>.md — fresh from disk every call."""
    return (_PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")


def with_principles(*specifics: str) -> str:
    """Compose final system prompt = principles.md + given specifics, joined by `---`.

    Reads `principles.md` fresh each call — see module docstring.
    """
    principles = load_prompt("principles")
    return "\n\n---\n\n".join((principles, *specifics))


def get_thinker_prompt() -> str:
    """The single LLM call that handles a workshop turn — sees full
    conversation context and naturally fuses probe/expand/translate moves.
    """
    return with_principles(load_prompt("thinker"))


def get_foundation_rewriter_prompt() -> str:
    """The retrospective pass that updates the foundation, narrative,
    scratchpad, and sense after each thinker turn.
    """
    return with_principles(load_prompt("foundation_rewriter"))


def get_brief_system_prompt() -> str:
    """Distills the conversation into a markdown execution brief."""
    return with_principles(load_prompt("brief"))


Role = Literal["system", "user", "assistant"]


_SENTENCE_END_RE = re.compile(r"[。！？.!?]")
_FOUNDATION_ITEM_RE = re.compile(r"^\s*\d+[\.、]\s*(.*)$")


def _choose_sidebar_title(
    narrative: str,
    foundation: str,
    first_user_msg: str,
    max_len: int = 60,
) -> str:
    """Pick the best human-readable title for the conversation sidebar.

    Three-tier fallback (most → least preferred):

    1. First sentence of `foundation_narrative` — the metabolized self-
       statement, ages best.
    2. First active item of `foundation` (numbered list) — the rewriter
       always emits this even when it skips the narrative block, so
       this catches the common DeepSeek case where narrative is empty.
    3. First user message — last resort. Often "hi" / "你好" / vague
       openers that give no signal about the conversation's subject.

    Strikethrough items in the foundation list (`~~text~~`) are skipped
    since they represent superseded consensus, not current.
    """
    text = (narrative or "").strip()
    if text:
        m = _SENTENCE_END_RE.search(text)
        if m:
            text = text[: m.end()]
    if not text and foundation:
        for line in foundation.split("\n"):
            m = _FOUNDATION_ITEM_RE.match(line)
            if not m:
                continue
            body = m.group(1).strip()
            if not body or body.startswith("~~"):
                continue
            text = body
            # Strip any trailing strikethrough revision note.
            text = re.sub(r"\s*~~.*$", "", text).strip()
            break
    if not text:
        text = (first_user_msg or "").strip()
    if len(text) > max_len:
        text = text[:max_len].rstrip() + "…"
    return text


@dataclass
class SessionSummary:
    """Lightweight metadata for the conversation list. The title is the
    first user message verbatim; the frontend truncates for display.
    """
    id: str
    title: str
    updated_at: float
    message_count: int


@dataclass
class Session:
    id: str
    messages: list[dict] = field(default_factory=list)
    # Numbered consensus list — canonical for AI conflict scanning.
    # Output by the foundation rewriter as plain text "1. ...\n2. ...\n".
    foundation: str = ""
    # Prose self-narrative — what the user reads. Carries the connective
    # tissue the numbered list strips: tensions, why we changed direction,
    # what's still unsettled. Written by the rewriter alongside `foundation`
    # in the same turn so they don't drift.
    foundation_narrative: str = ""
    # Structured internal state the foundation rewriter maintains. Lines
    # of "key: value", new value replaces old value for the same key. Not
    # shown directly in the UI; injected back into the rewriter's context
    # next turn so it has the full state of decisions / pending items.
    scratchpad: str = ""
    sense: dict[str, float] = field(
        default_factory=lambda: {"certainty": 0.5, "resonance": 0.5},
    )
    turn: int = 0
    # Judge-AI outputs. Updated by the /api/chat/judge endpoint.
    clarity: float = 0.0
    drift: str = ""
    seed: str = ""
    # Plan-shaped foundation, phase 1. Markdown checkbox list of staged
    # work items, each one a hand-off-able unit (`- [ ] item` / `- [x] item`).
    # Output by the foundation rewriter when the conversation is complex
    # enough to merit stages; empty for casual discussion. The handoff
    # mechanism (Co-Thinker tells user "this item is ripe to execute")
    # lives in phase 2 — for now this field just records the plan.
    plan: str = ""
    # Foundation snapshots — one entry per completed metabolize. Each
    # entry captures the full metabolized state at the moment, keyed by
    # the message-prefix-count (len(messages) immediately after that
    # turn's assistant message was appended). Used by /api/chat/edit to
    # roll state back when the user edits a prior message: find the
    # largest snapshot with prefix <= edited_msg_index, restore from it,
    # discard newer snapshots. Interrupted turns don't snapshot (no
    # metabolize ran), so prefixes can be sparse — find-largest-<=
    # logic naturally handles that.
    foundation_history: list[dict] = field(default_factory=list)

    def add_message(self, role: Role, content: str) -> None:
        self.messages.append({"role": role, "content": content})

    def reset(self) -> None:
        self.messages.clear()
        self.foundation = ""
        self.foundation_narrative = ""
        self.scratchpad = ""
        self.sense = {"certainty": 0.5, "resonance": 0.5}
        self.turn = 0
        self.clarity = 0.0
        self.drift = ""
        self.seed = ""
        self.plan = ""
        self.foundation_history = []

    def snapshot_state(self) -> dict:
        """Capture current metabolized state as a snapshot dict, tagged
        with the current message-prefix-count."""
        return {
            "prefix": len(self.messages),
            "foundation": self.foundation,
            "foundation_narrative": self.foundation_narrative,
            "scratchpad": self.scratchpad,
            "certainty": float(self.sense.get("certainty", 0.5)),
            "resonance": float(self.sense.get("resonance", 0.5)),
            "clarity": float(self.clarity),
            "drift": self.drift,
            "seed": self.seed,
            "plan": self.plan,
        }

    def push_snapshot(self) -> None:
        """Append a snapshot of current state. If a snapshot with the
        same prefix already exists (shouldn't happen normally, but defends
        against double-metabolize), overwrite it."""
        snap = self.snapshot_state()
        # Drop any existing snapshot with the same prefix.
        self.foundation_history = [
            s for s in self.foundation_history if s.get("prefix") != snap["prefix"]
        ]
        self.foundation_history.append(snap)
        self.foundation_history.sort(key=lambda s: s.get("prefix", 0))

    def restore_to_prefix(self, prefix: int) -> None:
        """Restore metabolized state to the snapshot covering message-
        prefix-count <= `prefix`. If no such snapshot, reset to defaults.
        Truncates messages to [:prefix] and removes obsolete snapshots."""
        # Find the latest snapshot with prefix <= target.
        candidate = None
        for s in self.foundation_history:
            if s.get("prefix", 0) <= prefix:
                candidate = s
            else:
                break  # list is sorted by prefix
        if candidate is None:
            self.foundation = ""
            self.foundation_narrative = ""
            self.scratchpad = ""
            self.sense = {"certainty": 0.5, "resonance": 0.5}
            self.clarity = 0.0
            self.drift = ""
            self.seed = ""
            self.plan = ""
        else:
            self.foundation = candidate.get("foundation", "")
            self.foundation_narrative = candidate.get("foundation_narrative", "")
            self.scratchpad = candidate.get("scratchpad", "")
            self.sense = {
                "certainty": float(candidate.get("certainty", 0.5)),
                "resonance": float(candidate.get("resonance", 0.5)),
            }
            self.clarity = float(candidate.get("clarity", 0.0))
            self.drift = candidate.get("drift", "")
            self.seed = candidate.get("seed", "")
            self.plan = candidate.get("plan", "")
        # Trim messages and obsolete snapshots.
        self.messages = self.messages[:prefix]
        self.foundation_history = [
            s for s in self.foundation_history if s.get("prefix", 0) <= prefix
        ]


class InMemorySessionStore:
    """Process-local map of session_id -> Session. Lost on restart."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._updated: dict[str, float] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str | None) -> Session:
        if not session_id:
            session_id = uuid.uuid4().hex
        with self._lock:
            sess = self._sessions.get(session_id)
            if sess is None:
                sess = Session(id=session_id)
                self._sessions[session_id] = sess
                self._updated[session_id] = time.time()
            return sess

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            return self._sessions.get(session_id)

    def save(self, session: Session) -> None:
        # In-memory state is the truth, but track updated_at so list_sessions()
        # can order by recency for the sidebar.
        with self._lock:
            self._updated[session.id] = time.time()

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)
            self._updated.pop(session_id, None)

    def list_sessions(self) -> list[SessionSummary]:
        with self._lock:
            items = list(self._sessions.items())
            updated = dict(self._updated)
        summaries: list[SessionSummary] = []
        for sid, sess in items:
            first_user = ""
            for m in sess.messages:
                if m.get("role") == "user":
                    first_user = m.get("content", "") or ""
                    break
            title = _choose_sidebar_title(
                sess.foundation_narrative, sess.foundation, first_user,
            )
            summaries.append(
                SessionSummary(
                    id=sid,
                    title=title,
                    updated_at=updated.get(sid, 0.0),
                    message_count=len(sess.messages),
                )
            )
        summaries.sort(key=lambda s: s.updated_at, reverse=True)
        return summaries


class SqliteSessionStore:
    """SQLite-backed session store. Schema: sessions(id...) + messages(session_id, ord...)."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        # Hot cache so we don't re-hydrate on every request within a session.
        self._cache: dict[str, Session] = {}
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        # One long-lived connection. Serialized via self._lock so SQLite's
        # check_same_thread isn't a problem; this also makes :memory:
        # actually persist across operations.
        self._conn = sqlite3.connect(db_path, check_same_thread=False, timeout=5.0)
        self._conn.execute("PRAGMA foreign_keys = ON")
        if db_path != ":memory:":
            self._conn.execute("PRAGMA journal_mode = WAL")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                  id                    TEXT PRIMARY KEY,
                  foundation            TEXT NOT NULL DEFAULT '',
                  foundation_narrative  TEXT NOT NULL DEFAULT '',
                  scratchpad            TEXT NOT NULL DEFAULT '',
                  certainty             REAL NOT NULL DEFAULT 0.5,
                  resonance             REAL NOT NULL DEFAULT 0.5,
                  turn                  INTEGER NOT NULL DEFAULT 0,
                  clarity               REAL NOT NULL DEFAULT 0.0,
                  drift                 TEXT NOT NULL DEFAULT '',
                  seed                  TEXT NOT NULL DEFAULT '',
                  plan                  TEXT NOT NULL DEFAULT '',
                  updated_at            REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  ord         INTEGER NOT NULL,
                  role        TEXT NOT NULL,
                  content     TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_session
                  ON messages(session_id, ord);
                CREATE TABLE IF NOT EXISTS foundation_snapshots (
                  session_id           TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  prefix               INTEGER NOT NULL,
                  foundation           TEXT NOT NULL DEFAULT '',
                  foundation_narrative TEXT NOT NULL DEFAULT '',
                  scratchpad           TEXT NOT NULL DEFAULT '',
                  certainty            REAL NOT NULL DEFAULT 0.5,
                  resonance            REAL NOT NULL DEFAULT 0.5,
                  clarity              REAL NOT NULL DEFAULT 0.0,
                  drift                TEXT NOT NULL DEFAULT '',
                  seed                 TEXT NOT NULL DEFAULT '',
                  plan                 TEXT NOT NULL DEFAULT '',
                  PRIMARY KEY (session_id, prefix)
                );
                """
            )
            # Idempotent migrations for any pre-existing DB missing newer columns.
            existing = {
                row[1]
                for row in self._conn.execute("PRAGMA table_info(sessions)").fetchall()
            }
            for col, ddl in (
                ("clarity",              "ALTER TABLE sessions ADD COLUMN clarity REAL NOT NULL DEFAULT 0.0"),
                ("drift",                "ALTER TABLE sessions ADD COLUMN drift TEXT NOT NULL DEFAULT ''"),
                ("seed",                 "ALTER TABLE sessions ADD COLUMN seed TEXT NOT NULL DEFAULT ''"),
                ("scratchpad",           "ALTER TABLE sessions ADD COLUMN scratchpad TEXT NOT NULL DEFAULT ''"),
                ("foundation_narrative", "ALTER TABLE sessions ADD COLUMN foundation_narrative TEXT NOT NULL DEFAULT ''"),
                ("plan",                 "ALTER TABLE sessions ADD COLUMN plan TEXT NOT NULL DEFAULT ''"),
            ):
                if col not in existing:
                    self._conn.execute(ddl)
            # Same for foundation_snapshots — `plan` was added in phase 1 of
            # the handoff architecture, older DBs won't have it.
            snap_existing = {
                row[1]
                for row in self._conn.execute("PRAGMA table_info(foundation_snapshots)").fetchall()
            }
            if "plan" not in snap_existing:
                self._conn.execute(
                    "ALTER TABLE foundation_snapshots ADD COLUMN plan TEXT NOT NULL DEFAULT ''"
                )
            # `pending_questions` was a transient experiment (foundation
            # rewriter raising option-pick questions for the user). The
            # mechanism was removed in favor of in-conversation probing
            # via scratchpad's `pending_conflict` key. Drop the column if
            # it exists so old DBs don't carry a dead field. SQLite < 3.35
            # can't DROP COLUMN, so we just leave it untouched there — it
            # becomes inert dead weight, but doesn't break anything.
            if "pending_questions" in existing:
                try:
                    self._conn.execute("ALTER TABLE sessions DROP COLUMN pending_questions")
                except sqlite3.OperationalError:
                    pass
            self._conn.commit()

    # All `_load` / `get_or_create` / `save` / `drop` callers below already
    # hold self._lock when this is invoked.
    def _load_locked(self, session_id: str) -> Session | None:
        row = self._conn.execute(
            "SELECT foundation, certainty, resonance, turn, clarity, drift, seed, "
            "scratchpad, foundation_narrative, plan FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        sess = Session(
            id=session_id,
            foundation=row[0],
            sense={"certainty": float(row[1]), "resonance": float(row[2])},
            turn=int(row[3]),
            clarity=float(row[4]),
            drift=row[5] or "",
            seed=row[6] or "",
            scratchpad=row[7] or "",
            foundation_narrative=row[8] or "",
            plan=row[9] or "",
        )
        msg_rows = self._conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY ord",
            (session_id,),
        ).fetchall()
        sess.messages = [{"role": r, "content": c} for (r, c) in msg_rows]
        snap_rows = self._conn.execute(
            "SELECT prefix, foundation, foundation_narrative, scratchpad, "
            "certainty, resonance, clarity, drift, seed, plan "
            "FROM foundation_snapshots WHERE session_id = ? ORDER BY prefix",
            (session_id,),
        ).fetchall()
        sess.foundation_history = [
            {
                "prefix": int(r[0]),
                "foundation": r[1] or "",
                "foundation_narrative": r[2] or "",
                "scratchpad": r[3] or "",
                "certainty": float(r[4]),
                "resonance": float(r[5]),
                "clarity": float(r[6]),
                "drift": r[7] or "",
                "seed": r[8] or "",
                "plan": r[9] or "",
            }
            for r in snap_rows
        ]
        return sess

    def get_or_create(self, session_id: str | None) -> Session:
        if not session_id:
            session_id = uuid.uuid4().hex
        with self._lock:
            cached = self._cache.get(session_id)
            if cached is not None:
                return cached
            loaded = self._load_locked(session_id)
            if loaded is not None:
                self._cache[session_id] = loaded
                return loaded
            sess = Session(id=session_id)
            self._cache[session_id] = sess
            self._conn.execute(
                "INSERT OR IGNORE INTO sessions (id, updated_at) VALUES (?, ?)",
                (session_id, time.time()),
            )
            self._conn.commit()
            return sess

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            sess = self._cache.get(session_id)
            if sess is not None:
                return sess
            loaded = self._load_locked(session_id)
            if loaded is not None:
                self._cache[session_id] = loaded
            return loaded

    def save(self, session: Session) -> None:
        """Persist the full session state. Replaces messages atomically."""
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO sessions
                  (id, foundation, foundation_narrative, scratchpad,
                   certainty, resonance, turn, clarity, drift, seed, plan, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  foundation           = excluded.foundation,
                  foundation_narrative = excluded.foundation_narrative,
                  scratchpad           = excluded.scratchpad,
                  certainty            = excluded.certainty,
                  resonance            = excluded.resonance,
                  turn                 = excluded.turn,
                  clarity              = excluded.clarity,
                  drift                = excluded.drift,
                  seed                 = excluded.seed,
                  plan                 = excluded.plan,
                  updated_at           = excluded.updated_at
                """,
                (
                    session.id,
                    session.foundation,
                    session.foundation_narrative,
                    session.scratchpad,
                    float(session.sense.get("certainty", 0.5)),
                    float(session.sense.get("resonance", 0.5)),
                    int(session.turn),
                    float(session.clarity),
                    session.drift,
                    session.seed,
                    session.plan,
                    time.time(),
                ),
            )
            self._conn.execute(
                "DELETE FROM messages WHERE session_id = ?", (session.id,),
            )
            if session.messages:
                self._conn.executemany(
                    "INSERT INTO messages (session_id, ord, role, content) VALUES (?, ?, ?, ?)",
                    [
                        (session.id, i, m["role"], m["content"])
                        for i, m in enumerate(session.messages)
                    ],
                )
            # Replace snapshots atomically (same pattern as messages).
            self._conn.execute(
                "DELETE FROM foundation_snapshots WHERE session_id = ?",
                (session.id,),
            )
            if session.foundation_history:
                self._conn.executemany(
                    "INSERT INTO foundation_snapshots "
                    "(session_id, prefix, foundation, foundation_narrative, "
                    " scratchpad, certainty, resonance, clarity, drift, seed, plan) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        (
                            session.id,
                            int(s.get("prefix", 0)),
                            s.get("foundation", ""),
                            s.get("foundation_narrative", ""),
                            s.get("scratchpad", ""),
                            float(s.get("certainty", 0.5)),
                            float(s.get("resonance", 0.5)),
                            float(s.get("clarity", 0.0)),
                            s.get("drift", ""),
                            s.get("seed", ""),
                            s.get("plan", ""),
                        )
                        for s in session.foundation_history
                    ],
                )
            self._conn.commit()

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._cache.pop(session_id, None)
            self._conn.execute(
                "DELETE FROM sessions WHERE id = ?", (session_id,),
            )
            self._conn.commit()

    def list_sessions(self) -> list[SessionSummary]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT
                  s.id,
                  s.updated_at,
                  s.foundation_narrative,
                  s.foundation,
                  (SELECT content FROM messages
                     WHERE session_id = s.id AND role = 'user'
                     ORDER BY ord LIMIT 1) AS first_user,
                  (SELECT COUNT(*) FROM messages
                     WHERE session_id = s.id) AS msg_count
                FROM sessions s
                ORDER BY s.updated_at DESC
                """
            ).fetchall()
        return [
            SessionSummary(
                id=r[0],
                title=_choose_sidebar_title(r[2] or "", r[3] or "", r[4] or ""),
                updated_at=float(r[1] or 0.0),
                message_count=int(r[5] or 0),
            )
            for r in rows
        ]

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _build_default_store():
    db_path = os.getenv("COTHINKER_DB")
    if db_path:
        return SqliteSessionStore(db_path)
    return InMemorySessionStore()


# Public singleton. Routers and tests import this name.
store = _build_default_store()

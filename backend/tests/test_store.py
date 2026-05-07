"""Tests for the in-memory and SQLite session stores."""

import os
import tempfile

import pytest

from store import InMemorySessionStore, Session, SqliteSessionStore


@pytest.fixture
def mem_store():
    return InMemorySessionStore()


@pytest.fixture
def sqlite_store():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    s = SqliteSessionStore(path)
    yield s
    s.close()
    try:
        os.unlink(path)
    except OSError:
        pass


# --- shared behavior -----------------------------------------------------

@pytest.fixture(params=["mem", "sqlite"])
def store_impl(request, mem_store, sqlite_store):
    return mem_store if request.param == "mem" else sqlite_store


class TestStoreContract:
    """Behavior every store impl must satisfy."""

    def test_get_or_create_is_idempotent(self, store_impl):
        a = store_impl.get_or_create("abc")
        b = store_impl.get_or_create("abc")
        assert a is b
        assert a.id == "abc"

    def test_get_returns_none_for_unknown(self, store_impl):
        assert store_impl.get("nope") is None

    def test_drop_removes_session(self, store_impl):
        sess = store_impl.get_or_create("x")
        sess.add_message("user", "hi")
        store_impl.save(sess)
        store_impl.drop("x")
        assert store_impl.get("x") is None


# --- SQLite-specific durability -----------------------------------------

class TestSqliteDurability:
    def test_save_then_reload(self, sqlite_store):
        sess = sqlite_store.get_or_create("alice")
        sess.add_message("user", "你好")
        sess.add_message("assistant", "[VOICE]\n[CONF]0.7[/CONF]\nhi\n[/VOICE]")
        sess.foundation = "we are testing."
        sess.scratchpad = "core_question: 测试持久化\npending: 还没确认 X"
        sess.sense = {"certainty": 0.42, "resonance": 0.91}
        sess.turn = 3
        sess.clarity = 0.55
        sess.drift = "目标人群没收敛"
        sess.seed = "我希望它短到我一眼能看完"
        sqlite_store.save(sess)

        # Drop the cache, re-read
        sqlite_store._cache.clear()
        loaded = sqlite_store.get("alice")

        assert loaded is not None
        assert loaded.foundation == "we are testing."
        assert loaded.scratchpad == "core_question: 测试持久化\npending: 还没确认 X"
        assert loaded.sense == {"certainty": 0.42, "resonance": 0.91}
        assert loaded.turn == 3
        assert loaded.clarity == 0.55
        assert loaded.drift == "目标人群没收敛"
        assert loaded.seed == "我希望它短到我一眼能看完"
        assert loaded.messages == [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "[VOICE]\n[CONF]0.7[/CONF]\nhi\n[/VOICE]"},
        ]

    def test_save_replaces_messages_atomically(self, sqlite_store):
        sess = sqlite_store.get_or_create("bob")
        sess.add_message("user", "first")
        sess.add_message("assistant", "second")
        sqlite_store.save(sess)

        sess.messages = [{"role": "user", "content": "only"}]
        sqlite_store.save(sess)

        sqlite_store._cache.clear()
        loaded = sqlite_store.get("bob")
        assert [m["content"] for m in loaded.messages] == ["only"]

    def test_reset_clears_persisted_state(self, sqlite_store):
        sess = sqlite_store.get_or_create("carol")
        sess.add_message("user", "x")
        sess.foundation = "something"
        sess.scratchpad = "core_question: 还在迭代"
        sess.clarity = 0.7
        sess.drift = "drift x"
        sess.seed = "seed y"
        sqlite_store.save(sess)

        sess.reset()
        sqlite_store.save(sess)

        sqlite_store._cache.clear()
        loaded = sqlite_store.get("carol")
        assert loaded.messages == []
        assert loaded.foundation == ""
        assert loaded.scratchpad == ""
        assert loaded.sense == {"certainty": 0.5, "resonance": 0.5}
        assert loaded.clarity == 0.0
        assert loaded.drift == ""
        assert loaded.seed == ""

    def test_sessions_are_isolated(self, sqlite_store):
        a = sqlite_store.get_or_create("a")
        b = sqlite_store.get_or_create("b")
        a.add_message("user", "I'm A")
        b.add_message("user", "I'm B")
        sqlite_store.save(a)
        sqlite_store.save(b)

        sqlite_store._cache.clear()
        loaded_a = sqlite_store.get("a")
        loaded_b = sqlite_store.get("b")
        assert loaded_a.messages[0]["content"] == "I'm A"
        assert loaded_b.messages[0]["content"] == "I'm B"

    def test_in_memory_db_persists_within_lifetime(self):
        s = SqliteSessionStore(":memory:")
        try:
            sess = s.get_or_create("eve")
            sess.add_message("user", "hi")
            s.save(sess)
            s._cache.clear()
            loaded = s.get("eve")
            assert loaded is not None
            assert loaded.messages == [{"role": "user", "content": "hi"}]
        finally:
            s.close()

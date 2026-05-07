"""Tests for the judge router's marker-stripping and payload-building."""

from routers.judge import _build_judge_user_payload, _strip_markers
from store import Session


class TestStripMarkers:
    def test_removes_voice_with_conf(self):
        text = "[VOICE]\n[CONF]0.7[/CONF]\nhello\n[/VOICE]"
        out = _strip_markers(text)
        assert out == "hello"

    def test_removes_foundation_block(self):
        text = "stuff\n[FOUNDATION]\nwe know.\n[/FOUNDATION]\nmore"
        out = _strip_markers(text)
        assert "we know" not in out
        assert "[FOUNDATION]" not in out

    def test_removes_sense_block(self):
        text = "[VOICE]\n[CONF]0.5[/CONF]\nhi\n[/VOICE]\n[SENSE]\ncertainty: 0.8\n[/SENSE]"
        out = _strip_markers(text)
        assert out == "hi"


class TestBuildJudgePayload:
    def test_includes_foundation_and_recent(self):
        sess = Session(id="x")
        sess.foundation = "我们要做的是 IM 节奏的轻量工作台。"
        sess.add_message("user", "刚才说的简报应该多长？")
        sess.add_message(
            "assistant",
            "[VOICE]\n[CONF]0.7[/CONF]\n短到一眼能看完。\n[/VOICE]\n\n"
            "[FOUNDATION]\n简报短，一眼可看完。\n[/FOUNDATION]",
        )

        out = _build_judge_user_payload(sess)
        assert "IM 节奏的轻量工作台" in out
        assert "刚才说的简报应该多长" in out
        # Marker leakage shouldn't appear
        assert "[VOICE]" not in out
        assert "[FOUNDATION]" not in out
        assert "[CONF]" not in out
        # Stripped voice content should
        assert "短到一眼能看完" in out

    def test_handles_empty_foundation(self):
        sess = Session(id="x")
        sess.add_message("user", "随便聊点什么")
        out = _build_judge_user_payload(sess)
        assert "暂无" in out
        assert "随便聊点什么" in out

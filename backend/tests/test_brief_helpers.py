"""Tests for the brief router's marker-stripping and history-formatting helpers."""

from routers.brief import _format_history, _strip_markers


class TestStripMarkers:
    def test_removes_voice_wrappers(self):
        out = _strip_markers("[VOICE]\nhello\n[/VOICE]")
        assert out == "hello"

    def test_removes_full_foundation_block(self):
        text = "stuff\n[FOUNDATION]\nwe know.\n[/FOUNDATION]\nmore"
        out = _strip_markers(text)
        assert "we know" not in out
        assert "[FOUNDATION]" not in out
        assert "stuff" in out and "more" in out

    def test_removes_sense_block(self):
        out = _strip_markers("[VOICE]hi[/VOICE]\n[SENSE]certainty: 0.8[/SENSE]")
        assert out == "hi"

    def test_handles_multiple_voices(self):
        text = "[VOICE]a[/VOICE]\n\n[VOICE]b[/VOICE]"
        # Two voices collapse to "a\n\nb" (markers stripped, content joined).
        assert "a" in _strip_markers(text)
        assert "b" in _strip_markers(text)


class TestFormatHistory:
    def test_user_and_assistant_labelled(self):
        history = [
            {"role": "user", "content": "want to make X"},
            {"role": "assistant", "content": "[VOICE]\nlike Y\n[/VOICE]"},
        ]
        out = _format_history(history)
        assert "用户：want to make X" in out
        assert "AI：like Y" in out

    def test_skips_empty_content(self):
        out = _format_history([{"role": "user", "content": "  "}])
        assert out == ""

    def test_skips_system_role(self):
        out = _format_history(
            [{"role": "system", "content": "internal"}, {"role": "user", "content": "hi"}]
        )
        assert "internal" not in out
        assert "hi" in out

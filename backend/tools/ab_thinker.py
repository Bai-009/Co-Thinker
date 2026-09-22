"""对比两份 thinker 提示词：同样的几句人话，各自独立跑一轮对话，打印浮现、CONF、耗时。

用法（在 backend/ 下）：
    .venv/bin/python tools/ab_thinker.py thinker_v1 thinker "第一句" "第二句" ...
没有 rewriter，地基为空，只看浮现本身。密钥从 .env 读，不打印。
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from llm import call_options, chat_completion_stream  # noqa: E402
from sse import StreamParser, parse_clamped_float  # noqa: E402
from store import Session, load_prompt, with_principles  # noqa: E402


async def one_turn(prompt_name: str, session: Session) -> tuple[str, float, float]:
    system = with_principles(load_prompt(prompt_name))
    messages = [{"role": "system", "content": system}, *session.messages]
    parser = StreamParser()
    voice, conf = "", 0.5
    started = time.monotonic()
    async for chunk in chat_completion_stream(messages, **call_options("thinker")):
        for ev in parser.feed(chunk):
            if ev.block == "voice" and ev.kind == "block_delta":
                voice += ev.content
            elif ev.block == "conf" and ev.kind == "block_end":
                pass
            elif ev.block == "conf" and ev.kind == "block_delta":
                conf = parse_clamped_float(ev.content, conf)
    for ev in parser.flush():
        if ev.block == "voice" and ev.kind == "block_delta":
            voice += ev.content
    return voice.strip(), conf, time.monotonic() - started


async def main(a: str, b: str, lines: list[str]) -> None:
    for name in (a, b):
        print(f"\n===== {name}")
        session = Session(id=f"ab-{name}")
        for line in lines:
            session.add_message("user", line)
            voice, conf, secs = await one_turn(name, session)
            session.add_message("assistant", f"[VOICE][CONF]{conf:.2f}[/CONF]\n{voice}[/VOICE]")
            print(f"\n人：{line}\n浮现（CONF {conf:.2f}，{secs:.1f}s，{len(voice)} 字）：\n{voice}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3:]))

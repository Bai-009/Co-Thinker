"""显示给人看的字的机械检查。

提示词里的写法规矩，模型不一定照做（顿号接「但」的规矩带着例子也只对一部分）。
能用程序判定的几条在这里查：
- 顿号后面接连词：、但 / 、不是 / 、而是 / 、并 / 、且 / 、或 / 、还是 / 、却；
- 破折号；
- 反引号、加粗符号；
- 「vs」。

只查这一版新写的字：散文，清单里新出现的条目和这一版刚划掉的条目的取代理由，
scratchpad 里会显示出来的三个字段。上一版原文照抄下来的条目不查，免得旧错卡住整轮。
违规以中文短句返回，可以直接回给模型让它改。
"""

from __future__ import annotations

import re

from foundation import parse_items

_RULES = (
    (re.compile(r".{0,6}、(?:但是|但|不是|而是|而不是|而|并且|并|且|或者|或|还是|却).{0,6}"), "顿号后面接了连词，这里该用逗号"),
    (re.compile(r".{0,6}[—–]+.{0,6}"), "用了破折号，改成逗号或句号"),
    (re.compile(r".{0,6}`.{0,6}"), "用了反引号，代码直接写在句子里"),
    (re.compile(r".{0,6}\*\*.{0,6}"), "用了加粗符号"),
    (re.compile(r".{0,6}\bvs\b.{0,6}"), "用了「vs」"),
)
_ITEM_PREFIX_RE = re.compile(r"^\s*\d+[\.、．]\s*")
SHOWN_FIELDS = ("core_question", "proposed_directions", "pending_conflict")
MAX_PROBLEMS = 8


def _field(scratchpad: str, key: str) -> str:
    for line in (scratchpad or "").splitlines():
        if line.strip().startswith(key + ":"):
            return line.split(":", 1)[1].strip()
    return ""


def check_writing(narrative: str, old_list: str, new_list: str, scratchpad: str) -> list[str]:
    """返回写法问题的说明；空列表表示没查出问题。"""
    problems: list[str] = []

    def scan(where: str, text: str) -> None:
        for rule, why in _RULES:
            for m in rule.finditer(text or ""):
                problems.append(f"{where}「{m.group(0).strip()}」：{why}")

    scan("散文里", narrative)
    old = {it.num: it for it in parse_items(old_list)}
    for it in parse_items(new_list):
        prev = old.get(it.num)
        if prev is None:
            scan(f"清单第 {it.num} 条", _ITEM_PREFIX_RE.sub("", it.raw))
        elif it.struck and not prev.struck and "→" in it.raw:
            scan(f"清单第 {it.num} 条的取代理由", it.raw.split("→", 1)[1])
    for key in SHOWN_FIELDS:
        scan(f"scratchpad 的 {key}", _field(scratchpad, key))
    return problems[:MAX_PROBLEMS]


def describe_writing_for_model(problems: list[str]) -> str:
    """把写法问题拼成回给模型的一段话。"""
    lines = "\n".join(f"- {p}" for p in problems)
    return (
        "上一次输出的写法有几处不合要求：\n"
        f"{lines}\n\n"
        "规矩：顿号只用在并列的词之间，「但」「不是」「而是」「还是」前面用逗号；"
        "不用破折号，改成逗号或句号；不用反引号和加粗；不用「vs」。"
        "只改这几处，其余一字不动，按同样的顺序重新输出全部块。"
    )

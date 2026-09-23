"""地基清单的棘轮（ratchet）。

rewriter 每轮把整份清单重写一遍，这是刻意的：全局校验，不打补丁。
棘轮让重写变得安全：清单只许追加和取代，不许无声地丢、改、重编号。

规则（对上一版里每一条）：
- 编号必须还在；
- 生效条目要么原文不变，要么划掉并指向取代它的新条；
- 已划掉的条目保持划掉，原文不变；
- 编号唯一，新条的编号接在旧的最大编号之后；
- 「被 #N 取代」指向的条目必须存在。

违规以中文短句返回，可以直接回给模型让它重来。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_ITEM_RE = re.compile(r"^\s*(\d+)[\.、．]\s*(.*?)\s*$")
_STRUCK_RE = re.compile(r"^~~(.*?)~~\s*(.*)$", re.S)
_POINTER_RE = re.compile(r"#\s*(\d+)")


@dataclass
class Item:
    num: int
    text: str
    struck: bool
    replaced_by: int | None
    raw: str


def parse_items(text: str) -> list[Item]:
    """把「1. …」「2. ~~…~~ → 被 #4 取代（理由）」这样的行解析成条目。其他行忽略。"""
    items: list[Item] = []
    for line in (text or "").splitlines():
        m = _ITEM_RE.match(line)
        if not m:
            continue
        num = int(m.group(1))
        body = m.group(2)
        sm = _STRUCK_RE.match(body)
        if sm:
            pm = _POINTER_RE.search(sm.group(2))
            items.append(Item(num, sm.group(1).strip(), True, int(pm.group(1)) if pm else None, line))
        else:
            items.append(Item(num, body.strip(), False, None, line))
    return items


def _norm(text: str) -> str:
    # 中文正文里空白和强调符号没有信息量，只比字。
    return re.sub(r"[\s*_`]+", "", text).rstrip("。．.；;，,")


def check_ratchet(old_text: str, new_text: str) -> list[str]:
    """比较新旧清单，返回违规说明；空列表表示通过。"""
    old = parse_items(old_text)
    new = parse_items(new_text)
    problems: list[str] = []

    new_by: dict[int, Item] = {}
    for it in new:
        if it.num in new_by:
            problems.append(f"编号 {it.num} 出现了两次，编号要唯一")
        new_by[it.num] = it

    old_nums = {o.num for o in old}
    old_max = max(old_nums, default=0)

    for o in old:
        n = new_by.get(o.num)
        if n is None:
            problems.append(f"第 {o.num} 条不见了（原文：「{o.text[:40]}」）；旧条目不能删，最多划掉")
            continue
        if o.struck:
            if not n.struck:
                problems.append(f"第 {o.num} 条原本已划掉，不能恢复成生效条目")
            elif _norm(n.text) != _norm(o.text):
                problems.append(f"第 {o.num} 条划掉的原文被改了，划掉的字要原样保留")
            continue
        if n.struck:
            if n.replaced_by is None:
                problems.append(f"第 {o.num} 条被划掉了，但没有写「→ 被 #N 取代（理由）」")
            elif n.replaced_by not in new_by:
                problems.append(f"第 {o.num} 条写着被 #{n.replaced_by} 取代，但第 {n.replaced_by} 条不存在")
            elif _norm(n.text) != _norm(o.text):
                problems.append(f"第 {o.num} 条划掉时原文被改了，划掉的字要和原来一模一样")
        elif _norm(n.text) != _norm(o.text):
            problems.append(
                f"第 {o.num} 条的措辞被改了；生效条目原样保留，要改就把它划掉并新增一条"
            )

    for it in new:
        if it.num in old_nums:
            continue
        if it.num <= old_max:
            problems.append(f"第 {it.num} 条是新条目，但编号没有接在 {old_max} 之后")
        if it.struck and it.replaced_by is not None and it.replaced_by not in new_by:
            problems.append(f"第 {it.num} 条指向的 #{it.replaced_by} 不存在")

    return problems


def describe_for_model(problems: list[str]) -> str:
    """把违规点拼成回给模型的一段话。"""
    lines = "\n".join(f"- {p}" for p in problems)
    return (
        "上一次输出没有通过地基清单的校验：\n"
        f"{lines}\n\n"
        "清单的纪律是：上一版的每条都保留编号；生效的条目原文照抄；要改一条就把它划掉，"
        "写「→ 被 #N 取代（一句理由）」，再用新编号追加新条；新编号接在旧的最大编号之后。"
        "请按同样的顺序重新输出全部块。"
    )

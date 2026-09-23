from foundation import check_ratchet, describe_for_model, parse_items

OLD = (
    "1. 我们要做的是 Python 学习网站，核心是摸懂原理而非死记语法。\n"
    "2. 用 AI 边写边学，工具用 Cursor。\n"
    "3. 第一个最小页面：原理-代码对照卡。"
)


def test_parse_struck_and_pointer():
    items = parse_items("1. A。\n2. ~~B~~ → 被 #3 取代（理由）\n3. C。")
    assert [(i.num, i.struck, i.replaced_by) for i in items] == [(1, False, None), (2, True, 3), (3, False, None)]
    assert items[1].text == "B"


def test_verbatim_and_append_pass():
    assert check_ratchet(OLD, OLD + "\n4. 先做前端原型再补后端。") == []


def test_supersede_pass():
    new = (
        "1. 我们要做的是 Python 学习网站，核心是摸懂原理而非死记语法。\n"
        "2. ~~用 AI 边写边学，工具用 Cursor。~~ → 被 #4 取代（明确了顺序）\n"
        "3. 第一个最小页面：原理-代码对照卡。\n"
        "4. 先做前端原型再补后端，工具用 Cursor。"
    )
    assert check_ratchet(OLD, new) == []


def test_drop_change_and_reuse_fail():
    dropped = "\n".join(OLD.splitlines()[:2])
    assert any("第 3 条不见了" in p for p in check_ratchet(OLD, dropped))
    reworded = OLD.replace("摸懂原理", "理解原理")
    assert any("第 1 条的措辞被改了" in p for p in check_ratchet(OLD, reworded))
    struck_without_pointer = OLD.replace("2. 用 AI 边写边学，工具用 Cursor。", "2. ~~用 AI 边写边学，工具用 Cursor。~~")
    assert any("没有写" in p for p in check_ratchet(OLD, struck_without_pointer))
    assert any("出现了两次" in p for p in check_ratchet(OLD, OLD + "\n2. 又一条"))
    assert any("没有接在 3 之后" in p for p in check_ratchet(OLD, OLD.replace("3. 第一个", "3. 第一个") + "\n0. 插队"))


def test_whitespace_and_emphasis_ignored():
    assert check_ratchet(OLD, OLD.replace("Python 学习网站", "**Python学习网站**")) == []


def test_empty_old_passes_anything():
    assert check_ratchet("", "1. 新的。") == []
    assert check_ratchet("（这是对话开始，地基为空）", "1. 新的。") == []


def test_describe_mentions_each_problem():
    text = describe_for_model(["第 3 条不见了"])
    assert "第 3 条不见了" in text and "重新输出全部块" in text


def test_punctuation_only_changes_pass():
    old = "1. 给会照着写、但不知道的人做。"
    assert check_ratchet(old, "1. 给会照着写，但不知道的人做。") == []
    assert any("措辞被改了" in p for p in check_ratchet(old, "1. 给会照着写，但不懂的人做。"))

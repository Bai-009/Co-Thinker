from writing import check_writing, describe_writing_for_model


def test_finds_comma_dash_backtick_in_new_text():
    problems = check_writing("给会照着写、但不知道的人做。用 `a = b` 演示——不讲内存。", "", "1. 一条。", "core_question: 先做前端、还是先做后端")
    joined = " ".join(problems)
    assert "顿号" in joined and "破折号" in joined and "反引号" in joined and "core_question" in joined


def test_old_items_are_not_checked_but_new_ones_are():
    old = "1. 给会照着写、但不知道的人做。"
    new = old + "\n2. 先做前端、并且不接后端。"
    problems = check_writing("散文。", old, new, "")
    assert len(problems) == 1 and "第 2 条" in problems[0]


def test_new_pointer_reason_is_checked():
    old = "1. 用 Cursor。"
    new = "1. ~~用 Cursor。~~ → 被 #2 取代（换了工具——用 Claude）\n2. 用 Claude。"
    assert any("取代理由" in p for p in check_writing("", old, new, ""))


def test_clean_text_passes():
    assert check_writing("给会照着写，但不知道的人做。", "", "1. 前端、后端都要。", "proposed_directions: 先做 A 还是先做 B") == []


def test_describe_lists_each():
    text = describe_writing_for_model(["散文里「写、但不」：顿号后面接了连词"])
    assert "写、但不" in text and "重新输出全部块" in text

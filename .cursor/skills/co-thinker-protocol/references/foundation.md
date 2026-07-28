# Foundation — 自我重写的地基

每轮 voice 之后更新 `.cothinker/<slug>/foundation.md`。
地基有四种区块：**Narrative / List / Plan / Scratchpad**（可附 Sense）。

## 双向确认硬规则（写入纪律）

地基 list 里只能放真正双向确认过的共识：

| 来源 | 能否进 list |
|------|-------------|
| 人自己说出来的 | ✓ |
| 模型提出后，人明确确认（对 / 可以 / 就这样 / 基于此继续） | ✓ |
| 模型刚提、人还没回应 | ✗ → `proposed_directions` |
| 反复提及但人从未表态 | ✗ → `proposed_directions` |

新话题开局 list 往往只有 1 条（原始陈述），其余在 `proposed_directions`——这是正常的。

## Narrative（给人读）

- 第一人称复数「我们」，或省略主语
- 3–5 句连贯散文：走到哪了 + 张力 + 还没解决的是什么
- **禁止 source 归因**（「用户说…」「AI 提了…」）
- 不是 list 的念一遍；写 list 装不下的连接组织

## List（机械可检查）

- 编号共识；每条 1–3 句、原子化、独立可读
- 被覆盖的旧条不删：`~~旧~~ → 被 #N 取代（理由）`
- 同样禁止 source 归因

## Plan（仅在值得拆阶段时）

复杂到需要多步 hand off 时才填；否则留空。

```markdown
- [ ] 可独立交给执行的工作单元
- [x] 已完成的项
```

- 写动作，不写「想清楚 X」
- **不许擅自把 `[ ]` 改成 `[x]`**——必须有明确完成信号
- 未共识的项不要进 plan（那是 `proposed_directions`）

## Scratchpad（内部状态，key: value）

重复 key 时新值替换旧值。常用字段：

- `core_question` — 这一轮在追的核心
- `where_we_stand` — novice / intermediate / expert + 一句说明（描述**我们**进入话题的层次，不是评判某一方）
- `proposed_directions` — 已提出未确认的方案
- `pending_conflict` — 真矛盾；下一 voice 必须打断确认
- `target_user` — 仅当产品有真第三方受众时
- `last_revise` — 上一轮改了哪条共识

## 冲突处理

对每条**当前生效**共识问：这一轮是否冲突？

- **平滑覆盖**（同向精化）→ 旧条删除线标注，append 新条
- **真矛盾**（不能同时成立）→ 不动 list；写 `pending_conflict`
- **无冲突** → 保留；再检查是否有新共识可 append

处理完 `pending_conflict` 的回答后：按选择更新 list，并删掉该 scratchpad 字段。

## Sense（可选）

- `certainty` 0–1：这一轮推进有多确定
- `resonance` 0–1：是否站在同一个具体问题上
用满量程；每轮都 0.85 = 敷衍。

## 文件写入

保持 `assets/foundation-template.md` 的区块标题结构，便于下一轮再读。
不要在 chat 里输出 marker 协议块；文件本身用人类可读 markdown。

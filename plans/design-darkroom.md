# Co-Thinker 暗室编辑视觉方案

## 核心理念
以减法定 elegance，用留白唤创造力，借微动造沉浸。

## 色彩系统

| Token | 值 | 用途 |
|-------|-----|------|
| --bg | #0c0c0d | 主背景，极深炭黑 |
| --surface | #131314 | 面板/输入框背景 |
| --surface-hover | #19191b | hover 状态表面 |
| --ink | #e2e2de | 主文字，暖白 |
| --ink-soft | #94948c | 次要文字 |
| --ink-muted | #52524c | 弱化文字 |
| --ink-faint | #363632 | 极弱文字/placeholder |
| --line | rgba(226,226,222,0.05) | 细线边框 |
| --line-strong | rgba(226,226,222,0.10) | hover 线色 |
| --accent | #6b7d8c | 冷灰 accent，流式/活跃状态 |
| --think-ink | #6a7068 | 侧栏思考文字 |
| --think-bg | rgba(107,125,140,0.03) | 侧栏活跃背景 |

## 排版系统

三体混排：
- **Sans** (`Inter`, `PingFang SC`): 对话正文、界面元素
- **Mono** (`JetBrains Mono`): 思考侧栏、代码、技术数据
- **Serif** (`Source Han Serif SC`): 空状态引言

## 形态原则

- 圆角：`--radius: 2px`，几乎直角
- 消息气泡 → 扁平排版块
- AI 消息：左侧 1px 细线作为唯一装饰
- 用户消息：右对齐，文字弱化，无边框无背景

## 动态原则

| 效果 | 参数 |
|------|------|
| 消息入场 | opacity + 4px translateY, 400ms, cubic-bezier(0.16,1,0.3,1) |
| 存在呼吸 | 4px 点, opacity 0.15↔0.5, 3s |
| 光标 | opacity 淡入淡出, 2s |
| 打字指示 | 3px 点, opacity 0.15↔0.45, 2s |
| 边框 hover | 300ms ease 色值渐变 |

## 布局网格

- 主区域 padding: `clamp(24px, 8vw, 120px)`
- 消息间距: `32px`
- 侧栏宽度: `minmax(300px, 380px)`
- Topbar/Composer: 毛玻璃 `blur(20px) saturate(1.2)`

## 文件实施清单

1. `frontend/src/index.css` — 完整替换为暗室样式
2. `frontend/index.html` — 加入 Google Fonts 链接
3. `mockup-darkroom.html` — 独立预览文件

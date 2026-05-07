# Co-Thinker

> *We can know more than we can tell.* — Polanyi

A thinking-partner LLM workspace where the *subject* of a session is **the thinking activity itself** — not the user, not the AI alone. Each turn produces a voice in the foreground while a self-revising "foundation" of consensus is metabolized in the background. When ready, one click distills the whole conversation into an execution brief shaped for hand-off to coding agents.

[中文](#中文-readme) · [English](#english-readme)

---

## English README

### Two timelines, not one

A turn runs on two independent clocks, deliberately decoupled:

- **Thinker (foreground, streamed).** Reads full session context, emits a `[VOICE]` block (1-3 sentences typical, with a `[CONF]` self-rating) or `[SILENCE]`. The SSE stream closes the moment the thinker finishes — the user can immediately type the next message.

- **Metabolize (background, detached).** Foundation rewriter + judge run together as an `asyncio` task that survives past the request. A per-session async lock serializes concurrent turns' rewrites. The frontend learns about new foundation / clarity via light polling — no one is forced to *watch* the metabolism happen.

This split is why Co-Thinker can keep IM rhythm without losing the metacognitive layer. Folding both into one synchronous stream gates user interaction on metabolic latency; separating them lets each run at its correct cadence.

### The philosophical root

[backend/prompts/principles.md](backend/prompts/principles.md) is the load-bearing document for every prompt, field name, and UI string. The core position:

> 主体是这次思考活动本身。"我们" 不是社交礼貌，是物理事实——这个思考活动只能由两边的能力共同完成。

Three taboos every prompt and UI string is checked against:

- **a. Objectifying the human side** — "用户希望…", "用户的认知是 novice"
- **b. AI self-centering** — "我建议你…", "AI 的工作是…"
- **c. Oppositional framing** — "你 vs 我", "我替你判断"

Read it before changing prompts.

### Standout features

| Feature | Lives in |
|---|---|
| **Self-revising foundation** (numbered list + prose narrative, written together every turn) | [backend/prompts/foundation_rewriter.md](backend/prompts/foundation_rewriter.md) — the "double-confirmation hard rule" keeps unconfirmed thinker proposals out of the foundation; they go to scratchpad's `proposed_directions` instead. |
| **Single-thinker turn** | [backend/prompts/thinker.md](backend/prompts/thinker.md) — IM rhythm enforced (1-3 sentences default), three legal forms (确认 / 关键岔路问题 / 微展开), strict prohibitions on premature solving and jargon-dumping. |
| **Streaming marker parser** | [backend/sse.py](backend/sse.py) — chunk-aware state machine that handles markers split across SSE chunks; tested in [backend/tests/test_sse.py](backend/tests/test_sse.py). |
| **2D felt-sense color space** | [frontend/src/lib/sense.js](frontend/src/lib/sense.js) — bilinear interpolation across 4 muted parchment corners driven by the model's self-reported certainty × resonance, blended via CSS `@property` transitions. |
| **Judge AI metacognition** | [backend/prompts/judge.md](backend/prompts/judge.md) — separate metacognitive pass producing clarity / drift / seed; drives grain density, foundation drift annotation, and composer ghost suggestion. |
| **Execution-brief distillation** | [backend/prompts/brief.md](backend/prompts/brief.md) — compresses the whole conversation into structured markdown ready to hand to Cursor / Lovable / Kimi. |
| **Per-session SQLite persistence** | [backend/store.py](backend/store.py) — `SqliteSessionStore` keyed by `X-Session-Id`; in-memory variant available for tests. |

### Architecture

```
  Browser (React 18 + Vite)
       │  fetch + ReadableStream
       │  X-Session-Id header (per-tab, localStorage)
       ▼
  ┌──────────────────────────────────────────────────────────┐
  │  FastAPI                                                 │
  │                                                          │
  │  POST /api/chat/workshop                                 │
  │       streams voice_start / voice_delta / voice_conf /   │
  │               voice_end / done                           │
  │       on done → asyncio.create_task(_metabolize_turn) ─┐ │
  │                                                        │ │
  │  (detached, per-session asyncio lock serializes turns) │ │
  │  metabolize: rewriter LLM → judge LLM → store.save  ◄──┘ │
  │                                                          │
  │  GET  /api/chat/foundation, /clarity, /sense  ← poll     │
  │  POST /api/chat/brief    streams the markdown brief      │
  │  GET  /api/chat/sessions, history, ...                   │
  └─────┬───────────────────────────────────────┬────────────┘
        │ session reads/writes                  │ LLM stream calls
        ▼                                       ▼
  SQLite (sessions + messages)         DeepSeek chat completions
```

### Tech stack

- **Backend**: Python 3.12 · FastAPI · httpx (streaming) · SQLite · pytest
- **Frontend**: React 18 · Vite · Vitest + Testing Library · plain `fetch` + `ReadableStream` (POST bodies need this; EventSource is GET-only)
- **LLM**: DeepSeek `chat-completions` (any OpenAI-compatible endpoint works)
- **Deploy**: Docker + Compose; nginx serves the SPA and proxies `/api`

### Local development

Prereqs: Python 3.10+, Node 18+.

```bash
# 1. Configure
cp .env.example .env
# Edit .env to set DEEPSEEK_API_KEY. Uncomment COTHINKER_DB for persistence
# (recommended for local dev — without it, sessions wipe on restart).

# 2. Backend
cd backend
pip install -r requirements.txt
python main.py            # http://127.0.0.1:8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev               # http://127.0.0.1:5173
```

### Docker

```bash
cp .env.example .env
docker compose up --build
# open http://localhost:8080
```

The backend persists its SQLite DB to a named volume (`cothinker-data`).

### Tests

```bash
cd backend && python -m pytest    # 50 passing
cd frontend && npm test            # 27 passing
```

### Project layout

```
backend/
  main.py              FastAPI entry, CORS, lifespan
  store.py             Session + InMemorySessionStore + SqliteSessionStore
                       + session_async_lock registry
  sse.py               StreamParser, marker constants, sse_event helper
  llm.py               DeepSeek client (sync + streaming)
  deps.py              X-Session-Id resolver
  models.py            Pydantic request models
  prompts/
    principles.md           The philosophical root — read first
    thinker.md              System prompt for the foreground thinker call
    foundation_rewriter.md  System prompt for the background rewriter
    judge.md                System prompt for the metacognitive judge
    brief.md                System prompt for execution-brief distillation
  routers/
    workshop.py             Thinker SSE; spawns _metabolize_turn background task
    judge.py                Standalone judge endpoint (fallback) + run_judge_inline helper
    brief.py                Execution-brief streaming
    session.py              history / foundation / sense / clarity / sessions list
  tests/                    pytest — sse parsing · store roundtrip · brief / judge helpers

frontend/
  src/
    App.jsx                 Slim orchestrator
    components/             Topbar · Composer · MessageView · Sidebar · BriefModal · FoundationModal
    hooks/
      useWorkshop.js        Drives the thinker SSE stream; unlocks UI on done
      useFoundationPoll.js  Polls /foundation /clarity /sense until metabolize settles
      useJudge.js           Holds clarity / drift / seed state (fed by the poll hook)
      useBrief.js           Drives the brief modal
      useConversations.js   Sidebar list + current id
    lib/                    sse · session · sense · api · messages (+ unit tests)
    index.css               Visual system — read the rules at the top before editing
docker-compose.yml          Backend + nginx-served frontend
```

### Configuration

| Env var | Default | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | *(required)* | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Any OpenAI-compatible endpoint |
| `DEEPSEEK_MODEL` | `deepseek-chat` | |
| `COTHINKER_DB` | *(unset → in-memory)* | Path to SQLite DB; `:memory:` for ephemeral; `../cothinker.db` recommended for local dev (lands at project root) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated CORS allowlist |
| `PORT` | `8000` | |
| `LOG_LEVEL` | `INFO` | |

---

## 中文 README

### 这是什么

Co-Thinker 是一个 LLM **思考伙伴**工作台。每次会话的主体是**这次思考活动本身**——不是用户、不是 AI。每一轮产生一段浮现 voice（1-3 句），然后在回看中沉淀出一段**会自我重写的"地基"**。准备好之后，一键把整场对话凝结成**执行简报**递给 Cursor / Lovable / Kimi 这类执行 agent。

### 两条独立时序，不是一条

一轮跑在两个相互独立的时间模型上：

- **Thinker（前台，流式）**：读完整 context，输出一个 `[VOICE]` 块（1-3 句、带 `[CONF]` 自评）或 `[SILENCE]`。**SSE 流在 thinker 一结束就关闭——用户可以立刻输入下一句**。

- **Metabolize（后台，分离）**：地基重写 + judge 在同一个 `asyncio` 任务里按序跑，**不跟请求一起死**。每个 session 一把异步锁串行化并发轮次的写入。前端轻量 polling 拿结果——没人被强迫"看着"消化。

这套拆分是 Co-Thinker 能保持 IM 节奏又不丢元认知层的关键。强行同步会让用户交互门控在元认知 LLM 延迟上；拆开让两者各自按正确节奏跑。

### 主体性的根

[backend/prompts/principles.md](backend/prompts/principles.md) 是所有 prompt、字段名、UI 文案的**根**。核心位置：

> 主体是这次思考活动本身。"我们"不是社交礼貌，是物理事实——这个思考活动只能由两边的能力共同完成。

三类违反，任一出现都必须改：

- **a. 对象化人这一边**——"用户希望…"、"用户的认知是 novice"
- **b. AI 自我中心化**——"我建议你…"、"AI 的工作是…"
- **c. 对立态**——"你 vs 我"、"我替你判断"

改 prompt 前先读这份。

### 项目亮点

- **会自我重写的地基**（散文 narrative + 编号清单 list 两种形态同步写）——双向确认硬规则把 thinker 单方提案挡在地基外，进 scratchpad 的 `proposed_directions`
- **单 thinker、IM 节奏**——默认 1-3 句，三种合法形态：确认 / 关键岔路问题 / 微展开
- **流式 marker 协议 + chunk-aware 解析器**——处理跨 chunk 切分的 marker
- **2D felt-sense 色彩空间**——bilinear 插值四角浅冷灰 / 奶白 / 淡薰衣草 / 暖沙，CSS `@property` 平滑过渡，hue 范围 ~6°
- **Judge AI 元认知**——独立 LLM pass 输出 clarity / drift / seed，驱动颗粒密度、地基悬浮注释、composer 幽灵提示
- **执行简报蒸馏**——把整次思考活动凝结成给执行 agent 的 markdown 心智简报
- **per-session SQLite 持久化**——`X-Session-Id` 头隔离会话

### 视觉系统

[frontend/src/index.css](frontend/src/index.css) 顶部声明了三条硬规则（"hard rule, not guideline"）：

1. **每个视觉通道一个信号，不交叉**——色温 ← certainty × resonance；质感 ← clarity；per-voice 存在感 ← confidence。**per-voice 信号绝对不用 hue**
2. **色域克制到 ~6° hue 范围**——5-阶 ink palette + 单一 accent 色相家族；整页读起来像同一张纸略变温/略变潮，绝不切换调色板
3. **Motion budget 分四档故意不同步**——12-20s 大气漂移 / 4-6s 状态切换 / 3-4s breathing / ≤ 600ms 交互；不允许两个长动画同周期

视觉比喻是**温暖的旧期刊纸**——Sidebar 是"装订线略浸湿"的目录页，Composer 是"被按压过的纸卡片"，Voice 是左侧 1px 墨水笔触，topbar 按钮是"editorial marginalia"（Lora italic, 无 chrome）。

### 架构、Tech stack、本地开发、Docker、测试

参见上面英文章节，命令一致。

### 关于 `.env`

`.env` 含 API key，**不要提交到 git**——`.gitignore` 已经排除了。SQLite DB 文件（`*.db`）和构建产物也都已 gitignore。

---

## License

MIT

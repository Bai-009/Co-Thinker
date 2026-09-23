# Co-Thinker

> *We can know more than we can tell.* — Polanyi

在对话里把想法说清，定下来的沉进地基，需要时一键凝成 Prompt，交给执行。

[作品集里有一段 1 分 19 秒的短片](https://github.com/Bai-009/portfolio#co-thinker)，从对话、地基一直演示到生成 Prompt 并复制，连着真实模型录的。

## 它是什么

你带着一个还没说清的想法进来，一边说一边想。回话是即时消息的节奏：一到三句，说完就把线断开，你马上能接着打字。

旁边有一份「地基」。你说过的、认下的，一轮轮沉进去；模型提的建议留在「待定」，你没点头它就不算共识。想清楚了，点一下「生成 Prompt」，整份地基和对话凝成一段能直接交出去的话，交给 Cursor、Claude Code 这类执行 AI。

## 它怎么工作

**两条时间线，故意分开。** 前台回话流式出来，说完就结束。后台整理慢一拍：另一个模型把这一轮说的东西整理进地基，好了界面再去取。回话不等整理，聊天的节奏才在。

**地基有两份。** 一份是给人读的散文，一份是给程序核对的编号清单。清单只许追加和取代，不许无声地丢、改、重编号；被取代的条目不划掉，挂在接替它的那条下面，读得出为什么改。清单每轮重写完，程序逐条核对，不合格退回模型重写。

**只有双方确认过的才进地基。** 你自己说的目标、偏好、决定，或者模型提出后你明确认下的，才写进清单；模型这一轮刚提的留在待定。真矛盾不悄悄改，下一轮先问你保留哪个。

**引用不代表认同。** 对话里的一句、地基里的一条，都能拉回来继续说。引文标着来源进正文，四个读对话的模型都看得到；原文改了，引用会说「依据已改变」。

**显示给人看的字按中文常态写。** 顿号只用在并列的词之间，不用破折号，不用系统里的词。地基里写错了，程序查得出来的几条会退回模型改。

思路的根在 [backend/prompts/principles.md](backend/prompts/principles.md)：每次会话的主体是这次思考活动本身，不是用户，也不是 AI。改提示词前先读它。

## 自己跑起来

需要 Python 3.10 以上、Node 18 以上，和一把 DeepSeek 的密钥。

```bash
cp .env.example .env          # 填 DEEPSEEK_API_KEY；端口用 PORT，前后端都读它
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python3 main.py
cd co-thinker-ui && npm install && npm run dev      # 打开 http://127.0.0.1:5180/?live
```

不带 `?live` 打开的是示例模式：浏览器里跑一套写好的对话，不连模型，用来看界面。

用 Docker：

```bash
cp .env.example .env
docker compose up --build     # 打开 http://localhost:8080
```

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 必填 | DeepSeek 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 任何 OpenAI 兼容的地址都行 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 回话、整理、Prompt 三个角色用 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | 只有判官用 |
| `COTHINKER_<ROLE>_THINKING` | `1` | 按角色开关思考模式，ROLE 是 THINKER / REWRITER / BRIEF / JUDGE；开着时 `temperature` 不生效 |
| `COTHINKER_<ROLE>_EFFORT` | 回话 `low`，其余 `high` | 思考档位 `low` / `high` / `max`。回话开 `high` 第一个字平均要等 7.8 秒，`low` 档 3 到 5 秒 |
| `COTHINKER_<ROLE>_TEMPERATURE` | 模型默认 `1.0` | 只在思考模式关着时生效 |
| `COTHINKER_THINKER_RETRIES` | `1` | 回话还没出字就失败时，静默重来一次 |
| `COTHINKER_REWRITER_RETRIES` | `2` | 清单没过核对、写法不合要求时，退回重写几次 |
| `COTHINKER_CONTEXT_LAYOUT` | `tail` | `tail`：固定指令在前，当前地基贴在最新一句前面；`head`：地基放在系统提示里 |
| `COTHINKER_JUDGE` | `0` | 每次地基更新后再跑一遍判官 |
| `COTHINKER_DB` | 不设则存内存 | SQLite 路径。本地开发建议 `../cothinker.db`，落在仓库根目录，已忽略不入库 |
| `ALLOWED_ORIGINS` | `http://localhost:5180,http://127.0.0.1:5180` | 跨域白名单。开发和 Docker 都经代理同源访问，一般用不到 |
| `PORT` | `8000` | 后端端口，前端代理读同一个值 |
| `LOG_LEVEL` | `INFO` | |

## 仓库里有什么

```
backend/                 FastAPI 后端
  routers/workshop.py      回话的流式接口；回话落定后把整理排进后台
  routers/brief.py         生成 Prompt
  routers/judge.py         判官（默认关）
  foundation.py            清单的核对规则：只许追加和取代
  writing.py               写法的机械检查
  sse.py                   流式标记的解析器
  llm.py                   DeepSeek 调用，按角色记 token 和耗时
  store.py                 会话与地基的存储（SQLite 或内存）
  prompts/                 四个角色的提示词，principles.md 是根
co-thinker-ui/           界面（React + Vite），说明见 co-thinker-ui/README.md
docs/、plans/            早期的设计记录
```

## 测试

```bash
cd backend && .venv/bin/python3 -m pytest      # 94 个用例
cd co-thinker-ui && npm test                   # 73 个用例
```

## English

Co-Thinker is a thinking-partner workspace. You talk an idea through in IM rhythm; what the two sides settle on sinks into a self-revising foundation (a prose account for reading, a numbered list for mechanical checks), while the model's own proposals wait as pending. One click distills the whole conversation into a first-person brief for a coding agent. Backend: FastAPI + DeepSeek. Frontend: React + Vite. `backend/prompts/principles.md` states the stance every prompt is written from.

## License

MIT

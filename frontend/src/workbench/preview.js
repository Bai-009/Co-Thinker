// Deterministic interaction fixture. Never calls a model or the live API.
export const isPreview = () =>
  new URLSearchParams(window.location.search).get("preview") === "1";
const KEY = "cothinker.preview.v2";
export const previewSeedId = "preview-shared-desk";
const opening = [
  {
    role: "user",
    content:
      "我想做一个让人和 AI 一起想事情的地方。就像两个人坐在咖啡馆，一边聊，一边把想法留在同一张纸上。",
  },
  {
    role: "assistant",
    content:
      "[VOICE]那张纸让两个人有了**可以一起指着讨论的东西**。有时是一个结论，有时只是还不满意的一句话。\n\n我觉得值得保留的，是想法仍然可以被对方改变的状态。[/VOICE]",
  },
  {
    role: "user",
    content:
      "它不能只是附和我。我希望它也能提出我没想到的东西，但不要一下子说太多，把我的思路盖过去。",
  },
  {
    role: "assistant",
    content:
      "[VOICE]我觉得关键是：**它说出来的东西，你愿不愿意接着想。**\n\n一句有根据的反例，可能比五个问题更能打开思路。我们可以先看：什么时候一个反例是在帮助思考，什么时候又变成了抢话？[/VOICE]",
  },
];
const baseNotes = {
  foundation:
    "1. 对话是共同思考的场所，不要求一开始就有明确目标。\n2. AI 应带来新视角，也给人留下回应和改变方向的空间。",
  foundation_narrative:
    "我们想保留咖啡馆里交流的松弛感，同时让 AI 有自己的判断。眼下在讨论的是：怎样既有启发，又不抢走思考的主动权。",
  focus: "怎样让 AI 真正参与思考？",
  open_questions: ["AI 在什么情况下应追问，什么情况下应给出判断？"],
  plan: "",
  revision_count: 2,
  memory: { state: "ready", covered_messages: 4, total_messages: 4 },
};
let db;
try {
  db = JSON.parse(localStorage.getItem(KEY));
} catch {}
if (!db || typeof db !== "object" || !db[previewSeedId])
  db = {
    [previewSeedId]: {
      id: previewSeedId,
      title: "让 AI 成为思考的伙伴",
      messages: opening,
      notes: baseNotes,
      updated_at: Date.now() / 1000,
    },
  };
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {}
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const abort = () => new DOMException("Aborted", "AbortError");
const delay = (ms, signal) =>
  new Promise((res, rej) => {
    if (signal?.aborted) return rej(abort());
    const done = () => {
      signal?.removeEventListener("abort", cancel);
      res();
    };
    const t = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(t);
      rej(abort());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
function json(data, id) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      ...(id ? { "X-Session-Id": id } : {}),
    },
  });
}
function eventStream(id, signal, run) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        const emit = (e) => {
          if (signal?.aborted) throw abort();
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        };
        try {
          await run(emit);
        } catch (e) {
          if (e.name !== "AbortError") controller.error(e);
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
    }),
    { headers: { "Content-Type": "text/event-stream", "X-Session-Id": id } },
  );
}
export async function previewFetch(input, init = {}) {
  const path = String(input),
    signal = init.signal,
    id = new Headers(init.headers).get("X-Session-Id") || previewSeedId;
  if (signal?.aborted) throw abort();
  if (path === "/health")
    return json({ status: "ok", model_configured: false, preview: true });
  if (path.endsWith("/sessions"))
    return json({
      sessions: Object.values(db)
        .filter((s) => s.messages.length)
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((s) => ({
          id: s.id,
          title: s.title,
          updated_at: s.updated_at,
          message_count: s.messages.length,
        })),
    });
  if (init.method === "DELETE") {
    delete db[decodeURIComponent(path.split("/").pop())];
    save();
    return json({ ok: true });
  }
  if (!db[id])
    db[id] = {
      id,
      title: "新的想法",
      messages: [],
      notes: {
        foundation: "",
        foundation_narrative: "",
        focus: "",
        open_questions: [],
        memory: { state: "empty" },
        revision_count: 0,
      },
      updated_at: Date.now() / 1000,
    };
  const s = db[id];
  if (!s.snapshots)
    s.snapshots = s.messages.length
      ? [
          {
            prefix: s.notes.memory?.covered_messages || s.messages.length,
            notes: clone(s.notes),
          },
        ]
      : [];
  if (path.endsWith("/history")) return json({ messages: s.messages }, id);
  if (path.endsWith("/foundation")) return json(s.notes, id);
  if (path.endsWith("/memory/retry")) {
    s.notes.memory = { state: "ready" };
    save();
    return json(s.notes.memory, id);
  }
  if (path.endsWith("/brief"))
    return eventStream(id, signal, async (emit) => {
      const text = `## 这次想清楚的事\n\n${s.notes.foundation_narrative || "从自然交流进入共同思考，让人保留判断和改变方向的空间。"}\n\n## 已经明确\n\n${s.notes.foundation || "还没有足够的已确认内容。"}\n\n## 仍待讨论\n\n${(s.notes.open_questions || []).map((x) => "- " + x).join("\n") || "可以回到对话继续探索。"}\n\n---\n这是一份交互预览的示例 Brief，来自预设对话。`;
      for (const chunk of text.match(/.{1,12}|\n/g) || []) {
        await delay(16, signal);
        emit({ type: "brief_delta", content: chunk });
      }
      emit({ type: "brief_done", brief: text });
    });
  let text = JSON.parse(init.body || "{}").content || "";
  if (path.endsWith("/edit") || path.endsWith("/retry")) {
    const i = s.messages.map((x) => x.role).lastIndexOf("user");
    if (i >= 0) {
      if (path.endsWith("/retry")) text = s.messages[i].content;
      s.messages = s.messages.slice(0, i);
    }
    s.epoch = (s.epoch || 0) + 1;
    s.snapshots = s.snapshots.filter((h) => h.prefix <= s.messages.length);
    s.notes = s.snapshots.length
      ? clone(s.snapshots.at(-1).notes)
      : {
          foundation: "",
          foundation_narrative: "",
          focus: "",
          open_questions: [],
          revision_count: 0,
          memory: { state: "empty" },
        };
  }
  const epoch = s.epoch || 0;
  s.messages.push({ role: "user", content: text });
  s.updated_at = Date.now() / 1000;
  if (s.title === "新的想法") s.title = text.slice(0, 30);
  save();
  let response, extra, question;
  if (/一直问|总.*问|一直追问/.test(text)) {
    response = [
      "连续追问也会把人推到被访谈的位置。我的判断是：**只有缺失的信息会改变下一步，才值得停下来问。**",
      "其他时候，先给一个有依据的想法，让你有东西可以接、可以反驳。比如我们现在已经知道“不附和、不抢话”，可以先拿一段真实对话来试这个分寸。",
    ];
    extra = "追问应解决关键分岔；信息足够时，AI 主动贡献判断或新视角。";
    question = "选哪一段真实对话，来检验“有判断，但不抢话”？";
  } else if (/推翻|改口|改变|反悔/.test(text)) {
    response = [
      "改口本身可能就是思考在推进。之前的判断应该留下来，但**不能继续作为当前前提**。",
      "我会先辨认：你是在补充条件，还是原来的理由已经不成立。真的变了，就记录为什么变；说不准的地方再问你。这样留下的是思考的来路，不是一份把你锁住的结论。",
    ];
    extra = "共识可以被修订；保留替代原因，让旧判断不再约束新的讨论。";
    question = "哪些改变可以直接记录，哪些分歧需要再确认？";
  } else if (/界面|颜色|背景|置信/.test(text)) {
    response = [
      "颜色可以承接文字之外的感受。这里值得区分：**我感到被回应了**，和“这个判断已经正确了”，是两种不同的信号。",
      "我们可以保留氛围的变化，同时让具体的分歧有可以指向的位置。这样既有交流的温度，也能继续琢磨究竟哪里没想清楚。",
    ];
    extra = null;
    question = "怎样让反馈足够可见，又不打断交流？";
  } else {
    response = [
      "这条输入已经留在示例对话里。当前是交互预览，没有连接模型；你可以试试下方的示例接话，体验对话、回改和共同记录的变化。",
    ];
  }
  return eventStream(id, signal, async (emit) => {
    let partial = "";
    try {
      emit({ type: "turn_started" });
      await delay(500, signal);
      for (let i = 0; i < response.length; i++) {
        emit({ type: "voice_start", index: i });
        if (i) await delay(450, signal);
        for (const chunk of response[i].match(/.{1,3}/g) || []) {
          await delay(24, signal);
          partial += chunk;
          emit({ type: "voice_delta", index: i, content: chunk });
        }
        partial += "\n\n";
        emit({ type: "voice_end", index: i });
      }
      s.messages.push({
        role: "assistant",
        content: response.map((x) => `[VOICE]${x}[/VOICE]`).join("\n"),
      });
      s.notes.memory = { state: extra ? "updating" : "ready" };
      save();
      emit({ type: "done", voices: response });
      if (extra) {
        setTimeout(() => {
          if (db[id] !== s || (s.epoch || 0) !== epoch) return;
          s.notes.foundation +=
            "\n" +
            ((s.notes.foundation.match(/^\d+\./gm) || []).length + 1) +
            ". " +
            extra;
          s.notes.open_questions = [question];
          s.notes.revision_count++;
          s.notes.memory = {
            state: "ready",
            covered_messages: s.messages.length,
            total_messages: s.messages.length,
          };
          s.snapshots.push({
            prefix: s.messages.length,
            notes: clone(s.notes),
          });
          save();
        }, 1500);
      }
    } catch (e) {
      if (partial.trim()) {
        s.messages.push({
          role: "assistant",
          content: `[VOICE][INTERRUPTED]${partial}[/VOICE]`,
        });
        save();
      }
      throw e;
    }
  });
}

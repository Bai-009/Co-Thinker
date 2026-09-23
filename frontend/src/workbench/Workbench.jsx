import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon, { Mark } from "./Icon";
import useWorkbench from "./useWorkbench";
import { isPreview } from "./preview";
import { parseFoundationItems } from "../lib/messages";
import useDesk from "./useDesk";
import Desk from "./Desk";
import { composeReference, splitReference, sourceForPassage } from "./references";
const Markdown = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ""}</ReactMarkdown>
);
function UserText({ text }) {
  const parsed = splitReference(text);
  return <>{parsed.quote && <blockquote className="ct-message-reference"><span>引用 · {parsed.source}</span><Markdown>{parsed.quote}</Markdown></blockquote>}<Markdown>{parsed.text}</Markdown></>;
}
export function isSubmitKey(e) {
  return (
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.nativeEvent?.isComposing &&
    !e.isComposing &&
    e.keyCode !== 229
  );
}
function IconButton({ name, label, onClick, ...props }) {
  return (
    <button
      className="ct-icon"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      {...props}
    >
      <Icon name={name} />
    </button>
  );
}
function Dialog({ open, onClose, title, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ct-dialog ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="ct-dialog-head">
        <div>
          <span className="ct-eyebrow">CO-THINKER</span>
          <h2>{title}</h2>
        </div>
        <IconButton name="close" label="关闭" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
const noteLabels = {
  empty: "随对话慢慢形成",
  ready: "记录已更新",
  updating: "正在整理这一轮",
  pending: "有新内容待整理",
  error: "记录暂未更新",
};
function Records({ notes, onQuote, onClose, onRetry, onBrief, canBrief, desk, onLocate, sourceExists }) {
  const active = parseFoundationItems(notes.foundation).filter(
    (x) => !x.startsWith("~~"),
  );
  const archived = parseFoundationItems(notes.foundation).filter((x) =>
    x.startsWith("~~"),
  );
  return (
    <div className="ct-records-content">
      <div className="ct-records-head">
        <div>
          <h2>思考页</h2>
        </div>
        <IconButton name="close" label="收起共同记录" onClick={onClose} />
      </div>
      <div
        className={`ct-memory-status ${notes.memory?.state === "updating" ? "is-updating" : ""}`}
        role="status"
      >
        <span className="ct-status-dot" />
        {noteLabels[notes.memory?.state] || "等待更新"}
        {["error", "pending"].includes(notes.memory?.state) && (
          <button className="ct-text-button" onClick={onRetry}>
            重试
          </button>
        )}
      </div>
      <div className="ct-records-scroll">
        <Desk desk={desk} onQuote={onQuote} onLocate={onLocate} sourceExists={sourceExists} />
        {notes.focus && (
          <section className="ct-record-focus">
            <span className="ct-eyebrow">正在展开的问题</span>
            <h3>{notes.focus}</h3>
          </section>
        )}
        {notes.foundation_narrative && (
          <p className="ct-record-summary">{notes.foundation_narrative}</p>
        )}
        <section className="ct-record-section">
          <h3>逐渐明确</h3>
          {active.length ? (
            <ol className="ct-record-list">
              {active.map((item, i) => (
                <li key={i}>
                  <div>
                    <Markdown>{item}</Markdown>
                    <button
                      className="ct-record-action"
                      onClick={() => onQuote(item, "共同记录")}
                    >
                      <Icon name="reply" size={14} />
                        继续推敲
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ct-empty-note">
              对话中的判断会逐渐留在这里。
            </p>
          )}
        </section>
        {notes.open_questions?.length > 0 && (
          <section className="ct-record-section">
            <h3>还在推敲</h3>
            {notes.open_questions
              .filter((x) => x && x !== "无")
              .map((q, i) => (
                <button
                  className="ct-question"
                  key={i}
                  onClick={() => onQuote(q, "还在讨论")}
                >
                  <span>{q}</span>
                  <Icon name="reply" size={16} />
                </button>
              ))}
          </section>
        )}
        {notes.plan && (
          <section className="ct-record-section">
            <h3>接下来</h3>
            <div className="ct-markdown">
              <Markdown>{notes.plan}</Markdown>
            </div>
          </section>
        )}
        {archived.length > 0 && (
          <details className="ct-history">
            <summary>之前的判断 · {archived.length}</summary>
            {archived.map((s, i) => (
              <div key={i}>
                <Markdown>{s}</Markdown>
              </div>
            ))}
          </details>
        )}
        {(active.length > 0 || notes.foundation_narrative) && (
          <p className="ct-record-foot">
            随对话整理，可引用其中一条继续修正。
          </p>
        )}
      </div>
      <div className="ct-record-export">
        <button className="ct-secondary" disabled={!canBrief} onClick={onBrief}>
          <Icon name="brief" size={16} />
          将思考整理成 Brief
        </button>
      </div>
    </div>
  );
}
export default function Workbench() {
  const w = useWorkbench(),
    preview = isPreview();
  const desk = useDesk(w.currentId, preview);
  const [draft, setDraft] = useState(""),
    [quote, setQuote] = useState(null),
    [editing, setEditing] = useState(false);
  const [recordOpen, setRecordOpen] = useState(() => window.innerWidth >= 1120),
    [navOpen, setNavOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1120);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("cothinker.theme") || "light",
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selection, setSelection] = useState(null);
  const [highlightId, setHighlightId] = useState("");
  const [copied, setCopied] = useState(""),
    [copyError, setCopyError] = useState(""),
    [deleteId, setDeleteId] = useState(null),
    [infoOpen, setInfoOpen] = useState(false),
    [atBottom, setAtBottom] = useState(true);
  const composer = useRef(null),
    scroll = useRef(null),
    tail = useRef(null),
    stick = useRef(true),
    copyTimer = useRef(null),
    highlightTimer = useRef(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cothinker.theme", theme);
  }, [theme]);
  useEffect(() => {
    const mq = matchMedia("(max-width: 1119px)");
    const listener = () => {
      setNarrow(mq.matches);
      if (mq.matches) setRecordOpen(false);
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [w.messages, w.loading]);
  useEffect(() => () => { clearTimeout(copyTimer.current); clearTimeout(highlightTimer.current); }, []);
  useLayoutEffect(() => {
    const el = composer.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(160, Math.max(28, el.scrollHeight)) + "px";
    }
  }, [draft]);
  useEffect(() => {
    if (!quote) return;
    const frame = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [quote]);
  const latestUser = w.messages.map((x) => x.role).lastIndexOf("user");
  const title =
    w.sessions.find((s) => s.id === w.currentId)?.title ||
    w.messages.find((m) => m.role === "user")?.content ||
    "新的想法";
  const choose = async (id) => {
    setDraft("");
    setQuote(null);
    setEditing(false);
    setNavOpen(false);
    setSelection(null);
    stick.current = true;
    setAtBottom(true);
    await w.select(id);
    composer.current?.focus();
  };
  const quoteMessage = (text, source = "Co-Thinker") => {
    setQuote({ text, source });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (narrow) setRecordOpen(false);
    composer.current?.focus();
  };
  const findSource = (item) => sourceForPassage(w.messages, item);
  const locate = (item) => {
    const m = findSource(item);
    if (!m) return;
    if (narrow) setRecordOpen(false);
    stick.current = false;
    requestAnimationFrame(() => {
      document.getElementById(`turn-${m.id}`)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center",
      });
      setHighlightId(m.id);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(""), 2200);
    });
  };
  const keep = (text, source = "Co-Thinker") => {
    desk.add(text, source);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setRecordOpen(true);
  };
  const captureSelection = () => {
    const selected = window.getSelection();
    const text = selected?.toString().trim();
    if (
      text &&
      text.length < 3000 &&
      scroll.current?.contains(selected.anchorNode)
    ) {
      const node = selected.anchorNode?.nodeType === 1 ? selected.anchorNode : selected.anchorNode?.parentElement;
      setSelection({ text, source: node?.closest(".ct-user-turn") ? "我的表达" : "Co-Thinker" });
    } else setSelection(null);
  };
  const submit = () => {
    if (!draft.trim() || w.loading) return;
    const text = composeReference(draft, quote);
    setDraft("");
    setQuote(null);
    setSuggestionsOpen(false);
    stick.current = true;
    setAtBottom(true);
    w.send(text, editing ? "edit" : "send");
    setEditing(false);
  };
  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setCopyError("");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopyError("复制未完成，请选择文字后复制。");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([w.brief.text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "Co-Thinker-Brief.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const sidebar = (
    <>
      <div className="ct-brand">
        <Mark size={32} />
        <span>Co-Thinker</span>
      </div>
      <button className="ct-new" onClick={() => choose("")}>
        <Icon name="plus" />
        新的想法<span>↗</span>
      </button>
      <div className="ct-recent-label">最近的思考</div>
      <nav className="ct-conversations" aria-label="对话列表">
        {w.sessions.map((s) => (
          <div
            className={`ct-conversation ${w.currentId === s.id ? "is-current" : ""}`}
            key={s.id}
          >
            <button
              className="ct-conversation-select"
              title={s.title}
              onClick={() => choose(s.id)}
            >
              <span>{s.title}</span>
              <small>
                {preview
                  ? "示例对话"
                  : new Date(s.updated_at * 1000).toLocaleDateString("zh-CN", {
                      month: "long",
                      day: "numeric",
                    })}
              </small>
            </button>
            <IconButton
              name="trash"
              label={`删除对话：${s.title}`}
              onClick={() => setDeleteId(s.id)}
            />
          </div>
        ))}
        {!w.sessions.length && !w.loading && (
          <p className="ct-nav-empty">聊过的想法会留在这里。</p>
        )}
      </nav>
      <div className="ct-sidebar-foot">
        <button className="ct-connection" onClick={() => setInfoOpen(true)}>
          <span className={`ct-status-dot ${preview ? "preview" : ""}`} />
          <span>
            {preview
              ? "交互预览"
              : w.health?.model_configured
                ? "模型已连接"
                : "未连接模型"}
          </span>
          <Icon name="more" size={16} />
        </button>
        <div className="ct-sidebar-bottom">
          <span>你的思考空间</span>
          <IconButton
            name={theme === "light" ? "moon" : "sun"}
            label={theme === "light" ? "切换深色外观" : "切换浅色外观"}
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          />
        </div>
      </div>
    </>
  );
  return (
    <div
      className={`ct-app ${recordOpen && !narrow && w.messages.length ? "has-records" : ""} ${!w.messages.length ? "is-welcome" : ""}`}
    >
      <header className="ct-masthead">
        <div className="ct-masthead-brand"><IconButton name="sidebar" label="打开对话列表" onClick={() => setNavOpen(true)} /><Mark size={27} /><span>Co-Thinker</span></div>
        <div className="ct-masthead-tools">
          <button className="ct-toolbar-button" aria-label="新的想法" title="新的想法" onClick={() => choose("")}><Icon name="plus" size={17} /><span>新的想法</span></button>
          <IconButton name={theme === "light" ? "moon" : "sun"} label={theme === "light" ? "切换深色外观" : "切换浅色外观"} onClick={() => setTheme((t) => t === "light" ? "dark" : "light")} />
          <button className={`ct-toolbar-button ${recordOpen && w.messages.length ? "is-selected" : ""}`} aria-label="共同记录" aria-pressed={Boolean(recordOpen && w.messages.length)} disabled={!w.messages.length} onClick={() => setRecordOpen((x) => !x)}><Icon name="book" size={17} /><span>思考页</span>{desk.items.length > 0 && <small>{desk.items.length}</small>}</button>
        </div>
      </header>
      <main className="ct-main">
        {w.messages.length > 0 && <div className="ct-session-heading"><span>{preview ? "示例对话" : "这次思考"}</span><h1 title={title}>{title}</h1></div>}
        {w.error && (
          <div className="ct-alert" role="alert">
            {w.error}
            <button onClick={() => choose(w.currentId)}>重新载入</button>
          </div>
        )}
        <div
          className="ct-scroll"
          ref={scroll}
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
          onScroll={() => {
            const e = scroll.current;
            const bottom = e.scrollHeight - e.scrollTop - e.clientHeight < 70;
            stick.current = bottom;
            setAtBottom(bottom);
          }}
        >
          <div className={`ct-thread ${!w.messages.length ? "is-empty" : ""}`}>
            {w.loading ? (
              <div className="ct-loading" role="status">
                <div />
                <div />
                <div />
                <span>正在打开这段思考…</span>
              </div>
            ) : !w.messages.length ? (
              <div className="ct-welcome">
                <span className="ct-welcome-mark"><Mark size={38} /></span>
                <h1>最近，在想什么？</h1>
                <p>从还没想清楚的地方开始。</p>
                <div className="ct-starters">
                  {[
                    "我有个想法，还不太成形。",
                    "有个判断，我想和你推敲一下。",
                  ].map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setDraft(t);
                        composer.current?.focus();
                      }}
                    >
                      {t}
                      <Icon name="reply" size={17} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {w.messages.map((m, index) =>
                  m.role === "user" ? (
                    <article id={`turn-${m.id}`} className={`ct-user-turn ${highlightId === m.id ? "is-highlighted" : ""}`} key={m.id}>
                      <div className="ct-user-bubble">
                        <UserText text={m.content} />
                      </div>
                      {index === latestUser && !w.streaming && (
                        <div className="ct-user-actions">
                          <button
                            onClick={() => {
                              setEditing(true);
                              const parsed = splitReference(m.content);
                              setQuote(parsed.quote ? {text:parsed.quote,source:parsed.source} : null);
                              setDraft(parsed.text);
                              composer.current?.focus();
                            }}
                          >
                            <Icon name="edit" size={14} />
                            修改
                          </button>
                        </div>
                      )}
                    </article>
                  ) : (
                    <article id={`turn-${m.id}`} className={`ct-assistant-turn ${highlightId === m.id ? "is-highlighted" : ""}`} key={m.id}>
                      <div className="ct-voice-mark">
                        <Mark size={21} />
                      </div>
                      <div className="ct-assistant-body">
                        {!m.voices?.length && m.streaming ? (
                          <div className="ct-thinking" role="status">
                            <span />
                            <span />
                            <span />
                            <span className="ct-sr-only">正在思考</span>
                          </div>
                        ) : (
                          m.voices?.map((v, i) => (
                            <div className="ct-voice" key={i}>
                              <div className="ct-markdown">
                                <Markdown>{v}</Markdown>
                                {m.streaming && i === m.voices.length - 1 && (
                                  <span className="ct-stream-cursor" />
                                )}
                              </div>
                              {!m.streaming && v && (
                                <div className="ct-voice-actions">
                                  <button onClick={() => quoteMessage(v)}>
                                    <Icon name="reply" size={15} />
                                    接着聊
                                  </button>
                                  <button onClick={() => keep(v)}><Icon name="pin" size={14} />留在手边</button>
                                  <IconButton
                                    name={
                                      copied === `${m.id}-${i}`
                                        ? "check"
                                        : "copy"
                                    }
                                    label={
                                      copied === `${m.id}-${i}`
                                        ? "已复制"
                                        : "复制这一段"
                                    }
                                    onClick={() => copy(v, `${m.id}-${i}`)}
                                  />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                        {m.interrupted && (
                          <div className="ct-turn-status">
                            已停下，可以接着说。
                          </div>
                        )}
                        {m.silent && !m.voices.length && (
                          <div className="ct-turn-status">你的输入已保留。</div>
                        )}
                        {m.error && (
                          <div className="ct-turn-error" role="alert">
                            <span>{m.error}</span>
                            {index === w.messages.length - 1 && (
                              <button onClick={() => w.send("", "retry")}>
                                重试这一轮
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  ),
                )}
                <div ref={tail} />
                {selection && (
                  <div className="ct-selection-action">
                    <button onClick={() => quoteMessage(selection.text, selection.source)}>
                      <Icon name="reply" size={16} />
                      聊这一句
                    </button>
                    <button onClick={() => keep(selection.text, selection.source)}><Icon name="pin" size={15} />留在手边</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <footer className="ct-compose-area">
          {!atBottom && w.messages.length > 0 && (
            <button
              className="ct-jump"
              onClick={() => {
                stick.current = true;
                scroll.current.scrollTo({
                  top: scroll.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              <Icon name="down" size={16} />
              回到最新
            </button>
          )}

          <form
            className={`ct-composer ${editing ? "is-editing" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {editing && (
              <div className="ct-edit-banner">
                <Icon name="edit" size={15} />
                <span>修改上一条 · 后续回复与记录会随之重建</span>
                <IconButton
                  name="close"
                  label="取消修改"
                  onClick={() => {
                    setEditing(false);
                    setDraft("");
                  }}
                />
              </div>
            )}
            {quote && (
              <div className="ct-quote">
                <Icon name="reply" size={16} />
                <div>
                  <span>
                    接着
                    {quote.source === "Co-Thinker" ? "这一段" : quote.source}聊
                  </span>
                  <p>{quote.text.replace(/[*#>]/g, "")}</p>
                </div>
                <IconButton
                  name="close"
                  label="取消引用"
                  onClick={() => setQuote(null)}
                />
              </div>
            )}
            <label className="ct-sr-only" htmlFor="ct-input">
              你的想法
            </label>
            <textarea
              id="ct-input"
              ref={composer}
              value={draft}
              rows={1}
              maxLength={28000}
              placeholder={
                w.streaming
                  ? "随时补充，我会停下来听。"
                  : "想到什么，就从这里说。"
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitKey(e)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="ct-composer-bottom">
              <span className={`ct-presence ${w.streaming ? "is-active" : ""}`}><span />{w.streaming ? "正在回应 · 随时可以接话" : ""}</span>
              <div>
                {w.streaming && (
                  <IconButton name="stop" label="停止回复" onClick={w.stop} />
                )}
                <button
                  type="submit"
                  className="ct-send"
                  disabled={!draft.trim() || w.loading}
                  title={
                    w.streaming
                      ? "发送并打断当前回复"
                      : editing
                        ? "保存并重新思考"
                        : "发送"
                  }
                  aria-label={
                    w.streaming
                      ? "发送并打断当前回复"
                      : editing
                        ? "保存并重新思考"
                        : "发送"
                  }
                >
                  <Icon name="arrow" size={20} />
                </button>
              </div>
            </div>
          </form>
          <div className="ct-composer-meta">
            <button onClick={() => setInfoOpen(true)}>
              {preview
                ? "交互预览 · 预设回复"
                : w.health?.model_configured
                  ? "Co-Thinker"
                  : "未连接模型"}
            </button>
            {preview && (
              <div className="ct-example-control">
                <button
                  aria-expanded={suggestionsOpen}
                  onClick={() => setSuggestionsOpen((v) => !v)}
                >
                  示例接话
                </button>
                {suggestionsOpen && (
                  <div className="ct-example-menu">
                    {[
                      "但我不想让它一直问问题。",
                      "如果我推翻之前的想法呢？",
                    ].map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setDraft(t);
                          setSuggestionsOpen(false);
                          composer.current?.focus();
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {copyError && (
            <div className="ct-copy-error" role="alert">
              {copyError}
            </div>
          )}
        </footer>
      </main>
      {recordOpen && !narrow && w.messages.length > 0 && (
        <aside className="ct-records">
          <Records
            notes={w.notes}
            onQuote={quoteMessage}
            onClose={() => setRecordOpen(false)}
            onRetry={w.retryMemory}
            onBrief={w.generateBrief}
            canBrief={w.messages.length > 0 && !w.streaming && !w.loading}
            desk={desk} onLocate={locate} sourceExists={(item) => Boolean(findSource(item))}
          />
        </aside>
      )}
      <Dialog
        open={recordOpen && narrow}
        onClose={() => setRecordOpen(false)}
        title="共同记录"
        className="ct-record-dialog"
      >
        <Records
          notes={w.notes}
          onQuote={quoteMessage}
          onClose={() => setRecordOpen(false)}
          onRetry={w.retryMemory}
          onBrief={w.generateBrief}
          canBrief={w.messages.length > 0 && !w.streaming && !w.loading}
          desk={desk} onLocate={locate} sourceExists={(item) => Boolean(findSource(item))}
        />
      </Dialog>
      <Dialog
        open={navOpen}
        onClose={() => setNavOpen(false)}
        title="思考空间"
        className="ct-nav-dialog"
      >
        <div className="ct-mobile-sidebar">{sidebar}</div>
      </Dialog>
      <Dialog
        open={w.brief.open}
        onClose={w.closeBrief}
        title="把这次思考带走"
        className="ct-brief-dialog"
      >
        <div className="ct-brief-intro">
          把目标、取舍与尚未解决的问题，整理成一份可继续使用的 Brief。
        </div>
        <div className="ct-brief-body ct-markdown">
          {w.brief.text ? (
            <Markdown>{w.brief.text}</Markdown>
          ) : w.brief.loading ? (
            <p className="ct-working">正在回看这段对话…</p>
          ) : null}
          {w.brief.loading && (
            <div className="ct-turn-status" role="status">
              正在整理，关闭不会影响对话。
            </div>
          )}
          {w.brief.error && (
            <div className="ct-turn-error" role="alert">
              {w.brief.error}
              <button onClick={w.generateBrief}>重新生成</button>
            </div>
          )}
        </div>
        <div className="ct-dialog-footer">
          <span>{preview ? "示例 Brief" : "Markdown 文档"}</span>
          <button
            className="ct-secondary"
            disabled={!w.brief.text || w.brief.loading}
            onClick={download}
          >
            <Icon name="download" size={16} />
            下载
          </button>
          <button
            className="ct-primary"
            disabled={!w.brief.text || w.brief.loading}
            onClick={() => copy(w.brief.text, "brief")}
          >
            <Icon name={copied === "brief" ? "check" : "copy"} size={16} />
            {copied === "brief" ? "已复制" : "复制 Brief"}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={preview ? "交互预览" : "模型连接"}
      >
        <div className="ct-dialog-copy">
          {preview ? (
            <>
              <p>
                这里用一段预设对话展示交互。你可以继续示例话题、引用、打断、回改、查看共同记录和生成
                Brief。
              </p>
              <p>
                示例回复不代表模型实时表现。正式模式使用同一套界面，连接本机配置的模型。
              </p>
              <a className="ct-primary" href="/">
                打开正式模式
                <Icon name="arrow" size={16} />
              </a>
            </>
          ) : (
            <>
              <p>
                {w.health?.model_configured
                  ? `当前模型：${w.health.model}`
                  : "尚未配置模型。对话界面已就绪。"}
              </p>
              <p>
                在项目的 .env 中配置 API
                Key、兼容接口地址与模型名称，再重启服务。密钥只在后端使用。
              </p>
              <a className="ct-secondary" href="/?preview=1">
                先看交互预览
              </a>
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title="删除这段对话？"
      >
        <div className="ct-dialog-copy">
          <p>这段对话和共同记录将被删除，无法恢复。</p>
        </div>
        <div className="ct-dialog-footer">
          <button className="ct-secondary" onClick={() => setDeleteId(null)}>
            保留
          </button>
          <button
            className="ct-primary"
            onClick={() => {
              w.remove(deleteId);
              setDeleteId(null);
            }}
          >
            删除对话
          </button>
        </div>
      </Dialog>
    </div>
  );
}

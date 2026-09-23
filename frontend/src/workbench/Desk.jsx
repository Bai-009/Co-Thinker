import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";

function Passage({ item, onEdit, onRemove, onQuote, onLocate, canLocate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const changed = item.text !== item.original;
  return <article className={`ct-passage ${editing ? "is-editing" : ""}`}>
    <div className="ct-passage-label">
      <span>{changed ? "改写稿" : "摘录"}<span className="ct-middle-dot">·</span>{changed ? "原文来自 " : ""}{item.source}</span>
      <button className="ct-icon" aria-label="移出手边" title="移出手边" onClick={onRemove}><Icon name="close" size={15} /></button>
    </div>
    {editing ? <form onSubmit={(e) => {
      e.preventDefault();
      if (onEdit(draft)) setEditing(false);
    }}>
      <textarea aria-label="改写手边内容" value={draft} maxLength={3000} rows={5} autoFocus onChange={(e) => setDraft(e.target.value)} />
      <div className="ct-passage-edit-actions">
        <button type="button" onClick={() => setEditing(false)}>取消</button>
        <button type="submit" className="ct-text-button" disabled={!draft.trim()}>保留改写</button>
      </div>
    </form> : <>
      <div className="ct-passage-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div>
      <div className="ct-passage-actions">
        <button onClick={() => onQuote(item.text, changed ? "手边改写稿（尚待讨论）" : item.source)}><Icon name="reply" size={14} />聊这一点</button>
        <button onClick={() => { setDraft(item.text); setEditing(true); }}>改写</button>
        {canLocate ? <button onClick={onLocate}>原文<Icon name="source" size={13} /></button> : <span>原文已更新</span>}
      </div>
    </>}
  </article>;
}

export default function Desk({ desk, onQuote, onLocate, sourceExists }) {
  if (!desk.items.length && !desk.error && !desk.removed) return null;
  return <section className="ct-desk" aria-label="放在手边的内容">
    <div className="ct-section-label" title="讨论材料仅保存在当前浏览器，不自动成为共识"><Icon name="pin" size={14} /><h3>放在手边</h3></div>
    {desk.items.map((item) => <Passage key={item.id} item={item}
      onEdit={(text) => desk.edit(item.id, text)} onRemove={() => desk.remove(item.id)}
      onQuote={onQuote} onLocate={() => onLocate(item)} canLocate={sourceExists(item)} />)}
    {desk.error && <p className="ct-desk-feedback" role="alert">{desk.error}</p>}
    {desk.removed && <div className="ct-desk-feedback" role="status">已移出手边<button onClick={desk.undo}>撤销</button></div>}
  </section>;
}

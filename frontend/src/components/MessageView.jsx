import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Voice rendering. NO role labels (no "视角 N", no "[追问]"). The
// difference between voices is felt through:
//   - left stroke width (--voice-stroke)
//   - text opacity (--voice-opacity)
//   - font weight (--voice-weight)
//   - letter-spacing (--voice-tracking) — opens at low conf, tightens at high
// All driven by the per-voice confidence in [0, 1]. The hue stays
// the same across voices so they read as one paper, not a palette.
//
// Voice content is markdown — bold / italic / lists / code / etc — so it
// reads as composed prose, not a literal text stream. During streaming
// the partial content is rendered as plain text with a trailing cursor
// (markdown can't be parsed mid-token, and the cursor needs to sit at
// the writing position); once the voice settles, ReactMarkdown takes
// over and the message visibly "sets" into print form.

const MD_PLUGINS = [remarkGfm]
const EDIT_TEXTAREA_MAX_HEIGHT = 220

function confToCSSVars(conf) {
  const c = Math.max(0, Math.min(1, typeof conf === 'number' ? conf : 0.5))
  // Stroke baseline matches the user msg right-border (1px) so the page
  // never reads as "uneven hairlines"; the range is intentionally narrow
  // (0.8–1.6) so confidence is felt mainly through opacity / weight /
  // tracking, with stroke as a quiet 4th channel.
  const stroke = (0.8 + 0.8 * c).toFixed(2) + 'px'  // 0.8 → 1.6
  const opacity = (0.55 + 0.45 * c).toFixed(3)      // 0.55 → 1.00
  const weight = Math.round(380 + 160 * c)          // 380 → 540
  const tracking = (0.014 - 0.017 * c).toFixed(4) + 'em' // +0.014em → -0.003em
  return {
    '--voice-stroke': stroke,
    '--voice-opacity': opacity,
    '--voice-weight': weight,
    '--voice-tracking': tracking,
  }
}

// User message — supports inline editing for the latest one in the
// conversation. When `canEdit` is true, hovering the bubble reveals
// a pencil affordance; clicking it swaps the bubble for a textarea
// with Cancel / 重新生成 actions. Submitting calls onEdit(newText),
// which (in useWorkshop) replaces this message + truncates后续 +
// kicks off a fresh thinker turn with backend state rolled back to
// the pre-turn snapshot.
function UserMessage({ msg, canEdit, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.content || '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, EDIT_TEXTAREA_MAX_HEIGHT)}px`
  }, [editing, draft])

  function startEdit() {
    setDraft(msg.content || '')
    setEditing(true)
  }
  function cancel() {
    setEditing(false)
  }
  function submit() {
    const t = draft.trim()
    if (!t) {
      setEditing(false)
      return
    }
    setEditing(false)
    if (t === (msg.content || '').trim()) return  // no change — no-op
    onEdit?.(t)
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  if (editing) {
    return (
      <article className="msg msg-user is-editing">
        <div className="msg-edit">
          <textarea
            ref={inputRef}
            className="msg-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
            autoFocus
          />
          <div className="msg-edit-actions">
            <button type="button" className="msg-edit-cancel" onClick={cancel}>
              取消
            </button>
            <button
              type="button"
              className="msg-edit-save"
              onClick={submit}
              disabled={!draft.trim()}
              title="重新生成（之后的对话会被覆盖）"
            >
              重新生成
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="msg msg-user">
      <div className="msg-bubble">{msg.content}</div>
      {canEdit && (
        <button
          type="button"
          className="msg-edit-trigger"
          onClick={startEdit}
          aria-label="编辑这条消息"
          title="编辑这条消息（之后的对话会重新生成）"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12 L2.7 9.5 L9.4 2.8 L11.4 4.8 L4.7 11.5 Z" />
            <line x1="8.7" y1="3.5" x2="10.7" y2="5.5" />
          </svg>
        </button>
      )}
    </article>
  )
}

export default function MessageView({ msg, canEdit = false, onEdit }) {
  if (msg.role === 'user') {
    return <UserMessage msg={msg} canEdit={canEdit} onEdit={onEdit} />
  }
  if (msg.role === 'system') {
    return (
      <article className="msg msg-system">
        <div className="msg-bubble">{msg.content}</div>
      </article>
    )
  }
  const voices = (msg.voices || []).filter((v) => v != null)
  const confs = msg.confs || []
  const interruptedFlags = msg.interrupted || []
  if (voices.length === 0) return null

  return (
    <article className="msg msg-assistant">
      <div className="voices">
        {voices.map((content, i) => {
          const isLast = i === voices.length - 1
          const isInterrupted = !!interruptedFlags[i]
          // An interrupted voice is by definition "done streaming" —
          // it's the persisted partial. Don't show the streaming cursor.
          const stillStreaming =
            !isInterrupted &&
            content &&
            isLast &&
            !content.match(/[。！？.!?]\s*$/)
          const conf = confs[i]
          const voiceCls = ['voice', isInterrupted && 'is-interrupted']
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={i}
              className={voiceCls}
              style={confToCSSVars(conf)}
              data-conf={
                typeof conf === 'number' ? conf.toFixed(2) : undefined
              }
            >
              <div
                className={`voice-text${stillStreaming ? ' is-streaming' : ''}`}
              >
                {!content ? (
                  <span className="voice-cursor">▍</span>
                ) : stillStreaming ? (
                  <>
                    <span className="voice-text-stream">{content}</span>
                    <span className="voice-cursor">▍</span>
                  </>
                ) : (
                  <ReactMarkdown remarkPlugins={MD_PLUGINS}>
                    {content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </article>
  )
}

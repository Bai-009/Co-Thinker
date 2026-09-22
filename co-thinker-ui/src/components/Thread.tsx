import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Markdown } from './Markdown'
import { normalize } from '../domain/markdown'
import {
  makeReference,
  rangeFromSelection,
  resolveReference,
  type SelectionRange,
} from '../domain/reference'
import type { GroundworkDelta } from '../domain/groundwork'
import type { MemoryStatus, Message } from '../domain/types'

interface Props {
  sessionId: string
  messages: Message[]
  editingId: string | null
  revisableId: string | null
  /** 每一版地基落下时的变化，按它覆盖到的消息 sequence 放回对话里。 */
  settled: Map<number, GroundworkDelta>
  /** 地基覆盖到的 sequence；之后的话还没沉淀。 */
  boundary: number | null
  memory: MemoryStatus
  onQuote: (reference: ReturnType<typeof makeReference>) => void
  onEdit: (message: Message) => void
  onRetry: () => void
  onRetryMemory: () => void
  onLocateClaim: (n: number) => void
  busy: boolean
  /** 计数器变化即触发一次定位。 */
  locateRequest: { id: string; n: number } | null
}

interface LiveSelection {
  messageId: string
  range: SelectionRange
}

const num = (n: number) => String(n).padStart(2, '0')

/** 把握 0–1 → 左边墨线的粗细、字的透明度和字重。不动色相。 */
function voiceStyle(confidence?: number): CSSProperties {
  const c = Math.max(0, Math.min(1, typeof confidence === 'number' ? confidence : 0.5))
  return {
    '--voice-stroke': `${(0.4 + 1.6 * c).toFixed(2)}px`,
    '--voice-opacity': (0.62 + 0.36 * c).toFixed(3),
    '--voice-weight': String(Math.round(360 + 130 * c)),
  } as CSSProperties
}

/** 一轮之后地基里落下了哪几条：只给编号，不说话。定下的实，松动的虚，被取代的画个箭头。编号点过去就到那一条。 */
function Settled({ delta, onLocate }: { delta: GroundworkDelta; onLocate: (n: number) => void }) {
  const at = (n: number, className?: string) => (
    <button key={`${className ?? ''}${n}`} type="button" className={className} title="在地基里看" onClick={() => onLocate(n)}>
      {num(n)}
    </button>
  )
  const parts: ReactNode[] = [
    ...delta.confirmed.map((n) => at(n)),
    ...delta.tentative.map((n) => at(n, 'is-tentative')),
    ...delta.superseded.map(([from, to]) => (
      <span key={`s${from}`} className="is-superseded">
        {to ? at(from) : <s>{num(from)}</s>}
        {to && <span aria-hidden="true">→</span>}
        {to && at(to)}
      </span>
    )),
  ]
  // 问题的增减不在这里报：还在松动那一节本身就是当前的问题。
  if (!parts.length) return null
  return (
    <p className="ct-settled" aria-label="这一轮写进地基的条目">
      <span className="ct-settled-label">地基</span>
      <span>{parts}</span>
    </p>
  )
}

export function Thread(props: Props) {
  const {
    sessionId,
    messages,
    editingId,
    revisableId,
    settled,
    boundary,
    memory,
    onQuote,
    onEdit,
    onRetry,
    onRetryMemory,
    onLocateClaim,
    busy,
    locateRequest,
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<LiveSelection | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(flashTimer.current), [])
  useEffect(() => setSelection(null), [sessionId])

  const readSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null)
    const rootOf = (node: Node | null) => {
      const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement
      return el?.closest('[data-message-root]') ?? null
    }
    const root = rootOf(sel.anchorNode)
    if (!root || root !== rootOf(sel.focusNode)) return setSelection(null)
    const id = root.getAttribute('data-message-root')
    const message = messages.find((m) => m.id === id)
    if (!message) return setSelection(null)
    const range = rangeFromSelection(sel, root, normalize(message.text))
    if (!range) return setSelection(null)
    setSelection({ messageId: message.id, range })
  }, [messages])

  const locate = useCallback((messageId: string) => {
    const el = containerRef.current?.querySelector(`[data-message-row="${messageId}"]`)
    if (!el) return
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setFlash(messageId)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1600)
  }, [])

  useEffect(() => {
    if (locateRequest) locate(locateRequest.id)
  }, [locateRequest, locate])

  const quoteWhole = (message: Message) => onQuote(makeReference(sessionId, message))

  const quoteSelection = () => {
    if (!selection) return
    const message = messages.find((m) => m.id === selection.messageId)
    if (!message) return
    onQuote(makeReference(sessionId, message, selection.range))
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return (
    <div
      ref={containerRef}
      className="ct-thread"
      onMouseUp={readSelection}
      onKeyUp={readSelection}
      onTouchEnd={readSelection}
    >
      {messages.map((message) => {
        const state = resolveReference(message.reference, messages, sessionId)
        const highlighted = flash === message.id
        const delta = settled.get(message.sequence)
        // 地基还没覆盖到的话，墨色浅一层；落进地基那一刻再深回来。不用文字说。
        const unsettled = boundary == null || message.sequence > boundary

        const turn =
          message.role === 'user' ? (
            <article
              className={`ct-user-turn${unsettled ? ' is-unsettled' : ''}`}
              data-message-row={message.id}
              aria-label="我的表达"
            >
              <div
                className={`ct-user-text${highlighted ? ' is-highlighted' : ''}${editingId === message.id ? ' is-editing' : ''}`}
                data-message-root={message.id}
              >
                {message.reference && (
                  <blockquote className="ct-message-reference">
                    <span>
                      引用 ·{' '}
                      {state.status === 'changed'
                        ? '依据已改变'
                        : state.status === 'missing'
                          ? '来源已删'
                          : '这一段'}
                    </span>
                    <Markdown source={message.reference.quote} />
                  </blockquote>
                )}
                <Markdown source={message.text} />
              </div>
              <div className="ct-user-actions">
                {revisableId === message.id && !busy && (
                  <button type="button" onClick={() => onEdit(message)}>
                    修改
                  </button>
                )}
                <button type="button" aria-label="引用这句话" onClick={() => quoteWhole(message)}>
                  引用
                </button>
              </div>
            </article>
          ) : (
            <article
              className={`ct-assistant-turn${unsettled ? ' is-unsettled' : ''}`}
              data-message-row={message.id}
              aria-label="Co-Thinker 的回应"
            >
              {message.status === 'streaming' && !message.text ? (
                <div className="ct-thinking" role="status">
                  <span />
                  <span />
                  <span />
                  <span className="ct-sr-only">正在思考</span>
                </div>
              ) : (
                <div className="ct-voice" style={voiceStyle(message.confidence)}>
                  <div
                    className={`ct-markdown${highlighted ? ' is-highlighted' : ''}`}
                    data-message-root={message.id}
                  >
                    <Markdown source={message.text} />
                    {message.status === 'streaming' && <span className="ct-stream-cursor" />}
                  </div>
                </div>
              )}
              {message.status !== 'streaming' && (
                // 落在这一轮的底部留白里，不压在正文最后一行上。
                <div className="ct-voice-actions">
                  <button type="button" aria-label="引用这段回应" onClick={() => quoteWhole(message)}>
                    引用
                  </button>
                </div>
              )}
              {message.status === 'interrupted' && (
                <div className="ct-turn-status">已停下</div>
              )}
              {message.status === 'failed' && (
                <div className="ct-turn-error" role="alert">
                  <span>{message.error ?? '这一轮没有生成成功。'}</span>
                  <button type="button" onClick={onRetry}>
                    重试这一轮
                  </button>
                </div>
              )}
              {delta && <Settled delta={delta} onLocate={onLocateClaim} />}
            </article>
          )

        return (
          <Fragment key={message.id}>
            {turn}
            {message.role === 'user' && delta && <Settled delta={delta} onLocate={onLocateClaim} />}
          </Fragment>
        )
      })}

      {memory.state === 'updating' && (
        <p className="ct-settled is-updating" role="status">
          <span className="ct-status-dot" />
          <span className="ct-sr-only">地基更新中</span>
        </p>
      )}
      {memory.state === 'failed' && (
        <p className="ct-settled is-failed" role="alert">
          <span className="ct-settled-label">地基</span>
          <span>
            没有更新{' '}
            <button type="button" onClick={onRetryMemory}>
              重试
            </button>
          </span>
        </p>
      )}

      {selection && (
        <div className="ct-selection-action">
          <button type="button" onClick={quoteSelection}>
            引用这段
          </button>
        </div>
      )}
    </div>
  )
}

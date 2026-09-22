import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import Icon from './Icon'
import { IconButton } from './Dialog'
import type { Message, Reference } from '../domain/types'
import type { ReferenceState } from '../domain/reference'

interface Props {
  value: string
  reference: Reference | null
  referenceState: ReferenceState
  editing: Message | null
  streaming: boolean
  canSend: boolean
  onChange: (text: string) => void
  onSend: () => void
  onCancelRun: () => void
  onCancelEdit: () => void
  onDropReference: () => void
  onLocate: (messageId: string) => void
}

// 一张纸条：一行输入，右边一个发送。不放例子，不放提示。
export function Composer(props: Props) {
  const {
    value,
    reference,
    referenceState,
    editing,
    streaming,
    canSend,
    onChange,
    onSend,
    onCancelRun,
    onCancelEdit,
    onDropReference,
    onLocate,
  } = props
  const area = useRef<HTMLTextAreaElement>(null)
  // 组合期间的 Enter 是选字。
  const [composing, setComposing] = useState(false)

  // 上限交给 CSS 的 max-height，避免两处各写一个数字。
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity
      const needed = el.scrollHeight
      el.style.height = `${Math.min(needed, max)}px`
      // 内容高度取整会多出 1px，macOS 常显滚动条时会露出一截；没到上限就不给滚动条。
      el.style.overflowY = needed > max ? 'auto' : 'hidden'
    }
    fit()
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [value])

  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
    if (composing || native.isComposing || native.keyCode === 229) return
    event.preventDefault()
    onSend()
  }

  const sendLabel = streaming ? '发送并打断当前回复' : editing ? '保存并重新思考' : '发送'

  return (
    <footer className="ct-compose-area">
      <form
        className="ct-composer"
        onSubmit={(e) => {
          e.preventDefault()
          onSend()
        }}
      >
        <div className="ct-composer-stack">
          {editing && (
            <div className="ct-edit-banner">
              <Icon name="edit" size={14} />
              <span>修改上一条 · 后续回复与地基会随之重建</span>
              <IconButton name="close" label="取消修改" onClick={onCancelEdit} />
            </div>
          )}

          {reference && (
            <div className="ct-quote">
              <Icon name="reply" size={14} />
              <div>
                <span>
                  {referenceState.status === 'changed'
                    ? '依据已改变'
                    : referenceState.status === 'missing'
                      ? '来源已删'
                      : '这一段'}
                </span>
                <p>{reference.quote}</p>
              </div>
              {referenceState.status === 'resolved' && (
                <IconButton
                  name="source"
                  label="回到原话"
                  onClick={() => onLocate(referenceState.message.id)}
                />
              )}
              <IconButton name="close" label="取消引用" onClick={onDropReference} />
            </div>
          )}

          <label className="ct-sr-only" htmlFor="ct-input">
            说一句
          </label>
          <textarea
            id="ct-input"
            ref={area}
            rows={1}
            value={value}
            placeholder={streaming ? '在想…' : '说一句'}
            onChange={(e) => onChange(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={keyDown}
            spellCheck={false}
          />
        </div>

        <div className="ct-composer-aside">
          {streaming && (
            <span className="ct-presence is-active">
              <span />
              正在回应 · 随时可以接话
            </span>
          )}
        </div>

        <div className="ct-composer-send">
          {streaming && <IconButton name="stop" label="停止回复" onClick={onCancelRun} />}
          <button
            type="submit"
            className="ct-send"
            disabled={!canSend}
            title={sendLabel}
            aria-label={sendLabel}
          >
            <svg
              className="ct-send-arrow"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4.5 10h11" />
              <path d="M11 5.5l4.5 4.5-4.5 4.5" />
            </svg>
          </button>
        </div>
      </form>
    </footer>
  )
}

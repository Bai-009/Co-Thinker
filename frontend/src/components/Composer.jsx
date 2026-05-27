import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// The composer is a single paper card. Inside it: textarea on the
// left (auto-grows up to MAX_HEIGHT, scrolls beyond), an optional
// seed line below the textarea (judge AI's ghost suggestion when the
// input is empty), and the send button on the right, vertically
// pinned to the bottom of the card.

const TEXTAREA_MAX_HEIGHT = 180

const Composer = forwardRef(function Composer(
  { value, onChange, onSend, streaming, seed = '' },
  ref,
) {
  const innerRef = useRef(null)
  useImperativeHandle(ref, () => innerRef.current, [])

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  }, [value])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const showSeed = !value && !streaming && !!seed

  return (
    <footer className="composer">
      <div className="composer-stack">
        <textarea
          ref={innerRef}
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? '在想…（你也可以追一条打断）' : '说一句'}
          rows={1}
          spellCheck="false"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {showSeed && (
          <button
            type="button"
            className="composer-seed"
            title="点击采用这个开场（你也可以直接打字覆盖）"
            onClick={() => onChange(seed)}
          >
            <span className="composer-seed-mark" aria-hidden="true">·</span>
            <span className="composer-seed-text">{seed}</span>
          </button>
        )}
        <button
          type="button"
          className="send-btn"
          onClick={onSend}
          disabled={!value.trim()}
          aria-label={streaming && value.trim() ? '追打（打断当前浮现）' : '发送'}
        >
          {streaming && !value.trim() ? (
            <span className="send-dots" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
          ) : (
            <svg
              className="send-arrow"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* Hand-drawn pen stroke: a faint ink dot at the start,
                  a slightly arched horizontal line, a small arrowhead. */}
              <circle cx="3" cy="10" r="0.9" fill="currentColor" stroke="none" />
              <path d="M3.6 10 Q 9 9.4 15.7 10" />
              <path d="M11.8 6.2 L 15.9 10 L 11.8 13.8" />
            </svg>
          )}
        </button>
      </div>
    </footer>
  )
})

export default Composer

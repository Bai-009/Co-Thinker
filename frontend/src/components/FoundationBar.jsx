import React from 'react'

// Parse a foundation list string ("1. xxx\n2. yyy\n...") into items.
// Continuation lines (no "N." prefix) fold into the previous item.
function parseFoundationItems(text) {
  if (!text) return []
  const lines = text.split('\n')
  const items = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[\.、]\s*(.*)$/)
    if (m) {
      if (current !== null) items.push(current)
      current = m[2].trim()
    } else if (current !== null) {
      const trimmed = line.trim()
      if (trimmed) current = current ? current + ' ' + trimmed : trimmed
    }
  }
  if (current !== null) items.push(current)
  return items.filter((s) => s.length > 0)
}

// Take the first sentence of a prose paragraph for the collapsed view.
// Uses both Chinese and Latin terminators. Falls back to the whole string
// if no terminator appears.
function firstSentence(text) {
  if (!text) return ''
  const trimmed = text.trim()
  const m = trimmed.match(/^[\s\S]*?[。！？.!?](?=\s|$|[^"'”’])/)
  if (m) return m[0].trim()
  return trimmed
}

export default function FoundationBar({
  text,
  narrative,
  streaming,
  flash,
  change = 'unchanged',
  open,
  onToggle,
  clarity = 0,
  drift = '',
}) {
  const hasNarrative = !!(narrative && narrative.trim())
  const hasList = !!(text && text.trim())
  if (!hasNarrative && !hasList && !streaming) return null

  // Only flash visibly when something actually changed; "unchanged"
  // turns get no animation at all (atmosphere shift carries the signal).
  const showFlash = flash && change !== 'unchanged'

  const cls = [
    'foundation',
    streaming && 'is-streaming',
    showFlash && 'is-flash',
    showFlash && change === 'revise' && 'is-revise',
    open && 'is-open',
  ]
    .filter(Boolean)
    .join(' ')

  // Clarity drives a subtle blur — fuzzy foundations read as slightly
  // out of focus. Capped at 0.9px so it never breaks legibility.
  const fuzz = Math.max(0, 1 - Math.max(0, Math.min(1, clarity)))
  const style = {
    '--foundation-haze': `${(fuzz * 0.9).toFixed(2)}px`,
    '--foundation-clarity': clarity.toFixed(3),
  }

  const items = parseFoundationItems(text || '')

  // Collapsed preview prefers the narrative's first sentence — that's the
  // single richest line we have. Falls back to first list item if no
  // narrative yet (early turns / legacy sessions).
  let collapsedPreview
  if (streaming && !hasNarrative && !hasList) {
    collapsedPreview = '…'
  } else if (hasNarrative) {
    collapsedPreview = firstSentence(narrative)
  } else if (items.length > 0) {
    const first = items[0]
    const rest = items.length - 1
    collapsedPreview = rest > 0 ? `${first} （还有 ${rest} 条共识）` : first
  } else {
    collapsedPreview = text || ''
  }

  return (
    <div className={cls} style={style}>
      <button
        type="button"
        className="foundation-bar"
        onClick={onToggle}
        aria-expanded={open}
        title="我们已达成的共识"
      >
        <span className="foundation-label">
          <span className="foundation-pulse" aria-hidden="true" />
          地基
        </span>
        <span className="foundation-text">{collapsedPreview}</span>
        <span className="foundation-chevron" aria-hidden="true">
          {open ? '∧' : '∨'}
        </span>
      </button>
      {open && (
        <div className="foundation-expanded">
          {hasNarrative && (
            <div className="foundation-narrative">{narrative}</div>
          )}
          {items.length > 0 ? (
            <details className="foundation-structure">
              <summary className="foundation-structure-summary">
                看结构（{items.length} 条共识清单）
              </summary>
              <ol className="foundation-list">
                {items.map((it, i) => (
                  <li key={i} className="foundation-item">
                    {it}
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            !hasNarrative && hasList && (
              <div className="foundation-expanded-text">{text}</div>
            )
          )}
          {drift && (
            <div className="foundation-drift">
              <span className="foundation-drift-label">还在松动</span>
              <span className="foundation-drift-text">{drift}</span>
            </div>
          )}
          <div className="foundation-note">
            每轮回看时自动更新——按共识的累积长，不用管理。
          </div>
        </div>
      )}
    </div>
  )
}

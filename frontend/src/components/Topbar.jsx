import React from 'react'

export default function Topbar({
  onGenerateBrief,
  briefDisabled,
  showBrief,
  onOpenFoundation,
  foundationActive,
  foundationFlash,
}) {
  // No `is-streaming` state anymore — the rewriter runs server-side as a
  // detached task; the frontend has no live progress signal for it. The
  // dot just breathes at its ambient rate. `is-flash` still pulses when
  // polling detects the foundation/judge actually changed.
  const triggerCls = ['foundation-trigger', foundationFlash && 'is-flash']
    .filter(Boolean)
    .join(' ')

  const showActions = showBrief || foundationActive

  return (
    <header className="topbar">
      {showActions && (
        <div className="topbar-actions">
          {foundationActive && (
            <button
              type="button"
              className={triggerCls}
              onClick={onOpenFoundation}
              title="查看地基（达成的共识 + 还在松动的分歧）"
            >
              <span className="foundation-trigger-dot" aria-hidden="true" />
              地基
            </button>
          )}
          {showBrief && (
            <button
              type="button"
              className="ghost-btn"
              onClick={onGenerateBrief}
              disabled={briefDisabled}
              title="基于当前地基和对话生成执行简报"
            >
              生成简报
            </button>
          )}
        </div>
      )}
    </header>
  )
}

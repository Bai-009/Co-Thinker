import React from 'react'

// Sun + moon icons drawn at 14px to live alongside the foundation /
// brief actions in the topbar. Stroke-based, no fill — same craft
// register as the send button arrow.
function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="2.4" />
      <line x1="7" y1="0.8" x2="7" y2="2.2" />
      <line x1="7" y1="11.8" x2="7" y2="13.2" />
      <line x1="0.8" y1="7" x2="2.2" y2="7" />
      <line x1="11.8" y1="7" x2="13.2" y2="7" />
      <line x1="2.6" y1="2.6" x2="3.6" y2="3.6" />
      <line x1="10.4" y1="10.4" x2="11.4" y2="11.4" />
      <line x1="2.6" y1="11.4" x2="3.6" y2="10.4" />
      <line x1="10.4" y1="3.6" x2="11.4" y2="2.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.6 8.6 A 5 5 0 1 1 5.4 2.4 A 4 4 0 0 0 11.6 8.6 Z" />
    </svg>
  )
}

export default function Topbar({
  onGenerateBrief,
  briefDisabled,
  showBrief,
  onOpenFoundation,
  foundationActive,
  foundationFlash,
  theme,
  onToggleTheme,
}) {
  // No `is-streaming` state anymore — the rewriter runs server-side as a
  // detached task; the frontend has no live progress signal for it. The
  // dot just breathes at its ambient rate. `is-flash` still pulses when
  // polling detects the foundation/judge actually changed.
  const triggerCls = ['foundation-trigger', foundationFlash && 'is-flash']
    .filter(Boolean)
    .join(' ')

  // Theme toggle is always visible — even in empty state — so the user
  // can flip light/dark before the first turn.
  return (
    <header className="topbar">
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
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
          aria-label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  )
}

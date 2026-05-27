import React from 'react'

import { parseFoundationItems, parsePlanItems } from '../lib/messages'

export default function FoundationModal({
  open,
  text,
  narrative,
  plan,
  drift,
  onClose,
}) {
  if (!open) return null

  const items = parseFoundationItems(text || '')
  const planItems = parsePlanItems(plan || '')
  const hasNarrative = !!(narrative && narrative.trim())
  const hasList = items.length > 0
  const hasPlan = planItems.length > 0
  const hasDrift = !!(drift && drift.trim())
  const hasAny = hasNarrative || hasList || hasPlan || hasDrift

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="foundation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="foundationTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="foundation-modal-head">
          <div className="foundation-modal-title-group">
            <h2 className="foundation-modal-title" id="foundationTitle">地基</h2>
            <div className="foundation-modal-subtitle">
              和你共建的认知地基——按共识的累积长，每轮回看时自动更新。
            </div>
          </div>
          <button type="button" className="brief-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="foundation-modal-body">
          {!hasAny && (
            <div className="foundation-modal-empty">
              还没有沉淀出共识——先继续聊。
            </div>
          )}
          {hasNarrative && (
            <div className="foundation-narrative">{narrative}</div>
          )}
          {hasPlan && (
            <div className="foundation-plan">
              <div className="foundation-plan-label">
                阶段
                <span className="foundation-plan-progress">
                  {planItems.filter((it) => it.done).length} / {planItems.length}
                </span>
              </div>
              <ul className="foundation-plan-list">
                {planItems.map((it, i) => (
                  <li
                    key={i}
                    className={`foundation-plan-item${it.done ? ' is-done' : ''}`}
                  >
                    <span className="foundation-plan-check" aria-hidden="true">
                      {it.done ? '✓' : '○'}
                    </span>
                    <span className="foundation-plan-text">{it.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasList && (
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
          )}
          {hasDrift && (
            <div className="foundation-drift">
              <span className="foundation-drift-label">还在松动</span>
              <span className="foundation-drift-text">{drift}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

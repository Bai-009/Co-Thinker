import React from 'react'

import { parseBriefSections } from '../lib/messages'

export default function BriefModal({
  open,
  content,
  streaming,
  error,
  copyStatus,
  onClose,
  onCopy,
  onRegenerate,
}) {
  if (!open) return null

  const sections = parseBriefSections(content)
  const showRawFallback = !sections.length && content
  const isEmpty = !content && !error

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="brief-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="briefTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="brief-head">
          <div className="brief-title-group">
            <h2 className="brief-title" id="briefTitle">
              执行简报
            </h2>
            <div className="brief-subtitle">
              递给 Cursor / Lovable / Kimi 用——把这场思考里达成的一切凝结成一段。
            </div>
          </div>
          <button type="button" className="brief-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="brief-body">
          {error && <div className="brief-error">{error}</div>}

          {isEmpty && !error && (
            <div className="brief-loading">
              <div className="brief-loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div className="brief-loading-text">正在凝结这场对话…</div>
            </div>
          )}

          {sections.length > 0 && (
            <div className="brief-sections">
              {sections.map((sec, i) => (
                <section key={i} className="brief-section">
                  <h3 className="brief-section-heading">{sec.heading}</h3>
                  <div className="brief-section-body">{sec.body}</div>
                </section>
              ))}
              {streaming && <span className="brief-cursor">▍</span>}
            </div>
          )}

          {showRawFallback && <pre className="brief-raw">{content}</pre>}
        </div>

        <footer className="brief-foot">
          <div className="brief-foot-left">
            {copyStatus && <span className="brief-copy-status">{copyStatus}</span>}
          </div>
          <div className="brief-foot-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={onRegenerate}
              disabled={streaming}
            >
              重新生成
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onCopy}
              disabled={streaming || !content}
            >
              复制
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

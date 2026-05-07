import React, { useState } from 'react'

// Title preview for a conversation: first user message, single-line,
// truncated. Empty conversations fall back to a placeholder.
function titleFor(item) {
  const raw = (item?.title || '').trim()
  if (!raw) return '新对话'
  const oneLine = raw.replace(/\s+/g, ' ')
  return oneLine.length > 26 ? oneLine.slice(0, 26) + '…' : oneLine
}

export default function Sidebar({
  list,
  currentId,
  onNew,
  onSwitch,
  onDelete,
  collapsed,
  onToggle,
}) {
  const [confirmId, setConfirmId] = useState('')

  if (collapsed) {
    return (
      <aside className="sidebar is-collapsed">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label="展开会话列表"
          title="展开会话列表"
        >
          ›
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="brand-name">Co-Thinker</div>
          <div className="brand-sub">we can know more than we can tell</div>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label="收起会话列表"
          title="收起会话列表"
        >
          ‹
        </button>
      </div>

      <button
        type="button"
        className="sidebar-new"
        onClick={onNew}
        title="开始一段新的对话"
      >
        <span className="sidebar-new-plus" aria-hidden="true">+</span>
        <span>新建对话</span>
      </button>

      <div className="sidebar-list">
        {list.length === 0 && (
          <div className="sidebar-empty">还没有对话——发一句开始。</div>
        )}
        {list.map((item) => {
          const isCurrent = item.id === currentId
          const isConfirm = confirmId === item.id
          const cls = [
            'sidebar-item',
            isCurrent && 'is-current',
            isConfirm && 'is-confirm',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={item.id}
              className={cls}
              onMouseLeave={() => {
                if (confirmId === item.id) setConfirmId('')
              }}
            >
              <button
                type="button"
                className="sidebar-item-main"
                onClick={() => onSwitch(item.id)}
                title={item.title || '新对话'}
              >
                {titleFor(item)}
              </button>
              <button
                type="button"
                className="sidebar-item-del"
                onClick={(e) => {
                  e.stopPropagation()
                  if (isConfirm) {
                    onDelete(item.id)
                    setConfirmId('')
                  } else {
                    setConfirmId(item.id)
                  }
                }}
                title={isConfirm ? '再点一次确认删除' : '删除该对话'}
                aria-label="删除该对话"
              >
                {isConfirm ? '确认' : '×'}
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

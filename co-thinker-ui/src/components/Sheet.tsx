import type { ReactNode } from 'react'
import { IconButton } from './Dialog'

export type SheetView = 'records' | 'prompt'

const LABEL: Record<SheetView, string> = { records: '地基', prompt: 'Prompt' }

interface HeadProps {
  /** 这张纸上有哪几份文稿。只有一份时就是标题；两份时标题就是切换。 */
  views: SheetView[]
  current: SheetView
  onSwitch: (view: SheetView) => void
  /** 标题下面一行：依据哪几轮、什么时候。 */
  meta?: ReactNode
  /** 更新中：标题旁一个慢慢呼吸的点。 */
  busy?: boolean
  actions?: ReactNode
  onClose?: () => void
}

export function SheetHead({ views, current, onSwitch, meta, busy, actions, onClose }: HeadProps) {
  return (
    <header className="ct-sheet-head">
      <div className="ct-sheet-titles">
        <div className="ct-sheet-tabs" role={views.length > 1 ? 'tablist' : undefined}>
          {views.map((view) =>
            view === current ? (
              <h2 key={view} className="ct-sheet-tab is-current" role={views.length > 1 ? 'tab' : undefined} aria-selected={views.length > 1 ? true : undefined}>
                {LABEL[view]}
              </h2>
            ) : (
              <button key={view} type="button" className="ct-sheet-tab" role="tab" aria-selected={false} onClick={() => onSwitch(view)}>
                {LABEL[view]}
              </button>
            ),
          )}
        </div>
        {meta && (
          <p className="ct-sheet-meta">
            {busy && <span className="ct-status-dot is-updating" aria-hidden="true" />}
            {meta}
          </p>
        )}
      </div>
      {(actions || onClose) && (
        <div className="ct-sheet-actions">
          {actions}
          {onClose && <IconButton name="close" label={`收起${LABEL[current]}`} onClick={onClose} />}
        </div>
      )}
    </header>
  )
}

/** 「刚刚」「3 分钟前」「14:02」：只给人看个大概，不跳秒。 */
export function when(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

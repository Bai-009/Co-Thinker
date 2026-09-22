import { IconButton } from './Dialog'
import type { SessionSummary } from '../domain/types'

interface Props {
  sessions: SessionSummary[]
  currentId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

const DAY = 86_400_000
const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface SessionGroup {
  label: string
  items: SessionSummary[]
}

/** 按日子分组：今天 / 昨天 / 近一周按日期 / 更早。新的在前。 */
export function groupSessions(sessions: SessionSummary[], now = Date.now()): SessionGroup[] {
  const today = startOfDay(now)
  const groups: SessionGroup[] = []
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const s of sorted) {
    const day = startOfDay(s.updatedAt)
    const diff = Math.round((today - day) / DAY)
    const d = new Date(day)
    const label =
      diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : '更早'
    const last = groups.at(-1)
    if (last && last.label === label) last.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return groups
}

// 一本日记的目录：按日子分组，只列标题。
export function Sidebar({ sessions, currentId, onSelect, onNew, onDelete }: Props) {
  const groups = groupSessions(sessions)
  return (
    <div className="ct-sidebar">
      <button type="button" className="ct-new" onClick={onNew} title="开始一段新的对话">
        <span className="ct-new-plus" aria-hidden="true">
          +
        </span>
        <span>新建对话</span>
      </button>

      <nav className="ct-conversations" aria-label="最近的思考">
        {groups.map((g) => (
          <section key={g.label} className="ct-nav-group">
            <h3>{g.label}</h3>
            {g.items.map((s) => (
              <div key={s.id} className={`ct-conversation${s.id === currentId ? ' is-current' : ''}`}>
                <button
                  type="button"
                  className="ct-conversation-select"
                  aria-current={s.id === currentId}
                  onClick={() => onSelect(s.id)}
                >
                  <span>{s.title}</span>
                  <small>{s.messageCount} 句</small>
                </button>
                <IconButton name="close" label={`删除「${s.title}」`} onClick={() => onDelete(s.id)} />
              </div>
            ))}
          </section>
        ))}
        {sessions.length === 0 && <p className="ct-nav-empty">还没有对话——发一句开始。</p>}
      </nav>
    </div>
  )
}

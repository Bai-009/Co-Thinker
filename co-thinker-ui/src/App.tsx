import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from './controller/useSession'
import { Thread } from './components/Thread'
import { Composer } from './components/Composer'
import { Records } from './components/Records'
import { Sidebar } from './components/Sidebar'
import { Dialog, IconButton } from './components/Dialog'
import { Markdown } from './components/Markdown'
import { useScrollAnchor } from './hooks/useScrollAnchor'
import { resolveReference } from './domain/reference'
import { groundworkDelta, isEmptyDelta, type GroundworkDelta } from './domain/groundwork'
import { ExampleTransport } from './transport/exampleTransport'
import { applyClarity, applySense } from './lib/sense'
import { repository } from './storage/storage'
import type { Transport } from './transport/types'
import './styles/workbench.css'


function useMedia(query: string) {
  const [match, setMatch] = useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(query)
    const listener = () => setMatch(mq.matches)
    listener()
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [query])
  return match
}

export default function App({ transport }: { transport?: Transport } = {}) {
  const s = useSession(() => transport ?? new ExampleTransport())
  const { state, draft, actions } = s
  const [locate, setLocate] = useState<{ id: string; n: number } | null>(null)
  const [claimLocate, setClaimLocate] = useState<{ n: number; k: number } | null>(null)
  // 宽屏一开始就并排；窄屏等人来开，不上来就弹一层。
  const [recordOpen, setRecordOpen] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(min-width: 1280px)').matches,
  )
  // 对话列表：宽屏是一栏，收放记住；窄屏是从左边推出来的抽屉。
  const [navPinned, setNavPinned] = useState(
    () => repository.read<boolean>('nav', (v): v is boolean => typeof v === 'boolean') ?? true,
  )
  const [navDrawer, setNavDrawer] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // 两栏等宽，每栏都得放得下一页正文。
  const wide = useMedia('(min-width: 1280px)')
  const roomy = useMedia('(min-width: 1120px)')
  const sense = state.groundwork?.sense

  // 纸的暖冷和纹理跟着这一轮的感觉走；没有感觉就停在正中。
  useEffect(() => {
    applySense(sense?.certainty ?? 0.5, sense?.resonance ?? 0.5)
    applyClarity(sense?.clarity ?? 0.5)
  }, [sense])
  const anchor = useScrollAnchor('thread', state.messages)

  const referenceState = useMemo(
    () => resolveReference(draft.reference, state.messages, state.id),
    [draft.reference, state.id, state.messages],
  )

  const requestLocate = useCallback((id: string) => {
    setLocate((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }, [])

  const locateClaim = useCallback((n: number) => {
    setRecordOpen(true)
    setClaimLocate((prev) => ({ n, k: (prev?.k ?? 0) + 1 }))
  }, [])

  // 每一版思考页与前一版的差，放回它覆盖到的那一轮。
  const settled = useMemo(() => {
    const map = new Map<number, GroundworkDelta>()
    state.groundworkHistory.forEach((g, i) => {
      const delta = groundworkDelta(state.groundworkHistory[i - 1] ?? null, g)
      if (!isEmptyDelta(delta)) map.set(g.coveredThrough, delta)
    })
    return map
  }, [state.groundworkHistory])

  const editing = state.messages.find((m) => m.id === s.editing) ?? null
  const preview = s.transport instanceof ExampleTransport
  const hasMessages = state.messages.length > 0
  const blank = !hasMessages
  const streaming = state.phase === 'streaming' || state.phase === 'submitting'
  const title = state.title || '这次思考'
  const brief = s.brief
  const briefOpen = Boolean(brief.snapshot || brief.loading || brief.error)
  const showRecords = recordOpen && hasMessages

  const records = (
    <Records
      groundwork={state.groundwork}
      updating={state.memory.state === 'updating'}
      onClose={() => setRecordOpen(false)}
      onQuoteClaim={(text) => s.setDraft({ text: draft.text ? `${draft.text}\n${text}` : text })}
      onLocate={requestLocate}
      sourceExists={(id) => state.messages.some((m) => m.id === id)}
      locateRequest={claimLocate}
    />
  )

  const sidebar = (
    <Sidebar
      sessions={s.sessions}
      currentId={state.id}
      onSelect={(id) => {
        void actions.selectSession(id)
        setNavDrawer(false)
      }}
      onNew={() => {
        void actions.newSession()
        setNavDrawer(false)
      }}
      onDelete={(id) => setDeleteId(id)}
    />
  )
  const showNav = roomy && navPinned
  const toggleNav = () => {
    if (!roomy) {
      setNavDrawer(true)
      return
    }
    const next = !navPinned
    setNavPinned(next)
    repository.write('nav', next)
  }
  // 收放边栏的开关：边栏展开时住在边栏里，收起时才回到顶栏左上角。
  const navToggle = (
    <IconButton
      name="sidebar"
      label="对话列表"
      aria-pressed={roomy ? navPinned : navDrawer}
      onClick={toggleNav}
    />
  )

  return (
    <div
      className={`ct-app${showNav ? ' has-nav' : ''}${showRecords && wide ? ' has-records' : ''}${blank ? ' is-welcome' : ''}`}
    >
      {showNav && (
        <aside className="ct-nav">
          <div className="ct-nav-head">{navToggle}</div>
          {sidebar}
        </aside>
      )}
      <header className="ct-masthead">
        <div className="ct-masthead-brand">
          {!showNav && navToggle}
          <div className="ct-brand-block">
            <span className="ct-brand-name">Co-Thinker</span>
            <span className="ct-brand-sub">we can know more than we can tell</span>
          </div>
        </div>
        <div className="ct-masthead-tools">
          {preview && <span className="ct-masthead-note">示例 · 未连接模型</span>}
          <button type="button" className="ct-toolbar-button" onClick={() => void actions.newSession()}>
            新建对话
          </button>
          <button
            type="button"
            className={`ct-toolbar-button${showRecords ? ' is-selected' : ''}`}
            aria-label="地基"
            aria-pressed={showRecords}
            disabled={!hasMessages}
            title="达成的共识，和还在松动的地方"
            onClick={() => setRecordOpen((x) => !x)}
          >
            地基
          </button>
          <button
            type="button"
            className="ct-toolbar-button"
            title="基于当前地基和对话生成执行简报"
            disabled={!hasMessages || s.busy}
            onClick={() => void actions.generateBrief()}
          >
            生成简报
          </button>
        </div>
      </header>

      <main className="ct-main">
        {hasMessages && (
          <div className="ct-running-head" title={title}>
            {title}
          </div>
        )}

        {(s.notice || state.error) && (
          // 请求级的失败：网络断了（notice）或这一轮没生成出来（state.error）。
          <div className="ct-alert" role="alert">
            {s.notice ?? state.error}
            {state.error && !s.busy && (
              <button type="button" onClick={() => void actions.retryTurn()}>
                重试这一轮
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                s.dismissNotice()
                s.dismissError()
              }}
            >
              知道了
            </button>
          </div>
        )}

        <div className="ct-scroll" ref={anchor.ref}>
          {blank ? (
            <div className="ct-thread">
              <div className="ct-empty">
                <h1 className="ct-empty-headline">Prompt as crystallized thinking</h1>
                <p className="ct-empty-sub">Prompt 不是输入技巧，而是共识后的思考结晶</p>
              </div>
            </div>
          ) : (
            <Thread
              sessionId={state.id}
              messages={state.messages}
              editingId={s.editing}
              revisableId={s.revisable?.id ?? null}
              settled={settled}
              boundary={state.groundwork?.coveredThrough ?? null}
              memory={state.memory}
              onQuote={actions.quote}
              onEdit={actions.beginEdit}
              onRetry={actions.retryTurn}
              onRetryMemory={actions.retryMemory}
              onLocateClaim={locateClaim}
              busy={s.busy}
              locateRequest={locate}
            />
          )}
        </div>

        <Composer
          value={draft.text}
          reference={draft.reference}
          referenceState={referenceState}
          editing={editing}
          streaming={streaming}
          canSend={draft.text.trim().length > 0}
          onChange={(text) => s.setDraft({ text })}
          onSend={() => void actions.send()}
          onCancelRun={() => void actions.cancel()}
          onCancelEdit={actions.cancelEdit}
          onDropReference={() => s.setDraft({ reference: null })}
          onLocate={requestLocate}
        />
      </main>

      {showRecords && wide && <aside className="ct-records">{records}</aside>}

      <Dialog
        open={showRecords && !wide}
        onClose={() => setRecordOpen(false)}
        title="地基"
        className="ct-record-dialog"
      >
        {!wide && records}
      </Dialog>

      <Dialog open={navDrawer} onClose={() => setNavDrawer(false)} title="最近的思考" className="ct-nav-dialog">
        {sidebar}
      </Dialog>

      <Dialog
        open={briefOpen}
        onClose={actions.closeBrief}
        title="执行简报"
        subtitle="递给 Cursor / Lovable / Kimi 用——把这场思考里达成的一切凝结成一段。"
        className="ct-brief-dialog"
      >
        {brief.loading && <p className="ct-working">正在凝结这场对话…</p>}
        {brief.error && (
          <div className="ct-turn-error" role="alert">
            {brief.error}
            <button type="button" onClick={() => void actions.generateBrief()}>
              重新生成
            </button>
          </div>
        )}
        {brief.snapshot && (
          <>
            {(s.briefRelation.added || s.briefRelation.quoteChanged) && (
              <div className="ct-turn-status" role="status">
                <span>{s.briefRelation.quoteChanged ? '引用依据已改变' : '这之后有新增'}</span>
                <button type="button" onClick={() => void actions.generateBrief()}>
                  重新生成
                </button>
              </div>
            )}
            <div className="ct-brief-body">
              <div className="ct-markdown">
                <Markdown source={brief.snapshot.markdown} />
              </div>
            </div>
            <div className="ct-dialog-footer">
              <button type="button" className="ct-secondary" onClick={() => void actions.generateBrief()}>
                重新生成
              </button>
              <button
                type="button"
                className="ct-primary"
                onClick={() => void navigator.clipboard?.writeText(brief.snapshot!.markdown)}
              >
                复制
              </button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)} title="删除这段对话？">
        <div className="ct-dialog-copy">
          <p>这段对话和它的地基将被删除，无法恢复。</p>
        </div>
        <div className="ct-dialog-footer">
          <button type="button" className="ct-secondary" onClick={() => setDeleteId(null)}>
            取消
          </button>
          <button
            type="button"
            className="ct-primary"
            onClick={() => {
              if (deleteId) void actions.deleteSession(deleteId)
              setDeleteId(null)
            }}
          >
            删除
          </button>
        </div>
      </Dialog>
    </div>
  )
}

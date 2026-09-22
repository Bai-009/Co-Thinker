import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSession } from './controller/useSession'
import { Thread } from './components/Thread'
import { Composer } from './components/Composer'
import { Records } from './components/Records'
import { Sidebar } from './components/Sidebar'
import { Dialog, IconButton, canAnimate } from './components/Dialog'
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

const clip = (text: string, max = 36) => (text.length > max ? `${text.slice(0, max)}…` : text)

export default function App({ transport }: { transport?: Transport } = {}) {
  const s = useSession(() => transport ?? new ExampleTransport())
  const { state, draft, actions } = s
  const [locate, setLocate] = useState<{ id: string; n: number } | null>(null)
  const [claimLocate, setClaimLocate] = useState<{ n: number; k: number } | null>(null)
  // 地基不主动打开：头几轮没什么可看的，等人来开。
  const [recordOpen, setRecordOpen] = useState(false)
  // 对话列表：宽屏是一栏，收放记住；窄屏是从左边推出来的抽屉。
  const [navPinned, setNavPinned] = useState(
    () => repository.read<boolean>('nav', (v): v is boolean => typeof v === 'boolean') ?? true,
  )
  const [navDrawer, setNavDrawer] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // 复制简报之后按钮说一声「已复制」，一秒多就恢复。
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const copyBrief = useCallback(async (markdown: string) => {
    try {
      await navigator.clipboard?.writeText(markdown)
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* 剪贴板不可用就不说话 */
    }
  }, [])
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

  // 首屏和对话之间：输入框从中间滑到底部（或回去），标题在原地淡去，而不是跳过去。
  const mainRef = useRef<HTMLElement>(null)
  const lastRects = useRef<{ composer: DOMRect; empty: DOMRect | null; main: DOMRect } | null>(null)
  const [leaving, setLeaving] = useState<{ top: number; left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main || !canAnimate()) return
    const from = lastRects.current
    const composer = main.querySelector<HTMLElement>('.ct-composer')
    if (from && composer) {
      const to = composer.getBoundingClientRect()
      const dx = from.composer.left - to.left
      const dy = from.composer.top - to.top
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        composer.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, width: `${from.composer.width}px` },
            { transform: 'none', width: `${to.width}px` },
          ],
          { duration: 560, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
        )
      }
      if (!blank && from.empty) {
        setLeaving({ top: from.empty.top - from.main.top, left: from.empty.left - from.main.left, width: from.empty.width })
        const t = window.setTimeout(() => setLeaving(null), 400)
        return () => window.clearTimeout(t)
      }
    }
  }, [blank])
  useLayoutEffect(() => {
    const main = mainRef.current
    const composer = main?.querySelector('.ct-composer')
    if (!main || !composer) return
    lastRects.current = {
      composer: composer.getBoundingClientRect(),
      empty: main.querySelector('.ct-empty:not(.is-leaving)')?.getBoundingClientRect() ?? null,
      main: main.getBoundingClientRect(),
    }
  })

  const records = (
    <Records
      groundwork={state.groundwork}
      updating={state.memory.state === 'updating'}
      onClose={wide ? undefined : () => setRecordOpen(false)}
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
  // 确认删除时点名是哪一段；标题太长就截住。
  const deleteTarget = s.sessions.find((x) => x.id === deleteId)
  const deleteCopy = deleteTarget?.title
    ? `「${clip(deleteTarget.title)}」和它的地基会一起删掉，不能恢复。`
    : '这段对话和它的地基会一起删掉，不能恢复。'
  // 收放边栏的开关：边栏展开时住在边栏里，收起时才回到顶栏左上角。
  const navToggle = (
    <IconButton
      name="sidebar"
      label="对话列表"
      aria-pressed={roomy ? navPinned : navDrawer}
      onClick={toggleNav}
    />
  )
  // 名字和一句话跟着边栏走：展开时在边栏头部，收起时才回到顶栏。
  const brand = (
    <div className="ct-brand-block">
      <span className="ct-brand-name">Co-Thinker</span>
      <span className="ct-brand-sub">we can know more than we can tell</span>
    </div>
  )

  return (
    <div
      className={`ct-app${showNav ? ' has-nav' : ''}${showRecords && wide ? ' has-records' : ''}${blank ? ' is-welcome' : ''}`}
    >
      {roomy && (
        <aside className="ct-nav" aria-hidden={!navPinned}>
          <div className="ct-nav-head">
            {brand}
            {navToggle}
          </div>
          {sidebar}
        </aside>
      )}
      <header className="ct-masthead">
        {!showNav && (
          <div className="ct-masthead-brand">
            {navToggle}
            {!blank && <IconButton name="plus" label="新建对话" onClick={() => void actions.newSession()} />}
            {brand}
          </div>
        )}
        <div className="ct-masthead-tools">
          {preview && <span className="ct-masthead-note">示例 · 未连接模型</span>}
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

      <main className="ct-main" ref={mainRef}>
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
        {leaving && (
          <div className="ct-empty is-leaving" aria-hidden="true" style={leaving}>
            <h1 className="ct-empty-headline">Prompt as crystallized thinking</h1>
            <p className="ct-empty-sub">Prompt 不是输入技巧，而是共识后的思考结晶</p>
          </div>
        )}
      </main>

      {wide && hasMessages && (
        <aside className="ct-records-track" aria-hidden={!recordOpen}>
          <div className="ct-records">{records}</div>
        </aside>
      )}

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
              <button type="button" className="ct-ghost" onClick={() => void actions.generateBrief()}>
                重新生成
              </button>
              <button type="button" className="ct-primary" onClick={() => void copyBrief(brief.snapshot!.markdown)}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title="删除这段对话？"
        plain
        className="ct-confirm"
      >
        <div className="ct-dialog-copy">
          <p>{deleteCopy}</p>
        </div>
        <div className="ct-dialog-footer">
          <button type="button" className="ct-ghost" onClick={() => setDeleteId(null)}>
            取消
          </button>
          <button
            type="button"
            className="ct-primary is-destructive"
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

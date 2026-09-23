import { useEffect, useRef, useState } from 'react'
import type { Groundwork } from '../domain/types'
import { arrangeClaims } from '../domain/groundwork'
import { Lineage } from './Lineage'
import { paragraphs } from '../domain/prose'
import { SheetHead, when, type SheetView } from './Sheet'
import { repository } from '../storage/storage'

interface Props {
  groundwork: Groundwork | null
  updating: boolean
  /** 地基覆盖到人说的第几句。 */
  coveredTurns: number
  views: SheetView[]
  onSwitch: (view: SheetView) => void
  /** 只有窄屏的那层需要自己的关闭；宽屏并排时由顶栏的「地基」收放。 */
  onClose?: () => void
  /** 引地基里的一条：n 是清单编号；待定里的一条没有编号，传 null。 */
  onQuoteClaim: (n: number | null, text: string) => void
  onLocate: (messageId: string) => void
  sourceExists: (messageId: string) => boolean
  /** 计数器变化即定位到第 n 条。 */
  locateRequest: { n: number; k: number } | null
}

const num = (n: number) => String(n).padStart(2, '0')
// 条目开合记在本机：散文是地基的正文，条目和变化需要时再展开。
const ITEMS_KEY = 'records-items'

export function Records(props: Props) {
  const { groundwork, updating, coveredTurns, views, onSwitch, onClose, onQuoteClaim, onLocate, sourceExists, locateRequest } = props
  const scroll = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [showItems, setShowItems] = useState(
    () => repository.read<boolean>(ITEMS_KEY, (v): v is boolean => typeof v === 'boolean') ?? false,
  )
  const handled = useRef(0)

  useEffect(() => () => clearTimeout(timer.current), [])
  // 从对话里点编号过来，条目先展开，再定位到那一条。
  useEffect(() => {
    if (locateRequest) setShowItems(true)
  }, [locateRequest])
  useEffect(() => {
    if (!locateRequest || !showItems || handled.current === locateRequest.k) return
    handled.current = locateRequest.k
    const el = scroll.current?.querySelector(`[data-claim="${locateRequest.n}"]`)
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setFlash(locateRequest.n)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 1600)
  }, [locateRequest, showItems])

  const toggleItems = () => {
    const next = !showItems
    setShowItems(next)
    repository.write(ITEMS_KEY, next)
  }

  const arranged = arrangeClaims(groundwork?.claims ?? [])
  const settled = arranged.filter(({ claim }) => claim.status !== 'tentative')
  const tentative = arranged.filter(({ claim }) => claim.status === 'tentative')
  const open = groundwork?.open ?? []
  const pending = tentative.length + open.length
  const counts = [settled.length ? `共识 ${settled.length}` : '', pending ? `待定 ${pending}` : ''].filter(Boolean).join(' · ')

  const meta = updating ? '正在更新' : groundwork ? `截至第 ${coveredTurns} 轮 · ${when(groundwork.updatedAt)}更新` : undefined

  return (
    <div className="ct-sheet ct-records-content">
      <SheetHead views={views} current="records" onSwitch={onSwitch} meta={meta} busy={updating} onClose={onClose} />

      <div className="ct-sheet-scroll" ref={scroll}>
        {groundwork ? (
          <div className="ct-ground-prose">
            {paragraphs(groundwork.prose).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : (
          // 头一版还在写的时候，页头已经说了「正在更新」，这里不再重复。
          !updating && <p className="ct-empty-note">暂无内容</p>
        )}

        {groundwork && counts && (
          <button type="button" className={`ct-ground-toggle${showItems ? ' is-open' : ''}`} aria-expanded={showItems} onClick={toggleItems}>
            <span>条目</span>
            <span className="ct-ground-toggle-count">{counts}</span>
          </button>
        )}

        {showItems && settled.length > 0 && (
          <section className="ct-ground-section" aria-label="共识">
            <h3>共识</h3>
            <ol className="ct-ground-list">
              {settled.map(({ claim, n, origins }) => {
                // 有来路的一条：平时只见现在的说法，停在编号或句末上标上，原地变回原来的说法。
                if (origins.length > 0 && claim.status !== 'superseded') {
                  return (
                    <Lineage
                      key={`${claim.id}>${origins[0].claim.id}`}
                      claim={claim}
                      n={n}
                      origin={origins[0]}
                      highlighted={flash === n || flash === origins[0].n}
                      updatedAt={groundwork?.updatedAt ?? 0}
                      onQuote={(text) => onQuoteClaim(n, text)}
                    />
                  )
                }
                const source = claim.sourceIds.find(sourceExists)
                return (
                  <li key={claim.id} className={`ct-ground-item${flash === n ? ' is-highlighted' : ''}`} data-claim={n}>
                    {source ? (
                      <button
                        type="button"
                        className="ct-ground-num"
                        aria-label={`定位到第 ${n} 条的原文`}
                        title="定位到原文"
                        onClick={() => onLocate(source)}
                      >
                        {num(n)}
                      </button>
                    ) : (
                      <span className="ct-ground-num">{num(n)}</span>
                    )}
                    <div className="ct-ground-body">
                      <p className="ct-ground-text">{claim.text}</p>
                      {claim.status === 'superseded' && claim.note && <p className="ct-ground-why">{claim.note}</p>}
                      {origins.length > 0 && (
                        <div className="ct-ground-origins">
                          {origins.map((o) => (
                            <p
                              key={o.claim.id}
                              className={`ct-ground-origin${flash === o.n ? ' is-highlighted' : ''}`}
                              data-claim={o.n}
                            >
                              <span className="ct-ground-origin-label">原 {num(o.n)}</span>
                              <span>{o.claim.text}</span>
                              {o.claim.note && <span className="ct-ground-why">{o.claim.note}</span>}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    {claim.status !== 'superseded' && (
                      <button type="button" className="ct-ground-quote" aria-label="引用这条" onClick={() => onQuoteClaim(n, claim.text)}>
                        引用
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {showItems && pending > 0 && (
          <section className="ct-ground-section" aria-label="待定">
            <h3>待定</h3>
            <ul className="ct-ground-list is-open">
              {tentative.map(({ claim, n }) => (
                <li key={claim.id} className={`ct-ground-item${flash === n ? ' is-highlighted' : ''}`} data-claim={n}>
                  <span className="ct-ground-num">{num(n)}</span>
                  <div className="ct-ground-body">
                    <p className="ct-ground-text">{claim.text}</p>
                  </div>
                  <button type="button" className="ct-ground-quote" aria-label="引用这条" onClick={() => onQuoteClaim(n, claim.text)}>
                    引用
                  </button>
                </li>
              ))}
              {open.map((q) => (
                <li key={q} className="ct-ground-item">
                  <span className="ct-ground-mark" aria-hidden="true" />
                  <div className="ct-ground-body">
                    <p className="ct-ground-text">{q}</p>
                  </div>
                  <button type="button" className="ct-ground-quote" aria-label="引用这个问题" onClick={() => onQuoteClaim(null, q)}>
                    引用
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { Groundwork } from '../domain/types'
import { arrangeClaims } from '../domain/groundwork'
import { Lineage } from './Lineage'
import { paragraphs } from '../domain/prose'
import { SheetHead, when, type SheetView } from './Sheet'

interface Props {
  groundwork: Groundwork | null
  updating: boolean
  /** 地基覆盖到人说的第几句。 */
  coveredTurns: number
  views: SheetView[]
  onSwitch: (view: SheetView) => void
  /** 只有窄屏的那层需要自己的关闭；宽屏并排时由顶栏的「地基」收放。 */
  onClose?: () => void
  onQuoteClaim: (text: string) => void
  onLocate: (messageId: string) => void
  sourceExists: (messageId: string) => boolean
  /** 计数器变化即定位到第 n 条。 */
  locateRequest: { n: number; k: number } | null
  /** 读完地基，下一步就是凝成 Prompt。 */
  onCrystallize?: () => void
}

const num = (n: number) => String(n).padStart(2, '0')

export function Records(props: Props) {
  const { groundwork, updating, coveredTurns, views, onSwitch, onClose, onQuoteClaim, onLocate, sourceExists, locateRequest, onCrystallize } = props
  const scroll = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!locateRequest) return
    const el = scroll.current?.querySelector(`[data-claim="${locateRequest.n}"]`)
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setFlash(locateRequest.n)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 1600)
  }, [locateRequest])

  const arranged = arrangeClaims(groundwork?.claims ?? [])
  const settled = arranged.filter(({ claim }) => claim.status !== 'tentative')
  const tentative = arranged.filter(({ claim }) => claim.status === 'tentative')
  const open = groundwork?.open ?? []

  const meta = updating ? '正在更新' : groundwork ? `依据前 ${coveredTurns} 轮 · ${when(groundwork.updatedAt)}更新` : undefined

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
          <p className="ct-empty-note">{updating ? '正在写第一版。' : '说上几句，这里会慢慢有东西。'}</p>
        )}

        {settled.length > 0 && (
          <section className="ct-ground-section" aria-label="已经定下">
            <h3>已经定下</h3>
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
                      onQuote={onQuoteClaim}
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
                        aria-label={`回到第 ${n} 条的原话`}
                        title="原话"
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
                              <span className="ct-ground-origin-label">原先 {num(o.n)}</span>
                              <span>{o.claim.text}</span>
                              {o.claim.note && <span className="ct-ground-why">{o.claim.note}</span>}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    {claim.status !== 'superseded' && (
                      <button type="button" className="ct-ground-quote" aria-label="引用这条" onClick={() => onQuoteClaim(claim.text)}>
                        引用
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {(tentative.length > 0 || open.length > 0) && (
          <section className="ct-ground-section" aria-label="还没定">
            <h3>还没定</h3>
            <ul className="ct-ground-list is-open">
              {tentative.map(({ claim, n }) => (
                <li key={claim.id} className={`ct-ground-item${flash === n ? ' is-highlighted' : ''}`} data-claim={n}>
                  <span className="ct-ground-num">{num(n)}</span>
                  <div className="ct-ground-body">
                    <p className="ct-ground-text">{claim.text}</p>
                  </div>
                  <button type="button" className="ct-ground-quote" aria-label="引用这条" onClick={() => onQuoteClaim(claim.text)}>
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
                  <button type="button" className="ct-ground-quote" aria-label="引用这一问" onClick={() => onQuoteClaim(q)}>
                    引用
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {onCrystallize && groundwork && (
          <div className="ct-sheet-next">
            <button type="button" className="ct-pill" onClick={onCrystallize}>
              凝成 Prompt
            </button>
            <p>地基和整场对话，凝成一段可以直接交给执行 agent 的 Prompt。</p>
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { IconButton } from './Dialog'
import type { Groundwork } from '../domain/types'

interface Props {
  groundwork: Groundwork | null
  updating: boolean
  onClose: () => void
  onQuoteClaim: (text: string) => void
  onLocate: (messageId: string) => void
  sourceExists: (messageId: string) => boolean
  /** 计数器变化即定位到第 n 条。 */
  locateRequest: { n: number; k: number } | null
}

const num = (n: number) => String(n).padStart(2, '0')

export function Records(props: Props) {
  const { groundwork, updating, onClose, onQuoteClaim, onLocate, sourceExists, locateRequest } = props
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

  const claims = groundwork?.claims ?? []
  const open = groundwork?.open ?? []
  const position = new Map(claims.map((c, i) => [c.id, i + 1]))

  return (
    <div className="ct-records-content">
      <div className="ct-records-head">
        <h2>
          <span className={`ct-status-dot${updating ? ' is-updating' : ''}`} aria-hidden="true" />
          地基
        </h2>
        <IconButton name="close" label="收起地基" onClick={onClose} />
      </div>

      <div className="ct-records-scroll" ref={scroll}>
        {groundwork ? (
          <p className="ct-record-summary">{groundwork.prose}</p>
        ) : (
          <p className="ct-empty-note">还没有共识。</p>
        )}

        {claims.length > 0 && (
          <section className="ct-record-section">
            <h3>共识</h3>
            <ol className="ct-record-list">
              {claims.map((claim, i) => {
                const n = i + 1
                const source = claim.sourceIds.find(sourceExists)
                const by = claim.supersededBy ? position.get(claim.supersededBy) : undefined
                const className = [
                  claim.status === 'tentative' && 'is-tentative',
                  claim.status === 'superseded' && 'is-superseded',
                  flash === n && 'is-highlighted',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <li key={claim.id} className={className} data-claim={n}>
                    {source ? (
                      <button
                        type="button"
                        className="ct-record-num"
                        aria-label={`回到第 ${n} 条的原话`}
                        title="原话"
                        onClick={() => onLocate(source)}
                      >
                        {num(n)}
                      </button>
                    ) : (
                      <span className="ct-record-num">{num(n)}</span>
                    )}
                    {claim.status === 'superseded' ? (
                      <span className="ct-record-text">
                        <s>{claim.text}</s>
                        {by && <span className="ct-record-note">被 {num(by)} 取代</span>}
                      </span>
                    ) : (
                      <span className="ct-record-text">
                        {claim.text}
                        {claim.status === 'tentative' && <span className="ct-record-note">松动</span>}
                      </span>
                    )}
                    {claim.status !== 'superseded' && (
                      <button
                        type="button"
                        className="ct-record-quote"
                        aria-label="引用这条共识"
                        onClick={() => onQuoteClaim(claim.text)}
                      >
                        引用
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {open.length > 0 && (
          <section className="ct-record-section">
            <h3>还在松动</h3>
            {open.map((q) => (
              <button key={q} type="button" className="ct-question" onClick={() => onQuoteClaim(q)}>
                <span>{q}</span>
                <span className="ct-record-quote" aria-hidden="true">
                  引用
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
